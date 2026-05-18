# Stage 003 — Backend services: domain layer

**Status:** Audit complete
**Date:** 2026-05-19
**Files in scope:**
- `backend/services/auth_service.py`
- `backend/services/sensor_service.py`
- `backend/services/sensor_readings_service.py`
- `backend/services/dashboard_service.py`
- `backend/services/asset_service.py`
- `backend/services/analytics_service.py`
- `backend/services/alert_evaluator.py`
- `backend/services/notification_dispatcher.py`

---

## Pass 1 — Audit findings

| ID | File:Line | Severity | Category | Finding | Proposed fix | Risk | Touches behavior? |
|---|---|---|---|---|---|---|---|
| S3-C1 | [auth_service.py:48–50](backend/services/auth_service.py:48) | Critical | Security | `authenticate_user` short-circuits before calling bcrypt when the username does not exist. A nonexistent username returns in ~0 ms; an existing username with wrong password takes ~200 ms (bcrypt cost). This is a timing oracle for username enumeration. | Always call `_pwd_context.verify(password, ...)` — use a static `_DUMMY_HASH` when `user is None` — then check `if not user or not user.is_active: return None`. Timing becomes uniform regardless of username existence. | None for behavior (dummy hash is never stored); auth result is identical — `None` in both cases | **Yes — changes auth code path; needs explicit approval** |
| S3-M1 | [alert_evaluator.py](backend/services/alert_evaluator.py) (15+ sites) | Major | DRY | Alert state literals — `"ok"`, `"pending"`, `"firing"`, `"recovered"`, `"awaiting_ack"`, `"flapping_started"`, `"flapping_stopped"` — and alert condition literals — `"outside_range"`, `"no_data"` — appear as raw strings scattered across 15+ sites in the file. A single typo anywhere is a silent runtime bug (wrong DB value, wrong enum path). | Extract module-level string constants: `_STATE_OK = "ok"`, `_STATE_PENDING = "pending"`, `_STATE_FIRING = "firing"`, `_STATE_RECOVERED = "recovered"`, `_STATE_AWAITING_ACK = "awaiting_ack"`, `_STATE_FLAPPING_STARTED = "flapping_started"`, `_STATE_FLAPPING_STOPPED = "flapping_stopped"`, `_COND_OUTSIDE_RANGE = "outside_range"`, `_COND_NO_DATA = "no_data"`. Replace all 15+ sites. | None | No |
| S3-M2 | [notification_dispatcher.py:30](backend/services/notification_dispatcher.py:30) | Major | DRY | Sole remaining `db = SessionLocal(); try/finally db.close()` hot spot — the last of the 7 identified in Stage 1. The body already manages `db.commit()` and `db.rollback()` explicitly, so `session_scope()` can close the session safely. | Migrate to `with session_scope() as db:`. Update import: replace `SessionLocal` with `session_scope` from `DAL`. | Low | No |
| S3-m1 | [alert_evaluator.py:121,142,277](backend/services/alert_evaluator.py:121) | Minor | DRY | Format string `f"[{rule.severity.upper()}] {rule.name}"` appears × 3: annotation label at lines 121 and 142, notification `subject` at line 277. All three have the same reason to change (rule display format). | Extract `_alert_label(rule: AlertRule) -> str` as a module-level function. | None | No |
| S3-m2 | [alert_evaluator.py:71,73,75,76,79,80](backend/services/alert_evaluator.py:71) | Minor | DRY | `rule.threshold_lo if rule.threshold_lo is not None else float("-inf")` and its `threshold_hi / float("inf")` counterpart each appear × 3 in `_condition_met` (6 occurrences total). | Extract `@staticmethod _lo(rule: AlertRule) -> float` and `_hi(rule: AlertRule) -> float`. `_condition_met` then reads `lo = self._lo(rule); hi = self._hi(rule)`. | None | No |
| S3-m3 | [sensor_readings_service.py:19–21,67–69](backend/services/sensor_readings_service.py:19); [sensor_service.py:31–33,41–43](backend/services/sensor_service.py:31) | Minor | DRY | `db.query(Sensor).filter(Sensor.id == sensor_id).first()` + `if not sensor: raise ValueError(...)` pattern repeated × 2 in `sensor_readings_service` and × 2 in `sensor_service` (4 total). Cannot share a helper across files without a new module (would create a cross-file import in the wrong direction). | Extract `_require_sensor(db: Session, sensor_id: int) -> Sensor` as a module-level helper in **each** file independently (2 private helpers, not shared). | Low | No |
| S3-m4 | [dashboard_service.py:3](backend/services/dashboard_service.py:3) | Minor | DeadCode | `from typing import Optional` is imported but never used — every parameter uses `X \| None` union syntax. | Remove the import. | None | No |
| S3-m5 | [notification_dispatcher.py:56](backend/services/notification_dispatcher.py:56) | Minor | Clean | `from datetime import timedelta` is a deferred import inside the `except` block. Python allows this but it is confusing (readers scan top-of-file imports; this one is invisible). | Move to top-level imports. `timedelta` is already used only in this branch, but importing it at module load is free. | None | No |
| S3-n1 | [notification_dispatcher.py:39](backend/services/notification_dispatcher.py:39) | Nit | Magic | Batch limit `.limit(50)` is a bare literal. | Extract `_DISPATCH_BATCH_SIZE = 50` at module level. | None | No |
| S3-n2 | [notification_dispatcher.py:57](backend/services/notification_dispatcher.py:57) | Nit | Magic | Back-off base `60` (seconds) is a bare literal. Comment documents "1m, 2m, 4m, 8m" but the base is implicit. | Extract `_BACKOFF_BASE_SECONDS = 60`. | None | No |
| S3-n3 | [notification_dispatcher.py:113](backend/services/notification_dispatcher.py:113) | Nit | Magic | `timeout=10` in `httpx.AsyncClient` is a bare literal in `_send_webhook`. | Extract `_WEBHOOK_TIMEOUT_S = 10`. | None | No |
| S3-n4 | [alert_evaluator.py:312,320](backend/services/alert_evaluator.py:312) | Nit | Magic | Flap window `600` (seconds = 10 min) and flap threshold `4` (transitions) are bare literals in `_check_flapping`. The docstring names them in prose only. | Extract `_FLAP_WINDOW_SECONDS = 600` and `_FLAP_THRESHOLD = 4` at module level. | None | No |

