import pytest
from services.auth_service import AuthService
from DAL.models.sensor import Sensor
from routes.response_models.sensor import SensorRangesUpdate


def _make_sensor(db, name="TempSensor") -> Sensor:
    s = Sensor(
        moneo_sensor_id=f"ms-{name}",
        name=name,
        sensor_type="temperature",
        unit="°C",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


# ── SensorRangesUpdate model ──────────────────────────────────────────────────

def test_ranges_update_all_optional():
    body = SensorRangesUpdate()
    assert body.normal_min is None
    assert body.ranges_source == "manual"


def test_ranges_update_partial():
    body = SensorRangesUpdate(normal_min=10.0, normal_max=80.0)
    assert body.normal_min == 10.0
    assert body.normal_max == 80.0
    assert body.warning_min is None


# ── Sensor model range columns ────────────────────────────────────────────────

def test_sensor_range_columns_default_null(db):
    s = _make_sensor(db)
    assert s.normal_min is None
    assert s.critical_max is None
    assert s.ranges_source == "manual"


def test_sensor_range_columns_set_and_persist(db):
    s = _make_sensor(db)
    s.normal_min  = 10.0
    s.normal_max  = 80.0
    s.warning_min = 5.0
    s.warning_max = 90.0
    s.critical_min = 0.0
    s.critical_max = 100.0
    s.ranges_source = "auto"
    db.commit()
    db.refresh(s)
    assert s.normal_min  == 10.0
    assert s.normal_max  == 80.0
    assert s.warning_min == 5.0
    assert s.warning_max == 90.0
    assert s.critical_min == 0.0
    assert s.critical_max == 100.0
    assert s.ranges_source == "auto"


def test_sensor_ranges_update_via_model_dump(db):
    """Simulate what PUT /{sensor_id}/ranges does: apply body.model_dump() to sensor."""
    s = _make_sensor(db)
    body = SensorRangesUpdate(normal_min=20.0, normal_max=75.0, ranges_source="manual")
    for field, val in body.model_dump().items():
        setattr(s, field, val)
    db.commit()
    db.refresh(s)
    assert s.normal_min == 20.0
    assert s.normal_max == 75.0
    assert s.warning_min is None   # not set in body — should remain None


def test_sensor_ranges_cleared_when_set_to_none(db):
    s = _make_sensor(db)
    s.normal_min = 10.0
    db.commit()
    body = SensorRangesUpdate(normal_min=None)
    for field, val in body.model_dump().items():
        setattr(s, field, val)
    db.commit()
    db.refresh(s)
    assert s.normal_min is None


# ── sensor_service integration ────────────────────────────────────────────────

def test_sensor_not_found_returns_none(db):
    result = db.get(Sensor, 9999)
    assert result is None


def test_sensor_update_ranges_source(db):
    s = _make_sensor(db)
    s.ranges_source = "moneo"
    db.commit()
    db.refresh(s)
    assert s.ranges_source == "moneo"


def test_multiple_sensors_independent_ranges(db):
    s1 = _make_sensor(db, "Sensor1")
    s2 = _make_sensor(db, "Sensor2")
    s1.normal_max = 50.0
    s2.normal_max = 99.0
    db.commit()
    db.refresh(s1)
    db.refresh(s2)
    assert s1.normal_max == 50.0
    assert s2.normal_max == 99.0
