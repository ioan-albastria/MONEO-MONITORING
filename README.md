# IFM MONEO Sensor Dashboard

A configurable dashboard and reporting application for visualizing sensor data from IFM devices via the MONEO API. Built with Python FastAPI backend, Angular frontend, and ApexCharts for interactive data visualization.

## Project Overview

This application enables users to:
- **Connect to IFM MONEO API** to fetch real-time sensor data
- **Create configurable dashboards** with drag-and-drop widgets
- **Visualize sensor data** with interactive ApexCharts (line, bar, gauge, etc.)
- **Monitor trends** with time-series analysis
- **Share dashboards** with team members
- **Export reports** of sensor readings and analytics

## Technology Stack

### Backend
- **Framework**: FastAPI (Python)
- **Database**: PostgreSQL with SQLAlchemy ORM
- **Caching**: Redis (optional)
- **Authentication**: JWT with PassLib/BCrypt
- **API Client**: httpx for MONEO API integration

### Frontend
- **Framework**: Angular 21 (standalone components)
- **Charts**: ApexCharts 3.x with ng-apexcharts
- **Layout**: Angular-Gridster2 (drag-and-drop grid)
- **Styling**: Angular Material
- **State Management**: RxJS

### Infrastructure
- **Containerization**: Docker
- **Task Scheduling**: APScheduler / asyncio
- **Testing**: Pytest (backend), Jasmine (frontend)

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 14+
- Docker (optional)

### Quick Start

1. **Clone and navigate to project**
   ```bash
   cd MONEO-MONITORING
   ```

2. **Follow implementation instructions**
   
   See [IMPLEMENTATION_INSTRUCTIONS.md](./IMPLEMENTATION_INSTRUCTIONS.md) for detailed step-by-step setup and development guide.

3. **Backend Setup**
   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\activate  # or source .venv/bin/activate on macOS/Linux
   pip install -r requirements.txt
   ```

4. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your MONEO API credentials and database settings
   ```

5. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   ng serve
   ```

6. **Start Backend Server**
   ```bash
   cd backend
   uvicorn main:app --reload
   ```

7. **Access Application**
   - Frontend: http://localhost:4200
   - API Docs: http://localhost:8000/docs

## Project Structure

```
MONEO-MONITORING/
├── backend/                          # Python FastAPI backend
│   ├── main.py                      # Application entry point
│   ├── requirements.txt             # Python dependencies
│   ├── config.py                    # Configuration management
│   ├── DAL/                         # Data Access Layer
│   │   ├── models/                  # SQLAlchemy models
│   │   └── db_context.py           # Database session management
│   ├── routes/                      # API endpoints
│   │   └── response_models/        # Pydantic response models
│   ├── services/                    # Business logic
│   │   ├── moneo_api_client.py     # MONEO API integration
│   │   ├── dashboard_service.py    # Dashboard CRUD
│   │   ├── sensor_readings_service.py  # Analytics
│   │   └── schedulers/             # Background tasks
│   └── tests/                       # Unit and integration tests
│
├── frontend/                        # Angular application
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/               # Core services and guards
│   │   │   ├── modules/            # Feature modules
│   │   │   │   ├── dashboard/      # Dashboard management
│   │   │   │   └── sensors/        # Sensor visualization
│   │   │   ├── shared/             # Shared components
│   │   │   └── types/              # TypeScript interfaces
│   │   └── environments/           # Environment config
│   ├── package.json
│   └── angular.json
│
└── docs/                           # Documentation
    ├── API.md                      # API reference
    ├── ARCHITECTURE.md             # System architecture
    ├── DATABASE.md                 # Database schema
    └── DEPLOYMENT.md               # Deployment guide
