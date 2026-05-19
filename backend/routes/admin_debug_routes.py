# DIAGNOSTIC — admin debug routes for MONEO sync investigation.
# These endpoints expose internal DB state and allow one-shot API probes.
# Search for "# DIAGNOSTIC" to find and remove all debug endpoints before
# production hardening.

from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from DAL import Sensor, SensorReading, User, get_db
from config import settings
from middleware import require_admin
from services.moneo_api_client import MoneoApiClient
from services.moneo_poller import bulk_upsert_readings

admin_debug_router = APIRouter(prefix="/api/admin/debug", tags=["admin-debug"])


# ── Task 2 — sensor map ───────────────────────────────────────────────────────

@admin_debug_router.get("/sensor-map")  # DIAGNOSTIC
def get_sensor_map(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[dict]:
    """Return all active sensors with the IDs the poller would use and the URL it would build."""
    sensors = (
        db.query(Sensor)
        .filter(Sensor.is_active == True)
        .options(joinedload(Sensor.asset))
        .all()
    )

    result = []
    for s in sensors:
        asset_id = s.asset.moneo_asset_id if s.asset else None

        if s.asset is None:
            url_preview = "INCOMPLETE — asset is null"
        else:
            url_preview = (
                f"/processdata/device/{asset_id}"
                f"/datasource/{quote(s.name, safe='-_')}"
            )

        readings_count = (
            db.query(func.count(SensorReading.id))
            .filter(SensorReading.sensor_id == s.id)
            .scalar()
        )

        result.append({
            "sensor_id": s.id,
            "sensor_name": s.name,
            "moneo_sensor_id": s.moneo_sensor_id,
            "moneo_datasource_ref": s.moneo_datasource_ref,
            "asset_name": s.asset.name if s.asset else None,
            "asset_moneo_asset_id": asset_id,
            "processdata_url_preview": url_preview,
            "readings_count": readings_count,
            "last_seen_at": s.last_seen_at.isoformat() if s.last_seen_at else None,
        })

    return result


# ── Task 3 — probe-processdata ────────────────────────────────────────────────

class ProbeProcessdataRequest(BaseModel):
    device_id: str
    datasource_id: str
    from_ms: int
    to_ms: int


@admin_debug_router.post("/probe-processdata")  # DIAGNOSTIC
async def probe_processdata(
    body: ProbeProcessdataRequest,
    _: User = Depends(require_admin),
) -> dict:
    """Fire one raw /processdata call with caller-supplied IDs and return the MONEO response."""
    client = MoneoApiClient()
    url = (
        f"{client.base_url}/processdata/device/{body.device_id}"
        f"/datasource/{body.datasource_id}"
    )
    params = {
        "fromTimestamp": body.from_ms,
        "toTimestamp": body.to_ms,
        "orderBy": "+timestamp",
        "pageNumber": 1,
        "pageSize": 500,
    }
    try:
        response = await client._client.get(url, params=params)
        try:
            data = response.json()
        except Exception:
            data = response.text

        if response.status_code >= 400:
            return {
                "url_called": str(response.url),
                "status_code": response.status_code,
                "error": data if isinstance(data, str) else str(data),
            }

        rows = data.get("data", []) if isinstance(data, dict) else []
        return {
            "url_called": str(response.url),
            "status_code": response.status_code,
            "total_count": data.get("totalCount", 0) if isinstance(data, dict) else 0,
            "page_count": data.get("totalPages", 0) if isinstance(data, dict) else 0,
            "first_rows": rows[:5],
        }
    finally:
        await client.close()


# ── Task 4 — sync-one-sensor ──────────────────────────────────────────────────

@admin_debug_router.post("/sync-one-sensor/{sensor_id}")  # DIAGNOSTIC
async def sync_one_sensor(
    sensor_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    """Run the poll loop for exactly one sensor and return a detailed trace.
    Does NOT create a SyncRun row — health surface data is not polluted."""
    sensor = (
        db.query(Sensor)
        .filter(Sensor.id == sensor_id)
        .options(joinedload(Sensor.asset))
        .first()
    )
    if sensor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sensor not found")

    device_id = sensor.asset.moneo_asset_id if sensor.asset else None
    datasource_id = sensor.name

    result: dict = {
        "sensor_id": sensor.id,
        "sensor_name": sensor.name,
        "device_id_used": device_id,
        "datasource_id_used": datasource_id,
        "from_ms": None,
        "to_ms": None,
        "pages_fetched": 0,
        "records_in": 0,
        "records_written": 0,
        "error": None,
        "new_last_seen_at": None,
    }

    if sensor.asset is None:
        result["error"] = "asset is None — run metadata sync first"
        return result

    if datasource_id is None:
        result["error"] = "moneo_datasource_ref is None — run metadata sync first"
        return result

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    cap_ms = now_ms - settings.max_backfill_hours * 3600 * 1000

    if sensor.last_seen_at:
        watermark_ms = int(sensor.last_seen_at.timestamp() * 1000)
        from_ms = max(watermark_ms + 1, cap_ms)
    else:
        from_ms = cap_ms

    to_ms = now_ms
    result["from_ms"] = from_ms
    result["to_ms"] = to_ms

    client = MoneoApiClient()
    try:
        page = 1
        records_in = 0
        records_written = 0
        max_ts_seen: datetime | None = None

        while page <= settings.moneo_poll_max_pages_per_sensor:
            try:
                env = await client.get_processdata(
                    device_id=device_id,
                    datasource_id=datasource_id,
                    from_ms=from_ms,
                    to_ms=to_ms,
                    order="+timestamp",
                    page=page,
                    page_size=500,
                )
            except httpx.HTTPStatusError as exc:
                result["error"] = (
                    f"HTTP {exc.response.status_code} on page {page}: {exc.response.text[:200]}"
                )
                break
            except Exception as exc:
                result["error"] = f"page {page}: {type(exc).__name__}: {exc}"
                break

            rows = env.get("data") or []
            records_in += len(rows)
            if not rows:
                break

            page_max_ts, written = bulk_upsert_readings(db, sensor.id, rows)
            records_written += written
            if page_max_ts is not None:
                max_ts_seen = (
                    page_max_ts if max_ts_seen is None else max(max_ts_seen, page_max_ts)
                )

            total_count = env.get("totalCount") or 0
            if page * 500 >= total_count:
                break
            page += 1

        result["pages_fetched"] = page
        result["records_in"] = records_in
        result["records_written"] = records_written

        if max_ts_seen is not None:
            sensor.last_seen_at = max_ts_seen
            db.commit()
            result["new_last_seen_at"] = max_ts_seen.isoformat()

        return result

    except Exception as exc:
        db.rollback()
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result
    finally:
        await client.close()
