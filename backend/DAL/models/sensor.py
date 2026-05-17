from datetime import datetime, timezone
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from DAL.db_context import Base

if TYPE_CHECKING:
    from DAL.models.asset import Asset


class Sensor(Base):
    __tablename__ = "sensors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    moneo_sensor_id: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    # The deep reference.dataSource.id from /nodes — required by /processdata.
    # Distinct from moneo_sensor_id, which is the topology node id (our stable public handle).
    moneo_datasource_ref: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    sensor_type: Mapped[str] = mapped_column(String, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    asset_id: Mapped[int | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True
    )
    asset: Mapped["Asset | None"] = relationship("Asset", back_populates="sensors", lazy="select")
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

    @property
    def asset_path(self) -> str | None:
        """Hierarchical path including the sensor name, e.g. 'Plant A / Line 3 / temp'.
        Returns None if the sensor has no assigned asset.
        Requires the `asset` relationship to be loaded (use joinedload in queries).
        """
        if self.asset and self.asset.path:
            return f"{self.asset.path} / {self.name}"
        return None
