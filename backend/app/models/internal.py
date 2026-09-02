"""
ORM models for DEXAZ's internal application database.

Tables here: users, database_connections, saved_queries, query_history,
audit_logs. Kept intentionally separate from any target database schema —
see app/database/session.py.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Boolean, DateTime, Integer, Text, ForeignKey
)
from sqlalchemy.orm import relationship

from app.database.session import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="admin")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_now)


class DatabaseConnection(Base):
    __tablename__ = "database_connections"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String(150), nullable=False)
    db_type = Column(String(30), nullable=False, default="postgresql")  # postgresql|mysql|sqlite
    host = Column(String(255), nullable=True)
    port = Column(Integer, nullable=True)
    database_name = Column(String(255), nullable=True)
    username = Column(String(150), nullable=True)
    # Encrypted with Fernet (app/core/security.py) — never plaintext, never
    # returned to the frontend.
    password_encrypted = Column(Text, nullable=True)
    ssl_mode = Column(String(30), nullable=True, default="prefer")
    sqlite_path = Column(String(500), nullable=True)
    is_favorite = Column(Boolean, default=False)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=_now)
    last_connected_at = Column(DateTime, nullable=True)


class SavedQuery(Base):
    __tablename__ = "saved_queries"

    id = Column(String, primary_key=True, default=_uuid)
    connection_id = Column(String, ForeignKey("database_connections.id"), nullable=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    sql_text = Column(Text, nullable=False)
    tags = Column(String(300), nullable=True)  # comma-separated
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=_now)


class QueryHistory(Base):
    __tablename__ = "query_history"

    id = Column(String, primary_key=True, default=_uuid)
    connection_id = Column(String, ForeignKey("database_connections.id"), nullable=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    sql_text = Column(Text, nullable=False)
    status = Column(String(20), nullable=False)  # success|error
    error_message = Column(Text, nullable=True)
    row_count = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    executed_at = Column(DateTime, default=_now)


class Document(Base):
    """
    Uploaded PDF / PowerPoint files kept on local disk (see
    app/core/config.py: dbx_documents_dir) so they can be listed, viewed
    (zoom in/out, presentation mode) and deleted from the "Dokumen" menu.
    Only metadata lives in this table — the file bytes live under
    dbx_documents_dir, named by `stored_filename` (a uuid-based name that
    never collides, regardless of the original filename).
    """
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=_uuid)
    filename = Column(String(500), nullable=False)  # original filename shown to the user
    stored_filename = Column(String(300), nullable=False, unique=True)  # name on disk
    file_type = Column(String(10), nullable=False)  # pdf|pptx|ppt
    size_bytes = Column(Integer, nullable=False, default=0)
    uploaded_by = Column(String, ForeignKey("users.id"), nullable=True)
    uploaded_at = Column(DateTime, default=_now)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    connection_id = Column(String, ForeignKey("database_connections.id"), nullable=True)
    action = Column(String(50), nullable=False)  # LOGIN|CONNECT|QUERY|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXPORT
    target = Column(String(300), nullable=True)  # e.g. table name
    status = Column(String(20), nullable=False)  # success|error
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_now)
