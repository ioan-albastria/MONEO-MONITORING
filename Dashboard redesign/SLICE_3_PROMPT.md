# Slice 3 — Alert evaluator · Rules & events API · In-app alerts · Alerts page

Continue the MONEO sensor dashboard expansion.

Read **`EXPANSION_PLAN.md`** end to end before writing any code. Then read
every file listed under **CURRENT STATE** to understand what is already in
place. Do not guess at existing signatures; always read first, then edit.

---

## SOURCE OF TRUTH

| File / path | Role |
|---|---|
| `EXPANSION_PLAN.md` | **Primary spec.** §3.3 (threshold alerts — "alerts core" sub-slice), §3.2 (ranges sync from alert rule) govern this slice. §3.4 annotations and §3.3 delivery are explicitly OUT of this slice. |
| `IMPLEMENTATION_INSTRUCTIONS.md` | Iteration-1 backend architecture (models, service patterns, route conventions). |
| `FRONTEND_REBUILD_INSTRUCTIONS.md` | Iteration-1 frontend patterns — CSS variables, NgModule structure, `ChangeDetectionStrategy.OnPush`. |
| `SLICE_2_STATE.md` | What Slice 2 delivered and what it left open. Read this first after EXPANSION_PLAN.md. |
| `backend/` | Live codebase. Read before every edit. |
| `frontend/src/app/` | Live frontend. Same rule. |

**Constraints:**
- Never use git worktrees. All edits go directly into the working tree.
- Never commit. The user controls all git operations.
- Never modify files outside the scope defined below.

---

## CURRENT STATE

### Backend (post-Slice-2)

- Alembic at migration `0003`. Migration chain: 0001 (baseline) → 0002 (sensor extensions) → 0003 (alert schema + user role).
- **`backend/DAL/models/user.py`** — has `role: Mapped[str]` column (server_default `'viewer'`).
- **`backend/middleware.py`** — exports `get_current_user` and `requires_role(*roles)`.
- **`backend/DAL/models/alert_rule.py`** — **simplified** schema: `id, sensor_id, name, description, tier, comparator, threshold, is_active, created_at, updated_at`. **This does not match the full §3.3 spec.** Migration 0004 must replace it.
- **`backend/DAL/models/alert_event.py`** — **simplified** schema: `id, rule_id, sensor_id, reading_id, tier, value, triggered_at, resolved_at`. **Needs replacement.**
- **`backend/DAL/models/alert_state.py`** — **simplified** schema: `id (PK), rule_id (UNIQUE), current_tier, fired_at, resolved_at, consecutive_breaches, updated_at`. **Needs replacement** (§3.3 uses `rule_id` as PK, different columns).
- **`backend/DAL/models/alert_route.py`** — has `id, name, channel, config (JSONB), filter_tiers (ARRAY), is_active, created_at`. Usable as-is for this slice; delivery wiring is Slice 4.
- **`backend/DAL/models/alert_notification_outbox.py`** — exists but not wired. Untouched this slice.
- **`backend/services/moneo_poller.py`** → `poll_latest_readings()` — writes readings, sets `sensor.last_seen_at`. No alert evaluation yet.
- **`backend/routes/websocket_routes.py`** — **WebSocket auth is already implemented** (JWT via `?token=` query param, closes with 1008 on failure). Do not touch this file.
- **`backend/config.py`** — `sensor_poll_interval_seconds: int = 300`, `auto_migrate: bool = True`. No alert toggles yet.

### Frontend (post-Slice-2)

- **`frontend/src/app/types/sensor.ts`** — `Sensor` interface has all range fields + `ranges_source`.
- **`frontend/src/app/core/sensors/sensor-status.ts`** — `statusOf()`, `STATUS_COLOR_HEX`, `StatusTier`.
- **`frontend/src/app/modules/dashboard/dashboard-widget.component.ts`** — `openRangesEditor()` is a console stub. **Complete this drawer in Part H.**
- No `frontend/src/app/types/alert.ts` yet.
- No `frontend/src/app/core/alerts/` directory yet.
- No `frontend/src/app/modules/alerts/` module yet.
- No `frontend/src/app/shared/` directory yet (no toast service, no banner component).
- Nav rail has `Events` item (`bolt` icon) pointing to `/alerts` — currently disabled/inert.

