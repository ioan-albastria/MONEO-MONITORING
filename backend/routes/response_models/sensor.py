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

    model_config = {"from_attributes": True}


class SensorReadingRead(BaseModel):
    id: int
    sensor_id: int
    value: float
    timestamp: datetime
    status: str

    model_config = {"from_attributes": True}
