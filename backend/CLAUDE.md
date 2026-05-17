# Backend — MONEO Monitoring Dashboard

## What this serves
FastAPI REST + WebSocket server. Issues JWT tokens for the Angular frontend, exposes CRUD
for dashboards/widgets, proxies and locally caches readings polled from the upstream IFM MONEO
API, and streams live sensor values to connected WebSocket clients.

## Stack

| Concern | Technology |
|---|---|
| Framework | FastAPI 0.115+ |
| Server | Uvicorn (standard extras) |
| Database | PostgreSQL, SQLAlchemy 2.0 (`pool_pre_ping=True`) |
| Auth | JWT HS256 via `python-jose`; passwords hashed with `passlib[bcrypt]` |
| Upstream client | `httpx.AsyncClient` — calls the IFM MONEO REST API |
| Background polling | APScheduler (async) — sensors polled every 300 s |
| Validation | Pydantic 2.10+ (response models in `routes/response_models/`) |
| Caching | Redis URL configured (`config.py`) but **not yet instantiated** in any service |

## Status — FROZEN
**Do not change backend endpoints, response shapes, or database schema without explicit user approval.**
The frontend was built against this contract. Even additive changes (new fields, new routes) require
sign-off because they may imply schema migrations.

## Migrations (Slices 1–3)

Schema is managed by **Alembic** (`backend/alembic.ini`, `backend/migrations/`).
- `migrations/env.py` — reads DB URL from `config.settings.database_url`; imports all models for autogenerate.
- `Settings.auto_migrate: bool = True` — when True, `main.py` lifespan runs `alembic upgrade head` on startup.
- `init_db()` in `DAL/db_context.py` is preserved for use in `tests/conftest.py` (SQLite in-memory fixtures only).

Migration chain (head = 0010):

| File | Purpose |
|---|---|
| `0001_initial_schema.py` | No-op baseline — tables pre-existed |
| `0002_sensor_extensions.py` | Adds 9 sensor columns (freshness + range bounds) |
| `0003_alert_schema_and_user_role.py` | Alert schema + user role column |
| `0004_alert_full_schema.py` | Replaces alert tables with full §3.3 schema |
| `0005_annotations.py` | Adds annotation table |
| `0006_dashboard_time_range.py` | Adds time-range picker columns to dashboards |
| `0007_asset_hierarchy.py` | Asset hierarchy: parent_id, kind, path |
| `0008_kiosk_tokens.py` | kiosk_tokens table |
| `0009_processdata_compatibility.py` | datasource ref column + reading uniqueness constraint on (sensor_id, timestamp) |
| `0010_sync_runs.py` | sync_runs and sync_errors observability tables |

## Folder structure