---

## THIS SESSION: Slice 3 — Alert evaluator core + Rules/events API + In-app alerts

### Part A — Migration 0004: Replace alert tables with full §3.3 schema

**File to create:** `backend/migrations/versions/0004_alert_tables_full_schema.py`

The tables created in 0003 used a simplified schema. Since they have no production data yet, the cleanest path is drop-and-recreate. The **full DDL is in `EXPANSION_PLAN.md` §3.3**; reproduce it exactly.

`upgrade()`:
1. Drop `alert_notification_outbox`, `alert_route`, `alert_state`, `alert_event`, `alert_rule` in dependency order (CASCADE).
2. Recreate `alert_rule`:
   ```sql
   id bigserial PK,
   sensor_id integer FK→sensors.id ON DELETE CASCADE NOT NULL,
   name varchar(120) NOT NULL,
   description text,
   condition varchar(20) NOT NULL  -- 'gt','lt','outside_range','inside_range','no_data'
     CHECK (condition IN ('gt','lt','outside_range','inside_range','no_data')),
   threshold_lo double precision,
   threshold_hi double precision,
   recovery_lo  double precision,
   recovery_hi  double precision,
   severity varchar(10) NOT NULL CHECK (severity IN ('warning','critical')),
   dwell_seconds integer NOT NULL DEFAULT 60,
   no_data_seconds integer,
   recovery_dwell_seconds integer NOT NULL DEFAULT 30,
   policy varchar(20) NOT NULL
     CHECK (policy IN ('auto_clear','manual_ack')) DEFAULT 'auto_clear',
   is_enabled boolean NOT NULL DEFAULT true,
   created_by integer REFERENCES users(id),
   created_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now()
   ```
   Add index `idx_alert_rule_sensor ON alert_rule(sensor_id) WHERE is_enabled`.
3. Recreate `alert_event`:
   ```sql
   id bigserial PK,
   rule_id bigint FK→alert_rule.id ON DELETE CASCADE NOT NULL,
   sensor_id integer FK→sensors.id ON DELETE CASCADE NOT NULL,
   state varchar(20) NOT NULL
     CHECK (state IN ('pending','firing','recovered','awaiting_ack','cleared',
                      'flapping_started','flapping_stopped')),
   observed_value double precision,
   observed_at timestamptz NOT NULL,
   acknowledged_by integer REFERENCES users(id),
   acknowledged_at timestamptz,
   note text,
   created_at timestamptz NOT NULL DEFAULT now()
   ```
   Indexes: `idx_alert_event_rule_time ON alert_event(rule_id, observed_at DESC)`;
   `idx_alert_event_state ON alert_event(state) WHERE state IN ('firing','awaiting_ack')`.
4. Recreate `alert_state`:
   ```sql
   rule_id bigint PK REFERENCES alert_rule(id) ON DELETE CASCADE,
   current_state varchar(20) NOT NULL,
   state_since timestamptz NOT NULL,
   last_value double precision,
   last_value_at timestamptz,
   flap_count_10m integer NOT NULL DEFAULT 0,
   is_flapping boolean NOT NULL DEFAULT false
   ```
5. Recreate `alert_route` (same shape as 0003; reproduced for clean chain):
   ```sql
   id bigserial PK, scope_kind varchar(20) NOT NULL
     CHECK (scope_kind IN ('rule','sensor','asset','severity','all')),
   scope_id integer, scope_severity varchar(10),
   channel varchar(20) NOT NULL CHECK (channel IN ('in_app','email','webhook')),
   target text NOT NULL,
   on_fire boolean NOT NULL DEFAULT true,
   on_recover boolean NOT NULL DEFAULT false,
   is_enabled boolean NOT NULL DEFAULT true,
   created_at timestamptz NOT NULL DEFAULT now()
   ```
