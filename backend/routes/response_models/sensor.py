from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SensorRead(BaseModel):
    id: int
    moneo_sensor_id: str
    name: str
    description: Optional[str] = None
    sensor_type: str
    unit: str
    asset_id: Optional[int] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    is_active: bool
    created_at: datetime
    expected_poll_seconds: Optional[int] = None
    last_seen_at: Optional[datetime] = None
    # ── Slice 2: range bounds (read-only consumers see all tiers) ──────────
    normal_min:    Optional[float] = None
    normal_max:    Optional[float] = None
    warning_min:   Optional[float] = None
    warning_max:   Optional[float] = None
    critical_min:  Optional[float] = None
    critical_max:  Optional[float] = None
    ranges_source: str = "manual"
    asset_path: Optional[str] = None
    has_readings: bool = False

    model_config = {"from_attributes": True}


class SensorRangesUpdate(BaseModel):
    """Payload for PUT /api/sensors/{id}/ranges — operator/admin only."""
    normal_min:    Optional[float] = None
    normal_max:    Optional[float] = None
    warning_min:   Optional[float] = None
    warning_max:   Optional[float] = None
    critical_min:  Optional[float] = None
    critical_max:  Optional[float] = None
    ranges_source: str = "manual"


class SensorReadingRead(BaseModel):
    id: int
    sensor_id: int
    value: float
    timestamp: datetime
    status: str

    model_config = {"from_attributes": True}
