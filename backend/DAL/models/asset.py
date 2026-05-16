from datetime import datetime, timezone
from typing import TYPE_CHECKING
from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from DAL.db_context import Base

if TYPE_CHECKING:
    from DAL.models.sensor import Sensor


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    moneo_asset_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    extra_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # ── Slice 6: hierarchy ────────────────────────────────────────────────
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False, server_default="machine")
    path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Self-referential relationships
    parent: Mapped["Asset | None"] = relationship(
        "Asset", remote_side="Asset.id", back_populates="children", lazy="select"
    )
    children: Mapped[list["Asset"]] = relationship(
        "Asset", back_populates="parent", lazy="select"
    )
    sensors: Mapped[list["Sensor"]] = relationship(
        "Sensor", back_populates="asset", lazy="select"
    )
