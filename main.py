from __future__ import annotations

import base64
import hmac
import logging
import mimetypes
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from app.build_service import run_decompile_task, run_mod_task
from app.apk_library import add_or_get_apk_item, delete_apk_item, get_apk_item, list_apk_items, touch_apk_item
from app.config import (
    API_KEY,
    AUTH_ENABLED,
    FRONTEND_PUBLIC_DIR,
    HOST,
    MOD_UPLOAD_DIR,
    PORT,
    ensure_runtime_dirs,
)
from app.file_patch_service import parse_file_patches_input, read_editable_file
from app.models import ApkInfo, ModPayload
from app.task_store import create_task, get_task, list_tasks, log_task
from app.toolchain import get_toolchain_status
from app.unity_config_service import parse_unity_patches_input, read_unity_config
from app.validators import to_safe_file_stem


logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('apk-modder')
MAX_TREE_NODES = 5000
MAX_FILE_READ_BYTES = 512 * 1024


def ok(data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status, content={'success': True, 'data': data})


def fail(status: int, message: str, code: str | None = None, details: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={'success': False, 'error': {'message': message, 'code': code, 'details': details}},
    )


def extract_token(request: Request) -> str:
    auth = request.headers.get('authorization', '')
    if auth.lower().startswith('bearer '):
        return auth[7:].strip()

    key_header = request.headers.get('x-api-key', '').strip()
    if key_header:
        return key_header

    query_key = request.query_params.get('api_key', '').strip()
    return query_key


def require_auth(request: Request) -> None:
    if not AUTH_ENABLED or not API_KEY:
        return

    incoming = extract_token(request)
    if not incoming or not hmac.compare_digest(incoming, API_KEY):
        raise HTTPException(status_code=401, detail='Unauthorized')


def _run_in_background(fn, *args) -> None:  # noqa: ANN001
    th = threading.Thread(target=fn, args=args, daemon=True)
    th.start()


def _get_decoded_root_or_raise(task_id: str) -> Path:
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail='Task not found')
    if not task.decodedDir:
        raise HTTPException(status_code=400, detail='Task is not ready, decompile first')
    decoded_root = Path(task.decodedDir)
    if not decoded_root.exists() or not decoded_root.is_dir():
        raise HTTPException(status_code=400, detail='Task is not ready, decompile first')
    return decoded_root


def _normalize_rel_path(raw_path: str) -> str:
    cleaned = (raw_path or '').replace('\\', '/').strip()
    if not cleaned:
        return ''
    if cleaned.startswith('/'):
        raise HTTPException(status_code=400, detail='Invalid path')
    parts = [part for part in cleaned.split('/') if part and part != '.']
    if any(part == '..' for part in parts):
        raise HTTPException(status_code=400, detail='Invalid path')
    return '/'.join(parts)


