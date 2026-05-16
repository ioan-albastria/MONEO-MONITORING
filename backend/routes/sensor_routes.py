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


@sensor_router.get("/sparklines")
async def get_sensor_sparklines(
    ids: list[int] = Query(..., description="Sensor IDs"),
    minutes: int = Query(60, ge=5, le=1440),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a 12-point downsampled value array for each requested sensor."""
    from DAL.models.sensor_reading import SensorReading as SR
    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=minutes)
    result = []
    for sid in ids:
        readings = (
            db.query(SR)
            .filter(SR.sensor_id == sid, SR.timestamp >= since)
            .order_by(SR.timestamp.asc())
            .all()
        )
        if not readings:
            result.append({"sensor_id": sid, "points": []})
            continue
        target = 12
        if len(readings) <= target:
            pts = [r.value for r in readings]
        else:
            step = len(readings) / target
            pts = [readings[int(i * step)].value for i in range(target)]
        result.append({"sensor_id": sid, "points": pts})
    return result


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


@sensor_router.get("/{sensor_id}/readings/around")
async def get_readings_around(
    sensor_id: int,
    at: datetime = Query(..., description="Centre timestamp (ISO 8601)"),
    radius: int = Query(10, ge=1, le=50),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return up to `radius` readings before and after `at`, sorted ascending."""
    from DAL.models.sensor_reading import SensorReading as SR
    before = (
        db.query(SR)
        .filter(SR.sensor_id == sensor_id, SR.timestamp <= at)
        .order_by(SR.timestamp.desc())
        .limit(radius)
        .all()
    )
    after = (
        db.query(SR)
        .filter(SR.sensor_id == sensor_id, SR.timestamp > at)
        .order_by(SR.timestamp.asc())
        .limit(radius)
        .all()
    )
    combined = sorted(before + after, key=lambda r: r.timestamp)
    return [{"timestamp": r.timestamp.isoformat(), "value": r.value} for r in combined]


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
