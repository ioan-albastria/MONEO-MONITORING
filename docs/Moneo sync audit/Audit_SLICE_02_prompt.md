# Slice 2 — Prompt (as delivered to the implementing session)

Adapted from the original audit plan with Slice 1's five
carry-forwards folded in.

---

You are implementing Slice 2 of the MONEO sync remediation plan. The
plan is in ./MONEO_SYNC_AUDIT.md — read the "Slice 2" entry under
Implementation plan and the "Resumability" current-state assessment.
Slice 1 has landed; its scope was endpoint + DTO fixes only.

GOAL OF THIS SLICE
Switch the poller from "fetch latest single point" to "fetch every
point since the per-sensor watermark, paginating until caught up,
capped by a configurable backfill window". After this slice a 30-min
outage is recovered automatically on the next poll cycle.

CONTEXT FROM SLICE 1 (carry-forwards, not optional)
- poll_latest_readings currently calls get_processdata with
  page_size=1, no from_ms. That gets replaced wholesale.
- last_seen_at is currently bumped per row inside the per-row
  savepoint loop. After Slice 2 it must be set once per sensor per
  poll cycle, to max(timestamp) across the whole batch we wrote.
- The per-row savepoint loop becomes a bulk insert per page (see
  scope item 3).

SCOPE (do all of this, nothing more)

1. backend/config.py
   - Add: max_backfill_hours: int = 24
     env var: MAX_BACKFILL_HOURS
   - Add: moneo_poll_max_pages_per_sensor: int = 100
     env var: MONEO_POLL_MAX_PAGES_PER_SENSOR
     (safety cap so one sensor with millions of historical rows can't
     monopolise a poll cycle. 100 pages * 500 page_size = 50k rows
     per sensor per cycle — generous.)
   - Add to backend/.env.example if that file exists; do NOT touch
     backend/.env (Slice 5 handles secret hygiene).

2. backend/services/moneo_api_client.py
   - Wrap get_processdata in exponential backoff with full jitter:
       * Retry on httpx.ConnectError / ReadTimeout, and on response
         status in {429, 500, 502, 503, 504}.
       * DO NOT retry on 401 / 403 / 404 — those are bugs or auth
         problems Slice 5 will surface.
       * Base delay 0.5s, factor 2, max 3 attempts.
       * On 429, honour Retry-After header if present (seconds).
     Keep the retry logic narrow and inline — do not pull in tenacity
     unless it's already in requirements.txt. Document the policy
     above the method.

3. backend/services/moneo_poller.py — poll_latest_readings()
   Rewrite the per-sensor loop body as:

   a. Skip sensors with no asset or no moneo_datasource_ref (same
      WARNING as Slice 1).

   b. Compute the window:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        cap_ms = now_ms - settings.max_backfill_hours * 3600 * 1000
        if sensor.last_seen_at:
            from_ms = max(int(sensor.last_seen_at.timestamp() * 1000) + 1, cap_ms)
        else:
            from_ms = cap_ms
        to_ms = now_ms
      If sensor.last_seen_at exists AND its ms value is older than
      cap_ms, log INFO that we are skipping the gap (record
      sensor.id, the gap size in seconds). Continue with the capped
      from_ms.

   c. Page loop:
        page = 1
        max_ts_seen = None
        while page <= settings.moneo_poll_max_pages_per_sensor:
            env = await client.get_processdata(
                device_id=sensor.asset.moneo_asset_id,
                datasource_id=sensor.moneo_datasource_ref,
                from_ms=from_ms,
                to_ms=to_ms,
                order="+timestamp",
                page=page,
                page_size=500,
            )
            rows = env.get("data") or []
            if not rows:
                break
            # Bulk insert this page (see step 4 for the helper).
            page_max_ts = bulk_upsert_readings(db, sensor.id, rows)
            if page_max_ts is not None:
                max_ts_seen = page_max_ts if max_ts_seen is None else max(max_ts_seen, page_max_ts)
            total_count = env.get("totalCount") or 0
            if page * 500 >= total_count:
                break
            page += 1
        else:
            logger.warning(
                "Sensor %d hit max_pages cap (%d); remaining backlog "
                "will be picked up next cycle",
                sensor.id, settings.moneo_poll_max_pages_per_sensor,
            )

      After the loop, if max_ts_seen is not None:
        sensor.last_seen_at = max_ts_seen
      Commit once per sensor (so a failure mid-fleet doesn't lose
      already-fetched data for earlier sensors).

   d. Remove the per-row pre-SELECT + per-row savepoint pattern
      entirely. Slice 1 added it as a stop-gap; it is now replaced
      by the bulk path in step 4.

