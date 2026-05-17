from datetime import datetime, timedelta, timezone

import pytest

from DAL.models.alert_event import AlertEvent
from DAL.models.alert_rule import AlertRule
from DAL.models.alert_state import AlertState
from DAL.models.annotation import Annotation
from DAL.models.sensor import Sensor
from DAL.models.sensor_reading import SensorReading
from services.alert_evaluator import AlertEvaluator


def _make_sensor(db, moneo_sensor_id="S1"):
    s = Sensor(moneo_sensor_id=moneo_sensor_id, name="Test Sensor",
               sensor_type="temperature", unit="°C")
    db.add(s); db.commit(); db.refresh(s)
    return s


def _make_rule(db, sensor_id, *,
               condition="gt",
               threshold_hi=100.0,
               threshold_lo=None,
               severity="warning",
               dwell_seconds=0,
               recovery_dwell_seconds=0,
               policy="auto_clear",
               is_enabled=True):
    r = AlertRule(
        sensor_id=sensor_id,
        name="Test Rule",
        condition=condition,
        threshold_hi=threshold_hi,
        threshold_lo=threshold_lo,
        severity=severity,
        dwell_seconds=dwell_seconds,
        recovery_dwell_seconds=recovery_dwell_seconds,
        policy=policy,
        is_enabled=is_enabled,
    )
    db.add(r); db.commit(); db.refresh(r)
    return r


def _make_reading(db, sensor_id, value):
    r = SensorReading(sensor_id=sensor_id, value=value,
                      timestamp=datetime.utcnow())
    db.add(r); db.commit(); db.refresh(r)
    return r


@pytest.fixture
def evaluator():
    return AlertEvaluator()


def test_no_rules_creates_no_state(db, evaluator):
    sensor = _make_sensor(db)
    reading = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()
    assert db.query(AlertState).count() == 0
    assert db.query(AlertEvent).count() == 0


def test_disabled_rule_is_skipped(db, evaluator):
    sensor = _make_sensor(db)
    _make_rule(db, sensor.id, threshold_hi=100.0, is_enabled=False)
    reading = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()
    assert db.query(AlertState).count() == 0
    assert db.query(AlertEvent).count() == 0


def test_no_data_rule_skipped_by_evaluate(db, evaluator):
    sensor = _make_sensor(db)
    _make_rule(db, sensor.id, condition="no_data", threshold_hi=100.0)
    reading = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()
    assert db.query(AlertState).count() == 0


def test_gt_below_threshold_no_state(db, evaluator):
    sensor = _make_sensor(db)
    _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0)
    reading = _make_reading(db, sensor.id, 50.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()
    assert db.query(AlertState).count() == 0


def test_gt_zero_dwell_fires_immediately(db, evaluator):
    sensor = _make_sensor(db)
    rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0, dwell_seconds=0)
    reading = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()
    state = db.get(AlertState, rule.id)
    assert state is not None
    assert state.current_state == "firing"
    assert db.query(AlertEvent).filter_by(rule_id=rule.id, state="firing").count() == 1


def test_gt_positive_dwell_creates_pending(db, evaluator):
    sensor = _make_sensor(db)
    rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0, dwell_seconds=60)
    reading = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()
    state = db.get(AlertState, rule.id)
    assert state is not None
    assert state.current_state == "pending"


def test_pending_to_firing_after_dwell_elapsed(db, evaluator):
    sensor = _make_sensor(db)
    rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0, dwell_seconds=60)
    reading = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()

    state = db.get(AlertState, rule.id)
    state.state_since = datetime.utcnow() - timedelta(seconds=61)
    db.commit()

    reading2 = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading2)
    db.commit()

    state = db.get(AlertState, rule.id)
    assert state.current_state == "firing"


