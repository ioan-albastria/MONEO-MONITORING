"""
Tests for Slice 3: SyncRun / SyncError models, SyncHealthService, and the
/api/admin/sync/health route.

DB fixture: in-memory SQLite via Base.metadata.create_all() (same pattern as
conftest.py and test_moneo_sync.py). SQLite returns naive datetimes from
DateTime(timezone=True) columns; all datetime comparisons use _strip_tz().
"""
import logging
import pytest
import pytest_asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import FastAPI
from fastapi.testclient import TestClient

from DAL.db_context import Base
from DAL.models.asset import Asset
from DAL.models.sensor import Sensor
from DAL.models.sensor_reading import SensorReading
from DAL.models.sync_run import SyncRun
from DAL.models.sync_error import SyncError
from services.sync_health_service import SyncHealthService, prune_sync_history
from services.moneo_poller import MoneoPoller, bulk_upsert_readings
from routes.admin_sync_routes import admin_sync_router
from DAL import get_db
from middleware import get_current_user


# ── DB fixture ────────────────────────────────────────────────────────────────

@pytest.fixture
def db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys = ON")

    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def Session(db_engine):
    return sessionmaker(bind=db_engine, autocommit=False, autoflush=False)


@pytest.fixture
def db(Session):
    session = Session()
    try:
        yield session
    finally:
        session.close()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_tz(dt):
    """Strip tzinfo for SQLite-safe comparison."""
    return dt.replace(tzinfo=None) if dt and dt.tzinfo else dt


def _now():
    return datetime.now(timezone.utc)


