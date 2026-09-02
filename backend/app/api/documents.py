"""
Dokumen (PDF / PowerPoint) — upload, list, view, delete.

Files are stored as-is on local disk under `settings.dbx_documents_dir`
(default: backend/data/documents/), named by a generated uuid so the
original filename (which may contain spaces/odd characters, or collide
with another upload) never has to be a safe disk path. Only metadata
(original filename, type, size, who/when uploaded) lives in the internal
DB — see app/models/internal.py:Document.

Local-first, same as every other DEXAZ endpoint: backend binds to
127.0.0.1, so these files never leave the user's own PC. Viewing/zooming/
presenting happens entirely in the browser (react-pdf for PDF,
pptx-preview for PPTX) — this API only ever hands back raw bytes.
"""
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.audit.logger import log_action
from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.database.session import get_db
from app.models.internal import Document, User

router = APIRouter(prefix="/api/documents", tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf": "pdf", ".ppt": "ppt", ".pptx": "pptx"}
CONTENT_TYPES = {
    "pdf": "application/pdf",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

# backend/ is two levels up from this file (app/api/documents.py -> app -> backend)
BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _storage_dir() -> Path:
    p = Path(settings.dbx_documents_dir)
    if not p.is_absolute():
        p = BACKEND_ROOT / p
    p.mkdir(parents=True, exist_ok=True)
    return p


def _to_dict(doc: Document) -> dict:
    return {
        "id": doc.id,
        "filename": doc.filename,
        "file_type": doc.file_type,
        "size_bytes": doc.size_bytes,
        "uploaded_at": doc.uploaded_at.isoformat() if doc.uploaded_at else None,
    }


@router.get("")
def list_documents(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    docs = db.query(Document).order_by(Document.uploaded_at.desc()).all()
    return [_to_dict(d) for d in docs]


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Nama file tidak valid")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Hanya file .pdf, .ppt, atau .pptx yang didukung")

    content = await file.read()
    max_bytes = settings.dbx_document_max_file_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File terlalu besar (maks {settings.dbx_document_max_file_mb} MB)",
        )

    file_type = ALLOWED_EXTENSIONS[ext]
    stored_filename = f"{uuid.uuid4()}{ext}"
    dest = _storage_dir() / stored_filename
    dest.write_bytes(content)

    doc = Document(
        filename=file.filename,
        stored_filename=stored_filename,
        file_type=file_type,
        size_bytes=len(content),
        uploaded_by=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    log_action(db, current_user.id, "UPLOAD", "success", target=file.filename, detail=f"document ({file_type})")

    return _to_dict(doc)


def _get_document_or_404(db: Session, document_id: str) -> Document:
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Dokumen tidak ditemukan")
    return doc


@router.get("/{document_id}/file")
def get_document_file(
    document_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    doc = _get_document_or_404(db, document_id)
    path = _storage_dir() / doc.stored_filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File dokumen tidak ditemukan di disk")

    return Response(
        content=path.read_bytes(),
        media_type=CONTENT_TYPES.get(doc.file_type, "application/octet-stream"),
        headers={"Content-Disposition": f'inline; filename="{doc.filename}"'},
    )


@router.delete("/{document_id}")
def delete_document(
    document_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    doc = _get_document_or_404(db, document_id)
    path = _storage_dir() / doc.stored_filename
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass  # metadata cleanup should still proceed even if disk delete fails

    db.delete(doc)
    db.commit()

    log_action(db, current_user.id, "DROP", "success", target=doc.filename, detail="document deleted")

    return {"status": "ok"}
