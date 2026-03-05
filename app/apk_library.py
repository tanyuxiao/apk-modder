from __future__ import annotations

import hashlib
import json
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any

from app.config import APK_LIBRARY_CACHE_ROOT, APK_LIBRARY_DIR, APK_LIBRARY_INDEX_PATH
from app.task_store import now_iso

_LOCK = threading.RLock()


def _ensure_store_ready() -> None:
    APK_LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    APK_LIBRARY_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    if not APK_LIBRARY_INDEX_PATH.exists():
        APK_LIBRARY_INDEX_PATH.write_text('[]\n', encoding='utf-8')


def _read_items() -> list[dict[str, Any]]:
    _ensure_store_ready()
    try:
        raw = json.loads(APK_LIBRARY_INDEX_PATH.read_text(encoding='utf-8'))
    except json.JSONDecodeError:
        raw = []
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _write_items(items: list[dict[str, Any]]) -> None:
    _ensure_store_ready()
    APK_LIBRARY_INDEX_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def _safe_filename(name: str) -> str:
    cleaned = ''.join(ch if ch not in '/\\:*?"<>|' else '-' for ch in name.strip())
    cleaned = ' '.join(cleaned.split())
    return cleaned or 'uploaded.apk'


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as fp:
        while True:
            chunk = fp.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def cache_dir_for_item(item: dict[str, Any]) -> Path:
    return APK_LIBRARY_CACHE_ROOT / str(item.get('id') or '')


def list_apk_items() -> list[dict[str, Any]]:
    with _LOCK:
        items = _read_items()
        return sorted(items, key=lambda x: str(x.get('lastUsedAt') or x.get('createdAt') or ''), reverse=True)


def get_apk_item(item_id: str) -> dict[str, Any] | None:
    with _LOCK:
        items = _read_items()
        for item in items:
            if str(item.get('id')) == item_id:
                return item
    return None


def add_or_get_apk_item(original_name: str, data: bytes) -> tuple[dict[str, Any], bool]:
    digest = _sha256(data)
    created_at = now_iso()
    display_name = _safe_filename(original_name or 'uploaded.apk')

    with _LOCK:
        items = _read_items()
        changed = False
        for item in items:
            if item.get('sha256'):
                continue
            file_path = Path(str(item.get('filePath') or ''))
            if file_path.exists() and file_path.is_file():
                item['sha256'] = _sha256_file(file_path)
                changed = True
        if changed:
            _write_items(items)

        for item in items:
            if str(item.get('sha256') or '') == digest:
                item['lastUsedAt'] = created_at
                if display_name and display_name != item.get('name'):
                    item['name'] = display_name
                _write_items(items)
                return item, False

        file_id = str(uuid.uuid4())
        suffix = Path(display_name).suffix or '.apk'
        store_name = f'{file_id}{suffix.lower() or ".apk"}'
        store_path = APK_LIBRARY_DIR / store_name
        store_path.write_bytes(data)

        item = {
            'id': file_id,
            'name': display_name,
            'storedName': store_name,
            'filePath': str(store_path),
            'size': len(data),
            'sha256': digest,
            'createdAt': created_at,
            'lastUsedAt': created_at,
            'parsedReady': False,
            'decodeCachePath': None,
            'apkInfo': None,
        }
        items.append(item)
        _write_items(items)
        return item, True


def touch_apk_item(item_id: str) -> dict[str, Any] | None:
    with _LOCK:
        items = _read_items()
        for item in items:
            if str(item.get('id')) == item_id:
                item['lastUsedAt'] = now_iso()
                _write_items(items)
                return item
    return None


def update_parse_cache(item_id: str, decoded_dir: str, apk_info: dict[str, Any] | None) -> dict[str, Any] | None:
    source_dir = Path(decoded_dir)
    if not source_dir.exists() or not source_dir.is_dir():
        return None

    with _LOCK:
        items = _read_items()
        target_item: dict[str, Any] | None = None
        for item in items:
            if str(item.get('id')) == item_id:
                target_item = item
                break

        if not target_item:
            return None

        cache_dir = cache_dir_for_item(target_item)
        cache_decoded_dir = cache_dir / 'decoded'
        if cache_decoded_dir.exists():
            shutil.rmtree(cache_decoded_dir, ignore_errors=True)
        cache_decoded_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source_dir, cache_decoded_dir)

        target_item['parsedReady'] = True
        target_item['decodeCachePath'] = str(cache_decoded_dir)
        target_item['apkInfo'] = apk_info
        target_item['lastUsedAt'] = now_iso()
        _write_items(items)
        return target_item


def delete_apk_item(item_id: str) -> bool:
    with _LOCK:
        items = _read_items()
        kept: list[dict[str, Any]] = []
        removed: dict[str, Any] | None = None
        for item in items:
            if str(item.get('id')) == item_id:
                removed = item
            else:
                kept.append(item)

        if not removed:
            return False

        file_path = Path(str(removed.get('filePath') or ''))
        if file_path.exists() and file_path.is_file():
            file_path.unlink(missing_ok=True)

        cache_dir = cache_dir_for_item(removed)
        if cache_dir.exists() and cache_dir.is_dir():
            shutil.rmtree(cache_dir, ignore_errors=True)

        _write_items(kept)
        return True