def _safe_join_decoded(decoded_root: Path, rel_path: str) -> Path:
    normalized = _normalize_rel_path(rel_path)
    target = (decoded_root / normalized).resolve()
    try:
        target.relative_to(decoded_root.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Invalid path') from exc
    return target


def _build_tree_node(base_root: Path, current: Path, counter: list[int]) -> dict[str, Any]:
    counter[0] += 1
    if counter[0] > MAX_TREE_NODES:
        raise HTTPException(status_code=400, detail=f'Too many files (>{MAX_TREE_NODES})')

    rel_path = '' if current == base_root else str(current.relative_to(base_root)).replace('\\', '/')
    if current.is_dir():
        children = sorted(current.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        return {
            'name': current.name,
            'path': rel_path,
            'type': 'dir',
            'children': [_build_tree_node(base_root, child, counter) for child in children],
        }

    return {'name': current.name, 'path': rel_path, 'type': 'file', 'size': current.stat().st_size}


def _start_task_from_library_item(item: dict[str, Any]) -> dict[str, Any]:
    file_path = Path(str(item.get('filePath') or ''))
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail='APK file is missing from storage')

    item_id = str(item.get('id') or '')
    task = create_task(str(file_path), str(item.get('name') or file_path.name), library_item_id=item_id)
    touched = touch_apk_item(item_id)
    if touched:
        item = touched

    parsed_ready = bool(item.get('parsedReady'))
    cache_path_raw = str(item.get('decodeCachePath') or '')
    cache_path = Path(cache_path_raw) if cache_path_raw else None
    cache_hit = bool(parsed_ready and cache_path and cache_path.exists() and cache_path.is_dir())

    if cache_hit and cache_path:
        decoded_dir = Path(task.workDir) / 'decoded'
        decoded_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(cache_path, decoded_dir)
        task.decodedDir = str(decoded_dir)
        apk_info = item.get('apkInfo')
        if isinstance(apk_info, dict):
            task.apkInfo = ApkInfo(
                appName=str(apk_info.get('appName') or ''),
                packageName=str(apk_info.get('packageName') or ''),
                versionName=str(apk_info.get('versionName') or ''),
                versionCode=str(apk_info.get('versionCode') or ''),
                appLabelRaw=str(apk_info.get('appLabelRaw') or ''),
                iconRef=str(apk_info.get('iconRef') or ''),
                iconUrl=None,
            )
            _attach_cached_icon_for_task(task)
        task.status = 'success'
        log_task(task, 'Loaded decoded cache from APK library (skip decompile)')
    else:
        _run_in_background(run_decompile_task, task)

    return {
        'id': task.id,
        'status': task.status,
        'createdAt': task.createdAt,
        'cacheHit': cache_hit,
        'libraryItem': item,
    }


def _attach_cached_icon_for_task(task) -> None:
    if not task.decodedDir or not task.apkInfo:
        return

    icon_ref = str(task.apkInfo.iconRef or '').strip()
    if not icon_ref.startswith('@') or '/' not in icon_ref:
        task.iconFilePath = None
        task.apkInfo.iconUrl = None
        return

    clean = icon_ref[1:]
    res_type, res_name = clean.split('/', 1)
    if not res_type or not res_name:
        task.iconFilePath = None
        task.apkInfo.iconUrl = None
        return

    res_root = Path(task.decodedDir) / 'res'
    if not res_root.exists() or not res_root.is_dir():
        task.iconFilePath = None
        task.apkInfo.iconUrl = None
        return

    density_rank = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'anydpi']
    candidates: list[Path] = []
    for folder in res_root.iterdir():
        if not folder.is_dir():
            continue
        if folder.name != res_type and not folder.name.startswith(f'{res_type}-'):
            continue
        for child in folder.iterdir():
            if child.stem == res_name and child.suffix.lower() in {'.png', '.webp', '.jpg', '.jpeg'}:
                candidates.append(child)

    if not candidates:
        task.iconFilePath = None
        task.apkInfo.iconUrl = None
        return

    def _score(p: Path) -> int:
        directory = p.parent.name
        for idx, key in enumerate(density_rank):
            if key in directory:
                return idx
        return len(density_rank)

    candidates.sort(key=_score)
    chosen = candidates[0]
    task.iconFilePath = str(chosen)
    # Always bind icon URL to current task id to avoid stale library-cached task ids.
    task.apkInfo.iconUrl = f'/api/icon/{task.id}?v={int(chosen.stat().st_mtime)}'


ensure_runtime_dirs()

app = FastAPI(title='APK Modder API', docs_url='/api-docs', redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])


@app.middleware('http')
async def log_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
    logger.info('request method=%s path=%s', request.method, request.url.path)
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    code = 'UNAUTHORIZED' if exc.status_code == 401 else ('NOT_FOUND' if exc.status_code == 404 else 'BAD_REQUEST')
    return fail(exc.status_code, str(exc.detail), code=code)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return fail(400, 'Bad request', code='BAD_REQUEST', details=exc.errors())


@app.exception_handler(Exception)
async def generic_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    return fail(500, str(exc), code='INTERNAL_ERROR')


@app.get('/health')
async def health() -> JSONResponse:
    return ok({'ok': True, 'service': 'backend'})


@app.get('/api/tools')
async def api_tools() -> JSONResponse:
    return ok(get_toolchain_status())


@app.post('/api/upload')
async def api_upload(apk: UploadFile | None = File(default=None)) -> JSONResponse:
    if not apk:
        return fail(400, 'Missing apk file field "apk"', code='BAD_REQUEST')

    payload = apk.file.read()
    item, created = add_or_get_apk_item(apk.filename or 'uploaded.apk', payload)
    result = _start_task_from_library_item(item)
    result['deduplicatedUpload'] = not created
    return ok(result)


@app.get('/api/library/apks')
async def api_library_list() -> JSONResponse:
    return ok({'items': list_apk_items()})


