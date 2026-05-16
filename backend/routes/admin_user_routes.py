from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.user import User
from middleware import requires_role
from routes.response_models.auth import UserAdminRead

admin_user_router = APIRouter(prefix="/api/admin/users", tags=["admin"])

VALID_ROLES = ("viewer", "operator", "admin")


class UserRoleUpdate(BaseModel):
    role: Literal["viewer", "operator", "admin"]


@admin_user_router.get("", response_model=list[UserAdminRead])
async def list_users(
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    return db.query(User).order_by(User.created_at.asc()).all()


@admin_user_router.patch("/{user_id}/role", response_model=UserAdminRead)
async def change_user_role(
    user_id: int,
    body: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    if hasattr(current_user, 'id') and current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = body.role
    db.commit()
    db.refresh(user)
    return user
