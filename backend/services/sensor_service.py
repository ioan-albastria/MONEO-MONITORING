from sqlalchemy.orm import Session

from DAL import Sensor
from routes.response_models.sensor import SensorRead


class SensorService:

    def get_all_sensors(self, db: Session, active_only: bool = False) -> list[SensorRead]:
        query = db.query(Sensor)
        if active_only:
            query = query.filter(Sensor.is_active == True)
        sensors = query.order_by(Sensor.name).all()
        return [SensorRead.model_validate(s) for s in sensors]

    def get_sensor(self, db: Session, sensor_id: int) -> SensorRead:
        sensor = db.query(Sensor).filter(Sensor.id == sensor_id).first()
        if not sensor:
            raise ValueError("Sensor not found")
        return SensorRead.model_validate(sensor)

    def set_sensor_active(self, db: Session, sensor_id: int, is_active: bool) -> SensorRead:
        sensor = db.query(Sensor).filter(Sensor.id == sensor_id).first()
        if not sensor:
            raise ValueError("Sensor not found")
        sensor.is_active = is_active
        db.commit()
        db.refresh(sensor)
        return SensorRead.model_validate(sensor)
