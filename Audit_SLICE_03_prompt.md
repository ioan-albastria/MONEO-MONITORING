# Slice 3 — Prompt (as delivered to the implementing session)

Revised version: incorporates the late-arriving Slice 2 full
deliverable report (alert-evaluation placement, SQLite tz stripping,
manual sync trigger endpoint).

---

You are implementing Slice 3 of the MONEO sync remediation plan. The
plan is in ./MONEO_SYNC_AUDIT.md — read the "Slice 3" entry under
Implementation plan and the "Sync status" + "Audit log" current-state
assessments. Slices 1 and 2 have landed; this slice adds persistent
observability on top of the now-working sync.

GOAL OF THIS SLICE
After this slice we can answer two questions without parsing log
files:
  (a) "When did sync last succeed, per source?" — via a new
      /api/admin/sync/health endpoint reading from a new sync_runs
      table.
  (b) "What went wrong during sync run X?" — via a new sync_errors
      table linked by run id.

No frontend work here — Slice 4 consumes /api/admin/sync/health.
No token / .env / config-defaults work — Slice 5.

CONTEXT FROM SLICES 1 & 2 (carry-forwards, not optional)
- The pager logs a WARNING when moneo_poll_max_pages_per_sensor is
  hit. That WARNING must also be persisted as a sync_errors row
  with kind='max_pages_cap' in this slice.
- The MoneoApiClient raises on 401 with no retry (Slice 2). Catch
  those at the poll loop level and record as kind='http_401'.
- get_processdata page_size is hardcoded to 500 in poll_latest_readings.
  Leave the value but add an inline comment above the
  `if page * 500 >= total_count` check noting the coupling, so the
  next person who parameterises page_size also fixes the comparison.
- Slice 2 moved alert evaluation to once-per-sensor on the latest
  persisted reading, immediately before the per-sensor commit. DO
  NOT change that placement in this slice. If a per-sensor commit
  fails and rolls back, the alert-evaluation side effects roll
  back with it — that coupling is a known limitation to be tackled
  in a later, separate slice.
- Slice 2 found SQLite strips timezone info from tz-aware datetime
  columns on write; tests use a _strip_tz() helper to normalise.
  Reuse that pattern wherever Slice 3 compares datetimes in tests.
  In production code, normalise both sides of any datetime
  subtraction by attaching UTC to naive values
  (`if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)`).

SCOPE (do all of this, nothing more)

1. backend/DAL/models/sync_run.py — new model
   class SyncRun(Base):
       __tablename__ = "sync_runs"
       id              BIGSERIAL PRIMARY KEY  (Integer/BigInteger
                                              portable between dialects)
       source          VARCHAR(40) NOT NULL   -- 'moneo.readings'|'moneo.metadata'
       started_at      DateTime(timezone=True), NOT NULL
       finished_at     DateTime(timezone=True), NULL
       status          VARCHAR(20) NOT NULL   -- 'running'|'success'|'partial'|'failed'
       records_in      INT NOT NULL DEFAULT 0
       records_written INT NOT NULL DEFAULT 0
       error_count     INT NOT NULL DEFAULT 0
       last_cursor     BIGINT NULL            -- max timestamp_ms seen this run
       error_summary   TEXT NULL              -- one-line summary on failure

   Indexes:
     ix_sync_runs_source_started (source, started_at DESC)

   Relationship: errors = relationship("SyncError", back_populates="run",
                                       cascade="all, delete-orphan")

