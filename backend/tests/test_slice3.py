"""
Slice 3 — tests for:
  - AlertEvaluator._condition_met() for all conditions
  - AlertEvaluator state machine transitions (OK→pending→firing→recovered/awaiting_ack)
  - POST /api/alerts/events/{id}/ack endpoint
  - GET /api/alerts/rules and POST /api/alerts/rules
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from DAL.db_context import Base
from DAL.models.alert_event import AlertEvent
from DAL.models.alert_rule import AlertRule
from DAL.models.alert_state import AlertState
from DAL.models.sensor import Sensor
from DAL.models.sensor_reading import SensorReading
from DAL.models.user import User
from DAL import get_db
from middleware import get_current_user
from routes.alert_routes import alert_router
from services.alert_evaluator import AlertEvaluator
from services.auth_service import AuthService


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def db_engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def db(db_engine):
    Session = sessionmaker(bind=db_engine, autocommit=False, autoflush=False)
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


def _make_sensor(session, name="TestSensor"):
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


def _make_rule(
    session,
    sensor_id,
    condition="gt",
    threshold_lo=None,
    threshold_hi=100.0,
    recovery_lo=None,
    recovery_hi=None,
    severity="warning",
    dwell_seconds=60,
    recovery_dwell_seconds=30,
    policy="auto_clear",
    is_enabled=True,
):
    rule = AlertRule(
        sensor_id=sensor_id,
        name="Test Rule",
        condition=condition,
        threshold_lo=threshold_lo,
        threshold_hi=threshold_hi,
        recovery_lo=recovery_lo,
        recovery_hi=recovery_hi,
        severity=severity,
        dwell_seconds=dwell_seconds,
        recovery_dwell_seconds=recovery_dwell_seconds,
        policy=policy,
        is_enabled=is_enabled,
    )
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return rule


def _make_reading(session, sensor_id, value, timestamp=None):
    ts = timestamp or datetime.now(timezone.utc)
    reading = SensorReading(sensor_id=sensor_id, value=value, timestamp=ts, status="ok")
    session.add(reading)
    session.commit()
    session.refresh(reading)
    return reading


# ── Condition evaluation tests ─────────────────────────────────────────────────

class TestConditionEval:
    def _evaluator(self):
        return AlertEvaluator()

    def _rule(self, condition, threshold_lo=None, threshold_hi=None):
        class FakeRule:
            pass
        r = FakeRule()
        r.condition = condition
        r.threshold_lo = threshold_lo
        r.threshold_hi = threshold_hi
        return r

    def test_gt_met(self):
        rule = self._rule("gt", threshold_hi=100.0)
        assert self._evaluator()._condition_met(101.0, rule) is True

    def test_gt_not_met(self):
        rule = self._rule("gt", threshold_hi=100.0)
        assert self._evaluator()._condition_met(100.0, rule) is False

    def test_lt_met(self):
        rule = self._rule("lt", threshold_lo=10.0)
        assert self._evaluator()._condition_met(9.0, rule) is True

    def test_lt_not_met(self):
        rule = self._rule("lt", threshold_lo=10.0)
        assert self._evaluator()._condition_met(10.0, rule) is False

    def test_outside_range_below(self):
        rule = self._rule("outside_range", threshold_lo=20.0, threshold_hi=80.0)
        assert self._evaluator()._condition_met(10.0, rule) is True

    def test_outside_range_above(self):
        rule = self._rule("outside_range", threshold_lo=20.0, threshold_hi=80.0)
        assert self._evaluator()._condition_met(90.0, rule) is True

    def test_outside_range_inside(self):
        rule = self._rule("outside_range", threshold_lo=20.0, threshold_hi=80.0)
        assert self._evaluator()._condition_met(50.0, rule) is False

    def test_inside_range_met(self):
        rule = self._rule("inside_range", threshold_lo=20.0, threshold_hi=80.0)
        assert self._evaluator()._condition_met(50.0, rule) is True

    def test_inside_range_not_met(self):
        rule = self._rule("inside_range", threshold_lo=20.0, threshold_hi=80.0)
        assert self._evaluator()._condition_met(90.0, rule) is False

    def test_no_data_always_false(self):
        rule = self._rule("no_data")
        assert self._evaluator()._condition_met(0.0, rule) is False

    def test_none_value_always_false(self):
        rule = self._rule("gt", threshold_hi=50.0)
        assert self._evaluator()._condition_met(None, rule) is False


# ── State machine tests ────────────────────────────────────────────────────────

class TestStateMachine:
    def test_ok_to_pending_when_condition_met(self, db):
        sensor = _make_sensor(db, "SM1")
        rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=50.0, dwell_seconds=300)
        reading = _make_reading(db, sensor.id, value=60.0)

        AlertEvaluator().evaluate(db, sensor, reading)
        db.commit()

        state = db.get(AlertState, rule.id)
        assert state is not None
        assert state.current_state == "pending"

        events = db.query(AlertEvent).filter(AlertEvent.rule_id == rule.id).all()
        assert len(events) == 1
        assert events[0].state == "pending"

    def test_ok_no_change_when_condition_not_met(self, db):
        sensor = _make_sensor(db, "SM2")
        rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=50.0, dwell_seconds=300)
        reading = _make_reading(db, sensor.id, value=30.0)

        AlertEvaluator().evaluate(db, sensor, reading)
        db.commit()

        state = db.get(AlertState, rule.id)
        assert state is None
        assert db.query(AlertEvent).filter(AlertEvent.rule_id == rule.id).count() == 0

    def test_pending_to_firing_when_dwell_elapsed(self, db):
        sensor = _make_sensor(db, "SM3")
        rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=50.0, dwell_seconds=60)

        # Manually create a pending state with state_since in the past
        past = datetime.now(timezone.utc) - timedelta(seconds=120)
        state = AlertState(
            rule_id=rule.id,
            current_state="pending",
            state_since=past,
            last_value=60.0,
            last_value_at=past,
        )
        db.add(state)
        db.commit()

        reading = _make_reading(db, sensor.id, value=60.0)
        AlertEvaluator().evaluate(db, sensor, reading)
        db.commit()

        state = db.get(AlertState, rule.id)
        assert state.current_state == "firing"

        events = db.query(AlertEvent).filter(AlertEvent.rule_id == rule.id).all()
        assert any(e.state == "firing" for e in events)

    def test_pending_cleared_when_condition_not_met(self, db):
        sensor = _make_sensor(db, "SM4")
        rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=50.0, dwell_seconds=300)

        past = datetime.now(timezone.utc) - timedelta(seconds=30)
        state = AlertState(
            rule_id=rule.id,
            current_state="pending",
            state_since=past,
            last_value=60.0,
            last_value_at=past,
        )
        db.add(state)
        db.commit()

        reading = _make_reading(db, sensor.id, value=30.0)
        AlertEvaluator().evaluate(db, sensor, reading)
        db.commit()

        state = db.get(AlertState, rule.id)
        assert state is None

    def test_firing_to_recovered_auto_clear(self, db):
        sensor = _make_sensor(db, "SM5")
        rule = _make_rule(
            db, sensor.id,
            condition="gt", threshold_hi=50.0,
            dwell_seconds=60, recovery_dwell_seconds=30,
            policy="auto_clear",
        )

        past = datetime.now(timezone.utc) - timedelta(seconds=120)
        state = AlertState(
            rule_id=rule.id,
            current_state="firing",
            state_since=past,
            last_value=60.0,
            last_value_at=past,  # condition was met 120s ago
        )
        db.add(state)
        db.commit()

        reading = _make_reading(db, sensor.id, value=30.0)
        AlertEvaluator().evaluate(db, sensor, reading)
        db.commit()

        state = db.get(AlertState, rule.id)
        assert state is None  # auto_clear deletes the state

        events = db.query(AlertEvent).filter(AlertEvent.rule_id == rule.id).all()
        assert any(e.state == "recovered" for e in events)

    def test_firing_to_awaiting_ack_manual_ack(self, db):
        sensor = _make_sensor(db, "SM6")
        rule = _make_rule(
            db, sensor.id,
            condition="gt", threshold_hi=50.0,
            dwell_seconds=60, recovery_dwell_seconds=30,
            policy="manual_ack",
        )

        past = datetime.now(timezone.utc) - timedelta(seconds=120)
        state = AlertState(
            rule_id=rule.id,
            current_state="firing",
            state_since=past,
            last_value=60.0,
            last_value_at=past,
        )
        db.add(state)
        db.commit()

        reading = _make_reading(db, sensor.id, value=30.0)
        AlertEvaluator().evaluate(db, sensor, reading)
        db.commit()

        state = db.get(AlertState, rule.id)
        assert state is not None
        assert state.current_state == "awaiting_ack"

        events = db.query(AlertEvent).filter(AlertEvent.rule_id == rule.id).all()
        assert any(e.state == "awaiting_ack" for e in events)

    def test_firing_no_change_when_recovery_dwell_not_elapsed(self, db):
        sensor = _make_sensor(db, "SM7")
        rule = _make_rule(
            db, sensor.id,
            condition="gt", threshold_hi=50.0,
            dwell_seconds=60, recovery_dwell_seconds=300,
            policy="auto_clear",
        )

        past = datetime.now(timezone.utc) - timedelta(seconds=10)
        state = AlertState(
            rule_id=rule.id,
            current_state="firing",
            state_since=past,
            last_value=60.0,
            last_value_at=past,
        )
        db.add(state)
        db.commit()

        reading = _make_reading(db, sensor.id, value=30.0)
        AlertEvaluator().evaluate(db, sensor, reading)
        db.commit()

        state = db.get(AlertState, rule.id)
        assert state.current_state == "firing"


# ── Ack endpoint tests ─────────────────────────────────────────────────────────

def _build_alert_test_app(db_engine):
    TestSession = sessionmaker(bind=db_engine, autocommit=False, autoflush=False)

    def override_get_db():
        session = TestSession()
        try:
            yield session
        finally:
            session.close()

    test_app = FastAPI()
    test_app.include_router(alert_router)
    test_app.dependency_overrides[get_db] = override_get_db
    return test_app


class TestAlertAPI:
    def test_ack_firing_event_clears_it(self, db, db_engine):
        sensor = _make_sensor(db, "AckSensor")
        rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=50.0)
        admin = _make_user(db, username="admin_ack", role="admin")

        # Create a firing event and state
        now = datetime.now(timezone.utc)
        event = AlertEvent(
            rule_id=rule.id,
            sensor_id=sensor.id,
            state="firing",
            observed_value=60.0,
            observed_at=now,
        )
        db.add(event)
        state = AlertState(
            rule_id=rule.id,
            current_state="firing",
            state_since=now,
            last_value=60.0,
            last_value_at=now,
        )
        db.add(state)
        db.commit()
        db.refresh(event)

        app = _build_alert_test_app(db_engine)
        app.dependency_overrides[get_current_user] = lambda: admin

        client = TestClient(app, raise_server_exceptions=True)
        resp = client.post(f"/api/alerts/events/{event.id}/ack")
        assert resp.status_code == 200
        data = resp.json()
        assert data["state"] == "cleared"
        assert data["acknowledged_by"] == admin.id

    def test_ack_non_firing_event_returns_409(self, db, db_engine):
        sensor = _make_sensor(db, "Ack409Sensor")
        rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=50.0)
        admin = _make_user(db, username="admin_409", role="admin")

        now = datetime.now(timezone.utc)
        event = AlertEvent(
            rule_id=rule.id,
            sensor_id=sensor.id,
            state="recovered",
            observed_value=30.0,
            observed_at=now,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        app = _build_alert_test_app(db_engine)
        app.dependency_overrides[get_current_user] = lambda: admin

        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post(f"/api/alerts/events/{event.id}/ack")
        assert resp.status_code == 409

    def test_create_rule_returns_201(self, db, db_engine):
        sensor = _make_sensor(db, "RuleSensor")
        admin = _make_user(db, username="admin_rule", role="admin")

        app = _build_alert_test_app(db_engine)
        app.dependency_overrides[get_current_user] = lambda: admin

        client = TestClient(app, raise_server_exceptions=True)
        resp = client.post(
            "/api/alerts/rules",
            json={
                "sensor_id": sensor.id,
                "name": "High Temp",
                "condition": "gt",
                "threshold_hi": 80.0,
                "severity": "warning",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "High Temp"
        assert data["condition"] == "gt"

    def test_delete_rule_returns_204_for_admin(self, db, db_engine):
        sensor = _make_sensor(db, "DelSensor")
        rule = _make_rule(db, sensor.id)
        admin = _make_user(db, username="admin_del", role="admin")

        app = _build_alert_test_app(db_engine)
        app.dependency_overrides[get_current_user] = lambda: admin

        client = TestClient(app, raise_server_exceptions=True)
        resp = client.delete(f"/api/alerts/rules/{rule.id}")
        assert resp.status_code == 204

    def test_delete_rule_returns_403_for_viewer(self, db, db_engine):
        sensor = _make_sensor(db, "ViewerSensor")
        rule = _make_rule(db, sensor.id)
        viewer = _make_user(db, username="viewer_del", role="viewer")

        app = _build_alert_test_app(db_engine)
        app.dependency_overrides[get_current_user] = lambda: viewer

        client = TestClient(app, raise_server_exceptions=False)
        resp = client.delete(f"/api/alerts/rules/{rule.id}")
        assert resp.status_code == 403

    def test_list_active_events_empty(self, db, db_engine):
        admin = _make_user(db, username="admin_list", role="admin")

        app = _build_alert_test_app(db_engine)
        app.dependency_overrides[get_current_user] = lambda: admin

        client = TestClient(app, raise_server_exceptions=True)
        resp = client.get("/api/alerts/events/active")
        assert resp.status_code == 200
        assert resp.json() == []
