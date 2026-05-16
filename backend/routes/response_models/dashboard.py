from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


class DashboardWidgetBase(BaseModel):
    widget_type: str
    title: Optional[str] = None
    subtitle: Optional[str] = None
    x: int = 0
    y: int = 0
    cols: int = 6
    rows: int = 4
    settings: dict[str, Any] = Field(default_factory=dict)


class DashboardWidgetRead(DashboardWidgetBase):
    id: int
    dashboard_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DashboardRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    owner_id: int
    is_public: bool
    default_time_range_hours: Optional[int] = None
    default_from:             Optional[datetime] = None
    default_to:               Optional[datetime] = None
    auto_refresh_seconds:     Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    widgets: list[DashboardWidgetRead] = []

    model_config = {"from_attributes": True}


class DashboardCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_public: bool = False


class DashboardUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
    default_time_range_hours: Optional[int] = None
    default_from:             Optional[datetime] = None
    default_to:               Optional[datetime] = None
    auto_refresh_seconds:     Optional[int] = None


class DashboardWidgetCreate(BaseModel):
    widget_type: str
    title: Optional[str] = None
    subtitle: Optional[str] = None
    x: int = 0
    y: int = 0
    cols: int = 6
    rows: int = 4
    settings: dict[str, Any] = Field(default_factory=dict)


class DashboardWidgetUpdate(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    x: Optional[int] = None
    y: Optional[int] = None
    cols: Optional[int] = None
    rows: Optional[int] = None
    settings: Optional[dict[str, Any]] = None
