# Stage 004 — Backend: routes, response models, middleware

**Status:** Stage complete
**Date:** 2026-05-19
**Files in scope:**
- `backend/routes/auth_routes.py`
- `backend/routes/dashboard_routes.py`
- `backend/routes/widget_routes.py`
- `backend/routes/sensor_routes.py`
- `backend/routes/analytics_routes.py`
- `backend/routes/moneo_routes.py`
- `backend/routes/admin_sync_routes.py`
- `backend/routes/admin_debug_routes.py`
- `backend/routes/websocket_routes.py`
- `backend/routes/response_models/` (all 8 files)
- `backend/middleware.py`

---

## Pass 1 — Audit findings

| ID | File:Line | Severity | Category | Finding | Proposed fix | Risk | Touches behavior? |
|---|---|---|---|---|---|---|---|
| S4-M1 | [sensor_routes.py:19–48](backend/routes/sensor_routes.py:19), [sensor_routes.py:72–97](backend/routes/sensor_routes.py:72), [sensor_routes.py:144–162](backend/routes/sensor_routes.py:144) | Major | Layering | Three route handlers contain raw ORM queries / direct DB logic that belongs in `SensorService` / `SensorReadingsService`: (1) `get_sensor_sparklines` executes a raw `db.query(SensorReading)` loop; (2) `get_readings_around` executes raw before/after queries; (3) `update_sensor_ranges` does `db.get`, `setattr`, `db.commit()`, `db.refresh()` in the route body. Violates "routes thin" rule. | Extract each into a new service method (`SensorReadingsService.get_sparklines`, `SensorReadingsService.get_readings_around`, `SensorService.update_sensor_ranges`). **Cannot apply this stage — services are Stage 3 closed. Flag only.** | n/a | No — behavior-identical extraction |
| S4-M2 | [dashboard_routes.py:39–42,61–64,74–76,88–91,101–104](backend/routes/dashboard_routes.py:39), [widget_routes.py:20–23,31–34](backend/routes/widget_routes.py:20), [sensor_routes.py:67–69,113–116,139–141](backend/routes/sensor_routes.py:67) | Major | DRY | `try: <service call> except ValueError as e: raise HTTPException(404, str(e))` repeated ×10+ across 3 route files. All sites translate the same exception type to the same HTTP status with the same detail origin (`str(e)` from service). | Extract a `_not_found_on_value_error()` context manager in a new `backend/routes/_shared.py` (with module docstring). Use at each call site: `with _not_found_on_value_error(): return _service.xxx(...)`. **Requires orchestrator decision (new file).** | Low | No |
| S4-M3 | [moneo_routes.py:161–162](backend/routes/moneo_routes.py:161), [moneo_routes.py:175–176](backend/routes/moneo_routes.py:175), [admin_sync_routes.py:17–20](backend/routes/admin_sync_routes.py:17) | Major | DRY | `if current_user.username != "admin": raise HTTPException(403, "Admin only")` inlined at 3 sites across 2 files. A 4th site in `admin_debug_routes.py` already extracted it as a local `_require_admin` dependency — the pattern exists, it is just not shared. | Add `require_admin(current_user=Depends(get_current_user)) -> User` to `middleware.py` alongside `requires_role`. Add a "why" comment (username string check — no `is_admin` column; see `backend/CLAUDE.md` gotchas). Use `Depends(require_admin)` at the 3 inline sites. **Also update `admin_debug_routes.py`'s local `_require_admin` to import the shared one.** | Low | No — same check, same 403 |
| S4-m1 | [websocket_routes.py:47–51](backend/routes/websocket_routes.py:47), [websocket_routes.py:62–67](backend/routes/websocket_routes.py:62) | Minor | DRY | Two `db = SessionLocal(); try: …; finally: db.close()` hot spots — the last two carried from Stage 1 out-of-scope list. Semantics: (1) line 47 — short-lived user-validation query before `accept()`; (2) line 62 — per-iteration read inside `while True` loop (new session per iteration, single query, close). Both are fully expressible via `session_scope()`. | Replace both with `with session_scope() as db:`. Update import: add `session_scope`, keep or drop `SessionLocal`. | Low | No |
| S4-m2 | [middleware.py:46](backend/middleware.py:46) | Minor | Import | Lazy `from DAL.models.kiosk_token import KioskToken` inside `get_current_user`. Stage 1 (S1-m2) re-exported `KioskToken` from `DAL.__init__`. No circular import survives: `DAL.models.kiosk_token` is a pure SQLAlchemy model with no imports from `middleware` or `services`. | Hoist to module top: extend existing `from DAL import User, get_db` to `from DAL import User, KioskToken, get_db`. Remove the lazy import. | None | No |
| S4-m3 | [sensor_routes.py:27](backend/routes/sensor_routes.py:27), [sensor_routes.py:81](backend/routes/sensor_routes.py:81) | Minor | Import | `from DAL.models.sensor_reading import SensorReading as SR` declared lazily inside two route function bodies. `SensorReading` is exported from `DAL.__init__`. No circular import. | Hoist to top-level: add `from DAL import SensorReading` (with alias `as SR` dropped — or keep as `SensorReading`). Remove the two in-body declarations. | None | No |
| S4-m4 | [response_models/auth.py:2](backend/routes/response_models/auth.py:2) | Minor | DeadCode | `from typing import Optional` imported but none of the four models in the file use `Optional` (all optional-like fields use `str = 'default'` or `bool = False`). | Remove the import. | None | No |
| S4-m5 | [response_models/widget.py](backend/routes/response_models/widget.py) | Minor | DeadCode | `WidgetRead` is the only class in the file. Grep confirms no other file imports from `routes.response_models.widget`. All widget-read usage goes through `DashboardWidgetRead` in `dashboard.py`. The file is entirely dead. | Delete `response_models/widget.py`. | None | No |
| S4-m6 | [response_models/dashboard.py:59–67](backend/routes/response_models/dashboard.py:59) | Minor | DRY | `DashboardWidgetCreate` declares exactly the same 8 fields with identical types and defaults as `DashboardWidgetBase`. No docstring or override distinguishes them. | Make `DashboardWidgetCreate` extend `DashboardWidgetBase` with an empty body (or a brief docstring only). Pydantic behaviour: field names, types, defaults, serialisation — identical. | None | No |
| S4-m7 | [dashboard_routes.py:28](backend/routes/dashboard_routes.py:28), [dashboard_routes.py:94](backend/routes/dashboard_routes.py:94), [moneo_routes.py:161](backend/routes/moneo_routes.py:161), [admin_sync_routes.py:17](backend/routes/admin_sync_routes.py:17) | Minor | Comments | Missing "why" comments at 4 key constraint sites: (a) `/public` route declared before `/{dashboard_id}` (FastAPI declaration-order matching — see CLAUDE.md gotcha); (b) `POST /layout` returns 204 no-body (frontend relies on local gridster state); (c) admin string check in moneo_routes and admin_sync_routes (intentional — no `is_admin` column). | Add one-line "why" comments at each site. | None | No |
| S4-n1 | [sensor_routes.py:41](backend/routes/sensor_routes.py:41) | Nit | Magic | `target = 12` bare literal (sparkline point count). | Extract `_SPARKLINE_POINTS = 12` at module level. | None | No |
| S4-n2 | [websocket_routes.py:74](backend/routes/websocket_routes.py:74) | Nit | Magic | `await asyncio.sleep(5)` — push cadence 5 s documented in CLAUDE.md but unnamed here. | Extract `_WS_PUSH_INTERVAL_SECONDS = 5` at module level. Add brief comment linking to contract. | None | No |
| S4-n3 | [moneo_routes.py:60,68,90,149](backend/routes/moneo_routes.py:60) | Nit | Type | `response_model=list[Any]` / `response_model=Any` on proxy routes. Acceptable for passthrough proxies but `Any` defeats OpenAPI generation for these endpoints. | Leave as-is (proxy routes have no fixed shape). | n/a | n/a |

