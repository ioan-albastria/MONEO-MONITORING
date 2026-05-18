# Stage 002 — Backend services: MONEO integration + scheduling

**Status:** Stage complete
**Date:** 2026-05-18
**Files in scope:**
- `backend/services/moneo_api_client.py`
- `backend/services/moneo_poller.py`
- `backend/services/sync_health_service.py`
- `backend/services/demo_seed_service.py`
- `backend/services/schedulers/__init__.py`
- `backend/services/schedulers/data_polling_scheduler.py`
- `backend/services/schedulers/alert_no_data_scheduler.py`

---

## Pass 1 — Audit findings

| ID | File:Line | Severity | Category | Finding | Proposed fix | Risk | Touches behavior? |
|---|---|---|---|---|---|---|---|
| S2-M1 | [data_polling_scheduler.py:20–60](backend/services/schedulers/data_polling_scheduler.py:20) | Major | Scheduler | No `max_instances=1` (or equivalent) on any of the 5 `add_job` calls. If `poll_latest_readings` takes >300 s (the interval), the next invocation starts concurrently: two runs open independent sessions, query sensors, and upsert — producing duplicate `SyncRun` rows and racing on `sensor.last_seen_at`. `sync_sensor_metadata` has the same exposure. | Add `max_instances=1, coalesce=True, misfire_grace_time=<interval>` to each job; then extract a `_DEFAULT_JOB_KWARGS` dict for the shared keys. | Medium — changes APScheduler execution model | **Yes — needs approval** |
| S2-m1 | [moneo_poller.py:97](backend/services/moneo_poller.py:97), [moneo_poller.py:327](backend/services/moneo_poller.py:327), [sync_health_service.py:32](backend/services/sync_health_service.py:32), [sync_health_service.py:79](backend/services/sync_health_service.py:79), [sync_health_service.py:235](backend/services/sync_health_service.py:235), [alert_no_data_scheduler.py:14](backend/services/schedulers/alert_no_data_scheduler.py:14) | Minor | DRY | 6 × `db = SessionLocal(); try/finally db.close()` hot spots identified by Stage 1. All sites use caller-managed commit/rollback — semantics are fully expressible via `session_scope()`. | Migrate each site to `with session_scope() as db:`. Update imports: replace direct `SessionLocal` import with `session_scope` from `DAL`. | Low | No |
| S2-m2 | [demo_seed_service.py:9–14](backend/services/demo_seed_service.py:9) | Minor | DeadCode | `_DEMO_SENSOR_IDS = ["DEMO-TEMP-001", ...]` constant is defined but never referenced in the file. The idempotency guard uses a hardcoded string literal; `_create_sensors` declares inline dicts. | Remove the constant. | None | No |
| S2-m3 | [moneo_poller.py:167](backend/services/moneo_poller.py:167), [moneo_poller.py:209](backend/services/moneo_poller.py:209) | Minor | Magic | Page size `500` appears at both the `get_processdata` call site (`page_size=500`) and the pagination guard (`if page * 500 >= total_count`). The inline comment at line 208 explicitly documents this as a maintenance risk. | Extract `_POLL_PAGE_SIZE = 500` at module level; use in both places. | Low | No |
| S2-m4 | [sync_health_service.py:108](backend/services/sync_health_service.py:108) | Minor | Magic | `6 * 3600` is hardcoded inline in the `cadences` dict. It duplicates the scheduler's `hours=6` setting in `data_polling_scheduler.py`. If the scheduler interval is ever changed, this will silently diverge. | Extract `_METADATA_SYNC_INTERVAL_SECONDS = 6 * 3600` at module level. Add a comment noting it must match the scheduler. | Low | No |
| S2-m5 | [moneo_api_client.py:194](backend/services/moneo_api_client.py:194) | Minor | Magic | `timeout=5.0` hardcoded in `verify_auth()`. While Stage 1 extracted `_MONEO_PROBE_TIMEOUT_SECONDS = 5` in `main.py`, the client's own timeout is a separate unnamed literal. | Extract `_VERIFY_AUTH_TIMEOUT_S = 5.0` at module level; use in `verify_auth()`. Do not cross-import from `main.py`. | Low | No |
| S2-m6 | [sync_health_service.py:197](backend/services/sync_health_service.py:197) | Minor | Clean | `_iso()` helper is defined inside the `for source in ("moneo.readings", "moneo.metadata"):` loop body — it is redefined on every iteration (2× per call). | Hoist to module-level function `_to_iso(dt: datetime | None) -> str | None`. | None | No |
| S2-m7 | [moneo_api_client.py:45–50](backend/services/moneo_api_client.py:45), [moneo_api_client.py:154–164](backend/services/moneo_api_client.py:154) | Minor | Error | `get_devices()` and `raw_get()` both have a broad `except Exception` fallthrough that logs "MONEO … error" without classifying the exception type. Transport errors (`httpx.ConnectError`, `httpx.ReadTimeout`) and JSON decode failures (`ValueError`) are lumped together, making triage harder. Both re-raise, so nothing is swallowed. | Replace the fallthrough with `except (httpx.RequestError, ValueError) as e: logger.error("... %s: %s", type(e).__name__, e); raise`. Any truly unexpected exception propagates without masking. | Low | No |
| S2-n1 | [data_polling_scheduler.py:29](backend/services/schedulers/data_polling_scheduler.py:29) | Nit | Comment | Comment "Run a metadata sync once at startup and then every 6 hours" is inaccurate — no `next_run_time` is set, so the first run happens after 6 h, not at startup. | Correct the comment to "every 6 hours; first run after initial interval". (Adding `next_run_time` would be a behavior change — comment fix only.) | None | No |
| S2-n2 | [moneo_poller.py:247](backend/services/moneo_poller.py:247) | Nit | Performance | `AlertEvaluator()` is instantiated on every sensor iteration inside `poll_latest_readings`. The evaluator is stateless and safe to hoist. | Move instantiation to once before the `for sensor in sensors:` loop. | None | No |
| S2-n3 | [demo_seed_service.py:104](backend/services/demo_seed_service.py:104) | Nit | Idiom | `db.bulk_save_objects(readings)` uses the SQLAlchemy 2.0-deprecated legacy path. | Replace with `db.add_all(readings)` for SA 2.0 idiom consistency. Semantics are identical for pure inserts with no relationships to track. | None | No |

