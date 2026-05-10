# API Documentation

## Base URL

```
Production: https://api.moneo-monitoring.com
Development: http://localhost:8000
```

## Authentication

All requests (except login/register) require JWT bearer token in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Obtain Token

**POST** `/api/auth/login`

Request:
```json
{
  "username": "user@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 86400
}
```

---

## Dashboards API

### List User Dashboards

**GET** `/api/dashboards`

**Query Parameters:**
- None

**Response:**
```json
[
  {
    "id": 1,
    "name": "Main Facility Monitoring",
    "description": "Real-time sensor monitoring",
    "owner_id": 1,
    "is_public": false,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-20T14:22:00Z",
    "widgets": [
      {
        "id": 1,
        "widget_type": "line_chart",
        "title": "Temperature Trend",
        "x": 0,
        "y": 0,
        "cols": 6,
        "rows": 4,
        "settings": {
          "sensor_ids": [1, 2],
          "time_range": "24h"
        }
      }
    ]
  }
]
```

**Status Codes:**
- `200 OK` - Successfully retrieved dashboards
- `401 Unauthorized` - Missing or invalid token
- `400 Bad Request` - Invalid query parameters

---

### Get Single Dashboard

**GET** `/api/dashboards/{dashboard_id}`

**Path Parameters:**
- `dashboard_id` (integer) - Dashboard ID

**Response:** Single dashboard object

**Status Codes:**
- `200 OK`
- `401 Unauthorized`
- `404 Not Found` - Dashboard doesn't exist

---

### Create Dashboard

**POST** `/api/dashboards`

**Request Body:**
```json
{
  "name": "Production Monitoring",
  "description": "Monitor production line sensors",
  "is_public": false
}
```

**Response:**
```json
{
  "id": 2,
  "name": "Production Monitoring",
  "description": "Monitor production line sensors",
  "owner_id": 1,
  "is_public": false,
  "created_at": "2024-01-20T15:00:00Z",
  "updated_at": "2024-01-20T15:00:00Z",
  "widgets": []
}
```

**Validation:**
- `name` - Required, max 255 characters
- `description` - Optional, max 1000 characters
- `is_public` - Required, boolean

**Status Codes:**
- `201 Created`
- `400 Bad Request` - Validation error
- `401 Unauthorized`

---

### Update Dashboard

**PUT** `/api/dashboards/{dashboard_id}`

**Request Body:**
```json
{
  "name": "Updated Name",
  "description": "New description",
  "is_public": true
}
```

All fields are optional. Only provided fields are updated.

