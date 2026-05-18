# Slice 4 — Chart Annotations · Alert Delivery · Flapping Detection

## Role and constraints

You are implementing a pre-designed feature slice for the MONEO sensor dashboard. Follow every instruction exactly. Do not introduce new abstractions, rename existing files, or modify files outside the scope listed. Never commit — the user controls git. Never use worktrees.

**Stack:** FastAPI + SQLAlchemy 2 (`Mapped[]`/`mapped_column()`) + Pydantic v2 + Alembic on the backend. Angular 20 NgModules (not standalone), `ChangeDetectionStrategy.OnPush`, `ChangeDetectorRef.markForCheck()` on the frontend.

**Project root:** `C:\Work\Albastria\FMC250\MONEO-MONITORING\`  
**Backend root:** `backend\` (relative to project root)  
**Frontend root:** `frontend\src\app\` (relative to project root)

---

## Context — what exists after Slice 3

### Migration chain
`0001_initial_schema` → `0002_sensor_extensions` → `0003_alert_schema_and_user_role` → `0004_alert_full_schema`

All four migrations are on disk. Slice 4 adds **0005_annotations**.

### Backend models already on disk
`DAL/models/alert_rule.py`, `DAL/models/alert_event.py`, `DAL/models/alert_state.py`, `DAL/models/alert_route.py`, `DAL/models/alert_notification_outbox.py`

The `AlertState` model has `flap_count_10m` and `is_flapping` columns; the evaluator does **not** yet update them.

### Backend services already on disk
- `services/alert_evaluator.py` — full state machine, no flapping detection yet
- `services/schedulers/data_polling_scheduler.py` — scheduler is **NOT started**: `_scheduler.start()` is commented out on line 43
- `main.py` line 56: `# start_scheduler()` is commented out

### Backend routes already on disk
- `routes/alert_routes.py` — rules CRUD + events list/ack. **Missing:** routes CRUD (`/api/alerts/routes`)
- `routes/response_models/alert.py` — `AlertRuleCreate/Update/Read`, `AlertEventRead`. **Missing:** route models

### `backend/migrations/env.py` imports
Currently imports all 5 alert models. **Does not** import annotation model yet.

### Frontend state
- `types/alert.ts` — `AlertRule`, `AlertEvent` interfaces. **Missing:** `AlertRoute`
- `core/alerts/alerts-api.service.ts` — rules + events + ack. **Missing:** route methods
- `modules/alerts/alerts-page.component.ts` — `activeTab: 'events' | 'rules'`
- `modules/alerts/alerts-page.component.html` — two tabs: "Active Events" / "Rules"
- `modules/alerts/alerts.module.ts` — declares `AlertsListComponent`, `AlertRulesListComponent`
- `dashboard-widget.component.ts` has a `buildAnnotations()` method (line 486) that returns **y-axis** band annotations (normal range). Slice 4 adds **x-axis** time annotations from the API without touching the existing y-axis logic.

### requirements.txt — packages already present
`httpx>=0.28.0` — present. `aiosmtplib` — **missing**, add it.

---

## Priority guidance

**Critical fix (P0 — do first, app will not compile without these):** Part 0 — create two missing frontend components that the Slice 3 agent referenced in templates and module declarations but never created.

**Must complete (P1):** Parts A, B, C, D, E — scheduler fix, annotation schema, model, auto-annotation from evaluator, annotation API.

**Should complete (P2):** Parts F, G — alert routes CRUD API, flapping detection in evaluator.

**Complete if context allows (P3):** Parts H, I, J — frontend annotation display, alert routes UI tab, notification dispatcher.

---

## Part 0 — Compilation fixes (P0 — do before anything else)

Two components were referenced by the Slice 3 agent in templates and module declarations
but were never created. The app cannot compile until both exist.

### 0a — Create `RangesEditorDrawerComponent`

`dashboard-widget.component.html` uses `<app-ranges-editor-drawer>` with these bindings:
```html
<app-ranges-editor-drawer
  *ngIf="activeSensor"
  [sensor]="activeSensor"
  [open]="showRangesEditor"
  (saved)="onRangesSaved($event)"
  (closed)="closeRangesEditor()"
></app-ranges-editor-drawer>
```