```

## Implementation Phases

The project is organized into 8 phases for systematic development:

1. **Project Initialization & Setup** - Directory structure, dependencies
2. **Database Design** - Models, schema, migrations
3. **MONEO API Integration** - Client, polling, data sync
4. **Backend Services** - Core business logic
5. **Frontend Implementation** - UI components, dashboards
6. **Additional Features** - Real-time updates, alerts, exports
7. **Testing Strategy** - Unit and integration tests
8. **Deployment** - Containerization and production setup

See [IMPLEMENTATION_INSTRUCTIONS.md](./IMPLEMENTATION_INSTRUCTIONS.md) for detailed instructions on each phase.

## Key Features

### Dashboard Management
- ✅ Create/Edit/Delete dashboards
- ✅ Public/Private dashboard sharing
- ✅ Favorite dashboards
- ✅ Dashboard templates

### Widgets & Visualizations
- ✅ Drag-and-drop widget positioning
- ✅ Responsive grid layout
- ✅ Multiple chart types (line, bar, gauge, etc.)
- ✅ Widget configuration panel
- ✅ Multi-sensor comparisons

### Sensor Management
- ✅ Browse all available sensors
- ✅ Sensor metadata and details
- ✅ Real-time sensor readings
- ✅ Historical data analysis
- ✅ Aggregated metrics (min, max, avg)

### Data Analysis
- ✅ Time-series data visualization
- ✅ Custom time range selection
- ✅ Data aggregation (hourly, daily, monthly)
- ✅ Trend detection
- ✅ Anomaly highlighting

### Advanced Features (Phase 6-7)
- ✅ Real-time WebSocket updates (optional)
- ✅ Alert configuration and notifications
- ✅ Data export (CSV, PDF)
- ✅ Automated report generation
- ✅ User management and RBAC
- ✅ Audit logging

## API Endpoints

### Dashboards
- `GET /api/dashboards` - List user dashboards
- `POST /api/dashboards` - Create dashboard
- `PUT /api/dashboards/{id}` - Update dashboard
- `DELETE /api/dashboards/{id}` - Delete dashboard

### Widgets
- `GET /api/dashboards/{id}/widgets` - List dashboard widgets
- `POST /api/dashboards/{id}/widgets` - Create widget
- `PUT /api/dashboards/{id}/widgets/{id}` - Update widget
- `DELETE /api/dashboards/{id}/widgets/{id}` - Delete widget
- `PUT /api/dashboards/{id}/widgets/layout` - Bulk update layout

### Sensors
- `GET /api/sensors` - List all sensors
- `GET /api/sensors/{id}/readings` - Get sensor readings (time range)
- `GET /api/sensors/{id}/aggregates` - Get aggregated metrics

### Analytics
- `GET /api/analytics/sensor-comparison` - Compare multiple sensors
- `GET /api/analytics/trends` - Get trend data
- `GET /api/analytics/anomalies` - Detect anomalies

See FastAPI Swagger documentation at `/docs` for complete API reference.

## Configuration

### Required Environment Variables
```env
# Database
DATABASE_URL=postgresql://user:password@localhost/moneo_monitoring

# MONEO API
MONEO_API_BASE_URL=https://ifm-ro-sales.w-eu.moneo.ifm/api/platform/v1
MONEO_API_KEY=your_api_key

# JWT
JWT_SECRET_KEY=your_secret_key

# Application
DEBUG=false
ALLOWED_ORIGINS=http://localhost:4200,http://localhost:3000
```

## Development Workflow

### Backend Development
```bash
cd backend
.venv\Scripts\activate
uvicorn main:app --reload --port 8000
```

### Frontend Development
```bash
cd frontend
npm start  # or ng serve
```

### Running Tests
```bash
# Backend tests
cd backend
pytest

# Frontend tests
cd frontend
npm test
```

### Code Quality
```bash
# Backend linting
pip install pylint
pylint backend/

# Frontend linting
npm run lint
```

## Deployment

### Using Docker
```bash
# Build backend image
docker build -t moneo-backend ./backend

# Build frontend image
docker build -t moneo-frontend ./frontend

