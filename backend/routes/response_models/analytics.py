from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


class TimeSeriesPoint(BaseModel):
    timestamp: str
    value: float


class SensorTimeSeriesData(BaseModel):
    sensor_id: int
    sensor_name: str
    unit: str
    points: list[TimeSeriesPoint]
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    avg_value: Optional[float] = None


class AnalyticsResponse(BaseModel):
    generated_at: datetime
    range_start: datetime
    range_end: datetime
    data: list[SensorTimeSeriesData]