---

## Duplication map

**Cluster 1 — `session_scope()` hot spots (6 sites across 4 files)** [S2-m1]
- `moneo_poller.poll_latest_readings` — full function body wrapped in manual try/finally
- `moneo_poller.sync_sensor_metadata` — same
- `sync_health_service.SyncHealthService.run()` — contextmanager; nests commits inside
- `sync_health_service.SyncHealthService.record_error()` — short-lived dedicated session, commits + expunges before close
- `sync_health_service.prune_sync_history()` — standalone function with rollback guard
- `alert_no_data_scheduler.check_no_data_alerts()` — standalone function with rollback guard
- All sites have caller-managed commit/rollback. `session_scope()` only closes. Safe migration.

**Cluster 2 — Magic page size 500 (2 sites, same file)** [S2-m3]
- `moneo_poller.py:167` — passed as `page_size=500` to `get_processdata`
- `moneo_poller.py:209` — guard `if page * 500 >= total_count`
- Below ≥3 threshold but co-located and explicitly flagged by an inline comment as a maintenance hazard. Extract warranted.

**Cluster 3 — `_iso` / `_to_iso` helper (loop redefinition)** [S2-m6]
- Defined inside the `for source in (...)` loop in `get_health()` — 2 iterations per call.
- Not DRY across files, but needless redefinition — hoist to module level.

**Conditional cluster — scheduler job kwargs (5 sites)** [blocked on S2-M1 approval]
- Once `max_instances=1, coalesce=True, misfire_grace_time=N` are approved, the repeated kwargs across 5 `add_job` calls warrant a `_DEFAULT_JOB_KWARGS` dict.
- Not actionable without S2-M1 approval.

---

## Behavior-affecting — needs explicit approval

- **S2-M1** — Add `max_instances=1, coalesce=True, misfire_grace_time=<seconds>` to all APScheduler jobs in `data_polling_scheduler.py`. Currently there is no concurrency guard; a slow poll cycle can overlap with the next scheduled invocation. Fixing this changes APScheduler's execution model (blocked/coalesced vs concurrent).
  - **Recommended values:**
    - `poll_sensor_readings`: `max_instances=1, coalesce=True, misfire_grace_time=settings.sensor_poll_interval_seconds`
    - `sync_sensor_metadata`: `max_instances=1, coalesce=True, misfire_grace_time=3600` (1 h grace for a 6 h job)
    - `check_no_data_alerts`: `max_instances=1, coalesce=True, misfire_grace_time=60`
    - `dispatch_notifications`: `max_instances=1, coalesce=True, misfire_grace_time=30`
    - `prune_sync_history`: `max_instances=1, coalesce=True, misfire_grace_time=3600`
  - **Not actionable until approved.**

---

## Deferred / leave-as-is

- **`moneo_poller.py:165` — `datasource_id=sensor.name`**: The `get_processdata` call passes `sensor.name` as the datasource path component rather than `sensor.moneo_datasource_ref`. The docstring in `moneo_api_client.py` explains that `datasource_id` must be `reference.dataSource.id`. Using `sensor.name` appears inconsistent — but this is existing behavior that may rely on the MONEO server accepting the name as an alias. Changing this could silently break all polling. **Leave as-is; flagged as out-of-scope observation for the orchestrator.**
- **`moneo_api_client.py` pagination DRY** — only one pagination loop exists (in `moneo_poller`); no `_paginated()` helper candidate.
- **`_DEMO_SENSOR_IDS` vs `_DEMO_DASHBOARD_NAME`** — `_DEMO_DASHBOARD_NAME` is used; only `_DEMO_SENSOR_IDS` is dead.

