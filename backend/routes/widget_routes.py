from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from DAL import get_db
from middleware import get_current_user
from routes.response_models.dashboard import DashboardWidgetRead, DashboardWidgetUpdate
from services.dashboard_service import DashboardService

widget_router = APIRouter(prefix="/api/widgets", tags=["widgets"])
_service = DashboardService()


@widget_router.put("/{widget_id}", response_model=DashboardWidgetRead)
async def update_widget(
    widget_id: int,
    payload: DashboardWidgetUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _service.update_widget(db, current_user.id, widget_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@widget_router.delete("/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_widget(
    widget_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        _service.delete_widget(db, current_user.id, widget_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
