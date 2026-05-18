from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.user import User
from middleware import requires_role
from routes.response_models.auth import UserAdminRead
from services.auth_service import AuthService

admin_user_router = APIRouter(prefix="/api/admin/users", tags=["admin"])


class UserRoleUpdate(BaseModel):
    role: Literal["viewer", "operator", "admin"]


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: Literal["viewer", "operator", "admin"] = "viewer"


class UserUpdate(BaseModel):
    username: str | None = None
    email: EmailStr | None = None
    role: Literal["viewer", "operator", "admin"] | None = None
    is_active: bool | None = None
    password: str | None = None


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@admin_user_router.get("", response_model=list[UserAdminRead])
async def list_users(
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    return db.query(User).order_by(User.created_at.asc()).all()


@admin_user_router.post("", response_model=UserAdminRead, status_code=201)
async def create_user(
    body: UserCreate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already exists")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="Email already exists")
    user = User(
        username=body.username,
        email=body.email,
        hashed_password=AuthService.hash_password(body.password),
        role=body.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@admin_user_router.patch("/{user_id}", response_model=UserAdminRead)
async def update_user(
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    user = _get_user_or_404(db, user_id)
    if body.username is not None and body.username != user.username:
        if db.query(User).filter(User.username == body.username).first():
            raise HTTPException(status_code=409, detail="Username already exists")
        user.username = body.username
    if body.email is not None and body.email != user.email:
        if db.query(User).filter(User.email == body.email).first():
            raise HTTPException(status_code=409, detail="Email already exists")
        user.email = body.email
    if body.role is not None:
        if current_user.id == user_id:
            raise HTTPException(status_code=400, detail="Cannot change your own role")
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        user.hashed_password = AuthService.hash_password(body.password)
    db.commit()
    db.refresh(user)
    return user


@admin_user_router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = _get_user_or_404(db, user_id)
    db.delete(user)
    db.commit()


@admin_user_router.patch("/{user_id}/role", response_model=UserAdminRead)
async def change_user_role(
    user_id: int,
    body: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    user = _get_user_or_404(db, user_id)
    user.role = body.role
    db.commit()
    db.refresh(user)
    return user
