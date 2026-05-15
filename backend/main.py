import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic.config import Config as AlembicConfig
from alembic import command as alembic_command
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from DAL import SessionLocal
from routes.alert_routes import alert_router
from routes.auth_routes import auth_router
from routes.dashboard_routes import dashboard_router
from routes.widget_routes import widget_router
from routes.sensor_routes import sensor_router
from routes.analytics_routes import analytics_router
from routes.moneo_routes import moneo_router
from routes.websocket_routes import ws_router
from services.auth_service import AuthService
from services.demo_seed_service import seed_demo_data
from services.schedulers.data_polling_scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    if settings.auto_migrate:
        logger.info("Running Alembic migrations …")
        try:
            alembic_cfg = AlembicConfig(str(Path(__file__).parent / "alembic.ini"))
            alembic_command.upgrade(alembic_cfg, "head")
            logger.info("Alembic migrations complete.")
        except Exception:
            logger.exception("Alembic migration failed — aborting startup.")
            raise
    else:
        logger.info("auto_migrate=False — skipping migrations.")

    logger.info("Seeding admin user …")
    db = SessionLocal()
    try:
        AuthService().seed_admin(db)
        logger.info("Seeding demo data …")
        seed_demo_data(db)
    finally:
        db.close()

    logger.info("Starting polling scheduler …")
    # start_scheduler()

    # Attempt an immediate metadata sync so sensors are visible on first run
    # from services.moneo_poller import MoneoPoller
    # poller = MoneoPoller()
    # try:
    #     await poller.sync_sensor_metadata()
    # except Exception as e:
    #     logger.warning("Initial metadata sync failed (MONEO API may not be reachable): %s", e)
    # finally:
    #     await poller.close()

    yield  # application runs here

    # ── Shutdown ─────────────────────────────────────────────────────────────
    stop_scheduler()


app = FastAPI(
    title="MONEO Sensor Dashboard",
    description="IFM MONEO sensor monitoring and configurable dashboard",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(widget_router)
app.include_router(sensor_router)
app.include_router(analytics_router)
app.include_router(moneo_router)
app.include_router(ws_router)
app.include_router(alert_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="debug" if settings.debug else "info",
    )