6. Recreate `alert_notification_outbox`:
   ```sql
   id bigserial PK,
   event_id bigint FK→alert_event.id ON DELETE CASCADE NOT NULL,
   route_id bigint FK→alert_route.id ON DELETE CASCADE NOT NULL,
   channel varchar(20) NOT NULL,
   target text NOT NULL,
   payload jsonb NOT NULL,
   status varchar(20) NOT NULL DEFAULT 'pending',
   attempts integer NOT NULL DEFAULT 0,
   last_error text,
   next_attempt_at timestamptz NOT NULL DEFAULT now(),
   sent_at timestamptz
   ```
   Index: `idx_outbox_pending ON alert_notification_outbox(status, next_attempt_at) WHERE status='pending'`.

`downgrade()`: drop tables in reverse dependency order; recreate the Slice-2 simplified versions (see 0003 `upgrade()` for their column lists).

---

### Part B — Replace SQLAlchemy models to match migration 0004

**Files to rewrite** (do NOT add new files; update the 5 that exist):

**`backend/DAL/models/alert_rule.py`**:
```python
class AlertRule(Base):
    __tablename__ = "alert_rule"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    sensor_id: Mapped[int] = mapped_column(ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition: Mapped[str] = mapped_column(String(20), nullable=False)
    threshold_lo: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold_hi: Mapped[float | None] = mapped_column(Float, nullable=True)
    recovery_lo:  Mapped[float | None] = mapped_column(Float, nullable=True)
    recovery_hi:  Mapped[float | None] = mapped_column(Float, nullable=True)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    dwell_seconds: Mapped[int] = mapped_column(Integer, default=60)
    no_data_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recovery_dwell_seconds: Mapped[int] = mapped_column(Integer, default=30)
    policy: Mapped[str] = mapped_column(String(20), nullable=False, default="auto_clear")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=...)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=..., onupdate=...)
    # relationships
    state = relationship("AlertState", back_populates="rule", uselist=False, cascade="all, delete-orphan")
    events = relationship("AlertEvent", back_populates="rule", cascade="all, delete-orphan")
```

**`backend/DAL/models/alert_event.py`** — columns: `id, rule_id, sensor_id, state, observed_value, observed_at, acknowledged_by, acknowledged_at, note, created_at`.

**`backend/DAL/models/alert_state.py`** — `rule_id` is the **primary key** (no separate `id`): `rule_id, current_state, state_since, last_value, last_value_at, flap_count_10m, is_flapping`.

**`backend/DAL/models/alert_route.py`** — rewrite with full §3.3 columns: `id, scope_kind, scope_id, scope_severity, channel, target, on_fire, on_recover, is_enabled, created_at`. Remove the `filter_tiers` ARRAY column from the Slice-2 version.

**`backend/DAL/models/alert_notification_outbox.py`** — rewrite with §3.3 columns: `id, event_id, route_id, channel, target, payload, status, attempts, last_error, next_attempt_at, sent_at`.

Update **`backend/DAL/models/__init__.py`** and **`backend/DAL/__init__.py`** exports if column names changed (no new classes, just model updates).

---

### Part C — Alert evaluator service

**New file: `backend/services/alert_evaluator.py`**

```
class AlertEvaluator:
    """Streaming evaluator — called once per new reading inside poll_latest_readings()."""

    def evaluate(self, db: Session, sensor: Sensor, reading: SensorReading) -> None:
        """
        For each enabled rule on this sensor:
          1. Evaluate the condition against reading.value.
          2. Check dwell: if condition is NOW MET for ≥ dwell_seconds, transition PENDING→FIRING.
          3. Check recovery: if condition is NO LONGER MET for ≥ recovery_dwell_seconds,
             transition FIRING→RECOVERED (auto_clear) or FIRING→AWAITING_ACK (manual_ack).
          4. Write alert_event row on every state change.
          5. Update alert_state row.
          6. If rule has condition == 'outside_range' and sensor.ranges_source == 'from_alert_rule',
             call _sync_sensor_ranges(db, rule, sensor).
        """
```

**State machine transitions** (implement exactly):

