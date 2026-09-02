from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.session import get_db
from app.models.internal import SavedQuery, User

router = APIRouter(prefix="/api/queries", tags=["saved-queries"])


def _to_dict(q: SavedQuery) -> dict:
    return {
        "id": q.id,
        "connection_id": q.connection_id,
        "name": q.name,
        "description": q.description,
        "category": q.category,
        "sql": q.sql_text,
        "tags": [t for t in (q.tags or "").split(",") if t],
        "created_at": q.created_at.isoformat() if q.created_at else None,
    }


@router.get("")
def list_saved_queries(
    connection_id: str | None = None,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    q = db.query(SavedQuery).order_by(SavedQuery.created_at.desc())
    if connection_id:
        q = q.filter(SavedQuery.connection_id == connection_id)
    return [_to_dict(r) for r in q.all()]


@router.post("")
def create_saved_query(
    payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    sq = SavedQuery(
        connection_id=payload.get("connection_id"),
        name=payload["name"],
        description=payload.get("description"),
        category=payload.get("category"),
        sql_text=payload["sql"],
        tags=",".join(payload.get("tags", [])) if payload.get("tags") else None,
        created_by=current_user.id,
    )
    db.add(sq)
    db.commit()
    db.refresh(sq)
    return _to_dict(sq)


@router.put("/{query_id}")
def update_saved_query(
    query_id: str, payload: dict,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    sq = db.query(SavedQuery).filter(SavedQuery.id == query_id).first()
    if not sq:
        raise HTTPException(status_code=404, detail="Saved query not found")
    for field in ("name", "description", "category"):
        if field in payload:
            setattr(sq, field, payload[field])
    if "sql" in payload:
        sq.sql_text = payload["sql"]
    if "tags" in payload:
        sq.tags = ",".join(payload["tags"]) if payload["tags"] else None
    db.commit()
    db.refresh(sq)
    return _to_dict(sq)


@router.delete("/{query_id}")
def delete_saved_query(
    query_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    sq = db.query(SavedQuery).filter(SavedQuery.id == query_id).first()
    if not sq:
        raise HTTPException(status_code=404, detail="Saved query not found")
    db.delete(sq)
    db.commit()
    return {"success": True}
