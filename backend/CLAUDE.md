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

## Folder structure

```
backend/
├── DAL/
│   ├── db_context.py          # Engine, SessionLocal, init_db(), Base
│   └── models/
│       ├── user.py            # User (credentials, is_active)
│       ├── dashboard.py       # Dashboard (owner_id FK, is_public)
│       ├── dashboard_widget.py # DashboardWidget (x/y/cols/rows, settings JSON)
│       ├── sensor.py          # Sensor (moneo_sensor_id unique, unit, asset_id)
│       ├── sensor_reading.py  # SensorReading (sensor_id + timestamp indexes)
│       ├── asset.py           # Asset (moneo_asset_id, location, lat/lng)
│       └── alert_config.py    # AlertConfig (threshold_value, comparison_type)
├── routes/
│   ├── auth_routes.py         # /api/auth/*
│   ├── dashboard_routes.py    # /api/dashboards/*
│   ├── widget_routes.py       # /api/widgets/*
│   ├── sensor_routes.py       # /api/sensors/*
│   ├── analytics_routes.py    # /api/analytics
│   ├── moneo_routes.py        # /api/moneo/* (upstream proxy + admin sync)
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
│   ├── demo_seed_service.py   # Seeds demo sensors/dashboards on first startup
│   └── schedulers/
│       └── data_polling_scheduler.py  # APScheduler job setup
├── middleware.py               # get_current_user() FastAPI dependency (Bearer → User)
├── config.py                   # Pydantic Settings from env vars
└── main.py                     # App factory, lifespan (init_db, seed, scheduler)
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
| `sensors` | `id`, `moneo_sensor_id` (unique), `name`, `unit`, `asset_id` (nullable FK), `is_active`, `metadata` (JSON) | ← readings, ← alert_configs |
| `sensor_readings` | `id`, `sensor_id` (FK), `value`, `timestamp` | → sensor — indexed on `(sensor_id, timestamp)` |
| `assets` | `id`, `moneo_asset_id` (unique), `name`, `location`, `latitude`, `longitude`, `metadata` (JSON) | ← sensors |
| `alert_configs` | `id`, `sensor_id` (FK), `threshold_value`, `comparison_type`, `is_active` | → sensor |

Tables created on startup via `Base.metadata.create_all()` in `DAL/db_context.py`.

## Upstream MONEO API

**Client:** `services/moneo_api_client.py` — `MoneoApiClient` using `httpx.AsyncClient`  
**Poller:** `services/moneo_poller.py` — `MoneoPoller` called by APScheduler

**Credentials:**
- Bearer token: `config.py` `moneo_api_key` ← `MONEO_API_KEY` env var
- Base URL: `config.py` `moneo_api_base_url` ← `MONEO_API_BASE_URL` env var
  - Default: `https://ifm-ro-sales.w-eu.moneo.ifm/api/platform/v1`
- Sent as: `Authorization: Bearer {moneo_api_key}` on every upstream request

**Polling schedule:**
- `poll_latest_readings()` — every 300s (`SENSOR_POLL_INTERVAL_SECONDS`); deduplicates by timestamp
- `sync_sensor_metadata()` — on startup + every 6h; upserts `Asset` + `Sensor` rows from MONEO `/nodes`

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
- **APScheduler start** is currently commented out in `main.py` lifespan. Polling does not run
  automatically in development unless manually uncommented or triggered via `/api/moneo/admin/sync-metadata`.
- **Admin check** is a simple `username != "admin"` string comparison in `moneo_routes.py`, not
  a role field on `User`. There is no `is_admin` column.
- **Default credentials** (`JWT_SECRET_KEY = "changeme"`, `seed_admin_password = "changeme"`)
  must be overridden in `.env` before any non-local deployment.
- **`sensor_readings` grows unbounded** — there is no retention/pruning job yet.
