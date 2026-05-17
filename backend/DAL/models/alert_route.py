from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from DAL.db_context import Base


class AlertRoute(Base):
    __tablename__ = "alert_route"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scope_severity: Mapped[str | None] = mapped_column(String(10), nullable=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    target: Mapped[str] = mapped_column(Text, nullable=False)
    on_fire: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    on_recover: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    outbox_entries = relationship("AlertNotificationOutbox", back_populates="route", cascade="all, delete-orphan")
