from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from DAL.db_context import Base


class Dashboard(Base):
    __tablename__ = "dashboards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    default_time_range_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_from:             Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    default_to:               Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auto_refresh_seconds:     Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    widgets = relationship("DashboardWidget", back_populates="dashboard", cascade="all, delete-orphan")
    owner = relationship("User", back_populates="dashboards")
