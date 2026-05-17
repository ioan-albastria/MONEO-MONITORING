from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from DAL import get_db
from middleware import get_current_user
from routes.response_models.analytics import AnalyticsResponse
from services.analytics_service import AnalyticsService
from utils.simple_cache import cache_get, cache_set, make_key

analytics_router = APIRouter(prefix="/api/analytics", tags=["analytics"])
_service = AnalyticsService()


@analytics_router.get("", response_model=AnalyticsResponse)
async def get_analytics(
    sensor_ids: list[int] = Query(..., alias="sensor_id"),
    from_timestamp: datetime = Query(default=None),
    to_timestamp: datetime = Query(default=None),
    aggregated: bool = Query(False),
    bucket_minutes: int = Query(60, ge=1, le=1440),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    if from_timestamp is None:
        from_timestamp = now - timedelta(hours=24)
    if to_timestamp is None:
        to_timestamp = now
    key = make_key(
        sorted(sensor_ids),
        from_timestamp.isoformat(),
        to_timestamp.isoformat(),
        aggregated,
        bucket_minutes,
    )
    cached = cache_get(key)
    if cached is not None:
        return cached

    try:
        result = _service.get_multi_sensor_analytics(
            db,
            sensor_ids,
            from_timestamp,
            to_timestamp,
            aggregated=aggregated,
            bucket_minutes=bucket_minutes,
        )
        cache_set(key, result)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
