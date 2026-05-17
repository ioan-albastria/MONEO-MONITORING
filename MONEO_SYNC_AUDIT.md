# MONEO Sync Audit

**Date:** 2026-05-17
**Scope:** Backend integration with the IFM MONEO platform API
(`/api/platform/v1`). Six concerns: periodic fetching, idempotency,
resumability, sync-status visibility, audit log, code comments.
**Method:** Static read of every file in the integration boundary plus
live verification against the sandbox MONEO API using the token in
`backend/.env`. Sample responses are saved under `tmp/moneo-samples/`
(directory is gitignored — added `/tmp/` to `.gitignore` during this
audit).

---

## Executive summary

The current implementation is **structurally close to right** (APScheduler
job, dedicated client + poller, upsert intent, `last_seen_at` watermark
field on `Sensor`) but it is **fundamentally broken end-to-end** against
the live API. The four hard problems below explain why nothing works in
practice; once they are fixed, the sync still has gaps on every one of
the six audit concerns except basic idempotency.

| # | Concern | Verdict |
|---|---|---|
| 1 | Periodic fetching | **NEEDS WORK** — scheduler runs, but the endpoints it polls are 404s; no catch-up; no single-instance guard; no token expiry handling. |
| 2 | Idempotency | **ADEQUATE in intent / NEEDS WORK in mechanism** — pre-insert SELECT exists; lacks DB-level unique constraint; `Asset.moneo_asset_id` is `unique=True, nullable=True` (correct), but `Sensor` has no compound guarantee. |
| 3 | Resumability | **MISSING** — no watermark cursor table, no per-source state, no resume-from-last logic. Poller only ever asks for "latest". |
| 4 | Sync status | **MISSING** — no `sync_runs` table, no health endpoint, no programmatic answer to "is sync healthy now?". `sensor.last_seen_at` is a partial signal but only updated when the (broken) latest call succeeds. |
| 5 | Audit log | **MISSING** — only `logger.info / error` to stdout. No queryable record of runs, errors, or per-sensor counts. |
| 6 | Code comments | **NEEDS WORK** — docstrings exist on classes, but the genuinely tricky bits (which `id` field maps where, why `category.lower()` is used, units extraction path, what the unused `sensor_type="dataSource"` literal means) are uncommented. |

**Critical findings, surfaced once and not repeated elsewhere:**

1. **Wrong endpoints.** `MoneoApiClient.get_latest_sensor_reading()` and
   `.get_sensor_readings()` call `/sensors/{id}/latest` and
   `/sensors/{id}/readings`. These endpoints **do not exist** in the
   MONEO platform API — both return **HTTP 404 "Not Found"** in the
   live sandbox. The documented and working endpoint for process
   values is `/processdata/device/{deviceId}/datasource/{datasourceId}`.
   See `tmp/moneo-samples/client_sensors_latest_undoc.json` and
   `processdata_with_readings.json`.

2. **Wrong datasource identifier stored.** `sync_sensor_metadata`
   stores the *topology node id* (`data_source.id`) as
   `sensor.moneo_sensor_id`. The `/processdata` endpoint requires the
   *inner* `reference.dataSource.id` (a 128-char hex hash). Calling
   `/processdata` with the topology id returns `200 OK` with
   `totalCount: 0` — a silent-failure mode (no exception, no 404). The
   real id only appears nested under `reference.dataSource.id`.

3. **Timestamp shape mismatch.** Live readings come as
   `{"timestamp": <int64 ms since epoch>, "value": <number>}` — no
   `status`, no `quality`. The poller does
   `datetime.fromisoformat(raw_ts)`, which would raise `TypeError` on
   an integer. Combined with #1/#2 the poller never reaches this code
   path, so the bug is latent.

4. **Token has no refresh path.** PAT inherits the creator's
   permissions; no `expires_in`, no refresh token. Today the key lives
   plaintext in `backend/.env`, **`.env` is tracked in git**
   (`git ls-files backend/.env` returns the file), and the same key
   value is hardcoded as the default in `backend/config.py:8`. When
   the token is rotated or revoked, every poll will silently log
   `httpx.HTTPStatusError 401` and stop producing readings — and
   nothing in the app surfaces that state.

**Effort estimate for the proposed plan:** 4–6 working days, split into
four sessions (see Implementation plan).

---

## DTO mapping

