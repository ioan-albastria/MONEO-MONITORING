from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


class WidgetRead(BaseModel):
    id: int
    dashboard_id: int
    widget_type: str
    title: Optional[str] = None
    subtitle: Optional[str] = None
    x: int
    y: int
    cols: int
    rows: int
    settings: dict[str, Any]
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