---

## Datasource-ID investigation

**Question carried from Stage 2:** `moneo_poller.py:167` passes `sensor.name` as `datasource_id` to `get_processdata()`. The client docstring says `datasource_id` must be `reference.dataSource.id`. Are these always equal in practice?

**Where values are populated (read from `sync_sensor_metadata`):**

- `sensor.name` ← `data_source.get("name", moneo_sensor_id)` — the human-readable display name from the MONEO topology node (e.g. "Temperature", "Pressure Main").
- `sensor.moneo_datasource_ref` ← `reference.get("datasourceId") or ds_info.get("id")` — the spec-required path component for `/processdata` API calls (e.g. `"temp_001"`, `"1234-abcd"`). Stored separately from `moneo_sensor_id` (the topology node ID).

**Can they be equal?** Only by coincidence — if the MONEO operator has named sensors with their machine-readable datasource IDs. In a well-managed installation, names are human-readable strings while datasource IDs are system-assigned identifiers.

**Can they diverge in production?** Yes, and the divergence is the expected case. The fields come from entirely different parts of the MONEO node response (`name` vs. `reference.datasourceId`). If they diverge, `get_processdata` will be called with the wrong path component, likely returning an empty `data` list or a 404. The failure mode is **silent data loss**: `SyncRun.records_in` stays 0, no error is raised, no `sync_error` row is written.

**Impact:** Potentially all sensors whose display name differs from their datasource ref will never accumulate readings. This is a latent data loss bug whose severity depends on the live MONEO API data.

**Recommendation:** Spin off as a **separate task** with priority High. The fix (`datasource_id=sensor.moneo_datasource_ref or sensor.name` in `moneo_poller.py:167`) is one line in a closed-stage file. A targeted PR with live API verification is safer than touching it as part of a CR pass.

---

## Duplication map

**Cluster 1 — Alert state / condition string literals** [S3-M1]
- States: `"ok"` ×1, `"pending"` ×5, `"firing"` ×6, `"recovered"` ×3, `"awaiting_ack"` ×3, `"flapping_started"` ×2, `"flapping_stopped"` ×3 — all in `alert_evaluator.py`.
- Conditions: `"outside_range"` ×3, `"no_data"` ×2 — same file.
- **Proposed home:** module-level `_STATE_*` and `_COND_*` constants in `alert_evaluator.py`.