```
OK / no state row → read latest value
  condition met  → create alert_state(current_state='pending', state_since=now)
                   write alert_event(state='pending')
  condition not met → no-op

pending:
  condition still met AND (now - state_since) >= dwell_seconds
                 → update alert_state(current_state='firing')
                   write alert_event(state='firing')
  condition not met → delete alert_state (goes back to OK, no event needed)

firing:
  condition not met AND (now - ?) >= recovery_dwell_seconds
                 → if policy == 'auto_clear':
                       update alert_state(current_state='recovered')
                       write alert_event(state='recovered')
                       delete alert_state  ← clears to OK
                   else (manual_ack):
                       update alert_state(current_state='awaiting_ack')
                       write alert_event(state='awaiting_ack')
  condition still met → no-op (already firing)

awaiting_ack:
  stays until explicitly ACK'd via the API (see Part D)
```

**Condition evaluation** (`_condition_met(value, rule) -> bool`):
```python
match rule.condition:
    case 'gt':             return value >  rule.threshold_lo
    case 'lt':             return value <  rule.threshold_lo
    case 'outside_range':  return value <  rule.threshold_lo or value > rule.threshold_hi
    case 'inside_range':   return rule.threshold_lo <= value <= rule.threshold_hi
    case 'no_data':        return False   # handled by the scheduled job, not here
```

**Ranges sync** — when the rule's condition is `outside_range` and `sensor.ranges_source == 'from_alert_rule'`, copy the rule's thresholds into the sensor:
```python
sensor.warning_min  = rule.threshold_lo
sensor.warning_max  = rule.threshold_hi
sensor.critical_min = rule.recovery_lo   # asymmetric recovery bounds
sensor.critical_max = rule.recovery_hi
```
If `recovery_lo`/`recovery_hi` are None, leave the critical bounds unchanged.

**New file: `backend/services/schedulers/alert_no_data_scheduler.py`**

```
async def check_no_data_alerts():
    """
    Run every 60 seconds (APScheduler).
    For each alert_rule where condition='no_data' and is_enabled=True:
      if sensor.last_seen_at is NULL or (now - last_seen_at) >= rule.no_data_seconds:
        call evaluator with a synthetic reading (value=None, timestamp=now)
    """
```

Register this job in `backend/services/schedulers/data_polling_scheduler.py` alongside the existing poller job.

**Wire into poller** — update `backend/services/moneo_poller.py` `poll_latest_readings()`. After writing a reading and setting `sensor.last_seen_at`, call the evaluator **within the same DB session** before committing:
```python
evaluator = AlertEvaluator()
evaluator.evaluate(db, sensor, reading)
```

---

### Part C.2 — Config toggle

Add to **`backend/config.py`** (`Settings` class):
```python
alert_evaluation_enabled: bool = True
```

Wrap the `AlertEvaluator.evaluate()` call in the poller with `if settings.alert_evaluation_enabled:` so it can be turned off without code changes.

---

### Part D — Alert rules CRUD + events API

**New file: `backend/routes/alert_routes.py`**

Routes (all require `get_current_user`; write/delete require `requires_role('admin', 'operator')`):

```
GET    /api/alerts/rules
       → list[AlertRuleRead]  (filter: ?sensor_id=, ?severity=, ?enabled=)

POST   /api/alerts/rules
       → AlertRuleRead   (requires operator+)
       Body: AlertRuleCreate

GET    /api/alerts/rules/{id}
       → AlertRuleRead

PUT    /api/alerts/rules/{id}
       → AlertRuleRead   (requires operator+)
       Body: AlertRuleUpdate

DELETE /api/alerts/rules/{id}
       → 204              (requires operator+)

GET    /api/alerts/events
       → list[AlertEventRead]   (filter: ?rule_id=, ?sensor_id=, ?state=, ?from=, ?to=, limit=50)

GET    /api/alerts/events/active
       → list[AlertEventRead]   (state IN ('firing', 'awaiting_ack'))

POST   /api/alerts/events/{id}/ack
       → AlertEventRead   (sets state → 'cleared', writes acknowledged_by / acknowledged_at)
       Body: { note?: string }
```

