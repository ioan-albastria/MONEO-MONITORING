# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       End Users (Web/Mobile)                     │
├─────────────────────────────────────────────────────────────────┤
│
│  ┌──────────────────────────────────────────────────────────┐
│  │              Frontend Application Layer                   │
│  ├──────────────────────────────────────────────────────────┤
│  │  Angular 17+ Application                                 │
│  │  - Dashboard Components                                  │
│  │  - Widget Grid (angular-gridster2)                       │
│  │  - ApexCharts Visualizations                            │
│  │  - Real-time Updates (optional WebSocket)               │
│  │  - Authentication & Routing                             │
│  │  - State Management (RxJS)                              │
│  └──────────────────────────────────────────────────────────┘
│               ▲                                ▼
│               │         HTTP/WebSocket         │
│               │                                │
│  ┌──────────────────────────────────────────────────────────┐
│  │              API Gateway / Load Balancer                  │
│  │  (Optional: NGINX, HAProxy for production)                │
│  └──────────────────────────────────────────────────────────┘
│               ▼
│  ┌──────────────────────────────────────────────────────────┐
│  │           Backend Application Layer (FastAPI)             │
│  ├──────────────────────────────────────────────────────────┤
│  │
│  │  ┌─────────────────────────────────────────────────────┐
│  │  │  REST API Routes                                   │
│  │  │  - /api/dashboards                                 │
│  │  │  - /api/dashboards/{id}/widgets                    │
│  │  │  - /api/sensors                                    │
│  │  │  - /api/sensors/{id}/readings                      │
│  │  │  - /api/analytics                                  │
│  │  │  - /api/auth                                       │
│  │  │  - /ws/* (WebSocket endpoints)                     │
│  │  └─────────────────────────────────────────────────────┘
│  │
│  │  ┌─────────────────────────────────────────────────────┐
│  │  │  Business Logic Services Layer                     │
│  │  │  ┌─────────────────────────────────────────────┐  │
│  │  │  │ Service Classes                             │  │
│  │  │  │ - DashboardService                         │  │
│  │  │  │ - WidgetService                            │  │
│  │  │  │ - SensorService                            │  │
│  │  │  │ - SensorReadingsService                    │  │
│  │  │  │ - AnalyticsService                         │  │
│  │  │  │ - AuthService                              │  │
│  │  │  │ - AlertingService                          │  │
│  │  │  └─────────────────────────────────────────────┘  │
│  │  │
│  │  │  ┌─────────────────────────────────────────────┐  │
│  │  │  │ MONEO API Integration Layer                │  │
│  │  │  │ - MoneoApiClient (HTTP)                   │  │
│  │  │  │ - Request/Response Handling               │  │
│  │  │  │ - Error Recovery                          │  │
│  │  │  │ - Rate Limiting                           │  │
│  │  │  └─────────────────────────────────────────────┘  │
│  │  │
│  │  │  ┌─────────────────────────────────────────────┐  │
│  │  │  │ Schedulers & Background Jobs               │  │
│  │  │  │ - MoneoPollingScheduler (fetch data)      │  │
│  │  │  │ - AggregationScheduler (pre-calc metrics) │  │
│  │  │  │ - CacheWarmupScheduler                    │  │
│  │  │  │ - AlertingScheduler                       │  │
│  │  │  └─────────────────────────────────────────────┘  │
│  │  │
│  │  │  ┌─────────────────────────────────────────────┐  │
│  │  │  │ Middleware & Authentication                │  │
│  │  │  │ - JWT Token Validation                     │  │
│  │  │  │ - CORS Policy                              │  │
│  │  │  │ - Request Logging                          │  │
│  │  │  │ - Error Handling                           │  │
│  │  │  └─────────────────────────────────────────────┘  │
│  │  └─────────────────────────────────────────────────────┘
│  │
│  └──────────────────────────────────────────────────────────┘
│               ▼
│  ┌──────────────────────────────────────────────────────────┐
│  │        Data Access Layer (SQLAlchemy ORM)                 │
│  ├──────────────────────────────────────────────────────────┤
│  │  - Models Mapping (DB ↔ Python Objects)                  │
│  │  - Query Building & Execution                            │
│  │  - Session Management                                    │
│  │  - Relationship Handling                                 │
│  │  - Transaction Management                                │
│  └──────────────────────────────────────────────────────────┘
│               ▼
└─────────────────────────────────────────────────────────────────┘

            ┌─────────────────────────────────────────┐
            │      Data Storage & Caching             │
            ├─────────────────────────────────────────┤
            │  ┌────────────────────────────────────┐ │
            │  │  PostgreSQL Database               │ │
            │  │  - Users & Authentication          │ │
            │  │  - Dashboards & Widgets            │ │
            │  │  - Sensors & Assets                │ │
            │  │  - Sensor Readings (Time-Series)   │ │
            │  │  - Alerts & Notifications          │ │
            │  │  - Aggregated Metrics              │ │
            │  └────────────────────────────────────┘ │
            │  ┌────────────────────────────────────┐ │
            │  │  Redis Cache (Optional)            │ │
            │  │  - Session Tokens                  │ │
            │  │  - Recent Sensor Readings          │ │
            │  │  - Aggregated Metrics Cache        │ │
            │  │  - Widget Configuration Cache      │ │
            │  └────────────────────────────────────┘ │
            └─────────────────────────────────────────┘
                        ▲
                        │
            ┌───────────────────────────┐
            │  External Data Sources    │
            ├───────────────────────────┤
            │  IFM MONEO API            │
            │  (Sensor Data Feed)       │
            └───────────────────────────┘
```

---

## Component Architecture

### Frontend (Angular)

```
Application Bootstrap (main.ts)
    ▼
┌─────────────────────────────────┐
│  App Root Component             │
│  ├─ Navigation                  │
│  └─ Main Router Outlet          │
└─────────────────────────────────┘
         ▼
┌─────────────────────────────────┐
│  Feature Modules                │
├─────────────────────────────────┤
│  Dashboard Module               │
│  ├─ DashboardComponent          │
│  ├─ DashboardListComponent      │
│  ├─ DashboardGridComponent      │
│  │  └─ GridsterContainer        │
│  ├─ DashboardWidgetComponent    │
│  │  ├─ LineChartWidget          │
│  │  ├─ BarChartWidget           │
│  │  ├─ GaugeWidget              │
│  │  ├─ StatCardWidget           │
│  │  └─ TableWidget              │
│  └─ WidgetConfigComponent       │
│
│  Sensor Module                  │
│  ├─ SensorListComponent         │
│  └─ SensorDetailsComponent      │
└─────────────────────────────────┘
         ▼
┌─────────────────────────────────┐
│  Core Services (Singleton)      │
├─────────────────────────────────┤
│  - AuthService                  │
│  - StateService                 │
│  - HttpInterceptor              │
└─────────────────────────────────┘
         ▼
┌─────────────────────────────────┐
│  API Services                   │
├─────────────────────────────────┤
│  - DashboardApiService          │
│  - SensorApiService             │
│  - AnalyticsApiService          │
│  - AuthApiService               │
└─────────────────────────────────┘
         ▼
┌─────────────────────────────────┐
│  HTTP Client (HttpClientModule) │
└─────────────────────────────────┘
```

### Backend (FastAPI)

```
main.py (Application Entry Point)
    ▼
┌────────────────────────────────────┐
│  FastAPI Application Setup         │
│  ├─ Middleware Setup               │
│  ├─ CORS Configuration             │
│  ├─ Exception Handlers             │
│  ├─ Dependency Injection           │
│  └─ Router Registration            │
└────────────────────────────────────┘
    ▼
┌────────────────────────────────────┐
│  Route Layers                      │
├────────────────────────────────────┤
│  auth_routes.py
│    POST /login
│    POST /register
│    POST /refresh
│
│  dashboard_routes.py
│    GET /dashboards
│    POST /dashboards
│    PUT /dashboards/{id}
│    DELETE /dashboards/{id}
│
│  widget_routes.py
│    GET /dashboards/{id}/widgets
│    POST /dashboards/{id}/widgets
│    PUT /dashboards/{id}/widgets/{id}
│    DELETE /dashboards/{id}/widgets/{id}
│    PUT /dashboards/{id}/widgets/layout
│
│  sensor_routes.py
│    GET /sensors
│    GET /sensors/{id}
│    GET /sensors/{id}/readings
│    GET /sensors/{id}/aggregates
│
│  analytics_routes.py
│    GET /analytics/comparison
│    GET /analytics/trends
│    GET /analytics/anomalies
│
│  asset_routes.py
│    GET /assets
│    GET /assets/{id}/sensors
│
│  websocket_routes.py
│    WS /ws/sensor/{sensor_id}
│
└────────────────────────────────────┘
    ▼
┌────────────────────────────────────┐
│  Service Layer                     │
├────────────────────────────────────┤
│  services/
│  ├─ auth_service.py
│  ├─ dashboard_service.py
│  ├─ widget_service.py
│  ├─ sensor_service.py
│  ├─ sensor_readings_service.py
│  ├─ analytics_service.py
│  ├─ moneo_api_client.py
│  ├─ moneo_poller.py
│  ├─ alert_service.py
│  └─ schedulers/
│     ├─ data_polling_scheduler.py
│     ├─ aggregation_scheduler.py
│     └─ cache_warmup_scheduler.py
│
└────────────────────────────────────┘
    ▼
┌────────────────────────────────────┐
│  Data Access Layer (DAL)           │
├────────────────────────────────────┤
│  DAL/
│  ├─ db_context.py (Session mgmt)
│  └─ models/
│     ├─ user.py
│     ├─ dashboard.py
│     ├─ dashboard_widget.py
│     ├─ sensor.py
│     ├─ sensor_reading.py
│     ├─ asset.py
│     └─ alert_config.py
│
│  Database (PostgreSQL)
│
└────────────────────────────────────┘
```

---

## Data Flow Diagrams

### 1. Dashboard Creation & Widget Setup

```
User (Frontend)
    │
    ├─ Click "Create Dashboard"
    │
    ▼
DashboardComponent (Frontend)
    │
    ├─ Show create dialog
    ├─ Collect form data (name, description)
    │
    ▼
DashboardApiService
    │
    ├─ HTTP POST /api/dashboards
    │
    ▼
dashboard_routes.py (Backend)
    │
    ├─ Validate request (Pydantic)
    ├─ Extract JWT user
    │
    ▼
DashboardService
    │
    ├─ Create Dashboard object
    ├─ Set owner_id from JWT
    ├─ Persist to DB
    │
    ▼
PostgreSQL
    │
    ├─ INSERT INTO dashboards
    ├─ COMMIT
    │
    ▼
Response: DashboardRead
    │
    ├─ Back through service → route → API service
    ├─ Update UI with dashboard ID
    │
    ▼
User adds widget via UI
    │
    ├─ Select widget type, sensors
    ├─ Configure settings
    ├─ Position on grid
    │
    ▼
WidgetConfigComponent
    │
    ├─ HTTP POST /api/dashboards/{id}/widgets
    │
    ▼
dashboard_routes.py
    │
    ├─ Create DashboardWidget with settings
    │
    ▼
DashboardWidget persisted
    │
    ├─ Response includes widget config
    │
    ▼
DashboardGridComponent
    │
    ├─ Add widget to grid
    ├─ Render ApexChart with sensor data
```

### 2. Sensor Data Flow

```
IFM MONEO API
    │
    ├─ Continuously publishes sensor readings
    │
    ▼
MoneoPollingScheduler (Background Job)
    │
    ├─ Runs every 5 minutes (configurable)
    ├─ Calls MoneoApiClient
    │
    ▼
MoneoApiClient
    │
    ├─ GET /v1/devices/{device_id}/sensors
    ├─ GET /v1/sensors/{sensor_id}/latest
    ├─ Handle auth & retries
    │
    ▼
PostgreSQL
    │
    ├─ INSERT INTO sensor_readings
    ├─ INSERT INTO sensors (metadata sync)
    │
    ▼
Cache (Redis)
    │
    ├─ Update recent readings cache
    ├─ TTL: 5 minutes
    │
    ▼
Frontend Dashboard
    │
    ├─ On-demand: HTTP GET /api/sensors/{id}/readings
    │    (with time range: last 24h, 7d, 30d, etc.)
    │
    ▼
SensorReadingsService
    │
    ├─ Query PostgreSQL
    ├─ Check Redis cache first
    ├─ Apply aggregation if requested
    ├─ Format for ApexCharts
    │
    ▼
SensorTimeSeriesData (Response Model)
    │
    ├─ Points: [{timestamp, value}, ...]
    ├─ Stats: min, max, avg
    │
    ▼
Frontend ApexChart
    │
    ├─ Render line/area/bar chart
    ├─ Display trend with min/max/avg
    │
    ▼
User views real-time dashboard
```

### 3. Real-Time Update Flow (WebSocket Optional)

```
Frontend Dashboard
    │
    ├─ User opens dashboard
    ├─ Connects to: ws://server/ws/sensor/{sensor_id}
    │
    ▼
Backend WebSocket Handler
    │
    ├─ Accept connection
    ├─ Validate JWT token
    ├─ Store client connection
    │
    ▼
MoneoPollingScheduler
    │
    ├─ Polls new sensor reading
    ├─ Persists to database
    │
    ▼
Event Broadcasting
    │
    ├─ Broadcast to all connected WebSocket clients
    │  JSON: {event: "reading_update", data: {...}}
    │
    ▼
Frontend WebSocket Client
    │
    ├─ Receive message
    ├─ Update RxJS Subject
    │
    ▼
ApexChart Component
    │
    ├─ Subscribe to data stream
    ├─ Update chart with new data point
    ├─ Animations play
    │
    ▼
User sees real-time update (< 1 second latency)
```

### 4. Widget Layout Update Flow (Drag & Drop)

```
User drags widget on grid
    │
    ▼
DashboardGridComponent
    │
    ├─ GridsterItem.itemChange event
    ├─ Extract new position: {id, x, y, cols, rows}
    │
    ▼
WidgetApiService
    │
    ├─ HTTP PUT /api/dashboards/{id}/widgets/layout
    ├─ Send all item positions as batch
    │
    ▼
dashboard_routes.py
    │
    ├─ Validate layout (no overlaps if required)
    │
    ▼
Database
    │
    ├─ UPDATE dashboard_widgets
    │    SET x=?, y=?, cols=?, rows=?
    │    WHERE id=?
    ├─ COMMIT (transaction)
    │
    ▼
Response: {updated_count: N}
    │
    ├─ Front-end receives success
    ├─ Layout persisted
    │
    ▼
User continues using dashboard
```

---

## Request/Response Flow

### Authentication Flow

```
1. User enters credentials
2. POST /api/auth/login
3. Backend validates password
4. JWT token generated
5. Token returned to client
6. Client stores in localStorage
7. All subsequent requests include: Authorization: Bearer <token>
8. Backend validates token on every request
9. Request rejected if token invalid/expired
```

### Typical API Request

```
Frontend:
GET /api/dashboards?limit=10
Header: Authorization: Bearer <token>

Backend:
1. middleware: Validate JWT
2. dependency injection: get_db()
3. route: Extract parameters
4. service: Query database
5. database: Execute SQL
6. response model: Serialize objects
7. return JSON response

Frontend:
Response: 200 OK
Body: [{id: 1, name: "...", ...}]
Update component state
```

---

## Scalability Considerations

### Current Architecture (Single Server)

- ✅ Suitable for 1-100 concurrent users
- ✅ 1 database server
- ✅ 1 API server
- ✅ Optional Redis for caching
- ✅ Background schedulers on same server

### Scaling to Multiple Servers

```
Load Balancer (NGINX / HAProxy)
    │
    ├─ Round-robin distribution
    │
    ├─ API Server 1
    ├─ API Server 2
    ├─ API Server 3
    │
Database Pool
    │
    ├─ PostgreSQL Primary
    ├─ PostgreSQL Replicas (read-only)
    │
Redis Cluster
    │
    ├─ Shared cache layer
    │
Schedulers (Dedicated Server)
    │
    ├─ MoneoPollingScheduler (single instance)
    ├─ AggregationScheduler
```

### Performance Optimizations

1. **Database**: Connection pooling, query optimization, indexes
2. **Caching**: Redis for frequent reads
3. **API**: Pagination, filtering, compression
4. **Frontend**: Lazy loading, change detection, virtual scrolling
5. **Async Processing**: Background jobs don't block API

---

## Security Architecture

```
┌────────────────────────────────┐
│  HTTPS/TLS Layer               │
│  (SSL certificate)             │
└────────────────────────────────┘
         ▼
┌────────────────────────────────┐
│  CORS Policy                   │
│  (Whitelist allowed origins)   │
└────────────────────────────────┘
         ▼
┌────────────────────────────────┐
│  JWT Authentication            │
│  (Bearer token validation)     │
└────────────────────────────────┘
         ▼
┌────────────────────────────────┐
│  Authorization (RBAC)          │
│  (User owns dashboard?)        │
└────────────────────────────────┘
         ▼
┌────────────────────────────────┐
│  Database Layer                │
│  (SQL injection prevention)    │
│  (ORM parameterized queries)   │
└────────────────────────────────┘
```

---

## Deployment Architecture

### Development
- Single machine
- SQLite or local PostgreSQL
- Frontend dev server (ng serve)
- Backend dev server (uvicorn --reload)

### Staging
- Docker containers
- PostgreSQL instance
- Redis instance
- Docker Compose orchestration

### Production
- Kubernetes cluster (recommended)
  - API deployment (replicas)
  - Database StatefulSet
  - Redis StatefulSet
  - Scheduler job
- Docker registry
- Persistent volumes
- Monitoring & logging
- Backup strategy

