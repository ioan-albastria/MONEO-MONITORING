import pytest
from DAL.models.alert_rule import AlertRule
from DAL.models.alert_state import AlertState
from DAL.models.sensor import Sensor


def _make_sensor(db, name="TestSensor") -> Sensor:
    s = Sensor(moneo_sensor_id=f"ms-{name}", name=name,
               sensor_type="temperature", unit="°C")
    db.add(s); db.commit(); db.refresh(s)
    return s


def _make_rule(db, sensor_id: int, *, condition="gt", threshold_hi=100.0,
               severity="warning", dwell_seconds=60, name="High Temp") -> AlertRule:
    r = AlertRule(
        sensor_id=sensor_id, name=name, condition=condition,
        threshold_hi=threshold_hi, severity=severity,
        dwell_seconds=dwell_seconds, is_enabled=True,
    )
    db.add(r); db.commit(); db.refresh(r)
    return r


# ── create ────────────────────────────────────────────────────────────────

def test_create_rule(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    assert r.id is not None
    assert r.sensor_id == s.id
    assert r.condition == "gt"
    assert r.threshold_hi == 100.0
    assert r.severity == "warning"
    assert r.is_enabled is True
    assert r.policy == "auto_clear"
    assert r.dwell_seconds == 60
    assert r.recovery_dwell_seconds == 30


def test_rule_threshold_lo_hi(db):
    s = _make_sensor(db)
    r = AlertRule(sensor_id=s.id, name="Range", condition="outside_range",
                  threshold_lo=10.0, threshold_hi=90.0, severity="warning")
    db.add(r); db.commit(); db.refresh(r)
    assert r.threshold_lo == 10.0
    assert r.threshold_hi == 90.0


def test_rule_description_optional(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    assert r.description is None


def test_rule_with_description(db):
    s = _make_sensor(db)
    r = AlertRule(sensor_id=s.id, name="WithDesc", condition="gt",
                  threshold_hi=80.0, severity="critical", description="Too hot")
    db.add(r); db.commit(); db.refresh(r)
    assert r.description == "Too hot"


# ── query ─────────────────────────────────────────────────────────────────

def test_query_rules_for_sensor(db):
    s = _make_sensor(db)
    _make_rule(db, s.id, name="R1")
    _make_rule(db, s.id, name="R2")
    rules = db.query(AlertRule).filter(AlertRule.sensor_id == s.id).all()
    assert len(rules) == 2


def test_query_rules_empty_for_new_sensor(db):
    s = _make_sensor(db)
    rules = db.query(AlertRule).filter(AlertRule.sensor_id == s.id).all()
    assert rules == []


# ── update ────────────────────────────────────────────────────────────────

def test_update_threshold(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id, threshold_hi=100.0)
    r.threshold_hi = 120.0
    db.commit(); db.refresh(r)
    assert r.threshold_hi == 120.0


def test_disable_rule(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    r.is_enabled = False
    db.commit(); db.refresh(r)
    assert r.is_enabled is False


def test_filter_enabled_rules(db):
    s = _make_sensor(db)
    _make_rule(db, s.id, name="Enabled")
    r2 = _make_rule(db, s.id, name="Disabled")
    r2.is_enabled = False; db.commit()
    enabled = (db.query(AlertRule)
               .filter(AlertRule.sensor_id == s.id, AlertRule.is_enabled.is_(True))
               .all())
    assert len(enabled) == 1
    assert enabled[0].name == "Enabled"


# ── delete ────────────────────────────────────────────────────────────────

def test_delete_rule(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    rid = r.id
    db.delete(r); db.commit()
    assert db.get(AlertRule, rid) is None


def test_cascade_delete_when_sensor_deleted(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    rid = r.id
    db.delete(s); db.commit()
    assert db.get(AlertRule, rid) is None


# ── condition / severity / policy values ──────────────────────────────────

def test_all_conditions(db):
    s = _make_sensor(db)
    for cond in ("gt", "lt", "outside_range", "inside_range"):
        r = _make_rule(db, s.id, condition=cond, name=f"r_{cond}")
        assert r.condition == cond


def test_critical_severity(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id, severity="critical")
    assert r.severity == "critical"


def test_manual_ack_policy(db):
    s = _make_sensor(db)
    r = AlertRule(sensor_id=s.id, name="ManualAck", condition="gt",
                  threshold_hi=80.0, severity="warning", policy="manual_ack")
    db.add(r); db.commit(); db.refresh(r)
    assert r.policy == "manual_ack"


def test_multiple_rules_independent(db):
    s1 = _make_sensor(db, "S1")
    s2 = _make_sensor(db, "S2")
    _make_rule(db, s1.id, name="R-S1")
    _make_rule(db, s2.id, name="R-S2")
    assert db.query(AlertRule).count() == 2
    assert db.query(AlertRule).filter(AlertRule.sensor_id == s1.id).count() == 1
