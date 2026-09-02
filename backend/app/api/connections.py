from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.adapters.factory import build_adapter
from app.audit.logger import log_action
from app.auth.dependencies import get_current_user
from app.core.security import encrypt_secret
from app.database.session import get_db
from app.models.api_schemas import ConnectionCreate, ConnectionUpdate, ConnectionOut
from app.models.internal import DatabaseConnection, User
from app.schema import introspection

router = APIRouter(prefix="/api/databases", tags=["connections"])


def _to_out(conn: DatabaseConnection, status: str | None = None) -> ConnectionOut:
    out = ConnectionOut.model_validate(conn)
    out.status = status
    return out


@router.get("", response_model=list[ConnectionOut])
def list_connections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    conns = db.query(DatabaseConnection).order_by(DatabaseConnection.name).all()
    return [_to_out(c) for c in conns]


@router.post("", response_model=ConnectionOut)
def create_connection(
    payload: ConnectionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    conn = DatabaseConnection(
        name=payload.name,
        db_type=payload.db_type,
        host=payload.host,
        port=payload.port,
        database_name=payload.database_name,
        username=payload.username,
        password_encrypted=encrypt_secret(payload.password) if payload.password else None,
        ssl_mode=payload.ssl_mode,
        sqlite_path=payload.sqlite_path,
        created_by=current_user.id,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    log_action(db, current_user.id, "CREATE", "success", connection_id=conn.id, target="database_connection")
    return _to_out(conn)


@router.put("/{connection_id}", response_model=ConnectionOut)
def update_connection(
    connection_id: str, payload: ConnectionUpdate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    data = payload.model_dump(exclude_unset=True)
    if "password" in data:
        password = data.pop("password")
        if password:
            conn.password_encrypted = encrypt_secret(password)
    for field, value in data.items():
        setattr(conn, field, value)
    db.commit()
    db.refresh(conn)
    introspection.invalidate(conn.id)
    log_action(db, current_user.id, "ALTER", "success", connection_id=conn.id, target="database_connection")
    return _to_out(conn)


@router.delete("/{connection_id}")
def delete_connection(
    connection_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    db.delete(conn)
    db.commit()
    introspection.invalidate(connection_id)
    log_action(db, current_user.id, "DROP", "success", connection_id=connection_id, target="database_connection")
    return {"success": True}


@router.post("/{connection_id}/test")
def test_connection(
    connection_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    adapter = build_adapter(conn)
    result = adapter.test_connection()
    if result.get("success"):
        conn.last_connected_at = datetime.now(timezone.utc)
        db.commit()
    log_action(
        db, current_user.id, "CONNECT", "success" if result.get("success") else "error",
        connection_id=conn.id, detail=result.get("message"),
    )
    return result


@router.get("/{connection_id}/databases")
def list_databases(
    connection_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """Lists every database visible on the server this connection points
    at (e.g. both "pajak" and "non_pajak" on the same Postgres/MySQL
    server) — this is what powers the database picker in Explorer.
    SQLite connections are always a single file/database, so this simply
    returns that one entry."""
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.db_type == "sqlite":
        return [{"name": conn.database_name or conn.sqlite_path, "size": None}]
    adapter = build_adapter(conn)
    try:
        return adapter.get_databases()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{connection_id}/refresh")
def refresh_metadata(
    connection_id: str, database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    adapter = build_adapter(conn, database)
    data = introspection.get_metadata_tree(conn.id, adapter, force_refresh=True, database=database)
    return data


@router.get("/{connection_id}/schemas")
def get_schemas(
    connection_id: str, database: str | None = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    adapter = build_adapter(conn, database)
    return introspection.get_metadata_tree(conn.id, adapter, database=database)
