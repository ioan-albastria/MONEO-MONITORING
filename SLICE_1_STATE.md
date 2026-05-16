# Slice 1 — State

## What this slice covered

Established Alembic and the migration chain. Added nine new columns to the `sensors`
table (freshness tracking + range bounds). Wired a freshness indicator to every widget
card in the frontend.

---

## Parts completed

**Alembic bootstrap**
`backend/migrations/` directory created with `env.py`, `script.py.mako`, and
`alembic.ini`. `alembic` added to `requirements.txt`.

**Migration 0001 — baseline**
`migrations/versions/0001_initial_schema.py` — captures the tables that already
existed before Alembic was introduced (users, sensors, sensor_readings, assets,
dashboards, dashboard_widgets, alert_configs stub). Empty `upgrade()`/`downgrade()`
because the schema already existed; serves as the Alembic baseline anchor.

**Migration 0002 — sensor extensions**
`migrations/versions/0002_sensor_extensions.py` (revision `0002`, down_revision `0001`)

Adds to `sensors` table:
| Column | Type | Notes |
|---|---|---|
| `expected_poll_seconds` | Integer, nullable | from MONEO API metadata |
| `last_seen_at` | DateTime(tz), nullable | updated by poller on each new reading |
| `normal_min` | Float, nullable | range bounds — all six default NULL |
| `normal_max` | Float, nullable | |
| `warning_min` | Float, nullable | |
| `warning_max` | Float, nullable | |
| `critical_min` | Float, nullable | |
| `critical_max` | Float, nullable | |
| `ranges_source` | String(20), NOT NULL | server_default `'manual'` |

**Sensor SQLAlchemy model**
`backend/DAL/models/sensor.py` updated — same 9 columns added as `Mapped[]` fields
under a `# Slice 1 additions` comment block.

**Poller: `last_seen_at` update**
`backend/services/moneo_poller.py` updated — after persisting a new reading, sets
`sensor.last_seen_at = reading.timestamp`.

**Backend sensor API**
`backend/routes/response_models/sensor.py` `SensorRead` model exposes the two
freshness fields (`expected_poll_seconds`, `last_seen_at`) so the frontend can read them.
The six range-bound fields are added to the model but set to `None`; they are not
writable via the sensor API yet (that is Slice 2's `PUT /{id}/ranges`).

**Frontend sensor type**
`frontend/src/app/types/sensor.ts` extended with `expected_poll_seconds: number | null`
and `last_seen_at: string | null`.

**Widget shell freshness indicator**
`frontend/src/app/modules/widgets/app-widgets-shell.component.ts`

New `@Input()` fields:
- `freshAt: string | null` — ISO timestamp of the last reading
- `expectedIntervalSeconds: number` — default 300; drives the stale/amber/red threshold

Logic: computes age of `freshAt` every second via `setInterval`; emits a CSS class
(`--fresh`, `--aging`, `--stale`) based on elapsed vs `expectedIntervalSeconds`.
Rendered as a small "Updated Ns ago" line in the widget chrome in muted text.

**Dashboard widget component**
`frontend/src/app/modules/dashboard/dashboard-widget.component.ts`

- Sets `this.freshAt` from the latest reading/analytics timestamp after each load.
- Sets `this.expectedIntervalSeconds` from `this.activeSensor?.expected_poll_seconds ?? 300`.
- Passes both as `[freshAt]` and `[expectedIntervalSeconds]` to `<app-widget-shell>`.

---

## Files created

| File | Notes |
|---|---|
| `backend/alembic.ini` | Alembic config; `sqlalchemy.url` overridden at runtime by `env.py` |
| `backend/migrations/env.py` | Alembic env; imports all model modules so autogenerate sees them |
| `backend/migrations/script.py.mako` | Alembic template |
| `backend/migrations/versions/__init__.py` | Empty |
| `backend/migrations/versions/0001_initial_schema.py` | Baseline anchor, revision `0001` |
| `backend/migrations/versions/0002_sensor_extensions.py` | 9-column sensor extension, revision `0002` |

---

## Files changed

| File | Change |
|---|---|
| `backend/requirements.txt` | Added `alembic>=1.14.0` |
| `backend/DAL/models/sensor.py` | Added 9 `Mapped[]` fields (freshness + range bounds) |
| `backend/services/moneo_poller.py` | Sets `sensor.last_seen_at` after each new reading |
| `backend/routes/response_models/sensor.py` | `SensorRead` exposes `expected_poll_seconds` + `last_seen_at` |
| `frontend/src/app/types/sensor.ts` | Added `expected_poll_seconds`, `last_seen_at` |
| `frontend/src/app/modules/widgets/app-widgets-shell.component.ts` | New `freshAt` + `expectedIntervalSeconds` inputs; freshness indicator logic |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.ts` | Sets and passes freshness inputs to widget shell |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.html` | Added `[freshAt]` and `[expectedIntervalSeconds]` bindings on `<app-widget-shell>` |

---

## Spec deviations

- `last_seen_at` was not in the original EXPANSION_PLAN column list but was added
  alongside `expected_poll_seconds` to give the freshness indicator a concrete data source.
  Without it the frontend would have to derive freshness from the analytics response,
  which is not available for gauge/stat widgets that fetch a single reading.
- The six range-bound columns (`normal_min`, etc.) are present in the DB and model after
  Slice 1 but are **not** exposed in `SensorRead` nor writable yet — both happen in Slice 2.

---

## Open issues going into Slice 2

- Range bound columns exist in DB/model but are opaque to the API and unrendered in the UI.
- `alert_configs` stub table still exists — Slice 2 will drop it and replace it with the
  full alert schema.
- `User.role` does not exist yet — Slice 2 adds it.
- `requires_role` FastAPI dependency does not exist yet — Slice 2 adds it.
- Pre-existing test failure: `test_aggregated_readings` in `test_services.py` uses
  `datetime(…, minute=60)` which is invalid Python. Not caused by Slice 1.