def test_pending_clears_when_condition_not_met(db, evaluator):
    sensor = _make_sensor(db)
    rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0, dwell_seconds=60)
    reading = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()

    reading2 = _make_reading(db, sensor.id, 50.0)
    evaluator.evaluate(db, sensor, reading2)
    db.commit()

    assert db.get(AlertState, rule.id) is None


def test_firing_auto_clear_on_recovery(db, evaluator):
    sensor = _make_sensor(db)
    rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0,
                      recovery_dwell_seconds=0, policy="auto_clear")
    state = AlertState(
        rule_id=rule.id,
        current_state="firing",
        state_since=datetime.utcnow(),
        last_value=150.0,
        last_value_at=datetime.utcnow() - timedelta(seconds=10),
    )
    db.add(state); db.commit()

    reading = _make_reading(db, sensor.id, 50.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()

    assert db.get(AlertState, rule.id) is None
    assert db.query(AlertEvent).filter_by(state="recovered").count() >= 1


def test_firing_manual_ack_transitions_to_awaiting_ack(db, evaluator):
    sensor = _make_sensor(db)
    rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0,
                      recovery_dwell_seconds=0, policy="manual_ack")
    state = AlertState(
        rule_id=rule.id,
        current_state="firing",
        state_since=datetime.utcnow(),
        last_value=150.0,
        last_value_at=datetime.utcnow() - timedelta(seconds=10),
    )
    db.add(state); db.commit()

    reading = _make_reading(db, sensor.id, 50.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()

    state = db.get(AlertState, rule.id)
    assert state is not None
    assert state.current_state == "awaiting_ack"


def test_firing_creates_annotation(db, evaluator):
    sensor = _make_sensor(db)
    rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0,
                      dwell_seconds=0, severity="warning")
    reading = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()

    assert db.query(Annotation).filter_by(scope_kind="sensor", scope_id=sensor.id).count() == 1
    ann = db.query(Annotation).filter_by(scope_kind="sensor", scope_id=sensor.id).first()
    assert ann.label.startswith("[WARNING]")


def test_recovery_closes_annotation(db, evaluator):
    sensor = _make_sensor(db)
    rule = _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0,
                      dwell_seconds=0, recovery_dwell_seconds=0, policy="auto_clear")

    firing_event = AlertEvent(rule_id=rule.id, sensor_id=sensor.id,
                              state="firing", observed_value=150.0,
                              observed_at=datetime.utcnow())
    db.add(firing_event); db.flush()

    ann = Annotation(kind="alert", scope_kind="sensor", scope_id=sensor.id,
                     label=f"[WARNING] {rule.name}",
                     started_at=datetime.utcnow(),
                     source_event_id=firing_event.id)
    db.add(ann)

    state = AlertState(rule_id=rule.id, current_state="firing",
                       state_since=datetime.utcnow(), last_value=150.0,
                       last_value_at=datetime.utcnow() - timedelta(seconds=10))
    db.add(state); db.commit()

    reading = _make_reading(db, sensor.id, 50.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()

    ann = db.query(Annotation).first()
    assert ann.ended_at is not None


def test_evaluate_no_data_fires_immediately(db, evaluator):
    sensor = _make_sensor(db)
    rule = _make_rule(db, sensor.id, condition="no_data", dwell_seconds=0)
    evaluator.evaluate_no_data(db, sensor, rule)
    db.commit()
    state = db.get(AlertState, rule.id)
    assert state is not None
    assert state.current_state == "firing"


def test_multiple_rules_independent(db, evaluator):
    sensor = _make_sensor(db)
    rule_a = _make_rule(db, sensor.id, condition="gt", threshold_hi=100.0, dwell_seconds=0)
    rule_b = _make_rule(db, sensor.id, condition="lt", threshold_lo=0.0, dwell_seconds=0)

    reading = _make_reading(db, sensor.id, 150.0)
    evaluator.evaluate(db, sensor, reading)
    db.commit()

    assert db.get(AlertState, rule_a.id).current_state == "firing"
    assert db.get(AlertState, rule_b.id) is None