**Create** `frontend/src/app/modules/dashboard/ranges-editor-drawer.component.ts`:
```typescript
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Sensor } from '../../types/sensor';
import { SensorApiService } from '../../core/sensors/sensor-api.service';

@Component({
  selector: 'app-ranges-editor-drawer',
  standalone: false,
  templateUrl: './ranges-editor-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RangesEditorDrawerComponent implements OnChanges {
  @Input({ required: true }) sensor!: Sensor;
  @Input() open = false;
  @Output() saved  = new EventEmitter<Sensor>();
  @Output() closed = new EventEmitter<void>();

  normalMin:   number | null = null;
  normalMax:   number | null = null;
  warningMin:  number | null = null;
  warningMax:  number | null = null;
  criticalMin: number | null = null;
  criticalMax: number | null = null;
  saving = false;
  error: string | null = null;

  constructor(
    private readonly sensorApi: SensorApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['sensor'] && this.sensor) {
      this.normalMin   = this.sensor.normal_min;
      this.normalMax   = this.sensor.normal_max;
      this.warningMin  = this.sensor.warning_min;
      this.warningMax  = this.sensor.warning_max;
      this.criticalMin = this.sensor.critical_min;
      this.criticalMax = this.sensor.critical_max;
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    this.error  = null;
    this.cdr.markForCheck();
    try {
      const updated = await this.sensorApi.updateRanges(this.sensor.id, {
        normal_min:   this.normalMin,
        normal_max:   this.normalMax,
        warning_min:  this.warningMin,
        warning_max:  this.warningMax,
        critical_min: this.criticalMin,
        critical_max: this.criticalMax,
        ranges_source: 'manual',
      });
      this.saved.emit(updated);
    } catch {
      this.error = 'Failed to save ranges.';
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  close(): void {
    this.closed.emit();
  }
}
```

**Create** `frontend/src/app/modules/dashboard/ranges-editor-drawer.component.html`:
```html
<div class="ranges-drawer" *ngIf="open" (click)="close()">
  <div class="ranges-drawer__panel" (click)="$event.stopPropagation()">
    <div class="ranges-drawer__header">
      <span class="ranges-drawer__title">Edit Sensor Ranges</span>
      <button type="button" class="icon-btn" (click)="close()">
        <span class="icon">close</span>
      </button>
    </div>

    <div class="ranges-drawer__body">
      <p class="ranges-drawer__sensor-name">{{ sensor.name }}</p>

      <fieldset class="ranges-drawer__group">
        <legend>Normal</legend>
        <label>Min <input type="number" [(ngModel)]="normalMin" placeholder="—"></label>
        <label>Max <input type="number" [(ngModel)]="normalMax" placeholder="—"></label>
      </fieldset>

      <fieldset class="ranges-drawer__group">
        <legend>Warning</legend>
        <label>Min <input type="number" [(ngModel)]="warningMin" placeholder="—"></label>
        <label>Max <input type="number" [(ngModel)]="warningMax" placeholder="—"></label>
      </fieldset>

      <fieldset class="ranges-drawer__group">
        <legend>Critical</legend>
        <label>Min <input type="number" [(ngModel)]="criticalMin" placeholder="—"></label>
        <label>Max <input type="number" [(ngModel)]="criticalMax" placeholder="—"></label>
      </fieldset>

      <div *ngIf="error" class="ranges-drawer__error">{{ error }}</div>
    </div>

    <div class="ranges-drawer__footer">
      <button type="button" (click)="close()">Cancel</button>
      <button type="button" class="btn-primary" [disabled]="saving" (click)="save()">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </div>
  </div>
</div>
```

**Check `SensorApiService`** for an `updateRanges(id, body)` method. If it does not
exist, add it:
```typescript
updateRanges(id: number, body: {
  normal_min: number | null; normal_max: number | null;
  warning_min: number | null; warning_max: number | null;
  critical_min: number | null; critical_max: number | null;
  ranges_source: string;
}): Promise<Sensor> {
  return firstValueFrom(this.http.put<Sensor>(`/api/sensors/${id}/ranges`, body));
}
```

**Update `dashboard.module.ts`** — add to imports and declarations:
```typescript
import { FormsModule } from '@angular/forms';          // already present — verify
import { RangesEditorDrawerComponent } from './ranges-editor-drawer.component';
// Add RangesEditorDrawerComponent to declarations array
// Add FormsModule to imports array (needed for ngModel)
```

---

### 0b — Create `AlertRoutesListComponent` stub

`alerts.module.ts` already declares `AlertRoutesListComponent` but the file doesn't
exist. Create a minimal stub now (Part K will replace it with the full implementation).

**Create** `frontend/src/app/modules/alerts/alert-routes-list.component.ts`:
```typescript
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-alert-routes-list',
  standalone: false,
  template: '<p class="text-fg-faint p-4">Notification routes — coming soon.</p>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertRoutesListComponent {}
```

(Part K upgrades this to the full implementation if context allows.)

---

## Part A — Fix: enable the scheduler

