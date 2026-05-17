# Slice 2 — State (implementing agent's feedback)

Two reports were shared in sequence: a brief commit-message-style
summary first, then a fuller deliverable report. Both preserved.

---

## First report — commit message

**Slice 2 — Watermark-driven catch-up polling**

* `config.py`: add `max_backfill_hours` (default 24) and
  `moneo_poll_max_pages_per_sensor` (default 100).
* `.env.example`: document the two new env vars.
* `moneo_api_client.get_processdata`: exponential backoff with full
  jitter (base 0.5 s, factor 2, max 3 attempts); retries on
  429/5xx/`ConnectError`/`ReadTimeout`; no retry on 401/403/404;
  honours `Retry-After` on 429.
* `moneo_poller`: add `bulk_upsert_readings()` helper —
  dialect-branched `INSERT … ON CONFLICT DO NOTHING` for PostgreSQL
  and SQLite; returns max-observed timestamp so watermark advances
  past duplicates.
* `moneo_poller.poll_latest_readings`: replace single-row
  `page_size=1` fetch with paginated watermark loop;
  `from_ms = max(last_seen_at+1, now-MAX_BACKFILL_HOURS)`; pages
  until caught up or page cap hit; commits once per sensor; logs
  WARNING when cap is reached.
* `moneo_poller.sync_sensor_metadata`: set `asset.kind="device"` on
  new Asset rows created for Device nodes.
* `test_moneo_sync`: add `TestMoneoSyncSlice2` with 7 tests
  covering watermark resumption, backfill cap, three-page
  pagination, idempotency, backoff (503×2→200 and 401 no-retry),
  first-poll `from_ms`, and page-cap safety; fix existing Slice 1
  poll test to supply the two new settings fields.

### Items worth tightening in Slice 3

- `sync_runs` table should record `records_in` (total rows from
  `totalCount` across all sensors) and `records_written` (new rows,
  minus conflicts — `db.execute` doesn't return conflict-excluded
  count on SQLite, so PostgreSQL only or approximated as "rows in
  last page batch").
- The WARNING "Sensor X hit max_pages cap" has no durable record
  today — it disappears on log rotation. Slice 3 should persist
  this as a `sync_errors` row with `kind='max_pages_cap'`.
- Alert evaluation is called once per sensor per cycle, but if a
  sensor's commit fails and rolls back, the alert-evaluation side
  effects (e.g. an outbox row) also roll back. Slice 3 should
  consider a separate outbox-flush after the per-sensor commit
  succeeds.
- The `total_count` check `page * 500 >= totalCount` assumes
  `page_size=500` is hardcoded. If `page_size` is ever made
  configurable, this comparison needs updating. Flag for Slice 3
  doc review.

---

## Second report — full Slice 2 deliverable

### Backoff parameters chosen

- Max attempts: 3 (initial try + up to 2 retries).
- Base delay: 0.5 s with factor 2, full jitter — `uniform(0, 0.5 × 2ⁿ)`
  where `n` is the attempt index (0-based).
  - Attempt 0 → retry delay: `uniform(0, 0.5 s)`
  - Attempt 1 → retry delay: `uniform(0, 1.0 s)`
- Retryable statuses: `{429, 500, 502, 503, 504}` and `ConnectError`
  / `ReadTimeout`.
- Not retried: `{401, 403, 404}` — config bugs and auth failures
  surface immediately.
- 429 Retry-After: honoured as a floor —
  `max(retry_after, jitter_delay)`.
- No external library (`tenacity` not in `requirements.txt`); inline
  loop with `asyncio.sleep`.

### Dialect branching structure

One module-level helper
`bulk_upsert_readings(db, sensor_id, rows) → datetime | None`
centralises the branching. The caller in `poll_latest_readings`
stays clean:

```python
page_max_ts = bulk_upsert_readings(db, sensor.id, rows)
```

The helper detects dialect via `db.get_bind().dialect.name` and
imports `sqlalchemy.dialects.postgresql.insert` or `.sqlite.insert`
locally (avoids unconditional import of dialects the environment
may not have drivers for).

### Deviations from the prompt

1. **Alert evaluation preserved** — the prompt said to remove the
   per-row savepoint loop; it didn't explicitly address alert
   evaluation. Rather than silently dropping it, Slice 2 evaluates
   alerts once per sensor per cycle on the latest persisted reading
   (a `SELECT … ORDER BY timestamp DESC LIMIT 1` before the
   per-sensor commit). This is strictly less noisy than per-row
   evaluation and correct for catch-up scenarios.
2. **`sensor.last_seen_at` timezone on SQLite** —
   `bulk_upsert_readings` stores tz-aware `datetime` objects;
   SQLite strips the timezone on write and returns naive datetimes
   on read. The tests handle this with a `_strip_tz()` helper
   (matching the pattern established in Slices 9–12). PostgreSQL
   stores and returns tz-aware datetimes unchanged — no production
   impact.
3. **Existing Slice 1 test updated** —
   `test_poll_creates_reading_and_is_idempotent` needed
   `max_backfill_hours=24` and `moneo_poll_max_pages_per_sensor=100`
   added to its settings mock; the test was otherwise correct and
   still covers the Slice 1 behaviour.

### Smoke test instructions

Run manually against the sandbox to verify > 1 reading per cycle
after a 30-min outage:

```sql
-- 1. Pick a sensor with data (moneo_datasource_ref not null)
SELECT id, name, last_seen_at FROM sensors
WHERE moneo_datasource_ref IS NOT NULL LIMIT 5;

-- 2. Simulate a 30-min gap
UPDATE sensors SET last_seen_at = now() - interval '30 minutes'
WHERE id = <picked_id>;

-- 3. Note the timestamp before triggering a poll
-- pre_test_marker = now()

-- 4. Trigger a sync (via the admin endpoint or restart the scheduler)
-- POST /api/moneo/admin/sync-metadata  (or wait for next 5-min tick)

-- 5. Confirm more than one reading landed
SELECT count(*) FROM sensor_readings
WHERE sensor_id = <picked_id>
  AND created_at > '<pre_test_marker>';
-- Expected: > 1 (for a 30-min gap at 5-min poll interval, expect ~6 readings)
```