4. backend/services/moneo_poller.py — new private helper
   bulk_upsert_readings(db, sensor_id, rows) -> datetime | None
   - rows is the list of {"timestamp": int_ms, "value": float, ...}
     dicts straight from MONEO.
   - Transform to a list[dict] of SensorReading column values
     (parse timestamp via fromtimestamp(ts/1000, tz=timezone.utc),
     value = row["value"], status = row.get("quality", "ok"),
     sensor_id = sensor_id).
   - Dialect-branched insert (the helper centralises this so the
     caller stays simple):

       dialect = db.bind.dialect.name
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
           raise NotImplementedError(f"Dialect {dialect} not supported")
       db.execute(stmt)

   - Return max timestamp across the input rows as a UTC datetime,
     or None if rows is empty. (Used by the caller to update
     last_seen_at — not the inserted-row count, because conflicts
     don't count as "new" but still advance the watermark.)
   - Comment heavily: this returns max-observed, not max-newly-inserted,
     deliberately. We want last_seen_at to reflect what MONEO
     showed us, so duplicates from overlapping windows don't make
     the watermark regress.

5. backend/services/moneo_poller.py — sync_sensor_metadata()
   Small metadata polish (per Slice 1 feedback #4):
   - When creating a new Asset for a Device node, set
       asset.kind = "device"
     (lowercase; matches the existing server_default style of
     "machine"). Existing rows are left alone.
   - No other metadata-sync behaviour changes.

6. backend/tests/
   - New tests:
       i.   Watermark resumption: seed a sensor with last_seen_at = T.
            Stub /processdata returns rows at T+1s, T+2s in one page.
            Run poll. Assert last_seen_at == T+2s.
       ii.  Cap on backfill: seed last_seen_at = now - 48h with
            MAX_BACKFILL_HOURS=24. Stub returns rows in the last 12h.
            Assert from_ms passed to the client is now - 24h (the
            cap), not last_seen_at + 1.
       iii. Pagination: stub returns totalCount=1200 across three
            pages of 500. Assert all three pages are fetched; assert
            only one DB write per page (use spy on db.execute); assert
            no duplicate rows on second-pass re-run.
       iv.  Backoff: stub returns 503 twice then 200; assert success
            and that exactly 3 attempts were made. Stub returns 401;
            assert one attempt, no retry, error logged.
       v.   First-poll-ever: sensor.last_seen_at is None. Assert
            from_ms == now - MAX_BACKFILL_HOURS * 3600 * 1000.
       vi.  Cap-pages safety: stub returns totalCount=200_000 across
            many pages. Assert the loop exits after
            moneo_poll_max_pages_per_sensor pages, logs the WARNING,
            and last_seen_at advances to the last fetched page's max.

OUT OF SCOPE (do NOT touch)
- No sync_runs / sync_errors table (Slice 3).
- No /api/admin/sync/health endpoint (Slice 3).
- No frontend changes (Slice 4).
- No .env / config defaults / token probe changes (Slice 5).
- No single-instance lock, no circuit breaker, no retention job.
- No changes to /api/moneo/* proxy routes — Slice 1 fixed them.
- Do NOT update backend/CLAUDE.md route inventory yet — Slice 4 or 5
  will fold doc updates together.

GROUND RULES
- No git add / commit / push.
- No worktrees.
- Schema is unchanged in this slice — no new migration. The
  unique constraint and the moneo_datasource_ref column from Slice 1
  are exactly what we need.

SUCCESS CRITERIA
- pytest backend/tests passes, including the six new cases above.
- Manual smoke (describe in your final report; do not commit a
  script): set MAX_BACKFILL_HOURS=1; start the backend; pick a
  sensor with known historical data (the sandbox has at least one
  with 60k+ readings — see MONEO_SYNC_AUDIT.md appendix); manually
  UPDATE its last_seen_at to NULL or now - 30 minutes; wait one
  poll cycle; SELECT count(*) FROM sensor_readings WHERE sensor_id
  = ? AND created_at > <pre-test-marker> — should be > 1 (not
  exactly 1, which would mean Slice 1 behaviour leaked through).
- No regression on Slice 1's smoke: first poll on a fresh DB still
  produces readings within one cycle.

DELIVERABLE
A summary report covering: the exact backoff parameters chosen, how
dialect-branching was structured (one helper or scattered), any
deviations from this prompt with reasons, the smoke-test evidence
(counts before/after, the picked sensor id), and a flagged list of
anything worth tightening in Slice 3 (sync_runs table). If you hit
ambiguity, document the choice you made — do not block.

When you are done, STOP. Do not start Slice 3.
