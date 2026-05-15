import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from DAL.models.alert_event import AlertEvent
from DAL.models.alert_rule import AlertRule
from DAL.models.alert_state import AlertState
from DAL.models.sensor import Sensor
from DAL.models.sensor_reading import SensorReading

logger = logging.getLogger(__name__)


class AlertEvaluator:
    """Streaming evaluator — called once per new reading inside poll_latest_readings().

    Does NOT commit. The caller owns the transaction.
    """

    def evaluate(self, db: Session, sensor: Sensor, reading: SensorReading) -> None:
        now = datetime.now(timezone.utc)
        rules = (
            db.query(AlertRule)
            .filter(
                AlertRule.sensor_id == sensor.id,
                AlertRule.is_enabled == True,
                AlertRule.condition != "no_data",
            )
            .all()
        )
        for rule in rules:
            try:
                state = db.get(AlertState, rule.id)
                condition_met = self._condition_met(reading.value, rule)
                self._apply_state_machine(db, rule, state, condition_met, now, reading.value)
                if rule.condition == "outside_range" and sensor.ranges_source == "from_alert_rule":
                    self._sync_sensor_ranges(db, rule, sensor)
            except Exception:
                logger.exception("AlertEvaluator.evaluate failed for rule %s", rule.id)

    def evaluate_no_data(self, db: Session, sensor: Sensor, rule: AlertRule) -> None:
        now = datetime.now(timezone.utc)
        try:
            state = db.get(AlertState, rule.id)
            self._apply_state_machine(db, rule, state, condition_met=True, now=now, observed_value=None)
        except Exception:
            logger.exception("AlertEvaluator.evaluate_no_data failed for rule %s", rule.id)

    def _condition_met(self, value: float | None, rule: AlertRule) -> bool:
        if value is None:
            return False
        c = rule.condition
        if c == "gt":
            return value > (rule.threshold_hi if rule.threshold_hi is not None else float("inf"))
        if c == "lt":
            return value < (rule.threshold_lo if rule.threshold_lo is not None else float("-inf"))
        if c == "outside_range":
            lo = rule.threshold_lo if rule.threshold_lo is not None else float("-inf")
            hi = rule.threshold_hi if rule.threshold_hi is not None else float("inf")
            return value < lo or value > hi
        if c == "inside_range":
            lo = rule.threshold_lo if rule.threshold_lo is not None else float("-inf")
            hi = rule.threshold_hi if rule.threshold_hi is not None else float("inf")
            return lo <= value <= hi
        return False  # no_data handled separately

    def _apply_state_machine(
        self,
        db: Session,
        rule: AlertRule,
        state: AlertState | None,
        condition_met: bool,
        now: datetime,
        observed_value: float | None,
    ) -> None:
        current = state.current_state if state else "ok"

        if current == "ok":
            if condition_met:
                if state is None:
                    state = AlertState(
                        rule_id=rule.id,
                        current_state="pending",
                        state_since=now,
                        last_value=observed_value,
                        last_value_at=now,
                    )
                    db.add(state)
                else:
                    state.current_state = "pending"
                    state.state_since = now
                    state.last_value = observed_value
                    state.last_value_at = now
                self._write_event(db, rule, "pending", observed_value, now)
                # Immediately check dwell in case dwell_seconds == 0
                elapsed = (now - state.state_since).total_seconds()
                if elapsed >= rule.dwell_seconds:
                    state.current_state = "firing"
                    state.state_since = now
                    self._write_event(db, rule, "firing", observed_value, now)

        elif current == "pending":
            if condition_met:
                state.last_value = observed_value
                state.last_value_at = now
                elapsed = (now - state.state_since).total_seconds()
                if elapsed >= rule.dwell_seconds:
                    state.current_state = "firing"
                    state.state_since = now
                    self._write_event(db, rule, "firing", observed_value, now)
            else:
                db.delete(state)

        elif current == "firing":
            if condition_met:
                state.last_value = observed_value
                state.last_value_at = now
            else:
                last_met_at = state.last_value_at or state.state_since
                recovery_elapsed = (now - last_met_at).total_seconds()
                if recovery_elapsed >= rule.recovery_dwell_seconds:
                    if rule.policy == "auto_clear":
                        state.current_state = "recovered"
                        state.state_since = now
                        self._write_event(db, rule, "recovered", observed_value, now)
                        db.delete(state)
                    else:
                        state.current_state = "awaiting_ack"
                        state.state_since = now
                        self._write_event(db, rule, "awaiting_ack", observed_value, now)

        elif current == "awaiting_ack":
            # Stays until explicitly ACK'd via the API
            state.last_value = observed_value
            state.last_value_at = now

        elif current == "recovered":
            if condition_met:
                state.current_state = "pending"
                state.state_since = now
                state.last_value = observed_value
                state.last_value_at = now
                self._write_event(db, rule, "pending", observed_value, now)

    def _write_event(
        self,
        db: Session,
        rule: AlertRule,
        state: str,
        observed_value: float | None,
        observed_at: datetime,
    ) -> None:
        event = AlertEvent(
            rule_id=rule.id,
            sensor_id=rule.sensor_id,
            state=state,
            observed_value=observed_value,
            observed_at=observed_at,
        )
        db.add(event)

    def _sync_sensor_ranges(self, db: Session, rule: AlertRule, sensor: Sensor) -> None:
        if rule.condition != "outside_range":
            return
        if rule.severity == "warning":
            sensor.warning_min = rule.threshold_lo
            sensor.warning_max = rule.threshold_hi
            if rule.recovery_lo is not None:
                sensor.critical_min = rule.recovery_lo
            if rule.recovery_hi is not None:
                sensor.critical_max = rule.recovery_hi
        else:
            sensor.critical_min = rule.threshold_lo
            sensor.critical_max = rule.threshold_hi
        sensor.ranges_source = "from_alert_rule"
