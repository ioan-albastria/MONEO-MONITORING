import logging
from datetime import datetime, timezone

from sqlalchemy.orm import joinedload

from DAL import SessionLocal, Sensor, SensorReading, Asset
from config import settings
from services.alert_evaluator import AlertEvaluator
from services.moneo_api_client import MoneoApiClient

logger = logging.getLogger(__name__)


def bulk_upsert_readings(db, sensor_id: int, rows: list[dict]) -> "datetime | None":
    """
    Bulk-insert one page of MONEO process-data rows for a single sensor.

    Uses dialect-specific INSERT … ON CONFLICT DO NOTHING so that overlapping
    windows (e.g. the +1 ms watermark boundary) are handled without exceptions.

    Returns the max-observed timestamp across *all input rows* as a UTC datetime,
    or None if rows is empty.

    Why max-observed, not max-newly-inserted:
      last_seen_at must reflect what MONEO returned, not just what was new.
      If a row already existed (duplicate conflict) it still represents data that
      MONEO has emitted — advancing the watermark past it prevents the next cycle
      from re-fetching the same window forever.
    """
    if not rows:
        return None

    values = []
    max_ts: "datetime | None" = None
    for row in rows:
        raw_ts = row.get("timestamp")
        if raw_ts is None:
            continue
        ts = datetime.fromtimestamp(raw_ts / 1000, tz=timezone.utc)
        values.append({
            "sensor_id": sensor_id,
            "timestamp": ts,
            "value": row["value"],
            # "quality" is documented but omitted from live responses; default to "ok".
            "status": row.get("quality", "ok"),
        })
        if max_ts is None or ts > max_ts:
            max_ts = ts

    if not values:
        return None

    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        stmt = pg_insert(SensorReading).values(values).on_conflict_do_nothing(
            index_elements=["sensor_id", "timestamp"]
        )
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        stmt = sqlite_insert(SensorReading).values(values).on_conflict_do_nothing(
            index_elements=["sensor_id", "timestamp"]
        )
    else:
        raise NotImplementedError(f"Dialect {dialect!r} not supported")

    db.execute(stmt)
    return max_ts


