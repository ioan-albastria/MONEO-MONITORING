# Database Schema

## Entity Relationship Diagram

```
┌─────────────┐
│    Users    │
├─────────────┤
│ id (PK)     │
│ username    │
│ email       │
│ password    │
│ created_at  │
└──────┬──────┘
       │1:N
       │
       ▼
┌─────────────────┐
│  Dashboards     │
├─────────────────┤
│ id (PK)         │
│ owner_id (FK)   │
│ name            │
│ description     │
│ is_public       │
│ created_at      │
│ updated_at      │
└────────┬────────┘
         │1:N
         │
         ▼
┌──────────────────────┐
│ DashboardWidgets     │
├──────────────────────┤
│ id (PK)              │
│ dashboard_id (FK)    │
│ widget_type          │
│ title                │
│ subtitle             │
│ x, y (position)      │
│ cols, rows (size)    │
│ settings (JSON)      │
│ created_at           │
└──────────────────────┘

┌─────────────┐
│   Assets    │
├─────────────┤
│ id (PK)     │
│ name        │
│ description │
│ location    │
│ latitude    │
│ longitude   │
│ metadata    │
│ created_at  │
└────────┬────┘
         │1:N
         │
         ▼
┌─────────────────┐
│    Sensors      │
├─────────────────┤
│ id (PK)         │
│ moneo_id (UQ)   │
│ asset_id (FK)   │
│ name            │
│ description     │
│ sensor_type     │
│ unit            │
│ min_value       │
│ max_value       │
│ is_active       │
│ metadata        │
│ created_at      │
└────────┬────────┘
         │1:N
         │
         ▼
┌──────────────────┐
│ SensorReadings   │
├──────────────────┤
│ id (PK)          │
│ sensor_id (FK)   │
│ value            │
│ timestamp        │
│ status           │
└──────────────────┘

┌──────────────────┐
│ AlertConfigs     │
├──────────────────┤
│ id (PK)          │
│ sensor_id (FK)   │
│ threshold_value  │
│ comparison_type  │
│ is_active        │
│ created_at       │
└──────────────────┘
```

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

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
```

### dashboards
```sql
CREATE TABLE dashboards (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id INTEGER NOT NULL,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_dashboards_owner_id ON dashboards(owner_id);
CREATE INDEX idx_dashboards_is_public ON dashboards(is_public);
```

### dashboard_widgets
```sql
CREATE TABLE dashboard_widgets (
    id SERIAL PRIMARY KEY,
    dashboard_id INTEGER NOT NULL,
    widget_type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    subtitle VARCHAR(255),
    x INTEGER DEFAULT 0,
    y INTEGER DEFAULT 0,
    cols INTEGER DEFAULT 6,
    rows INTEGER DEFAULT 4,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
);

CREATE INDEX idx_dashboard_widgets_dashboard_id ON dashboard_widgets(dashboard_id);
```

### assets
```sql
CREATE TABLE assets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    location VARCHAR(255),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assets_name ON assets(name);
```

### sensors
```sql
CREATE TABLE sensors (
    id SERIAL PRIMARY KEY,
    moneo_sensor_id VARCHAR(255) UNIQUE NOT NULL,
    asset_id INTEGER,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    sensor_type VARCHAR(100) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    min_value DECIMAL(10, 4),
    max_value DECIMAL(10, 4),
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE INDEX idx_sensors_moneo_sensor_id ON sensors(moneo_sensor_id);
CREATE INDEX idx_sensors_asset_id ON sensors(asset_id);
CREATE INDEX idx_sensors_is_active ON sensors(is_active);
```

### sensor_readings
```sql
CREATE TABLE sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    sensor_id INTEGER NOT NULL,
    value DECIMAL(10, 4) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) DEFAULT 'ok',
    FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
);

-- Performance critical indexes
CREATE INDEX idx_sensor_readings_sensor_timestamp ON sensor_readings(sensor_id, timestamp DESC);
CREATE INDEX idx_sensor_readings_timestamp ON sensor_readings(timestamp DESC);

-- Optional: Partition by time for very large datasets
-- CREATE TABLE sensor_readings_2024_01 PARTITION OF sensor_readings
--     FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

### alert_configs
```sql
CREATE TABLE alert_configs (
    id SERIAL PRIMARY KEY,
    sensor_id INTEGER NOT NULL,
    threshold_value DECIMAL(10, 4) NOT NULL,
    comparison_type VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
);

CREATE INDEX idx_alert_configs_sensor_id ON alert_configs(sensor_id);
```

## Data Types and Constraints

| Column | Type | Constraints | Notes |
|--------|------|-----------|-------|
| id | SERIAL | PRIMARY KEY | Auto-increment |
| sensor_id | INTEGER | FOREIGN KEY | References sensors(id) |
| value | DECIMAL(10,4) | NOT NULL | 4 decimal places precision |
| timestamp | TIMESTAMP | NOT NULL | With timezone support |
| status | VARCHAR(20) | DEFAULT 'ok' | 'ok', 'error', 'unknown' |

## Indexes Strategy

### Read-Heavy Queries
- `sensor_id + timestamp DESC` - Fetch latest readings
- `timestamp DESC` - Time-based queries
- `dashboard_owner_id` - List user dashboards
- `sensor_type` - Filter by type

### Write Considerations
- Indexes slow down inserts on `sensor_readings` (high volume)
- Consider table partitioning for readings older than 1 year
- Batch inserts for MONEO polling

## Performance Optimization

### For Large Datasets (>1M readings/day)

1. **Table Partitioning** - Partition sensor_readings by date range
2. **Materialized Views** - Pre-aggregate daily/hourly readings
3. **Column Compression** - Use COMPRESSION on sensor_readings
4. **Archival Strategy** - Move old data to archive tables

### Query Optimization Tips

```sql
-- GOOD: Use indexes effectively
SELECT value, timestamp 
FROM sensor_readings 
WHERE sensor_id = 123 
  AND timestamp BETWEEN '2024-01-01' AND '2024-01-31'
ORDER BY timestamp DESC;

-- BAD: Full table scan
SELECT * FROM sensor_readings WHERE value > 100;

-- GOOD: Limit for pagination
SELECT * FROM dashboards WHERE owner_id = 1 LIMIT 50 OFFSET 0;
```

## Backup & Recovery

### Backup Strategy
```bash
# Full backup
pg_dump moneo_monitoring > backup_full.sql

# Incremental backup (WAL archiving)
# Configure in postgresql.conf:
# archive_mode = on
# archive_command = 'cp %p /backup/wal_archive/%f'
```

### Recovery
```bash
# Full restore
psql moneo_monitoring < backup_full.sql

# Point-in-time recovery (PITR)
# Requires WAL files and base backup
```

## Migration Management

Use Alembic for database migrations:

```python
# alembic/env.py configuration
# Tracks schema changes over time
# Migration files: alembic/versions/

# Create migration
alembic revision --autogenerate -m "Add sensor readings table"

# Apply migration
alembic upgrade head

# Rollback
alembic downgrade -1
```

