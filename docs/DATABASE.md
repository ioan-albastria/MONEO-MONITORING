# Database Schema

Schema is managed by **Alembic** migrations under `backend/migrations/versions/`.
On startup, `main.py` runs `alembic upgrade head` when `settings.auto_migrate=True`.

## Migration chain (head = 0010)

| File | Purpose |
|---|---|
| `0001_initial_schema.py` | No-op baseline — tables pre-existed |
| `0002_sensor_extensions.py` | Adds 9 sensor columns (freshness + range bounds) |
| `0003_alert_schema_and_user_role.py` | Alert schema + user role column |
| `0004_alert_full_schema.py` | Replaces alert tables with full schema |
| `0005_annotations.py` | Adds annotation table |
| `0006_dashboard_time_range.py` | Adds time-range picker columns to dashboards |
| `0007_asset_hierarchy.py` | Asset hierarchy: parent_id, kind, path |
| `0008_kiosk_tokens.py` | kiosk_tokens table |
| `0009_processdata_compatibility.py` | `moneo_datasource_ref` column + unique constraint on `(sensor_id, timestamp)` |
| `0010_sync_runs.py` | `sync_runs` and `sync_errors` observability tables |

---

## Entity Relationship Diagram

```
┌─────────────┐
│    Users    │
├─────────────┤
│ id (PK)     │
│ username    │
│ email       │
│ password    │
│ is_active   │
│ created_at  │
└──────┬──────┘
       │1:N
       ▼
┌─────────────────┐         ┌──────────────────┐
│  Dashboards     │         │  KioskTokens     │
├─────────────────┤         ├──────────────────┤
│ id (PK)         │         │ id (PK)          │
│ owner_id (FK)   │         │ token_hash       │
│ name            │         │ label            │
│ is_public       │         │ dashboard_id (FK)│
│ created_at      │         │ expires_at       │
└────────┬────────┘         │ created_by (FK)  │
         │1:N               └──────────────────┘
         ▼
┌──────────────────────┐
│ DashboardWidgets     │
├──────────────────────┤
│ id (PK)              │
│ dashboard_id (FK)    │
│ widget_type          │
│ title / subtitle     │
│ x, y (position)      │
│ cols, rows (size)    │
│ settings (JSONB)     │
└──────────────────────┘

┌─────────────┐
│   Assets    │
├─────────────┤
│ id (PK)     │
│ moneo_asset_id (UQ) │
│ name        │
│ location    │
│ latitude    │
│ longitude   │
│ metadata    │
└────────┬────┘
         │1:N
         ▼
┌──────────────────────────────┐
│          Sensors             │
├──────────────────────────────┤
│ id (PK)                      │
│ moneo_sensor_id (UQ)         │
│ moneo_datasource_ref (UQ,NUL)│  ← 128-char hex used by /processdata
│ asset_id (FK, NUL)           │
│ name / description           │
│ sensor_type / unit           │
│ is_active                    │
│ last_seen_at (timestamptz)   │  ← watermark for incremental polling
│ expected_poll_seconds (NUL)  │
│ normal_min/max (NUL float)   │
│ warning_min/max (NUL float)  │
│ critical_min/max (NUL float) │
│ ranges_source (varchar 20)   │
│ metadata (JSONB)             │
│ created_at                   │
└────────┬─────────────────────┘
         │1:N
         ▼
┌──────────────────────────────┐
│       SensorReadings         │
├──────────────────────────────┤
│ id (BIGPK)                   │
│ sensor_id (FK)               │
│ value                        │
│ timestamp (timestamptz)      │
│ status                       │
│ UNIQUE(sensor_id, timestamp) │  ← added in 0009
└──────────────────────────────┘

┌──────────────────┐
│  AlertConfigs    │
├──────────────────┤
│ id (PK)          │
│ sensor_id (FK)   │
│ threshold_value  │
│ comparison_type  │
│ is_active        │
└──────────────────┘

┌───────────────────────────────────────┐
│              SyncRuns                 │
├───────────────────────────────────────┤
│ id (PK)                               │
│ source (varchar, e.g. "moneo.readings")│
│ status ('success'|'partial'|'failed') │
│ started_at (timestamptz)             │
│ finished_at (timestamptz, NUL)       │
│ records_in (int)                     │
│ records_written (int)                │
│ error_count (int)                    │
│ error_summary (text, NUL)            │
└──────────────────┬────────────────────┘
                   │1:N
                   ▼
┌───────────────────────────────────────┐
│              SyncErrors               │
├───────────────────────────────────────┤
│ id (PK)                               │
│ run_id (FK → sync_runs)               │
│ sensor_id (FK → sensors, NUL)         │
│ kind (varchar — see kinds below)      │
│ http_status (int, NUL)               │
│ message (text)                        │
└───────────────────────────────────────┘
```

**`sync_errors.kind` values:**
`'http_401'`, `'http_403'`, `'http_404'`, `'http_5xx'`, `'http_other'`, `'transport_error'`,
`'parse_error'`, `'db_error'`

---

## Table Definitions

