import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.adapters.factory import build_adapter
from app.audit.logger import log_action
from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.database.session import get_db
from app.imports.excel import ExcelImportError, analyze_workbook, extract_rows
from app.models.internal import DatabaseConnection, User

router = APIRouter(prefix="/api/import", tags=["import"])

ALLOWED_EXTENSIONS = (".xlsx", ".xlsm")


def _get_connection(db: Session, connection_id: str) -> DatabaseConnection:
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


def _check_upload(file: UploadFile, content: bytes) -> None:
    if not file.filename or not file.filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise HTTPException(status_code=400, detail="Hanya file .xlsx atau .xlsm yang didukung")
    max_bytes = settings.dbx_import_max_file_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File terlalu besar (maks {settings.dbx_import_max_file_mb} MB)",
        )


@router.post("/{connection_id}/analyze")
async def analyze(
    connection_id: str,
    file: UploadFile = File(...),
    sheet: str | None = Form(None),
    header_row: int = Form(1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Parses the uploaded workbook and returns a preview (sheets, guessed
    column names/types, sample rows, row count) — makes no database changes."""
    _get_connection(db, connection_id)
    content = await file.read()
    _check_upload(file, content)

    try:
        result = analyze_workbook(content, sheet_name=sheet, header_row=header_row)
    except ExcelImportError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if result["row_count"] > settings.dbx_import_max_rows:
        result["row_count_exceeds_limit"] = True
    return result


@router.post("/{connection_id}/execute")
async def execute(
    connection_id: str,
    file: UploadFile = File(...),
    config: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Imports the workbook into `schema.table`. `config` is a JSON string:
    {
      sheet: string, header_row: int,
      schema: string, table: string, mode: "create" | "append",
      columns: [{index, target_name, type, include}, ...]
    }
    """
    conn = _get_connection(db, connection_id)
    content = await file.read()
    _check_upload(file, content)

    try:
        cfg = json.loads(config)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Konfigurasi import tidak valid")

    schema = (cfg.get("schema") or "").strip()
    table = (cfg.get("table") or "").strip()
    mode = cfg.get("mode", "create")
    sheet_name = cfg.get("sheet")
    header_row = int(cfg.get("header_row", 1))
    all_columns = cfg.get("columns") or []
    columns = [c for c in all_columns if c.get("include", True) and (c.get("target_name") or "").strip()]

    if not schema or not table:
        raise HTTPException(status_code=400, detail="Schema dan nama tabel wajib diisi")
    if mode not in ("create", "append"):
        raise HTTPException(status_code=400, detail="mode harus 'create' atau 'append'")
    if not columns:
        raise HTTPException(status_code=400, detail="Minimal satu kolom harus disertakan")

    try:
        rows = extract_rows(content, sheet_name=sheet_name, header_row=header_row, columns=columns)
    except ExcelImportError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if len(rows) > settings.dbx_import_max_rows:
        raise HTTPException(
            status_code=400,
            detail=f"Terlalu banyak baris ({len(rows)}). Maksimal {settings.dbx_import_max_rows} baris per import.",
        )

    adapter = build_adapter(conn, cfg.get("database"))
    result = adapter.import_rows(schema, table, columns, rows, create=(mode == "create"))

    if not result["success"]:
        log_action(
            db, current_user.id, "IMPORT", "error", connection_id=conn.id,
            target=f"{schema}.{table}", detail=result.get("error"),
        )
        raise HTTPException(status_code=400, detail=result["error"])

    log_action(
        db, current_user.id, "IMPORT", "success", connection_id=conn.id,
        target=f"{schema}.{table}",
        detail=f"imported {result['rows_imported']} rows from '{file.filename}' (mode={mode})",
    )
    return result
