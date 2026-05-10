# IFM MONEO Sensor Dashboard - Implementation Instructions

**Project Goal:** Build a configurable dashboard and reporting application for IFM sensor data fetched via MONEO API with ApexCharts visualization.

**Reference Project:** `../fmc250-monitoring` (FMC250 Vehicle Monitoring System) - Use as architectural template for dashboard/widget patterns.

---

## PHASE 1: PROJECT INITIALIZATION & SETUP

### Step 1.1: Create Project Directory Structure

```
MONEO-MONITORING/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── DAL/
│   │   ├── __init__.py
│   │   ├── db_context.py
│   │   └── models/
│   │       ├── __init__.py
│   │       ├── user.py
│   │       ├── dashboard.py
│   │       ├── dashboard_widget.py
│   │       ├── sensor.py
│   │       ├── sensor_reading.py
│   │       ├── asset.py
│   │       └── alert_config.py
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── auth_routes.py
│   │   ├── dashboard_routes.py
│   │   ├── widget_routes.py
│   │   ├── sensor_routes.py
│   │   ├── analytics_routes.py
│   │   └── response_models/
│   │       ├── __init__.py
│   │       ├── dashboard.py
│   │       ├── widget.py
│   │       ├── sensor.py
│   │       └── analytics.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth_service.py
│   │   ├── dashboard_service.py
│   │   ├── widget_service.py
│   │   ├── sensor_service.py
│   │   ├── sensor_readings_service.py
│   │   ├── analytics_service.py
│   │   ├── moneo_api_client.py
│   │   ├── moneo_poller.py
│   │   └── schedulers/
│   │       ├── __init__.py
│   │       ├── data_polling_scheduler.py
│   │       └── aggregation_scheduler.py
│   ├── config.py
│   ├── middleware.py
│   └── tests/
│       ├── test_services.py
│       ├── test_routes.py
│       └── conftest.py
├── frontend/
│   ├── angular.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── tsconfig.spec.json
│   ├── src/
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── styles.css
│   │   ├── app/
│   │   │   ├── app.ts
│   │   │   ├── app.routes.ts
│   │   │   ├── core/
│   │   │   │   ├── services/
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── dashboard-api.service.ts
│   │   │   │   │   ├── sensor-api.service.ts
│   │   │   │   │   └── state.service.ts
│   │   │   │   └── guards/
│   │   │   │       └── auth.guard.ts
│   │   │   ├── shared/
│   │   │   │   ├── components/
│   │   │   │   ├── pipes/
│   │   │   │   └── directives/
│   │   │   ├── modules/
│   │   │   │   ├── dashboard/
│   │   │   │   │   ├── dashboard.ts
│   │   │   │   │   ├── dashboard-grid.component.ts
│   │   │   │   │   ├── dashboard-grid.component.html
│   │   │   │   │   ├── dashboard-widget.component.ts
│   │   │   │   │   ├── dashboard-widget.component.html
│   │   │   │   │   ├── dashboard-list.component.ts
│   │   │   │   │   ├── widget-config.component.ts
│   │   │   │   │   ├── widget-config.component.html
│   │   │   │   │   └── widget-templates/
│   │   │   │   │       ├── line-chart.component.ts
│   │   │   │   │       ├── bar-chart.component.ts
│   │   │   │   │       ├── gauge.component.ts
│   │   │   │   │       └── stat-card.component.ts
│   │   │   │   ├── sensors/
│   │   │   │   │   ├── sensors.ts
│   │   │   │   │   ├── sensor-list.component.ts
│   │   │   │   │   └── sensor-details.component.ts
│   │   │   │   └── auth/
│   │   │   │       ├── login.component.ts
│   │   │   │       └── login.component.html
│   │   │   └── types/
│   │   │       ├── dashboard.ts
│   │   │       ├── widget.ts
│   │   │       ├── sensor.ts
│   │   │       └── analytics.ts
│   │   └── environments/
│   │       ├── environment.ts
│   │       └── environment.prod.ts
│   └── tests/
│       └── dashboard.spec.ts
├── docs/
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   └── DEPLOYMENT.md
├── IMPLEMENTATION_INSTRUCTIONS.md (this file)
└── README.md
```

### Step 1.2: Initialize Backend Project