@app.post('/api/library/use')
async def api_library_use(payload: dict[str, Any]) -> JSONResponse:
    item_id = str(payload.get('id') or '').strip()
    if not item_id:
        return fail(400, 'Missing apk library id', code='BAD_REQUEST')

    item = get_apk_item(item_id)
    if not item:
        return fail(404, 'APK not found in library', code='NOT_FOUND')
    return ok(_start_task_from_library_item(item))


@app.delete('/api/library/apks/{item_id}')
async def api_library_delete(item_id: str) -> JSONResponse:
    if not delete_apk_item(item_id):
        return fail(404, 'APK not found in library', code='NOT_FOUND')
    return ok({'deleted': True, 'id': item_id})


@app.get('/api/status/{task_id}')
async def api_status(task_id: str) -> JSONResponse:
    task = get_task(task_id)
    if not task:
        return fail(404, 'Task not found', code='NOT_FOUND')

    return ok(
        {
            'id': task.id,
            'sourceName': task.sourceName,
            'status': task.status,
            'createdAt': task.createdAt,
            'updatedAt': task.updatedAt,
            'logs': task.logs,
            'error': task.error,
            'downloadReady': bool(task.signedApkPath and task.status == 'success'),
            'apkInfo': task.apkInfo.__dict__ if task.apkInfo else None,
        }
    )


@app.get('/api/tasks')
async def api_tasks() -> JSONResponse:
    items = []
    for task in list_tasks():
        items.append(
            {
                'id': task.id,
                'sourceName': task.sourceName,
                'status': task.status,
                'createdAt': task.createdAt,
                'updatedAt': task.updatedAt,
                'error': task.error,
                'downloadReady': bool(task.signedApkPath and task.status == 'success'),
                'apkInfo': task.apkInfo.__dict__ if task.apkInfo else None,
            }
        )
    return ok({'items': items})


@app.get('/api/icon/{task_id}')
async def api_icon(task_id: str) -> FileResponse:
    task = get_task(task_id)
    if not task or not task.iconFilePath or not Path(task.iconFilePath).exists():
        raise HTTPException(status_code=404, detail='Icon not found')
    return FileResponse(task.iconFilePath)


@app.get('/api/unity-config/{task_id}')
async def api_unity_config(task_id: str, path: str | None = None) -> JSONResponse:
    task = get_task(task_id)
    if not task:
        return fail(404, 'Task not found', code='NOT_FOUND')
    try:
        return ok(read_unity_config(task, path))
    except Exception as exc:  # noqa: BLE001
        return fail(400, str(exc), code='BAD_REQUEST')


@app.get('/api/edit-file/{task_id}')
async def api_edit_file(task_id: str, path: str) -> JSONResponse:
    task = get_task(task_id)
    if not task:
        return fail(404, 'Task not found', code='NOT_FOUND')
    try:
        return ok(read_editable_file(task, path))
    except Exception as exc:  # noqa: BLE001
        return fail(400, str(exc), code='BAD_REQUEST')


@app.get('/api/files/{task_id}/tree')
async def api_files_tree(task_id: str) -> JSONResponse:
    decoded_root = _get_decoded_root_or_raise(task_id)
    counter = [0]
    tree = _build_tree_node(decoded_root, decoded_root, counter)
    return ok({'taskId': task_id, 'rootName': decoded_root.name, 'tree': tree})


@app.get('/api/files/{task_id}/content')
async def api_file_content(task_id: str, path: str) -> JSONResponse:
    decoded_root = _get_decoded_root_or_raise(task_id)
    file_path = _safe_join_decoded(decoded_root, path)
    if not file_path.exists():
        return fail(404, 'File not found', code='NOT_FOUND')
    if file_path.is_dir():
        return fail(400, 'Path is a directory', code='BAD_REQUEST')

    blob = file_path.read_bytes()
    total_size = len(blob)
    truncated = total_size > MAX_FILE_READ_BYTES
    preview = blob[:MAX_FILE_READ_BYTES]
    mime, _ = mimetypes.guess_type(file_path.name)
    looks_binary = b'\x00' in preview

    if looks_binary:
        content = base64.b64encode(preview).decode('ascii')
        return ok(
            {
                'taskId': task_id,
                'path': _normalize_rel_path(path),
                'name': file_path.name,
                'mime': mime or 'application/octet-stream',
                'size': total_size,
                'truncated': truncated,
                'encoding': 'base64',
                'kind': 'binary',
                'content': content,
            }
        )

    text = preview.decode('utf-8', errors='replace')
    return ok(
        {
            'taskId': task_id,
            'path': _normalize_rel_path(path),
            'name': file_path.name,
            'mime': mime or 'text/plain',
            'size': total_size,
            'truncated': truncated,
            'encoding': 'utf-8',
            'kind': 'text',
            'content': text,
        }
    )


