from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

from app.models import FilePatch, ModPayload, Task
from app.task_store import log_task

SAFE_TEXT_EXTENSIONS = {
    '.json',
    '.xml',
    '.txt',
    '.yml',
    '.yaml',
    '.properties',
    '.csv',
    '.md',
    '.ini',
    '.cfg',
    '.conf',
    '.smali',
    '.gradle',
    '.pro',
    '.js',
    '.ts',
    '.css',
    '.html',
    '.kt',
    '.java',
    '.sh',
    '.toml',
    '.sql',
    '.tsv',
    '.log',
    '.manifest',
    '.meta',
    '.bytes',
}

BASIC_RESOURCE_EXTENSIONS = {
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',
    '.bmp',
    '.svg',
    '.ico',
    '.mp3',
    '.wav',
    '.ogg',
    '.m4a',
    '.aac',
    '.flac',
    '.mp4',
    '.webm',
    '.ttf',
    '.otf',
    '.woff',
    '.woff2',
    '.ttc',
    '.fnt',
    '.atlas',
    '.dat',
    '.bin',
    '.bytes',
    '.dex',
    '.so',
    '.arsc',
    '.pak',
    '.obb',
    '.assetbundle',
}

SAFE_REPLACE_EXTENSIONS = SAFE_TEXT_EXTENSIONS | BASIC_RESOURCE_EXTENSIONS

SAFE_REPLACE_EXTENSIONS = SAFE_REPLACE_EXTENSIONS | {
    # Unity / Android 常见资源与配置二进制容器
    '.assets',
    '.resource',
    '.unity3d',
}

PATCH_MODES = {'direct_edit', 'text_replace', 'file_replace'}
MAX_EDIT_FILE_BYTES = 2 * 1024 * 1024
MAX_REPLACE_FILE_BYTES = 20 * 1024 * 1024


def _normalize_rel_path(raw_path: str) -> str:
    cleaned = (raw_path or '').replace('\\', '/').strip()
    if not cleaned or cleaned.startswith('/'):
        raise RuntimeError('Invalid file path')
    parts = [part for part in cleaned.split('/') if part and part != '.']
    if any(part == '..' for part in parts):
        raise RuntimeError('Invalid file path')
    return '/'.join(parts)


def _safe_target(decoded_dir: str, rel_path: str) -> Path:
    base = Path(decoded_dir).resolve()
    normalized = _normalize_rel_path(rel_path)
    target = (base / normalized).resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise RuntimeError('Invalid file path') from exc
    return target


def _build_path_candidates(raw_path: str) -> list[str]:
    normalized = _normalize_rel_path(raw_path)
    candidates: list[str] = []

    def _push(item: str) -> None:
        if item and item not in candidates:
            candidates.append(item)

    _push(normalized)
    low = normalized.lower()

    if low.startswith('assets/streamingassets/'):
        tail = normalized.split('/', 2)[2]
        _push(f'Assets/StreamingAssets/{tail}')
        _push(f'assets/StreamingAssets/{tail}')
        _push(f'assets/bin/Data/StreamingAssets/{tail}')
        _push(f'assets/{tail}')
    elif low.startswith('assets/bin/data/streamingassets/'):
        tail = normalized.split('/', 4)[4]
        _push(f'Assets/StreamingAssets/{tail}')
        _push(f'assets/StreamingAssets/{tail}')
        _push(f'StreamingAssets/{tail}')
        _push(f'assets/{tail}')
    elif low.startswith('assets/'):
        tail = normalized[len('assets/') :]
        _push(f'Assets/{tail}')

    if low.startswith('streamingassets/'):
        tail = normalized.split('/', 1)[1]
        _push(f'Assets/StreamingAssets/{tail}')
        _push(f'assets/StreamingAssets/{tail}')
        _push(f'assets/bin/Data/StreamingAssets/{tail}')
        _push(f'assets/{tail}')

    return candidates


def _resolve_existing_target(decoded_dir: str, raw_path: str) -> tuple[Path, str]:
    for candidate in _build_path_candidates(raw_path):
        target = _safe_target(decoded_dir, candidate)
        if target.exists() and target.is_file():
            return target, candidate
    raise RuntimeError('File not found')


def _is_text_editable(target: Path) -> bool:
    return target.suffix.lower() in SAFE_TEXT_EXTENSIONS and target.stat().st_size <= MAX_EDIT_FILE_BYTES


def _ensure_replaceable_file(target: Path) -> None:
    ext = target.suffix.lower()
    if ext not in SAFE_REPLACE_EXTENSIONS:
        raise RuntimeError('Unsupported file type for replacement')


