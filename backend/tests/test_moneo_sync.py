"""
Integration-style tests for the MONEO sync pipeline (Slices 1 and 2).

Uses an in-memory SQLite DB created via Base.metadata.create_all() (same pattern
as conftest.py) and AsyncMock stubs in place of the live MONEO API client.

Slice 1 scenarios:
  (i)   /nodes response → sensors carry the deep moneo_datasource_ref id.
  (ii)  /processdata response → reading row appears; re-poll with same timestamp
        does not insert a duplicate (idempotency via UniqueConstraint + bulk upsert).
  (iii) CalcDataSource node → persisted as sensor with correct sensor_type.

Slice 2 scenarios (TestMoneoSyncSlice2):
  (i)   Watermark resumption: last_seen_at advances to max(returned timestamps).
  (ii)  No cap on watermarked sensors: from_ms = last_seen_at + 1ms, no matter how old.
  (iii) Pagination: totalCount=1200 triggers three pages; idempotent on re-run.
  (iv)  Backoff: 503×2 then 200 → success in 3 attempts; 401 → 1 attempt, no retry.
  (v)   First-poll-ever: no last_seen_at → from_ms omitted (MONEO returns from beginning).
  (vi)  Page-cap safety: loop exits after moneo_poll_max_pages_per_sensor pages.
"""
import logging
import pytest
import pytest_asyncio
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch, call

import httpx
from datetime import datetime, timezone
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

def _make_no_op_health():
    """Return a mock SyncHealthService whose run() is a no-op context manager."""
    mock_health = MagicMock()
    mock_run = MagicMock()
    # Attributes mutated by the poller must be real ints so += works.
    mock_run.error_count = 0
    mock_run.records_in = 0
    mock_run.records_written = 0
    mock_run.last_cursor = None

    @contextmanager
    def _run_ctx(source):
        yield mock_run

    mock_health.run = _run_ctx
    mock_health.record_error = MagicMock()
    return mock_health


def _make_poller() -> MoneoPoller:
    """Instantiate MoneoPoller and replace its HTTP client and health service with mocks."""
    p = MoneoPoller()
    p.client = MagicMock()
    p._health = _make_no_op_health()
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
                mock_cfg.max_backfill_hours = 24
                mock_cfg.moneo_poll_max_pages_per_sensor = 100
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
                mock_cfg.max_backfill_hours = 24
                mock_cfg.moneo_poll_max_pages_per_sensor = 100
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


# ── Slice 2 test helpers ──────────────────────────────────────────────────────

def _seed_sensor(Session, *, moneo_sensor_id, asset_moneo_id, last_seen_at=None):
    """Create an Asset + Sensor and return the sensor id."""
    session = Session()
    try:
        asset = Asset(moneo_asset_id=asset_moneo_id, name=f"Dev-{asset_moneo_id}")
        session.add(asset)
        session.flush()
        sensor = Sensor(
            moneo_sensor_id=moneo_sensor_id,
            name=moneo_sensor_id,
            sensor_type="DataSource",
            unit="°C",
            asset_id=asset.id,
            moneo_datasource_ref=f"deepid-{moneo_sensor_id}",
            last_seen_at=last_seen_at,
        )
        session.add(sensor)
        session.commit()
        return sensor.id
    finally:
        session.close()


def _get_sensor(Session, moneo_sensor_id):
    session = Session()
    try:
        return session.query(Sensor).filter(Sensor.moneo_sensor_id == moneo_sensor_id).first()
    finally:
        session.close()


def _mock_settings(mock_cfg, *, max_backfill_hours=24, max_pages=100, alerts=False):
    mock_cfg.alert_evaluation_enabled = alerts
    mock_cfg.max_backfill_hours = max_backfill_hours
    mock_cfg.moneo_poll_max_pages_per_sensor = max_pages


