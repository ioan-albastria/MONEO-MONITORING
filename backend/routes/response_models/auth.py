from typing import Optional
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserRead(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    is_kiosk: bool = False
    kiosk_dashboard_ids: list[int] = []

    model_config = {"from_attributes": True}
