import logging
from datetime import datetime, timezone

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
            sensors = db.query(Sensor).filter(Sensor.is_active == True).all()
            new_readings = 0

            for sensor in sensors:
                reading_data = await self.client.get_latest_sensor_reading(sensor.moneo_sensor_id)
                if not reading_data:
                    continue

                raw_ts = reading_data.get("timestamp")
                if not raw_ts:
                    continue

                timestamp = datetime.fromisoformat(raw_ts)

                # Skip if we already have this exact reading stored
                exists = (
                    db.query(SensorReading)
                    .filter(
                        SensorReading.sensor_id == sensor.id,
                        SensorReading.timestamp == timestamp,
                    )
                    .first()
                )
                if exists:
                    continue

                reading = SensorReading(
                    sensor_id=sensor.id,
                    value=reading_data.get("value"),
                    timestamp=timestamp,
                    status=reading_data.get("status", "ok"),
                )
                db.add(reading)
                sensor.last_seen_at = timestamp
                new_readings += 1

                if settings.alert_evaluation_enabled:
                    AlertEvaluator().evaluate(db, sensor, reading)

            db.commit()
            logger.info("Poll complete: %d new readings from %d sensors", new_readings, len(sensors))
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

            # Filter to device and dataSource nodes
            devices = [node for node in nodes if node.get("category").lower() == "device"]
            data_sources = [node for node in nodes if node.get("category").lower() == "datasource"]

            # Build a map of device_id -> asset for quick lookup
            device_id_to_asset = {}

            for device in devices:
                # Use reference.deviceId as the actual device identifier
                ref = device.get("reference", {})
                device_id = ref.get("deviceId") if ref else device.get("id")
                device_name = device.get("name", device_id)

                # Upsert asset record for each device
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
                    db.flush()  # get asset.id before using it
                    added_assets += 1

                device_id_to_asset[device_id] = asset

            # Process dataSource nodes as sensors
            for data_source in data_sources:
                # Extract the device_id this sensor belongs to from the reference
                reference = data_source.get("reference", {})
                device_id = reference.get("deviceId")

                if not device_id or device_id not in device_id_to_asset:
                    # Skip sensors not assigned to a device we're tracking
                    continue

                asset = device_id_to_asset[device_id]
                moneo_sensor_id = data_source.get("id")

                existing = db.query(Sensor).filter(
                    Sensor.moneo_sensor_id == moneo_sensor_id
                ).first()

                # Extract unit from nested structure
                unit = ""
                datasource_info = reference.get("dataSource", {})
                if datasource_info.get("unit"):
                    unit = datasource_info["unit"].get("symbol", "")

                if not existing:
                    sensor = Sensor(
                        moneo_sensor_id=moneo_sensor_id,
                        name=data_source.get("name", moneo_sensor_id),
                        sensor_type="dataSource",
                        unit=unit,
                        description=data_source.get("description"),
                        asset_id=asset.id,
                        extra_metadata=data_source,
                    )
                    db.add(sensor)
                    added_sensors += 1
                else:
                    # Update name/unit in case they changed in MONEO
                    existing.name = data_source.get("name", existing.name)
                    existing.unit = unit

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