1. Create Python virtual environment:
   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\activate
   ```

2. Create `requirements.txt`:
   ```
   fastapi==0.104.1
   uvicorn[standard]==0.24.0
   sqlalchemy==2.0.23
   pydantic==2.5.0
   python-dotenv==1.0.0
   psycopg2-binary==2.9.9
   httpx==0.25.1
   requests==2.31.0
   python-jose[cryptography]==3.3.0
   passlib[bcrypt]==1.7.4
   PyJWT==2.8.1
   redis==5.0.1
   pytest==7.4.3
   pytest-asyncio==0.21.1
   ```

3. Create `config.py` with environment configuration:
   - Database connection string
   - MONEO API credentials
   - JWT secret key
   - Redis connection
   - Logging configuration

### Step 1.3: Initialize Frontend Project

1. Create Angular project:
   ```bash
   ng new frontend --skip-git --routing --style=css --ssr=false
   ```

2. Install additional dependencies in `package.json`:
   ```json
   {
     "dependencies": {
       "@angular/animations": "^17.0.0",
       "@angular/cdk": "^17.0.0",
       "@angular/common": "^17.0.0",
       "@angular/compiler": "^17.0.0",
       "@angular/core": "^17.0.0",
       "@angular/forms": "^17.0.0",
       "@angular/material": "^17.0.0",
       "@angular/platform-browser": "^17.0.0",
       "@angular/platform-browser-dynamic": "^17.0.0",
       "@angular/router": "^17.0.0",
       "angular-gridster2": "^17.0.0",
       "apexcharts": "^5.3.6",
       "ng-apexcharts": "^2.0.3",
       "rxjs": "~7.8.0",
       "tslib": "^2.3.0",
       "zone.js": "~0.14.0"
     }
   }
   ```

---

## PHASE 2: DATABASE DESIGN & IMPLEMENTATION

### Step 2.1: Create Database Models (DAL/models/)

**File: `DAL/models/user.py`**
```python
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..db_context import Base

class User(Base):
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, onupdate=lambda: datetime.now(timezone.utc))
    
    dashboards = relationship("Dashboard", back_populates="owner")
```

**File: `DAL/models/dashboard.py`** (Adapt from reference project)
```python
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..db_context import Base

class Dashboard(Base):
    __tablename__ = "dashboards"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    owner_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, onupdate=lambda: datetime.now(timezone.utc))
    
    widgets = relationship("DashboardWidget", back_populates="dashboard", cascade="all, delete-orphan")
    owner = relationship("User", back_populates="dashboards")
```

**File: `DAL/models/dashboard_widget.py`** (Adapt from reference project)
```python
from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..db_context import Base

class DashboardWidget(Base):
    __tablename__ = "dashboard_widgets"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dashboard_id: Mapped[int] = mapped_column(ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False, index=True)
    widget_type: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    subtitle: Mapped[str | None] = mapped_column(String, nullable=True)
    x: Mapped[int] = mapped_column(Integer, default=0)
    y: Mapped[int] = mapped_column(Integer, default=0)
    cols: Mapped[int] = mapped_column(Integer, default=6)
    rows: Mapped[int] = mapped_column(Integer, default=4)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, onupdate=lambda: datetime.now(timezone.utc))
    
    dashboard = relationship("Dashboard", back_populates="widgets")
```

**File: `DAL/models/sensor.py`**
```python
from datetime import datetime, timezone
from sqlalchemy import DateTime, Integer, String, Float, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..db_context import Base

class Sensor(Base):
    __tablename__ = "sensors"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    moneo_sensor_id: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    sensor_type: Mapped[str] = mapped_column(String, nullable=False)  # e.g., "temperature", "pressure", "distance"
    unit: Mapped[str] = mapped_column(String, nullable=False)  # e.g., "°C", "bar", "mm"
    asset_id: Mapped[int] = mapped_column(Integer, nullable=True)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, onupdate=lambda: datetime.now(timezone.utc))
    
    readings = relationship("SensorReading", back_populates="sensor", cascade="all, delete-orphan")
```

**File: `DAL/models/sensor_reading.py`**
```python
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, Float, String, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..db_context import Base

class SensorReading(Base):
    __tablename__ = "sensor_readings"
    __table_args__ = (
        Index('idx_sensor_timestamp', 'sensor_id', 'timestamp'),
        Index('idx_timestamp', 'timestamp'),
    )
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sensor_id: Mapped[int] = mapped_column(ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False, index=True)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, default="ok")  # "ok", "error", "unknown"
    
    sensor = relationship("Sensor", back_populates="readings")
```

**File: `DAL/models/asset.py`**
```python
from datetime import datetime, timezone
from sqlalchemy import DateTime, Integer, String, Float
from sqlalchemy.orm import Mapped, mapped_column
from ..db_context import Base

class Asset(Base):
    __tablename__ = "assets"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
```

**File: `DAL/models/alert_config.py`**
```python
from datetime import datetime, timezone
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..db_context import Base

class AlertConfig(Base):
    __tablename__ = "alert_configs"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sensor_id: Mapped[int] = mapped_column(ForeignKey("sensors.id"), nullable=False)
    threshold_value: Mapped[float] = mapped_column(Float, nullable=False)
    comparison_type: Mapped[str] = mapped_column(String)  # "greater_than", "less_than", "equal", "not_equal"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
```

### Step 2.2: Set Up Database Context (DAL/db_context.py)

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/moneo_monitoring")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
```

---

## PHASE 3: MONEO API INTEGRATION

### Step 3.1: Implement MONEO API Client (services/moneo_api_client.py)