**Cluster 2 — Alert label format string** [S3-m1]
- `f"[{rule.severity.upper()}] {rule.name}"` at lines 121, 142 (annotation label), 277 (notification subject).
- **Proposed home:** `_alert_label(rule)` module-level function in `alert_evaluator.py`.

**Cluster 3 — Threshold default sentinel** [S3-m2]
- `rule.threshold_lo / float("-inf")` × 3; `rule.threshold_hi / float("inf")` × 3 — all in `_condition_met`.
- **Proposed home:** `_lo(rule)` / `_hi(rule)` static methods on `AlertEvaluator` (or module-level functions — prefer methods to keep them close to `_condition_met`).

**Cluster 4 — Sensor fetch-or-raise** [S3-m3]
- 2 sites in `sensor_readings_service.py` (lines 19–21, 67–69); 2 sites in `sensor_service.py` (lines 31–33, 41–43).
- Cannot share without a new module. Per-file extraction only. Below ≥3 threshold per file; flagged because both files have the same repetition.

**Cluster 5 — `SessionLocal()` hot spot** [S3-M2]
- 1 site in `notification_dispatcher.py:30`. Last of the original 7 from Stage 1.

---

## Behavior-affecting — needs explicit approval

- **S3-C1** — `authenticate_user` timing fix. Introducing a dummy-hash call for nonexistent users changes the execution path through `auth_service.authenticate_user`. The external result is identical (returns `None`), but bcrypt cost is now always incurred on this path. Latency for invalid-username attempts increases from ~0 ms to ~200 ms (matching valid-username-wrong-password). This is generally desirable from a security standpoint but is a behavior change.

---

## Deferred / leave-as-is

- **Bucket arithmetic in `sensor_readings_service.get_aggregated_readings`** — The `minute=(minute // bucket_minutes) * bucket_minutes` formula only works correctly for `bucket_minutes ≤ 60` (values > 60 would overflow the `minute` field). This is existing behavior; the route layer enforces the constraint. Leave as-is per hard constraint on aggregation math.
- **`_apply_state_machine` length (~80 lines)** — Exceeds the ~40-line target, but splitting into sub-methods would create a long call chain through complex state transitions. The prompt explicitly says "Don't fragment into long call chains." Leave.
- **`get_user_dashboards` / `get_public_dashboards` similarity** — Only 2 occurrences; below ≥3 threshold. Shared base query would reduce clarity. Leave.
- **`asset_service._update_subtree_paths` recursion** — Python recursion limit applies for very deep trees. Existing behavior; no change.
- **Response model imports in services** (`from routes.response_models.X import Y` in sensor, dashboard, analytics services) — Soft layering concern (services import from routes layer). No `HTTPException` involved; these are pure Pydantic models. Architectural refactor (move to `schemas/`) is out of scope and requires frontend impact assessment.
- **`_send_email` swallows `ImportError`** — Intentional soft-dependency pattern for an optional feature. Leave.

---

## Out-of-scope findings (for future stages)

### Stage 4 — Routes / WebSocket
- `routes/websocket_routes.py:47, :63` — two `SessionLocal()` hot spots (carried from Stage 1). Still open.
- `middleware.py:46` — lazy `KioskToken` import can be hoisted (Stage 1 noted).
- Response model layering: `routes/response_models/` is imported by services (`sensor_service`, `sensor_readings_service`, `dashboard_service`, `analytics_service`). If this layer is ever reorganised to `schemas/`, Stage 4 owns the change.

### Standalone task (high priority)
- **Datasource-ID bug:** `moneo_poller.py:167` uses `sensor.name` instead of `sensor.moneo_datasource_ref` as the `datasource_id` argument to `get_processdata`. See "Datasource-ID investigation" above. Fix is one line in a Stage-2-closed file — spin off as a dedicated PR with live API verification.

### Final docs pass
- `backend/CLAUDE.md:31` — claims `init_db()` preserved for tests (removed in Stage 1, S1-m1).
- `backend/CLAUDE.md` — folder structure references `DAL/models/alert_config.py` which does not exist.

