from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session, selectinload

from DAL import Dashboard, DashboardWidget
from routes.response_models.dashboard import (
    DashboardCreate,
    DashboardRead,
    DashboardUpdate,
    DashboardWidgetCreate,
    DashboardWidgetRead,
    DashboardWidgetUpdate,
)


class DashboardService:

    def get_user_dashboards(self, db: Session, user_id: int) -> list[DashboardRead]:
        rows = (
            db.query(Dashboard)
            .options(selectinload(Dashboard.widgets))
            .filter(Dashboard.owner_id == user_id)
            .order_by(Dashboard.updated_at.desc(), Dashboard.id.desc())
            .all()
        )
        return [DashboardRead.model_validate(d) for d in rows]

    def get_public_dashboards(self, db: Session) -> list[DashboardRead]:
        rows = (
            db.query(Dashboard)
            .options(selectinload(Dashboard.widgets))
            .filter(Dashboard.is_public == True)
            .order_by(Dashboard.updated_at.desc(), Dashboard.id.desc())
            .all()
        )
        return [DashboardRead.model_validate(d) for d in rows]

    def get_dashboard(self, db: Session, dashboard_id: int, user_id: int) -> DashboardRead:
        dashboard = self._get_accessible_dashboard(db, dashboard_id, user_id)
        return DashboardRead.model_validate(dashboard)

    def create_dashboard(self, db: Session, user_id: int, payload: DashboardCreate) -> DashboardRead:
        dashboard = Dashboard(
            name=payload.name.strip(),
            description=payload.description,
            owner_id=user_id,
            is_public=payload.is_public,
        )
        db.add(dashboard)
        db.commit()
        db.refresh(dashboard)
        return DashboardRead.model_validate(dashboard)

    def update_dashboard(
        self, db: Session, user_id: int, dashboard_id: int, payload: DashboardUpdate
    ) -> DashboardRead:
        dashboard = self._get_owned_dashboard(db, dashboard_id, user_id)
        if payload.name is not None:
            dashboard.name = payload.name.strip()
        if payload.description is not None:
            dashboard.description = payload.description
        if payload.is_public is not None:
            dashboard.is_public = payload.is_public
        dashboard.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(dashboard)
        return DashboardRead.model_validate(dashboard)

    def delete_dashboard(self, db: Session, user_id: int, dashboard_id: int) -> None:
        dashboard = self._get_owned_dashboard(db, dashboard_id, user_id)
        db.delete(dashboard)
        db.commit()

    # ── Widget helpers ──────────────────────────────────────────────────────

    def add_widget(
        self, db: Session, user_id: int, dashboard_id: int, payload: DashboardWidgetCreate
    ) -> DashboardWidgetRead:
        self._get_owned_dashboard(db, dashboard_id, user_id)
        widget = DashboardWidget(dashboard_id=dashboard_id, **payload.model_dump())
        db.add(widget)
        db.commit()
        db.refresh(widget)
        return DashboardWidgetRead.model_validate(widget)

    def update_widget(
        self, db: Session, user_id: int, widget_id: int, payload: DashboardWidgetUpdate
    ) -> DashboardWidgetRead:
        widget = self._get_owned_widget(db, widget_id, user_id)
        for field, value in payload.model_dump(exclude_none=True).items():
            setattr(widget, field, value)
        widget.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(widget)
        return DashboardWidgetRead.model_validate(widget)

    def delete_widget(self, db: Session, user_id: int, widget_id: int) -> None:
        widget = self._get_owned_widget(db, widget_id, user_id)
        db.delete(widget)
        db.commit()

    def save_layout(self, db: Session, user_id: int, dashboard_id: int, layout: list[dict]) -> None:
        """Bulk-update widget positions from a gridster layout snapshot."""
        self._get_owned_dashboard(db, dashboard_id, user_id)
        for item in layout:
            widget = db.query(DashboardWidget).filter(
                DashboardWidget.id == item["id"],
                DashboardWidget.dashboard_id == dashboard_id,
            ).first()
            if widget:
                widget.x = item.get("x", widget.x)
                widget.y = item.get("y", widget.y)
                widget.cols = item.get("cols", widget.cols)
                widget.rows = item.get("rows", widget.rows)
        db.commit()

    # ── Private ─────────────────────────────────────────────────────────────

    def _get_owned_dashboard(self, db: Session, dashboard_id: int, user_id: int) -> Dashboard:
        dashboard = (
            db.query(Dashboard)
            .options(selectinload(Dashboard.widgets))
            .filter(Dashboard.id == dashboard_id, Dashboard.owner_id == user_id)
            .first()
        )
        if not dashboard:
            raise ValueError("Dashboard not found or access denied")
        return dashboard

    def _get_accessible_dashboard(self, db: Session, dashboard_id: int, user_id: int) -> Dashboard:
        dashboard = (
            db.query(Dashboard)
            .options(selectinload(Dashboard.widgets))
            .filter(
                Dashboard.id == dashboard_id,
                (Dashboard.owner_id == user_id) | (Dashboard.is_public == True),
            )
            .first()
        )
        if not dashboard:
            raise ValueError("Dashboard not found")
        return dashboard

    def _get_owned_widget(self, db: Session, widget_id: int, user_id: int) -> DashboardWidget:
        widget = (
            db.query(DashboardWidget)
            .join(Dashboard)
            .filter(DashboardWidget.id == widget_id, Dashboard.owner_id == user_id)
            .first()
        )
        if not widget:
            raise ValueError("Widget not found or access denied")
        return widget