### `backend/services/schedulers/data_polling_scheduler.py`
Line 43: remove the comment character so `_scheduler.start()` is uncommented.

Before:
```python
    # _scheduler.start()
```
After:
```python
    _scheduler.start()
```

### `backend/main.py`
Line 56: uncomment `start_scheduler()`.

Before:
```python
    # start_scheduler()
```
After:
```python
    start_scheduler()
```

---

## Part B — Migration 0005: annotation table

**Create:** `backend/migrations/versions/0005_annotations.py`

```python
"""add annotation table

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'annotation',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('scope_kind', sa.String(20), nullable=False),
        sa.Column('scope_id', sa.Integer(), nullable=True),
        sa.Column('label', sa.String(160), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('color', sa.String(20), nullable=True),
        sa.Column('source_event_id', sa.BigInteger(),
                  sa.ForeignKey('alert_event.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_by', sa.Integer(),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('idx_annotation_sensor', 'annotation',
                    ['scope_id', 'started_at'], postgresql_where=sa.text("scope_kind='sensor'"))
    op.create_index('idx_annotation_time', 'annotation', ['started_at'])


def downgrade():
    op.drop_index('idx_annotation_time', table_name='annotation')
    op.drop_index('idx_annotation_sensor', table_name='annotation')
    op.drop_table('annotation')
```

**Important:** the `down_revision` must match the actual revision ID string used in `0004_alert_full_schema.py`. Open that file and copy the exact `revision` value into `down_revision` above.

---

## Part C — Annotation SQLAlchemy model

**Create:** `backend/DAL/models/annotation.py`

```python
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from DAL.db_context import Base


class Annotation(Base):
    __tablename__ = "annotation"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source_event_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("alert_event.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
```

### Update `backend/migrations/env.py`

Add after the last alert model import:
```python
import DAL.models.annotation               # noqa: F401
```

---

## Part D — Auto-annotations from the alert evaluator

### `backend/services/alert_evaluator.py`

**Add import** at the top (after existing imports):
```python
from DAL.models.annotation import Annotation
```

**Add private method** `_write_annotation` after `_write_event`:
```python
def _write_annotation(
    self,
    db: Session,
    rule: AlertRule,
    event: AlertEvent,
    kind: str,          # 'alert'
    label: str,
    started_at: datetime,
    ended_at: datetime | None = None,
    color: str | None = None,
) -> Annotation:
    ann = Annotation(
        kind=kind,
        scope_kind="sensor",
        scope_id=rule.sensor_id,
        label=label,
        started_at=started_at,
        ended_at=ended_at,
        color=color,
        source_event_id=event.id,
    )
    db.add(ann)
    return ann
```

**Update `_write_event`** to return the created event:
```python
def _write_event(
    self,
    db: Session,
    rule: AlertRule,
    state: str,
    observed_value: float | None,
    observed_at: datetime,
) -> AlertEvent:
    event = AlertEvent(
        rule_id=rule.id,
        sensor_id=rule.sensor_id,
        state=state,
        observed_value=observed_value,
        observed_at=observed_at,
    )
    db.add(event)
    return event
```

**Update `_apply_state_machine`** to create/close annotations on `firing` and `recovered`/`awaiting_ack` transitions.

Color map: `{'warning': '#f5b428', 'critical': '#e64b3c'}` (use `rule.severity` to pick color).

The logic to add inside the existing state machine:

After the line that writes a `firing` event:
```python
firing_event = self._write_event(db, rule, "firing", observed_value, now)
self._write_annotation(
    db, rule, firing_event,
    kind="alert",
    label=f"[{rule.severity.upper()}] {rule.name}",
    started_at=now,
    color="#f5b428" if rule.severity == "warning" else "#e64b3c",
)
```

After the line that writes a `recovered` event, close the open annotation:
```python
recovered_event = self._write_event(db, rule, "recovered", observed_value, now)
# Close the open annotation for this rule (most recent unfinalised one)
open_ann = (
    db.query(Annotation)
    .filter(
        Annotation.source_event_id.in_(
            db.query(AlertEvent.id).filter(
                AlertEvent.rule_id == rule.id,
                AlertEvent.state == "firing",
            )
        ),
        Annotation.ended_at.is_(None),
    )
    .order_by(Annotation.started_at.desc())
    .first()
)
if open_ann:
    open_ann.ended_at = now
```

Do the same close logic for the `awaiting_ack` transition.

**Important:** since `_write_event` now returns the event, update all *existing* call sites in `_apply_state_machine` that previously ignored the return value to capture it (e.g., `self._write_event(...)` → `event = self._write_event(...)`). Only the `firing` and recovery transitions need annotation side effects; the other states (`pending`, `awaiting_ack` re-ticked) can discard the return value.