# Run with docker-compose
docker-compose up
```

### Production Checklist
- [ ] Database migrations applied
- [ ] Environment variables configured
- [ ] SSL/TLS certificates installed
- [ ] CORS properly configured
- [ ] Monitoring and logging enabled
- [ ] Backup strategy in place
- [ ] Load balancer configured

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed deployment instructions.

## Testing

### Backend Unit Tests
```bash
cd backend
pytest tests/ -v
```

### Integration Tests
```bash
# With test database
pytest tests/ -v --integration
```

### Frontend Unit Tests
```bash
cd frontend
npm test
```

### E2E Tests
```bash
ng e2e
```

## Performance Considerations

1. **Database Optimization**
   - Indexes on `sensor_id`, `timestamp` for fast queries
   - Aggregated tables for historical data analysis
   - Connection pooling with SQLAlchemy

2. **Caching Strategy**
   - Redis caching for sensor metadata
   - Recent readings cached in-memory
   - Pre-calculated aggregates

3. **Frontend Optimization**
   - Lazy loading for dashboard modules
   - OnPush change detection strategy
   - Virtual scrolling for large tables
   - Chart rendering optimization

4. **API Performance**
   - Pagination for large result sets
   - Efficient query filtering
   - Async/await for non-blocking I/O

## Monitoring & Logging

- **Backend Logging**: Configure in `config.py` (console, file, external services)
- **Frontend Logging**: Console and error tracking (Sentry integration optional)
- **Metrics**: Prometheus integration for performance monitoring
- **Alerts**: Configure thresholds for sensor values

## Contributing

1. Follow the implementation instructions in order
2. Write tests for new features
3. Update API documentation
4. Use meaningful commit messages
5. Create pull requests for code review

## Reference Projects

This project is inspired by the FMC250 Vehicle Monitoring System. Key architectural patterns adapted:
- Dashboard and widget system design
- Grid-based layout management
- Time-series data visualization
- Analytics service architecture

**Reference**: `../fmc250-monitoring`

## Documentation

- [Implementation Instructions](./IMPLEMENTATION_INSTRUCTIONS.md) - Step-by-step development guide
- [API Documentation](./docs/API.md) - RESTful API reference
- [Architecture Guide](./docs/ARCHITECTURE.md) - System design and data flow
- [Database Schema](./docs/DATABASE.md) - Table definitions and relationships
- [Deployment Guide](./docs/DEPLOYMENT.md) - Production deployment procedures

## Support & Resources

- **MONEO API Documentation**: https://ifm-ro-sales.w-eu.moneo.ifm/api/platform/v1
- **FastAPI Guide**: https://fastapi.tiangolo.com/
- **Angular Documentation**: https://angular.io/docs
- **ApexCharts**: https://apexcharts.com/docs/
- **Angular-Gridster2**: https://tiberiuzuld.github.io/angular-gridster2/

## License

[Your License Here]

## Project Timeline

**Estimated Duration**: 4-5 months (16-21 weeks)

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Project structure & dependencies | ✅ Done |
| 2 | Database models (User, Dashboard, Widget, Sensor, Reading, Asset, Alert) | ✅ Done |
| 3 | MONEO API client + polling scheduler | ✅ Done |
| 4 | Backend services, Pydantic models, FastAPI routes | ✅ Done |
| 5 | Angular 21 frontend — dashboard, widgets, charts, sensors page | ✅ Done |
| 6 | JWT auth + WebSocket real-time streaming | ✅ Done |
| 7 | Backend unit tests (pytest, SQLite in-memory) | ✅ Done |
| 8 | Docker deployment config | ⏳ Pending |

---

**Assignment**: This entire project has been assigned to an AI agent following the [IMPLEMENTATION_INSTRUCTIONS.md](./IMPLEMENTATION_INSTRUCTIONS.md) file.

Start with Phase 1 and proceed systematically through all phases to build a complete, production-ready IFM MONEO sensor dashboard application.
