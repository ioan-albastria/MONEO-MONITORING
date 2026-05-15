from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.sensor import Sensor
from middleware import get_current_user, requires_role
from routes.response_models.sensor import SensorRead, SensorRangesUpdate
from routes.response_models.analytics import SensorTimeSeriesData
from services.sensor_service import SensorService
from services.sensor_readings_service import SensorReadingsService

sensor_router = APIRouter(prefix="/api/sensors", tags=["sensors"])
_sensor_service = SensorService()
_readings_service = SensorReadingsService()


@sensor_router.get("", response_model=list[SensorRead])
async def get_sensors(
    active_only: bool = Query(False),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _sensor_service.get_all_sensors(db, active_only=active_only)


@sensor_router.get("/{sensor_id}", response_model=SensorRead)
async def get_sensor(
    sensor_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _sensor_service.get_sensor(db, sensor_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@sensor_router.get("/{sensor_id}/readings", response_model=SensorTimeSeriesData)
async def get_sensor_readings(
    sensor_id: int,
    from_timestamp: datetime = Query(default=None),
    to_timestamp: datetime = Query(default=None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    if from_timestamp is None:
        from_timestamp = now - timedelta(hours=24)
    if to_timestamp is None:
        to_timestamp = now
    try:
        return _readings_service.get_sensor_readings(db, sensor_id, from_timestamp, to_timestamp)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@sensor_router.get("/{sensor_id}/latest")
async def get_latest_reading(
    sensor_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = _readings_service.get_latest_reading(db, sensor_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No readings available")
    return result


@sensor_router.patch("/{sensor_id}/active", response_model=SensorRead)
async def set_sensor_active(
    sensor_id: int,
    is_active: bool = Query(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _sensor_service.set_sensor_active(db, sensor_id, is_active)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@sensor_router.put("/{sensor_id}/ranges", response_model=SensorRead)
async def update_sensor_ranges(
    sensor_id: int,
    body: SensorRangesUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin", "operator")),
):
    """Update the normal / warning / critical threshold bands for a sensor.
    Requires admin or operator role.
    """
    sensor = db.get(Sensor, sensor_id)
    if not sensor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sensor not found")
    for field, val in body.model_dump().items():
        setattr(sensor, field, val)
    sensor.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(sensor)
    return sensor
