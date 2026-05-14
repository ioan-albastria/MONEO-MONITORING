from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from DAL.db_context import Base


class Sensor(Base):
    __tablename__ = "sensors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    moneo_sensor_id: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    sensor_type: Mapped[str] = mapped_column(String, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    asset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    extra_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # ── Slice 1 additions ──────────────────────────────────────────────────
    expected_poll_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    normal_min:   Mapped[float | None] = mapped_column(Float, nullable=True)
    normal_max:   Mapped[float | None] = mapped_column(Float, nullable=True)
    warning_min:  Mapped[float | None] = mapped_column(Float, nullable=True)
    warning_max:  Mapped[float | None] = mapped_column(Float, nullable=True)
    critical_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    critical_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    ranges_source: Mapped[str] = mapped_column(String(20), nullable=False, server_default="manual")

    readings = relationship("SensorReading", back_populates="sensor", cascade="all, delete-orphan")