**Status Codes:**
- `200 OK`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden` - Not dashboard owner
- `404 Not Found`

---

### Delete Dashboard

**DELETE** `/api/dashboards/{dashboard_id}`

**Status Codes:**
- `204 No Content` - Successfully deleted
- `401 Unauthorized`
- `403 Forbidden` - Not dashboard owner
- `404 Not Found`

---

### List Public Dashboards

**GET** `/api/dashboards/public`

Get all dashboards marked as public. No authentication required.

**Response:** List of public dashboard summaries

---

## Widgets API

### List Dashboard Widgets

**GET** `/api/dashboards/{dashboard_id}/widgets`

**Response:**
```json
[
  {
    "id": 1,
    "widget_type": "line_chart",
    "title": "Temperature Trend",
    "subtitle": "Last 24 hours",
    "x": 0,
    "y": 0,
    "cols": 6,
    "rows": 4,
    "settings": {
      "sensor_ids": [1, 2],
      "time_range": "24h",
      "show_legend": true
    },
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-20T14:22:00Z"
  }
]
```

---

### Create Widget

**POST** `/api/dashboards/{dashboard_id}/widgets`

**Request Body:**
```json
{
  "widget_type": "line_chart",
  "title": "Temperature",
  "subtitle": "Last 7 days",
  "x": 6,
  "y": 0,
  "cols": 6,
  "rows": 4,
  "settings": {
    "sensor_ids": [1, 2],
    "time_range": "7d",
    "show_legend": true,
    "chart_type": "area"
  }
}
```

**Widget Types:**
- `line_chart` - Time-series line/area chart
- `bar_chart` - Bar chart for comparisons
- `gauge` - Circular gauge for current value
- `stat_card` - KPI card (number display)
- `table` - Data table view
- `pie_chart` - Pie/donut chart
- `multi_series` - Multiple sensors on same chart

**Response:** Created widget object

**Status Codes:**
- `201 Created`
- `400 Bad Request`
- `401 Unauthorized`
- `404 Not Found` - Dashboard not found

---

### Update Widget

**PUT** `/api/dashboards/{dashboard_id}/widgets/{widget_id}`

**Request Body:** Same as create (all fields optional)

**Status Codes:**
- `200 OK`
- `400 Bad Request`
- `401 Unauthorized`
- `404 Not Found`

---

### Delete Widget

**DELETE** `/api/dashboards/{dashboard_id}/widgets/{widget_id}`

**Status Codes:**
- `204 No Content`
- `401 Unauthorized`
- `404 Not Found`

---

### Bulk Update Widget Layout

**PUT** `/api/dashboards/{dashboard_id}/widgets/layout`

Update positions and sizes of multiple widgets at once (for drag-and-drop).

**Request Body:**
```json
{
  "items": [
    {
      "id": 1,
      "x": 0,
      "y": 0,
      "cols": 6,
      "rows": 4
    },
    {
      "id": 2,
      "x": 6,
      "y": 0,
      "cols": 6,
      "rows": 4
    }
  ]
}
```

**Response:**
```json
{
  "updated_count": 2,
  "timestamp": "2024-01-20T15:30:00Z"
}
```

**Status Codes:**
- `200 OK`
- `400 Bad Request`
- `401 Unauthorized`

---

## Sensors API

### List All Sensors

**GET** `/api/sensors`

**Query Parameters:**
- `asset_id` (optional, integer) - Filter by asset
- `sensor_type` (optional, string) - Filter by type
- `is_active` (optional, boolean) - Filter by status
- `limit` (optional, integer, default: 100) - Pagination limit
- `offset` (optional, integer, default: 0) - Pagination offset

**Response:**
```json
{
  "total": 245,
  "limit": 100,
  "offset": 0,
  "sensors": [
    {
      "id": 1,
      "moneo_sensor_id": "sensor_abc_123",
      "name": "Temperature Sensor A1",
      "description": "Main facility temperature",
      "sensor_type": "temperature",
      "unit": "°C",
      "min_value": -10,
      "max_value": 60,
      "is_active": true,
      "asset_id": 1,
      "created_at": "2024-01-01T08:00:00Z",
      "updated_at": "2024-01-20T15:00:00Z"
    }
  ]
}
```

**Status Codes:**
- `200 OK`
- `400 Bad Request`

---

### Get Single Sensor

**GET** `/api/sensors/{sensor_id}`

**Response:** Single sensor object

**Status Codes:**
- `200 OK`
- `404 Not Found`

---

### Get Sensor Readings

**GET** `/api/sensors/{sensor_id}/readings`

**Query Parameters:**
- `from_timestamp` (required, ISO 8601) - Start of time range
- `to_timestamp` (required, ISO 8601) - End of time range
- `aggregation` (optional, string) - 'none', 'min', 'max', 'avg', 'hourly', 'daily'
- `limit` (optional, integer, default: 10000) - Max data points

**Response:**
```json
{
  "sensor_id": 1,
  "sensor_name": "Temperature Sensor A1",
  "unit": "°C",
  "min_value": 18.5,
  "max_value": 24.3,
  "avg_value": 21.2,
  "points": [
    {
      "timestamp": "2024-01-20T14:00:00Z",
      "value": 21.5
    },
    {
      "timestamp": "2024-01-20T14:05:00Z",
      "value": 21.6
    }
  ],
  "generated_at": "2024-01-20T15:30:00Z",
  "range_start": "2024-01-20T00:00:00Z",
  "range_end": "2024-01-21T00:00:00Z"
}
```

**Status Codes:**
- `200 OK`
- `400 Bad Request` - Invalid time range
- `404 Not Found` - Sensor not found

---

### Get Aggregated Metrics

**GET** `/api/sensors/{sensor_id}/aggregates`

**Query Parameters:**
- `from_timestamp` (required, ISO 8601)
- `to_timestamp` (required, ISO 8601)
- `bucket_size` (optional, string) - '1h', '1d', '1w', '1m'

**Response:**
```json
{
  "sensor_id": 1,
  "sensor_name": "Temperature Sensor A1",
  "unit": "°C",
  "aggregates": [
    {
      "timestamp": "2024-01-20T00:00:00Z",
      "min": 18.5,
      "max": 24.3,
      "avg": 21.2,
      "count": 288,
      "latest": 21.9
    }
  ]
}
```

**Status Codes:**
- `200 OK`
- `400 Bad Request`
- `404 Not Found`

---

## Analytics API

### Compare Multiple Sensors

**GET** `/api/analytics/comparison`

**Query Parameters:**
- `sensor_ids` (required, comma-separated integers) - Sensor IDs to compare
- `from_timestamp` (required, ISO 8601)
- `to_timestamp` (required, ISO 8601)

**Response:**
```json
{
  "comparison": [
    {
      "sensor_id": 1,
      "sensor_name": "Sensor A",
      "unit": "°C",
      "min": 18.5,
      "max": 24.3,
      "avg": 21.2,
      "latest": 21.9
    },
    {
      "sensor_id": 2,
      "sensor_name": "Sensor B",
      "unit": "°C",
      "min": 19.0,
      "max": 23.8,
      "avg": 21.5,
      "latest": 22.1
    }
  ],
  "generated_at": "2024-01-20T15:30:00Z"
}
```

---

### Get Trends

**GET** `/api/analytics/trends`

**Query Parameters:**
- `sensor_ids` (required, comma-separated)
- `days` (optional, integer, default: 7) - Days of history
- `metric` (optional, string) - 'trend_direction', 'volatility', 'rate_of_change'

**Response:**
```json
{
  "trends": [
    {
      "sensor_id": 1,
      "sensor_name": "Sensor A",
      "trend_direction": "upward",
      "trend_strength": 0.87,
      "volatility": 0.12,
      "rate_of_change": 0.5
    }
  ]
}
```

---

### Detect Anomalies

**GET** `/api/analytics/anomalies`

**Query Parameters:**
- `sensor_ids` (required)
- `from_timestamp` (required)
- `to_timestamp` (required)
- `sensitivity` (optional, float, 0.0-1.0, default: 0.5) - Anomaly detection sensitivity

**Response:**
```json
{
  "anomalies": [
    {
      "sensor_id": 1,
      "timestamp": "2024-01-20T14:30:00Z",
      "value": 45.2,
      "expected_range": [20, 25],
      "severity": "high",
      "reason": "Value exceeds maximum threshold"
    }
  ],
  "total_anomalies": 3
}
```

---

## Assets API

### List Assets

**GET** `/api/assets`

**Query Parameters:**
- `limit` (optional, integer, default: 50)
- `offset` (optional, integer, default: 0)

**Response:**
```json
{
  "total": 10,
  "assets": [
    {
      "id": 1,
      "name": "Main Facility",
      "description": "Production facility",
      "location": "Building A, Floor 3",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "created_at": "2024-01-01T08:00:00Z"
    }
  ]
}
```

---

### Get Asset Sensors

**GET** `/api/assets/{asset_id}/sensors`

**Response:** List of sensors at this asset

---

## Error Responses

All errors follow this format:

```json
{
  "detail": "Error description",
  "error_code": "VALIDATION_ERROR",
  "timestamp": "2024-01-20T15:30:00Z"
}
```

### Common Status Codes

| Code | Meaning |
|------|---------|
| `200` | OK - Request successful |
| `201` | Created - Resource created |
| `204` | No Content - Success, no response body |
| `400` | Bad Request - Invalid parameters |
| `401` | Unauthorized - Authentication required |
| `403` | Forbidden - Insufficient permissions |
| `404` | Not Found - Resource doesn't exist |
| `422` | Unprocessable Entity - Validation failed |
| `429` | Too Many Requests - Rate limit exceeded |
| `500` | Internal Server Error - Server error |

---

## Rate Limiting

- **Default Limit**: 1000 requests per hour per user
- **Response Headers**:
  - `X-RateLimit-Limit`: Total requests allowed
  - `X-RateLimit-Remaining`: Requests remaining
  - `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## Pagination