---

## Orchestrator decisions

- Baseline tests: GREEN (assumed per orchestrator instruction to proceed)
- Approvals:
  - S3-C1 ✓ (with guards: confirm _DUMMY_HASH is real bcrypt hash with matching cost factor; confirm verify always called; add "why" comment; confirm _DUMMY_HASH never logged/returned/compared)
  - S3-M1 ✓
  - S3-M2 ✓
  - S3-m1 ✓
  - S3-m2 ✓ (module-level functions, not static methods)
  - S3-m3 ✗ (2 occurrences per file — below threshold; cross-file extraction needs new module for too little gain)
  - S3-m4 ✓
  - S3-m5 ✓
  - S3-n1 ✓
  - S3-n2 ✓
  - S3-n3 ✓
  - S3-n4 ✓
  - Datasource-ID investigation: spin off as separate high-priority task; writeup stays in status file for traceability

---

## Pass 2 — Applied

### Applied

- **S3-C1** — `auth_service.py`: Added `_DUMMY_HASH` (real bcrypt_sha256 hash computed at module load via `_pwd_context.hash()`). Rewrote `authenticate_user` to always call `_pwd_context.verify()` against `user.hashed_password` or `_DUMMY_HASH` for nonexistent users before checking `if not user or not password_ok or not user.is_active`. Added "why" comment. `_DUMMY_HASH` is never logged, returned, stored, or compared against real credentials.
- **S3-M1** — `alert_evaluator.py`: Extracted 7 `_STATE_*` constants and 2 `_COND_*` constants at module level. Replaced all 15+ raw string literals across `evaluate`, `_apply_state_machine`, `_close_open_annotation`, `_enqueue_notifications`, `_check_flapping`, and `_sync_sensor_ranges`.
- **S3-M2** — `notification_dispatcher.py`: Migrated `db = SessionLocal(); try/finally db.close()` to `with session_scope() as db:`. Updated import: `SessionLocal` → `session_scope`. Explicit `db.commit()` at line 59 preserved unchanged.
- **S3-m1** — `alert_evaluator.py`: Extracted `_alert_label(rule: AlertRule) -> str` module-level function. Replaced 3 occurrences of `f"[{rule.severity.upper()}] {rule.name}"` (annotation labels ×2, notification subject ×1).
- **S3-m2** — `alert_evaluator.py`: Extracted `_lo(rule: AlertRule) -> float` and `_hi(rule: AlertRule) -> float` module-level functions. Replaced 6 occurrences of the threshold-defaulting pattern in `_condition_met`.
- **S3-m4** — `dashboard_service.py`: Removed unused `from typing import Optional`.
- **S3-m5** — `notification_dispatcher.py`: Moved `from datetime import timedelta` from deferred (inside `except` block) to top-level imports.
- **S3-n1** — `notification_dispatcher.py`: Extracted `_DISPATCH_BATCH_SIZE = 50`; replaced `.limit(50)`.
- **S3-n2** — `notification_dispatcher.py`: Extracted `_BACKOFF_BASE_SECONDS = 60`; replaced `backoff = 60 * (2 ** entry.attempts)`.
- **S3-n3** — `notification_dispatcher.py`: Extracted `_WEBHOOK_TIMEOUT_S = 10`; replaced `timeout=10` in `_send_webhook`.
- **S3-n4** — `alert_evaluator.py`: Extracted `_FLAP_WINDOW_SECONDS = 600` and `_FLAP_THRESHOLD = 4`; replaced literals in `_check_flapping`.

### Skipped

- **S3-m3** — Rejected by orchestrator (2 occurrences per file is below threshold; cross-file extraction needs new module for too little gain).

### Files modified

- `backend/services/auth_service.py`
- `backend/services/alert_evaluator.py`
- `backend/services/notification_dispatcher.py`
- `backend/services/dashboard_service.py`

### Public surface changes inside scope