---

## Out-of-scope findings (for future stages)

### Stage 3 — Other services
- `services/notification_dispatcher.py:30` — `SessionLocal()` hot spot (confirmed by Stage 1 status)
- `moneo_poller.py:165` — `datasource_id=sensor.name` may be a latent bug; should use `sensor.moneo_datasource_ref`. Needs a careful review against live API samples before any change.

### Stage 4 — Routes / WebSocket
- `routes/websocket_routes.py:47, :63` — two `SessionLocal()` hot spots (from Stage 1 out-of-scope list)
- `middleware.py:46` — lazy `KioskToken` import can be hoisted (Stage 1 noted)

### Final docs pass
- `backend/CLAUDE.md:31` — claims `init_db()` preserved for tests; false after S1-m1
- `backend/CLAUDE.md:77` — folder structure mentions `DAL/models/alert_config.py`; file doesn't exist

---

## Orchestrator decisions

- Baseline tests: GREEN (assumed per orchestrator instruction to proceed)
- Approvals:
  - S2-M1 ✗ — deferred; dedicated single-purpose task after Stage 2 closes
  - S2-m1 ✓
  - S2-m2 ✓
  - S2-m3 ✓
  - S2-m4 ✓ (constant must carry comment pointing at data_polling_scheduler.py as source of truth)
  - S2-m5 ✓ (keep local to moneo_api_client.py — no cross-import)
  - S2-m6 ✓
  - S2-m7 ✓
  - S2-n1 ✓
  - S2-n2 ✓ — AlertEvaluator confirmed stateless (no instance variables, no per-call caches — read alert_evaluator.py); hoist approved
  - S2-n3 ✗ — skipped (bulk_save_objects and add_all not semantically identical; demo seed code)
  - Conditional scheduler-kwargs DRY cluster: NOT extracted — no repetitions without S2-M1 additions

---

## Pass 2 — Applied

### Applied

- **S2-m1** — Migrated 6 `SessionLocal()` hot spots to `session_scope()`:
  - `moneo_poller.poll_latest_readings`: combined `with self._health.run(...) as run, session_scope() as db:` (avoids indentation change to body); removed `finally: db.close()`
  - `moneo_poller.sync_sensor_metadata`: same combined-with pattern
  - `sync_health_service.SyncHealthService.run()`: `with session_scope() as db:` wraps the body; `db.expunge` still fires before `session_scope` closes
  - `sync_health_service.SyncHealthService.record_error()`: same; `db.expunge(error)` fires inside `with`, object is detached before session closes
  - `sync_health_service.prune_sync_history()`: `with session_scope() as db:` with inner `try/except` for rollback
  - `alert_no_data_scheduler.check_no_data_alerts()`: same pattern
  - Import in each file updated: `SessionLocal` → `session_scope`

- **S2-m2** — Removed unused `_DEMO_SENSOR_IDS` constant from `demo_seed_service.py`

- **S2-m3** — Extracted `_POLL_PAGE_SIZE = 500` in `moneo_poller.py`; replaced both occurrences (call site + pagination guard); removed the now-redundant inline comment that flagged the maintenance risk

- **S2-m4** — Extracted `_METADATA_SYNC_INTERVAL_SECONDS = 6 * 3600` in `sync_health_service.py` with comment pointing to `data_polling_scheduler.py` as the source of truth; replaced inline `6 * 3600` in `cadences` dict

- **S2-m5** — Extracted `_VERIFY_AUTH_TIMEOUT_S = 5.0` in `moneo_api_client.py`; used in `verify_auth()`; kept local to the client file

- **S2-m6** — Hoisted `_iso()` to module-level `_to_iso()` in `sync_health_service.py`; removed the loop-body definition; updated 3 call sites to `_to_iso()`

- **S2-m7** — Replaced broad `except Exception` in `get_devices()` and `raw_get()` with classified handlers (`httpx.RequestError` + `ValueError`). Confirmed: the broad block previously caught exactly these two types (transport errors and `response.json()` parse errors) — no other exception type was actually reaching it before re-raise. Both methods still log and re-raise; no swallowing introduced.

- **S2-n1** — Corrected inaccurate comment in `data_polling_scheduler.py` ("once at startup" → accurately describes 6 h interval with no startup-time trigger)

- **S2-n2** — Hoisted `AlertEvaluator()` instantiation above the `for sensor in sensors:` loop in `poll_latest_readings`. Confirmed stateless: `AlertEvaluator` has no instance variables; all methods receive their state via arguments; `_SEVERITY_COLOR` is a module-level constant. Safe to share across iterations.