---

## Part E — Annotations API

**Create:** `backend/routes/annotation_routes.py`

```python
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.annotation import Annotation
from middleware import get_current_user, requires_role

annotation_router = APIRouter(prefix="/api/annotations", tags=["annotations"])


class AnnotationRead(BaseModel):
    id: int
    kind: str
    scope_kind: str
    scope_id: Optional[int] = None
    label: str
    body: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    color: Optional[str] = None
    source_event_id: Optional[int] = None
    created_by: Optional[int] = None
    created_at: datetime
    model_config = {"from_attributes": True}


class AnnotationCreate(BaseModel):
    kind: str = "manual"
    scope_kind: str = "sensor"
    scope_id: Optional[int] = None
    label: str
    body: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    color: Optional[str] = None


class AnnotationUpdate(BaseModel):
    label: Optional[str] = None
    body: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    color: Optional[str] = None


@annotation_router.get("", response_model=list[AnnotationRead])
async def list_annotations(
    scope_kind: Optional[str] = Query(None),
    scope_id: Optional[int] = Query(None),
    from_ts: Optional[datetime] = Query(None, alias="from"),
    to_ts: Optional[datetime] = Query(None, alias="to"),
    kinds: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Annotation)
    if scope_kind is not None:
        q = q.filter(Annotation.scope_kind == scope_kind)
    if scope_id is not None:
        q = q.filter(Annotation.scope_id == scope_id)
    if from_ts is not None:
        q = q.filter(Annotation.started_at >= from_ts)
    if to_ts is not None:
        # include annotations that started before `to` OR are still open
        q = q.filter(
            (Annotation.started_at <= to_ts) &
            ((Annotation.ended_at.is_(None)) | (Annotation.ended_at >= from_ts))
        )
    if kinds is not None:
        kind_list = [k.strip() for k in kinds.split(",")]
        q = q.filter(Annotation.kind.in_(kind_list))
    return q.order_by(Annotation.started_at.desc()).limit(limit).all()


@annotation_router.post("", response_model=AnnotationRead, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    body: AnnotationCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ann = Annotation(**body.model_dump(), created_by=current_user.id)
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann


@annotation_router.put("/{annotation_id}", response_model=AnnotationRead)
async def update_annotation(
    annotation_id: int,
    body: AnnotationUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ann = db.get(Annotation, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    # Only the creator or an admin may edit
    if ann.created_by != current_user.id and current_user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="Not allowed")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(ann, field, val)
    db.commit()
    db.refresh(ann)
    return ann


@annotation_router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ann = db.get(Annotation, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if ann.created_by != current_user.id and current_user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="Not allowed")
    db.delete(ann)
    db.commit()
```

### Register in `backend/main.py`

Add import:
```python
from routes.annotation_routes import annotation_router
```

Add after the last `app.include_router` call:
```python
app.include_router(annotation_router)
```

---

## Part F — Alert routes CRUD backend (P2)

### `backend/routes/response_models/alert.py`

Add at the end of the file:
```python
class AlertRouteCreate(BaseModel):
    scope_kind: str                    # 'rule','sensor','asset','severity','all'
    scope_id: Optional[int] = None
    scope_severity: Optional[str] = None
    channel: str                       # 'in_app','email','webhook'
    target: str                        # email address or webhook URL
    on_fire: bool = True
    on_recover: bool = False
    is_enabled: bool = True


class AlertRouteUpdate(BaseModel):
    scope_kind: Optional[str] = None
    scope_id: Optional[int] = None
    scope_severity: Optional[str] = None
    channel: Optional[str] = None
    target: Optional[str] = None
    on_fire: Optional[bool] = None
    on_recover: Optional[bool] = None
    is_enabled: Optional[bool] = None


class AlertRouteRead(BaseModel):
    id: int
    scope_kind: str
    scope_id: Optional[int] = None
    scope_severity: Optional[str] = None
    channel: str
    target: str
    on_fire: bool
    on_recover: bool
    is_enabled: bool
    created_at: datetime
    model_config = {"from_attributes": True}
```

### `backend/routes/alert_routes.py`

Add the following imports at the top (after existing imports):
```python
from DAL.models.alert_route import AlertRoute
from routes.response_models.alert import AlertRouteCreate, AlertRouteUpdate, AlertRouteRead
```

Add the following routes after the existing events endpoints:

```python
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
```

---

## Part G — Flapping detection in AlertEvaluator (P2)

