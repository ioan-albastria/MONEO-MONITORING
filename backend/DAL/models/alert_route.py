from datetime import datetime, timezone
from typing import Any
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from DAL.db_context import Base


class AlertRoute(Base):
    __tablename__ = "alert_route"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    channel: Mapped[str] = mapped_column(String(30), nullable=False)    # 'email' | 'webhook' | etc.
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    filter_tiers: Mapped[list | None] = mapped_column(ARRAY(String), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    outbox_entries = relationship("AlertNotificationOutbox", back_populates="route", cascade="all, delete-orphan")
