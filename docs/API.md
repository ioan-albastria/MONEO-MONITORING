# API Documentation

## Base URL

```
Development: http://localhost:8000
```

## Authentication

All protected endpoints require a JWT Bearer token obtained from `/api/auth/login`.

```
Authorization: Bearer <access_token>
```

**Admin endpoints** additionally require `username == "admin"` (string check, not a role column).

---

## Auth

### POST `/api/auth/login`
Obtain a JWT token.

**Request:**
```json
{ "username": "admin", "password": "changeme" }
```

**Response:**
```json
{ "access_token": "eyJ...", "token_type": "bearer" }
```

Token lifetime: `JWT_ACCESS_TOKEN_EXPIRE_HOURS` (default 24 h). No refresh endpoint.

---

### GET `/api/auth/me`
Return the authenticated user's profile. **Bearer required.**

**Response:** `{ "id": 1, "username": "admin", "email": "admin@example.com", "is_active": true }`

---

## Dashboards

### GET `/api/dashboards`
List the authenticated user's dashboards. **Bearer required.**

**Response:** `list[DashboardRead]` — each item includes `widgets: list[DashboardWidgetRead]`.

---

### GET `/api/dashboards/public`
List all public dashboards. No auth required.

---

### GET `/api/dashboards/{id}`
Single dashboard. **Bearer required.**

---

### POST `/api/dashboards`
Create a dashboard. **Bearer required.**

**Request:**
```json
{ "name": "My Dashboard", "description": "...", "is_public": false }
```

**Response:** `DashboardRead` (201 Created)

---

### PUT `/api/dashboards/{id}`
Update name / description / is_public. **Bearer required.** Owner only.

---

### DELETE `/api/dashboards/{id}`
Delete dashboard and its widgets (cascade). **Bearer required.** Owner only. Returns 204.

---

### POST `/api/dashboards/{id}/widgets`
Add a widget to a dashboard. **Bearer required.**

**Request:**
```json
{
  "widget_type": "line_chart",
  "title": "Temperature",
  "subtitle": "Last 24 h",
  "x": 0, "y": 0, "cols": 12, "rows": 5,
  "settings": {
    "sensor_ids": [1, 2],
    "time_range_hours": 24,
    "aggregated": true,
    "bucket_minutes": 60,
    "show_legend": true
  }
}
```

**Widget types:** `line_chart`, `bar_chart`, `gauge`, `stat_card`

**Response:** `DashboardWidgetRead` (201 Created)

---

### POST `/api/dashboards/{id}/layout`
Persist grid positions after a drag/resize. **Bearer required.** Returns 204.

**Request:** `[{ "id": 1, "x": 0, "y": 0, "cols": 12, "rows": 5 }, ...]`

---

## Widgets

### PUT `/api/widgets/{id}`
Update a widget's properties (type, title, settings, position). **Bearer required.**

### DELETE `/api/widgets/{id}`
Delete a widget. **Bearer required.** Returns 204.

---

## Sensors

### GET `/api/sensors`
List all sensors. **Bearer required.**

**Query params:** `active_only` (bool, default false)

**Response:** `list[SensorRead]`

---

### GET `/api/sensors/{id}`
Single sensor. **Bearer required.**

---

### GET `/api/sensors/{id}/readings`
Time-series readings. **Bearer required.**

**Query params:** `from` (ISO 8601), `to` (ISO 8601), defaults to last 24 h.

**Response:** `SensorTimeSeriesData { sensor_id, sensor_name, unit, points: [{timestamp, value}] }`

---

### GET `/api/sensors/{id}/latest`
Most recent reading. **Bearer required.**

**Response:** `{ value, timestamp, status }`

---

### PATCH `/api/sensors/{id}/active`
Enable or disable a sensor. **Bearer required.**

**Request:** `{ "is_active": true }`

---

## Analytics

### GET `/api/analytics`
Multi-sensor aggregated analytics. **Bearer required.**

**Query params:**
- `sensor_id` (repeatable integer) — e.g. `?sensor_id=1&sensor_id=2`
- `from` (ISO 8601)
- `to` (ISO 8601)
- `aggregated` (bool, default true)
- `bucket_minutes` (int, default 60)

**Response:** `AnalyticsResponse`

---

## MONEO Proxy

These routes forward requests to the upstream IFM MONEO API and require **Bearer token**.
The `admin/sync-metadata` route additionally requires the admin user.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/moneo/devices` | List MONEO topology nodes |
| GET | `/api/moneo/devices/{id}/sensors` | Sensors/datasources under a node |
| GET | `/api/moneo/sensors/{id}/latest` | Raw latest reading for a MONEO datasource |
| GET | `/api/moneo/sensors/{id}/readings` | Raw historical readings for a MONEO datasource |
| GET | `/api/moneo/raw/{path:path}` | Generic MONEO proxy — any path |
| POST | `/api/moneo/admin/sync-metadata` | **Admin only** — trigger an immediate metadata sync |

All proxy routes return 502 if the upstream MONEO API is unreachable.

---

## Admin — Sync Health

### GET `/api/admin/sync/health`
Returns the current sync health for both data sources. **Bearer + admin required.**

**Response shape (FROZEN — do not add fields):**
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

**`derived_status` values:** `"healthy"` | `"degraded"` | `"failed"`

**Derivation rules:**
- `"healthy"` — last run succeeded and `lag_seconds < 2 × SENSOR_POLL_INTERVAL_SECONDS`
- `"degraded"` — last run succeeded but lag is high, OR `consecutive_failures > 0` but < threshold
- `"failed"` — last run failed or consecutive failures exceed threshold

**`moneo.metadata` showing `derived_status: "failed"` on a fresh DB is normal** — metadata
sync has never run. The frontend treats `failed + last_success_at=null` as "awaiting first sync"
(not a true failure).

---

## WebSocket

### `ws://localhost:8000/ws/sensors/{sensor_id}`
Live reading stream for a single sensor. **Auth via `?token=<jwt>` query param.**

The backend validates the token before calling `websocket.accept()` — closes with code 1008 on
missing / invalid token.

**Push message shape:**
```json
{ "sensor_id": 1, "value": 21.5, "timestamp": "2026-05-17T13:30:00+00:00", "status": "ok" }
```

Readings are pushed as they arrive from the MONEO poller (approximately every `SENSOR_POLL_INTERVAL_SECONDS`).

---

## Common Error Codes

| Status | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 204 | No Content (DELETE, layout save) |
| 400 | Bad Request — invalid parameters |
| 401 | Unauthorized — missing / expired token |
| 403 | Forbidden — not the resource owner, or not admin |
| 404 | Not Found |
| 422 | Unprocessable Entity — Pydantic validation failed |
| 502 | Bad Gateway — upstream MONEO API unreachable |

---

## Example: Check Sync Health

```bash
# 1. Obtain token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme"}' | jq -r .access_token)

# 2. Query health
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/admin/sync/health | jq .
```
