"""
Local filesystem browser — dipakai oleh dialog "Browse..." di frontend
(mis. saat memilih file SQLite) supaya user bisa klik folder demi folder
alih-alih copy-paste path secara manual.

Ini AMAN dipakai di sini karena DEXAZ adalah aplikasi local-first: backend
selalu berjalan di PC yang sama dengan browser yang membukanya (bind ke
127.0.0.1), jadi "filesystem yang di-browse" memang filesystem milik user
sendiri — bukan mengekspos server ke pihak lain. Endpoint tetap di belakang
autentikasi (get_current_user) seperti endpoint lain.
"""
import os
import platform
import string
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.models.internal import User

router = APIRouter(prefix="/api/fs", tags=["filesystem"])


def _require_fs_browser_enabled():
    """
    Second gate on top of get_current_user. Browsing the full local disk is
    reasonable when the backend only ever hears from 127.0.0.1, but once
    it's reachable through a public tunnel this becomes "anyone with valid
    login credentials can list any folder on your PC". Set
    DBX_ENABLE_FS_BROWSER=false in .env whenever the backend is tunneled.
    """
    if not settings.dbx_enable_fs_browser:
        raise HTTPException(
            status_code=403,
            detail="Filesystem browsing is disabled (DBX_ENABLE_FS_BROWSER=false in .env).",
        )

# Ekstensi yang dianggap "file database SQLite" — file lain tetap
# ditampilkan (di-dim di frontend) supaya user tidak bingung foldernya
# kosong, tapi ditandai is_sqlite=False.
SQLITE_EXTENSIONS = {".db", ".sqlite", ".sqlite3", ".db3"}


def _entry(path: Path) -> dict:
    is_dir = False
    try:
        is_dir = path.is_dir()
    except OSError:
        pass
    return {
        "name": path.name or str(path),
        "path": str(path),
        "is_dir": is_dir,
        "is_sqlite_file": (not is_dir) and path.suffix.lower() in SQLITE_EXTENSIONS,
    }


def _default_start_dir() -> str:
    home = Path.home()
    docs = home / "Documents"
    return str(docs if docs.exists() else home)


@router.get("/roots")
def list_roots(current_user: User = Depends(get_current_user)):
    """
    Titik awal browsing: drive letters di Windows (C:\\, D:\\, ...), root
    "/" di Linux/Mac, plus folder home & Documents user sebagai shortcut.
    """
    _require_fs_browser_enabled()
    roots: list[dict] = []
    if platform.system() == "Windows":
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if os.path.exists(drive):
                roots.append({"name": drive, "path": drive, "is_dir": True, "is_sqlite_file": False})
    else:
        roots.append({"name": "/", "path": "/", "is_dir": True, "is_sqlite_file": False})

    home = Path.home()
    shortcuts = [home, home / "Documents", home / "Desktop", home / "Downloads"]
    seen = {r["path"] for r in roots}
    for s in shortcuts:
        if s.exists() and str(s) not in seen:
            roots.append({"name": s.name or str(s), "path": str(s), "is_dir": True, "is_sqlite_file": False})
            seen.add(str(s))

    return {"roots": roots, "default_path": _default_start_dir()}


@router.get("/browse")
def browse(
    path: Optional[str] = Query(default=None, description="Folder yang mau dibuka; kosong = folder default"),
    current_user: User = Depends(get_current_user),
):
    _require_fs_browser_enabled()
    target = Path(path) if path else Path(_default_start_dir())

    try:
        target = target.expanduser().resolve()
    except (OSError, RuntimeError):
        raise HTTPException(status_code=400, detail="Path tidak valid")

    if not target.exists():
        raise HTTPException(status_code=404, detail="Folder tidak ditemukan")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path yang dipilih bukan folder")

    try:
        children = list(target.iterdir())
    except PermissionError:
        raise HTTPException(status_code=403, detail="Tidak ada izin untuk membuka folder ini")
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Gagal membaca folder: {e}")

    folders = []
    files = []
    for child in children:
        # Skip hidden/system entries (dotfiles) supaya daftar tidak berantakan.
        if child.name.startswith("."):
            continue
        entry = _entry(child)
        (folders if entry["is_dir"] else files).append(entry)

    folders.sort(key=lambda e: e["name"].lower())
    files.sort(key=lambda e: e["name"].lower())

    parent = target.parent
    has_parent = parent != target

    return {
        "current_path": str(target),
        "parent_path": str(parent) if has_parent else None,
        "entries": folders + files,
    }
