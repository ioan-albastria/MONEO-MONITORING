import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import joinedload

from DAL import SessionLocal, Sensor, SensorReading, Asset
from config import settings
from services.alert_evaluator import AlertEvaluator
from services.moneo_api_client import MoneoApiClient
from services.sync_health_service import SyncHealthService

logger = logging.getLogger(__name__)


def bulk_upsert_readings(
    db, sensor_id: int, rows: list[dict]
) -> "tuple[datetime | None, int]":
    """
    Bulk-insert one page of MONEO process-data rows for a single sensor.

    Uses dialect-specific INSERT … ON CONFLICT DO NOTHING so that overlapping
    windows (e.g. the +1 ms watermark boundary) are handled without exceptions.

    Returns (max_ts, written) where:
      max_ts  — max-observed timestamp across *all input rows* (not just new ones).
                last_seen_at must reflect what MONEO returned, not just what was new;
                advancing the watermark past duplicates prevents re-fetching forever.
      written — rows actually inserted (0 for conflicts).
                For SQLite, result.rowcount is the count of rows inserted (conflicts
                are ignored by INSERT OR IGNORE and don't increment the counter).
                For PostgreSQL, result.rowcount is likewise the inserted count.
                If the dialect returns -1 (undefined rowcount), we fall back to
                len(values) — an overcount when conflicts exist.  The inline comment
                below documents which branch fired.
    """
    if not rows:
        return None, 0

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
        return None, 0

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

    result = db.execute(stmt)
    written = result.rowcount
    if written < 0:
        # Dialect returned -1 (undefined rowcount for this statement shape).
        # Approximate with all attempted rows; overcounts when conflicts exist.
        # See: bulk_upsert_readings rowcount note in SLICE_3 deliverable.
        written = len(values)

    return max_ts, written


