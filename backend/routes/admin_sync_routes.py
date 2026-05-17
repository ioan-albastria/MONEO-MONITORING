from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from DAL import User, get_db
from middleware import get_current_user
from services.sync_health_service import SyncHealthService

admin_sync_router = APIRouter(prefix="/api/admin/sync", tags=["admin"])


@admin_sync_router.get("/health")
def get_sync_health(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return sync health for each MONEO source. Admin only."""
    if current_user.username != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin only"
        )
    return SyncHealthService().get_health(db)
