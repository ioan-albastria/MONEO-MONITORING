from typing import Optional
from pydantic import BaseModel


class AssetRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    kind: str
    parent_id: Optional[int] = None
    path: Optional[str] = None
    location: Optional[str] = None

    model_config = {"from_attributes": True}


class AssetNodeRead(BaseModel):
    """Recursive tree node — children populated from the ORM relationship."""
    id: int
    name: str
    kind: str
    parent_id: Optional[int] = None
    path: Optional[str] = None
    description: Optional[str] = None
    children: list["AssetNodeRead"] = []

    model_config = {"from_attributes": True}


AssetNodeRead.model_rebuild()  # required for self-referential model


class AssetCreate(BaseModel):
    name: str
    kind: str = "machine"
    parent_id: Optional[int] = None
    description: Optional[str] = None


class AssetUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    parent_id: Optional[int] = None
    description: Optional[str] = None
