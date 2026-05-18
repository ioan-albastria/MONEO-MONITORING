from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from DAL.db_context import Base
from DAL.models._mixins import TimestampMixin


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, server_default="viewer")

    dashboards = relationship("Dashboard", back_populates="owner")

    @property
    def is_kiosk(self) -> bool:
        return False

    @property
    def kiosk_dashboard_ids(self) -> list:
        return []