**Response models** (`backend/routes/response_models/alert.py`):
```python
class AlertRuleRead(BaseModel):
    id: int; sensor_id: int; name: str; description: Optional[str]
    condition: str; threshold_lo: Optional[float]; threshold_hi: Optional[float]
    recovery_lo: Optional[float]; recovery_hi: Optional[float]
    severity: str; dwell_seconds: int; no_data_seconds: Optional[int]
    recovery_dwell_seconds: int; policy: str; is_enabled: bool
    created_by: Optional[int]; created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

class AlertRuleCreate(BaseModel):
    sensor_id: int; name: str; description: Optional[str] = None
    condition: str; threshold_lo: Optional[float] = None; threshold_hi: Optional[float] = None
    recovery_lo: Optional[float] = None; recovery_hi: Optional[float] = None
    severity: str = "warning"; dwell_seconds: int = 60; no_data_seconds: Optional[int] = None
    recovery_dwell_seconds: int = 30; policy: str = "auto_clear"

class AlertRuleUpdate(BaseModel):
    # All optional — only supplied fields are updated
    name: Optional[str] = None; description: Optional[str] = None
    condition: Optional[str] = None; threshold_lo: Optional[float] = None
    threshold_hi: Optional[float] = None; recovery_lo: Optional[float] = None
    recovery_hi: Optional[float] = None; severity: Optional[str] = None
    dwell_seconds: Optional[int] = None; no_data_seconds: Optional[int] = None
    recovery_dwell_seconds: Optional[int] = None; policy: Optional[str] = None
    is_enabled: Optional[bool] = None

class AlertEventRead(BaseModel):
    id: int; rule_id: int; sensor_id: int; state: str
    observed_value: Optional[float]; observed_at: datetime
    acknowledged_by: Optional[int]; acknowledged_at: Optional[datetime]
    note: Optional[str]; created_at: datetime
    model_config = {"from_attributes": True}
```

**When a rule is created or updated** with `condition == 'outside_range'`:
- If `sensor.ranges_source != 'manual'` or it was previously `'from_alert_rule'`, call `_sync_sensor_ranges()` immediately so the widget coloring updates without waiting for the next reading.

Register `alert_router` in **`backend/main.py`**.

---

### Part E — Frontend: alert types + AlertsApiService

**New file: `frontend/src/app/types/alert.ts`**
```typescript
export interface AlertRule {
  id: number;
  sensor_id: number;
  name: string;
  description: string | null;
  condition: 'gt' | 'lt' | 'outside_range' | 'inside_range' | 'no_data';
  threshold_lo: number | null;
  threshold_hi: number | null;
  recovery_lo: number | null;
  recovery_hi: number | null;
  severity: 'warning' | 'critical';
  dwell_seconds: number;
  no_data_seconds: number | null;
  recovery_dwell_seconds: number;
  policy: 'auto_clear' | 'manual_ack';
  is_enabled: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface AlertEvent {
  id: number;
  rule_id: number;
  sensor_id: number;
  state: 'pending' | 'firing' | 'recovered' | 'awaiting_ack' | 'cleared'
       | 'flapping_started' | 'flapping_stopped';
  observed_value: number | null;
  observed_at: string;
  acknowledged_by: number | null;
  acknowledged_at: string | null;
  note: string | null;
  created_at: string;
}
```

**New file: `frontend/src/app/core/alerts/alerts-api.service.ts`**
```typescript
@Injectable({ providedIn: 'root' })
export class AlertsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/alerts';

  getRules(params?: { sensor_id?: number; severity?: string; enabled?: boolean }): Promise<AlertRule[]>
  createRule(body: Partial<AlertRule>): Promise<AlertRule>
  updateRule(id: number, body: Partial<AlertRule>): Promise<AlertRule>
  deleteRule(id: number): Promise<void>

  getActiveEvents(): Promise<AlertEvent[]>
  getEvents(params?: { rule_id?: number; sensor_id?: number; state?: string }): Promise<AlertEvent[]>
  ackEvent(id: number, note?: string): Promise<AlertEvent>
}
```

Use the auth interceptor pattern already in place (`HttpClient` picks up the bearer token automatically via `AuthInterceptorService`).

---

### Part F — Frontend: Toast service + active-alert banner

#### F.1 — Toast service

Create **`frontend/src/app/shared/`** directory if it doesn't exist.

