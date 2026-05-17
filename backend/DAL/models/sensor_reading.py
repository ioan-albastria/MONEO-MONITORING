from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Index, Integer, Float, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from DAL.db_context import Base


class SensorReading(Base):
    __tablename__ = "sensor_readings"
    __table_args__ = (
        Index("idx_sensor_timestamp", "sensor_id", "timestamp"),
        Index("idx_timestamp", "timestamp"),
        UniqueConstraint("sensor_id", "timestamp", name="uq_sensor_reading_sensor_timestamp"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sensor_id: Mapped[int] = mapped_column(
        ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, default="ok")

    sensor = relationship("Sensor", back_populates="readings")