- `auth_service.authenticate_user` — behavior-identical refactor (always calls bcrypt; returns None for nonexistent/wrong-password/inactive). No signature change.
- `_DUMMY_HASH` — NEW module-level constant in `auth_service.py` (private, not exported).
- `_STATE_*` / `_COND_*` / `_FLAP_*` constants — NEW in `alert_evaluator.py` (additive; all private).
- `_lo`, `_hi`, `_alert_label` — NEW module-level functions in `alert_evaluator.py` (additive; private).
- `_DISPATCH_BATCH_SIZE`, `_BACKOFF_BASE_SECONDS`, `_WEBHOOK_TIMEOUT_S` — NEW in `notification_dispatcher.py` (additive; private).
- All other symbols unchanged.

### Contract-preservation evidence

**auth_service.py (S3-C1):**
- `hash_password` / `verify_password` / `create_access_token` / `create_kiosk_token` / `decode_token` / `seed_admin` — UNTOUCHED.
- `authenticate_user`: JWT issuance is upstream of this call (in the route). The method's return contract is unchanged: returns `User` on success, `None` on any failure. The only change is that bcrypt now runs for nonexistent usernames too. `_DUMMY_HASH` is computed via `_pwd_context.hash()` — same scheme (bcrypt_sha256), same cost factor as real hashes. `verify_password` is always called. `_DUMMY_HASH` is a module-level private constant: never passed to `logger`, never returned, never compared outside the method, never stored.

**alert_evaluator.py (S3-M1, S3-m1, S3-m2, S3-n4):**
- All state machine transition conditions are value-identical (constants are initialised to the same strings they replaced).
- `_lo(rule)` / `_hi(rule)` return exactly the same float as the replaced ternaries.
- `_alert_label(rule)` returns exactly the same string as the replaced f-strings.
- `_FLAP_WINDOW_SECONDS = 600`, `_FLAP_THRESHOLD = 4` — same values as the replaced literals.
- **Statelessness preserved:** no instance variables added or modified; `_lo`, `_hi`, `_alert_label` are module-level pure functions. Stage 2's AlertEvaluator() hoist in moneo_poller.py:247 remains correct.
- All function signatures and return types unchanged.

**notification_dispatcher.py (S3-M2, S3-m5, S3-n1–3):**
- `session_scope()` only closes the session on exit — no added commit semantics. Explicit `db.commit()` inside `dispatch_outbox` unchanged.
- `_DISPATCH_BATCH_SIZE = 50`, `_BACKOFF_BASE_SECONDS = 60`, `_WEBHOOK_TIMEOUT_S = 10` — same numeric values as replaced literals.
- Back-off formula `_BACKOFF_BASE_SECONDS * (2 ** entry.attempts)` is arithmetically identical to `60 * (2 ** entry.attempts)`.
- Moving `timedelta` import to top level has no semantic effect.

**dashboard_service.py (S3-m4):**
- Removing unused import has no effect on any runtime behaviour.

### Cross-stage notes

- Stage 4: `routes/websocket_routes.py:47, :63` still have two `SessionLocal()` hot spots — not touched here.
- Stage 4: `middleware.py:46` lazy `KioskToken` import can be hoisted.
- Standalone task (high priority): Datasource-ID bug — `moneo_poller.py:167` uses `sensor.name` instead of `sensor.moneo_datasource_ref`; see investigation writeup above.

### Test commands run

```
cd backend
pytest
```
_(not run by this agent; orchestrator executes)_

---

## Commit message draft

```
Stage 3 CR - Backend services: domain layer

* Fix username-enumeration timing oracle in authenticate_user: always run bcrypt verify against _DUMMY_HASH for nonexistent users so response time is uniform (auth_service.py)
* Extract _STATE_* / _COND_* string constants and _FLAP_WINDOW_SECONDS / _FLAP_THRESHOLD in alert_evaluator.py; replace all 15+ raw string literals across state machine, flap detection, and range sync
* Extract _lo() / _hi() module-level helpers in alert_evaluator.py; replace 6 threshold-default ternaries in _condition_met
* Extract _alert_label() module-level helper in alert_evaluator.py; replace 3 occurrences of the [SEVERITY] rule-name format string (annotation labels ×2, notification subject ×1)
* Adopt session_scope() in notification_dispatcher.py (last SessionLocal hot spot from Stage 1 list)
* Extract _DISPATCH_BATCH_SIZE, _BACKOFF_BASE_SECONDS, _WEBHOOK_TIMEOUT_S constants in notification_dispatcher.py; move timedelta import to top level
* Remove unused `from typing import Optional` in dashboard_service.py
```