### Skipped

- **S2-M1** — Deferred by orchestrator (dedicated scheduler-safety task)
- **S2-n3** — Skipped by orchestrator (`bulk_save_objects` vs `add_all` not semantically identical)
- Conditional scheduler-kwargs DRY cluster — not extracted (no repetitions without S2-M1 additions)

### Files modified

- `backend/services/moneo_api_client.py`
- `backend/services/moneo_poller.py`
- `backend/services/sync_health_service.py`
- `backend/services/demo_seed_service.py`
- `backend/services/schedulers/data_polling_scheduler.py`
- `backend/services/schedulers/alert_no_data_scheduler.py`

### Public surface changes inside scope

- `sync_health_service._to_iso` — NEW module-level function (was anonymous loop-body closure; now public within the module, not exported)
- `sync_health_service._METADATA_SYNC_INTERVAL_SECONDS` — NEW module constant (additive)
- `moneo_poller._POLL_PAGE_SIZE` — NEW module constant (additive)
- `moneo_api_client._VERIFY_AUTH_TIMEOUT_S` — NEW module constant (additive)
- All other symbols unchanged

### Contract-preservation evidence

**moneo_api_client.py**
- `get_devices()`: HTTP method GET, URL `{base_url}/nodes`, headers unchanged (set at client init), no query params. Return shape `list[dict]` — unchanged. Only exception classification changed (narrow types vs broad; all still re-raise).
- `raw_get()`: HTTP method GET, URL `{base_url}/{path}`, headers unchanged. Return shape unchanged. Same exception narrowing.
- `raw_get_response()`: untouched.
- `get_processdata()`: untouched except `page_size=_POLL_PAGE_SIZE` (same value 500). All params, URL pattern, retry policy, headers — unchanged.
- `verify_auth()`: GET `/nodes?pageSize=1`, `timeout=_VERIFY_AUTH_TIMEOUT_S` (5.0 — same value). Return shape `{ok, status_code, message}` — unchanged. broad `except Exception` intentionally kept (probe must never throw).

**moneo_poller.py**
- `poll_latest_readings()`: fetch→transform→persist→commit order **preserved**. Per-sensor `db.commit()` and `db.rollback()` calls unchanged. Outer `db.rollback(); raise` on fatal error unchanged. `session_scope()` only adds guaranteed close — no commit semantics change.
- `sync_sensor_metadata()`: single `db.commit()` after all upserts — unchanged. `db.rollback(); raise` on error — unchanged.
- `bulk_upsert_readings()`: untouched.

**APScheduler job parameters** (data_polling_scheduler.py): only the `sync_sensor_metadata` comment was changed (text, no code). All `add_job` arguments — `id`, `trigger`, `seconds`/`hours`/`hour`/`minute`, `replace_existing` — **unchanged**.

**DB write order**: no changes to any INSERT/UPDATE/DELETE ordering or commit boundaries.

### Cross-stage notes

- Stage 3 (other services): `notification_dispatcher.py:30` still has a `SessionLocal()` hot spot — not in this stage's scope.
- Stage 3 should also investigate `moneo_poller.py:165` using `sensor.name` as `datasource_id` instead of `sensor.moneo_datasource_ref`.
- Stage 5 (tests): test files reference `SessionLocal` directly — unchanged, per Stage 1 note.
- S2-M1 (scheduler `max_instances=1`) is a standalone task — the conditional scheduler-kwargs DRY cluster becomes actionable once that lands.

### Test commands run

```
cd backend
pytest
```
_(not run by this agent; orchestrator executes)_

---

## Commit message draft

```
Stage 2 CR - Backend services: MONEO integration + scheduling

* Adopt session_scope() at 6 service sites (moneo_poller ×2, sync_health_service ×3, alert_no_data_scheduler ×1); removes all manual SessionLocal/try-finally-close boilerplate in scope
* Extract _POLL_PAGE_SIZE = 500 in moneo_poller.py; replace both call site and pagination guard literals
* Extract _METADATA_SYNC_INTERVAL_SECONDS = 6 * 3600 in sync_health_service.py with cross-reference comment to data_polling_scheduler.py
* Extract _VERIFY_AUTH_TIMEOUT_S = 5.0 in moneo_api_client.py; use in verify_auth()
* Hoist _to_iso() to module level in sync_health_service.py; remove per-iteration redefinition
* Classify transport/parse exceptions in get_devices() and raw_get() (httpx.RequestError, ValueError) instead of broad except Exception
* Remove unused _DEMO_SENSOR_IDS constant from demo_seed_service.py
* Hoist AlertEvaluator() above sensor loop in poll_latest_readings (stateless — confirmed)
* Fix inaccurate scheduler comment: metadata sync fires on interval, not at startup
```