```
backend/
├── alembic.ini                # Alembic config (script_location=migrations, blank sqlalchemy.url)
├── migrations/
│   ├── env.py                 # Reads DB URL from config; imports all model modules
│   ├── script.py.mako         # Standard Alembic version template
│   └── versions/
│       ├── 0001_initial_schema.py
│       ├── 0002_sensor_extensions.py
│       ├── 0003_alert_schema_and_user_role.py
│       ├── 0004_alert_full_schema.py
│       ├── 0005_annotations.py
│       ├── 0006_dashboard_time_range.py
│       ├── 0007_asset_hierarchy.py
│       ├── 0008_kiosk_tokens.py
│       ├── 0009_processdata_compatibility.py
│       └── 0010_sync_runs.py
├── DAL/
│   ├── db_context.py          # Engine, SessionLocal, init_db() (tests only), Base
│   └── models/
│       ├── user.py            # User (credentials, is_active)
│       ├── dashboard.py       # Dashboard (owner_id FK, is_public)
│       ├── dashboard_widget.py # DashboardWidget (x/y/cols/rows, settings JSON)
│       ├── sensor.py          # Sensor (moneo_sensor_id unique, unit, asset_id)
│       ├── sensor_reading.py  # SensorReading (sensor_id + timestamp indexes)
│       ├── asset.py           # Asset (moneo_asset_id, location, lat/lng)
│       ├── alert_config.py    # AlertConfig (threshold_value, comparison_type)
│       ├── sync_run.py        # SyncRun (source, status, records_in/written, error_count)
│       └── sync_error.py      # SyncError (run_id FK, kind, message, sensor_id)
├── routes/
│   ├── auth_routes.py         # /api/auth/*
│   ├── dashboard_routes.py    # /api/dashboards/*
│   ├── widget_routes.py       # /api/widgets/*
│   ├── sensor_routes.py       # /api/sensors/*
│   ├── analytics_routes.py    # /api/analytics
│   ├── moneo_routes.py        # /api/moneo/* (upstream proxy + admin sync)
│   ├── admin_sync_routes.py   # /api/admin/sync/* (sync health surface)
│   ├── websocket_routes.py    # /ws/sensors/*
│   └── response_models/       # Pydantic schemas: auth.py, sensor.py, dashboard.py, analytics.py, widget.py
├── services/
│   ├── auth_service.py        # JWT create/decode, bcrypt verify
│   ├── sensor_service.py      # Sensor CRUD + status management
│   ├── sensor_readings_service.py # Time-series retrieval + aggregation
│   ├── dashboard_service.py   # Dashboard + widget CRUD
│   ├── analytics_service.py   # Multi-sensor analytics
│   ├── moneo_api_client.py    # httpx wrapper for upstream IFM API
│   ├── moneo_poller.py        # Sync metadata + poll latest readings
│   ├── sync_health_service.py # SyncHealthService — lifecycle tracker + health reporter
│   ├── demo_seed_service.py   # Seeds demo sensors/dashboards on first startup
│   └── schedulers/
│       └── data_polling_scheduler.py  # APScheduler job setup
├── middleware.py               # get_current_user() FastAPI dependency (Bearer → User)
├── config.py                   # Pydantic Settings from env vars
└── main.py                     # App factory, lifespan (migrate, seed, scheduler, auth probe)
```

## Auth

**Issuance** (`services/auth_service.py`, `routes/auth_routes.py`):
1. `POST /api/auth/login` — `LoginRequest { username, password }`
2. `AuthService.authenticate_user()` verifies bcrypt hash via `passlib`
3. `AuthService.create_access_token(user_id)` → JWT `{ user_id, exp: now+24h }`, HS256
4. Returns `TokenResponse { access_token, token_type: "bearer" }`

**Validation** (`middleware.py`):
- `get_current_user()` dependency used on all protected routes
- Extracts token with `fastapi.security.HTTPBearer()`
- Decodes with `python-jose`, raises HTTP 401 on invalid/expired token
- Fetches `User` by `user_id` from payload; raises 401 if user inactive

**Config keys** (`config.py`):
- `JWT_SECRET_KEY` — default `"changeme"` — **must be overridden in `.env`**
- `JWT_ALGORITHM` — `"HS256"`
- `JWT_ACCESS_TOKEN_EXPIRE_HOURS` — `24`

## Endpoint inventory

### Auth
| Method | Path | Auth | Purpose | Response model |
|---|---|---|---|---|
| POST | `/api/auth/login` | No | Issue JWT | `TokenResponse` |
| GET | `/api/auth/me` | Bearer | Current user info | `UserRead` |

### Dashboards
| Method | Path | Auth | Purpose | Response model |
|---|---|---|---|---|
| GET | `/api/dashboards` | Bearer | List user's dashboards | `list[DashboardRead]` |
| GET | `/api/dashboards/public` | No | List public dashboards | `list[DashboardRead]` |
| GET | `/api/dashboards/{id}` | Bearer | Single dashboard | `DashboardRead` |
| POST | `/api/dashboards` | Bearer | Create dashboard | `DashboardRead` |
| PUT | `/api/dashboards/{id}` | Bearer | Update name/desc/public | `DashboardRead` |
| DELETE | `/api/dashboards/{id}` | Bearer | Delete dashboard | 204 |
| POST | `/api/dashboards/{id}/widgets` | Bearer | Add widget | `DashboardWidgetRead` |
| POST | `/api/dashboards/{id}/layout` | Bearer | Save grid positions | 204 |