**Approach:** flapping = the state toggled between `ok/recovered` and `firing` more than 3 times in the last 10 minutes. Track this with `flap_count_10m` and `is_flapping` on `AlertState`.

### `backend/services/alert_evaluator.py`

Add a helper method:

```python
def _check_flapping(
    self,
    db: Session,
    rule: AlertRule,
    state: AlertState,
    transition: str,   # 'fired' or 'recovered'
    now: datetime,
) -> None:
    """Increment the 10-minute flap counter and toggle is_flapping."""
    # Reset counter if the last tracked flip was > 10 minutes ago
    if state.last_value_at and (now - state.last_value_at).total_seconds() > 600:
        state.flap_count_10m = 0
        if state.is_flapping:
            state.is_flapping = False
            self._write_event(db, rule, "flapping_stopped", state.last_value, now)

    state.flap_count_10m += 1

    if state.flap_count_10m >= 4 and not state.is_flapping:
        state.is_flapping = True
        self._write_event(db, rule, "flapping_started", state.last_value, now)
    elif state.flap_count_10m < 4 and state.is_flapping:
        state.is_flapping = False
        self._write_event(db, rule, "flapping_stopped", state.last_value, now)
```

Call `self._check_flapping(db, rule, state, 'fired', now)` immediately after writing the `firing` event.
Call `self._check_flapping(db, rule, state, 'recovered', now)` immediately after writing the `recovered` or `awaiting_ack` event.

---

## Part H — Notification dispatcher (P3)

### `backend/requirements.txt`

Add after the last line:
```
aiosmtplib>=3.0.0
```

### `backend/config.py`

Add inside the `Settings` class (after `alert_evaluation_enabled`):
```python
smtp_host: str = "localhost"
smtp_port: int = 587
smtp_username: str = ""
smtp_password: str = ""
smtp_from: str = "moneo-alerts@example.com"
smtp_tls: bool = True
webhook_hmac_secret: str = "changeme"
notification_dispatch_enabled: bool = True
```

### Create `backend/services/notification_dispatcher.py`

```python
"""Outbox dispatcher — drains alert_notification_outbox.

Runs every 30 seconds via APScheduler.
Channels:
  in_app   — no-op (the alert_event itself is the notification; frontend polls)
  email    — aiosmtplib SMTP
  webhook  — httpx POST with HMAC-SHA256 signature header
"""
import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone

import httpx

from config import settings
from DAL import SessionLocal
from DAL.models.alert_notification_outbox import AlertNotificationOutbox

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


async def dispatch_outbox() -> None:
    if not settings.notification_dispatch_enabled:
        return

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        pending = (
            db.query(AlertNotificationOutbox)
            .filter(
                AlertNotificationOutbox.status == "pending",
                AlertNotificationOutbox.next_attempt_at <= now,
            )
            .limit(50)
            .all()
        )

        for entry in pending:
            try:
                await _dispatch_one(entry)
                entry.status = "sent"
                entry.sent_at = datetime.now(timezone.utc)
            except Exception as exc:
                logger.warning("Dispatch failed for outbox %s: %s", entry.id, exc)
                entry.attempts += 1
                entry.last_error = str(exc)[:500]
                if entry.attempts >= MAX_ATTEMPTS:
                    entry.status = "failed"
                else:
                    # Exponential back-off: 1m, 2m, 4m, 8m
                    backoff = 60 * (2 ** entry.attempts)
                    from datetime import timedelta
                    entry.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=backoff)
        db.commit()
    finally:
        db.close()


async def _dispatch_one(entry: AlertNotificationOutbox) -> None:
    channel = entry.channel or "in_app"

    if channel == "in_app":
        return  # in-app channel is handled by the frontend polling /api/alerts/events/active

    elif channel == "email":
        await _send_email(entry)

    elif channel == "webhook":
        await _send_webhook(entry)

    else:
        raise ValueError(f"Unknown channel: {channel}")


async def _send_email(entry: AlertNotificationOutbox) -> None:
    try:
        import aiosmtplib
        from email.message import EmailMessage
    except ImportError:
        logger.warning("aiosmtplib not installed — skipping email dispatch")
        return

    payload = entry.payload
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = entry.target
    msg["Subject"] = payload.get("subject", "MONEO Alert")
    msg.set_content(payload.get("body", json.dumps(payload, indent=2)))

    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username or None,
        password=settings.smtp_password or None,
        start_tls=settings.smtp_tls,
    )


async def _send_webhook(entry: AlertNotificationOutbox) -> None:
    body_bytes = json.dumps(entry.payload).encode()
    sig = hmac.new(
        settings.webhook_hmac_secret.encode(),
        body_bytes,
        hashlib.sha256,
    ).hexdigest()

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            entry.target,
            content=body_bytes,
            headers={
                "Content-Type": "application/json",
                "X-MONEO-Signature": f"sha256={sig}",
            },
        )
        resp.raise_for_status()
```