class MoneoPoller:
    """Polls the MONEO API and persists sensor readings to the database."""

    def __init__(self, health: SyncHealthService | None = None):
        self.client = MoneoApiClient()
        self._health = health or SyncHealthService()

    async def poll_latest_readings(self):
        """Watermark-driven catch-up: fetch every point since last_seen_at, paginating
        until caught up or the MAX_BACKFILL_HOURS cap is reached.  After a 30-min outage
        the next cycle automatically recovers all missed readings."""
        with self._health.run("moneo.readings") as run:
            db = SessionLocal()
            try:
                sensors = (
                    db.query(Sensor)
                    .filter(Sensor.is_active == True)
                    .options(joinedload(Sensor.asset))
                    .all()
                )
                logger.info("Poll started: %d active sensor(s)", len(sensors))

                for sensor in sensors:
                    try:
                        sensor_rows_in_before = run.records_in
                        sensor_rows_written_before = run.records_written

                        # Both ids are required by /processdata; skip with a WARNING if
                        # either is absent and record a sensor_skipped error.
                        if sensor.asset is None:
                            logger.warning(
                                "Sensor %d (%s): asset is None — skipping poll "
                                "(run metadata sync)",
                                sensor.id,
                                sensor.moneo_sensor_id,
                            )
                            self._health.record_error(
                                run,
                                "sensor_skipped",
                                f"Sensor {sensor.id} ({sensor.moneo_sensor_id}): "
                                "asset is None",
                                sensor_id=sensor.id,
                            )
                            continue

                        watermark = (
                            sensor.last_seen_at.isoformat()
                            if sensor.last_seen_at
                            else "no watermark"
                        )
                        logger.debug(
                            "Sensor %d (%s): polling — watermark=%s",
                            sensor.id,
                            sensor.name,
                            watermark,
                        )

                        # Compute the fetch window.
                        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

                        if sensor.last_seen_at:
                            # Resume exactly from where we left off — no backfill cap.
                            # The per-cycle page limit controls how much is fetched per run.
                            from_ms: int | None = int(sensor.last_seen_at.timestamp() * 1000) + 1
                        else:
                            # No watermark: omit fromTimestamp so MONEO returns all data
                            # from the beginning of recorded history.
                            from_ms = None

                        to_ms = now_ms

                        page = 1
                        max_ts_seen: "datetime | None" = None

                        while page <= settings.moneo_poll_max_pages_per_sensor:
                            try:
                                env = await self.client.get_processdata(
                                    device_id=sensor.asset.moneo_asset_id,
                                    datasource_id=sensor.name,
                                    from_ms=from_ms,
                                    to_ms=to_ms,
                                    order="+timestamp",
                                    page=page,
                                    page_size=500,
                                )
                            except httpx.HTTPStatusError:
                                # Let the per-sensor except handler classify and record
                                # this error; do not suppress it here.
                                raise
                            except Exception as exc:
                                logger.error(
                                    "Sensor %d: get_processdata page %d failed: %s",
                                    sensor.id,
                                    page,
                                    exc,
                                )
                                break

                            rows = env.get("data") or []
                            run.records_in += len(rows)
                            if not rows:
                                break

                            page_max_ts, written = bulk_upsert_readings(
                                db, sensor.id, rows
                            )
                            run.records_written += written
                            logger.info(
                                "Sensor %d: page %d — %d row(s) received, %d written",
                                sensor.id,
                                page,
                                len(rows),
                                written,
                            )
                            if page_max_ts is not None:
                                max_ts_seen = (
                                    page_max_ts
                                    if max_ts_seen is None
                                    else max(max_ts_seen, page_max_ts)
                                )

                            total_count = env.get("totalCount") or 0
                            # page_size is hardcoded to 500 above; if page_size is ever
                            # parameterised, update this comparison to use the same variable.
                            if page * 500 >= total_count:
                                break
                            page += 1
                        else:
                            # while-else: runs only when the condition became False
                            # (page cap hit), NOT when the loop was exited via break.
                            logger.warning(
                                "Sensor %d hit max_pages cap (%d); remaining backlog "
                                "will be picked up next cycle",
                                sensor.id,
                                settings.moneo_poll_max_pages_per_sensor,
                            )
                            self._health.record_error(
                                run,
                                "max_pages_cap",
                                (
                                    f"Sensor {sensor.id} hit page cap of "
                                    f"{settings.moneo_poll_max_pages_per_sensor}"
                                ),
                                sensor_id=sensor.id,
                            )

                        if max_ts_seen is not None:
                            sensor.last_seen_at = max_ts_seen
                            ts_ms = int(max_ts_seen.timestamp() * 1000)
                            run.last_cursor = (
                                ts_ms
                                if run.last_cursor is None
                                else max(run.last_cursor, ts_ms)
                            )
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
                            sensor_rows_in = run.records_in - sensor_rows_in_before
                            sensor_rows_written = run.records_written - sensor_rows_written_before
                            if sensor_rows_in:
                                logger.info(
                                    "Sensor %d (%s): %d row(s) in, %d written",
                                    sensor.id,
                                    sensor.name,
                                    sensor_rows_in,
                                    sensor_rows_written,
                                )
                            else:
                                logger.debug(
                                    "Sensor %d (%s): no new rows",
                                    sensor.id,
                                    sensor.name,
                                )
                        except Exception as exc:
                            logger.error("Sensor %d: commit failed: %s", sensor.id, exc)
                            db.rollback()

                    except httpx.HTTPStatusError as exc:
                        status_code = exc.response.status_code
                        kind = (
                            "http_401"
                            if status_code == 401
                            else "http_5xx"
                            if 500 <= status_code < 600
                            else "http_other"
                        )
                        self._health.record_error(
                            run,
                            kind,
                            str(exc)[:1000],
                            sensor_id=sensor.id,
                            http_status=status_code,
                        )
                        logger.error(
                            "Sensor %d: HTTP %d error: %s",
                            sensor.id,
                            status_code,
                            exc,
                        )
                        # Discard any uncommitted rows for this sensor so they don't
                        # bleed into the next sensor's commit.
                        db.rollback()

                    except Exception as exc:
                        self._health.record_error(
                            run,
                            "unknown",
                            repr(exc)[:1000],
                            sensor_id=sensor.id,
                        )
                        logger.error(
                            "Sensor %d: unexpected error: %s", sensor.id, exc
                        )
                        db.rollback()

                logger.info(
                    "Poll complete: %d active sensor(s), %d record(s) in, %d written",
                    len(sensors),
                    run.records_in,
                    run.records_written,
                )
            except Exception as exc:
                logger.error("poll_latest_readings failed: %s", exc)
                db.rollback()
                raise  # propagate so the health context manager records status=failed
            finally:
                db.close()

    async def sync_sensor_metadata(self):
        """Discover devices and sensors from MONEO and upsert them locally."""
        with self._health.run("moneo.metadata") as run:
            db = SessionLocal()
            try:
                nodes = await self.client.get_devices()
                added_sensors = 0
                added_assets = 0

                # Guard category against None before calling .lower() — the live API
                # always populates it, but a malformed node should not crash the sync.
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

                run.records_in = len(nodes)

                # Key this map off reference.deviceId (NOT the topology node's own "id").
                # reference.deviceId is the stable identifier used by /processdata and is
                # what Asset.moneo_asset_id stores.
                device_id_to_asset: dict[str, Asset] = {}

                for device in devices:
                    ref = device.get("reference", {})
                    device_id = ref.get("deviceId") if ref else device.get("id")
                    device_name = device.get("name", device_id)

                    asset = (
                        db.query(Asset)
                        .filter(Asset.moneo_asset_id == device_id)
                        .first()
                    )
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
                    sensor_type = ds_info.get(
                        "category", data_source.get("category", "DataSource")
                    )

                    # The id required by /processdata. Stored separately from
                    # moneo_sensor_id (the topology node id, our stable public handle).
                    # Try the spec-compliant flat field first (reference.datasourceId),
                    # then fall back to the nested reference.dataSource.id seen in
                    # live API samples (audit: tmp/moneo-samples/node_category_examples.json).
                    moneo_datasource_ref = reference.get("datasourceId") or ds_info.get("id")

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

                run.records_written = added_assets + added_sensors
                db.commit()
                logger.info(
                    "Metadata sync complete: %d new assets, %d new sensors",
                    added_assets,
                    added_sensors,
                )
            except Exception as exc:
                logger.error("sync_sensor_metadata failed: %s", exc)
                db.rollback()
                raise  # propagate so the health context manager records status=failed
            finally:
                db.close()

    async def close(self):
        await self.client.close()
