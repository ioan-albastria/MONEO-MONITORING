from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> "Session":
    # Mirrors the manual `db = SessionLocal(); try: ...; finally: db.close()` pattern
    # used at numerous call sites. Commit/rollback is left to the caller — this
    # helper only guarantees the session is closed.
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
