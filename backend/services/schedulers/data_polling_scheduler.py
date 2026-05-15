import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import settings
from services.moneo_poller import MoneoPoller
from services.schedulers.alert_no_data_scheduler import check_no_data_alerts

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()
_poller = MoneoPoller()


def start_scheduler():
    interval = settings.sensor_poll_interval_seconds

    _scheduler.add_job(
        _poller.poll_latest_readings,
        trigger="interval",
        seconds=interval,
        id="poll_sensor_readings",
        replace_existing=True,
    )

    # Run a metadata sync once at startup and then every 6 hours
    _scheduler.add_job(
        _poller.sync_sensor_metadata,
        trigger="interval",
        hours=6,
        id="sync_sensor_metadata",
        replace_existing=True,
    )

    _scheduler.add_job(
        check_no_data_alerts,
        trigger="interval",
        seconds=60,
        id="check_no_data_alerts",
        replace_existing=True,
    )

    # _scheduler.start()
    logger.info("Polling scheduler started (interval=%ds)", interval)


def stop_scheduler():
    _scheduler.shutdown(wait=False)
    logger.info("Polling scheduler stopped")