def read_editable_file(task: Task, req_path: str) -> dict[str, Any]:
    if not task.decodedDir or not Path(task.decodedDir).exists():
        raise RuntimeError('Task is not ready, decompile first')

    target, rel_path = _resolve_existing_target(task.decodedDir, req_path)
    _ensure_replaceable_file(target)

    editable = _is_text_editable(target)
    content = ''
    if editable:
        content = target.read_text(encoding='utf-8', errors='replace')

    return {
        'path': rel_path,
        'ext': target.suffix.lower(),
        'size': target.stat().st_size,
        'editable': editable,
        'replaceable': True,
        'content': content,
        'safeEditTypes': sorted(SAFE_TEXT_EXTENSIONS),
        'safeReplaceTypes': sorted(SAFE_REPLACE_EXTENSIONS),
    }


def parse_file_patches_input(raw: Any) -> list[FilePatch]:
    if not raw:
        return []

    parsed = raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError('filePatches must be valid JSON') from exc

    if not isinstance(parsed, list):
        raise RuntimeError('filePatches must be an array')

    result: list[FilePatch] = []
    for idx, item in enumerate(parsed):
        if not isinstance(item, dict):
            raise RuntimeError(f'filePatches[{idx}] must be an object')

        path = str(item.get('path') or '').strip()
        mode = str(item.get('mode') or '').strip()
        if not path:
            raise RuntimeError(f'filePatches[{idx}].path is required')
        if mode not in PATCH_MODES:
            raise RuntimeError(f'filePatches[{idx}].mode must be one of: {", ".join(sorted(PATCH_MODES))}')

        patch = FilePatch(
            path=path,
            mode=mode,
            content=item.get('content') if isinstance(item.get('content'), str) else None,
            matchText=item.get('matchText') if isinstance(item.get('matchText'), str) else None,
            replaceText=item.get('replaceText') if isinstance(item.get('replaceText'), str) else None,
            regex=bool(item.get('regex', False)),
            replacementBase64=item.get('replacementBase64') if isinstance(item.get('replacementBase64'), str) else None,
        )

        if mode == 'direct_edit' and patch.content is None:
            raise RuntimeError(f'filePatches[{idx}].content is required for direct_edit')
        if mode == 'text_replace' and (patch.matchText is None or patch.replaceText is None):
            raise RuntimeError(f'filePatches[{idx}].matchText and replaceText are required for text_replace')
        if mode == 'file_replace' and not patch.replacementBase64:
            raise RuntimeError(f'filePatches[{idx}].replacementBase64 is required for file_replace')

        result.append(patch)

    return result


def _apply_direct_edit(target: Path, patch: FilePatch) -> None:
    if not _is_text_editable(target):
        raise RuntimeError('File type is not editable by text mode')
    target.write_text(patch.content or '', encoding='utf-8')


def _apply_text_replace(target: Path, patch: FilePatch) -> None:
    if not _is_text_editable(target):
        raise RuntimeError('File type is not editable by text mode')

    text = target.read_text(encoding='utf-8', errors='replace')
    match_text = patch.matchText or ''
    replace_text = patch.replaceText or ''
    if patch.regex:
        try:
            new_text, count = re.subn(match_text, replace_text, text)
        except re.error as exc:
            raise RuntimeError(f'Invalid regex: {exc}') from exc
    else:
        count = text.count(match_text)
        new_text = text.replace(match_text, replace_text)

    if count == 0:
        raise RuntimeError('No matched text found')

    target.write_text(new_text, encoding='utf-8')


def _apply_file_replace(target: Path, patch: FilePatch) -> None:
    _ensure_replaceable_file(target)
    raw = base64.b64decode(patch.replacementBase64 or '', validate=True)
    if len(raw) > MAX_REPLACE_FILE_BYTES:
        raise RuntimeError(f'Replacement file too large (> {MAX_REPLACE_FILE_BYTES} bytes)')
    target.write_bytes(raw)


def apply_file_patches(task: Task, payload: ModPayload) -> None:
    patches = payload.filePatches or []
    if not patches:
        return

    if not task.decodedDir or not Path(task.decodedDir).exists():
        raise RuntimeError('Task is not ready, decompile first')

    for patch in patches:
        target, rel_path = _resolve_existing_target(task.decodedDir, patch.path)
        if patch.mode == 'direct_edit':
            _apply_direct_edit(target, patch)
        elif patch.mode == 'text_replace':
            _apply_text_replace(target, patch)
        elif patch.mode == 'file_replace':
            _apply_file_replace(target, patch)
        else:
            raise RuntimeError('Unsupported patch mode')

        log_task(task, f'File patch applied: {rel_path} ({patch.mode})')