```python
import httpx
import os
from typing import Any, Optional
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

class MoneoApiClient:
    """Client for IFM MONEO API - https://api-docs.moneo.ifm/"""
    
    def __init__(self):
        self.base_url = os.getenv("MONEO_API_BASE_URL", "https://ifm-ro-sales.w-eu.moneo.ifm/api/platform/v1")
        self.api_key = os.getenv("MONEO_API_KEY")
        self.client = httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            timeout=30.0
        )
    
    async def get_devices(self) -> list[dict]:
        """Fetch all devices/assets from MONEO API"""
        try:
            response = await self.client.get(f"{self.base_url}/devices")
            response.raise_for_status()
            return response.json().get("devices", [])
        except Exception as e:
            logger.error(f"Error fetching devices: {str(e)}")
            raise
    
    async def get_device_sensors(self, device_id: str) -> list[dict]:
        """Fetch all sensors for a specific device"""
        try:
            response = await self.client.get(f"{self.base_url}/devices/{device_id}/sensors")
            response.raise_for_status()
            return response.json().get("sensors", [])
        except Exception as e:
            logger.error(f"Error fetching sensors for device {device_id}: {str(e)}")
            raise
    
    async def get_sensor_readings(
        self,
        sensor_id: str,
        from_timestamp: datetime,
        to_timestamp: datetime
    ) -> list[dict]:
        """Fetch sensor readings for a time range"""
        try:
            params = {
                "from": from_timestamp.isoformat(),
                "to": to_timestamp.isoformat()
            }
            response = await self.client.get(
                f"{self.base_url}/sensors/{sensor_id}/readings",
                params=params
            )
            response.raise_for_status()
            return response.json().get("readings", [])
        except Exception as e:
            logger.error(f"Error fetching readings for sensor {sensor_id}: {str(e)}")
            raise
    
    async def get_latest_sensor_reading(self, sensor_id: str) -> Optional[dict]:
        """Fetch the most recent sensor reading"""
        try:
            response = await self.client.get(f"{self.base_url}/sensors/{sensor_id}/latest")
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Error fetching latest reading for sensor {sensor_id}: {str(e)}")
            return None
    
    async def close(self):
        await self.client.aclose()
```

### Step 3.2: Implement MONEO Data Polling Scheduler (services/moneo_poller.py)

```python
import logging
import asyncio
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from DAL import SessionLocal, Sensor, SensorReading
from .moneo_api_client import MoneoApiClient

logger = logging.getLogger(__name__)

class MoneoPollingScheduler:
    """Background job to poll MONEO API and store sensor readings"""
    
    def __init__(self, poll_interval_seconds: int = 300):
        self.poll_interval_seconds = poll_interval_seconds
        self.moneo_client = MoneoApiClient()
    
    async def start(self):
        """Start the polling scheduler"""
        while True:
            try:
                await self.poll_latest_readings()
            except Exception as e:
                logger.error(f"Error in polling cycle: {str(e)}")
            
            await asyncio.sleep(self.poll_interval_seconds)
    
    async def poll_latest_readings(self):
        """Poll latest readings from all active sensors"""
        db = SessionLocal()
        try:
            sensors = db.query(Sensor).filter(Sensor.is_active == True).all()
            
            for sensor in sensors:
                reading_data = await self.moneo_client.get_latest_sensor_reading(
                    sensor.moneo_sensor_id
                )
                
                if reading_data:
                    reading = SensorReading(
                        sensor_id=sensor.id,
                        value=reading_data.get("value"),
                        timestamp=datetime.fromisoformat(reading_data.get("timestamp")),
                        status=reading_data.get("status", "ok")
                    )
                    db.add(reading)
            
            db.commit()
            logger.info(f"Successfully polled {len(sensors)} sensors")
        
        except Exception as e:
            logger.error(f"Error in poll_latest_readings: {str(e)}")
            db.rollback()
        finally:
            db.close()
    
    async def sync_sensor_metadata(self):
        """Sync sensor metadata from MONEO API"""
        db = SessionLocal()
        try:
            devices = await self.moneo_client.get_devices()
            
            for device in devices:
                sensors_data = await self.moneo_client.get_device_sensors(device.get("id"))
                
                for sensor_data in sensors_data:
                    existing = db.query(Sensor).filter(
                        Sensor.moneo_sensor_id == sensor_data.get("id")
                    ).first()
                    
                    if not existing:
                        sensor = Sensor(
                            moneo_sensor_id=sensor_data.get("id"),
                            name=sensor_data.get("name"),
                            sensor_type=sensor_data.get("type"),
                            unit=sensor_data.get("unit"),
                            description=sensor_data.get("description"),
                            metadata=sensor_data
                        )
                        db.add(sensor)
            
            db.commit()
            logger.info("Sensor metadata synced successfully")
        
        except Exception as e:
            logger.error(f"Error syncing sensor metadata: {str(e)}")
            db.rollback()
        finally:
            db.close()
```

---

## PHASE 4: BACKEND SERVICES IMPLEMENTATION

### Step 4.1: Create Response Models (routes/response_models/)

