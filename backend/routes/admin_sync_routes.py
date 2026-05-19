from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from DAL import User, get_db
from middleware import require_admin
from services.sync_health_service import SyncHealthService

admin_sync_router = APIRouter(prefix="/api/admin/sync", tags=["admin"])


@admin_sync_router.get("/health")
def get_sync_health(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Return sync health for each MONEO source. Admin only."""
    return SyncHealthService().get_health(db)
