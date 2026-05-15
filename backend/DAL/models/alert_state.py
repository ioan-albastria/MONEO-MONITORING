from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from DAL.db_context import Base


class AlertState(Base):
    __tablename__ = "alert_state"

    rule_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("alert_rule.id", ondelete="CASCADE"), primary_key=True
    )
    current_state: Mapped[str] = mapped_column(String(20), nullable=False)
    state_since: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_value_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    flap_count_10m: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_flapping: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    rule = relationship("AlertRule", back_populates="state")