---

## Duplication map

**Cluster 1 — `ValueError → HTTPException(404)` wrapper [S4-M2]**
- `dashboard_routes.py`: `get_dashboard` (L39), `update_dashboard` (L61), `delete_dashboard` (L74), `add_widget` (L88), `save_layout` (L101) — 5 sites
- `widget_routes.py`: `update_widget` (L20), `delete_widget` (L31) — 2 sites
- `sensor_routes.py`: `get_sensor` (L67), `get_sensor_readings` (L113), `set_sensor_active` (L139) — 3 sites
- Total: **10 sites** across 3 files, identical `status_code=404, detail=str(e)`. Strong DRY case.
- **Proposed home:** `backend/routes/_shared.py` — `_not_found_on_value_error()` context manager + module docstring explaining why this file exists and the "ValueError-from-service = 404" convention.

**Cluster 2 — Admin username check [S4-M3]**
- `moneo_routes.py:161, 175` (×2 in same file), `admin_sync_routes.py:17` (×1) — 3 inline sites
- `admin_debug_routes.py` already has local `_require_admin` — but not shared
- **Proposed home:** `middleware.py` as `require_admin(current_user=Depends(get_current_user)) -> User`

**Cluster 3 — `SessionLocal()` try/finally (websocket) [S4-m1]**
- `websocket_routes.py:47` (user validate) and `:62` (per-iteration read) — 2 sites
- Both: per-call session, no commit semantics. `session_scope()` safe.
- Session lifecycle note: the loop site creates a new session per iteration (not a long-held session held across `await asyncio.sleep(5)`). Replacing with `with session_scope() as db:` inside the loop body preserves this per-iteration close semantics.

