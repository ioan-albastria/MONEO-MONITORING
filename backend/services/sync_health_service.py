import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from DAL import session_scope
from DAL.models.sync_error import SyncError
from DAL.models.sync_run import SyncRun
from config import settings

logger = logging.getLogger(__name__)

# Must match the `hours=6` interval on the sync_sensor_metadata job in
# services/schedulers/data_polling_scheduler.py — update both together.
_METADATA_SYNC_INTERVAL_SECONDS = 6 * 3600


def _to_iso(dt: "datetime | None") -> "str | None":
    """Serialise a datetime to ISO 8601, normalising SQLite-naive values to UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


# TODO: a future hook here will fan out 'failed'/'degraded' transitions into
# the alert subsystem (e.g. synthetic AlertEvent rows or notification outbox
# inserts). Deferred to a later slice.


class SyncHealthService:
    """Lifecycle tracker and health reporter for MONEO sync runs."""

    @contextmanager
    def run(self, source: str):
        """
        Context manager that opens a sync_run row on entry and finalises it on exit.

        The run row lives in a dedicated session so it survives any rollback in
        the caller's own session (e.g. a per-sensor commit failure).

        Yields the SyncRun instance so the caller can mutate records_in,
        records_written, and last_cursor in-memory; those fields are flushed
        to the DB on clean exit.
        """
        with session_scope() as db:
            run = SyncRun(
                source=source,
                started_at=datetime.now(timezone.utc),
                status="running",
            )
            db.add(run)
            db.commit()
            db.refresh(run)
            try:
                yield run
                if run.finished_at is None:
                    run.finished_at = datetime.now(timezone.utc)
                if run.status == "running":
                    if run.error_count == 0:
                        run.status = "success"
                    elif run.records_written > 0:
                        run.status = "partial"
                    else:
                        run.status = "failed"
                db.commit()
            except Exception as exc:
                run.finished_at = datetime.now(timezone.utc)
                run.status = "failed"
                run.error_summary = (str(exc) or exc.__class__.__name__)[:1000]
                db.commit()
                raise

    def record_error(
        self,
        run: SyncRun,
        kind: str,
        message: str,
        sensor_id: int | None = None,
        http_status: int | None = None,
    ) -> SyncError:
        """
        Persist one error row linked to *run* in its own short-lived session.

        Commits immediately so the record is durable even if the caller's
        session rolls back.  Mutates run.error_count in-memory so the
        context-manager flush sees the updated counter.
        """
        with session_scope() as db:
            error = SyncError(
                sync_run_id=run.id,
                sensor_id=sensor_id,
                occurred_at=datetime.now(timezone.utc),
                kind=kind,
                http_status=http_status,
                message=message,
            )
            db.add(error)
            db.commit()
            db.refresh(error)
            db.expunge(error)
        run.error_count += 1
        return error

    def get_health(self, db) -> dict:
        """
        Return a per-source health snapshot for 'moneo.readings' and 'moneo.metadata'.

        SQLite returns naive datetimes from DateTime(timezone=True) columns; both
        sides of any subtraction are normalised to UTC before computing lag_seconds.
        """
        # Reference cadence per source (seconds).
        cadences = {
            "moneo.readings": settings.sensor_poll_interval_seconds,
            "moneo.metadata": _METADATA_SYNC_INTERVAL_SECONDS,
        }

        result: dict = {}
        for source in ("moneo.readings", "moneo.metadata"):
            reference_cadence = cadences[source]

            last_run = (
                db.query(SyncRun)
                .filter(SyncRun.source == source)
                .order_by(SyncRun.started_at.desc())
                .first()
            )

            last_success = (
                db.query(SyncRun)
                .filter(SyncRun.source == source, SyncRun.status == "success")
                .order_by(SyncRun.started_at.desc())
                .first()
            )

            # Consecutive failures: non-success runs since the last success.
            # If there has never been a success, count all non-success runs.
            if last_success is not None:
                consecutive_failures = (
                    db.query(SyncRun)
                    .filter(
                        SyncRun.source == source,
                        SyncRun.status.in_(["failed", "partial"]),
                        SyncRun.started_at > last_success.started_at,
                    )
                    .count()
                )
            else:
                consecutive_failures = (
                    db.query(SyncRun)
                    .filter(
                        SyncRun.source == source,
                        SyncRun.status.in_(["failed", "partial"]),
                    )
                    .count()
                )

            # Lag in seconds since the last successful run finished.
            lag_seconds: int | None = None
            if last_success is not None and last_success.finished_at is not None:
                now_utc = datetime.now(timezone.utc)
                finished = last_success.finished_at
                # SQLite strips tzinfo on write; normalise before subtracting.
                if finished.tzinfo is None:
                    finished = finished.replace(tzinfo=timezone.utc)
                lag_seconds = int((now_utc - finished).total_seconds())

            # Derived status — evaluated in severity order (most severe wins).
            if last_run is None:
                derived_status = "failed"
            else:
                last_status = last_run.status
                if (
                    last_status == "failed"
                    or (lag_seconds is not None and lag_seconds >= 5 * reference_cadence)
                    or consecutive_failures >= 3
                ):
                    derived_status = "failed"
                elif (
                    last_status == "partial"
                    or (
                        lag_seconds is not None
                        and 2 * reference_cadence <= lag_seconds < 5 * reference_cadence
                    )
                ):
                    derived_status = "degraded"
                elif last_status == "success" and (
                    lag_seconds is None or lag_seconds < 2 * reference_cadence
                ):
                    derived_status = "healthy"
                else:
                    # success but lag unknown, or running status
                    derived_status = "degraded"

            # Latest error for any run under this source.
            last_error = (
                db.query(SyncError)
                .join(SyncRun, SyncError.sync_run_id == SyncRun.id)
                .filter(SyncRun.source == source)
                .order_by(SyncError.occurred_at.desc())
                .first()
            )

            result[source] = {
                "derived_status": derived_status,
                "last_status": last_run.status if last_run else None,
                "last_run_started_at": _to_iso(last_run.started_at) if last_run else None,
                "last_run_finished_at": _to_iso(last_run.finished_at) if last_run else None,
                "last_success_at": (
                    _to_iso(last_success.finished_at)
                    if last_success and last_success.finished_at
                    else None
                ),
                "lag_seconds": lag_seconds,
                "consecutive_failures": consecutive_failures,
                "records_in": last_run.records_in if last_run else 0,
                "records_written": last_run.records_written if last_run else 0,
                "error_count": last_run.error_count if last_run else 0,
                "last_error_kind": last_error.kind if last_error else None,
                "last_error_message": (
                    last_error.message[:200] if last_error else None
                ),
            }

        return result


async def prune_sync_history() -> None:
    """
    Delete sync_runs older than settings.sync_history_retention_days.

    sync_errors are removed automatically via the ON DELETE CASCADE FK.
    Scheduled nightly at 03:00 by data_polling_scheduler.
    """
    with session_scope() as db:
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(
                days=settings.sync_history_retention_days
            )
            deleted = db.query(SyncRun).filter(SyncRun.started_at < cutoff).delete()
            db.commit()
            if deleted:
                logger.info("prune_sync_history: removed %d old sync_run rows", deleted)
        except Exception as exc:
            logger.error("prune_sync_history failed: %s", exc)
            db.rollback()
