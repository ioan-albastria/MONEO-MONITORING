from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AlertRuleCreate(BaseModel):
    sensor_id: int
    name: str
    description: Optional[str] = None
    condition: str
    threshold_lo: Optional[float] = None
    threshold_hi: Optional[float] = None
    recovery_lo: Optional[float] = None
    recovery_hi: Optional[float] = None
    severity: str = "warning"
    dwell_seconds: int = 60
    no_data_seconds: Optional[int] = None
    recovery_dwell_seconds: int = 30
    policy: str = "auto_clear"
    is_enabled: bool = True


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    condition: Optional[str] = None
    threshold_lo: Optional[float] = None
    threshold_hi: Optional[float] = None
    recovery_lo: Optional[float] = None
    recovery_hi: Optional[float] = None
    severity: Optional[str] = None
    dwell_seconds: Optional[int] = None
    no_data_seconds: Optional[int] = None
    recovery_dwell_seconds: Optional[int] = None
    policy: Optional[str] = None
    is_enabled: Optional[bool] = None


class AlertRuleRead(BaseModel):
    id: int
    sensor_id: int
    name: str
    description: Optional[str] = None
    condition: str
    threshold_lo: Optional[float] = None
    threshold_hi: Optional[float] = None
    recovery_lo: Optional[float] = None
    recovery_hi: Optional[float] = None
    severity: str
    dwell_seconds: int
    no_data_seconds: Optional[int] = None
    recovery_dwell_seconds: int
    policy: str
    is_enabled: bool
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AlertEventRead(BaseModel):
    id: int
    rule_id: int
    sensor_id: int
    state: str
    observed_value: Optional[float] = None
    observed_at: datetime
    acknowledged_by: Optional[int] = None
    acknowledged_at: Optional[datetime] = None
    note: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