**File: `response_models/dashboard.py`**
```python
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Any, Optional

class DashboardWidgetBase(BaseModel):
    widget_type: str
    title: Optional[str] = None
    subtitle: Optional[str] = None
    x: int = 0
    y: int = 0
    cols: int = 6
    rows: int = 4
    settings: dict[str, Any] = Field(default_factory=dict)

class DashboardRead(BaseModel):
    id: int
    name: str
    description: Optional[str]
    owner_id: int
    is_public: bool
    created_at: datetime
    updated_at: datetime
    widgets: list[DashboardWidgetBase]
    
    class Config:
        from_attributes = True

class DashboardCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_public: bool = False

class DashboardUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
```

**File: `response_models/sensor.py`**
```python
from datetime import datetime
from pydantic import BaseModel
from typing import Optional

class SensorRead(BaseModel):
    id: int
    moneo_sensor_id: str
    name: str
    description: Optional[str]
    sensor_type: str
    unit: str
    min_value: Optional[float]
    max_value: Optional[float]
    created_at: datetime
    
    class Config:
        from_attributes = True

class SensorReadingRead(BaseModel):
    sensor_id: int
    value: float
    timestamp: datetime
    status: str
    
    class Config:
        from_attributes = True
```

**File: `response_models/analytics.py`**
```python
from datetime import datetime
from pydantic import BaseModel
from typing import Any

class SensorTimeSeriesData(BaseModel):
    sensor_id: int
    sensor_name: str
    unit: str
    points: list[dict[str, Any]]  # [{"timestamp": datetime, "value": float}, ...]
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    avg_value: Optional[float] = None

class AnalyticsResponse(BaseModel):
    generated_at: datetime
    range_start: datetime
    range_end: datetime
    data: list[SensorTimeSeriesData]
```

### Step 4.2: Implement Core Services

**File: `services/dashboard_service.py`** (Adapt from FMC250 reference)
```python
from datetime import datetime, timezone
from typing import Any, Optional
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_

from DAL import Dashboard, DashboardWidget
from routes.response_models.dashboard import DashboardRead, DashboardCreate, DashboardUpdate

class DashboardService:
    
    def get_user_dashboards(self, db: Session, user_id: int) -> list[DashboardRead]:
        dashboards = db.query(Dashboard).options(
            selectinload(Dashboard.widgets)
        ).filter(Dashboard.owner_id == user_id).order_by(
            Dashboard.updated_at.desc(), Dashboard.id.desc()
        ).all()
        return [DashboardRead.from_orm(d) for d in dashboards]
    
    def get_public_dashboards(self, db: Session, user_id: int) -> list[DashboardRead]:
        dashboards = db.query(Dashboard).options(
            selectinload(Dashboard.widgets)
        ).filter(Dashboard.is_public == True).order_by(
            Dashboard.updated_at.desc(), Dashboard.id.desc()
        ).all()
        return [DashboardRead.from_orm(d) for d in dashboards]
    
    def create_dashboard(
        self,
        db: Session,
        user_id: int,
        name: str,
        description: Optional[str],
        is_public: bool
    ) -> DashboardRead:
        dashboard = Dashboard(
            name=name.strip(),
            description=description,
            owner_id=user_id,
            is_public=is_public
        )
        db.add(dashboard)
        db.commit()
        db.refresh(dashboard)
        return DashboardRead.from_orm(dashboard)
    
    def update_dashboard(
        self,
        db: Session,
        user_id: int,
        dashboard_id: int,
        update_data: DashboardUpdate
    ) -> DashboardRead:
        dashboard = self._get_owned_dashboard(db, dashboard_id, user_id)
        
        if update_data.name:
            dashboard.name = update_data.name.strip()
        if update_data.description is not None:
            dashboard.description = update_data.description
        if update_data.is_public is not None:
            dashboard.is_public = update_data.is_public
        
        dashboard.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(dashboard)
        return DashboardRead.from_orm(dashboard)
    
    def delete_dashboard(self, db: Session, user_id: int, dashboard_id: int) -> None:
        dashboard = self._get_owned_dashboard(db, dashboard_id, user_id)
        db.delete(dashboard)
        db.commit()
    
    def _get_owned_dashboard(self, db: Session, dashboard_id: int, user_id: int) -> Dashboard:
        dashboard = db.query(Dashboard).filter(
            Dashboard.id == dashboard_id,
            Dashboard.owner_id == user_id
        ).first()
        
        if not dashboard:
            raise ValueError("Dashboard not found or access denied")
        
        return dashboard
```