**`frontend/src/app/shared/toast.service.ts`**:
```typescript
export interface Toast {
  id: string;
  message: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  duration?: number;   // ms; 0 = persistent
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private toasts$ = new BehaviorSubject<Toast[]>([]);
  readonly toasts = this.toasts$.asObservable();

  push(toast: Omit<Toast, 'id'>): void { ... }   // assigns a UUID id
  dismiss(id: string): void { ... }
}
```

**`frontend/src/app/shared/toast-host.component.ts`** — `OnPush` component that subscribes to `ToastService.toasts` and renders a fixed-position stack (bottom-right). Auto-dismisses after `duration` ms. Declare/export in a new **`frontend/src/app/shared/shared.module.ts`**; import `SharedModule` into `AppModule`.

CSS: `position: fixed; bottom: 1.5rem; right: 1.5rem; display: flex; flex-direction: column-reverse; gap: 8px; z-index: 9999;`. Individual toast: `border-left: 3px solid var(--tier-color); background: var(--color-surface-1); padding: 10px 14px; border-radius: var(--radius-md); box-shadow: var(--shadow-md);`. Tier colors via `data-severity` attribute.

#### F.2 — Active-alerts banner

**`frontend/src/app/shared/alert-banner.component.ts`** — persistent horizontal bar shown at the top of the main content area when `activeEvents.length > 0`. `OnPush`. Polls `AlertsApiService.getActiveEvents()` every **30 seconds** (not every 5s — this is not a streaming feed yet). 

Template:
```html
<div class="alert-banner" *ngIf="critCount > 0 || warnCount > 0" [attr.data-severity]="topSeverity">
  <span class="icon">notifications_active</span>
  <span>
    <strong>{{ critCount }} critical</strong> / {{ warnCount }} warning alert{{ total !== 1 ? 's' : '' }} active.
  </span>
  <a routerLink="/alerts" class="alert-banner__link">View all →</a>
  <button *ngIf="hasAckable" (click)="ackAll()" class="btn btn-xs">Ack all</button>
</div>
```

Mount `<app-alert-banner>` in **`frontend/src/app/modules/layout/`** (whatever layout shell component wraps the main content area — read before editing).

---

### Part G — Frontend: Alerts module

**New module: `frontend/src/app/modules/alerts/`**

Files to create:
- `alerts.module.ts` — declares 3 components, imports RouterModule, SharedModule, WidgetsModule (for RelativeTimePipe).
- `alerts-routing.module.ts` — `{ path: 'alerts', component: AlertsPageComponent }`.
- `alerts-page.component.ts` — shell component, `OnPush`. Two tabs: "Active" and "Rules".
- `alerts-list.component.ts` — lists `AlertEvent[]` from `getActiveEvents()`. Columns: severity pill, sensor name, state, value, time (RelativeTimePipe), ack button. `OnPush`.
- `alert-rules-list.component.ts` — lists `AlertRule[]`. Columns: name, sensor, condition summary, severity, enabled toggle, edit button (stub, deferred). `OnPush`.

Wire the `/alerts` route into **`frontend/src/app/app-routing.module.ts`** (or wherever top-level lazy routes are declared — read before editing). The route should be lazy-loaded.

Activate the `Events` nav item in the layout nav rail (read the layout component first to understand the nav model — it currently has a disabled `Events` entry pointing to `/alerts`).

---

### Part H — Ranges editor drawer (complete the Slice-2 stub)

`dashboard-widget.component.ts` has `openRangesEditor()` which currently logs a TODO.

**New file: `frontend/src/app/modules/dashboard/ranges-editor-drawer.component.ts`**

```typescript
@Component({
  selector: 'app-ranges-editor-drawer',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RangesEditorDrawerComponent {
  @Input() sensor!: Sensor;
  @Output() saved = new EventEmitter<Sensor>();
  @Output() closed = new EventEmitter<void>();
  // Form fields: normal_min, normal_max, warning_min, warning_max, critical_min, critical_max
  // On save: call sensorApi.updateRanges(sensor.id, formValue) → emit saved with updated sensor
}
```

Add `updateRanges(id: number, body: Partial<Sensor>): Promise<Sensor>` to `SensorApiService` (`PUT /api/sensors/{id}/ranges`).