**Cluster 4 — Time-range defaulting (below threshold) [not extracted]**
- `sensor_routes.py:108-112` and `analytics_routes.py:26-30` — 2 sites only. Below ≥3 threshold. Leave.

**Cluster 5 — `model_config = {"from_attributes": True}` across response models**
- Present in: `auth.py` (×2), `sensor.py` (×2 — SensorRead, SensorReadingRead), `dashboard.py` (×2 — DashboardWidgetRead, DashboardRead), `alert.py` (×3), `asset.py` (×2) — 11 occurrences total.
- A base class `_OrmModel(BaseModel)` with this config would save one line per model.
- **Proposed home:** `response_models/_base.py`. BUT: touching every response model file is high blast radius (contract-sensitive); Pydantic model inheritance from a custom base must be verified for no serialisation side-effects. Flag as option for orchestrator; skip for now.

---

## Behavior-affecting — needs explicit approval

- **S4-M2** — Creating `backend/routes/_shared.py` (new file). Not a behavior change, but requires orchestrator approval as a new shared module.
- **S4-M3** — Adding `require_admin` to `middleware.py` and wiring it as `Depends(require_admin)` at 3 route sites. Behavior-identical (same `username == "admin"` check, same 403 response), but changes how admin auth is wired. Requires orchestrator approval.

---

## Deferred / leave-as-is

- **S4-M1** — Raw ORM in sensor route bodies: services stage (Stage 3) is closed. Flag only; cannot fix.
- **S4-n3** — `response_model=Any` on MONEO proxy routes: acceptable for passthrough routes.
- **Time-range defaulting** (sensor + analytics) — 2 sites, below ≥3 threshold.
- **`model_config` base class** — high blast radius; flag only.
- **`requires_role` in `middleware.py`** — already present, clean, correctly placed.

---

## Out-of-scope findings (for future stages)

### Stage 5 (tests) — no route test coverage for new endpoints
- `GET /api/sensors/sparklines`, `GET /api/sensors/{id}/readings/around`, `PUT /api/sensors/{id}/ranges`, `POST /api/moneo/admin/poll-readings` — all present in routes but absent from `backend/CLAUDE.md` endpoint inventory. Need docs update AND test coverage.
- `admin_debug_routes.py` has no tests (DIAGNOSTIC file, but still registered routes).

### Route files outside Stage 4 scope (future stage candidate)
- `backend/routes/admin_kiosk_routes.py` — not reviewed
- `backend/routes/alert_routes.py` — not reviewed
- `backend/routes/annotation_routes.py` — not reviewed
- `backend/routes/admin_user_routes.py` — not reviewed
- These files exist and may have the same `ValueError→404`, admin-check, or `SessionLocal` patterns.

### Standalone task (datasource-ID bug — carried from Stage 3)
- `admin_debug_routes.py:152` also uses `sensor.name` as `datasource_id` (same bug as `moneo_poller.py:167`). Both are within the same standalone datasource-ID fix task.

### Soft layering concern (carried from Stage 3)
- `dashboard_service.py`, `sensor_service.py`, `sensor_readings_service.py`, `analytics_service.py` import Pydantic models from `routes/response_models/`. Moving models to `schemas/` is a future architectural pass.

