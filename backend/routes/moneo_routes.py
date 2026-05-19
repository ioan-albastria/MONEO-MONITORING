from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session, joinedload

from DAL import User, Sensor, get_db
from middleware import get_current_user, require_admin
from services.moneo_api_client import MoneoApiClient
from services.moneo_poller import MoneoPoller

moneo_router = APIRouter(prefix="/api/moneo", tags=["moneo"])


async def _handle_moneo_error(exc: httpx.HTTPStatusError) -> HTTPException:
    response = exc.response
    detail = response.text
    try:
        detail = response.json()
    except Exception:
        pass
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={
            "message": "MONEO API request failed",
            "status_code": response.status_code,
            "url": str(response.url),
            "body": detail,
        },
    )


async def _with_moneo_client(func):
    client = MoneoApiClient()
    try:
        return await func(client)
    finally:
        await client.close()


def _resolve_sensor_for_processdata(sensor_id: str, db: Session) -> Sensor:
    """Look up sensor by moneo_sensor_id and validate it has the fields needed for /processdata."""
    sensor = (
        db.query(Sensor)
        .options(joinedload(Sensor.asset))
        .filter(Sensor.moneo_sensor_id == sensor_id)
        .first()
    )
    if sensor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sensor not found")
    if sensor.asset is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Sensor has no parent asset — run a metadata sync first",
        )
    return sensor


@moneo_router.get("/devices", response_model=list[Any])
async def get_moneo_devices(current_user=Depends(get_current_user)):
    try:
        return await _with_moneo_client(lambda client: client.get_devices())
    except httpx.HTTPStatusError as exc:
        raise await _handle_moneo_error(exc)


@moneo_router.get("/sensors/{sensor_id}/latest", response_model=Any)
async def get_moneo_sensor_latest(
    sensor_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Debug proxy: fetch the latest processdata reading for a sensor via /processdata."""
    sensor = _resolve_sensor_for_processdata(sensor_id, db)
    device_id = sensor.asset.moneo_asset_id
    datasource_id = sensor.name
    try:
        return await _with_moneo_client(
            lambda client: client.get_processdata(
                device_id=device_id,
                datasource_id=datasource_id,
                page_size=1,
            )
        )
    except httpx.HTTPStatusError as exc:
        raise await _handle_moneo_error(exc)


@moneo_router.get("/sensors/{sensor_id}/readings", response_model=Any)
async def get_moneo_sensor_readings(
    sensor_id: str,
    from_datetime: datetime = Query(
        default=None,
        description="Start of the time range (ISO 8601, UTC).",
        examples={"default": {"value": "2026-04-26T00:00:00Z"}},
    ),
    to_datetime: datetime = Query(
        default=None,
        description="End of the time range (ISO 8601, UTC).",
        examples={"default": {"value": "2026-04-27T00:00:00Z"}},
    ),
    page_number: int = Query(
        default=1,
        ge=1,
        description="Page number to fetch (1-based).",
        examples={"default": {"value": 1}},
    ),
    page_size: int = Query(
        default=500,
        ge=1,
        le=2147483647,
        description="Number of readings per page (default 500, max 2 147 483 647).",
        examples={"default": {"value": 500}},
    ),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Debug proxy: fetch one page of historical processdata readings for a sensor.

    Returns the full MONEO envelope — {pageNumber, pageSize, totalPages, totalCount, data} —
    so callers can detect how many pages remain and request subsequent pages.
    """
    if from_datetime is None or to_datetime is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_datetime and to_datetime are required",
        )
    sensor = _resolve_sensor_for_processdata(sensor_id, db)
    device_id = sensor.asset.moneo_asset_id
    datasource_id = sensor.name
    from_ms = int(from_datetime.timestamp() * 1000)
    to_ms = int(to_datetime.timestamp() * 1000)
    try:
        return await _with_moneo_client(
            lambda client: client.get_processdata(
                device_id=device_id,
                datasource_id=datasource_id,
                from_ms=from_ms,
                to_ms=to_ms,
                page=page_number,
                page_size=page_size,
            )
        )
    except httpx.HTTPStatusError as exc:
        raise await _handle_moneo_error(exc)


@moneo_router.get("/raw/{path:path}", response_model=Any)
async def get_moneo_raw(path: str, request: Request, current_user=Depends(get_current_user)):
    params = dict(request.query_params)
    try:
        return await _with_moneo_client(lambda client: client.raw_get(path, params=params))
    except httpx.HTTPStatusError as exc:
        raise await _handle_moneo_error(exc)


@moneo_router.post("/admin/sync-metadata")
async def trigger_metadata_sync(current_user: User = Depends(require_admin)):
    """Manually trigger metadata sync from MONEO (admin only)."""
    poller = MoneoPoller()
    try:
        await poller.sync_sensor_metadata()
        return {"status": "success", "message": "Metadata sync triggered"}
    finally:
        await poller.close()


@moneo_router.post("/admin/poll-readings")
async def trigger_poll_readings(current_user: User = Depends(require_admin)):
    """Manually trigger a readings poll from MONEO (admin only)."""
    poller = MoneoPoller()
    try:
        await poller.poll_latest_readings()
        return {"status": "success", "message": "Readings poll triggered"}
    finally:
        await poller.close()