### Widgets
| Method | Path | Auth | Purpose | Response model |
|---|---|---|---|---|
| PUT | `/api/widgets/{id}` | Bearer | Update widget properties | `DashboardWidgetRead` |
| DELETE | `/api/widgets/{id}` | Bearer | Delete widget | 204 |

### Sensors
| Method | Path | Auth | Purpose | Response model |
|---|---|---|---|---|
| GET | `/api/sensors` | Bearer | List all / active sensors | `list[SensorRead]` |
| GET | `/api/sensors/{id}` | Bearer | Single sensor | `SensorRead` |
| GET | `/api/sensors/{id}/readings` | Bearer | Time-series readings (24h default) | `SensorTimeSeriesData` |
| GET | `/api/sensors/{id}/latest` | Bearer | Most recent reading | `{ value, timestamp, status }` |
| PATCH | `/api/sensors/{id}/active` | Bearer | Enable / disable sensor | `SensorRead` |

### Analytics
| Method | Path | Auth | Purpose | Response model |
|---|---|---|---|---|
| GET | `/api/analytics` | Bearer | Multi-sensor aggregated analytics | `AnalyticsResponse` |

**Key params for `/api/analytics`:** `sensor_id` (repeatable), `from`, `to` (ISO timestamps),
`aggregated` (bool), `bucket_minutes` (int).

### MONEO proxy
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/moneo/devices` | Bearer | List MONEO devices |
| GET | `/api/moneo/devices/{id}/sensors` | Bearer | Sensors under device |
| GET | `/api/moneo/sensors/{id}/latest` | Bearer | Raw latest reading |
| GET | `/api/moneo/sensors/{id}/readings` | Bearer | Raw historical readings |
| GET | `/api/moneo/raw/{path:path}` | Bearer | Generic MONEO proxy |
| POST | `/api/moneo/admin/sync-metadata` | Bearer + admin only | Trigger metadata sync |

### Admin — sync
| Method | Path | Auth | Purpose | Response |
|---|---|---|---|---|
| GET | `/api/admin/sync/health` | Bearer + admin | Sync health JSON | See shape below |

**`/api/admin/sync/health` response shape** (authoritative contract from Slice 3):
```json
{
  "moneo.readings": {
    "derived_status": "healthy",
    "last_status": "success",
    "last_run_started_at": "2026-05-17T13:28:00.677615+00:00",
    "last_run_finished_at": "2026-05-17T13:28:10.677622+00:00",
    "last_success_at": "2026-05-17T13:28:10.677622+00:00",
    "lag_seconds": 60,
    "consecutive_failures": 0,
    "records_in": 200,
    "records_written": 200,
    "error_count": 0,
    "last_error_kind": null,
    "last_error_message": null
  },
  "moneo.metadata": {
    "derived_status": "failed",
    "last_status": null,
    "last_run_started_at": null,
    "last_run_finished_at": null,
    "last_success_at": null,
    "lag_seconds": null,
    "consecutive_failures": 0,
    "records_in": 0,
    "records_written": 0,
    "error_count": 0,
    "last_error_kind": null,
    "last_error_message": null
  }
}
```
Shape is FROZEN — do not add fields without explicit approval.

### WebSocket
| Path | Auth | Purpose |
|---|---|---|
| `/ws/sensors/{sensor_id}` | `?token=<jwt>` query param | Live reading stream — pushes JSON every ~5s; token validated before `websocket.accept()`; closes with code 1008 on missing/invalid token |

## Data model

| Table | Key columns | Relationships |
|---|---|---|
| `users` | `id`, `username` (unique), `email` (unique), `hashed_password`, `is_active` | ← dashboards |
| `dashboards` | `id`, `owner_id` (FK users), `name`, `is_public` | → owner, ← widgets |
| `dashboard_widgets` | `id`, `dashboard_id` (FK, cascade delete), `widget_type`, `x/y/cols/rows`, `settings` (JSON) | → dashboard |
| `sensors` | `id`, `moneo_sensor_id` (unique), `moneo_datasource_ref` (unique nullable), `name`, `unit`, `asset_id` (nullable FK), `is_active`, `metadata` (JSON), `expected_poll_seconds` (nullable int), `last_seen_at` (nullable timestamptz), `normal_min/max`, `warning_min/max`, `critical_min/max` (all nullable float), `ranges_source` (varchar 20, default 'manual') | ← readings, ← alert_configs |
| `sensor_readings` | `id`, `sensor_id` (FK), `value`, `timestamp` — unique on `(sensor_id, timestamp)` | → sensor — indexed on `(sensor_id, timestamp)` |
| `assets` | `id`, `moneo_asset_id` (unique), `name`, `location`, `latitude`, `longitude`, `metadata` (JSON) | ← sensors |
| `alert_configs` | `id`, `sensor_id` (FK), `threshold_value`, `comparison_type`, `is_active` | → sensor |
| `sync_runs` | `id`, `source` (varchar, e.g. `"moneo.readings"`), `status`, `started_at`, `finished_at`, `records_in`, `records_written`, `error_count`, `error_summary` | ← sync_errors |
| `sync_errors` | `id`, `run_id` (FK sync_runs), `kind` (e.g. `"http_401"`), `message`, `sensor_id` (nullable) | → sync_run |

Tables are managed by Alembic migrations (see Migrations section above). On startup, `main.py` runs `alembic upgrade head` when `settings.auto_migrate=True`.

**SensorRead** (`routes/response_models/sensor.py`) exposes: `id`, `moneo_sensor_id`, `name`, `description`, `sensor_type`, `unit`, `asset_id`, `min_value`, `max_value`, `is_active`, `created_at`, `expected_poll_seconds` (nullable), `last_seen_at` (nullable). The six range-bound columns and `ranges_source` are schema-only (Slice 2 opens the API surface for them).

## Upstream MONEO API

**Client:** `services/moneo_api_client.py` — `MoneoApiClient` using `httpx.AsyncClient`  
**Poller:** `services/moneo_poller.py` — `MoneoPoller` called by APScheduler

**Credentials:**
- Bearer token: `config.py` `moneo_api_key` ← `MONEO_API_KEY` env var (**required — no default**)
- Base URL: `config.py` `moneo_api_base_url` ← `MONEO_API_BASE_URL` env var
  - Default: `https://ifm-ro-sales.w-eu.moneo.ifm/api/platform/v1`
