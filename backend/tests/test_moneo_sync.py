"""
Integration-style tests for the MONEO sync pipeline (Slice 1).

Uses an in-memory SQLite DB created via Base.metadata.create_all() (same pattern
as conftest.py) and AsyncMock stubs in place of the live MONEO API client.

Three scenarios:
  (i)  /nodes response → sensors carry the deep moneo_datasource_ref id.
  (ii) /processdata response → reading row appears; re-poll with same timestamp
       does not insert a duplicate (idempotency via UniqueConstraint + savepoint).
  (iii) CalcDataSource node → persisted as sensor with correct sensor_type.
"""
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from DAL.db_context import Base
from DAL.models.asset import Asset
from DAL.models.sensor import Sensor
from DAL.models.sensor_reading import SensorReading
from services.moneo_poller import MoneoPoller


# ── DB fixture ────────────────────────────────────────────────────────────────

@pytest.fixture
def db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def Session(db_engine):
    return sessionmaker(bind=db_engine, autocommit=False, autoflush=False)


# ── Stub payloads ─────────────────────────────────────────────────────────────

# One Device node + one DataSource node belonging to it.
NODES_DATASOURCE = [
    {
        "id": "node-device-1",
        "category": "Device",
        "name": "Test Device",
        "reference": {"deviceId": "device-uuid-1"},
    },
    {
        "id": "node-sensor-1",
        "category": "DataSource",
        "name": "Temp Sensor",
        "reference": {
            "deviceId": "device-uuid-1",
            "dataSource": {
                "id": "deepid-abc123",
                "category": "DataSource",
                "unit": {"symbol": "°C", "name": "Celsius"},
            },
        },
    },
]

# One Device node + one CalcDataSource node.
NODES_CALCDATASOURCE = [
    {
        "id": "node-device-2",
        "category": "Device",
        "name": "Calc Device",
        "reference": {"deviceId": "device-uuid-2"},
    },
    {
        "id": "node-calcsensor-1",
        "category": "CalcDataSource",
        "name": "Calc Sensor",
        "reference": {
            "deviceId": "device-uuid-2",
            "dataSource": {
                "id": "deepid-calc456",
                "category": "CalcDataSource",
                "unit": {"symbol": "bar"},
            },
        },
    },
]

# Minimal /processdata envelope — one reading at a fixed timestamp.
PROCESSDATA_ONE_READING = {
    "pageNumber": 1,
    "pageSize": 1,
    "totalPages": 1,
    "totalCount": 1,
    "data": [{"timestamp": 1_700_000_000_000, "value": 42.5}],
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_poller() -> MoneoPoller:
    """Instantiate MoneoPoller and replace its HTTP client with a no-op mock."""
    p = MoneoPoller()
    p.client = MagicMock()
    return p


def _count(session, model) -> int:
    return session.query(model).count()


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestMoneoPollSync:

    @pytest.mark.asyncio
    async def test_metadata_sync_stores_deep_datasource_id(self, Session):
        """
        sync_sensor_metadata() must store reference.dataSource.id in
        moneo_datasource_ref — not the topology node's own id field.
        """
        poller = _make_poller()
        poller.client.get_devices = AsyncMock(return_value=NODES_DATASOURCE)

        with patch("services.moneo_poller.SessionLocal", side_effect=Session):
            await poller.sync_sensor_metadata()

        session = Session()
        try:
            sensor = (
                session.query(Sensor)
                .filter(Sensor.moneo_sensor_id == "node-sensor-1")
                .first()
            )
            assert sensor is not None, "Sensor should have been created"
            # The topology node id is "node-sensor-1"; the deep id is "deepid-abc123".
            assert sensor.moneo_datasource_ref == "deepid-abc123", (
                "moneo_datasource_ref must be reference.dataSource.id, not the topology node id"
            )
            assert sensor.sensor_type == "DataSource"
        finally:
            session.close()

    @pytest.mark.asyncio
    async def test_poll_creates_reading_and_is_idempotent(self, Session):
        """
        poll_latest_readings() inserts one reading on first call.
        A second call returning the same timestamp must not produce a duplicate row.
        """
        # Pre-populate: asset and sensor with moneo_datasource_ref set.
        session = Session()
        try:
            asset = Asset(moneo_asset_id="device-uuid-1", name="Dev1")
            session.add(asset)
            session.flush()
            sensor = Sensor(
                moneo_sensor_id="node-sensor-1",
                name="Temp",
                sensor_type="DataSource",
                unit="°C",
                asset_id=asset.id,
                moneo_datasource_ref="deepid-abc123",
            )
            session.add(sensor)
            session.commit()
        finally:
            session.close()

        poller = _make_poller()
        poller.client.get_processdata = AsyncMock(return_value=PROCESSDATA_ONE_READING)

        # First poll — expect one new reading.
        with patch("services.moneo_poller.SessionLocal", side_effect=Session):
            with patch("services.moneo_poller.settings") as mock_cfg:
                mock_cfg.alert_evaluation_enabled = False
                await poller.poll_latest_readings()

        session = Session()
        count_first = _count(session, SensorReading)
        session.close()
        assert count_first == 1, "First poll should create exactly one reading"

        # Second poll with identical timestamp — must be a no-op.
        poller.client.get_processdata = AsyncMock(return_value=PROCESSDATA_ONE_READING)
        with patch("services.moneo_poller.SessionLocal", side_effect=Session):
            with patch("services.moneo_poller.settings") as mock_cfg:
                mock_cfg.alert_evaluation_enabled = False
                await poller.poll_latest_readings()

        session = Session()
        count_second = _count(session, SensorReading)
        session.close()
        assert count_second == 1, "Second poll with same timestamp must not insert a duplicate"

    @pytest.mark.asyncio
    async def test_calcdatasource_node_persisted_as_sensor(self, Session):
        """
        CalcDataSource nodes must be synced by sync_sensor_metadata() and stored
        with their upstream category verbatim (not hardcoded 'dataSource').
        """
        poller = _make_poller()
        poller.client.get_devices = AsyncMock(return_value=NODES_CALCDATASOURCE)

        with patch("services.moneo_poller.SessionLocal", side_effect=Session):
            await poller.sync_sensor_metadata()

        session = Session()
        try:
            sensor = (
                session.query(Sensor)
                .filter(Sensor.moneo_sensor_id == "node-calcsensor-1")
                .first()
            )
            assert sensor is not None, "CalcDataSource node should be persisted as a Sensor"
            assert sensor.sensor_type == "CalcDataSource"
            assert sensor.moneo_datasource_ref == "deepid-calc456"
        finally:
            session.close()
