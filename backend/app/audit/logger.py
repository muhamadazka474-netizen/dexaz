from sqlalchemy.orm import Session

from app.models.internal import AuditLog


def log_action(
    db: Session, user_id: str | None, action: str, status: str,
    connection_id: str | None = None, target: str | None = None, detail: str | None = None,
) -> None:
    entry = AuditLog(
        user_id=user_id, connection_id=connection_id, action=action,
        target=target, status=status, detail=detail,
    )
    db.add(entry)
    db.commit()