### Final docs pass
- `backend/CLAUDE.md` endpoint inventory is missing: `/api/sensors/sparklines`, `/api/sensors/{id}/readings/around`, `PUT /api/sensors/{id}/ranges`, `POST /api/moneo/admin/poll-readings`.
- `backend/CLAUDE.md:31` — still references removed `init_db()` as "preserved for tests" (carried from Stage 1).

---

## Orchestrator decisions

- Baseline tests: GREEN (assumed — orchestrator instructed to proceed)
- S4-M1 ✗ — flag-only; services stage closed; carry forward
- S4-M2 ✓ — new file `routes/_shared.py` with module docstring; `str(e)` passthrough is part of public contract
- S4-M3 ✓ — exact `username != "admin"` check; exact 403 + "Admin only"; add "why" comment in `require_admin` docstring; `admin_debug_routes.py` local `_require_admin` fully replaced — no duplicate
- S4-m1 ✓
- S4-m2 ✓ — confirm no circular import after hoist
- S4-m3 ✓ — confirm no circular import
- S4-m4 ✓
- S4-m5 ✓ — grep all import forms first; zero hits required
- S4-m6 ✓ — OpenAPI diff must be byte-identical for `DashboardWidgetCreate`; revert if non-empty
- S4-m7 ✓
- S4-n1 ✓
- S4-n2 ✓
- S4-n3 ✗ — leave `response_model=Any` on proxy routes

---

## Pass 2 — Applied

### Applied

- **S4-M2** — Created `backend/routes/_shared.py` with `_not_found_on_value_error()` context manager and full module docstring explaining the ValueError→404 contract and str(e) passthrough invariant. Applied at all 10 sites: `dashboard_routes.py` (×5: get_dashboard, update_dashboard, delete_dashboard, add_widget, save_layout), `widget_routes.py` (×2: update_widget, delete_widget), `sensor_routes.py` (×3: get_sensor, get_sensor_readings, set_sensor_active). Removed now-unused `HTTPException` import from `dashboard_routes.py` and `widget_routes.py`; also removed unused `DashboardWidgetUpdate` import from `dashboard_routes.py`.

- **S4-M3** — Added `require_admin` dependency to `middleware.py` with docstring referencing backend/CLAUDE.md gotchas and explicitly noting the username string check is intentional. Replaced 3 inline admin checks in `moneo_routes.py` (×2) and `admin_sync_routes.py` (×1) with `Depends(require_admin)`. Removed now-unused `HTTPException`/`status` imports from `admin_sync_routes.py`. Replaced local `_require_admin` in `admin_debug_routes.py` with import from `middleware` — no duplicate implementation remains.

- **S4-m1** — Replaced both `SessionLocal()` hot spots in `websocket_routes.py` with `session_scope()`. Line 47 (user validation before accept): `with session_scope() as db:` wraps the single query, closes on exit, user checked after. Line 62 (per-iteration read loop): `with session_scope() as db:` inside `while True`, new session per iteration as before. `SessionLocal` import replaced with `session_scope`.

- **S4-m2** — Hoisted lazy `from DAL.models.kiosk_token import KioskToken` to module-top in `middleware.py` by extending the existing `from DAL import User, get_db` to `from DAL import User, KioskToken, get_db`. Circular import verification: `DAL.models.kiosk_token` is a pure SQLAlchemy model with no import of `middleware`, `routes`, or `services` — no cycle introduced.

- **S4-m3** — Added `from DAL import SensorReading` to top-level imports in `sensor_routes.py`. Removed lazy `from DAL.models.sensor_reading import SensorReading as SR` at lines 27 and 81. Updated both function bodies to use `SensorReading` directly (dropped `SR` alias). Circular import verification: `DAL.models.sensor_reading` imports only from SQLAlchemy — no cycle.

- **S4-m4** — Removed unused `from typing import Optional` from `response_models/auth.py`. Confirmed: none of the four models in the file (`LoginRequest`, `TokenResponse`, `UserRead`, `UserAdminRead`) use `Optional`.