- Sent as: `Authorization: Bearer {moneo_api_key}` on every upstream request

**Client methods:**
- `get_devices()` — fetches all topology nodes from `/nodes`; raises on HTTP error
- `get_processdata(device_id, datasource_id, ...)` — fetches process data with retry policy (retries on 429/5xx; no retry on 401/403/404); paginates at caller's request
- `raw_get(path, params)` — proxy a raw GET, raises on HTTP error
- `raw_get_response(path, params)` — proxy a raw GET, returns diagnostics dict (status_code, url, headers, body)
- `verify_auth()` — one-shot probe: GET /nodes?pageSize=1, no retry on 401; returns `{ok, status_code, message}`
- `close()` — closes the underlying httpx client

**Polling schedule** (APScheduler, `services/schedulers/data_polling_scheduler.py`):
- `poll_latest_readings()` — every `SENSOR_POLL_INTERVAL_SECONDS` seconds (default 300); uses watermark from `sensor.last_seen_at`; paginates up to `MONEO_POLL_MAX_PAGES_PER_SENSOR` pages at page_size=500; backfill capped at `MAX_BACKFILL_HOURS`
- `sync_sensor_metadata()` — every 6h; upserts `Asset` + `Sensor` rows from MONEO `/nodes`; persists `moneo_datasource_ref` alongside `moneo_sensor_id`
- `prune_sync_history()` — daily at 03:00; deletes sync_runs + sync_errors older than `SYNC_HISTORY_RETENTION_DAYS` days
- `check_no_data_alerts()` — every 60s; evaluates no-data alert rules
- `dispatch_outbox()` — every 30s; dispatches notification outbox

**Proxy routes** (`/api/moneo/*`) pass raw MONEO responses to the frontend. 502 on upstream failure.

**Note:** The upstream MONEO Bearer token is different from the JWT issued to frontend users.
The MONEO token lives only in the backend environment — it is never sent to the frontend.

