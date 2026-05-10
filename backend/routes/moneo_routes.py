from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from middleware import get_current_user
from services.moneo_api_client import MoneoApiClient
from services.moneo_poller import MoneoPoller
from DAL import User

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


@moneo_router.get("/devices", response_model=list[Any])
async def get_moneo_devices(current_user=Depends(get_current_user)):
    try:
        return await _with_moneo_client(lambda client: client.get_devices())
    except httpx.HTTPStatusError as exc:
        raise await _handle_moneo_error(exc)


@moneo_router.get("/devices/{device_id}/sensors", response_model=list[Any])
async def get_moneo_device_sensors(device_id: str, current_user=Depends(get_current_user)):
    try:
        return await _with_moneo_client(lambda client: client.get_device_sensors(device_id))
    except httpx.HTTPStatusError as exc:
        raise await _handle_moneo_error(exc)


@moneo_router.get("/sensors/{sensor_id}/latest", response_model=Any)
async def get_moneo_sensor_latest(sensor_id: str, current_user=Depends(get_current_user)):
    try:
        return await _with_moneo_client(lambda client: client.get_latest_sensor_reading(sensor_id))
    except httpx.HTTPStatusError as exc:
        raise await _handle_moneo_error(exc)


@moneo_router.get("/sensors/{sensor_id}/readings", response_model=list[Any])
async def get_moneo_sensor_readings(
    sensor_id: str,
    from_timestamp: datetime = Query(default=None),
    to_timestamp: datetime = Query(default=None),
    current_user=Depends(get_current_user),
):
    if from_timestamp is None or to_timestamp is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_timestamp and to_timestamp are required",
        )
    try:
        return await _with_moneo_client(
            lambda client: client.get_sensor_readings(sensor_id, from_timestamp, to_timestamp)
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
