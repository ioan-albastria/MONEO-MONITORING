from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from DAL import get_db
from middleware import get_current_user
from routes._shared import _not_found_on_value_error
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
    with _not_found_on_value_error():
        return _service.update_widget(db, current_user.id, widget_id, payload)


@widget_router.delete("/{widget_id}", status_code=204)
async def delete_widget(
    widget_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with _not_found_on_value_error():
        _service.delete_widget(db, current_user.id, widget_id)
