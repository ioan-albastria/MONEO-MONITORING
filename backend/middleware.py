from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from DAL import User, KioskToken, get_db
from services.auth_service import AuthService

_bearer = HTTPBearer()
_auth_service = AuthService()


@dataclass
class KioskPrincipal:
    """Synthetic principal returned by get_current_user for kiosk JWTs.
    Has the same attribute interface as User for role-checking and UserRead serialisation."""
    id: int = 0
    username: str = 'kiosk'
    email: str = ''
    is_active: bool = True
    role: str = 'kiosk'
    is_kiosk: bool = True
    kiosk_dashboard_ids: list = dc_field(default_factory=list)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
):
    token = credentials.credentials
    try:
        payload = _auth_service.decode_token(token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ── Kiosk token path ─────────────────────────────────────────────────────
    kiosk_token_id = payload.get("kiosk_token_id")
    if kiosk_token_id is not None:
        kt = db.get(KioskToken, kiosk_token_id)
        if not kt or not kt.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Kiosk token revoked or not found",
            )
        if kt.expires_at and kt.expires_at < datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Kiosk token expired",
            )
        return KioskPrincipal(
            kiosk_dashboard_ids=list(kt.dashboard_ids or []),
        )

    # ── Regular user path ────────────────────────────────────────────────────
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


def requires_role(*roles: str) -> Callable:
    """Dependency factory — restricts an endpoint to users with one of the given roles."""
    async def _check(current_user=Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role",
            )
        return current_user

    return _check


def require_admin(current_user=Depends(get_current_user)) -> User:
    """Restrict an endpoint to the built-in 'admin' account.

    Uses a username string comparison intentionally — there is no ``is_admin``
    column on the User model.  See backend/CLAUDE.md → Gotchas for the design
    rationale.  Do not replace this with a role check.
    """
    if current_user.username != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin only",
        )
    return current_user
