import logging
from datetime import datetime, timezone

from DAL import session_scope
from DAL.models.alert_rule import AlertRule
from DAL.models.sensor import Sensor
from services.alert_evaluator import AlertEvaluator

logger = logging.getLogger(__name__)


async def check_no_data_alerts() -> None:
    """Run every 60 seconds. Fire no_data alerts when sensor.last_seen_at is stale."""
    with session_scope() as db:
        try:
            now = datetime.now(timezone.utc)
            rules = (
                db.query(AlertRule)
                .filter(AlertRule.condition == "no_data", AlertRule.is_enabled == True)
                .all()
            )
            evaluator = AlertEvaluator()
            for rule in rules:
                sensor = db.get(Sensor, rule.sensor_id)
                if not sensor:
                    continue
                no_data_triggered = sensor.last_seen_at is None or (
                    now - sensor.last_seen_at
                ).total_seconds() >= (rule.no_data_seconds or 0)
                if no_data_triggered:
                    evaluator.evaluate_no_data(db, sensor, rule)
            db.commit()
        except Exception as e:
            logger.error("check_no_data_alerts failed: %s", e)
            db.rollback()
