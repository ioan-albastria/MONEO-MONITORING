import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from DAL import session_scope, User
from services.auth_service import AuthService
from services.sensor_readings_service import SensorReadingsService

ws_router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)

# Push cadence matches the backend poll interval (5 s).  See backend/CLAUDE.md
# WebSocket section.  Changing this value does not require a migration but
# the frontend's live-update UX is tuned to this interval.
_WS_PUSH_INTERVAL_SECONDS = 5

_readings_service = SensorReadingsService()
_auth_service = AuthService()

# Keeps track of active connections per sensor so we can broadcast efficiently
_connections: dict[int, set[WebSocket]] = {}


@ws_router.websocket("/ws/sensors/{sensor_id}")
async def sensor_live_feed(
    websocket: WebSocket,
    sensor_id: int,
    token: Optional[str] = Query(default=None),
):
    """
    Streams the latest reading for a sensor every 5 seconds.
    The client connects once and receives push updates automatically.
    Requires a valid JWT passed as ?token=<jwt> in the URL.
    """
    if not token:
        await websocket.close(code=1008)
        return

    try:
        payload = _auth_service.decode_token(token)
    except ValueError:
        await websocket.close(code=1008)
        return

    user_id = payload.get("user_id")
    if not user_id:
        await websocket.close(code=1008)
        return

    with session_scope() as db:
        user = db.query(User).filter(User.id == user_id, User.is_active == True).first()

    if not user:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    _connections.setdefault(sensor_id, set()).add(websocket)
    logger.info("WS client connected for sensor %d", sensor_id)

    try:
        while True:
            with session_scope() as db:
                latest = _readings_service.get_latest_reading(db, sensor_id)

            if latest:
                await websocket.send_json(latest)
            else:
                await websocket.send_json({"sensor_id": sensor_id, "value": None, "timestamp": None})

            await asyncio.sleep(_WS_PUSH_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        logger.info("WS client disconnected for sensor %d", sensor_id)
    except Exception as e:
        logger.error("WS error for sensor %d: %s", sensor_id, e)
    finally:
        _connections.get(sensor_id, set()).discard(websocket)
