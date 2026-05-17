# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       End Users (Browser)                        │
├─────────────────────────────────────────────────────────────────┤
│
│  ┌──────────────────────────────────────────────────────────┐
│  │              Frontend Application Layer                   │
│  ├──────────────────────────────────────────────────────────┤
│  │  Angular 20 SPA (NgModules)                              │
│  │  - Dashboard + Widget grid (angular-gridster2)           │
│  │  - ApexCharts visualisations; CSS conic-gradient gauge   │
│  │  - Sync-status surface (indicator, panel, banner)        │
│  │  - Real-time updates (rxjs WebSocket per sensor)         │
│  │  - JWT auth (localStorage) + class-based interceptor     │
│  │  - Dark/light theme + density toggle                     │
│  └──────────────────────────────────────────────────────────┘
│               ▲                                ▼
│               │      HTTP (REST) / WebSocket   │
│               │                                │
│  ┌──────────────────────────────────────────────────────────┐
│  │           Backend Application Layer (FastAPI)             │
│  ├──────────────────────────────────────────────────────────┤
│  │
│  │  ┌─────────────────────────────────────────────────────┐
│  │  │  REST / WebSocket Route Handlers                   │
│  │  │  - /api/auth/*                                     │
│  │  │  - /api/dashboards/*  /api/widgets/*               │
│  │  │  - /api/sensors/*     /api/analytics               │
│  │  │  - /api/moneo/*  (MONEO proxy + admin sync-meta)   │
│  │  │  - /api/admin/sync/health  (sync observability)    │
│  │  │  - /ws/sensors/{id}  (WebSocket)                   │
│  │  └─────────────────────────────────────────────────────┘
│  │
│  │  ┌─────────────────────────────────────────────────────┐
│  │  │  Business Logic Services                           │
│  │  │  - AuthService, DashboardService, WidgetService    │
│  │  │  - SensorService, SensorReadingsService            │
│  │  │  - AnalyticsService, AlertService                  │
│  │  │  - MoneoApiClient  (httpx, retry, auth probe)      │
│  │  │  - MoneoPoller     (watermark-driven pagination)   │
│  │  │  - SyncHealthService  (lifecycle tracker + health) │
│  │  └─────────────────────────────────────────────────────┘
│  │
│  │  ┌─────────────────────────────────────────────────────┐
│  │  │  APScheduler Background Jobs                       │
│  │  │  - poll_latest_readings  every SENSOR_POLL_INTERVAL │
│  │  │  - sync_sensor_metadata  every 6 h                  │
│  │  │  - prune_sync_history    daily at 03:00             │
│  │  │  - check_no_data_alerts  every 60 s                 │
│  │  │  - dispatch_outbox       every 30 s                 │
│  │  └─────────────────────────────────────────────────────┘
│  │
│  │  ┌─────────────────────────────────────────────────────┐
│  │  │  Middleware / Auth                                 │
│  │  │  - JWT Bearer validation (get_current_user dep)    │
│  │  │  - CORS policy                                     │
│  │  │  - Alembic auto-migrate on startup                 │
│  │  └─────────────────────────────────────────────────────┘
│  │
│  └──────────────────────────────────────────────────────────┘
│               ▼
│  ┌──────────────────────────────────────────────────────────┐
│  │        Data Access Layer (SQLAlchemy 2.0)                 │
│  ├──────────────────────────────────────────────────────────┤
│  │  Models: User, Dashboard, DashboardWidget, Asset,        │
│  │          Sensor, SensorReading, AlertConfig,             │
│  │          KioskToken, SyncRun, SyncError                  │
│  │  Session management via SessionLocal factory             │
│  └──────────────────────────────────────────────────────────┘
│               ▼
└─────────────────────────────────────────────────────────────────┘

            ┌─────────────────────────────────────────┐
            │      Data Storage & Caching             │
            ├─────────────────────────────────────────┤
            │  PostgreSQL                             │
            │  - Users, dashboards, widgets           │
            │  - Sensors, assets, readings            │
            │  - Alert configs                        │
            │  - Kiosk tokens                         │
            │  - sync_runs / sync_errors (Slice 3+)   │
            │                                         │
            │  Redis (configured, not yet active)     │
            │  - Planned for caching (Iteration 2)    │
            └─────────────────────────────────────────┘
                        ▲
                        │
            ┌───────────────────────────────────────┐
            │  IFM MONEO Platform API               │
            │  /api/platform/v1                     │
            │  - GET /nodes  (topology)             │
            │  - GET /processdata/device/{id}/       │
            │    datasource/{datasourceId}           │
            │    (time-series readings)              │
            └───────────────────────────────────────┘
```

---

## Frontend Component Map

```
app.ts (root)
    ▼
AppModule
├─ AuthModule (lazy)
│   └─ LoginComponent
└─ DashboardModule (lazy)
    ├─ DashboardComponent          # grid host, CRUD, modal
    │   └─ DashboardWidgetComponent  # renders one widget
    │       └─ AppWidgetsShellComponent  # chrome wrapper
    │           ├─ LineChart / BarChart (ApexCharts)
    │           ├─ Gauge (CSS conic-gradient)
    │           └─ StatCard (sparkline + delta)
    └─ layout/
        ├─ AppShellComponent       # outer shell, hosts banner
        ├─ AppNavRailComponent     # left nav rail
        └─ AppPageHeaderComponent  # top bar, hosts indicator
```

**Shared components (shared.module.ts):**
- `SyncStatusIndicatorComponent` — pill in the header; click opens panel
- `SyncStatusPanelComponent` — per-source detail rows, lag, errors, refresh
- `SyncStatusBannerComponent` — red banner for `overall=failed`

**Core services:**
- `AuthService` + `AuthInterceptorService` — JWT storage, Bearer attachment, 401 redirect
- `RealtimeService` — rxjs WebSocket, per-sensor subscriptions, exponential backoff reconnect
- `SensorApiService` — REST: readings, analytics, latest
- `SyncHealthService` — polls `GET /api/admin/sync/health` every 30 s; 403→null; visibility-paused
- `UiPreferencesService` — theme + density toggle (localStorage)

---

## Backend File Map

```
backend/
├── main.py                       # lifespan: migrate → seed → scheduler → MONEO auth probe
├── config.py                     # Pydantic Settings (MONEO_API_KEY required, no default)
├── middleware.py                  # get_current_user() FastAPI dependency
├── DAL/
│   ├── db_context.py             # Engine, SessionLocal, Base
│   └── models/
│       ├── user.py               # User
│       ├── dashboard.py          # Dashboard
│       ├── dashboard_widget.py   # DashboardWidget
│       ├── sensor.py             # Sensor (+moneo_datasource_ref, last_seen_at, range cols)
│       ├── sensor_reading.py     # SensorReading (UNIQUE sensor_id+timestamp)
│       ├── asset.py              # Asset
│       ├── alert_config.py       # AlertConfig
│       ├── sync_run.py           # SyncRun (source, status, records_in/written, error_count)
│       └── sync_error.py         # SyncError (run_id FK, kind, message, sensor_id FK)
├── routes/
│   ├── auth_routes.py            # /api/auth/*
│   ├── dashboard_routes.py       # /api/dashboards/*
│   ├── widget_routes.py          # /api/widgets/*
│   ├── sensor_routes.py          # /api/sensors/*
│   ├── analytics_routes.py       # /api/analytics
│   ├── moneo_routes.py           # /api/moneo/* (proxy + admin sync-metadata)
│   ├── admin_sync_routes.py      # /api/admin/sync/health
│   ├── websocket_routes.py       # /ws/sensors/{id}
│   └── response_models/          # Pydantic response schemas
├── services/
│   ├── auth_service.py
│   ├── sensor_service.py
│   ├── sensor_readings_service.py
│   ├── dashboard_service.py
│   ├── analytics_service.py
│   ├── moneo_api_client.py       # httpx, retry policy, verify_auth() probe
│   ├── moneo_poller.py           # watermark polling + bulk upsert
│   ├── sync_health_service.py    # run() context-mgr, record_error(), get_health(), prune()
│   ├── demo_seed_service.py
│   └── schedulers/
│       └── data_polling_scheduler.py  # APScheduler job registration
└── migrations/
    └── versions/
        ├── 0001_initial_schema.py
        ├── …
        └── 0010_sync_runs.py
```

---

## Data Flow: Sensor Readings Ingestion

```
APScheduler (every SENSOR_POLL_INTERVAL_SECONDS)
    ▼
MoneoPoller.poll_latest_readings()
    │
    ├─ SyncHealthService.run("moneo.readings")  ← starts SyncRun row
    │
    ├─ For each active sensor:
    │   ├─ Compute from_ms = max(last_seen_at+1ms, now - MAX_BACKFILL_HOURS)
    │   ├─ MoneoApiClient.get_processdata(device_id, datasource_ref, from_ms, to_ms, page=1…N)
    │   │   └─ Retries on 429/5xx; no retry on 401/403/404
    │   ├─ Bulk INSERT … ON CONFLICT DO NOTHING (dialect-branched for PostgreSQL/SQLite)
    │   ├─ Update sensor.last_seen_at = max timestamp written
    │   └─ SyncHealthService.record_error(...) on any failure
    │
    └─ SyncHealthService exits context-mgr → finalises SyncRun (status, records, duration)
```

**Key identifiers:**
- `moneo_sensor_id` — topology node `id` from `/nodes`; used to identify sensors in our DB
- `moneo_datasource_ref` — inner `reference.dataSource.id` (128-char hex) from `/nodes`; required
  by `/processdata/device/{deviceId}/datasource/{datasourceRef}` to actually get readings

---

## Data Flow: Sync Health Surface

```
Frontend SyncHealthService (every 30 s, visibility-paused)
    │
    ├─ GET /api/admin/sync/health  (Bearer + admin)
    │   └─ 403 → emit null (hide surface for non-admins)
    │
    ▼
SyncStatusIndicatorComponent (in AppPageHeaderComponent)
    ├─ overall=healthy → green pill "Sync OK"
    ├─ overall=degraded → amber pill "Sync degraded"
    ├─ overall=failed → red pill "Sync failed" + triggers banner
    └─ overall=pending → gray pill "Awaiting first sync"
    └─ click → opens SyncStatusPanelComponent (popover)

SyncStatusBannerComponent (in AppShellComponent, below header)
    └─ only visible when overall=failed (not pending, not degraded)
```

---

## Scalability Considerations

### Current Architecture (Single Server)
- Suitable for the facility-level operator use-case (~10–50 concurrent users)
- APScheduler runs inside the same process — single instance required
- Redis is configured but not yet active (planned for Iteration 2 caching)

### Horizontal Scaling Notes
- APScheduler must run on exactly **one** instance (no distributed locking today).
  Deploy the background scheduler as a separate process/container, separate from the
  stateless API replicas, before adding API replicas.
- `sync_runs` / `sync_errors` provide durable state even if the scheduler process restarts
  mid-run; the poller is watermark-driven (resumes from `sensor.last_seen_at`).

---

## Security Architecture

```
HTTPS/TLS (production; NGINX/HAProxy in front)
    ▼
CORS whitelist (ALLOWED_ORIGINS in config.py)
    ▼
JWT Bearer validation on every protected request
    ▼
Admin check (username == "admin") for admin-only endpoints
    ▼
SQLAlchemy ORM (parameterised queries — no SQL injection risk)
```

**Token separation:**
| Token | Location | Lifetime |
|---|---|---|
| MONEO PAT | `backend/.env` only (never sent to frontend) | Manual; rotate on leak or quarterly |
| User JWT | `localStorage['auth_token']` | 24 h; no refresh |
| Kiosk JWT | `sessionStorage`; DB row `kiosk_tokens.expires_at` | Set at issuance |

---

## Deployment Topologies

### Development
```
pg (local)     redis (local, optional)
      ▼
uvicorn main:app --reload --port 8000    ←→    ng serve (port 4200)
```

### Docker Compose (staging / demo)
```
docker-compose.yml:
  postgres     redis     backend     frontend(nginx)
```

### Production (Kubernetes)
```
Ingress (HTTPS)
    ├─ frontend  Deployment (nginx, replicas)
    └─ backend   Deployment (uvicorn, replicas — stateless API only)
         + backend-scheduler  Deployment (1 replica — APScheduler)
    └─ postgres  StatefulSet
    └─ redis     StatefulSet (when caching is enabled)
```