- **S4-m5** — Deleted `response_models/widget.py`. Final grep confirmed zero references to `WidgetRead`, `routes.response_models.widget`, `from .widget`, or `from routes.response_models import widget` across the entire backend. `response_models/__init__.py` is a 1-line placeholder with no re-exports.

- **S4-m6** — **REVERTED.** Applied inheritance (`DashboardWidgetCreate(DashboardWidgetBase)`) with a class docstring; the class docstring appeared as a `description` field in the OpenAPI component schema, causing a non-empty diff. Reverted to the original flat field declaration. Root cause: Pydantic v2 includes class docstrings in JSON schema output. A pure-pass `class DashboardWidgetCreate(DashboardWidgetBase): pass` (no docstring) would likely produce an empty diff but was not retried — full revert per orchestrator instruction. Carry forward as a future micro-task to verify with the docstring-free form.

- **S4-m7** — Added "why" comments at 3 sites: (a) `/public` route in `dashboard_routes.py` — FastAPI declaration-order matching; (b) `POST /layout` in `dashboard_routes.py` — 204 no-body, frontend relies on local gridster state; (c) `require_admin` docstring in `middleware.py` covers the admin string check sites in moneo/admin_sync routes.

- **S4-n1** — Extracted `_SPARKLINE_POINTS = 12` at module level in `sensor_routes.py`; replaced `target = 12` literal and all `target` references in the sparkline handler.

- **S4-n2** — Extracted `_WS_PUSH_INTERVAL_SECONDS = 5` at module level in `websocket_routes.py` with a comment noting the frontend UX is tuned to this cadence; replaced `asyncio.sleep(5)` with `asyncio.sleep(_WS_PUSH_INTERVAL_SECONDS)`.

### Skipped

- **S4-M1** — Flag-only; service stage closed. Raw ORM in `get_sensor_sparklines`, `get_readings_around`, `update_sensor_ranges` remains as-is.
- **S4-m6** — Reverted per diff check (see Applied section). Carry forward.
- **S4-n3** — `response_model=Any` on proxy routes: left as-is per orchestrator decision.

### Files modified

- `backend/routes/_shared.py` (new)
- `backend/middleware.py`
- `backend/routes/dashboard_routes.py`
- `backend/routes/widget_routes.py`
- `backend/routes/sensor_routes.py`
- `backend/routes/moneo_routes.py`
- `backend/routes/admin_sync_routes.py`
- `backend/routes/admin_debug_routes.py`
- `backend/routes/websocket_routes.py`
- `backend/routes/response_models/auth.py`
- `backend/routes/response_models/widget.py` (deleted)

### Public surface changes inside scope

- `middleware.require_admin` — NEW FastAPI dependency (additive; `requires_role` companion).
- `routes._shared._not_found_on_value_error` — NEW context manager in new module (additive).
- `_SPARKLINE_POINTS` — NEW module constant in `sensor_routes.py` (additive, private).
- `_WS_PUSH_INTERVAL_SECONDS` — NEW module constant in `websocket_routes.py` (additive, private).
- `WidgetRead` in `response_models/widget.py` — REMOVED (confirmed dead: no route `response_model=` ever referenced it; not in OpenAPI schema).
- `DashboardWidgetUpdate` import in `dashboard_routes.py` — REMOVED (was imported but never used in that file; used correctly in `widget_routes.py`).
- All HTTP endpoint paths, methods, status codes, request params, and response shapes — **UNCHANGED**.

### Contract-preservation evidence

**OpenAPI diff (pre vs post):** **EMPTY** — confirmed by `diff cr/openapi_pre_stage4.json cr/openapi_post_stage4.json` returning exit 0 with no output.