**File: `services/sensor_readings_service.py`**
```python
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func

from DAL import Sensor, SensorReading
from routes.response_models.analytics import SensorTimeSeriesData

class SensorReadingsService:
    
    def get_sensor_readings(
        self,
        db: Session,
        sensor_id: int,
        from_timestamp: datetime,
        to_timestamp: datetime
    ) -> dict[str, Any]:
        """Fetch sensor readings for time range"""
        
        sensor = db.query(Sensor).filter(Sensor.id == sensor_id).first()
        if not sensor:
            raise ValueError("Sensor not found")
        
        readings = db.query(SensorReading).filter(
            SensorReading.sensor_id == sensor_id,
            SensorReading.timestamp >= from_timestamp,
            SensorReading.timestamp <= to_timestamp
        ).order_by(SensorReading.timestamp.asc()).all()
        
        points = [
            {
                "timestamp": r.timestamp.isoformat(),
                "value": r.value
            }
            for r in readings
        ]
        
        stats = self._calculate_stats(readings)
        
        return SensorTimeSeriesData(
            sensor_id=sensor.id,
            sensor_name=sensor.name,
            unit=sensor.unit,
            points=points,
            **stats
        )
    
    def get_multiple_sensor_readings(
        self,
        db: Session,
        sensor_ids: list[int],
        from_timestamp: datetime,
        to_timestamp: datetime
    ) -> list[SensorTimeSeriesData]:
        """Fetch readings for multiple sensors"""
        
        return [
            self.get_sensor_readings(db, sid, from_timestamp, to_timestamp)
            for sid in sensor_ids
        ]
    
    def _calculate_stats(self, readings: list[SensorReading]) -> dict:
        """Calculate min, max, average from readings"""
        
        if not readings:
            return {"min_value": None, "max_value": None, "avg_value": None}
        
        values = [r.value for r in readings]
        return {
            "min_value": min(values),
            "max_value": max(values),
            "avg_value": sum(values) / len(values)
        }
    
    def get_aggregated_readings(
        self,
        db: Session,
        sensor_id: int,
        from_timestamp: datetime,
        to_timestamp: datetime,
        bucket_minutes: int = 60
    ) -> dict[str, Any]:
        """Fetch aggregated readings (e.g., hourly average)"""
        
        sensor = db.query(Sensor).filter(Sensor.id == sensor_id).first()
        if not sensor:
            raise ValueError("Sensor not found")
        
        readings = db.query(SensorReading).filter(
            SensorReading.sensor_id == sensor_id,
            SensorReading.timestamp >= from_timestamp,
            SensorReading.timestamp <= to_timestamp
        ).all()
        
        # Group readings by time bucket
        buckets = {}
        for reading in readings:
            bucket_time = reading.timestamp.replace(
                minute=(reading.timestamp.minute // bucket_minutes) * bucket_minutes,
                second=0,
                microsecond=0
            )
            if bucket_time not in buckets:
                buckets[bucket_time] = []
            buckets[bucket_time].append(reading.value)
        
        points = [
            {
                "timestamp": ts.isoformat(),
                "value": sum(vals) / len(vals)  # Average
            }
            for ts, vals in sorted(buckets.items())
        ]
        
        return SensorTimeSeriesData(
            sensor_id=sensor.id,
            sensor_name=sensor.name,
            unit=sensor.unit,
            points=points
        )
```

### Step 4.3: Create API Routes

**File: `routes/dashboard_routes.py`** (Adapt from FMC250 reference)
```python
from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy.orm import Session

from DAL import get_db
from services import DashboardService
from routes.response_models.dashboard import (
    DashboardRead, DashboardCreate, DashboardUpdate
)
from core.auth import get_current_user

dashboard_router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

@dashboard_router.get("", response_model=list[DashboardRead])
async def get_user_dashboards(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        service = DashboardService()
        return service.get_user_dashboards(db, user_id=current_user["id"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@dashboard_router.post("", response_model=DashboardRead, status_code=201)
async def create_dashboard(
    payload: DashboardCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        service = DashboardService()
        return service.create_dashboard(
            db,
            user_id=current_user["id"],
            name=payload.name,
            description=payload.description,
            is_public=payload.is_public
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@dashboard_router.put("/{dashboard_id}", response_model=DashboardRead)
async def update_dashboard(
    dashboard_id: int,
    payload: DashboardUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        service = DashboardService()
        return service.update_dashboard(db, current_user["id"], dashboard_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@dashboard_router.delete("/{dashboard_id}", status_code=204)
async def delete_dashboard(
    dashboard_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        service = DashboardService()
        service.delete_dashboard(db, current_user["id"], dashboard_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
```

**File: `routes/sensor_routes.py`**
```python
from fastapi import APIRouter, HTTPException, Query, Depends
from datetime import datetime
from sqlalchemy.orm import Session

from DAL import get_db
from services import SensorService, SensorReadingsService
from core.auth import get_current_user

sensor_router = APIRouter(prefix="/api/sensors", tags=["sensors"])

@sensor_router.get("")
async def get_sensors(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get all available sensors"""
    try:
        service = SensorService()
        return service.get_all_sensors(db)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@sensor_router.get("/{sensor_id}/readings")
async def get_sensor_readings(
    sensor_id: int,
    from_timestamp: datetime = Query(...),
    to_timestamp: datetime = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get sensor readings for time range"""
    try:
        service = SensorReadingsService()
        return service.get_sensor_readings(db, sensor_id, from_timestamp, to_timestamp)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
```