## Caching
Redis URL is in config (`REDIS_URL`, default `redis://localhost:6379`) and the `redis>=5.2.0`
package is in requirements. **No Redis client is instantiated in any service today.** Caching
is a planned Iteration 2 improvement (SUPPORT tier in `EXPANSION_PLAN.md`).

## Gotchas

- **`/api/dashboards` vs `/api/dashboards/public`** — both are `GET` on `/api/dashboards*` but one
  requires auth and one doesn't. The public route must be defined before the `/{id}` route in
  FastAPI to avoid path ambiguity (FastAPI matches in declaration order).
- **`POST /api/dashboards/{id}/layout`** returns 204 (no body), not the updated dashboard. The
  frontend relies on its local gridster state, not a refreshed server response.
- **Admin check** is a simple `username != "admin"` string comparison in `moneo_routes.py`, not
  a role field on `User`. There is no `is_admin` column.
- **Default credentials** (`JWT_SECRET_KEY = "changeme"`, `seed_admin_password = "changeme"`)
  must be overridden in `.env` before any non-local deployment.
- **`sensor_readings` grows unbounded for individual sensors** — a unique constraint on
  `(sensor_id, timestamp)` (added in migration 0009) prevents duplicate writes, but there is
  no row-level time-based retention job for old readings.
- **`MONEO_API_KEY` is required at boot** — Pydantic will refuse to start without it. The boot
  log line `MONEO auth OK` / `MONEO auth FAILED (401)` confirms whether the upstream credentials
  are valid.

---

## MONEO Token Rotation

### Background
`MONEO_API_KEY` is a Personal Access Token (PAT) issued by the MONEO platform to a specific user.
There is no refresh-token flow — once a PAT is revoked or expires it returns 401 on every request
until a new one is minted and deployed.

### Three independent tokens — do not conflate

| Token | Where | Lifecycle | Who manages |
|---|---|---|---|
| **MONEO PAT** (this runbook) | `backend/.env` only — never sent to frontend | No automatic expiry; rotate manually or on suspected leak | Backend operator |
| **User JWT** issued by `/api/auth/login` | Frontend `localStorage['auth_token']` | 24h TTL, no refresh; user re-logs in when expired | Frontend (auto-redirect on 401) |
| **Kiosk JWT** | Frontend `sessionStorage`; `kiosk_tokens` DB row carries `expires_at` | Row-level expiry set at issuance | Admin via kiosk management UI |

### When to rotate

- Boot log shows `MONEO auth FAILED (401) — token expired or revoked`.
- `sync_errors` rows accumulate with `kind='http_401'`.
- `/api/admin/sync/health` → `derived_status='failed'` with `last_error_kind='http_401'` on
  `moneo.readings` or `moneo.metadata`.
- Suspected leak: token appeared in a chat message, screenshot, commit, log line, or any
  public-facing surface.
- Quarterly hygiene rotation (recommended cadence even with no signs of compromise).

### How to rotate

1. **Mint a new PAT** in the MONEO web UI: User menu → Personal Access Tokens → Create.
   Copy the token value immediately — it is shown only once.

2. **Edit `backend/.env` locally** — replace the `MONEO_API_KEY` value with the new PAT.
   Do not commit `.env`; it is gitignored.

3. **Restart the backend service.**

4. **Verify** the boot log shows `MONEO auth OK` within a few seconds of startup.

5. **Confirm via health endpoint:**
   ```
   curl -H "Authorization: Bearer <admin-jwt>" \
        http://localhost:8000/api/admin/sync/health
   ```
   `moneo.readings.derived_status` should transition to `'healthy'` within one poll cycle
   (up to `SENSOR_POLL_INTERVAL_SECONDS` seconds).

6. **Revoke the OLD PAT** in the MONEO web UI (User menu → Personal Access Tokens → Revoke).

### Don'ts

- **Do not commit `.env`** — it is gitignored, but double-check with `git status` before
  every commit.
- **Do not paste the token** in chat messages, screenshots, log output, or issue trackers.
- **Do not reuse a PAT across environments** (dev / staging / production should each have
  their own PAT).

### If rotation breaks

Roll back by restoring the previous PAT value in `backend/.env` and restarting. Investigate
the new PAT (correct permissions? copied fully without truncation?) before retrying.