def _insert_run(db, source, status, started_offset_s=0, finished_offset_s=None,
                records_in=0, records_written=0, error_count=0):
    """Insert a SyncRun with controlled timestamps relative to now."""
    now = _now()
    started = now - timedelta(seconds=started_offset_s)
    finished = (
        now - timedelta(seconds=finished_offset_s)
        if finished_offset_s is not None
        else None
    )
    run = SyncRun(
        source=source,
        status=status,
        started_at=started,
        finished_at=finished,
        records_in=records_in,
        records_written=records_written,
        error_count=error_count,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


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


def _make_poller(Session) -> MoneoPoller:
    """Instantiate MoneoPoller with a test-DB-backed health service."""
    p = MoneoPoller()
    p.client = MagicMock()
    # Wire the health service to use the test SessionLocal
    p._health._session_factory = Session  # not used directly — we patch SessionLocal
    return p


# ── Run lifecycle ─────────────────────────────────────────────────────────────

class TestRunLifecycle:

    def test_successful_run_leaves_success_row(self, Session):
        """A run that exits cleanly must have status='success' and finished_at set."""
        svc = SyncHealthService()
        with patch("services.sync_health_service.SessionLocal", side_effect=Session):
            with svc.run("moneo.readings") as run:
                run.records_in = 10
                run.records_written = 10

        session = Session()
        try:
            row = session.query(SyncRun).filter_by(source="moneo.readings").first()
            assert row is not None
            assert row.status == "success"
            assert row.finished_at is not None
            assert row.error_count == 0
            assert row.records_written == 10
        finally:
            session.close()

    def test_exception_inside_run_leaves_failed_row(self, Session):
        """An exception inside the with-block must set status='failed' and re-raise."""
        svc = SyncHealthService()
        with pytest.raises(ValueError, match="boom"):
            with patch("services.sync_health_service.SessionLocal", side_effect=Session):
                with svc.run("moneo.readings") as run:
                    raise ValueError("boom")

        session = Session()
        try:
            row = session.query(SyncRun).filter_by(source="moneo.readings").first()
            assert row is not None
            assert row.status == "failed"
            assert row.finished_at is not None
            assert "boom" in (row.error_summary or "")
        finally:
            session.close()

    def test_partial_run_when_errors_but_some_writes(self, Session):
        """error_count > 0 but records_written > 0 → status='partial'."""
        svc = SyncHealthService()
        with patch("services.sync_health_service.SessionLocal", side_effect=Session):
            with svc.run("moneo.readings") as run:
                run.records_written = 5
                # simulate one error recorded via record_error mutating error_count
                run.error_count = 1

        session = Session()
        try:
            row = session.query(SyncRun).filter_by(source="moneo.readings").first()
            assert row.status == "partial"
        finally:
            session.close()

    def test_failed_run_when_errors_and_no_writes(self, Session):
        """error_count > 0 and records_written == 0 → status='failed'."""
        svc = SyncHealthService()
        with patch("services.sync_health_service.SessionLocal", side_effect=Session):
            with svc.run("moneo.readings") as run:
                run.error_count = 2
                # records_written stays 0

        session = Session()
        try:
            row = session.query(SyncRun).filter_by(source="moneo.readings").first()
            assert row.status == "failed"
        finally:
            session.close()


# ── Per-sensor error recording (poller instrumentation) ───────────────────────

class TestPollerErrors:

    @pytest.mark.asyncio
    async def test_5xx_records_http_5xx_error(self, Session):
        """
        A 503 from get_processdata must produce a sync_errors row with
        kind='http_5xx', http_status=503, and sensor_id set.
        A second healthy sensor in the same run makes the run status 'partial'.
        """
        sensor_a_id = _seed_sensor(
            Session, moneo_sensor_id="err-sensor-a", asset_moneo_id="err-dev-a"
        )
        sensor_b_id = _seed_sensor(
            Session, moneo_sensor_id="ok-sensor-b", asset_moneo_id="ok-dev-b"
        )

        mock_503_resp = MagicMock()
        mock_503_resp.status_code = 503

        good_page = {
            "totalCount": 1,
            "data": [{"timestamp": 1_700_000_000_000, "value": 1.0}],
        }

        async def processdata_side_effect(**kwargs):
            # Poller now uses sensor.name as datasource_id (not moneo_datasource_ref).
            if kwargs.get("datasource_id") == "err-sensor-a":
                raise httpx.HTTPStatusError(
                    "503", request=MagicMock(), response=mock_503_resp
                )
            return good_page

        poller = MoneoPoller()
        poller.client = MagicMock()
        poller.client.get_processdata = AsyncMock(side_effect=processdata_side_effect)

        with patch("services.sync_health_service.SessionLocal", side_effect=Session):
            with patch("services.moneo_poller.SessionLocal", side_effect=Session):
                with patch("services.moneo_poller.settings") as mock_cfg:
                    mock_cfg.alert_evaluation_enabled = False
                    mock_cfg.max_backfill_hours = 24
                    mock_cfg.moneo_poll_max_pages_per_sensor = 100
                    await poller.poll_latest_readings()

        session = Session()
        try:
            run = session.query(SyncRun).filter_by(source="moneo.readings").first()
            assert run is not None
            assert run.status == "partial", f"Expected partial, got {run.status}"

            errors = session.query(SyncError).filter_by(sync_run_id=run.id).all()
            assert len(errors) == 1
            err = errors[0]
            assert err.kind == "http_5xx"
            assert err.http_status == 503
            assert err.sensor_id == sensor_a_id
        finally:
            session.close()

    @pytest.mark.asyncio
    async def test_401_records_http_401_no_retry(self, Session):
        """
        A 401 from get_processdata must produce kind='http_401', call count == 1,
        and run status='failed' when no other sensors wrote rows.
        """
        _seed_sensor(
            Session, moneo_sensor_id="auth-sensor", asset_moneo_id="auth-dev"
        )

        mock_401_resp = MagicMock()
        mock_401_resp.status_code = 401
        call_count = 0

        async def processdata_raises(**kwargs):
            nonlocal call_count
            call_count += 1
            raise httpx.HTTPStatusError(
                "401 Unauthorized", request=MagicMock(), response=mock_401_resp
            )

        poller = MoneoPoller()
        poller.client = MagicMock()
        poller.client.get_processdata = AsyncMock(side_effect=processdata_raises)

        with patch("services.sync_health_service.SessionLocal", side_effect=Session):
            with patch("services.moneo_poller.SessionLocal", side_effect=Session):
                with patch("services.moneo_poller.settings") as mock_cfg:
                    mock_cfg.alert_evaluation_enabled = False
                    mock_cfg.max_backfill_hours = 24
                    mock_cfg.moneo_poll_max_pages_per_sensor = 100
                    await poller.poll_latest_readings()

        assert call_count == 1, f"Should not retry on 401; got {call_count} calls"

        session = Session()
        try:
            run = session.query(SyncRun).filter_by(source="moneo.readings").first()
            assert run.status == "failed"
            err = session.query(SyncError).filter_by(sync_run_id=run.id).first()
            assert err is not None
            assert err.kind == "http_401"
        finally:
            session.close()

    @pytest.mark.asyncio
    async def test_max_pages_cap_records_error_and_warns(self, Session, caplog):
        """
        Hitting moneo_poll_max_pages_per_sensor must:
          - log a WARNING (Slice 2 requirement preserved)
          - create a sync_errors row with kind='max_pages_cap'
        """
        MAX_PAGES = 2
        ROWS_PER_PAGE = 500
        BASE_TS = 1_700_000_000_000

        _seed_sensor(
            Session, moneo_sensor_id="cap-sensor", asset_moneo_id="cap-dev"
        )

        def make_page(page_num):
            offset = (page_num - 1) * ROWS_PER_PAGE
            return {
                "totalCount": 200_000,
                "data": [
                    {"timestamp": BASE_TS + (offset + i) * 1000, "value": float(i)}
                    for i in range(ROWS_PER_PAGE)
                ],
            }

        poller = MoneoPoller()
        poller.client = MagicMock()
        poller.client.get_processdata = AsyncMock(
            side_effect=[make_page(1), make_page(2)]
        )

        with caplog.at_level(logging.WARNING, logger="services.moneo_poller"):
            with patch("services.sync_health_service.SessionLocal", side_effect=Session):
                with patch("services.moneo_poller.SessionLocal", side_effect=Session):
                    with patch("services.moneo_poller.settings") as mock_cfg:
                        mock_cfg.alert_evaluation_enabled = False
                        mock_cfg.max_backfill_hours = 24
                        mock_cfg.moneo_poll_max_pages_per_sensor = MAX_PAGES
                        await poller.poll_latest_readings()

        assert any("max_pages cap" in r.message for r in caplog.records), (
            "Expected a WARNING about hitting the page cap"
        )

        session = Session()
        try:
            run = session.query(SyncRun).filter_by(source="moneo.readings").first()
            err = session.query(SyncError).filter_by(
                sync_run_id=run.id, kind="max_pages_cap"
            ).first()
            assert err is not None, "Expected a sync_errors row with kind='max_pages_cap'"
        finally:
            session.close()

    @pytest.mark.asyncio
    async def test_null_datasource_ref_polls_via_name(self, Session):
        """
        A sensor with moneo_datasource_ref=None must NOT be skipped.
        The poller now uses sensor.name as the datasource_id, so get_processdata
        must be called with datasource_id equal to the sensor name.
        """
        session = Session()
        try:
            asset = Asset(moneo_asset_id="skip-dev", name="Skip Dev")
            session.add(asset)
            session.flush()
            sensor = Sensor(
                moneo_sensor_id="skip-sensor",
                name="Temperature",
                sensor_type="DataSource",
                unit="",
                asset_id=asset.id,
                moneo_datasource_ref=None,  # missing — no longer causes a skip
            )
            session.add(sensor)
            session.commit()
        finally:
            session.close()

        poller = MoneoPoller()
        poller.client = MagicMock()
        poller.client.get_processdata = AsyncMock(return_value={"totalCount": 0, "data": []})

        with patch("services.sync_health_service.SessionLocal", side_effect=Session):
            with patch("services.moneo_poller.SessionLocal", side_effect=Session):
                with patch("services.moneo_poller.settings") as mock_cfg:
                    mock_cfg.alert_evaluation_enabled = False
                    mock_cfg.max_backfill_hours = 24
                    mock_cfg.moneo_poll_max_pages_per_sensor = 100
                    await poller.poll_latest_readings()

        # get_processdata must have been called once with the sensor name as datasource_id.
        poller.client.get_processdata.assert_called_once()
        call_kwargs = poller.client.get_processdata.call_args.kwargs
        assert call_kwargs.get("datasource_id") == "Temperature", (
            f"Expected datasource_id='Temperature' (sensor.name); got {call_kwargs.get('datasource_id')!r}"
        )

        # No sensor_skipped errors — the sensor was polled, not skipped.
        session = Session()
        try:
            run = session.query(SyncRun).filter_by(source="moneo.readings").first()
            skipped = session.query(SyncError).filter_by(
                sync_run_id=run.id, kind="sensor_skipped"
            ).first()
            assert skipped is None, "sensor with null moneo_datasource_ref must not produce sensor_skipped"
        finally:
            session.close()


# ── Rowcount verification ─────────────────────────────────────────────────────

class TestRowcount:

    def test_rowcount_partial_conflicts(self, Session):
        """
        Insert 6 readings, then insert a page of 6 rows where 3 already exist.
        records_written should equal 3 (actually-new rows).

        If SQLite returns rowcount=-1 (undefined), bulk_upsert_readings falls
        back to len(values) and this test will show records_written=6 for the
        second batch.  We document which branch fired via assertion message.
        """
        session = Session()
        try:
            asset = Asset(moneo_asset_id="rc-dev", name="RC Dev")
            session.add(asset)
            session.flush()
            sensor = Sensor(
                moneo_sensor_id="rc-sensor",
                name="rc-sensor",
                sensor_type="DataSource",
                unit="",
                asset_id=asset.id,
                moneo_datasource_ref="deepid-rc",
            )
            session.add(sensor)
            session.commit()
            sensor_id = sensor.id
        finally:
            session.close()

        BASE_TS = 1_700_000_000_000
        initial_rows = [
            {"timestamp": BASE_TS + i * 1000, "value": float(i)}
            for i in range(6)
        ]

        session = Session()
        try:
            # Insert initial 6 rows — all new.
            _, written_first = bulk_upsert_readings(session, sensor_id, initial_rows)
            session.commit()
        finally:
            session.close()

        # Second batch: rows 0..2 already exist; rows 3..5 are new duplicates from
        # initial; rows 6..8 are genuinely new.
        second_rows = [
            {"timestamp": BASE_TS + i * 1000, "value": float(i)}
            for i in range(3, 9)  # 3,4,5 (dups) + 6,7,8 (new)
        ]

        session = Session()
        try:
            _, written_second = bulk_upsert_readings(session, sensor_id, second_rows)
            session.commit()
            total = session.query(SensorReading).filter_by(sensor_id=sensor_id).count()
        finally:
            session.close()

        assert written_first == 6, f"First batch: all 6 rows should be new; got {written_first}"

        # Verify total count in DB is correct regardless of rowcount behaviour.
        assert total == 9, f"DB should have 9 unique readings (0-8); got {total}"

        # Main assertion: records_written should be 3 (the actual new rows 6,7,8).
        # If this fails with written_second==6, it means the dialect returned rowcount
        # == len(values) (the len(values) fallback branch in bulk_upsert_readings fired).
        assert written_second == 3, (
            f"Second batch: expected 3 new rows written; got {written_second}. "
            "If the dialect returned rowcount=-1, the fallback branch in "
            "bulk_upsert_readings would overcounted as len(values)=6."
        )


# ── get_health ────────────────────────────────────────────────────────────────

class TestGetHealth:

    def test_empty_db_returns_failed_for_all_sources(self, db):
        """With no sync_runs rows, both sources must report derived_status='failed'."""
        result = SyncHealthService().get_health(db)
        for source in ("moneo.readings", "moneo.metadata"):
            assert result[source]["derived_status"] == "failed", (
                f"{source}: expected failed on empty DB"
            )
            assert result[source]["last_success_at"] is None
            assert result[source]["last_status"] is None

    def test_after_one_success_is_healthy(self, db):
        """A recent success run with lag < 2×poll_interval → derived_status='healthy'."""
        # finished_at = 60s ago; poll_interval default is 300s → lag < 2*300 = 600s
        run = _insert_run(
            db,
            source="moneo.readings",
            status="success",
            started_offset_s=70,
            finished_offset_s=60,
            records_in=100,
            records_written=100,
        )

        with patch("services.sync_health_service.settings") as mock_cfg:
            mock_cfg.sensor_poll_interval_seconds = 300
            mock_cfg.sync_history_retention_days = 90
            result = SyncHealthService().get_health(db)

        r = result["moneo.readings"]
        assert r["derived_status"] == "healthy", f"Expected healthy; got {r['derived_status']}"
        assert r["last_status"] == "success"
        assert r["last_success_at"] is not None
        assert r["lag_seconds"] is not None
        assert r["lag_seconds"] < 2 * 300

    def test_three_consecutive_failures_means_failed(self, db):
        """Three consecutive non-success runs → derived_status='failed' even if partial."""
        # One old success, then three partial runs after it.
        old_success = _insert_run(
            db, source="moneo.readings", status="success",
            started_offset_s=3600, finished_offset_s=3590,
        )
        for i in range(3):
            _insert_run(
                db, source="moneo.readings", status="partial",
                started_offset_s=300 * (3 - i),
                finished_offset_s=290 * (3 - i),
            )

        with patch("services.sync_health_service.settings") as mock_cfg:
            mock_cfg.sensor_poll_interval_seconds = 300
            mock_cfg.sync_history_retention_days = 90
            result = SyncHealthService().get_health(db)

        assert result["moneo.readings"]["derived_status"] == "failed"
        assert result["moneo.readings"]["consecutive_failures"] == 3

    def test_metadata_source_uses_6h_cadence(self, db):
        """
        moneo.metadata uses a 6h (21600s) reference cadence.
        A success finished 2h ago (lag=7200s) is < 2×21600=43200s → healthy.
        """
        _insert_run(
            db, source="moneo.metadata", status="success",
            started_offset_s=7300, finished_offset_s=7200,
        )

        with patch("services.sync_health_service.settings") as mock_cfg:
            mock_cfg.sensor_poll_interval_seconds = 300
            mock_cfg.sync_history_retention_days = 90
            result = SyncHealthService().get_health(db)

        assert result["moneo.metadata"]["derived_status"] == "healthy"

    def test_stale_lag_degrades_to_failed(self, db):
        """lag_seconds >= 5 × reference_cadence → derived_status='failed'."""
        # success finished 30 minutes ago; poll_interval=60s → 5×60=300s
        _insert_run(
            db, source="moneo.readings", status="success",
            started_offset_s=1810, finished_offset_s=1800,
        )

        with patch("services.sync_health_service.settings") as mock_cfg:
            mock_cfg.sensor_poll_interval_seconds = 60
            mock_cfg.sync_history_retention_days = 90
            result = SyncHealthService().get_health(db)

        assert result["moneo.readings"]["derived_status"] == "failed"


# ── Route: /api/admin/sync/health ─────────────────────────────────────────────

def _make_test_client(db_session, username: str) -> TestClient:
    """Build a minimal FastAPI app with the admin_sync_router and mocked deps."""
    app = FastAPI()
    app.include_router(admin_sync_router)

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    mock_user = MagicMock()
    mock_user.username = username

    def override_get_current_user():
        return mock_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    return TestClient(app)


class TestAdminSyncRoute:

    def test_non_admin_gets_403(self, db):
        """Non-admin user must receive HTTP 403."""
        client = _make_test_client(db, username="regular_user")
        resp = client.get("/api/admin/sync/health")
        assert resp.status_code == 403

    def test_admin_gets_200_with_correct_shape(self, db):
        """Admin user must receive 200 with the documented JSON shape."""
        _insert_run(db, source="moneo.readings", status="success",
                    started_offset_s=60, finished_offset_s=50)

        client = _make_test_client(db, username="admin")
        with patch("services.sync_health_service.settings") as mock_cfg:
            mock_cfg.sensor_poll_interval_seconds = 300
            mock_cfg.sync_history_retention_days = 90
            resp = client.get("/api/admin/sync/health")

        assert resp.status_code == 200
        body = resp.json()

        for source in ("moneo.readings", "moneo.metadata"):
            assert source in body, f"Expected {source!r} key in response"
            s = body[source]
            # Verify all documented keys are present.
            for key in (
                "derived_status", "last_status", "last_run_started_at",
                "last_run_finished_at", "last_success_at", "lag_seconds",
                "consecutive_failures", "records_in", "records_written",
                "error_count", "last_error_kind", "last_error_message",
            ):
                assert key in s, f"Missing key {key!r} for source {source!r}"

        assert body["moneo.readings"]["derived_status"] in ("healthy", "degraded", "failed")


# ── Pruning ───────────────────────────────────────────────────────────────────

class TestPruning:

    @pytest.mark.asyncio
    async def test_prune_removes_old_run_and_cascades_to_errors(self, Session):
        """
        A SyncRun with started_at = now - 100 days plus a SyncError child must
        both be deleted by prune_sync_history when retention_days=90.
        """
        session = Session()
        try:
            old_run = SyncRun(
                source="moneo.readings",
                status="success",
                started_at=datetime.now(timezone.utc) - timedelta(days=100),
                finished_at=datetime.now(timezone.utc) - timedelta(days=100),
                records_in=5,
                records_written=5,
            )
            session.add(old_run)
            session.flush()

            old_error = SyncError(
                sync_run_id=old_run.id,
                occurred_at=datetime.now(timezone.utc) - timedelta(days=100),
                kind="unknown",
                message="old error",
            )
            session.add(old_error)
            session.commit()
            run_id = old_run.id
        finally:
            session.close()

        with patch("services.sync_health_service.SessionLocal", side_effect=Session):
            with patch("services.sync_health_service.settings") as mock_cfg:
                mock_cfg.sync_history_retention_days = 90
                await prune_sync_history()

        session = Session()
        try:
            assert session.query(SyncRun).filter_by(id=run_id).first() is None, (
                "Old SyncRun should have been pruned"
            )
            assert session.query(SyncError).filter_by(sync_run_id=run_id).first() is None, (
                "SyncError child should have been cascade-deleted"
            )
        finally:
            session.close()

    @pytest.mark.asyncio
    async def test_prune_keeps_recent_runs(self, Session):
        """Runs within the retention window must survive pruning."""
        session = Session()
        try:
            recent_run = SyncRun(
                source="moneo.readings",
                status="success",
                started_at=datetime.now(timezone.utc) - timedelta(days=10),
                finished_at=datetime.now(timezone.utc) - timedelta(days=10),
            )
            session.add(recent_run)
            session.commit()
            run_id = recent_run.id
        finally:
            session.close()

        with patch("services.sync_health_service.SessionLocal", side_effect=Session):
            with patch("services.sync_health_service.settings") as mock_cfg:
                mock_cfg.sync_history_retention_days = 90
                await prune_sync_history()

        session = Session()
        try:
            assert session.query(SyncRun).filter_by(id=run_id).first() is not None, (
                "Recent SyncRun should NOT have been pruned"
            )
        finally:
            session.close()


# ── record_error ──────────────────────────────────────────────────────────────

class TestRecordError:

    def test_record_error_increments_run_error_count(self, Session):
        """record_error must increment run.error_count in-memory and persist the row."""
        session = Session()
        try:
            run = SyncRun(
                source="moneo.readings",
                status="running",
                started_at=datetime.now(timezone.utc),
            )
            session.add(run)
            session.commit()
            session.refresh(run)
        finally:
            session.close()

        svc = SyncHealthService()
        with patch("services.sync_health_service.SessionLocal", side_effect=Session):
            svc.record_error(run, "http_401", "Test 401", http_status=401)

        assert run.error_count == 1

        session = Session()
        try:
            err = session.query(SyncError).filter_by(sync_run_id=run.id).first()
            assert err is not None
            assert err.kind == "http_401"
            assert err.http_status == 401
            assert err.message == "Test 401"
        finally:
            session.close()