For endpoints returning lists, use `limit` and `offset`:

```
GET /api/sensors?limit=50&offset=100
```

Returns items 100-149 (50 items, starting from offset 100)

---

## Data Export

### Export Dashboard Data

**GET** `/api/dashboards/{dashboard_id}/export`

**Query Parameters:**
- `format` (optional, string) - 'csv', 'json', 'pdf' (default: 'json')
- `time_range` (optional, string) - '24h', '7d', '30d', '90d'

**Response:** File download

---

## WebSocket Events (Real-Time Updates)

Connect to: `ws://localhost:8000/ws/sensor/{sensor_id}`

### Server → Client Events

```json
{
  "event": "reading_update",
  "data": {
    "sensor_id": 1,
    "value": 21.5,
    "timestamp": "2024-01-20T15:30:00Z",
    "status": "ok"
  }
}
```

---

## Example Workflows

### 1. Create Dashboard with Widget

```bash
# Create dashboard
curl -X POST http://localhost:8000/api/dashboards \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Dashboard",
    "description": "Test dashboard"
  }'

# Response: { "id": 1, ... }

# Add widget to dashboard
curl -X POST http://localhost:8000/api/dashboards/1/widgets \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "widget_type": "line_chart",
    "title": "Temperature",
    "x": 0,
    "y": 0,
    "cols": 6,
    "rows": 4,
    "settings": {
      "sensor_ids": [1],
      "time_range": "24h"
    }
  }'
```

### 2. Fetch Sensor Data

```bash
curl -X GET "http://localhost:8000/api/sensors/1/readings?from_timestamp=2024-01-20T00:00:00Z&to_timestamp=2024-01-21T00:00:00Z" \
  -H "Authorization: Bearer <token>"
```

---

## API Versioning

Current version: **v1**

Future versions will use different URL paths: `/api/v2/...`

