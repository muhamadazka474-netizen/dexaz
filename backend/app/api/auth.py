from datetime import datetime, timedelta, timezone
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.core.security import verify_password, create_access_token
from app.database.session import get_db
from app.models.api_schemas import LoginRequest, LoginResponse
from app.models.internal import User
from app.audit.logger import log_action

router = APIRouter(prefix="/api/auth", tags=["auth"])

# --- Simple in-memory brute-force guard -------------------------------
# DEXAZ is a single-process, single-instance backend (no multi-worker /
# multi-server deployment), so an in-memory counter is enough — no Redis
# needed. Keyed by username (not IP) since a tunnel URL is typically used
# by one household/person anyway, and this stops "try every password for
# admin" attacks once the backend is reachable from the internet.
_failed_attempts: dict[str, list[datetime]] = {}
_lock = Lock()


def _check_not_locked_out(username: str):
    window = timedelta(minutes=settings.dbx_login_lockout_minutes)
    now = datetime.now(timezone.utc)
    with _lock:
        attempts = [t for t in _failed_attempts.get(username, []) if now - t < window]
        _failed_attempts[username] = attempts
        if len(attempts) >= settings.dbx_login_max_attempts:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Too many failed login attempts for this account. "
                    f"Try again in {settings.dbx_login_lockout_minutes} minutes."
                ),
            )


def _record_failed_attempt(username: str):
    with _lock:
        _failed_attempts.setdefault(username, []).append(datetime.now(timezone.utc))


def _clear_failed_attempts(username: str):
    with _lock:
        _failed_attempts.pop(username, None)


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    _check_not_locked_out(payload.username)

    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        _record_failed_attempt(payload.username)
        log_action(db, None, "LOGIN", "error", detail=f"failed login for {payload.username}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    _clear_failed_attempts(payload.username)
    token = create_access_token(subject=user.id, extra={"username": user.username, "role": user.role})
    log_action(db, user.id, "LOGIN", "success")
    return LoginResponse(access_token=token, username=user.username)


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username, "role": current_user.role}