**Note:** `hmac.new` should be `hmac.new` — but Python's hmac module uses `hmac.new()` correctly. Double-check: it's `hmac.new(key, msg, digestmod)`.

### Register dispatcher in `backend/services/schedulers/data_polling_scheduler.py`

Add import:
```python
from services.notification_dispatcher import dispatch_outbox
```

Inside `start_scheduler()`, add after the existing jobs:
```python
_scheduler.add_job(
    dispatch_outbox,
    trigger="interval",
    seconds=30,
    id="dispatch_notifications",
    replace_existing=True,
)
```

---

## Part I — Frontend: Annotation type and service (P3)

### Create `frontend/src/app/types/annotation.ts`

```typescript
export interface Annotation {
  id: number;
  kind: 'manual' | 'alert' | 'maintenance' | 'event';
  scope_kind: 'sensor' | 'asset' | 'dashboard' | 'global';
  scope_id: number | null;
  label: string;
  body: string | null;
  started_at: string;
  ended_at: string | null;
  color: string | null;
  source_event_id: number | null;
  created_by: number | null;
  created_at: string;
}
```

### Create `frontend/src/app/core/annotations/annotations-api.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Annotation } from '../../types/annotation';

@Injectable({ providedIn: 'root' })
export class AnnotationsApiService {
  constructor(private http: HttpClient) {}

  getAnnotations(params: {
    scope_kind?: string;
    scope_id?: number;
    from?: string;
    to?: string;
    kinds?: string;
    limit?: number;
  }): Promise<Annotation[]> {
    let p = new HttpParams();
    if (params.scope_kind) p = p.set('scope_kind', params.scope_kind);
    if (params.scope_id != null) p = p.set('scope_id', String(params.scope_id));
    if (params.from) p = p.set('from', params.from);
    if (params.to) p = p.set('to', params.to);
    if (params.kinds) p = p.set('kinds', params.kinds);
    if (params.limit != null) p = p.set('limit', String(params.limit));
    return firstValueFrom(this.http.get<Annotation[]>('/api/annotations', { params: p }));
  }

  createAnnotation(body: Partial<Annotation>): Promise<Annotation> {
    return firstValueFrom(this.http.post<Annotation>('/api/annotations', body));
  }

