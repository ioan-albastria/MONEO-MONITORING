from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from DAL import get_db
from middleware import get_current_user
from routes.response_models.dashboard import (
    DashboardCreate,
    DashboardRead,
    DashboardUpdate,
    DashboardWidgetCreate,
    DashboardWidgetRead,
    DashboardWidgetUpdate,
)
from services.dashboard_service import DashboardService

dashboard_router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])
_service = DashboardService()


@dashboard_router.get("", response_model=list[DashboardRead])
async def get_user_dashboards(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _service.get_user_dashboards(db, current_user.id)


@dashboard_router.get("/public", response_model=list[DashboardRead])
async def get_public_dashboards(db: Session = Depends(get_db)):
    return _service.get_public_dashboards(db)


@dashboard_router.get("/{dashboard_id}", response_model=DashboardRead)
async def get_dashboard(
    dashboard_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _service.get_dashboard(db, dashboard_id, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@dashboard_router.post("", response_model=DashboardRead, status_code=status.HTTP_201_CREATED)
async def create_dashboard(
    payload: DashboardCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _service.create_dashboard(db, current_user.id, payload)


@dashboard_router.put("/{dashboard_id}", response_model=DashboardRead)
async def update_dashboard(
    dashboard_id: int,
    payload: DashboardUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _service.update_dashboard(db, current_user.id, dashboard_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@dashboard_router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard(
    dashboard_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        _service.delete_dashboard(db, current_user.id, dashboard_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# ── Widget sub-routes ──────────────────────────────────────────────────────

@dashboard_router.post("/{dashboard_id}/widgets", response_model=DashboardWidgetRead, status_code=status.HTTP_201_CREATED)
async def add_widget(
    dashboard_id: int,
    payload: DashboardWidgetCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _service.add_widget(db, current_user.id, dashboard_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@dashboard_router.post("/{dashboard_id}/layout", status_code=status.HTTP_204_NO_CONTENT)
async def save_layout(
    dashboard_id: int,
    layout: list[dict],
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        _service.save_layout(db, current_user.id, dashboard_id, layout)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