2. backend/DAL/models/sync_error.py — new model
   class SyncError(Base):
       __tablename__ = "sync_errors"
       id           BIGSERIAL PRIMARY KEY
       sync_run_id  BIGINT FK sync_runs(id) ON DELETE CASCADE, NOT NULL
       sensor_id    INT FK sensors(id) ON DELETE SET NULL  -- nullable
       occurred_at  DateTime(timezone=True), NOT NULL DEFAULT now()
       kind         VARCHAR(40) NOT NULL                   -- see "kinds" below
       http_status  INT NULL
       message      TEXT NOT NULL

       run = relationship("SyncRun", back_populates="errors")

   Indexes:
     ix_sync_errors_run         (sync_run_id)
     ix_sync_errors_sensor_kind (sensor_id, kind)

   Initial set of `kind` values — document as a module-level
   constant tuple, not as a DB enum:
     'http_401'         — upstream rejected the token
     'http_5xx'         — upstream server error after retries exhausted
     'http_other'       — any other unexpected HTTP status
     'parse'            — couldn't parse upstream payload
     'max_pages_cap'    — backfill hit the per-sensor page cap
     'sensor_skipped'   — missing asset / moneo_datasource_ref
     'unknown'          — exception not matched above

3. backend/DAL/__init__.py — export SyncRun and SyncError so
   Alembic autogenerate sees them and other modules can import.

4. backend/migrations/versions/0004_sync_runs.py — new migration
   - Create both tables and indexes.
   - downgrade(): drop them in dependency order (sync_errors first).
   - No data backfill (these are new observability tables).

5. backend/services/sync_health_service.py — new
   - Class SyncHealthService.
   - Context-manager API for run lifecycle:
       @contextmanager
       def run(self, source: str) -> SyncRun:
           # Open a dedicated session for the run row so the row
           # survives any caller-side rollback.
           db = SessionLocal()
           try:
               run = SyncRun(source=source,
                             started_at=datetime.now(timezone.utc),
                             status="running")
               db.add(run); db.commit(); db.refresh(run)
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
               except Exception as e:
                   run.finished_at = datetime.now(timezone.utc)
                   run.status = "failed"
                   run.error_summary = (str(e) or e.__class__.__name__)[:1000]
                   db.commit()
                   raise
           finally:
               db.close()

   - record_error(run: SyncRun, kind: str, message: str,
                  sensor_id: int | None = None,
                  http_status: int | None = None) -> SyncError
       Opens its own short-lived session, inserts a row referencing
       run.id, commits immediately so errors are durable even if
       the run later crashes. Mutates run.error_count in-memory so
       the context-manager flush sees the updated counter.

   - get_health(db) -> dict
       For each source in ('moneo.readings', 'moneo.metadata'):
         last_run     = latest SyncRun by started_at
         last_success = latest SyncRun with status='success'
         consecutive_failures = count of runs since last_success
           that are NOT 'success' (status in {'failed','partial'});
           if last_success is None, count all-time non-success runs
         lag_seconds = (now_utc - last_success.finished_at).total_seconds()
                       or None if last_success is None
           (normalise tz on both sides before subtracting — SQLite
            returns naive datetimes)
         derived_status:
           For 'moneo.readings', use settings.sensor_poll_interval_seconds
           as the reference cadence. For 'moneo.metadata', use 6h
           (matches the existing 6h metadata sync job).
           - 'healthy'  if last_status='success' and lag_seconds <
                        2 * reference_cadence
           - 'degraded' if last_status='partial' or
                        (2x <= lag_seconds < 5x reference_cadence)
           - 'failed'   if last_status='failed' or
                        lag_seconds >= 5x reference_cadence or
                        consecutive_failures >= 3
           - if last_run is None at all: 'failed' with
                        last_success_at=null
       Return per source:
         {
           "derived_status": "healthy"|"degraded"|"failed",
           "last_status": "success"|"partial"|"failed"|null,
           "last_run_started_at":  iso8601|null,
           "last_run_finished_at": iso8601|null,
           "last_success_at":      iso8601|null,
           "lag_seconds": int|null,
           "consecutive_failures": int,
           "records_in": int,             -- from last_run
           "records_written": int,        -- from last_run
           "error_count": int,            -- from last_run
           "last_error_kind": str|null,   -- from latest sync_errors
           "last_error_message": str|null -- truncated to 200 chars
         }
       Top-level shape:
         { "moneo.readings": {...}, "moneo.metadata": {...} }

   - TODO comment (do not implement): a future hook here will fan
     out 'failed' / 'degraded' transitions into the alert subsystem.

   - prune_sync_history() — module-level coroutine for the scheduler
     (see item 9):
       DELETE FROM sync_runs
       WHERE started_at < now_utc - retention_days
     (sync_errors cascade via FK). Retention from
     settings.sync_history_retention_days (default 90,
     env SYNC_HISTORY_RETENTION_DAYS).

