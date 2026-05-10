import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from DAL import SessionLocal
from services.sensor_readings_service import SensorReadingsService

ws_router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)

_readings_service = SensorReadingsService()

# Keeps track of active connections per sensor so we can broadcast efficiently
_connections: dict[int, set[WebSocket]] = {}


@ws_router.websocket("/ws/sensors/{sensor_id}")
async def sensor_live_feed(websocket: WebSocket, sensor_id: int):
    """
    Streams the latest reading for a sensor every 5 seconds.
    The client connects once and receives push updates automatically.
    """
    await websocket.accept()
    _connections.setdefault(sensor_id, set()).add(websocket)
    logger.info("WS client connected for sensor %d", sensor_id)

    try:
        while True:
            db = SessionLocal()
            try:
                latest = _readings_service.get_latest_reading(db, sensor_id)
            finally:
                db.close()

            if latest:
                await websocket.send_json(latest)
            else:
                await websocket.send_json({"sensor_id": sensor_id, "value": None, "timestamp": None})

            await asyncio.sleep(5)
    except WebSocketDisconnect:
        logger.info("WS client disconnected for sensor %d", sensor_id)
    except Exception as e:
        logger.error("WS error for sensor %d: %s", sensor_id, e)
    finally:
        _connections.get(sensor_id, set()).discard(websocket)