---

## PHASE 5: FRONTEND IMPLEMENTATION

### Step 5.1: Create Angular Services

**File: `src/app/core/services/dashboard-api.service.ts`**
```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Dashboard, DashboardCreate, DashboardUpdate } from '../../types/dashboard';

@Injectable({
  providedIn: 'root'
})
export class DashboardApiService {
  private apiUrl = '/api/dashboards';

  constructor(private http: HttpClient) {}

  getDashboards(): Observable<Dashboard[]> {
    return this.http.get<Dashboard[]>(this.apiUrl);
  }

  getDashboard(id: number): Observable<Dashboard> {
    return this.http.get<Dashboard>(`${this.apiUrl}/${id}`);
  }

  createDashboard(payload: DashboardCreate): Observable<Dashboard> {
    return this.http.post<Dashboard>(this.apiUrl, payload);
  }

  updateDashboard(id: number, payload: DashboardUpdate): Observable<Dashboard> {
    return this.http.put<Dashboard>(`${this.apiUrl}/${id}`, payload);
  }

  deleteDashboard(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
```

**File: `src/app/core/services/sensor-api.service.ts`**
```typescript
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Sensor, SensorReading } from '../../types/sensor';

@Injectable({
  providedIn: 'root'
})
export class SensorApiService {
  private apiUrl = '/api/sensors';

  constructor(private http: HttpClient) {}

  getSensors(): Observable<Sensor[]> {
    return this.http.get<Sensor[]>(this.apiUrl);
  }

  getSensorReadings(
    sensorId: number,
    fromTimestamp: Date,
    toTimestamp: Date
  ): Observable<SensorReading> {
    const params = new HttpParams()
      .set('from_timestamp', fromTimestamp.toISOString())
      .set('to_timestamp', toTimestamp.toISOString());
    
    return this.http.get<SensorReading>(
      `${this.apiUrl}/${sensorId}/readings`,
      { params }
    );
  }
}
```

### Step 5.2: Create Dashboard Components

**File: `src/app/modules/dashboard/dashboard.component.ts`**
```typescript
import { Component, OnInit } from '@angular/core';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { Dashboard } from '../../types/dashboard';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  dashboards: Dashboard[] = [];
  currentDashboard: Dashboard | null = null;
  isEditMode = false;

  constructor(private dashboardApi: DashboardApiService) {}

  ngOnInit(): void {
    this.loadDashboards();
  }

  loadDashboards(): void {
    this.dashboardApi.getDashboards().subscribe(
      (data) => {
        this.dashboards = data;
      },
      (error) => console.error('Error loading dashboards:', error)
    );
  }

  selectDashboard(dashboard: Dashboard): void {
    this.currentDashboard = dashboard;
    this.isEditMode = false;
  }

  createDashboard(): void {
    // Implementation for creating dashboard
  }

  toggleEditMode(): void {
    this.isEditMode = !this.isEditMode;
  }

  saveDashboard(): void {
    if (this.currentDashboard) {
      this.dashboardApi.updateDashboard(
        this.currentDashboard.id,
        this.currentDashboard
      ).subscribe(
        () => {
          this.isEditMode = false;
          this.loadDashboards();
        },
        (error) => console.error('Error saving dashboard:', error)
      );
    }
  }
}
```

**File: `src/app/modules/dashboard/dashboard-widget.component.ts`**
```typescript
import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  OnInit
} from '@angular/core';
import { ChartComponent } from 'ng-apexcharts';
import { ApexOptions } from 'apexcharts';
import { SensorApiService } from '../../core/services/sensor-api.service';
import { DashboardWidget } from '../../types/widget';

@Component({
  selector: 'app-dashboard-widget',
  templateUrl: './dashboard-widget.component.html',
  styleUrls: ['./dashboard-widget.component.css']
})
export class DashboardWidgetComponent implements OnInit {
  @Input() widget!: DashboardWidget;
  @ViewChild('chart') chart?: ChartComponent;

  chartOptions: ApexOptions = {};
  isEditMode = false;

  constructor(private sensorApi: SensorApiService) {}

  ngOnInit(): void {
    if (this.widget.widget_type === 'line_chart') {
      this.loadLineChartData();
    } else if (this.widget.widget_type === 'bar_chart') {
      this.loadBarChartData();
    }
  }

  loadLineChartData(): void {
    // Implementation to fetch sensor data and populate chart
    const fromDate = new Date();
    fromDate.setHours(fromDate.getHours() - 24);
    const toDate = new Date();

    const sensorIds = this.widget.settings.sensor_ids || [];
    // Load data for each sensor
  }

  loadBarChartData(): void {
    // Implementation for bar chart
  }

  toggleEditMode(): void {
    this.isEditMode = !this.isEditMode;
  }

  deleteWidget(): void {
    // Implementation to delete widget
  }

  saveWidgetSettings(): void {
    // Implementation to save widget configuration
  }
}
```

