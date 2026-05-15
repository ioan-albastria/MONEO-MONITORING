from datetime import datetime, timezone
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from DAL.db_context import Base


class AlertEvent(Base):
    __tablename__ = "alert_event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rule_id: Mapped[int] = mapped_column(
        ForeignKey("alert_rule.id", ondelete="CASCADE"), nullable=False
    )
    sensor_id: Mapped[int] = mapped_column(
        ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False
    )
    reading_id: Mapped[int | None] = mapped_column(
        ForeignKey("sensor_readings.id", ondelete="SET NULL"), nullable=True
    )
    tier: Mapped[str] = mapped_column(String(20), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    triggered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    rule = relationship("AlertRule", back_populates="events")
    sensor = relationship("Sensor")
    outbox_entries = relationship("AlertNotificationOutbox", back_populates="event", cascade="all, delete-orphan")