  deleteAnnotation(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/annotations/${id}`));
  }
}
```

---

## Part J — Frontend: Chart xaxis annotations (P3)

### `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`

**Add import:**
```typescript
import { AnnotationsApiService } from '../../core/annotations/annotations-api.service';
import { Annotation } from '../../types/annotation';
```

**Add field:**
```typescript
private widgetAnnotations: Annotation[] = [];
```

**Inject service** in the constructor (add alongside existing services):
```typescript
private readonly annotationsApi: AnnotationsApiService,
```

**Add private method** `loadWidgetAnnotations`:
```typescript
private async loadWidgetAnnotations(
  sensorIds: number[],
  from: string,
  to: string,
): Promise<void> {
  if (!sensorIds.length) { this.widgetAnnotations = []; return; }
  try {
    // Fetch annotations for the first sensor only (single-sensor widgets); multi-sensor omits for now
    if (sensorIds.length === 1) {
      this.widgetAnnotations = await this.annotationsApi.getAnnotations({
        scope_kind: 'sensor',
        scope_id: sensorIds[0],
        from,
        to,
        kinds: 'alert,manual,maintenance,event',
      });
    }
  } catch {
    this.widgetAnnotations = [];
  }
}
```

**Add private method** `buildXaxisAnnotations`:
```typescript
private buildXaxisAnnotations(): any[] {
  return this.widgetAnnotations.map(ann => {
    const color = ann.color ?? '#8898aa';
    if (ann.ended_at) {
      // Range annotation
      return {
        x:     new Date(ann.started_at).getTime(),
        x2:    new Date(ann.ended_at).getTime(),
        fillColor: color,
        opacity: 0.12,
        label: { text: ann.label, style: { color: '#fff', background: color } },
      };
    } else {
      // Point annotation
      return {
        x: new Date(ann.started_at).getTime(),
        borderColor: color,
        strokeDashArray: 0,
        label: {
          borderColor: color,
          style: { color: '#fff', background: color },
          text: ann.label,
          orientation: 'horizontal',
        },
      };
    }
  });
}
```

**Update `loadLineChart`** — add annotation fetch before calling `applyLineChart`:

In the `loadLineChart` method, after `this.activeSensor = this.sensorForId(s.sensor_ids?.[0]);` and before `this.applyLineChart(resp, s);`, add:
```typescript
await this.loadWidgetAnnotations(s.sensor_ids!, from, to);
```

**Update `applyLineChart`** — merge x-axis annotations into the existing annotations object.

Find the existing annotations line inside `applyLineChart`:
```typescript
      annotations: this.buildAnnotations(),
```
Replace with:
```typescript
      annotations: {
        ...this.buildAnnotations(),
        xaxis: this.buildXaxisAnnotations(),
      },
```

Do **not** change `buildAnnotations()` itself (it still builds the y-axis normal band).

---

## Part K — Frontend: Alert Routes UI tab (P3)

### `frontend/src/app/types/alert.ts`

Add at the end of the file:
```typescript
export interface AlertRoute {
  id: number;
  scope_kind: 'rule' | 'sensor' | 'asset' | 'severity' | 'all';
  scope_id: number | null;
  scope_severity: string | null;
  channel: 'in_app' | 'email' | 'webhook';
  target: string;
  on_fire: boolean;
  on_recover: boolean;
  is_enabled: boolean;
  created_at: string;
}
```

### `frontend/src/app/core/alerts/alerts-api.service.ts`

Add import:
```typescript
import { AlertEvent, AlertRule, AlertRoute } from '../../types/alert';
```

Add methods at the end of the class:
```typescript
getRoutes(): Promise<AlertRoute[]> {
  return firstValueFrom(this.http.get<AlertRoute[]>('/api/alerts/routes'));
}

createRoute(body: Partial<AlertRoute>): Promise<AlertRoute> {
  return firstValueFrom(this.http.post<AlertRoute>('/api/alerts/routes', body));
}

updateRoute(id: number, body: Partial<AlertRoute>): Promise<AlertRoute> {
  return firstValueFrom(this.http.put<AlertRoute>(`/api/alerts/routes/${id}`, body));
}

deleteRoute(id: number): Promise<void> {
  return firstValueFrom(this.http.delete<void>(`/api/alerts/routes/${id}`));
}
```

### Create `frontend/src/app/modules/alerts/alert-routes-list.component.ts`

```typescript
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AlertsApiService } from '../../core/alerts/alerts-api.service';
import { AlertRoute } from '../../types/alert';

@Component({
  selector: 'app-alert-routes-list',
  standalone: false,
  templateUrl: './alert-routes-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertRoutesListComponent implements OnInit {
  routes: AlertRoute[] = [];
  loading = false;
  error: string | null = null;

  constructor(
    private readonly alertsApi: AlertsApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.cdr.markForCheck();
    try {
      this.routes = await this.alertsApi.getRoutes();
    } catch {
      this.error = 'Failed to load notification routes.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async deleteRoute(route: AlertRoute): Promise<void> {
    if (!confirm(`Delete route "${route.channel} → ${route.target}"?`)) return;
    try {
      await this.alertsApi.deleteRoute(route.id);
      this.routes = this.routes.filter(r => r.id !== route.id);
      this.cdr.markForCheck();
    } catch {
      alert('Failed to delete route.');
    }
  }

  async toggleRoute(route: AlertRoute): Promise<void> {
    try {
      const updated = await this.alertsApi.updateRoute(route.id, { is_enabled: !route.is_enabled });
      const idx = this.routes.findIndex(r => r.id === route.id);
      if (idx >= 0) this.routes[idx] = updated;
      this.cdr.markForCheck();
    } catch {
      alert('Failed to update route.');
    }
  }
}
```

### Create `frontend/src/app/modules/alerts/alert-routes-list.component.html`

```html
<div class="alert-routes-list">
  <div *ngIf="loading" class="routes-state">Loading notification routes…</div>
  <div *ngIf="error" class="routes-state routes-state--error">{{ error }}</div>

  <div *ngIf="!loading && !error && routes.length === 0" class="routes-state">
    No notification routes configured.
  </div>

  <table *ngIf="!loading && !error && routes.length > 0" class="routes-table">
    <thead>
      <tr>
        <th>Channel</th>
        <th>Target</th>
        <th>Scope</th>
        <th>Triggers</th>
        <th>Enabled</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr *ngFor="let route of routes">
        <td>{{ route.channel }}</td>
        <td class="routes-table__target">{{ route.target }}</td>
        <td>{{ route.scope_kind }}{{ route.scope_id ? ' #' + route.scope_id : '' }}{{ route.scope_severity ? ' (' + route.scope_severity + ')' : '' }}</td>
        <td>{{ route.on_fire ? 'fire' : '' }}{{ route.on_fire && route.on_recover ? ' + ' : '' }}{{ route.on_recover ? 'recover' : '' }}</td>
        <td>
          <button type="button" class="icon-btn" (click)="toggleRoute(route)"
                  [title]="route.is_enabled ? 'Disable' : 'Enable'">
            <span class="icon">{{ route.is_enabled ? 'toggle_on' : 'toggle_off' }}</span>
          </button>
        </td>
        <td>
          <button type="button" class="icon-btn" title="Delete route" (click)="deleteRoute(route)">
            <span class="icon icon-muted">delete</span>
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

### `frontend/src/app/modules/alerts/alerts.module.ts`

Add `AlertRoutesListComponent` to the `declarations` array. Import the component class at the top.

### `frontend/src/app/modules/alerts/alerts-page.component.ts`

Change `activeTab` type:
```typescript
activeTab: 'events' | 'rules' | 'routes' = 'events';
```

### `frontend/src/app/modules/alerts/alerts-page.component.html`

Add a third tab button in the `alerts-page__tabs` div:
```html
<button
  type="button"
  role="tab"
  [class.is-active]="activeTab === 'routes'"
  [attr.aria-selected]="activeTab === 'routes'"
  (click)="activeTab = 'routes'"
>
  Notification Routes
</button>
```

Add the corresponding panel in `alerts-page__body`:
```html
<app-alert-routes-list *ngIf="activeTab === 'routes'"></app-alert-routes-list>
```

---

## Verification checklist

After implementation, verify each of these manually (the agent does not run the app but should describe expected behavior):

0. `ng build` — zero TypeScript errors (this specifically verifies Part 0: both missing components now exist and are properly declared).
1. `alembic upgrade head` runs without errors; `annotation` table exists; `idx_annotation_sensor` index exists.
2. `GET /api/annotations?scope_kind=sensor&scope_id=1` returns `[]` when no alerts have fired.
3. `POST /api/annotations` with `{"kind":"manual","scope_kind":"sensor","scope_id":1,"label":"Test","started_at":"2026-05-15T10:00:00Z"}` returns 201 with the created object.
4. `GET /api/alerts/routes` returns `[]` with no error.
5. `POST /api/alerts/routes` with `{"scope_kind":"all","channel":"in_app","target":""}` returns 201.
6. `PUT /api/alerts/routes/1` with `{"is_enabled": false}` returns 200 with updated object.
7. `ng build` — zero TypeScript errors, zero Angular warnings.
8. Line chart widget on a single sensor renders without errors in the console.
9. After a rule fires in the evaluator (simulate by calling `AlertEvaluator().evaluate()` in a test), an `annotation` row appears in the DB with `kind='alert'` and `ended_at=NULL`.
10. After recovery, the same annotation has `ended_at` set.

### Backend tests to add
- `test_annotation_crud_200` — POST then GET then DELETE
- `test_annotation_requires_auth` — GET /api/annotations without token returns 401
- `test_alert_routes_crud` — POST, GET, PUT, DELETE cycle
- `test_evaluator_writes_annotation_on_firing` — call evaluator with a rule whose condition is immediately met; assert Annotation row created with `kind='alert'`

### Frontend tests to add
- `buildXaxisAnnotations()` unit test: with 2 annotations (one point, one range), assert the returned array has 2 entries with correct `x`/`x2` fields.

---

## State block (fill in after implementation)

```
SLICE_4_COMPLETE

Compilation fixes:
- RangesEditorDrawerComponent created + declared in DashboardModule: [yes/no]
- AlertRoutesListComponent stub/full created: [yes/no]
- ng build passes with zero errors: [yes/no]

Backend:
- scheduler enabled: [yes/no]
- migration 0005 created: [yes/no]
- Annotation model: [yes/no]
- Auto-annotation on firing: [yes/no]
- Auto-annotation close on recovery: [yes/no]
- Annotation API routes (GET/POST/PUT/DELETE): [yes/no]
- Alert routes CRUD API: [yes/no]
- Flapping detection: [yes/no]
- Notification dispatcher: [yes/no]
- aiosmtplib in requirements.txt: [yes/no]
- SMTP config in config.py: [yes/no]

Frontend:
- Annotation type: [yes/no]
- AnnotationsApiService: [yes/no]
- Chart xaxis annotations on line chart: [yes/no]
- AlertRoute type: [yes/no]
- Alert routes API service methods: [yes/no]
- AlertRoutesListComponent: [yes/no]
- Third "Notification Routes" tab: [yes/no]

Issues encountered:
[list any deviations, bugs found, or items deferred]
```