class MoneoPoller:
    """Polls the MONEO API and persists sensor readings to the database."""

    def __init__(self):
        self.client = MoneoApiClient()

    async def poll_latest_readings(self):
        """Watermark-driven catch-up: fetch every point since last_seen_at, paginating
        until caught up or the MAX_BACKFILL_HOURS cap is reached.  After a 30-min outage
        the next cycle automatically recovers all missed readings."""
        db = SessionLocal()
        try:
            sensors = (
                db.query(Sensor)
                .filter(Sensor.is_active == True)
                .options(joinedload(Sensor.asset))
                .all()
            )

            for sensor in sensors:
                # Both ids are required by /processdata; skip with a WARNING if either is absent.
                if sensor.asset is None:
                    logger.warning(
                        "Sensor %d (%s): asset is None — skipping poll (run metadata sync)",
                        sensor.id,
                        sensor.moneo_sensor_id,
                    )
                    continue
                if sensor.moneo_datasource_ref is None:
                    logger.warning(
                        "Sensor %d (%s): moneo_datasource_ref is None — skipping poll (run metadata sync)",
                        sensor.id,
                        sensor.moneo_sensor_id,
                    )
                    continue

                # Compute the fetch window.
                now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
                cap_ms = now_ms - settings.max_backfill_hours * 3600 * 1000

                if sensor.last_seen_at:
                    watermark_ms = int(sensor.last_seen_at.timestamp() * 1000)
                    from_ms = max(watermark_ms + 1, cap_ms)
                    if watermark_ms < cap_ms:
                        gap_s = (cap_ms - watermark_ms) / 1000
                        logger.info(
                            "Sensor %d: last_seen_at is %.0fs older than the %dh backfill cap; "
                            "gap will not be recovered",
                            sensor.id, gap_s, settings.max_backfill_hours,
                        )
                else:
                    from_ms = cap_ms

                to_ms = now_ms

                page = 1
                max_ts_seen: "datetime | None" = None

                while page <= settings.moneo_poll_max_pages_per_sensor:
                    try:
                        env = await self.client.get_processdata(
                            device_id=sensor.asset.moneo_asset_id,
                            datasource_id=sensor.moneo_datasource_ref,
                            from_ms=from_ms,
                            to_ms=to_ms,
                            order="+timestamp",
                            page=page,
                            page_size=500,
                        )
                    except Exception as e:
                        logger.error(
                            "Sensor %d: get_processdata page %d failed: %s",
                            sensor.id, page, e,
                        )
                        break

                    rows = env.get("data") or []
                    if not rows:
                        break

                    page_max_ts = bulk_upsert_readings(db, sensor.id, rows)
                    if page_max_ts is not None:
                        max_ts_seen = (
                            page_max_ts
                            if max_ts_seen is None
                            else max(max_ts_seen, page_max_ts)
                        )

                    total_count = env.get("totalCount") or 0
                    if page * 500 >= total_count:
                        break
                    page += 1
                else:
                    # while-else: runs only when the condition became False (page cap hit),
                    # NOT when the loop was exited via break.
                    logger.warning(
                        "Sensor %d hit max_pages cap (%d); remaining backlog "
                        "will be picked up next cycle",
                        sensor.id,
                        settings.moneo_poll_max_pages_per_sensor,
                    )

                if max_ts_seen is not None:
                    sensor.last_seen_at = max_ts_seen
                    if settings.alert_evaluation_enabled:
                        latest = (
                            db.query(SensorReading)
                            .filter(SensorReading.sensor_id == sensor.id)
                            .order_by(SensorReading.timestamp.desc())
                            .first()
                        )
                        if latest:
                            AlertEvaluator().evaluate(db, sensor, latest)

                # Commit once per sensor so a failure mid-fleet does not lose
                # already-fetched data for sensors processed earlier in this cycle.
                try:
                    db.commit()
                except Exception as e:
                    logger.error("Sensor %d: commit failed: %s", sensor.id, e)
                    db.rollback()

            logger.info("Poll complete: processed %d active sensors", len(sensors))
        except Exception as e:
            logger.error("poll_latest_readings failed: %s", e)
            db.rollback()
        finally:
            db.close()

    async def sync_sensor_metadata(self):
        """Discover devices and sensors from MONEO and upsert them locally."""
        db = SessionLocal()
        try:
            nodes = await self.client.get_devices()
            added_sensors = 0
            added_assets = 0

            # Guard category against None before calling .lower() — the live API always
            # populates it, but a malformed node should not crash the whole sync.
            devices = [
                node for node in nodes
                if node.get("category") and node.get("category").lower() == "device"
            ]
            # Include both DataSource and CalcDataSource nodes as sensors.
            # CalcDataSource count is zero in the live sandbox today, but the schema
            # supports them and we should not silently discard them.
            data_sources = [
                node for node in nodes
                if node.get("category")
                and node.get("category").lower() in ("datasource", "calcdatasource")
            ]

            # Key this map off reference.deviceId (NOT the topology node's own "id").
            # reference.deviceId is the stable identifier used by /processdata and is
            # what Asset.moneo_asset_id stores.
            device_id_to_asset: dict[str, Asset] = {}

            for device in devices:
                ref = device.get("reference", {})
                device_id = ref.get("deviceId") if ref else device.get("id")
                device_name = device.get("name", device_id)

                asset = db.query(Asset).filter(Asset.moneo_asset_id == device_id).first()
                if not asset:
                    asset = Asset(
                        moneo_asset_id=device_id,
                        name=device_name,
                        description=device.get("description"),
                        location=device.get("location"),
                        extra_metadata=device,
                        kind="device",
                    )
                    db.add(asset)
                    db.flush()
                    added_assets += 1

                device_id_to_asset[device_id] = asset

            for data_source in data_sources:
                reference = data_source.get("reference", {})
                device_id = reference.get("deviceId")

                if not device_id or device_id not in device_id_to_asset:
                    continue

                asset = device_id_to_asset[device_id]
                moneo_sensor_id = data_source.get("id")

                existing = db.query(Sensor).filter(
                    Sensor.moneo_sensor_id == moneo_sensor_id
                ).first()

                # Defensive extraction of the nested dataSource sub-object.
                # Any level of the chain can be absent or null, so guard each step.
                ds_info = (reference.get("dataSource") or {})
                unit_info = ds_info.get("unit") or {}
                unit = unit_info.get("symbol", "")

                # Use the upstream category verbatim from reference.dataSource.category
                # rather than hardcoding "dataSource". This preserves the distinction
                # between DataSource and CalcDataSource sensor types.
                sensor_type = ds_info.get("category", data_source.get("category", "DataSource"))

                # The deep id required by /processdata. Stored separately from
                # moneo_sensor_id (the topology node id, our stable public handle).
                moneo_datasource_ref = ds_info.get("id")

                if not existing:
                    sensor = Sensor(
                        moneo_sensor_id=moneo_sensor_id,
                        name=data_source.get("name", moneo_sensor_id),
                        sensor_type=sensor_type,
                        unit=unit,
                        description=data_source.get("description"),
                        asset_id=asset.id,
                        extra_metadata=data_source,
                        moneo_datasource_ref=moneo_datasource_ref,
                    )
                    db.add(sensor)
                    added_sensors += 1
                else:
                    existing.name = data_source.get("name", existing.name)
                    existing.unit = unit
                    existing.moneo_datasource_ref = moneo_datasource_ref

            db.commit()
            logger.info(
                "Metadata sync complete: %d new assets, %d new sensors",
                added_assets,
                added_sensors,
            )
        except Exception as e:
            logger.error("sync_sensor_metadata failed: %s", e)
            db.rollback()
        finally:
            db.close()

    async def close(self):
        await self.client.close()
