from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session, joinedload

from DAL import User, Sensor, get_db
from middleware import get_current_user
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
    if sensor.moneo_datasource_ref is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Sensor moneo_datasource_ref not populated — run a metadata sync first",
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
    datasource_id = sensor.moneo_datasource_ref
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


@moneo_router.get("/sensors/{sensor_id}/readings", response_model=list[Any])
async def get_moneo_sensor_readings(
    sensor_id: str,
    from_timestamp: datetime = Query(default=None),
    to_timestamp: datetime = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Debug proxy: fetch historical processdata readings for a sensor via /processdata."""
    if from_timestamp is None or to_timestamp is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_timestamp and to_timestamp are required",
        )
    sensor = _resolve_sensor_for_processdata(sensor_id, db)
    device_id = sensor.asset.moneo_asset_id
    datasource_id = sensor.moneo_datasource_ref
    from_ms = int(from_timestamp.timestamp() * 1000)
    to_ms = int(to_timestamp.timestamp() * 1000)
    try:
        envelope = await _with_moneo_client(
            lambda client: client.get_processdata(
                device_id=device_id,
                datasource_id=datasource_id,
                from_ms=from_ms,
                to_ms=to_ms,
            )
        )
        return envelope.get("data", [])
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
async def trigger_metadata_sync(current_user: User = Depends(get_current_user)):
    """Manually trigger metadata sync from MONEO (admin only)."""
    if current_user.username != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    poller = MoneoPoller()
    try:
        await poller.sync_sensor_metadata()
        return {"status": "success", "message": "Metadata sync triggered"}
    finally:
        await poller.close()