Field path is given relative to the JSON object returned by MONEO.
`reference.dataSource.*` is only present on `category=DataSource`
nodes; `reference.deviceId` is present on both `Device` and
`DataSource` nodes (on a DataSource it points to the parent device).

### `GET /nodes` → `Asset` (when `category == Device`)

Reference: `backend/services/moneo_poller.py:78-104`,
`backend/DAL/models/asset.py`. Sample: `tmp/moneo-samples/node_category_examples.json`.

| MONEO field | Type | Backend field | Transform / notes |
|---|---|---|---|
| `id` | UUID (topology node id) | — | **Not stored.** Different from `reference.deviceId`. |
| `parentNodeId` | UUID nullable | — | **Dropped.** Would be the natural parent for `Asset.parent_id`; the hierarchical `parent_id` column exists but is left null. |
| `name` | string | `Asset.name` | Direct. Falls back to `device_id` if absent. |
| `category` | enum (`Root`, `FunctionalLocation`, `Device`, `DataSource`, `CalcDataSource`) | filter only | Poller uses `category.lower() == "device"` to keep only Devices. **Will crash with `AttributeError: 'NoneType' has no attribute 'lower'`** if a node ever lacks `category` (live response always populates it, but Pydantic-validate it). |
| `hasChildren` | bool | — | Dropped. |
| `reference.deviceId` | UUID | `Asset.moneo_asset_id` | **This is the actual identifier used by `/processdata`.** Correctly picked over `id`. |
| `reference.dataSource` | null on Devices | — | n/a. |
| (whole node JSON) | dict | `Asset.extra_metadata` | Full upstream blob persisted. |
| — | — | `Asset.description`, `location`, `latitude`, `longitude` | **All read from `device.get("description") / .get("location")`** but the MONEO node payload does not contain those keys. Always `None`. Docs-vs-actual: drop these from the mapping or pull them from a different endpoint (see Open questions). |

### `GET /nodes` → `Sensor` (when `category == DataSource`)

Reference: `backend/services/moneo_poller.py:106-145`,
`backend/DAL/models/sensor.py`.

| MONEO field | Type | Backend field | Transform / notes |
|---|---|---|---|
| `id` | UUID (topology node id) | `Sensor.moneo_sensor_id` | **Wrong choice for downstream calls.** Stored as unique key but the `/processdata` endpoint requires `reference.dataSource.id`. See critical finding #2. |
| `name` | string | `Sensor.name` | Direct. Fallback to `moneo_sensor_id` if absent. |
| `category` | `"DataSource"` | `Sensor.sensor_type` | **Hardcoded literal `"dataSource"`** in code, not derived from the field. Loses the distinction with `CalcDataSource`. |
| `reference.deviceId` | UUID | indirect → `Sensor.asset_id` | Used to look up the `Asset` upserted above. Sensors whose device is not in the topology are silently dropped. |
| `reference.dataSource.id` | 128-char hex hash | **DROPPED** | The actual identifier needed by `/processdata`. Must be stored — either replacing `moneo_sensor_id` or as a new column. |
| `reference.dataSource.subscriptionState` | bool | — | Dropped. Might be useful for `is_active` default. |
| `reference.dataSource.category` | `"DataSource"` / `"CalcDataSource"` | — | Dropped. Should drive `sensor_type`. |
| `reference.dataSource.unit.quantity` | string (e.g. `"pressure"`, `"unspecific"`) | — | Dropped. Useful for choosing default ranges or widget defaults. |
| `reference.dataSource.unit.name` | string (e.g. `"bar"`, `"unknown"`) | — | Dropped. |
| `reference.dataSource.unit.symbol` | string (e.g. `"bar"`, `""`) | `Sensor.unit` | Direct. Defaults to `""` when missing. |
| `description` | absent in actual responses | `Sensor.description` | Always `None`. Docs-vs-actual: not present in the live `/nodes` payload. |
| (whole datasource JSON) | dict | `Sensor.extra_metadata` | Full upstream blob persisted. **Crucially, this means `reference.dataSource.id` IS preserved in JSON form** even though no column captures it — a workaround for finding #2 is possible from existing data. |
| — | — | `Sensor.expected_poll_seconds`, `normal_min/max`, `warning_min/max`, `critical_min/max`, `ranges_source` | Never populated from MONEO. They are operator-edited via `PUT /api/sensors/{id}/ranges`. Worth noting that MONEO does expose unit quantity which could seed sensible defaults, but the design says manual today. |

