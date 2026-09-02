from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import json

from app.adapters.factory import build_adapter
from app.audit.logger import log_action
from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.database.session import get_db
from app.models.api_schemas import RowMutationRequest, RowUpdateRequest, RowDeleteRequest
from app.models.internal import DatabaseConnection, User

router = APIRouter(prefix="/api/databases/{connection_id}/tables", tags=["tables"])


def _get_conn(connection_id: str, db: Session) -> DatabaseConnection:
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


@router.get("")
def list_tables(
    connection_id: str, schema: str = Query(...), database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = _get_conn(connection_id, db)
    adapter = build_adapter(conn, database)
    return adapter.get_tables(schema)


@router.get("/{table}/data")
def get_table_data(
    connection_id: str, table: str, schema: str = Query(...),
    page: int = Query(1, ge=1), limit: int = Query(None, ge=1, le=5000),
    sort_column: str | None = None, sort_dir: str = "asc",
    filters: str | None = Query(None, description="JSON-encoded list of {column, op, value}"),
    database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = _get_conn(connection_id, db)
    adapter = build_adapter(conn, database)
    page_size = limit or settings.dbx_default_page_size
    offset = (page - 1) * page_size

    parsed_filters = None
    if filters:
        try:
            parsed_filters = json.loads(filters)
            if not isinstance(parsed_filters, list):
                raise ValueError
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(status_code=400, detail="filters must be a JSON array")

    return adapter.get_table_data(schema, table, page_size, offset, sort_column, sort_dir, parsed_filters)


@router.get("/{table}/structure")
def get_table_structure(
    connection_id: str, table: str, schema: str = Query(...), database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = _get_conn(connection_id, db)
    adapter = build_adapter(conn, database)
    return {
        "columns": adapter.get_columns(schema, table),
        "primary_keys": adapter.get_primary_keys(schema, table),
        "constraints": adapter.get_constraints(schema, table),
    }


@router.get("/{table}/relations")
def get_table_relations(
    connection_id: str, table: str, schema: str = Query(...), database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = _get_conn(connection_id, db)
    adapter = build_adapter(conn, database)
    return {"foreign_keys": adapter.get_foreign_keys(schema, table)}


@router.get("/{table}/indexes")
def get_table_indexes(
    connection_id: str, table: str, schema: str = Query(...), database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = _get_conn(connection_id, db)
    adapter = build_adapter(conn, database)
    return adapter.get_indexes(schema, table)


# ------------------------------------------------------------------
# Row CRUD (Phase 4) — parameterized via the adapter, safe from
# injection. Every mutation is written to the audit log.
# ------------------------------------------------------------------
@router.post("/{table}/rows")
def insert_row(
    connection_id: str, table: str, payload: RowMutationRequest, schema: str = Query(...), database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = _get_conn(connection_id, db)
    adapter = build_adapter(conn, database)
    try:
        result = adapter.insert_row(schema, table, payload.values)
    except Exception as e:
        log_action(db, current_user.id, "INSERT", "error", connection_id=conn.id, target=f"{schema}.{table}", detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    log_action(db, current_user.id, "INSERT", "success", connection_id=conn.id, target=f"{schema}.{table}")
    return result


@router.put("/{table}/rows")
def update_row(
    connection_id: str, table: str, payload: RowUpdateRequest, schema: str = Query(...), database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = _get_conn(connection_id, db)
    adapter = build_adapter(conn, database)
    try:
        result = adapter.update_row(schema, table, payload.pk, payload.values)
    except Exception as e:
        log_action(db, current_user.id, "UPDATE", "error", connection_id=conn.id, target=f"{schema}.{table}", detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    log_action(db, current_user.id, "UPDATE", "success", connection_id=conn.id, target=f"{schema}.{table}")
    return result


@router.delete("/{table}/rows")
def delete_row(
    connection_id: str, table: str, payload: RowDeleteRequest, schema: str = Query(...), database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = _get_conn(connection_id, db)
    adapter = build_adapter(conn, database)
    try:
        result = adapter.delete_row(schema, table, payload.pk)
    except Exception as e:
        log_action(db, current_user.id, "DELETE", "error", connection_id=conn.id, target=f"{schema}.{table}", detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    log_action(db, current_user.id, "DELETE", "success", connection_id=conn.id, target=f"{schema}.{table}")
    return result
