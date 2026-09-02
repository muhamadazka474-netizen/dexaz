from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.adapters.factory import build_adapter
from app.audit.logger import log_action
from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.database.session import get_db
from app.models.api_schemas import QueryExecuteRequest, QueryExecuteResponse
from app.models.internal import DatabaseConnection, QueryHistory, User
from app.query.safety import needs_confirmation

router = APIRouter(prefix="/api/query", tags=["query"])


@router.post("/execute", response_model=QueryExecuteResponse)
def execute_query(
    payload: QueryExecuteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    conn = db.query(DatabaseConnection).filter(DatabaseConnection.id == payload.connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    confirm_needed, warning = needs_confirmation(payload.sql)
    if confirm_needed and not payload.confirm_destructive:
        return QueryExecuteResponse(
            success=False, statement_type="unknown", columns=[], rows=[], row_count=0,
            duration_ms=0, requires_confirmation=True, warning=warning,
        )

    adapter = build_adapter(conn, payload.database)
    result = adapter.execute_query(
        payload.sql,
        timeout_seconds=settings.dbx_query_timeout_seconds,
        max_rows=settings.dbx_max_rows_returned,
    )

    history = QueryHistory(
        connection_id=conn.id,
        user_id=current_user.id,
        sql_text=payload.sql,
        status="success" if result["success"] else "error",
        error_message=result.get("error"),
        row_count=result.get("row_count", 0),
        duration_ms=result.get("duration_ms", 0),
    )
    db.add(history)
    db.commit()

    log_action(
        db, current_user.id,
        action=result["statement_type"].upper() if result["statement_type"] != "read" else "QUERY",
        status="success" if result["success"] else "error",
        connection_id=conn.id, detail=result.get("error"),
    )

    return QueryExecuteResponse(**result)


@router.get("/history")
def get_history(
    connection_id: str | None = None, limit: int = 50,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    q = db.query(QueryHistory).order_by(QueryHistory.executed_at.desc())
    if connection_id:
        q = q.filter(QueryHistory.connection_id == connection_id)
    rows = q.limit(limit).all()
    return [
        {
            "id": r.id, "connection_id": r.connection_id, "sql": r.sql_text,
            "status": r.status, "error": r.error_message, "row_count": r.row_count,
            "duration_ms": r.duration_ms, "executed_at": r.executed_at.isoformat(),
        }
        for r in rows
    ]


@router.delete("/history/{history_id}")
def delete_history(
    history_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    row = db.query(QueryHistory).filter(QueryHistory.id == history_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="History entry not found")
    db.delete(row)
    db.commit()
    return {"success": True}
