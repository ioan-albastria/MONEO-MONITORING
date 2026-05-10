from datetime import datetime, timezone

import pytest

from DAL.models.sensor import Sensor
from DAL.models.sensor_reading import SensorReading
from DAL.models.user import User
from routes.response_models.dashboard import DashboardCreate, DashboardUpdate, DashboardWidgetCreate
from services.auth_service import AuthService
from services.dashboard_service import DashboardService
from services.sensor_readings_service import SensorReadingsService


# ── Auth ─────────────────────────────────────────────────────────────────────

class TestAuthService:
    def test_hash_and_verify_password(self):
        svc = AuthService()
        hashed = svc.hash_password("secret")
        assert svc.verify_password("secret", hashed)
        assert not svc.verify_password("wrong", hashed)

    def test_create_and_decode_token(self):
        token = AuthService.create_access_token(user_id=42)
        payload = AuthService.decode_token(token)
        assert payload["user_id"] == 42

    def test_decode_invalid_token_raises(self):
        with pytest.raises(ValueError):
            AuthService.decode_token("not.a.valid.token")

    def test_seed_admin_creates_user(self, db):
        svc = AuthService()
        svc.seed_admin(db)
        user = db.query(User).filter(User.username == "admin").first()
        assert user is not None
        assert user.is_active

    def test_seed_admin_idempotent(self, db):
        svc = AuthService()
        svc.seed_admin(db)
        svc.seed_admin(db)
        count = db.query(User).filter(User.username == "admin").count()
        assert count == 1


# ── Dashboard ────────────────────────────────────────────────────────────────

def _make_user(db) -> User:
    svc = AuthService()
    user = User(
        username="testuser",
        email="test@example.com",
        hashed_password=svc.hash_password("pass"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestDashboardService:
    def test_create_dashboard(self, db):
        user = _make_user(db)
        svc = DashboardService()
        result = svc.create_dashboard(db, user.id, DashboardCreate(name="My Board"))
        assert result.id is not None
        assert result.name == "My Board"
        assert result.owner_id == user.id
        assert result.widgets == []

    def test_create_strips_whitespace(self, db):
        user = _make_user(db)
        svc = DashboardService()
        result = svc.create_dashboard(db, user.id, DashboardCreate(name="  Spaces  "))
        assert result.name == "Spaces"

    def test_get_user_dashboards(self, db):
        user = _make_user(db)
        svc = DashboardService()
        svc.create_dashboard(db, user.id, DashboardCreate(name="A"))
        svc.create_dashboard(db, user.id, DashboardCreate(name="B"))
        results = svc.get_user_dashboards(db, user.id)
        assert len(results) == 2

    def test_update_dashboard(self, db):
        user = _make_user(db)
        svc = DashboardService()
        created = svc.create_dashboard(db, user.id, DashboardCreate(name="Old"))
        updated = svc.update_dashboard(db, user.id, created.id, DashboardUpdate(name="New", is_public=True))
        assert updated.name == "New"
        assert updated.is_public is True

    def test_delete_dashboard(self, db):
        user = _make_user(db)
        svc = DashboardService()
        created = svc.create_dashboard(db, user.id, DashboardCreate(name="ToDelete"))
        svc.delete_dashboard(db, user.id, created.id)
        assert svc.get_user_dashboards(db, user.id) == []

    def test_delete_dashboard_wrong_user_raises(self, db):
        user = _make_user(db)
        svc = DashboardService()
        created = svc.create_dashboard(db, user.id, DashboardCreate(name="Private"))
        with pytest.raises(ValueError):
            svc.delete_dashboard(db, user_id=999, dashboard_id=created.id)

    def test_add_widget(self, db):
        user = _make_user(db)
        svc = DashboardService()
        board = svc.create_dashboard(db, user.id, DashboardCreate(name="Board"))
        widget = svc.add_widget(
            db, user.id, board.id,
            DashboardWidgetCreate(widget_type="line_chart", title="Temp", x=0, y=0, cols=6, rows=4, settings={})
        )
        assert widget.id is not None
        assert widget.widget_type == "line_chart"

    def test_delete_widget(self, db):
        user = _make_user(db)
        svc = DashboardService()
        board = svc.create_dashboard(db, user.id, DashboardCreate(name="Board"))
        widget = svc.add_widget(
            db, user.id, board.id,
            DashboardWidgetCreate(widget_type="stat_card", title="Card", x=0, y=0, cols=3, rows=2, settings={})
        )
        svc.delete_widget(db, user.id, widget.id)
        full = svc.get_dashboard(db, board.id, user.id)
        assert full.widgets == []


# ── SensorReadings ───────────────────────────────────────────────────────────

def _make_sensor(db, name="TempSensor") -> Sensor:
    sensor = Sensor(
        moneo_sensor_id=f"moneo-{name}",
        name=name,
        sensor_type="temperature",
        unit="°C",
    )
    db.add(sensor)
    db.commit()
    db.refresh(sensor)
    return sensor


class TestSensorReadingsService:
    def test_get_readings_empty(self, db):
        sensor = _make_sensor(db)
        svc = SensorReadingsService()
        result = svc.get_sensor_readings(
            db, sensor.id,
            datetime(2024, 1, 1, tzinfo=timezone.utc),
            datetime(2024, 1, 2, tzinfo=timezone.utc),
        )
        assert result.points == []
        assert result.min_value is None

    def test_get_readings_with_data(self, db):
        sensor = _make_sensor(db)
        for i, val in enumerate([10.0, 20.0, 30.0]):
            db.add(SensorReading(
                sensor_id=sensor.id,
                value=val,
                timestamp=datetime(2024, 1, 1, i, 0, tzinfo=timezone.utc),
                status="ok",
            ))
        db.commit()

        svc = SensorReadingsService()
        result = svc.get_sensor_readings(
            db, sensor.id,
            datetime(2024, 1, 1, tzinfo=timezone.utc),
            datetime(2024, 1, 2, tzinfo=timezone.utc),
        )
        assert len(result.points) == 3
        assert result.min_value == 10.0
        assert result.max_value == 30.0
        assert result.avg_value == 20.0

    def test_get_sensor_not_found_raises(self, db):
        svc = SensorReadingsService()
        with pytest.raises(ValueError):
            svc.get_sensor_readings(
                db, 999,
                datetime(2024, 1, 1, tzinfo=timezone.utc),
                datetime(2024, 1, 2, tzinfo=timezone.utc),
            )

    def test_aggregated_readings(self, db):
        sensor = _make_sensor(db, "PressureSensor")
        for minute in [0, 10, 20, 60, 70]:
            db.add(SensorReading(
                sensor_id=sensor.id,
                value=float(minute),
                timestamp=datetime(2024, 1, 1, 12, minute, tzinfo=timezone.utc),
                status="ok",
            ))
        db.commit()

        svc = SensorReadingsService()
        result = svc.get_aggregated_readings(
            db, sensor.id,
            datetime(2024, 1, 1, tzinfo=timezone.utc),
            datetime(2024, 1, 2, tzinfo=timezone.utc),
            bucket_minutes=60,
        )
        assert len(result.points) == 2
