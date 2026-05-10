from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from DAL import Sensor, SensorReading
from routes.response_models.analytics import SensorTimeSeriesData, TimeSeriesPoint


class SensorReadingsService:

    def get_sensor_readings(
        self,
        db: Session,
        sensor_id: int,
        from_timestamp: datetime,
        to_timestamp: datetime,
    ) -> SensorTimeSeriesData:
        sensor = db.query(Sensor).filter(Sensor.id == sensor_id).first()
        if not sensor:
            raise ValueError("Sensor not found")

        readings = (
            db.query(SensorReading)
            .filter(
                SensorReading.sensor_id == sensor_id,
                SensorReading.timestamp >= from_timestamp,
                SensorReading.timestamp <= to_timestamp,
            )
            .order_by(SensorReading.timestamp.asc())
            .all()
        )

        points = [
            TimeSeriesPoint(timestamp=r.timestamp.isoformat(), value=r.value)
            for r in readings
        ]
        stats = self._calculate_stats(readings)
        return SensorTimeSeriesData(
            sensor_id=sensor.id,
            sensor_name=sensor.name,
            unit=sensor.unit,
            points=points,
            **stats,
        )

    def get_multiple_sensor_readings(
        self,
        db: Session,
        sensor_ids: list[int],
        from_timestamp: datetime,
        to_timestamp: datetime,
    ) -> list[SensorTimeSeriesData]:
        return [
            self.get_sensor_readings(db, sid, from_timestamp, to_timestamp)
            for sid in sensor_ids
        ]

    def get_aggregated_readings(
        self,
        db: Session,
        sensor_id: int,
        from_timestamp: datetime,
        to_timestamp: datetime,
        bucket_minutes: int = 60,
    ) -> SensorTimeSeriesData:
        sensor = db.query(Sensor).filter(Sensor.id == sensor_id).first()
        if not sensor:
            raise ValueError("Sensor not found")

        readings = (
            db.query(SensorReading)
            .filter(
                SensorReading.sensor_id == sensor_id,
                SensorReading.timestamp >= from_timestamp,
                SensorReading.timestamp <= to_timestamp,
            )
            .order_by(SensorReading.timestamp.asc())
            .all()
        )

        buckets: dict[datetime, list[float]] = {}
        for reading in readings:
            bucket_ts = reading.timestamp.replace(
                minute=(reading.timestamp.minute // bucket_minutes) * bucket_minutes,
                second=0,
                microsecond=0,
            )
            buckets.setdefault(bucket_ts, []).append(reading.value)

        points = [
            TimeSeriesPoint(
                timestamp=ts.isoformat(),
                value=sum(vals) / len(vals),
            )
            for ts, vals in sorted(buckets.items())
        ]

        return SensorTimeSeriesData(
            sensor_id=sensor.id,
            sensor_name=sensor.name,
            unit=sensor.unit,
            points=points,
        )

    def get_latest_reading(self, db: Session, sensor_id: int) -> dict[str, Any] | None:
        reading = (
            db.query(SensorReading)
            .filter(SensorReading.sensor_id == sensor_id)
            .order_by(SensorReading.timestamp.desc())
            .first()
        )
        if not reading:
            return None
        return {"value": reading.value, "timestamp": reading.timestamp.isoformat(), "status": reading.status}

    @staticmethod
    def _calculate_stats(readings: list[SensorReading]) -> dict:
        if not readings:
            return {"min_value": None, "max_value": None, "avg_value": None}
        values = [r.value for r in readings]
        return {
            "min_value": min(values),
            "max_value": max(values),
            "avg_value": sum(values) / len(values),
        }
