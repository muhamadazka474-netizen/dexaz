"""
DEXAZ backend entrypoint.

Run with:
    uvicorn main:app --reload --host 127.0.0.1 --port 8000

Local-first by default: only binds to 127.0.0.1 unless DBX_HOST is
explicitly changed in .env.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, connections, tables, query, dashboard, saved_queries, export, erd, data_import, filesystem, documents
from app.core.config import settings
from app.core.security import hash_password, encrypt_secret
from app.database.session import Base, engine, SessionLocal
from app.models.internal import User, DatabaseConnection  # noqa: F401  (ensures models are registered)

app = FastAPI(
    title="DEXAZ API",
    description="Local database management & SQL analytics platform — backend API",
    version="0.1.0-phase1",
)

app.add_middleware(
    CORSMiddleware,
    # DBX_FRONTEND_ORIGIN can hold one origin or a comma-separated list,
    # e.g. "http://127.0.0.1:3000,https://your-app.vercel.app" — this lets
    # you keep local dev working while also allowing a deployed frontend.
    allow_origins=[o.strip() for o in settings.dbx_frontend_origin.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    # Create internal app tables (users, connections, saved queries, etc.)
    Base.metadata.create_all(bind=engine)

    # Seed a default local admin user if none exists yet.
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            admin = User(
                username=settings.dbx_admin_username,
                password_hash=hash_password(settings.dbx_admin_password),
                role="admin",
            )
            db.add(admin)
            db.commit()

        # Optional: seed a bootstrap database connection from .env, so the
        # user doesn't have to re-enter it in the UI on a fresh install.
        # Only runs once — skipped if a connection with the same name
        # already exists.
        if settings.dbx_bootstrap_name and settings.dbx_bootstrap_database:
            existing = (
                db.query(DatabaseConnection)
                .filter(DatabaseConnection.name == settings.dbx_bootstrap_name)
                .first()
            )
            if not existing:
                conn = DatabaseConnection(
                    name=settings.dbx_bootstrap_name,
                    db_type=settings.dbx_bootstrap_db_type,
                    host=settings.dbx_bootstrap_host,
                    port=settings.dbx_bootstrap_port,
                    database_name=settings.dbx_bootstrap_database,
                    username=settings.dbx_bootstrap_username,
                    password_encrypted=encrypt_secret(settings.dbx_bootstrap_password)
                    if settings.dbx_bootstrap_password
                    else None,
                    ssl_mode=settings.dbx_bootstrap_ssl_mode,
                )
                db.add(conn)
                db.commit()
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "local", "version": "0.1.0-phase1"}


app.include_router(auth.router)
app.include_router(connections.router)
app.include_router(tables.router)
app.include_router(query.router)
app.include_router(dashboard.router)
app.include_router(saved_queries.router)
app.include_router(export.router)
app.include_router(erd.router)
app.include_router(data_import.router)
app.include_router(filesystem.router)
app.include_router(documents.router)
