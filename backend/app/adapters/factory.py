"""
Given a DatabaseConnection row from the internal DB, build the right
DatabaseAdapter instance. This is the one place that knows how to map
db_type -> adapter class, so adding a new engine means adding a branch
here (and a new adapter module) — nothing else changes.
"""
from app.adapters.base import DatabaseAdapter
from app.adapters.postgres_adapter import PostgresAdapter
from app.adapters.mysql_adapter import MySQLAdapter
from app.adapters.sqlite_adapter import SQLiteAdapter
from app.core.security import decrypt_secret
from app.models.internal import DatabaseConnection


def build_adapter(conn: DatabaseConnection, database: str | None = None) -> DatabaseAdapter:
    """Build the adapter for a connection. `database`, when given, overrides
    the connection's stored database_name for this call only — this is how
    a single server connection can be pointed at any of its databases
    (e.g. "pajak" vs "non_pajak") without changing the saved connection."""
    if conn.db_type == "postgresql":
        password = decrypt_secret(conn.password_encrypted) if conn.password_encrypted else ""
        return PostgresAdapter(
            host=conn.host,
            port=conn.port or 5432,
            database=database or conn.database_name,
            username=conn.username,
            password=password,
            ssl_mode=conn.ssl_mode or "prefer",
        )

    if conn.db_type in ("mysql", "mariadb"):
        password = decrypt_secret(conn.password_encrypted) if conn.password_encrypted else ""
        return MySQLAdapter(
            host=conn.host,
            port=conn.port or 3306,
            database=database or conn.database_name,
            username=conn.username,
            password=password,
            ssl_mode=conn.ssl_mode or "prefer",
            db_type=conn.db_type,
        )

    if conn.db_type == "sqlite":
        if not conn.sqlite_path:
            raise ValueError("Koneksi SQLite butuh sqlite_path (lokasi file .db/.sqlite).")
        return SQLiteAdapter(sqlite_path=conn.sqlite_path)

    raise NotImplementedError(
        f"Database type '{conn.db_type}' belum didukung. "
        "Yang tersedia saat ini: postgresql, mysql, mariadb, sqlite."
    )