**Per route-handler check:**
- `dashboard_routes.py`: all 7 handlers — paths, methods, status codes, request params, `response_model=` annotations unchanged. `_not_found_on_value_error()` translates ValueError to 404 with `str(e)` — same as before. `status_code=201/204` unchanged.
- `widget_routes.py`: both handlers — paths, methods, `response_model=DashboardWidgetRead` unchanged. `status_code=204` for delete (was `status.HTTP_204_NO_CONTENT` = 204 — identical integer).
- `sensor_routes.py`: all handlers — paths, methods, `response_model=` annotations, `Query(...)` params unchanged. `SensorReading` object identity unchanged (same DAL export).
- `moneo_routes.py`: `/admin/sync-metadata` and `/admin/poll-readings` — paths, methods, return shapes `{"status": ..., "message": ...}` unchanged. Admin gate still fires before any logic (now via `Depends(require_admin)` which raises 403 at injection time, same as before).
- `admin_sync_routes.py`: `/health` — path, method, response shape (from `SyncHealthService().get_health(db)`) unchanged. Admin gate unchanged.
- `admin_debug_routes.py`: all 3 DIAGNOSTIC handlers — `Depends(require_admin)` is the same function with the same logic.
- `websocket_routes.py`: path `/ws/sensors/{sensor_id}`, `?token=<jwt>` query param, close code `1008`, JSON message shapes all unchanged. Auth still validated before `websocket.accept()` — the `session_scope()` call at line 52 completes (user fetched) before `accept()` at line 59. Per-iteration session lifecycle unchanged.
- `middleware.py`: `get_current_user` return type and exception behavior (401 on invalid/inactive) unchanged. `KioskToken` hoisted from lazy import — same class, same lookup semantics.

**Response models:**
- `response_models/auth.py`: all 4 models — field names, types, defaults, `model_config` unchanged. Only `Optional` import removed.
- `response_models/dashboard.py`: `DashboardWidgetCreate` fully reverted — field-identical to original.
- All other response models untouched.

**WebSocket:**
- `websocket.close(code=1008)` paths preserved at all 4 guard points (no token, invalid token, no `user_id` in payload, user not found / inactive).
- `websocket.accept()` still called **after** all auth guards complete.
- `_WS_PUSH_INTERVAL_SECONDS = 5` equals previous literal 5 — cadence identical.

### Cross-stage notes

- **S4-M1 (raw ORM in routes)** — `get_sensor_sparklines`, `get_readings_around`, `update_sensor_ranges` still contain route-body ORM logic. Needs a future micro-stage that extends the service layer.
- **S4-m6 carry-forward** — `DashboardWidgetCreate` duplication with `DashboardWidgetBase` can be resolved with a pure-pass inheritance (`class DashboardWidgetCreate(DashboardWidgetBase): pass`, no docstring). The class docstring was the sole cause of the OpenAPI diff; removing it would likely produce an empty diff. Verify before applying.
- **Route files outside scope** — `admin_kiosk_routes.py`, `alert_routes.py`, `annotation_routes.py`, `admin_user_routes.py` not reviewed; likely share the ValueError→404 pattern and can adopt `_not_found_on_value_error()` in a future pass.
- **Datasource-ID bug** — `admin_debug_routes.py:152` and `moneo_poller.py:167` both use `sensor.name` instead of `sensor.moneo_datasource_ref`. Standalone task (high priority, from Stage 3).
- **Stage 5 (tests)** — `pytest` command; suspects if failures appear: any test that directly imported `SessionLocal` from `websocket_routes` context, or mocked `KioskToken` via full path.

### Test commands run

```
cd backend
pytest
```
_(not run by this agent; orchestrator executes)_

---

## Commit message draft

```
Stage 4 CR - Backend: routes, response models, middleware

* Add routes/_shared.py with _not_found_on_value_error() context manager; adopt at all 10 ValueError→404 try/except sites across dashboard_routes, widget_routes, sensor_routes
* Add require_admin dependency to middleware.py (username string check — intentional, no is_admin column); replace 3 inline admin checks in moneo_routes (×2) and admin_sync_routes; retire local _require_admin in admin_debug_routes
* Adopt session_scope() at 2 websocket_routes.py SessionLocal hot spots (user validation + per-iteration read loop); last sites from Stage 1 carry-over list
* Hoist lazy KioskToken import in middleware.py (circular import resolved by Stage 1 re-export)
* Hoist lazy SensorReading imports in sensor_routes.py; extract _SPARKLINE_POINTS = 12 constant
* Extract _WS_PUSH_INTERVAL_SECONDS = 5 in websocket_routes.py with comment noting frontend UX dependency
* Delete response_models/widget.py (WidgetRead — zero references, not in OpenAPI schema)
* Remove unused Optional import from response_models/auth.py; remove unused DashboardWidgetUpdate import from dashboard_routes.py
* Add "why" comments: /public route ordering, POST /layout 204 no-body, require_admin string-check rationale
* OpenAPI pre/post diff: empty
```