### `GET /processdata/device/{deviceId}/datasource/{datasourceId}` → `SensorReading`

Reference: `backend/services/moneo_poller.py:30-55` (the **intended** mapping; the actual upstream call goes to a non-existent endpoint today). Sample: `tmp/moneo-samples/processdata_with_readings.json`.

| MONEO field | Type | Backend field | Transform / notes |
|---|---|---|---|
| `pageNumber`, `pageSize`, `totalPages`, `totalCount` | int | — | Pagination envelope. Not consumed today — the poller currently does `.get("readings", [])` which yields `[]` against the real envelope (`data: [...]`). **Bug.** |
| `data[*].timestamp` | int64 (ms since epoch UTC) | `SensorReading.timestamp` | **Wrong parse.** Code does `datetime.fromisoformat(raw_ts)`. Must be `datetime.fromtimestamp(raw_ts/1000, tz=timezone.utc)`. |
| `data[*].value` | float | `SensorReading.value` | Direct. |
| `data[*].quality` | string (docs) | `SensorReading.status` | Docs list it; **the live API omits it entirely** for the samples we observed. Current code falls through to `.get("status", "ok")` so `status="ok"` always. Acceptable but the column ends up meaningless. |
| — | — | `Sensor.last_seen_at` | Set to `timestamp` on each new insert. Good. |

### `GET /nodes` — categories actually observed

Live (`tmp/moneo-samples/nodes.json`): Root=1, FunctionalLocation=16,
Device=45, DataSource=186, CalcDataSource=0. The poller silently
discards Root, FunctionalLocation, and CalcDataSource. FunctionalLocation
nodes carry the human-readable plant / line / cell hierarchy and are
already drawn elsewhere in the DAL (`Asset.parent_id`, `Asset.path`,
`Asset.kind`) — there is unused capacity to mirror that tree.

### Error response shape (live)

| Case | Status | Body | Headers |
|---|---|---|---|
| Garbage Bearer | **401** | **empty** | no `WWW-Authenticate` header populated | (sample: `auth_401_sample.json`) |
| Unknown endpoint | **404** | `"Not Found"` (text, not JSON) | — |
| Valid call, no data | **200** | `{"pageNumber":0,"pageSize":0,"totalPages":0,"totalCount":0,"data":[]}` | — |

Docs claim error bodies follow RFC 7807 (`application/problem+json` with
`title/status/detail`). The live 401 returns an empty body and the live
404 returns plain text. Plan defensively: status code first, body
second.

---

## Current-state assessment

### 1. Periodic fetching

**What exists:**
- `backend/services/schedulers/data_polling_scheduler.py:19-25` —
  APScheduler `AsyncIOScheduler` with an interval job
  `poll_sensor_readings` at `settings.sensor_poll_interval_seconds`
  (default 300s, env-configurable).
- Same file, lines 27-34 — a 6-hour `sync_sensor_metadata` interval
  job.
- `backend/main.py:60` — `start_scheduler()` is called from the
  lifespan startup (no longer commented out, contrary to the note
  in `backend/CLAUDE.md`'s Gotchas section — the CLAUDE.md is
  out of date).

**What works:**
- The scheduler does run on startup. Interval is configurable from
  env (`SENSOR_POLL_INTERVAL_SECONDS`). Process-restart simply
  re-starts the timer.

**What's missing:**
- **Endpoints are wrong** — see critical finding #1. The job runs
  but produces zero readings.
- **No catch-up.** APScheduler `trigger="interval"` with no
  `coalesce`/`misfire_grace_time` set: if the process was down for
  an hour, only one missed run is replayed (by default APScheduler
  collapses missed runs). For a "latest reading" model this is
  irrelevant — we'd just get the next datum — but it matters for
  the watermark / range model we should be moving to.
- **No single-instance guarantee.** Two API processes will each run
  the job. With the current bug it's invisible; once fixed it would
  cause duplicate inserts (mitigated by the pre-SELECT, see
  Idempotency).