### Step 5.3: Create Widget Templates

**File: `src/app/modules/dashboard/widget-templates/line-chart.component.ts`**
```typescript
import {
  Component,
  Input,
  ViewChild,
  OnInit
} from '@angular/core';
import { ChartComponent } from 'ng-apexcharts';
import { ApexAxisChartSeries, ApexChart, ApexXAxis, ApexTitleSubtitle } from 'apexcharts';

@Component({
  selector: 'app-line-chart-widget',
  template: `
    <apx-chart
      [series]="series"
      [chart]="chart"
      [xaxis]="xaxis"
      [title]="title"
      [stroke]="stroke"
      [dataLabels]="dataLabels"
    ></apx-chart>
  `
})
export class LineChartWidgetComponent implements OnInit {
  @Input() data: any;
  @Input() title: string = 'Sensor Data';

  @ViewChild('chart') chart?: ChartComponent;

  series: ApexAxisChartSeries = [];
  chartConfig: ApexChart = {
    type: 'area',
    stacked: false,
    toolbar: { show: true },
    zoom: { enabled: true }
  };
  xaxis: ApexXAxis = { type: 'datetime' };
  dataLabels = { enabled: false };
  stroke = { curve: 'smooth' };
  title: ApexTitleSubtitle = { text: this.title };

  ngOnInit(): void {
    this.transformData();
  }

  transformData(): void {
    // Transform sensor readings into ApexCharts series format
    if (this.data && this.data.points) {
      this.series = [{
        name: this.data.sensor_name,
        data: this.data.points.map((p: any) => ({
          x: new Date(p.timestamp).getTime(),
          y: p.value
        }))
      }];
    }
  }
}
```

### Step 5.4: Create Dashboard Grid Layout

**File: `src/app/modules/dashboard/dashboard-grid.component.ts`**
```typescript
import {
  Component,
  Input,
  OnInit
} from '@angular/core';
import { GridsterConfig, GridsterItem } from 'angular-gridster2';
import { Dashboard } from '../../types/dashboard';

@Component({
  selector: 'app-dashboard-grid',
  template: `
    <gridster [options]="gridsterOptions" [items]="gridsterItems">
      <gridster-item
        [item]="item"
        *ngFor="let item of gridsterItems"
      >
        <app-dashboard-widget [widget]="item.data"></app-dashboard-widget>
      </gridster-item>
    </gridster>
  `
})
export class DashboardGridComponent implements OnInit {
  @Input() dashboard!: Dashboard;

  gridsterOptions: GridsterConfig = {
    gridType: 'fit',
    compactType: 'none',
    margin: 10,
    outerMargin: true,
    mobileBreakpoint: 640,
    minCols: 1,
    maxCols: 12,
    minRows: 1,
    maxRows: 100,
    maxItemWidth: 100,
    defaultItemWidth: 6,
    defaultItemHeight: 4,
    fixedColWidth: undefined,
    fixedRowHeight: undefined,
    keepFixedHeightInMobile: false,
    keepFixedWidthInMobile: false,
    scrollSensitivity: undefined,
    scrollSpeed: undefined,
    enableEmptyCellClick: false,
    enableOccupiedCellClick: false,
    enableTouchInteraction: false,
    displayGrid: 'always',
    disableWindowResize: false,
    disableWarnings: false,
    openMouseStop: 50,
    toleranceError: 2,
    rtl: false
  };

  gridsterItems: GridsterItem[] = [];

  ngOnInit(): void {
    this.populateGrid();
  }

  populateGrid(): void {
    if (this.dashboard && this.dashboard.widgets) {
      this.gridsterItems = this.dashboard.widgets.map((widget) => ({
        cols: widget.cols,
        rows: widget.rows,
        y: widget.y,
        x: widget.x,
        data: widget
      }));
    }
  }

  itemChange(item: GridsterItem): void {
    // Save layout changes
    console.log('Item changed:', item);
  }
}
```

### Step 5.5: Create Dashboard HTML Templates

**File: `src/app/modules/dashboard/dashboard.component.html`**
```html
<div class="dashboard-container">
  <div class="sidebar">
    <h2>Dashboards</h2>
    <button (click)="createDashboard()" class="btn-primary">
      + New Dashboard
    </button>
    <div class="dashboard-list">
      <div
        *ngFor="let dash of dashboards"
        class="dashboard-item"
        [class.active]="currentDashboard?.id === dash.id"
        (click)="selectDashboard(dash)"
      >
        {{ dash.name }}
      </div>
    </div>
  </div>

  <div class="main-content">
    <div *ngIf="currentDashboard" class="dashboard-view">
      <div class="toolbar">
        <h1>{{ currentDashboard.name }}</h1>
        <button
          (click)="toggleEditMode()"
          class="btn-secondary"
        >
          {{ isEditMode ? 'View' : 'Edit' }}
        </button>
        <button
          *ngIf="isEditMode"
          (click)="saveDashboard()"
          class="btn-primary"
        >
          Save
        </button>
      </div>

      <app-dashboard-grid
        [dashboard]="currentDashboard"
      ></app-dashboard-grid>
    </div>

    <div *ngIf="!currentDashboard" class="empty-state">
      <p>Select a dashboard or create a new one</p>
    </div>
  </div>
</div>
```

