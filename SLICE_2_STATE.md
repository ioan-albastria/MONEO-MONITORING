# Slice 2 — State for next session

## Parts completed

**A — Migration 0003**: `users.role` column (varchar 20, server_default 'viewer'),
drop `alert_configs` stub, create `alert_rule`, `alert_event`, `alert_state`,
`alert_route`, `alert_notification_outbox` tables. Proper `downgrade()` included.

**B — SQLAlchemy models**: 5 new model files created. `alert_config.py` deleted.
`DAL/models/__init__.py`, `DAL/__init__.py`, `migrations/env.py` all updated
(AlertConfig removed, 5 new model classes added). `User.role` column added.

**C — Sensor API range bounds**: `SensorRead` now exposes all 6 range fields +
`ranges_source`. `SensorRangesUpdate` Pydantic model added. `PUT /api/sensors/{id}/ranges`
route added (admin + operator only).

**D — `requires_role` dependency**: Added to `backend/middleware.py` as a factory
function returning an `async def` FastAPI dependency.

**E — Frontend Sensor type + sensor-status.ts**:
`frontend/src/app/types/sensor.ts` extended with 7 fields.
`frontend/src/app/core/sensors/sensor-status.ts` created with `statusOf()`,
`STATUS_COLOR_HEX`, and `StatusTier` type.

**F–J — Status coloring**:
- Line chart: `buildAnnotations()` adds faint green normal-band yaxis annotation
  (single-sensor only); `[annotations]` bound in template.
- Bar chart: `applyBarChart()` computes per-bar hex colour via `statusOf()`; falls
  back to PALETTE when bounds absent.
- Gauge: `applyGauge(reading, sensor?)` uses `statusOf()` for colour; `--gauge-color`
  CSS variable now drives the single-colour sweep; `buildGaugeBackground()` builds
  a multi-stop conic-gradient when zones are configured; `[style.background]` bound.
- Stat card: `statStatusTier` + `statStatusLabel` computed after each reading; status
  pill rendered in template with `data-tier` attribute; CSS rules added.
- Ranges button stub in chrome bar (single-sensor + editable only); `openRangesEditor()`
  logs a TODO and defers to Slice 3.

## Files created

| File | Notes |
|---|---|
| `backend/migrations/versions/0003_alert_schema_and_user_role.py` | Migration |
| `backend/DAL/models/alert_rule.py` | New model |
| `backend/DAL/models/alert_event.py` | New model |
| `backend/DAL/models/alert_state.py` | New model |
| `backend/DAL/models/alert_route.py` | New model |
| `backend/DAL/models/alert_notification_outbox.py` | New model |
| `frontend/src/app/core/sensors/sensor-status.ts` | StatusTier utility |
| `frontend/src/app/core/sensors/sensor-status.spec.ts` | Jasmine unit tests |
| `backend/tests/test_slice2.py` | Backend tests |

## Files changed

| File | Change |
|---|---|
| `backend/DAL/models/alert_config.py` | **Deleted** |
| `backend/DAL/models/user.py` | Added `role` column |
| `backend/DAL/models/__init__.py` | Swapped AlertConfig → 5 new models |
| `backend/DAL/__init__.py` | Same swap |
| `backend/migrations/env.py` | Same swap |
| `backend/middleware.py` | Added `requires_role()` factory |
| `backend/routes/response_models/sensor.py` | Added 7 range fields + SensorRangesUpdate |
| `backend/routes/sensor_routes.py` | Added PUT /{id}/ranges, imported Sensor + requires_role |
| `frontend/src/app/types/sensor.ts` | Added 7 range fields |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.ts` | Full status coloring rewrite |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.html` | annotations + gauge bg + stat pill + ranges btn |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.css` | Status pill CSS + gauge --gauge-color fix |

## Spec deviations

- `gaugeColor` was originally a computed getter returning CSS vars. Changed to a
  plain field storing hex values (from `STATUS_COLOR_HEX`). The fallback no-bounds
  path also uses hex now via the `gaugeTone` → `STATUS_COLOR_HEX` lookup. No
  functional regression; the CSS var path was unused anyway.
- `activeSensor` is set by both `updateExpectedInterval()` (runs during sensor-list
  load) and the individual `loadGauge`/`loadBarChart`/`loadLineChart` loaders. The
  loader sets it immediately from the full sensor data (including freshly loaded from
  `getSensor()`); the interval updater keeps it in sync on subsequent sensor-list
  refreshes.

## Open questions / Slice 3 prep

- `openRangesEditor()` is a console stub. Slice 3 should open a side-drawer with
  a form for normal/warning/critical bounds, wired to `PUT /api/sensors/{id}/ranges`.
- Alert evaluation engine (`AlertEvaluator` service, subscribe to new readings via
  `MoneoPoller`, update `alert_state`, emit `alert_event`, enqueue outbox rows)
  is the primary Slice 3 backend deliverable (EXPANSION_PLAN.md §3.3–3.4).
- WebSocket auth (attach JWT to WS connection) is still unaddressed — needed before
  the alert state can be pushed live to the frontend.
- The pre-existing `test_aggregated_readings` failure (invalid `datetime(…, minute=60)`)
  is still present in `test_services.py`; it predates Slice 1 and is not caused by
  Slice 2 changes.
