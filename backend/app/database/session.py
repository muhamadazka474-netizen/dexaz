"""
Session/engine for DEXAZ's OWN internal database (users, saved
connections, saved queries, history, audit log). This is completely
separate from any target database the user connects to and introspects.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings

connect_args = {}
if settings.dbx_internal_db_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.dbx_internal_db_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
