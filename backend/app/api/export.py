from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.adapters.factory import build_adapter
from app.audit.logger import log_action
from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.database.session import get_db
from app.export.exporter import generate, CONTENT_TYPES, EXTENSIONS
from app.models.internal import DatabaseConnection, User

router = APIRouter(prefix="/api/export", tags=["export"])


def _file_response(fmt: str, filename_base: str, data: bytes) -> Response:
    ext = EXTENSIONS[fmt]
    return Response(
        content=data,
        media_type=CONTENT_TYPES[fmt],
        headers={"Content-Disposition": f'attachment; filename="{filename_base}.{ext}"'},
    )


@router.post("/query")
def export_query(
    payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    fmt = payload.get("format", "csv")
    if fmt not in ("csv", "json", "excel"):
        raise HTTPException(status_code=400, detail="format must be csv, json, or excel")

    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == payload["connection_id"]).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    sql = payload["sql"]
    adapter = build_adapter(conn, payload.get("database"))

    # Classify BEFORE executing — export must never run a destructive
    # statement, so we reject up front rather than after the fact.
    statement_type = adapter.classify_statement(sql)
    if statement_type != "read":
        raise HTTPException(status_code=400, detail="Only read (SELECT) queries can be exported")

    result = adapter.execute_query(sql, timeout_seconds=settings.dbx_query_timeout_seconds, max_rows=settings.dbx_export_max_rows)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    meta = {
        "database": conn.database_name,
        "source": "SQL Query",
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "sql": sql,
    }
    data = generate(fmt, result["columns"], result["rows"], meta)
    log_action(db, current_user.id, "EXPORT", "success", connection_id=conn.id, detail=f"query export ({fmt})")
    return _file_response(fmt, "query_result", data)


@router.post("/table")
def export_table(
    payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    fmt = payload.get("format", "csv")
    if fmt not in ("csv", "json", "excel"):
        raise HTTPException(status_code=400, detail="format must be csv, json, or excel")

    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == payload["connection_id"]).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    schema = payload["schema"]
    table = payload["table"]
    scope = payload.get("scope", "current_page")  # current_page | filtered | all
    filters = payload.get("filters") if scope in ("current_page", "filtered") else None
    sort_column = payload.get("sort_column")
    sort_dir = payload.get("sort_dir", "asc")

    adapter = build_adapter(conn, payload.get("database"))

    if scope == "current_page":
        limit = payload.get("limit", settings.dbx_default_page_size)
        offset = (payload.get("page", 1) - 1) * limit
    else:
        limit = settings.dbx_export_max_rows
        offset = 0

    data_result = adapter.get_table_data(schema, table, limit, offset, sort_column, sort_dir, filters)

    meta = {
        "database": conn.database_name,
        "source": f"{schema}.{table} ({scope})",
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "sql": f"-- exported from {schema}.{table}, scope={scope}",
    }
    data = generate(fmt, data_result["columns"], data_result["rows"], meta)
    log_action(
        db, current_user.id, "EXPORT", "success", connection_id=conn.id,
        target=f"{schema}.{table}", detail=f"table export ({fmt}, scope={scope})",
    )
    return _file_response(fmt, table, data)
