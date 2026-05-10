from datetime import datetime, timezone

from sqlalchemy.orm import Session

from routes.response_models.analytics import AnalyticsResponse
from services.sensor_readings_service import SensorReadingsService


class AnalyticsService:

    def __init__(self):
        self._readings_service = SensorReadingsService()

    def get_multi_sensor_analytics(
        self,
        db: Session,
        sensor_ids: list[int],
        from_timestamp: datetime,
        to_timestamp: datetime,
        aggregated: bool = False,
        bucket_minutes: int = 60,
    ) -> AnalyticsResponse:
        if aggregated:
            data = [
                self._readings_service.get_aggregated_readings(
                    db, sid, from_timestamp, to_timestamp, bucket_minutes
                )
                for sid in sensor_ids
            ]
        else:
            data = self._readings_service.get_multiple_sensor_readings(
                db, sensor_ids, from_timestamp, to_timestamp
            )

        return AnalyticsResponse(
            generated_at=datetime.now(timezone.utc),
            range_start=from_timestamp,
            range_end=to_timestamp,
            data=data,
        )
