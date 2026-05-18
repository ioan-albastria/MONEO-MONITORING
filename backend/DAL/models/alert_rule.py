from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from DAL.db_context import Base
from DAL.models._mixins import TimestampMixinTZ


class AlertRule(TimestampMixinTZ, Base):
    __tablename__ = "alert_rule"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sensor_id: Mapped[int] = mapped_column(
        ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition: Mapped[str] = mapped_column(String(20), nullable=False)
    threshold_lo: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold_hi: Mapped[float | None] = mapped_column(Float, nullable=True)
    recovery_lo: Mapped[float | None] = mapped_column(Float, nullable=True)
    recovery_hi: Mapped[float | None] = mapped_column(Float, nullable=True)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    dwell_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    no_data_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recovery_dwell_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    policy: Mapped[str] = mapped_column(String(20), nullable=False, default="auto_clear")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    sensor = relationship("Sensor")
    state = relationship("AlertState", back_populates="rule", uselist=False, cascade="all, delete-orphan")
    events = relationship("AlertEvent", back_populates="rule", cascade="all, delete-orphan")