6. backend/services/moneo_poller.py — instrument both methods
   - Inject a SyncHealthService instance on the poller (default
     argument or attribute).
   - poll_latest_readings:
       with self._health.run("moneo.readings") as run:
           db = SessionLocal()
           try:
               sensors = ...
               for sensor in sensors:
                   try:
                       # ... existing per-sensor logic from Slice 2 ...
                       run.records_in += rows_fetched
                       run.records_written += rows_written
                       if max_ts_seen is not None:
                           ts_ms = int(max_ts_seen.timestamp() * 1000)
                           run.last_cursor = (ts_ms if run.last_cursor is None
                                              else max(run.last_cursor, ts_ms))
                   except HTTPStatusError as e:
                       status_code = e.response.status_code
                       kind = ('http_401' if status_code == 401 else
                               'http_5xx'  if 500 <= status_code < 600 else
                               'http_other')
                       self._health.record_error(
                           run, kind, str(e)[:1000],
                           sensor_id=sensor.id, http_status=status_code,
                       )
                   except Exception as e:
                       self._health.record_error(
                           run, 'unknown', repr(e)[:1000],
                           sensor_id=sensor.id,
                       )
                   # Where Slice 2 logs the max_pages_cap WARNING,
                   # ALSO call record_error(kind='max_pages_cap', ...).
                   # Where Slice 1/2 logs sensor_skipped WARNING for
                   # missing asset/moneo_datasource_ref, same pattern.
           finally:
               db.close()
   - Extend bulk_upsert_readings signature so the caller can
     accumulate records_written accurately. Today it returns
     `max_ts: datetime | None`. Make it return
     `(max_ts: datetime | None, written: int)`. Implementation: use
     `result.rowcount` from db.execute().
     IMPORTANT: verify in tests that
     INSERT ... ON CONFLICT DO NOTHING (via the sqlite and postgres
     dialect helpers) returns the actually-inserted count for both
     backends. If one of them returns a misleading value (e.g.
     -1 or total-attempted), fall back to "written = len(values)"
     for that dialect with an inline comment flagging the
     approximation. Do NOT guess — write the test and let it tell
     you.
   - sync_sensor_metadata: same instrumentation pattern with
     source='moneo.metadata'.
     records_in = nodes received from /nodes;
     records_written = new asset rows + new sensor rows;
     last_cursor stays null (metadata has no timestamp cursor).

