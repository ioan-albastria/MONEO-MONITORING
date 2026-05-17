import logging
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from DAL import SessionLocal, Sensor, SensorReading, Asset
from config import settings
from services.alert_evaluator import AlertEvaluator
from services.moneo_api_client import MoneoApiClient

logger = logging.getLogger(__name__)


class MoneoPoller:
    """Polls the MONEO API and persists sensor readings to the database."""

    def __init__(self):
        self.client = MoneoApiClient()

    async def poll_latest_readings(self):
        """Fetch the latest reading for every active sensor and store it."""
        db = SessionLocal()
        try:
            # Eager-load asset to avoid N+1 queries across sensors.
            sensors = (
                db.query(Sensor)
                .filter(Sensor.is_active == True)
                .options(joinedload(Sensor.asset))
                .all()
            )
            new_readings = 0

            for sensor in sensors:
                # Both the parent device id and the deep datasource ref are required
                # by /processdata. Skip with a single WARNING if either is missing.
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

                try:
                    envelope = await self.client.get_processdata(
                        device_id=sensor.asset.moneo_asset_id,
                        datasource_id=sensor.moneo_datasource_ref,
                        page_size=1,
                    )
                except Exception as e:
                    logger.error("Sensor %d: get_processdata failed: %s", sensor.id, e)
                    continue

                for raw in envelope.get("data", []):
                    raw_ts = raw.get("timestamp")
                    if raw_ts is None:
                        continue

                    # Live API returns UTC int64 milliseconds.
                    # datetime.fromisoformat() would raise TypeError on an int.
                    timestamp = datetime.fromtimestamp(raw_ts / 1000, tz=timezone.utc)

                    reading = SensorReading(
                        sensor_id=sensor.id,
                        value=raw.get("value"),
                        timestamp=timestamp,
                        # "quality" is documented but omitted from live responses;
                        # fall back to "ok" to keep the column non-null.
                        status=raw.get("quality", "ok"),
                    )

                    # Portable ON CONFLICT DO NOTHING via savepoint:
                    #   A SAVEPOINT rolls back only the nested transaction on IntegrityError,
                    #   leaving the outer transaction intact. This works on both PostgreSQL
                    #   and SQLite (both support SAVEPOINTs via ANSI SQL), so the same code
                    #   path covers production Postgres and the in-memory SQLite test fixture.
                    #   The Postgres-native alternative — sqlalchemy.dialects.postgresql.insert
                    #   with on_conflict_do_nothing() — is faster for bulk inserts but not
                    #   SQLite-portable; savepoints are the right choice here since Slice 1
                    #   only inserts one row per sensor per poll cycle.
                    try:
                        with db.begin_nested():
                            db.add(reading)
                            db.flush()
                        # Only reached when the INSERT succeeded (no duplicate).
                        sensor.last_seen_at = timestamp
                        new_readings += 1
                        if settings.alert_evaluation_enabled:
                            AlertEvaluator().evaluate(db, sensor, reading)
                    except IntegrityError:
                        pass  # duplicate (sensor_id, timestamp) — already stored

            db.commit()
            logger.info(
                "Poll complete: %d new readings from %d active sensors",
                new_readings,
                len(sensors),
            )
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
