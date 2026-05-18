from sqlalchemy.orm import Session, joinedload

from DAL import Sensor
from DAL.models.sensor_reading import SensorReading
from routes.response_models.sensor import SensorRead


class SensorService:

    def get_all_sensors(self, db: Session, active_only: bool = False) -> list[SensorRead]:
        query = db.query(Sensor).options(joinedload(Sensor.asset))
        if active_only:
            query = query.filter(Sensor.is_active == True)
        sensors = query.order_by(Sensor.name).all()

        # Single query: which sensor IDs have at least one reading row?
        ids_with_readings: set[int] = {
            row[0]
            for row in db.query(SensorReading.sensor_id).distinct().all()
        }

        return [
            SensorRead.model_validate(s).model_copy(
                update={"has_readings": s.id in ids_with_readings}
            )
            for s in sensors
        ]

    def get_sensor(self, db: Session, sensor_id: int) -> SensorRead:
        sensor = (
            db.query(Sensor)
            .options(joinedload(Sensor.asset))
            .filter(Sensor.id == sensor_id)
            .first()
        )
        if not sensor:
            raise ValueError("Sensor not found")
        return SensorRead.model_validate(sensor)

    def set_sensor_active(self, db: Session, sensor_id: int, is_active: bool) -> SensorRead:
        sensor = db.query(Sensor).filter(Sensor.id == sensor_id).first()
        if not sensor:
            raise ValueError("Sensor not found")
        sensor.is_active = is_active
        db.commit()
        # Re-query with joinedload so asset_path is available
        sensor = (
            db.query(Sensor)
            .options(joinedload(Sensor.asset))
            .filter(Sensor.id == sensor_id)
            .first()
        )
        return SensorRead.model_validate(sensor)