7. backend/routes/admin_sync_routes.py — new
   - prefix "/api/admin/sync", tag "admin".
   - GET /health  → SyncHealthService().get_health(db). Admin-gated.
   - For the admin gate, copy the pattern from
     backend/routes/moneo_routes.py:trigger_metadata_sync:
       if current_user.username != "admin":
           raise HTTPException(403, "Admin only")
     (Yes, that's a string compare; backend/CLAUDE.md notes there's
      no is_admin column. Do not refactor that here — Slice 5 might
      revisit but it's out of scope for Slice 3.)

8. backend/main.py — include the new router.

9. backend/services/schedulers/data_polling_scheduler.py — addition
   - New job:
       _scheduler.add_job(
           prune_sync_history,
           trigger="cron", hour=3, minute=0,
           id="prune_sync_history", replace_existing=True,
       )
     Import prune_sync_history from sync_health_service.

10. backend/tests/
    New cases (extend test_moneo_sync or new file
    test_sync_health.py — your call):
    - Run lifecycle: successful run leaves a row with
      status='success', finished_at set, error_count=0.
    - Exception inside the with-block leaves status='failed' and
      finished_at set; the exception propagates.
    - Per-sensor 5xx: stub one sensor's processdata to raise
      HTTPStatusError(503). Assert one sync_errors row with
      kind='http_5xx', http_status=503, sensor_id set; run status
      becomes 'partial' (because other sensors wrote rows).
    - 401 path: stub raises 401. Assert kind='http_401', no retry
      attempted (call count on the stub == 1), run status = 'failed'
      if no successful sensors, 'partial' otherwise.
    - max_pages_cap: reuse the Slice 2 cap test scaffold; assert
      one sync_errors row with kind='max_pages_cap' AND the WARNING
      log line still appears.
    - sensor_skipped: a sensor with missing moneo_datasource_ref
      produces a sync_errors row with kind='sensor_skipped'.
    - rowcount verification: write one page where half the rows
      already exist; assert run.records_written equals the actually-
      new count on BOTH sqlite and postgres test paths. If sqlite
      misbehaves, the test should pin the documented approximation
      and reference the inline comment in the helper.
    - get_health on empty DB: returns the two sources with
      derived_status='failed' and last_success_at=null (explicitly
      NOT 'healthy by default').
    - get_health after one success: derived_status='healthy',
      lag_seconds <= reference cadence.
    - get_health with three consecutive failures: 'failed' even
      when the most recent run is 'partial'.
    - /api/admin/sync/health route: 403 for non-admin user;
      200 with the documented JSON shape for admin.
    - Pruning: insert a SyncRun with started_at = now - 100 days
      plus one SyncError child; run prune_sync_history; assert
      both rows are gone (cascade fires).
    - All datetime comparisons in tests use the existing _strip_tz()
      helper or its equivalent so sqlite-naive returns don't false-
      negative.

OUT OF SCOPE (do NOT touch)
- No frontend changes (Slice 4 reads /api/admin/sync/health).
- No token / .env / config-default changes (Slice 5).
- No changes to AlertEvaluator, notification outbox, or the
  rollback coupling.
- No single-instance lock, no circuit breaker.
- No retention pruning beyond the 90-day job above.
- No changes to existing /api/sensors, /api/dashboards, /api/moneo
  routes or their response shapes.

ALSO IN SCOPE — small audit-doc touch-up
- Append one line to MONEO_SYNC_AUDIT.md under "Items intentionally
  NOT proposed":
    "- Alert-evaluator rollback coupling — Slice 2 moved
      AlertEvaluator to once-per-sensor on the latest persisted
      reading just before the per-sensor commit; if that commit
      rolls back, the alert side effects (outbox rows, etc.) roll
      back with it. Tracked separately for a later slice."
  Nothing else in the audit changes.

GROUND RULES
- No git add / commit / push (user commits between slices).
- No worktrees.
- Schema additions are pre-approved per the audit (sign-off was Q1).
- Backend CLAUDE.md updates are deferred to a later doc-pass —
  don't touch it in this slice.

SUCCESS CRITERIA
- alembic upgrade head runs cleanly on a fresh DB and on a DB that
  already has Slices 1+2 rows; alembic downgrade -1 cleanly drops
  the two new tables.
- pytest backend/tests passes including all new cases.
- Manual smoke:
    1. Boot the backend; wait for one auto poll cycle OR call
       POST /api/moneo/admin/sync-metadata to trigger the metadata
       sync immediately (admin JWT).
    2. SELECT source, status, records_in, records_written,
              error_count, started_at, finished_at
         FROM sync_runs ORDER BY started_at DESC LIMIT 5;
       — recent rows visible, status='success' on healthy paths.
    3. curl -H "Authorization: Bearer <admin-jwt>" \
            http://127.0.0.1:8000/api/admin/sync/health
       returns the documented JSON shape with
       derived_status='healthy' for moneo.readings.
    4. Same curl with a non-admin JWT returns 403.

DELIVERABLE
A summary report covering:
- Final rowcount approach for each dialect, with test evidence
  (paste the test names and the actual rowcounts observed).
- The exact JSON shape get_health returned in your smoke test
  (paste it verbatim — Slice 4's frontend binds against it).
- Any deviations from this prompt, with reasons.
- The smoke evidence.
- A flagged list of anything worth tightening in Slice 4
  (frontend status surface — it will consume this endpoint).

When you are done, STOP. Do not start Slice 4.
