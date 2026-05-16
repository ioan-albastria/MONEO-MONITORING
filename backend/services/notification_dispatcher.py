"""Outbox dispatcher — drains alert_notification_outbox.

Runs every 30 seconds via APScheduler.
Channels:
  in_app   — no-op (the alert_event itself is the notification; frontend polls)
  email    — aiosmtplib SMTP
  webhook  — httpx POST with HMAC-SHA256 signature header
"""
import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone

import httpx

from config import settings
from DAL import SessionLocal
from DAL.models.alert_notification_outbox import AlertNotificationOutbox

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


async def dispatch_outbox() -> None:
    if not settings.notification_dispatch_enabled:
        return

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        pending = (
            db.query(AlertNotificationOutbox)
            .filter(
                AlertNotificationOutbox.status == "pending",
                AlertNotificationOutbox.next_attempt_at <= now,
            )
            .limit(50)
            .all()
        )

        for entry in pending:
            try:
                await _dispatch_one(entry)
                entry.status = "sent"
                entry.sent_at = datetime.now(timezone.utc)
            except Exception as exc:
                logger.warning("Dispatch failed for outbox %s: %s", entry.id, exc)
                entry.attempts += 1
                entry.last_error = str(exc)[:500]
                if entry.attempts >= MAX_ATTEMPTS:
                    entry.status = "failed"
                else:
                    # Exponential back-off: 1m, 2m, 4m, 8m
                    from datetime import timedelta
                    backoff = 60 * (2 ** entry.attempts)
                    entry.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=backoff)
        db.commit()
    finally:
        db.close()


async def _dispatch_one(entry: AlertNotificationOutbox) -> None:
    channel = entry.channel or "in_app"

    if channel == "in_app":
        return  # in-app channel is handled by the frontend polling /api/alerts/events/active

    elif channel == "email":
        await _send_email(entry)

    elif channel == "webhook":
        await _send_webhook(entry)

    else:
        raise ValueError(f"Unknown channel: {channel}")


async def _send_email(entry: AlertNotificationOutbox) -> None:
    try:
        import aiosmtplib
        from email.message import EmailMessage
    except ImportError:
        logger.warning("aiosmtplib not installed — skipping email dispatch")
        return

    payload = entry.payload
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = entry.target
    msg["Subject"] = payload.get("subject", "MONEO Alert")
    msg.set_content(payload.get("body", json.dumps(payload, indent=2)))

    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username or None,
        password=settings.smtp_password or None,
        start_tls=settings.smtp_tls,
    )


async def _send_webhook(entry: AlertNotificationOutbox) -> None:
    body_bytes = json.dumps(entry.payload).encode()
    sig = hmac.new(
        settings.webhook_hmac_secret.encode(),
        body_bytes,
        hashlib.sha256,
    ).hexdigest()

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            entry.target,
            content=body_bytes,
            headers={
                "Content-Type": "application/json",
                "X-MONEO-Signature": f"sha256={sig}",
            },
        )
        resp.raise_for_status()
