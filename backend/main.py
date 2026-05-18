import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic.config import Config as AlembicConfig
from alembic import command as alembic_command
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from DAL import session_scope
from routes.admin_kiosk_routes import admin_kiosk_router
from routes.admin_user_routes import admin_user_router
from routes.alert_routes import alert_router
from routes.annotation_routes import annotation_router
from routes.asset_routes import asset_router
from routes.auth_routes import auth_router
from routes.dashboard_routes import dashboard_router
from routes.widget_routes import widget_router
from routes.sensor_routes import sensor_router
from routes.analytics_routes import analytics_router
from routes.admin_debug_routes import admin_debug_router
from routes.admin_sync_routes import admin_sync_router
from routes.moneo_routes import moneo_router
from routes.websocket_routes import ws_router
from services.auth_service import AuthService
from services.demo_seed_service import seed_demo_data
from services.moneo_api_client import MoneoApiClient
from services.schedulers.data_polling_scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# Bounded so a slow/unreachable upstream cannot block FastAPI startup.
_MONEO_PROBE_TIMEOUT_SECONDS = 5


def _run_migrations() -> None:
    if not settings.auto_migrate:
        logger.info("auto_migrate=False — skipping migrations.")
        return
    logger.info("Running Alembic migrations …")
    # fileConfig in migrations/env.py resets the root logger (clears handlers, sets
    # level to WARN). Save state before and restore after so the app's logging config
    # survives the migration run.
    root = logging.getLogger()
    saved_level = root.level
    saved_handlers = root.handlers[:]
    try:
        alembic_cfg = AlembicConfig(str(Path(__file__).parent / "alembic.ini"))
        alembic_command.upgrade(alembic_cfg, "head")
        logger.info("Alembic migrations complete.")
    except Exception:
        logger.exception("Alembic migration failed — aborting startup.")
        raise
    finally:
        root.handlers[:] = []
        for h in saved_handlers:
            root.addHandler(h)
        root.setLevel(saved_level)


def _seed_initial_data() -> None:
    logger.info("Seeding admin user …")
    with session_scope() as db:
        AuthService().seed_admin(db)
        logger.info("Seeding demo data …")
        seed_demo_data(db)


async def _probe_moneo_auth() -> None:
    # Best-effort boot-time auth probe — logs OK or FAILED; never blocks startup.
    try:
        client = MoneoApiClient()
        try:
            result = await asyncio.wait_for(
                client.verify_auth(), timeout=_MONEO_PROBE_TIMEOUT_SECONDS
            )
        finally:
            await client.close()
        if result["ok"]:
            logger.info(result["message"])
        else:
            logger.error(result["message"])
    except Exception as e:
        logger.error("MONEO auth probe crashed: %s", e)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _run_migrations()
    _seed_initial_data()
    logger.info("Starting polling scheduler …")
    start_scheduler()
    await _probe_moneo_auth()

    yield

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
app.include_router(admin_debug_router)
app.include_router(admin_sync_router)
app.include_router(ws_router)
app.include_router(alert_router)
app.include_router(annotation_router)
app.include_router(asset_router)
app.include_router(admin_kiosk_router)
app.include_router(admin_user_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="debug" if settings.debug else "info",
    )