- **No 401 handling.** Token expiry surfaces as `httpx.HTTPStatusError`,
  logged at `error` level, and the poll exits. No retry-suppression
  on 401 (good — we don't want to retry), but also no escalation:
  the next sync run will try again, log again, and freshness simply
  decays.
- **No exponential backoff / jitter on 5xx or 429.** MONEO documents
  a 100 req/min limit per endpoint; current code has no rate-limit
  awareness.
- **Token lifecycle:** the MONEO PAT is a Bearer with no documented
  expiry and no refresh-token flow (verified against the docs page).
  The platform offers no OAuth2 client-credentials flow we can
  switch to — manual rotation is the only path. Today there is no
  rotation runbook. The token is also leaked into `backend/.env`
  (tracked in git) and duplicated as a default in `config.py:8`.

### 2. Idempotency

**What exists:**
- `moneo_poller.py:36-46` — pre-insert SELECT on `(sensor_id, timestamp)`
  before inserting a `SensorReading`.
- `moneo_poller.py:91-104` — pre-insert SELECT on
  `Asset.moneo_asset_id` and `Sensor.moneo_sensor_id` (both columns
  `unique=True` at the DB level).

**What works:**
- Asset and Sensor upserts are safe under repeated metadata syncs
  (the unique index would catch race conditions even though the
  code itself is read-then-write).
- For readings, the natural key `(sensor_id, timestamp)` is checked
  per row.

**What's missing:**
- **No DB-level unique constraint** on `(sensor_reading.sensor_id,
  sensor_reading.timestamp)`. The pre-SELECT is racey if two pollers
  run concurrently. Should be `UniqueConstraint("sensor_id",
  "timestamp")` plus an `INSERT … ON CONFLICT DO NOTHING` (or
  Postgres-side `ON CONFLICT`).
- For a range / `/processdata` model returning multiple rows per
  call, the per-row pre-SELECT is N+1. A single `INSERT … ON CONFLICT`
  per page is materially cheaper.
- **Upstream mutability:** MONEO process data is observed to be
  append-only at a given timestamp (no edit/delete in docs). Safe to
  treat `(sensor_id, timestamp)` as immutable.

### 3. Resumability

**What exists:**
- `Sensor.last_seen_at` (timestamptz nullable) — set inside the
  poll transaction after each new reading insert.

**What works:**
- `last_seen_at` is the right shape for a per-sensor watermark.

**What's missing:**
- Nothing reads `last_seen_at` to drive the next call. The poller
  always asks for "latest" (single point) — there is no
  `fromTimestamp = last_seen_at` query. So a 30-minute outage
  loses 30 minutes of data even after the poller comes back, because
  "latest" only returns one row.
- No `sync_state` / `sync_cursor` table. If we want a *fleet-level*
  watermark distinct from per-sensor, we don't have it.
- The upstream API supports range queries
  (`fromTimestamp` / `toTimestamp` in epoch ms, `orderBy=+timestamp`)
  and offset-based pagination (`pageNumber` / `pageSize`, max 500-1000
  per page). Confirmed live (`tmp/moneo-samples/processdata_range_filtered.json`).
  Everything we need to do watermark-driven resumability is exposed.

### 4. Sync status

**What exists:**
- `Sensor.last_seen_at` — implicit freshness signal.
- `services/schedulers/alert_no_data_scheduler.py` — runs every 60s,
  fires `no_data` alert rules when `last_seen_at` is stale beyond a
  per-rule `no_data_seconds`. Tied to the alert subsystem, not a
  general health surface.

**What works:**
- The no_data alert mechanism would, in theory, scream when sync
  fails — *if a rule has been configured for each sensor*. Operator
  burden; not automatic.

**What's missing:**
- No `sync_runs` table. Cannot answer "when did sync last succeed?"
  or "how many readings did the last run write?".
- No health endpoint. Frontend cannot show "sync degraded" anywhere.
- No structured way to differentiate "the upstream is dead" from
  "this one sensor is stale" — both look identical via
  `last_seen_at`.
- The planned alerting / notification subsystem
  (`notification_dispatcher.py`, `alert_routes.py`) has no hook for
  sync-level events. It only fires on per-sensor rules.

### 5. Audit log

**What exists:**
- Python `logging` via `logging.basicConfig` in `main.py:28-31`. Format
  is timestamp + level + logger + message. Goes to stdout.
- `moneo_poller.py:62, 64, 147, 153` — one INFO line per successful
  poll, one ERROR line on exception, one INFO per successful metadata
  sync. No structured fields, no per-sensor breakdown, no run id.

**What works:**
- A human reading stdout can tell roughly what happened.

**What's missing:**
- No persisted record. After a process restart and log rotation,
  yesterday's sync history is gone.
- No queryable answer to "what happened during sync at 14:00 last
  Tuesday?".
- No correlation id. If the poll spans 45 sensors, errors in five of
  them are five disjoint log lines with no way to group them.
- Stack traces from `MoneoApiClient.get_latest_sensor_reading()` are
  intentionally suppressed (`return None`) — the only signal that a
  sensor's upstream call failed is a `WARNING` line with the sensor
  id, not durably stored.

### 6. Code comments

**What exists:**
- Module / class docstrings on `MoneoApiClient` and `MoneoPoller`.
- A one-liner above `poll_latest_readings` and `sync_sensor_metadata`.

**What's missing or wrong:**
- Nothing in `MoneoApiClient` explains that `/sensors/{id}/latest`
  is not a real endpoint. (Worse: the docstring says
  "Fetch the most recent reading for a sensor.")
- Nothing in `sync_sensor_metadata` explains why we use
  `reference.deviceId` instead of node `id` — a future reader will
  not know that distinction matters until they break it.
- The `unit = ""` extraction path
  (`moneo_poller.py:124-127`) is not commented. The structure
  `reference.dataSource.unit.symbol` is non-obvious and brittle
  (any `null` on the chain crashes via `.get(...)` on `None`).
- `category.lower()` on line 78/79 swallows the
  `Root/FunctionalLocation/Device/DataSource/CalcDataSource` enum
  silently; comment what's filtered out and why.
- The hardcoded `sensor_type="dataSource"` literal on line 133 has
  no comment explaining why it's a constant rather than the actual
  upstream value.

---

## Proposed changes

Aim for the smallest change that lets the system actually produce
readings, then layer observability on top. **Backend is frozen, so
each item requires sign-off before code lands.**

### P1. Fix the integration (must-do; nothing else matters until this is in)

**Rationale:** Without these the poll job is a no-op. All other
concerns become academic.

- `services/moneo_api_client.py` — replace
  `get_latest_sensor_reading()` / `get_sensor_readings()` with one
  method `get_processdata(device_id, datasource_id, from_ms,
  to_ms, order="+timestamp", page=1, page_size=500)` that calls
  `/processdata/device/{device_id}/datasource/{datasource_id}` with
  the documented params and returns the envelope as-is. Keep the
  current methods for one release with a `DeprecationWarning`
  pointing at the new method.
- `services/moneo_poller.py:120-138` — store the deep id. Two
  options:
  - **Minimal:** keep `Sensor.moneo_sensor_id` as today's topology
    id (it's used as the public stable handle in routes) and add a
    new column `Sensor.moneo_datasource_ref` (string, indexed,
    nullable) for the inner `reference.dataSource.id`. Populate it
    in `sync_sensor_metadata`. The poller passes
    `(asset.moneo_asset_id, sensor.moneo_datasource_ref)` to the new
    client method.
  - Alternative: overwrite `moneo_sensor_id` with the deep id. Breaks
    nothing public-facing (frontend treats it opaquely) but harder
    to migrate cleanly.
  → Recommend the additive column. DDL sketch:
    ```sql
    ALTER TABLE sensors
      ADD COLUMN moneo_datasource_ref VARCHAR;
    CREATE INDEX ix_sensors_moneo_datasource_ref
      ON sensors (moneo_datasource_ref);
    ```
- `services/moneo_poller.py:34` — `datetime.fromtimestamp(raw_ts/1000,
  tz=timezone.utc)` instead of `fromisoformat`.
- `services/moneo_poller.py:78` — guard `category` against `None`
  before `.lower()`.
- `services/moneo_poller.py:124-127` — defensive unit extraction
  (`(reference.get("dataSource") or {}).get("unit") or {}`).
- Add a DB-level unique constraint on
  `(sensor_readings.sensor_id, sensor_readings.timestamp)` via a new
  Alembic migration `0003_sensor_reading_unique.py`. Replace the
  per-row pre-SELECT with a Postgres `INSERT … ON CONFLICT DO
  NOTHING` (use `sqlalchemy.dialects.postgresql.insert`).

**Risks:** schema change requires the frozen-backend approval. The
unique-constraint migration has to handle any pre-existing duplicates
first (`SELECT sensor_id, timestamp, count(*) FROM sensor_readings
GROUP BY 1,2 HAVING count(*)>1`). The new column on `sensors` is
purely additive.

### P2. Resumability — watermark-driven polling

**Rationale:** Right now any outage longer than the poll interval
loses data forever. Cheap to fix once P1 is in.

- `services/moneo_poller.py:poll_latest_readings()` — for each
  active sensor compute `from_ms = (sensor.last_seen_at or
  now_utc - 24h).timestamp() * 1000 + 1` (`+1` to avoid re-fetching
  the boundary point), `to_ms = now * 1000`. Page through
  `get_processdata(..., order="+timestamp", page_size=500)` until
  `page * pageSize >= totalCount`. Insert with ON CONFLICT DO
  NOTHING. Update `sensor.last_seen_at = max(timestamp)` inside the
  same tx.
- Hard cap: `MAX_BACKFILL_HOURS` env setting (default 24h) — if
  `last_seen_at` is older than that we deliberately give up the gap
  rather than thunder against the upstream after a long outage.
- 429 / 5xx: exponential backoff with full jitter, max 3 attempts
  per page, no retry on 401/403.

**Risks:** Page-size sweep for thousands of historical points on
first activation. The `MAX_BACKFILL_HOURS` cap is the safety valve.

### P3. Sync-run observability + audit log (one table does both)

**Rationale:** Concerns 4 and 5 are the same problem (`sync_runs`
table). Combining them is one migration plus a few inserts; do not
split.

DDL sketch:
```sql
CREATE TABLE sync_runs (
  id            BIGSERIAL PRIMARY KEY,
  source        VARCHAR(40)  NOT NULL,    -- 'moneo.readings' | 'moneo.metadata'
  started_at    TIMESTAMPTZ  NOT NULL,
  finished_at   TIMESTAMPTZ  NULL,
  status        VARCHAR(20)  NOT NULL,    -- 'running'|'success'|'partial'|'failed'
  records_in    INT          NOT NULL DEFAULT 0,
  records_written INT        NOT NULL DEFAULT 0,
  error_count   INT          NOT NULL DEFAULT 0,
  last_cursor   BIGINT       NULL,        -- max timestamp_ms processed
  error_summary TEXT         NULL
);
CREATE INDEX ix_sync_runs_source_started ON sync_runs (source, started_at DESC);

CREATE TABLE sync_errors (
  id            BIGSERIAL PRIMARY KEY,
  sync_run_id   BIGINT REFERENCES sync_runs(id) ON DELETE CASCADE,
  sensor_id     INT    NULL REFERENCES sensors(id) ON DELETE SET NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind          VARCHAR(40) NOT NULL,     -- 'http_401'|'http_5xx'|'parse'|'unknown_field'|...
  http_status   INT NULL,
  message       TEXT NOT NULL
);
```

Wiring:
- Open a `sync_run` row at the top of `poll_latest_readings` /
  `sync_sensor_metadata`, close it at the bottom. Use a context
  manager so partial / failed states are recorded even on
  exception.
- One new endpoint, `GET /api/admin/sync/health`, returns:
  ```json
  {
    "moneo_readings": {
      "last_success_at": "...",
      "last_status": "success",
      "lag_seconds": 312,
      "consecutive_failures": 0
    },
    "moneo_metadata": { ... }
  }
  ```
- Hook: when `consecutive_failures >= N` or `lag_seconds > 2 *
  poll_interval`, emit an event the alert subsystem can subscribe to
  (out of scope for this slice; defined as an integration point).

**Risks:** Frontend currently has no health surface — purely
additive endpoint, no contract break. The two tables also become a
gentle retention concern; add a daily prune job for rows older than,
say, 90 days.

### P4. Token lifecycle + secret hygiene

**Rationale:** Token is plaintext, in git, duplicated in
`config.py`, and any future rotation has no playbook. This is the
single highest-likelihood production failure ahead.

- Remove the default value from `config.py:8`; let `Settings` raise
  if `MONEO_API_KEY` is unset.
- Add `backend/.env` to `.gitignore` (root `.gitignore` doesn't
  currently exclude it — verified) and `git rm --cached
  backend/.env`. Replace the committed file with `backend/.env.example`
  containing placeholder values only.
- Rotate the leaked token via the MONEO UI (out of band — user
  action).
- Add a startup check in `MoneoApiClient.__init__` that fires one
  `/nodes?pageSize=1` probe and logs `"MONEO auth OK"` or
  `"MONEO auth FAILED (401) — token expired or revoked"`. Same probe
  becomes part of the `/api/admin/sync/health` response.
- Document the manual rotation runbook in
  `backend/CLAUDE.md` (one paragraph): how to mint a new PAT in the
  MONEO UI, update `.env`, restart the service, verify via the
  health endpoint.

**Risks:** Removing the default may break local dev for anyone who
hasn't pulled the new `.env.example`. Coordinate with team.

### Items intentionally NOT proposed

- **Distributed lock (Redis advisory lock).** Single-instance
  guarantee matters under multi-worker deployment. The dashboard
  service today runs a single uvicorn process; deferred until
  horizontal scale is on the table.
- **Circuit breaker.** Token expiry already produces 401 → empty
  results; sync-run-level alerting from P3 is enough until we see
  real upstream instability.
- **Reading retention / pruning.** Out of scope for the sync audit;
  acknowledged in backend/CLAUDE.md as a known gap.
- **Switching to a "push" model.** MONEO does not document WebSocket
  / webhook / SSE endpoints. Polling is the only mechanism available.

---

## Implementation plan

Sequencing matters: P1 unblocks everything else. P3 depends on P1
because run-records are pointless until there *are* runs that fetch
data. P2 depends on P1. P4 is independent and can be parallelised.

### Slice 1 — Make the sync actually work

- **Scope:** P1 above.
- **Files:**
  `services/moneo_api_client.py`, `services/moneo_poller.py`,
  `DAL/models/sensor.py`, `DAL/models/sensor_reading.py`, new
  `migrations/versions/0003_processdata_compatibility.py`.
- **Deliverable:** Restart-and-go. Live MONEO readings flow into
  `sensor_readings` for every active sensor on every scheduler tick.
- **Dependencies:** Backend-freeze sign-off for new column + new
  unique constraint.
- **Success criteria:**
  - `SELECT COUNT(*) FROM sensor_readings WHERE created_at > now() - interval '10 minutes'` > 0 within ten minutes of restart.
  - Integration test: stub MONEO server returns the documented
    `/processdata` envelope; poller persists rows; second run with
    overlapping timestamps writes zero new rows.
  - No regressions on `routes/sensor_routes.py` GETs.

### Slice 2 — Watermark-driven catch-up

- **Scope:** P2 above.
- **Files:**
  `services/moneo_poller.py`, possibly a small helper in
  `services/moneo_api_client.py` for paging.
- **Deliverable:** A poll cycle after an outage backfills up to
  `MAX_BACKFILL_HOURS`. Per-sensor `last_seen_at` always reflects
  the newest persisted timestamp.
- **Dependencies:** Slice 1 merged.
- **Success criteria:**
  - Manual test: stop service for 30 minutes, restart, observe one
    sync run that writes >> 1 reading per sensor and brings
    `last_seen_at` to within `poll_interval` of `now()`.
  - Unit test: page through a 1200-row fixture in three pages; all
    rows persist; idempotent on re-run.

### Slice 3 — Sync runs + health endpoint

- **Scope:** P3 above.
- **Files:** new
  `DAL/models/sync_run.py`, `DAL/models/sync_error.py`, new
  `migrations/versions/0004_sync_runs.py`,
  `services/moneo_poller.py` (instrumentation),
  new `services/sync_health_service.py`,
  new `routes/admin_sync_routes.py`,
  `main.py` (router include).
- **Deliverable:** Every poll lands a `sync_runs` row;
  `/api/admin/sync/health` returns current freshness +
  failure-count per source.
- **Dependencies:** Slice 1 merged.
- **Success criteria:**
  - After 24h uptime, `sync_runs` has roughly `(24h / 5min) ≈ 288`
    `moneo.readings` rows plus 4 `moneo.metadata` rows.
  - `/api/admin/sync/health` returns non-stale data and is
    admin-gated identically to existing admin routes.
  - Manually pulling the network cable produces `status='failed'`
    rows + `sync_errors` rows; health endpoint reports
    `consecutive_failures > 0`.

### Slice 4 — Token hygiene + rotation runbook

- **Scope:** P4 above.
- **Files:** `backend/config.py`, root `.gitignore`,
  `backend/.env.example` (new), `backend/CLAUDE.md`, small change in
  `services/moneo_api_client.py` for the boot probe.
- **Deliverable:** No secret in the repo; clear rotation
  instructions; auth state visible at boot and in the health
  endpoint.
- **Dependencies:** Slice 3 for the health-endpoint integration
  (otherwise the auth probe just lives in logs).
- **Success criteria:**
  - `git ls-files | grep -i env` returns only `.env.example`.
  - Starting the service with an empty `MONEO_API_KEY` fails fast
    with a clear error.
  - Starting with a bogus key surfaces "MONEO auth FAILED" in logs
    within one second of boot.

(No fifth slice needed; if scope grows, split Slice 3 into
"sync_runs table + instrumentation" and "health endpoint + alert
hook" without changing the others.)

---

## Open questions for the user

1. **Schema sign-off.** Slices 1 and 3 each add tables / columns.
   Backend is frozen; please confirm we can land
   `0003_processdata_compatibility.py` (new `sensors.moneo_datasource_ref`
   column + unique constraint on `sensor_readings`) and
   `0004_sync_runs.py` (two new tables). No frontend-visible response
   shapes change.

2. **Migration of existing `sensors` rows.** After Slice 1 lands,
   should the migration also backfill `moneo_datasource_ref` from
   the JSON already in `sensor.extra_metadata` (where
   `reference.dataSource.id` was preserved verbatim), or do we drop
   the existing seed data and let the next metadata sync rebuild
   it? The former preserves operator-edited fields
   (`expected_poll_seconds`, range bands); the latter is simpler.
   **Recommendation:** backfill from `extra_metadata` to preserve
   operator work.

3. **`MAX_BACKFILL_HOURS` policy.** What's the right cap when a
   sensor has been offline for days — 24h (default I'd ship), 7d,
   or "no cap, hammer the upstream"?

4. **Frontend surface for sync status.** Should `/api/admin/sync/health`
   feed a banner / status-light somewhere in the UI, or is
   admin-only-via-curl sufficient for now? (Affects whether the
   endpoint needs a public-shaped view or remains admin-gated.)

5. **Token rotation cadence.** No expiry documented. Do you have an
   org policy for rotating long-lived service tokens (e.g. quarterly)?
   That sets the schedule for the runbook.

6. **`SensorReading.status` column.** The live `/processdata`
   response has no `quality` / `status` field. Three options:
   keep the column always populated `"ok"`, drop it in a later
   slice, or wire it to a derived value (e.g. `"stale"` when the
   row came in during catch-up). Lowest-cost path is to leave it
   alone; flag here so it doesn't surprise anyone.

7. **CalcDataSource handling.** Live sandbox has zero today, but
   they exist in the data model. Treat them as another sensor type
   when they appear, or ignore? (I'd treat them as sensors of
   `sensor_type='calcDataSource'`.)

8. **Begin implementation now, leave as plan only, or refine
   first?** Pause until you decide.

---

## Appendix — sample inventory

All files under `tmp/moneo-samples/`. Each is a JSON envelope with
`{status, url, headers, body_excerpt, body_length}` (or a tiny full
body where helpful). Token never appears in any file.

| File | Endpoint | Status | Note |
|---|---|---|---|
| `nodes.json` | `/nodes?pageSize=500` | 200 | 248 nodes total. |
| `node_category_examples.json` | derived | — | One example per category. |
| `processdata_documented.json` | `/processdata/device/<X>/datasource/<topology-id>` | 200 | `data:[]`, empty (wrong id type). |
| `processdata_with_readings.json` | `/processdata/device/<X>/datasource/<deep-id>` | 200 | `totalCount:64730`, sample readings. |
| `processdata_range_filtered.json` | `/processdata/...?fromTimestamp=...&toTimestamp=...&orderBy=+timestamp` | 200 | Confirms range + ascending order are honoured. |
| `client_sensors_latest_undoc.json` | `/sensors/<id>/latest` | **404** | Endpoint our client calls today. |
| `client_sensors_readings_undoc.json` | `/sensors/<id>/readings` | **404** | Endpoint our client calls today. |
| `auth_401_sample.json` | `/nodes` with bogus token | 401 | Empty body, no `WWW-Authenticate`. |
