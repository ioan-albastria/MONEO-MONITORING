from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.kiosk_token import KioskToken
from middleware import requires_role
from services.auth_service import AuthService

admin_kiosk_router = APIRouter(prefix="/api/admin/kiosk-tokens", tags=["admin"])
_auth = AuthService()


class KioskTokenCreate(BaseModel):
    dashboard_ids: list[int]
    label: Optional[str] = None
    expires_days: int = 365    # days until expiry; 0 = never expires


class KioskTokenRead(BaseModel):
    id: int
    dashboard_ids: list[int]
    label: Optional[str]
    expires_at: Optional[datetime]
    is_active: bool
    created_at: datetime
    token: Optional[str] = None  # Only included on creation response


class KioskTokenRevoke(BaseModel):
    pass   # no body needed


@admin_kiosk_router.post("", response_model=KioskTokenRead)
async def create_kiosk_token(
    body: KioskTokenCreate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    expires_at = (
        None if body.expires_days == 0
        else datetime.now(timezone.utc) + timedelta(days=body.expires_days)
    )
    kt = KioskToken(
        dashboard_ids=body.dashboard_ids,
        label=body.label,
        expires_at=expires_at,
        created_by=current_user.id if hasattr(current_user, 'id') and current_user.id else None,
        is_active=True,
    )
    db.add(kt)
    db.flush()   # get kt.id
    token_jwt = _auth.create_kiosk_token(
        kt.id,
        expires_at or datetime.now(timezone.utc) + timedelta(days=3650),
    )
    db.commit()
    db.refresh(kt)
    return KioskTokenRead(
        id=kt.id,
        dashboard_ids=kt.dashboard_ids,
        label=kt.label,
        expires_at=kt.expires_at,
        is_active=kt.is_active,
        created_at=kt.created_at,
        token=token_jwt,
    )


@admin_kiosk_router.get("", response_model=list[KioskTokenRead])
async def list_kiosk_tokens(
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    tokens = db.query(KioskToken).order_by(KioskToken.created_at.desc()).all()
    return [
        KioskTokenRead(
            id=kt.id, dashboard_ids=kt.dashboard_ids, label=kt.label,
            expires_at=kt.expires_at, is_active=kt.is_active, created_at=kt.created_at,
        )
        for kt in tokens
    ]


@admin_kiosk_router.delete("/{token_id}", status_code=204)
async def revoke_kiosk_token(
    token_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    kt = db.get(KioskToken, token_id)
    if not kt:
        raise HTTPException(status_code=404, detail="Kiosk token not found")
    kt.is_active = False
    db.commit()