@app.post('/api/mod')
async def api_mod(
    request: Request,
    id: str = Form(default=''),
    appName: str = Form(default=''),
    packageName: str = Form(default=''),
    versionName: str = Form(default=''),
    versionCode: str = Form(default=''),
    unityConfigPath: str = Form(default=''),
    unityPatches: str = Form(default=''),
    filePatches: str = Form(default=''),
    icon: UploadFile | None = File(default=None),
    _auth: None = Depends(require_auth),
) -> JSONResponse:
    del request
    task_id = id.strip()
    if not task_id:
        return fail(400, 'Missing task id', code='BAD_REQUEST')

    task = get_task(task_id)
    if not task:
        return fail(404, 'Task not found', code='NOT_FOUND')
    if task.status == 'processing':
        return fail(409, 'Task is still processing', code='CONFLICT')
    if not task.decodedDir or not Path(task.decodedDir).exists():
        return fail(400, 'Task is not ready for mod, decompile first', code='BAD_REQUEST')

    parsed_unity_patches = []
    parsed_file_patches = []
    try:
        parsed_unity_patches = parse_unity_patches_input(unityPatches)
        parsed_file_patches = parse_file_patches_input(filePatches)
    except Exception as exc:  # noqa: BLE001
        return fail(400, str(exc), code='BAD_REQUEST')

    icon_upload_path: str | None = None
    if icon:
        icon_ext = Path(icon.filename or '').suffix.lower()
        if icon_ext not in {'.png', '.webp', '.jpg', '.jpeg'}:
            return fail(400, 'Icon format must be one of: .png, .webp, .jpg, .jpeg', code='BAD_REQUEST')
        temp_path = MOD_UPLOAD_DIR / f'{uuid.uuid4().hex}{icon_ext or ".png"}'
        with temp_path.open('wb') as out:
            shutil.copyfileobj(icon.file, out)
        icon_upload_path = str(temp_path)

    app_name = appName.strip() or None
    package_name = packageName.strip() or None
    version_name = versionName.strip() or None
    version_code = versionCode.strip() or None
    unity_config_path = unityConfigPath.strip() or None

    if not any([app_name, package_name, version_name, version_code, icon_upload_path, parsed_unity_patches, parsed_file_patches]):
        return fail(
            400,
            'At least one field is required: appName, packageName, versionName, versionCode, icon, unityPatches, filePatches',
            code='BAD_REQUEST',
        )

    task.logs.append('')
    log_task(task, 'Queue mod workflow')
    payload = ModPayload(
        appName=app_name,
        packageName=package_name,
        versionName=version_name,
        versionCode=version_code,
        iconUploadPath=icon_upload_path,
        unityConfigPath=unity_config_path,
        unityPatches=parsed_unity_patches,
        filePatches=parsed_file_patches,
    )
    _run_in_background(run_mod_task, task, payload)
    return ok({'id': task.id, 'status': task.status})


@app.get('/api/download/{task_id}')
async def api_download(task_id: str, _auth: None = Depends(require_auth)) -> FileResponse:
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail='Task not found')

    if not task.signedApkPath or not Path(task.signedApkPath).exists() or task.status != 'success':
        raise HTTPException(status_code=404, detail='Signed apk is not ready')

    app_name = (task.apkInfo.appName if task.apkInfo else '').strip()
    stem = to_safe_file_stem(app_name) if app_name else f'modded-{task.id}'
    download_name = f'{stem}.apk'
    return FileResponse(task.signedApkPath, media_type='application/vnd.android.package-archive', filename=download_name)


@app.get('/{full_path:path}', response_model=None)
async def static_spa(full_path: str) -> Response:
    if full_path.startswith('api'):
        return fail(404, f'Route not found: GET /{full_path}', code='NOT_FOUND')

    base = FRONTEND_PUBLIC_DIR
    if not base.exists():
        return fail(404, 'Route not found', code='NOT_FOUND')

    if not full_path or full_path == '/':
        return FileResponse(base / 'index.html')

    target = (base / full_path).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        return fail(404, 'Route not found', code='NOT_FOUND')

    if target.exists() and target.is_file():
        return FileResponse(target)

    return FileResponse(base / 'index.html')


if __name__ == '__main__':
    uvicorn.run('main:app', host=HOST, port=PORT, reload=False)
