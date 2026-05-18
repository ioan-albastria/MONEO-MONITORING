from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from DAL.db_context import Base
from DAL.models._mixins import CreatedAtMixinTZ


class KioskToken(CreatedAtMixinTZ, Base):
    __tablename__ = 'kiosk_tokens'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dashboard_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
