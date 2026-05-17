from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text
# Primary key uses Integer for SQLite autoincrement compatibility; sync_run_id FK
# uses Integer to match SyncRun.id type.
from sqlalchemy.orm import Mapped, mapped_column, relationship

from DAL.db_context import Base

if TYPE_CHECKING:
    from DAL.models.sync_run import SyncRun

# All valid values for the `kind` column. Not a DB enum so new kinds can be
# added without a migration.
SYNC_ERROR_KINDS = (
    "http_401",       # upstream rejected the token
    "http_5xx",       # upstream server error after retries exhausted
    "http_other",     # any other unexpected HTTP status
    "parse",          # couldn't parse upstream payload
    "max_pages_cap",  # backfill hit the per-sensor page cap
    "sensor_skipped", # missing asset / moneo_datasource_ref
    "unknown",        # exception not matched above
)


class SyncError(Base):
    __tablename__ = "sync_errors"
    __table_args__ = (
        Index("ix_sync_errors_run", "sync_run_id"),
        Index("ix_sync_errors_sensor_kind", "sensor_id", "kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sync_run_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("sync_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    sensor_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("sensors.id", ondelete="SET NULL"),
        nullable=True,
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    run: Mapped["SyncRun"] = relationship("SyncRun", back_populates="errors")