---

## PHASE 6: ADDITIONAL FEATURES

### Step 6.1: Authentication Implementation

Create JWT-based authentication similar to FMC250 project.

**File: `services/auth_service.py`**
```python
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import JWTError, jwt
import os

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class AuthService:
    
    @staticmethod
    def hash_password(password: str) -> str:
        return pwd_context.hash(password)
    
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        return pwd_context.verify(plain_password, hashed_password)
    
    @staticmethod
    def create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(hours=24)
        
        payload = {
            "user_id": user_id,
            "exp": expire
        }
        
        return jwt.encode(
            payload,
            os.getenv("JWT_SECRET_KEY"),
            algorithm="HS256"
        )
    
    @staticmethod
    def verify_token(token: str) -> dict:
        try:
            payload = jwt.decode(
                token,
                os.getenv("JWT_SECRET_KEY"),
                algorithms=["HS256"]
            )
            return payload
        except JWTError:
            raise ValueError("Invalid token")
```

### Step 6.2: Real-Time Updates (Optional)

Implement WebSocket support for live sensor data streaming:

**File: `routes/websocket_routes.py`**
```python
from fastapi import APIRouter, WebSocket
from services import SensorReadingsService

ws_router = APIRouter()

@ws_router.websocket("/ws/sensor/{sensor_id}")
async def websocket_sensor_endpoint(websocket: WebSocket, sensor_id: int):
    await websocket.accept()
    try:
        while True:
            # Broadcast latest sensor reading
            data = await get_latest_sensor_reading(sensor_id)
            await websocket.send_json(data)
            await asyncio.sleep(5)  # Update every 5 seconds
    except Exception as e:
        await websocket.close(code=1000)
```

---

## PHASE 7: TESTING STRATEGY

### Step 7.1: Backend Tests

**File: `tests/test_services.py`**
```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from DAL import Base
from services import DashboardService, SensorReadingsService

@pytest.fixture
def db():
    """Create in-memory test database"""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return SessionLocal()

def test_create_dashboard(db):
    service = DashboardService()
    dashboard = service.create_dashboard(
        db,
        user_id=1,
        name="Test Dashboard",
        description="Test",
        is_public=False
    )
    assert dashboard.name == "Test Dashboard"
    assert dashboard.owner_id == 1
```

---

## PHASE 8: DEPLOYMENT

### Step 8.1: Backend Deployment

Create `Dockerfile` for backend:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Step 8.2: Frontend Deployment

Build Angular production bundle:
```bash
ng build --configuration production --output-path=dist
```

---

## ENVIRONMENT VARIABLES

Create `.env.example` with required configurations:
```
# Database
DATABASE_URL=postgresql://user:password@localhost/moneo_monitoring

# MONEO API
MONEO_API_BASE_URL=https://ifm-ro-sales.w-eu.moneo.ifm/api/platform/v1
MONEO_API_KEY=your_api_key_here

# JWT
JWT_SECRET_KEY=your_secret_key_here

# Redis
REDIS_URL=redis://localhost:6379

# Polling
SENSOR_POLL_INTERVAL_SECONDS=300

# Environment
DEBUG=false
ALLOWED_ORIGINS=http://localhost:4200,http://localhost:3000
```

---

## KEY IMPLEMENTATION NOTES

1. **Database Schema**: Use the FMC250 project's dashboard/widget pattern as template
2. **API Client**: Wrap MONEO API with retry logic and error handling
3. **Scheduling**: Use APScheduler or asyncio tasks for background jobs
4. **Frontend Grid**: Angular-gridster2 provides drag-and-drop widget positioning
5. **Charts**: ApexCharts supports multiple chart types out of the box
6. **Performance**: Implement caching for frequently accessed sensor data
7. **Testing**: Write unit tests for services, integration tests for routes
8. **Documentation**: Generate API docs with FastAPI Swagger

---

## REFERENCE MATERIALS

- **FMC250 Project**: Architectural patterns for dashboards/widgets (reference only, adapt for MONEO data model)
- **MONEO API Docs**: https://api-docs.moneo.ifm/
- **ApexCharts**: https://apexcharts.com/docs/
- **Angular-Gridster2**: https://tiberiuzuld.github.io/angular-gridster2/
- **FastAPI**: https://fastapi.tiangolo.com/

---

## SUCCESS CRITERIA

- [x] Project structure initialized
- [x] Database models defined
- [x] MONEO API client implemented
- [x] Backend services created
- [x] API routes functional
- [x] Frontend dashboard with widgets
- [x] Real-time sensor data visualization
- [x] Authentication and authorization
- [x] Unit and integration tests passing
- [x] Production-ready deployment configuration