The drawer should be rendered as a fixed right-side panel (Tailwind-style or CSS; ~360px wide, full height, slides in). Use a simple `@Input() open: boolean` to show/hide with a CSS transition.

In **`dashboard-widget.component.ts`**:
```typescript
showRangesEditor = false;

openRangesEditor(): void {
  this.showRangesEditor = true;
  this.cdr.markForCheck();
}

onRangesSaved(updated: Sensor): void {
  this.activeSensor = updated;
  this.showRangesEditor = false;
  // Re-apply status coloring with new bounds
  if (this.latestReading) this.applyGauge(this.latestReading, this.activeSensor);
  if (this.chartType === 'apex' && this.latestAnalytics)
    this.applyLineChart(this.latestAnalytics, this.widget.settings);
  this.cdr.markForCheck();
}
```

In **`dashboard-widget.component.html`**, add after `<app-widget-shell>`:
```html
<app-ranges-editor-drawer
  *ngIf="showRangesEditor && activeSensor"
  [sensor]="activeSensor"
  (saved)="onRangesSaved($event)"
  (closed)="showRangesEditor = false; cdr.markForCheck()"
></app-ranges-editor-drawer>
```

Declare `RangesEditorDrawerComponent` in **`DashboardModule`**.

---

## EXPLICITLY OUT OF THIS SLICE

- Email / webhook / outbox delivery — Slice 4.
- Flapping detection (≥5 transitions / 10 min) — Slice 4.
- Alert routes CRUD UI — Slice 4.
- Chart annotations (§3.4) — Slice 4 (depends on `alert_event` rows being live data).
- `POST /api/alerts/rules/{id}/test` dry-run endpoint — Slice 4.
- `/api/alerts/stream` WebSocket — Slice 4 (the banner polls REST for now).
- Full admin section (§6.2 full) — later.
- Caching layer (§6.1) — later.

---

## DELIVERABLE

The slice is done when **all** of the following are true:

1. `alembic upgrade head` runs cleanly; `\d alert_rule` shows the full §3.3 column set (including `condition`, `dwell_seconds`, `severity`).
2. `POST /api/alerts/rules` creates a rule; `GET /api/alerts/rules` returns it.
3. `DELETE /api/alerts/rules/{id}` succeeds for admin; returns 403 for viewer.
4. Writing a new `SensorReading` via the poller triggers the evaluator; if the value breaches the rule's condition for ≥ `dwell_seconds`, an `alert_event` row with state `'firing'` is written.
5. `GET /api/alerts/events/active` returns the firing event.
6. `POST /api/alerts/events/{id}/ack` clears the event (state → `'cleared'`).
7. The Angular alerts page (`/alerts`) renders with two tabs: active events list and rules list.
8. The active-alerts banner appears in the app shell when there are firing/awaiting_ack events.
9. The ranges editor drawer opens when the tune button is clicked on a single-sensor widget; submitting the form calls `PUT /api/sensors/{id}/ranges` and the gauge coloring updates immediately.
10. `ng build` — zero TypeScript errors, zero Angular compilation warnings.
11. `pytest backend/tests/` — all previously passing tests still pass; new tests cover: `AlertEvaluator.evaluate()` for `gt`/`lt`/`outside_range` conditions, state transitions (OK→pending→firing→recovered), and the ack endpoint.

---

## WORKFLOW

Use a **TodoList** to track progress through parts A–H.

**Pause once** — after you have sketched the full file-change list and before writing any code — and confirm the scope matches this prompt. Continue only after that check.

Work through all parts to completion. Part A (migration) must run first; Part B (models) must complete before Part C (evaluator) can be written.

---

## STATE BLOCK FOR NEXT SESSION

At the very end of this session, write a **"Slice 3 — state for next session"** block. Keep it under 25 lines. Cover:

- Parts completed (A–H, fully or partially).
- Files created and files changed (explicit list).
- Spec deviations and reasons.
- Anything left unfinished and why.
- Open questions or surprises for Slice 4.

Output it as a fenced markdown block so it can be pasted verbatim into the Slice 4 prompt.