### users
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### dashboards
```sql
CREATE TABLE dashboards (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### dashboard_widgets
```sql
CREATE TABLE dashboard_widgets (
    id SERIAL PRIMARY KEY,
    dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    widget_type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    subtitle VARCHAR(255),
    x INTEGER DEFAULT 0,
    y INTEGER DEFAULT 0,
    cols INTEGER DEFAULT 6,
    rows INTEGER DEFAULT 4,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### assets
```sql
CREATE TABLE assets (
    id SERIAL PRIMARY KEY,
    moneo_asset_id VARCHAR(255) UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    location VARCHAR(255),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### sensors
```sql
CREATE TABLE sensors (
    id SERIAL PRIMARY KEY,
    moneo_sensor_id VARCHAR(255) UNIQUE NOT NULL,
    moneo_datasource_ref VARCHAR(512) UNIQUE,  -- 128-char hex from /nodes topology; used by /processdata
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    sensor_type VARCHAR(100) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    min_value DECIMAL(10, 4),
    max_value DECIMAL(10, 4),
    is_active BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMP WITH TIME ZONE,         -- watermark for incremental reads polling
    expected_poll_seconds INTEGER,
    normal_min DECIMAL(10, 4),
    normal_max DECIMAL(10, 4),
    warning_min DECIMAL(10, 4),
    warning_max DECIMAL(10, 4),
    critical_min DECIMAL(10, 4),
    critical_max DECIMAL(10, 4),
    ranges_source VARCHAR(20) DEFAULT 'manual',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sensors_moneo_sensor_id ON sensors(moneo_sensor_id);
CREATE INDEX idx_sensors_moneo_datasource_ref ON sensors(moneo_datasource_ref);
CREATE INDEX idx_sensors_asset_id ON sensors(asset_id);
CREATE INDEX idx_sensors_is_active ON sensors(is_active);
```

### sensor_readings
```sql
CREATE TABLE sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    sensor_id INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    value DECIMAL(10, 4) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) DEFAULT 'ok',
    UNIQUE (sensor_id, timestamp)   -- prevents duplicate writes; added in migration 0009
);

CREATE INDEX idx_sensor_readings_sensor_timestamp ON sensor_readings(sensor_id, timestamp DESC);
CREATE INDEX idx_sensor_readings_timestamp ON sensor_readings(timestamp DESC);
```

**Note:** `sensor_readings` has no time-based row retention job. The unique constraint prevents
duplicate writes but old readings accumulate indefinitely. Table partitioning is a planned
Iteration 2 improvement.

### alert_configs
```sql
CREATE TABLE alert_configs (
    id SERIAL PRIMARY KEY,
    sensor_id INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    threshold_value DECIMAL(10, 4) NOT NULL,
    comparison_type VARCHAR(20) NOT NULL,   -- 'gt', 'lt', 'gte', 'lte', 'eq', 'ne'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### kiosk_tokens
```sql
CREATE TABLE kiosk_tokens (
    id SERIAL PRIMARY KEY,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    label VARCHAR(255),
    dashboard_id INTEGER REFERENCES dashboards(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### sync_runs
```sql
CREATE TABLE sync_runs (
    id SERIAL PRIMARY KEY,
    source VARCHAR(64) NOT NULL,          -- 'moneo.readings' | 'moneo.metadata'
    status VARCHAR(16) NOT NULL,          -- 'success' | 'partial' | 'failed'
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE,
    records_in INTEGER NOT NULL DEFAULT 0,
    records_written INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT,
    last_cursor TIMESTAMP WITH TIME ZONE  -- last watermark committed in this run
);

CREATE INDEX idx_sync_runs_source_started ON sync_runs(source, started_at DESC);
```

### sync_errors
```sql
CREATE TABLE sync_errors (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
    sensor_id INTEGER REFERENCES sensors(id) ON DELETE SET NULL,
    kind VARCHAR(32) NOT NULL,            -- see kind values above
    http_status INTEGER,
    message TEXT NOT NULL
);

CREATE INDEX idx_sync_errors_run_id ON sync_errors(run_id);
CREATE INDEX idx_sync_errors_kind ON sync_errors(kind);
```

---

## Indexes Strategy

| Index | Table | Purpose |
|---|---|---|
| `(sensor_id, timestamp DESC)` | `sensor_readings` | Fetch latest readings for a sensor |
| `(timestamp DESC)` | `sensor_readings` | Time-range queries across all sensors |
| `moneo_sensor_id` | `sensors` | MONEO topology sync lookup |
| `moneo_datasource_ref` | `sensors` | /processdata call — maps 128-char hex ID to local sensor |
| `is_active` | `sensors` | Filter active sensors in poller |
| `(source, started_at DESC)` | `sync_runs` | Health surface: find most recent run per source |
| `run_id` | `sync_errors` | Join sync_errors to parent sync_run |

---

## Backup & Recovery

### Backup Strategy
```bash
# Full backup
pg_dump -U moneo_user moneo_monitoring > backup_$(date +%Y%m%d).sql

# Compressed
pg_dump -U moneo_user -F c moneo_monitoring > backup_$(date +%Y%m%d).dump

# Restore
pg_restore -U moneo_user -d moneo_monitoring backup_$(date +%Y%m%d).dump
```

### Alembic commands
```bash
# Apply all pending migrations
alembic upgrade head

# Check current revision
alembic current

# Rollback one step
alembic downgrade -1
```
