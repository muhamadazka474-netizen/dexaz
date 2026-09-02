"""
Central application configuration.
Reads from .env at the project root (two levels up from backend/).
All secrets and host/port bindings live here — nothing is hard-coded
in the routes or adapters.
"""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env is expected at dbxplorer/.env (project root), one level above backend/
ENV_PATH = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH) if ENV_PATH.exists() else ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Internal app database (NOT the user's target database)
    dbx_internal_db_url: str = "sqlite:///./dbxplorer_internal.db"

    # Security
    secret_key: str = "dev-only-insecure-secret-change-me"
    jwt_secret: str = "dev-only-insecure-jwt-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    encryption_key: str = ""  # Fernet key, must be set in .env for real use

    # Seeded local admin
    dbx_admin_username: str = "admin"
    dbx_admin_password: str = "admin"

    # Local-first binding
    dbx_host: str = "127.0.0.1"
    dbx_port: int = 8000
    dbx_frontend_origin: str = "http://127.0.0.1:3000"

    # --- Hardening for when the backend is exposed via a public tunnel ---
    # The filesystem browser (/api/fs/*) lets a logged-in user browse the
    # ENTIRE local disk (any drive/folder the OS user can read) — fine when
    # only you can reach 127.0.0.1, risky once the backend is reachable from
    # the internet through a tunnel. Set to false before/while tunneling.
    dbx_enable_fs_browser: bool = True

    # Basic brute-force protection on /api/auth/login. After this many
    # failed attempts for a given username, further attempts are rejected
    # for the lockout window, regardless of whether the password is correct.
    dbx_login_max_attempts: int = 5
    dbx_login_lockout_minutes: int = 15

    # Query safety
    dbx_query_timeout_seconds: int = 30
    dbx_max_rows_returned: int = 10000
    dbx_default_page_size: int = 100

    # Export limits — exports bypass the normal preview row cap but are
    # still bounded so a huge table can't exhaust memory/response size.
    dbx_export_max_rows: int = 50000

    # Excel import limits — same reasoning as export: bounded so a huge
    # spreadsheet can't exhaust memory or block the request for too long.
    dbx_import_max_rows: int = 100000
    dbx_import_max_file_mb: int = 25

    # Documents (PDF / PowerPoint) viewer — files are stored on local disk
    # under this folder (relative to backend/, or an absolute path), only
    # metadata goes in the internal DB. Local-first: nothing ever leaves
    # the user's PC.
    dbx_documents_dir: str = "data/documents"
    dbx_document_max_file_mb: int = 200

    # Optional bootstrap connection — auto-created on first run if provided.
    # Useful so you don't have to re-type connection details in the UI every
    # time you set up a fresh install. Leave blank to skip.
    dbx_bootstrap_name: str = ""
    dbx_bootstrap_db_type: str = "postgresql"
    dbx_bootstrap_host: str = ""
    dbx_bootstrap_port: int = 5432
    dbx_bootstrap_database: str = ""
    dbx_bootstrap_username: str = ""
    dbx_bootstrap_password: str = ""
    dbx_bootstrap_ssl_mode: str = "prefer"


settings = Settings()
