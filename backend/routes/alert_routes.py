from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.alert_event import AlertEvent
from DAL.models.alert_route import AlertRoute
from DAL.models.alert_rule import AlertRule
from DAL.models.alert_state import AlertState
from DAL.models.sensor import Sensor
from middleware import get_current_user, requires_role
from routes.response_models.alert import (
    AlertEventRead,
    AlertRouteCreate,
    AlertRouteRead,
    AlertRouteUpdate,
    AlertRuleCreate,
    AlertRuleRead,
    AlertRuleUpdate,
)
from services.alert_evaluator import AlertEvaluator

alert_router = APIRouter(prefix="/api/alerts", tags=["alerts"])


# ── Rules ──────────────────────────────────────────────────────────────────────

@alert_router.get("/rules", response_model=list[AlertRuleRead])
async def list_rules(
    sensor_id: Optional[int] = Query(None),
    severity: Optional[str] = Query(None),
    enabled: Optional[bool] = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(AlertRule)
    if sensor_id is not None:
        q = q.filter(AlertRule.sensor_id == sensor_id)
    if severity is not None:
        q = q.filter(AlertRule.severity == severity)
    if enabled is not None:
        q = q.filter(AlertRule.is_enabled == enabled)
    return q.all()


@alert_router.post("/rules", response_model=AlertRuleRead, status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: AlertRuleCreate,
    current_user=Depends(requires_role("admin", "operator")),
    db: Session = Depends(get_db),
):
    sensor = db.get(Sensor, body.sensor_id)
    if not sensor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sensor not found")

    rule = AlertRule(**body.model_dump(), created_by=current_user.id)
    db.add(rule)
    db.flush()  # get rule.id before sync

    if rule.condition == "outside_range":
        AlertEvaluator()._sync_sensor_ranges(db, rule, sensor)

    db.commit()
    db.refresh(rule)
    return rule


@alert_router.get("/rules/{rule_id}", response_model=AlertRuleRead)
async def get_rule(
    rule_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    return rule


@alert_router.put("/rules/{rule_id}", response_model=AlertRuleRead)
async def update_rule(
    rule_id: int,
    body: AlertRuleUpdate,
    current_user=Depends(requires_role("admin", "operator")),
    db: Session = Depends(get_db),
):
    rule = db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")

    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(rule, field, val)
    rule.updated_at = datetime.now(timezone.utc)

    if rule.condition == "outside_range":
        sensor = db.get(Sensor, rule.sensor_id)
        if sensor:
            AlertEvaluator()._sync_sensor_ranges(db, rule, sensor)

    db.commit()
    db.refresh(rule)
    return rule


@alert_router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: int,
    current_user=Depends(requires_role("admin", "operator")),
    db: Session = Depends(get_db),
):
    rule = db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    db.delete(rule)
    db.commit()


# ── Events ─────────────────────────────────────────────────────────────────────

@alert_router.get("/events/active", response_model=list[AlertEventRead])
async def list_active_events(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(AlertEvent)
        .filter(AlertEvent.state.in_(["firing", "awaiting_ack"]))
        .order_by(AlertEvent.observed_at.desc())
        .all()
    )


@alert_router.get("/events", response_model=list[AlertEventRead])
async def list_events(
    sensor_id: Optional[int] = Query(None),
    rule_id: Optional[int] = Query(None),
    state: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(AlertEvent)
    if sensor_id is not None:
        q = q.filter(AlertEvent.sensor_id == sensor_id)
    if rule_id is not None:
        q = q.filter(AlertEvent.rule_id == rule_id)
    if state is not None:
        q = q.filter(AlertEvent.state == state)
    return q.order_by(AlertEvent.observed_at.desc()).limit(limit).all()


@alert_router.post("/events/{event_id}/ack", response_model=AlertEventRead)
async def ack_event(
    event_id: int,
    note: Optional[str] = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.get(AlertEvent, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.state not in ("firing", "awaiting_ack"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot ack event in state '{event.state}'",
        )

    now = datetime.now(timezone.utc)
    event.state = "cleared"
    event.acknowledged_by = current_user.id
    event.acknowledged_at = now
    if note is not None:
        event.note = note

    alert_state = db.get(AlertState, event.rule_id)
    if alert_state:
        alert_state.current_state = "ok"
        alert_state.state_since = now

    db.commit()
    db.refresh(event)
    return event


# ── Routes ─────────────────────────────────────────────────────────────────────

@alert_router.get("/routes", response_model=list[AlertRouteRead])
async def list_routes(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(AlertRoute).order_by(AlertRoute.id).all()


@alert_router.post("/routes", response_model=AlertRouteRead, status_code=status.HTTP_201_CREATED)
async def create_route(
    body: AlertRouteCreate,
    current_user=Depends(requires_role("admin", "operator")),
    db: Session = Depends(get_db),
):
    route = AlertRoute(**body.model_dump())
    db.add(route)
    db.commit()
    db.refresh(route)
    return route


@alert_router.put("/routes/{route_id}", response_model=AlertRouteRead)
async def update_route(
    route_id: int,
    body: AlertRouteUpdate,
    current_user=Depends(requires_role("admin", "operator")),
    db: Session = Depends(get_db),
):
    route = db.get(AlertRoute, route_id)
    if not route:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(route, field, val)
    db.commit()
    db.refresh(route)
    return route


@alert_router.delete("/routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_route(
    route_id: int,
    current_user=Depends(requires_role("admin", "operator")),
    db: Session = Depends(get_db),
):
    route = db.get(AlertRoute, route_id)
    if not route:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route not found")
    db.delete(route)
    db.commit()
