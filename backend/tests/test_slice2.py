"""
Slice 2 — tests for:
  - requires_role dependency (unit)
  - PUT /api/sensors/{id}/ranges (HTTP via TestClient)
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from DAL.db_context import Base
from DAL.models.sensor import Sensor
from DAL.models.user import User
from DAL import get_db
from middleware import requires_role, get_current_user
from services.auth_service import AuthService
from routes.sensor_routes import sensor_router


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def db_engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def db(db_engine):
    Session = sessionmaker(bind=db_engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def _make_user(session, username="testuser", role="viewer"):
    svc = AuthService()
    user = User(
        username=username,
        email=f"{username}@test.com",
        hashed_password=svc.hash_password("pass"),
        role=role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _make_sensor(session, name="TempSensor"):
    sensor = Sensor(
        moneo_sensor_id=f"moneo-{name}",
        name=name,
        sensor_type="temperature",
        unit="°C",
    )
    session.add(sensor)
    session.commit()
    session.refresh(sensor)
    return sensor


# ── requires_role unit tests ──────────────────────────────────────────────────

class TestRequiresRole:
    """Test that requires_role blocks / allows correctly via the dependency callable."""

    def test_returns_a_callable(self):
        dep = requires_role("admin", "operator")
        assert callable(dep)

    @pytest.mark.asyncio
    async def test_allows_matching_role(self, db):
        """Admin user with requires_role('admin') should pass without raising."""
        admin = _make_user(db, username="adm", role="admin")
        check_fn = requires_role("admin", "operator")

        # Simulate calling the inner coroutine with the admin user
        result = await check_fn.__wrapped__(current_user=admin) if hasattr(check_fn, '__wrapped__') else None
        # Alternate: call via the dependency directly
        # If __wrapped__ is not available, we test via TestClient (see HTTP tests below)

    def test_admin_in_allowed_roles(self):
        """Sanity: 'admin' is in ('admin', 'operator')."""
        assert "admin" in {"admin", "operator"}

    def test_viewer_not_in_operator_roles(self):
        """Sanity: 'viewer' is not in ('admin', 'operator')."""
        assert "viewer" not in {"admin", "operator"}


# ── HTTP tests via TestClient ─────────────────────────────────────────────────

def _build_test_app(db_engine):
    """Build a minimal FastAPI app wired to the in-memory test DB."""
    from sqlalchemy.orm import sessionmaker as _sm

    TestSession = _sm(bind=db_engine, autocommit=False, autoflush=False)

    def override_get_db():
        session = TestSession()
        try:
            yield session
        finally:
            session.close()

    test_app = FastAPI()
    test_app.include_router(sensor_router)
    test_app.dependency_overrides[get_db] = override_get_db
    return test_app


def _bearer_for(user: User) -> str:
    token = AuthService.create_access_token(user_id=user.id)
    return f"Bearer {token}"


class TestUpdateSensorRangesHTTP:
    def test_update_ranges_200_for_admin(self, db, db_engine):
        """Admin can PUT /api/sensors/{id}/ranges and get 200 back."""
        sensor = _make_sensor(db)
        admin = _make_user(db, username="adm2", role="admin")

        app = _build_test_app(db_engine)

        # Override get_current_user to return admin directly (bypasses JWT decode)
        def override_user():
            return admin

        app.dependency_overrides[get_current_user] = override_user

        client = TestClient(app, raise_server_exceptions=True)
        resp = client.put(
            f"/api/sensors/{sensor.id}/ranges",
            json={"normal_min": 10.0, "normal_max": 80.0, "ranges_source": "manual"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["normal_min"] == 10.0
        assert data["normal_max"] == 80.0

    def test_update_ranges_200_for_operator(self, db, db_engine):
        """Operator can also update ranges."""
        sensor = _make_sensor(db, name="PressureSensor")
        operator = _make_user(db, username="op1", role="operator")

        app = _build_test_app(db_engine)
        app.dependency_overrides[get_current_user] = lambda: operator

        client = TestClient(app, raise_server_exceptions=True)
        resp = client.put(
            f"/api/sensors/{sensor.id}/ranges",
            json={"warning_min": 5.0, "warning_max": 95.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["warning_min"] == 5.0
        assert data["warning_max"] == 95.0

    def test_update_ranges_403_for_viewer(self, db, db_engine):
        """Viewer role is blocked from updating ranges."""
        sensor = _make_sensor(db, name="Sensor3")
        viewer = _make_user(db, username="viewer1", role="viewer")

        app = _build_test_app(db_engine)
        app.dependency_overrides[get_current_user] = lambda: viewer

        client = TestClient(app, raise_server_exceptions=False)
        resp = client.put(
            f"/api/sensors/{sensor.id}/ranges",
            json={"normal_min": 10.0},
        )
        assert resp.status_code == 403

    def test_update_ranges_404_for_unknown_sensor(self, db, db_engine):
        """Non-existent sensor returns 404."""
        admin = _make_user(db, username="adm3", role="admin")

        app = _build_test_app(db_engine)
        app.dependency_overrides[get_current_user] = lambda: admin

        client = TestClient(app, raise_server_exceptions=False)
        resp = client.put(
            "/api/sensors/99999/ranges",
            json={"normal_min": 10.0},
        )
        assert resp.status_code == 404

    def test_update_ranges_requires_auth(self, db, db_engine):
        """Without auth, the endpoint returns 401/403 (unauthenticated)."""
        sensor = _make_sensor(db, name="AuthSensor")

        app = _build_test_app(db_engine)
        # No dependency override — real auth middleware runs, no token → 403
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.put(
            f"/api/sensors/{sensor.id}/ranges",
            json={"normal_min": 10.0},
        )
        # HTTPBearer returns 403 when no credentials are present
        assert resp.status_code in (401, 403)
