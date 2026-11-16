"""
ABDShared — Shared AI Model Store & Cross-App Workspace Manager.

Manages the unified on-disk directory where neural model weights are stored,
verified via per-model manifests (< 1 ms startup check), downloaded safely
with SSRF allowlist protections, and shared across all ABDSynths apps.

Security notes:
  - Uses pure Python stdlib only.
  - Never invokes shell=True or os.system.
  - Download URLs are restricted to HTTPS and allowlisted model hosts with
    private-IP DNS/redirect validation.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

MODULE_DIR = Path(__file__).resolve().parent
CATALOG_PATH = MODULE_DIR / "modelCatalog.json"

ALLOWED_MODEL_DOWNLOAD_HOSTS = {
    "dl.fbaipublicfiles.com",
    "raw.githubusercontent.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs-us-1.huggingface.co",
    "cdn-lfs-eu-1.huggingface.co",
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_catalog() -> dict[str, Any]:
    with CATALOG_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def get_workspace_settings_path() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config"))
    return base / "ABDSynths" / "workspace_settings.json"


def load_workspace_settings() -> dict[str, Any]:
    cfg_path = get_workspace_settings_path()
    if cfg_path.is_file():
        try:
            with cfg_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {"schemaVersion": 1, "modelsRoot": "", "urlOverrides": {}}


def save_workspace_settings(settings: dict[str, Any]) -> None:
    cfg_path = get_workspace_settings_path()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": 1,
        "modelsRoot": str(settings.get("modelsRoot", "") or ""),
        "urlOverrides": dict(settings.get("urlOverrides") or {}),
        "updatedAt": _utc_now_iso(),
    }
    tmp_path = cfg_path.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    tmp_path.replace(cfg_path)


def _find_dev_resources_dir() -> Path | None:
    for parent in [MODULE_DIR, *MODULE_DIR.parents]:
        candidate = parent / "_RESOURCES"
        if candidate.is_dir():
            return candidate / "AIModels"
    return None


def resolve_models_root() -> tuple[Path, str]:
    env_override = (os.environ.get("ABDSYNTHS_MODELS_DIR") or "").strip()
    if env_override:
        return Path(os.path.expandvars(os.path.expanduser(env_override))).resolve(), "env"

    settings = load_workspace_settings()
    custom_root = str(settings.get("modelsRoot") or "").strip()
    if custom_root:
        return Path(os.path.expandvars(os.path.expanduser(custom_root))).resolve(), "custom"

    dev_res = _find_dev_resources_dir()
    if dev_res is not None:
        return dev_res.resolve(), "dev_resources"

    return (Path.home() / "Documents" / "ABDSynths" / "Models").resolve(), "default_documents"


def _is_writable_dir(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".abd_write_probe_{os.getpid()}"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except Exception:
        return False


def get_workdir_info() -> dict[str, Any]:
    root, source = resolve_models_root()
    exists = root.is_dir()
    writable = _is_writable_dir(root) if exists else _is_writable_dir(root)
    free_gb: float | None = None
    try:
        usage = shutil.disk_usage(root if root.exists() else root.parent)
        free_gb = round(usage.free / (1024**3), 2)
    except Exception:
        free_gb = None

    return {
        "models_root": str(root),
        "source": source,
        "settings_file": str(get_workspace_settings_path()),
        "exists": root.is_dir(),
        "writable": writable,
        "free_gb": free_gb,
    }


def _model_file_and_manifest(root: Path, model_id: str, filename: str) -> tuple[Path, Path]:
    folder = root / model_id
    return folder / filename, folder / "model_manifest.json"


def _sha256_file(file_path: Path) -> str:
    h = hashlib.sha256()
    with file_path.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _write_manifest(model_id: str, file_path: Path, manifest_path: Path, compute_hash: bool = True) -> dict[str, Any]:
    st = file_path.stat()
    manifest = {
        "model_id": model_id,
        "filename": file_path.name,
        "size_bytes": st.st_size,
        "mtime_ns": st.st_mtime_ns,
        "sha256": _sha256_file(file_path) if compute_hash else "",
        "verified_at": _utc_now_iso(),
    }
    tmp = manifest_path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    tmp.replace(manifest_path)
    return manifest


def check_model_installed(model_id: str, meta: dict[str, Any], root: Path | None = None) -> tuple[bool, int]:
    """Fast < 1 ms presence & size check using per-model manifest."""
    active_root = root or resolve_models_root()[0]
    file_path, manifest_path = _model_file_and_manifest(active_root, model_id, meta["filename"])
    if not file_path.is_file():
        return False, 0

    try:
        size_bytes = file_path.stat().st_size
    except OSError:
        return False, 0

    if size_bytes <= 1024:
        return False, 0

    if manifest_path.is_file():
        try:
            with manifest_path.open("r", encoding="utf-8") as fh:
                manifest = json.load(fh)
            if int(manifest.get("size_bytes", -1)) == size_bytes:
                return True, size_bytes
        except Exception:
            pass

    # File exists on disk (> 1 KB) without an up-to-date manifest: record manifest once.
    try:
        _write_manifest(model_id, file_path, manifest_path, compute_hash=True)
    except Exception:
        pass
    return True, size_bytes


def _is_forbidden_root_path(path: Path) -> bool:
    return path == path.parent


def set_models_root(
    new_path: str,
    create_if_missing: bool = True,
    migrate_existing: bool = True,
) -> dict[str, Any]:
    raw = (new_path or "").strip()
    if not raw:
        raise ValueError("La ruta no puede estar vacía.")

    target = Path(os.path.expandvars(os.path.expanduser(raw))).resolve()
    if _is_forbidden_root_path(target):
        raise ValueError("Por seguridad no se permite usar la raíz de la unidad como carpeta de modelos.")

    old_root, _ = resolve_models_root()
    if create_if_missing:
        target.mkdir(parents=True, exist_ok=True)
    elif not target.is_dir():
        raise ValueError(f"La carpeta no existe: {target}")

    if not _is_writable_dir(target):
        raise ValueError(f"Sin permisos de escritura en: {target}")

    if migrate_existing and old_root.is_dir() and old_root != target:
        catalog = load_catalog()
        for model_id in catalog.get("models", {}):
            src_folder = old_root / model_id
            if src_folder.is_dir():
                dst_folder = target / model_id
                dst_folder.mkdir(parents=True, exist_ok=True)
                for item in src_folder.iterdir():
                    dst_item = dst_folder / item.name
                    if item.is_file() and not dst_item.exists():
                        shutil.copy2(item, dst_item)

    settings = load_workspace_settings()
    settings["modelsRoot"] = str(target)
    save_workspace_settings(settings)
    return get_workdir_info()


def reset_models_root() -> dict[str, Any]:
    settings = load_workspace_settings()
    settings["modelsRoot"] = ""
    save_workspace_settings(settings)
    return get_workdir_info()


def migrate_legacy_checkpoints(legacy_dir: str | Path) -> dict[str, Any]:
    """Moves/copies legacy flat checkpoint files into per-model subfolders under modelsRoot."""
    src_dir = Path(legacy_dir).resolve()
    root, _ = resolve_models_root()
    root.mkdir(parents=True, exist_ok=True)
    catalog = load_catalog()
    models = catalog.get("models", {})
    legacy_archived = catalog.get("legacy_archived_files", {})

    migrated: list[dict[str, str]] = []
    archived: list[dict[str, str]] = []
    errors: list[str] = []

    if not src_dir.is_dir():
        return {"migrated": migrated, "archived": archived, "errors": errors, "models_root": str(root)}

    # Migrate legacy URL overrides from models_config.json if present
    legacy_cfg = src_dir / "models_config.json"
    if legacy_cfg.is_file():
        try:
            with legacy_cfg.open("r", encoding="utf-8") as fh:
                url_map = json.load(fh)
            if isinstance(url_map, dict) and url_map:
                settings = load_workspace_settings()
                overrides = dict(settings.get("urlOverrides") or {})
                changed = False
                for k, v in url_map.items():
                    if k in models and isinstance(v, str) and v.strip() and k not in overrides:
                        overrides[k] = v.strip()
                        changed = True
                if changed:
                    settings["urlOverrides"] = overrides
                    save_workspace_settings(settings)
        except Exception as exc:
            errors.append(f"models_config.json: {exc}")

    def _transfer_file(src_file: Path, dst_file: Path) -> None:
        dst_file.parent.mkdir(parents=True, exist_ok=True)
        if dst_file.is_file() and dst_file.stat().st_size == src_file.stat().st_size:
            return
        try:
            shutil.move(str(src_file), str(dst_file))
        except Exception:
            shutil.copy2(str(src_file), str(dst_file))

    for model_id, meta in models.items():
        src_file = src_dir / meta["filename"]
        if src_file.is_file() and src_file.stat().st_size > 1024:
            dst_file, manifest_path = _model_file_and_manifest(root, model_id, meta["filename"])
            try:
                _transfer_file(src_file, dst_file)
                _write_manifest(model_id, dst_file, manifest_path, compute_hash=True)
                migrated.append({"model_id": model_id, "dst": str(dst_file)})
            except Exception as exc:
                errors.append(f"{model_id}: {exc}")

    for filename, archive_id in legacy_archived.items():
        src_file = src_dir / filename
        if src_file.is_file() and src_file.stat().st_size > 1024:
            dst_file = root / "_legacy_archive" / archive_id / filename
            try:
                _transfer_file(src_file, dst_file)
                archived.append({"archive_id": archive_id, "dst": str(dst_file)})
            except Exception as exc:
                errors.append(f"{archive_id}: {exc}")

    return {"migrated": migrated, "archived": archived, "errors": errors, "models_root": str(root)}


def validate_download_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        raise ValueError("URL vacía.")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"Solo se permite HTTPS en descargas de modelos (recibido: {parsed.scheme!r}).")
    if parsed.username or parsed.password:
        raise ValueError("No se permiten credenciales embebidas en la URL.")
    host = (parsed.hostname or "").lower().rstrip(".")
    if host not in ALLOWED_MODEL_DOWNLOAD_HOSTS:
        raise ValueError(
            f"Host no permitido para descarga de modelos: {host!r}. "
            f"Permitidos: {', '.join(sorted(ALLOWED_MODEL_DOWNLOAD_HOSTS))}"
        )
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f"No se pudo resolver {host!r}: {exc}") from exc
    if not infos:
        raise ValueError(f"Sin direcciones DNS para {host!r}.")
    for info in infos:
        ip_str = info[4][0].split("%", 1)[0]
        ip = ipaddress.ip_address(ip_str)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError(f"IP reservada/privada rechazada para {host!r}: {ip_str}")
    return url


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        abs_url = urllib.parse.urljoin(req.full_url, newurl)
        validate_download_url(abs_url)
        return super().redirect_request(req, fp, code, msg, headers, abs_url)


def open_validated_url(raw_url: str, method: str = "GET", timeout: int = 30):
    safe = validate_download_url(raw_url)
    opener = urllib.request.build_opener(_SafeRedirectHandler())
    req = urllib.request.Request(safe, headers={"User-Agent": "ABDSynths-ModelStore/1.0"}, method=method)
    return opener.open(req, timeout=timeout)


def get_app_model_registry(app_id: str | None = None) -> dict[str, dict[str, Any]]:
    models = load_catalog().get("models", {})
    if not app_id:
        return dict(models)
    return {mid: meta for mid, meta in models.items() if app_id in (meta.get("used_by") or [])}


def set_model_url_override(model_id: str, new_url: str | None) -> tuple[str, bool]:
    models = load_catalog().get("models", {})
    if model_id not in models:
        raise KeyError(f"Modelo desconocido: {model_id}")

    settings = load_workspace_settings()
    overrides = dict(settings.get("urlOverrides") or {})

    clean = (new_url or "").strip()
    if clean:
        validate_download_url(clean)
        overrides[model_id] = clean
    else:
        overrides.pop(model_id, None)

    settings["urlOverrides"] = overrides
    save_workspace_settings(settings)

    active_url = overrides.get(model_id) or models[model_id]["default_url"]
    return active_url, model_id in overrides


def get_catalog_status(
    app_id: str | None = None,
    active_downloads: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    workdir = get_workdir_info()
    root = Path(workdir["models_root"])
    models = load_catalog().get("models", {})
    settings = load_workspace_settings()
    overrides = dict(settings.get("urlOverrides") or {})
    downloads = active_downloads or {}

    items: list[dict[str, Any]] = []
    for mid, meta in models.items():
        installed, actual_bytes = check_model_installed(mid, meta, root=root)
        active_url = overrides.get(mid) or meta["default_url"]
        dl_state = downloads.get(
            mid,
            {
                "status": "ready" if installed else "missing",
                "progress": 100 if installed else 0,
                "downloaded_bytes": actual_bytes,
                "total_bytes": actual_bytes,
                "speed_mbps": 0.0,
                "error": None,
            },
        )
        folder_path = root / mid
        file_path = folder_path / meta["filename"]
        used_by = list(meta.get("used_by") or [])
        items.append(
            {
                "id": mid,
                "name": meta["name"],
                "filename": meta["filename"],
                "folder_path": str(folder_path),
                "file_path": str(file_path),
                "size_mb": meta["size_mb"],
                "actual_size_mb": round(actual_bytes / (1024 * 1024), 2) if actual_bytes else 0.0,
                "installed": installed,
                "status": dl_state.get("status", "ready" if installed else "missing"),
                "progress": dl_state.get("progress", 100 if installed else 0),
                "error": dl_state.get("error"),
                "url": active_url,
                "default_url": meta["default_url"],
                "is_custom_url": mid in overrides,
                "used_by": used_by,
                "supported_in_app": True if not app_id else (app_id in used_by),
                "inference_wired": bool(meta.get("inference_wired", False)),
                "coming_soon": bool(meta.get("coming_soon", True)),
                "description": meta["description_es"],
                "description_es": meta["description_es"],
                "description_en": meta["description_en"],
                "download_state": dl_state,
            }
        )

    return {"workdir": workdir, "models": items}


def download_model_sync(
    model_id: str,
    progress_cb: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    models = load_catalog().get("models", {})
    if model_id not in models:
        raise KeyError(f"Modelo desconocido: {model_id}")

    meta = models[model_id]
    root, _ = resolve_models_root()
    root.mkdir(parents=True, exist_ok=True)
    file_path, manifest_path = _model_file_and_manifest(root, model_id, meta["filename"])
    file_path.parent.mkdir(parents=True, exist_ok=True)

    settings = load_workspace_settings()
    overrides = dict(settings.get("urlOverrides") or {})
    download_url = overrides.get(model_id) or meta["default_url"]

    temp_path = file_path.with_name(file_path.name + ".part")
    started = time.time()

    with open_validated_url(download_url, method="GET", timeout=30) as response:
        total_bytes = int(response.info().get("Content-Length", 0) or 0)
        downloaded = 0
        with temp_path.open("wb") as out_fh:
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                out_fh.write(chunk)
                downloaded += len(chunk)
                if progress_cb:
                    elapsed = max(time.time() - started, 0.05)
                    speed_mbps = round((downloaded / (1024 * 1024)) / elapsed, 2)
                    pct = int((downloaded * 100) / total_bytes) if total_bytes > 0 else 0
                    progress_cb(
                        {
                            "model_id": model_id,
                            "status": "downloading",
                            "progress": min(99, pct),
                            "downloaded_bytes": downloaded,
                            "total_bytes": total_bytes,
                            "speed_mbps": speed_mbps,
                            "error": None,
                        }
                    )

    if not temp_path.is_file() or temp_path.stat().st_size <= 1024:
        temp_path.unlink(missing_ok=True)
        raise RuntimeError("El archivo descargado está vacío o corrupto.")

    temp_path.replace(file_path)
    manifest = _write_manifest(model_id, file_path, manifest_path, compute_hash=True)
    if progress_cb:
        progress_cb(
            {
                "model_id": model_id,
                "status": "ready",
                "progress": 100,
                "downloaded_bytes": manifest["size_bytes"],
                "total_bytes": manifest["size_bytes"],
                "speed_mbps": 0.0,
                "error": None,
            }
        )
    return {"ok": True, "model_id": model_id, "file_path": str(file_path), "manifest": manifest}


def delete_model(model_id: str) -> dict[str, Any]:
    models = load_catalog().get("models", {})
    if model_id not in models:
        raise KeyError(f"Modelo desconocido: {model_id}")

    meta = models[model_id]
    root, _ = resolve_models_root()
    file_path, manifest_path = _model_file_and_manifest(root, model_id, meta["filename"])
    freed_bytes = 0
    for path in (file_path, manifest_path, file_path.with_name(file_path.name + ".part")):
        if path.is_file():
            try:
                freed_bytes += path.stat().st_size
                path.unlink()
            except OSError:
                pass
    return {"ok": True, "model_id": model_id, "freed_mb": round(freed_bytes / (1024 * 1024), 2)}


def open_in_file_manager(path: str | Path | None = None) -> dict[str, Any]:
    target = Path(path).resolve() if path else resolve_models_root()[0]
    target.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(str(target))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target)])
    return {"ok": True, "path": str(target)}


def browse_folder_dialog(initial_dir: str | None = None) -> str:
    start_dir = str(initial_dir or resolve_models_root()[0])
    if threading.current_thread() is threading.main_thread():
        try:
            import tkinter as tk
            from tkinter import filedialog

            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            chosen = filedialog.askdirectory(
                title="Seleccionar Carpeta Común de Modelos IA (ABDSynths)",
                initialdir=start_dir if os.path.isdir(start_dir) else None,
            )
            root.destroy()
            return chosen or ""
        except Exception:
            return ""

    # Run tkinter safely on a fresh process main thread when called from an HTTP worker thread
    code = (
        "import tkinter as tk, sys; from tkinter import filedialog; "
        "r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True); "
        "print(filedialog.askdirectory(title='Seleccionar Carpeta de Modelos IA (ABDSynths)', "
        "initialdir=sys.argv[1] if len(sys.argv) > 1 else None) or '')"
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", code, start_dir],
            capture_output=True,
            text=True,
            timeout=120,
        )
        return (proc.stdout or "").strip()
    except Exception:
        return ""


def _main() -> int:
    parser = argparse.ArgumentParser(description="ABDSynths Shared AI Model Store CLI")
    parser.add_argument("--app", default=None, help="Optional app filter id (abdaudiolab | abdneumodmakr)")
    parser.add_argument("--status", action="store_true", help="Print JSON catalog & workdir status")
    parser.add_argument("--set-root", default=None, help="Set/create custom shared models directory")
    parser.add_argument("--reset-root", action="store_true", help="Reset custom models directory to default")
    parser.add_argument("--browse-root", action="store_true", help="Open native folder picker and return path")
    parser.add_argument("--open-root", action="store_true", help="Open active models folder in OS explorer")
    parser.add_argument("--migrate", default=None, help="Migrate legacy flat checkpoints folder")
    parser.add_argument("--download", default=None, help="Download model_id into shared store")
    parser.add_argument("--delete", default=None, help="Delete model_id from shared store")
    parser.add_argument("--set-url", nargs=2, metavar=("MODEL_ID", "URL"), default=None, help="Set custom URL")

    args = parser.parse_args()
    try:
        if args.migrate:
            res = migrate_legacy_checkpoints(args.migrate)
            print(json.dumps(res, ensure_ascii=False))
            return 0
        if args.set_root is not None:
            workdir = set_models_root(args.set_root, create_if_missing=True, migrate_existing=True)
            status = get_catalog_status(app_id=args.app)
            status["ok"] = True
            status["workdir"] = workdir
            print(json.dumps(status, ensure_ascii=False))
            return 0
        if args.reset_root:
            workdir = reset_models_root()
            status = get_catalog_status(app_id=args.app)
            status["ok"] = True
            status["workdir"] = workdir
            print(json.dumps(status, ensure_ascii=False))
            return 0
        if args.browse_root:
            chosen = browse_folder_dialog()
            print(json.dumps({"ok": True, "path": chosen}, ensure_ascii=False))
            return 0
        if args.open_root:
            res = open_in_file_manager()
            print(json.dumps(res, ensure_ascii=False))
            return 0
        if args.set_url:
            mid, url_val = args.set_url
            url, is_custom = set_model_url_override(mid, "" if url_val in ("default", "reset", "-") else url_val)
            status = get_catalog_status(app_id=args.app)
            status["ok"] = True
            status["updated"] = {"model_id": mid, "url": url, "is_custom_url": is_custom}
            print(json.dumps(status, ensure_ascii=False))
            return 0
        if args.download:
            def _emit_prog(p: dict[str, Any]) -> None:
                print(json.dumps({"event": "progress", **p}, ensure_ascii=False), flush=True)

            download_model_sync(args.download, progress_cb=_emit_prog)
            status = get_catalog_status(app_id=args.app)
            status["ok"] = True
            print(json.dumps({"event": "complete", **status}, ensure_ascii=False), flush=True)
            return 0
        if args.delete:
            res = delete_model(args.delete)
            status = get_catalog_status(app_id=args.app)
            status["ok"] = True
            status["deleted"] = res
            print(json.dumps(status, ensure_ascii=False))
            return 0

        # Default: --status
        status = get_catalog_status(app_id=args.app)
        status["ok"] = True
        print(json.dumps(status, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(_main())
