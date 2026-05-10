from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from DAL import get_db
from middleware import get_current_user
from routes.response_models.auth import LoginRequest, TokenResponse, UserRead
from services.auth_service import AuthService

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])
_service = AuthService()


@auth_router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = _service.authenticate_user(db, payload.username, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    token = _service.create_access_token(user.id)
    return TokenResponse(access_token=token)


@auth_router.get("/me", response_model=UserRead)
async def get_me(current_user=Depends(get_current_user)):
    return UserRead.model_validate(current_user)