def _make_processdata(rows_ms, total_count=None):
    """Build a /processdata envelope from a list of (timestamp_ms, value) pairs."""
    data = [{"timestamp": ts, "value": float(i)} for i, ts in enumerate(rows_ms)]
    return {
        "totalCount": total_count if total_count is not None else len(data),
        "data": data,
    }


def _strip_tz(dt):
    """Strip tzinfo for SQLite-safe comparison."""
    return dt.replace(tzinfo=None) if dt and dt.tzinfo else dt


# ── Slice 2 tests ─────────────────────────────────────────────────────────────

class TestMoneoSyncSlice2:

    # (i) Watermark resumption ────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_watermark_resumption(self, Session):
        """
        After a poll that returns rows at T+1s and T+2s, last_seen_at advances
        to T+2s regardless of what the previous watermark was.
        """
        T = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        T1_ms = int((T + timedelta(seconds=1)).timestamp() * 1000)
        T2_ms = int((T + timedelta(seconds=2)).timestamp() * 1000)

        _seed_sensor(Session, moneo_sensor_id="wm-sensor", asset_moneo_id="wm-device",
                     last_seen_at=T)

        stub = _make_processdata([T1_ms, T2_ms])
        poller = _make_poller()
        poller.client.get_processdata = AsyncMock(return_value=stub)

        with patch("services.moneo_poller.SessionLocal", side_effect=Session):
            with patch("services.moneo_poller.settings") as mock_cfg:
                _mock_settings(mock_cfg)
                await poller.poll_latest_readings()

        sensor = _get_sensor(Session, "wm-sensor")
        expected = _strip_tz(datetime.fromtimestamp(T2_ms / 1000, tz=timezone.utc))
        actual = _strip_tz(sensor.last_seen_at)
        assert actual == expected, f"last_seen_at should be T+2s; got {actual}"

    # (ii) No cap on watermarked sensors ────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_stale_watermark_used_without_cap(self, Session):
        """
        When last_seen_at is 48h ago, from_ms must be last_seen_at + 1ms — NOT
        capped to now-24h. The scheduler pages through the backlog automatically.
        """
        now = datetime.now(timezone.utc)
        stale = now - timedelta(hours=48)

        _seed_sensor(Session, moneo_sensor_id="cap-sensor", asset_moneo_id="cap-device",
                     last_seen_at=stale)

        # Read back last_seen_at as SQLite will return it (possibly naive) so that
        # expected_from_ms uses the same .timestamp() interpretation as the poller.
        seeded = _get_sensor(Session, "cap-sensor")
        expected_from_ms = int(seeded.last_seen_at.timestamp() * 1000) + 1

        recent_ts = int((now - timedelta(hours=6)).timestamp() * 1000)
        stub = _make_processdata([recent_ts])
        poller = _make_poller()
        poller.client.get_processdata = AsyncMock(return_value=stub)

        with patch("services.moneo_poller.SessionLocal", side_effect=Session):
            with patch("services.moneo_poller.settings") as mock_cfg:
                _mock_settings(mock_cfg, max_backfill_hours=24)
                await poller.poll_latest_readings()

        actual_from_ms = poller.client.get_processdata.call_args.kwargs["from_ms"]

        assert actual_from_ms == expected_from_ms, (
            f"from_ms should be watermark+1ms ({expected_from_ms}); got {actual_from_ms}"
        )
        # Sanity: must NOT be the 24h cap (48h-ago watermark is ~24h older than the cap).
        cap_ms = int((datetime.now(timezone.utc) - timedelta(hours=24)).timestamp() * 1000)
        assert abs(actual_from_ms - cap_ms) > 60_000, (
            "from_ms should NOT equal the 24h cap; stale watermark must be used directly"
        )

    # (iii) Pagination + idempotency ──────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_pagination_all_pages_fetched(self, Session):
        """
        totalCount=1200 with page_size=500 triggers three get_processdata calls.
        bulk_upsert_readings is called once per page.
        A second pass with identical data inserts zero new rows.
        """
        BASE_TS = 1_700_000_000_000
        sensor_id = _seed_sensor(
            Session, moneo_sensor_id="pg-sensor", asset_moneo_id="pg-device"
        )

        def make_page(offset, count=500):
            return {
                "totalCount": 1200,
                "data": [
                    {"timestamp": BASE_TS + (offset + i) * 1000, "value": float(i)}
                    for i in range(count)
                ],
            }

        page1 = make_page(0, 500)
        page2 = make_page(500, 500)
        page3 = make_page(1000, 200)

        poller = _make_poller()
        poller.client.get_processdata = AsyncMock(side_effect=[page1, page2, page3])

        # Spy on bulk_upsert_readings call count
        from services import moneo_poller as mp_module
        bulk_calls = []
        original_bulk = mp_module.bulk_upsert_readings

        def spy_bulk(db, sid, rows):
            bulk_calls.append(len(rows))
            return original_bulk(db, sid, rows)

        with patch("services.moneo_poller.bulk_upsert_readings", side_effect=spy_bulk):
            with patch("services.moneo_poller.SessionLocal", side_effect=Session):
                with patch("services.moneo_poller.settings") as mock_cfg:
                    _mock_settings(mock_cfg)
                    await poller.poll_latest_readings()

        assert poller.client.get_processdata.call_count == 3, "Should fetch exactly 3 pages"
        assert len(bulk_calls) == 3, "bulk_upsert_readings called once per page"
        assert bulk_calls == [500, 500, 200]

        session = Session()
        count_first = session.query(SensorReading).filter(
            SensorReading.sensor_id == sensor_id
        ).count()
        session.close()
        assert count_first == 1200, f"Expected 1200 rows after first pass; got {count_first}"

        # Second pass with same data — ON CONFLICT DO NOTHING must prevent duplicates
        poller.client.get_processdata = AsyncMock(side_effect=[page1, page2, page3])
        with patch("services.moneo_poller.SessionLocal", side_effect=Session):
            with patch("services.moneo_poller.settings") as mock_cfg:
                _mock_settings(mock_cfg)
                await poller.poll_latest_readings()

        session = Session()
        count_second = session.query(SensorReading).filter(
            SensorReading.sensor_id == sensor_id
        ).count()
        session.close()
        assert count_second == 1200, "Second pass must not insert duplicate rows"

    # (iv-a) Backoff: 503 × 2 then 200 ───────────────────────────────────────

    @pytest.mark.asyncio
    async def test_backoff_retries_on_503(self):
        """
        Two 503 responses followed by 200 must succeed and make exactly 3 HTTP calls.
        asyncio.sleep is mocked so the test runs instantly.
        """
        from services.moneo_api_client import MoneoApiClient

        client = MoneoApiClient()
        attempt_log = []

        def make_resp(status, json_body=None):
            r = MagicMock()
            r.status_code = status
            r.headers = {}
            r.json.return_value = json_body
            if status >= 400:
                r.raise_for_status.side_effect = httpx.HTTPStatusError(
                    f"HTTP {status}", request=MagicMock(), response=r
                )
            else:
                r.raise_for_status.return_value = None
            return r

        responses = [
            make_resp(503),
            make_resp(503),
            make_resp(200, {"pageNumber": 1, "pageSize": 1, "totalPages": 1,
                            "totalCount": 1, "data": [{"timestamp": 1_700_000_000_000, "value": 7.0}]}),
        ]

        async def mock_get(*args, **kwargs):
            r = responses[len(attempt_log)]
            attempt_log.append(r.status_code)
            return r

        with patch.object(client._client, "get", side_effect=mock_get):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await client.get_processdata("dev-1", "ds-1")

        assert len(attempt_log) == 3, f"Expected 3 attempts; got {len(attempt_log)}: {attempt_log}"
        assert result["totalCount"] == 1

    # (iv-b) No retry on 401 ──────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_no_retry_on_401(self):
        """
        A 401 response must raise immediately with exactly 1 HTTP call — no retry.
        """
        from services.moneo_api_client import MoneoApiClient
        import pytest

        client = MoneoApiClient()
        call_count = 0

        def make_401():
            r = MagicMock()
            r.status_code = 401
            r.raise_for_status.side_effect = httpx.HTTPStatusError(
                "401 Unauthorized", request=MagicMock(), response=r
            )
            return r

        async def mock_get(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return make_401()

        with patch.object(client._client, "get", side_effect=mock_get):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(httpx.HTTPStatusError):
                    await client.get_processdata("dev-1", "ds-1")

        assert call_count == 1, f"Should not retry on 401; got {call_count} calls"

    # (v) First-poll-ever ─────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_first_poll_omits_from_ms(self, Session):
        """
        When last_seen_at is None, from_ms must be None (omitted from the API call)
        so MONEO returns readings from the very beginning of recorded history.
        """
        _seed_sensor(
            Session, moneo_sensor_id="new-sensor", asset_moneo_id="new-device",
            last_seen_at=None
        )

        stub = {"totalCount": 0, "data": []}
        poller = _make_poller()
        poller.client.get_processdata = AsyncMock(return_value=stub)

        with patch("services.moneo_poller.SessionLocal", side_effect=Session):
            with patch("services.moneo_poller.settings") as mock_cfg:
                _mock_settings(mock_cfg, max_backfill_hours=24)
                await poller.poll_latest_readings()

        actual_from_ms = poller.client.get_processdata.call_args.kwargs["from_ms"]
        assert actual_from_ms is None, (
            f"from_ms should be None for a sensor with no watermark; got {actual_from_ms!r}"
        )

    # (vi) Page-cap safety ────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_cap_pages_safety(self, Session, caplog):
        """
        When totalCount=200_000, the loop must exit after moneo_poll_max_pages_per_sensor
        pages, log a WARNING, and advance last_seen_at to the max timestamp of the
        pages that were fetched.
        """
        MAX_PAGES = 2
        ROWS_PER_PAGE = 500
        BASE_TS = 1_700_000_000_000

        _seed_sensor(
            Session, moneo_sensor_id="cap-pg-sensor", asset_moneo_id="cap-pg-device",
            last_seen_at=None
        )

        def make_capped_page(page_num):
            offset = (page_num - 1) * ROWS_PER_PAGE
            return {
                "totalCount": 200_000,
                "data": [
                    {"timestamp": BASE_TS + (offset + i) * 1000, "value": float(i)}
                    for i in range(ROWS_PER_PAGE)
                ],
            }

        poller = _make_poller()
        poller.client.get_processdata = AsyncMock(
            side_effect=[make_capped_page(1), make_capped_page(2)]
        )

        with caplog.at_level(logging.WARNING, logger="services.moneo_poller"):
            with patch("services.moneo_poller.SessionLocal", side_effect=Session):
                with patch("services.moneo_poller.settings") as mock_cfg:
                    _mock_settings(mock_cfg, max_pages=MAX_PAGES)
                    await poller.poll_latest_readings()

        assert poller.client.get_processdata.call_count == MAX_PAGES, (
            f"Should stop after {MAX_PAGES} pages; "
            f"got {poller.client.get_processdata.call_count}"
        )

        assert any("max_pages cap" in r.message for r in caplog.records), (
            "Expected a WARNING about hitting the page cap"
        )

        # last_seen_at must advance to the max timestamp from the fetched pages
        max_fetched_ts = BASE_TS + (MAX_PAGES * ROWS_PER_PAGE - 1) * 1000
        expected = _strip_tz(
            datetime.fromtimestamp(max_fetched_ts / 1000, tz=timezone.utc)
        )
        sensor = _get_sensor(Session, "cap-pg-sensor")
        actual = _strip_tz(sensor.last_seen_at)
        assert actual == expected, (
            f"last_seen_at should advance to last fetched page's max; "
            f"got {actual}, expected {expected}"
        )
