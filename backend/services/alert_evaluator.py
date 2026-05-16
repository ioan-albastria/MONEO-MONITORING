import logging
from datetime import datetime, timezone

from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from DAL.models.alert_event import AlertEvent
from DAL.models.alert_notification_outbox import AlertNotificationOutbox
from DAL.models.alert_route import AlertRoute
from DAL.models.alert_rule import AlertRule
from DAL.models.alert_state import AlertState
from DAL.models.annotation import Annotation
from DAL.models.sensor import Sensor
from DAL.models.sensor_reading import SensorReading

logger = logging.getLogger(__name__)

_SEVERITY_COLOR = {"warning": "#f5b428", "critical": "#e64b3c"}


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
                    firing_event = self._write_event(db, rule, "firing", observed_value, now)
                    self._write_annotation(
                        db, rule, firing_event,
                        kind="alert",
                        label=f"[{rule.severity.upper()}] {rule.name}",
                        started_at=now,
                        color=_SEVERITY_COLOR.get(rule.severity, "#8898aa"),
                    )
                    self._check_flapping(db, rule, state, "fired", now)
                    self._enqueue_notifications(db, rule, firing_event)

        elif current == "pending":
            if condition_met:
                state.last_value = observed_value
                state.last_value_at = now
                elapsed = (now - state.state_since).total_seconds()
                if elapsed >= rule.dwell_seconds:
                    state.current_state = "firing"
                    state.state_since = now
                    firing_event = self._write_event(db, rule, "firing", observed_value, now)
                    self._write_annotation(
                        db, rule, firing_event,
                        kind="alert",
                        label=f"[{rule.severity.upper()}] {rule.name}",
                        started_at=now,
                        color=_SEVERITY_COLOR.get(rule.severity, "#8898aa"),
                    )
                    self._check_flapping(db, rule, state, "fired", now)
                    self._enqueue_notifications(db, rule, firing_event)
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
                        recovered_event = self._write_event(db, rule, "recovered", observed_value, now)
                        self._close_open_annotation(db, rule, now)
                        self._check_flapping(db, rule, state, "recovered", now)
                        self._enqueue_notifications(db, rule, recovered_event)
                        db.delete(state)
                    else:
                        state.current_state = "awaiting_ack"
                        state.state_since = now
                        awaiting_event = self._write_event(db, rule, "awaiting_ack", observed_value, now)
                        self._close_open_annotation(db, rule, now)
                        self._check_flapping(db, rule, state, "recovered", now)
                        self._enqueue_notifications(db, rule, awaiting_event)

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
    ) -> AlertEvent:
        event = AlertEvent(
            rule_id=rule.id,
            sensor_id=rule.sensor_id,
            state=state,
            observed_value=observed_value,
            observed_at=observed_at,
        )
        db.add(event)
        return event

    def _write_annotation(
        self,
        db: Session,
        rule: AlertRule,
        event: AlertEvent,
        kind: str,
        label: str,
        started_at: datetime,
        ended_at: datetime | None = None,
        color: str | None = None,
    ) -> Annotation:
        ann = Annotation(
            kind=kind,
            scope_kind="sensor",
            scope_id=rule.sensor_id,
            label=label,
            started_at=started_at,
            ended_at=ended_at,
            color=color,
            source_event_id=event.id,
        )
        db.add(ann)
        return ann

    def _close_open_annotation(self, db: Session, rule: AlertRule, now: datetime) -> None:
        open_ann = (
            db.query(Annotation)
            .filter(
                Annotation.source_event_id.in_(
                    db.query(AlertEvent.id).filter(
                        AlertEvent.rule_id == rule.id,
                        AlertEvent.state == "firing",
                    )
                ),
                Annotation.ended_at.is_(None),
            )
            .order_by(Annotation.started_at.desc())
            .first()
        )
        if open_ann:
            open_ann.ended_at = now

    def _enqueue_notifications(
        self,
        db: Session,
        rule: AlertRule,
        event: AlertEvent,
    ) -> None:
        """Match the fired/recovered event to AlertRoute records and enqueue outbox rows."""
        is_firing = event.state in ("firing", "flapping_started")
        is_recovering = event.state in ("recovered", "awaiting_ack", "flapping_stopped")

        if not is_firing and not is_recovering:
            return

        trigger_col = AlertRoute.on_fire if is_firing else AlertRoute.on_recover

        routes = (
            db.query(AlertRoute)
            .filter(
                AlertRoute.is_enabled == True,
                trigger_col == True,
                or_(
                    AlertRoute.scope_kind == "all",
                    and_(AlertRoute.scope_kind == "rule",     AlertRoute.scope_id == rule.id),
                    and_(AlertRoute.scope_kind == "sensor",   AlertRoute.scope_id == rule.sensor_id),
                    and_(AlertRoute.scope_kind == "severity", AlertRoute.scope_severity == rule.severity),
                ),
            )
            .all()
        )

        payload = {
            "subject":        f"[{rule.severity.upper()}] {rule.name}",
            "body":           (
                f"Alert '{rule.name}' is {event.state}. "
                f"Value: {event.observed_value if event.observed_value is not None else 'N/A'}"
            ),
            "rule_id":        rule.id,
            "rule_name":      rule.name,
            "severity":       rule.severity,
            "sensor_id":      rule.sensor_id,
            "event_state":    event.state,
            "observed_value": event.observed_value,
            "observed_at":    event.observed_at.isoformat() if event.observed_at else None,
        }

        for route in routes:
            entry = AlertNotificationOutbox(
                event_id=event.id,
                route_id=route.id,
                channel=route.channel,
                target=route.target,
                payload=payload,
                status="pending",
            )
            db.add(entry)

    def _check_flapping(
        self,
        db: Session,
        rule: AlertRule,
        state: AlertState,
        transition: str,
        now: datetime,
    ) -> None:
        """Increment the 10-minute flap counter and toggle is_flapping."""
        # Reset counter if the last tracked flip was > 10 minutes ago
        if state.last_value_at and (now - state.last_value_at).total_seconds() > 600:
            state.flap_count_10m = 0
            if state.is_flapping:
                state.is_flapping = False
                self._write_event(db, rule, "flapping_stopped", state.last_value, now)

        state.flap_count_10m += 1

        if state.flap_count_10m >= 4 and not state.is_flapping:
            state.is_flapping = True
            self._write_event(db, rule, "flapping_started", state.last_value, now)
        elif state.flap_count_10m < 4 and state.is_flapping:
            state.is_flapping = False
            self._write_event(db, rule, "flapping_stopped", state.last_value, now)

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
