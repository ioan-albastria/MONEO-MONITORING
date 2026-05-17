import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from DAL.db_context import Base


@pytest.fixture(scope="function")
def db():
    """In-memory SQLite database, recreated for each test."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys = ON")

    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
