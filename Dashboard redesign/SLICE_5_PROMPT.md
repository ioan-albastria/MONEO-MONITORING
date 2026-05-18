# Slice 5 — Dead Code Cleanup · Outbox Routing · Dashboard Time Picker

## Role and constraints

You are implementing a pre-designed feature slice for the MONEO sensor dashboard. Follow every instruction exactly. Do not introduce new abstractions, rename existing files, or modify files outside the scope listed. Never commit — the user controls git. Never use worktrees.

**Stack:** FastAPI + SQLAlchemy 2 (`Mapped[]`/`mapped_column()`) + Pydantic v2 + Alembic. Angular 20 NgModules (not standalone), `ChangeDetectionStrategy.OnPush` + `ChangeDetectorRef.markForCheck()` on widget components. `DashboardComponent` uses default CD with `cdr.detectChanges()`.

**Project root:** `C:\Work\Albastria\FMC250\MONEO-MONITORING\`
**Backend root:** `backend\` · **Frontend root:** `frontend\src\app\`

---

## Context — what exists after Slice 4

### Migration chain
`0001` → `0002` → `0003` → `0004` → `0005` (annotation). Slice 5 adds **`0006`**.

### Key files to know before touching anything

**`frontend/src/app/modules/dashboard/dashboard-widget.component.ts`**
- `private resolveWindow(s: WidgetSettings): { from: string; to: string }` at line 686 — computes widget time window from `s.time_range_hours` or `s.from`/`s.to`. Slice 5 extends this to also consult the `DashboardTimeService`.
- `buildAnnotations()` returns yaxis normal-band; `buildXaxisAnnotations()` returns xaxis alert markers. Both merged in `applyLineChart()`. Do not touch.
- `openRangesEditor()`, `showRangesEditor`, `onRangesSaved()`, `closeRangesEditor()` are already implemented. The template does **not** yet have `<app-ranges-editor-drawer>`. Part 0 adds it.

**`frontend/src/app/modules/dashboard/dashboard.component.ts`**
- Does NOT use `ChangeDetectionStrategy.OnPush`. Uses `cdr.detectChanges()` throughout.
- `widgetCatalog` array at line 124 — defines `defaultSettings` per widget type. Part C adds `time_range_inherit: true` to all entries.
- `buildWidgetSettings(form)` at line 621 — builds `WidgetSettings` from the form. Part C extends it.
- `selectedDashboard: Dashboard | null` — the currently loaded dashboard. Toolbar picker reads from and writes to this.

**`frontend/src/app/modules/dashboard/dashboard.module.ts`**
- Already imports `FormsModule`. Does NOT yet declare `RangesEditorDrawerComponent`.

**`frontend/src/app/types/widget.ts`**
- `WidgetSettings` interface. Does NOT yet have `time_range_inherit`.

**`frontend/src/app/types/dashboard.ts`**
- `Dashboard` interface extends `DashboardSummary`. Does NOT yet have `default_time_range_hours`, `default_from`, `default_to`, `auto_refresh_seconds`.

**`backend/DAL/models/dashboard.py`**
- `Dashboard` model. Does NOT yet have the 4 time-range columns.

**`backend/routes/response_models/dashboard.py`**
- `DashboardRead` and `DashboardUpdate`. Do NOT yet have the 4 time-range fields.

**`backend/services/alert_evaluator.py`**
- Has `_write_event()` (returns `AlertEvent`) and `_write_annotation()`. Does NOT yet route notifications to `AlertNotificationOutbox`. Part A adds this.

---

## Priority guidance

**P0 — do first:** Part 0 — remove dead ranges-drawer code (tune button calls methods that lead nowhere).  
**P1 — must complete:** Part A — outbox notification routing (last piece of §3.3 alert delivery).  
**P2 — main feature:** Parts B–G — dashboard-level time-range picker (§4.2).

---

## Part 0 — Remove dead ranges-drawer code (P0)

The ranges-editing functionality was merged into the widget editor dialog. The
`openRangesEditor()` stub and supporting fields in `dashboard-widget.component.ts`
now lead nowhere. Remove them to keep the codebase clean.

### `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`

Remove these members entirely:
- `showRangesEditor = false;`
- `openRangesEditor(): void { … }`
- `onRangesSaved(updated: Sensor): void { … }`
- `closeRangesEditor(): void { … }`

### `frontend/src/app/modules/dashboard/dashboard-widget.component.html`

Remove the tune icon button from the `widgetChrome` div (the one with `title="Edit sensor ranges"` and `(click)="openRangesEditor()"`). The gear icon (settings) already opens the widget editor where ranges live.

If the file contains an `<app-ranges-editor-drawer>` tag anywhere, remove that too.
(Based on current disk state it does not — but verify.)

---

## Part A — Outbox notification routing (P1)

When a rule fires or recovers, the evaluator must match the event against `AlertRoute`
rows and enqueue `AlertNotificationOutbox` entries so the dispatcher can deliver them.

### `backend/services/alert_evaluator.py`

**Add imports** (after existing imports):
```python
from sqlalchemy import or_, and_
from DAL.models.alert_route import AlertRoute
from DAL.models.alert_notification_outbox import AlertNotificationOutbox
```

**Add private method** `_enqueue_notifications` (after `_close_open_annotation`):
```python
def _enqueue_notifications(
    self,
    db: Session,
    rule: AlertRule,
    event: AlertEvent,
) -> None:
    """Match the fired/recovered event to AlertRoute records and enqueue outbox rows."""
    is_firing = event.state in ("firing", "flapping_started")
    is_recovering = event.state in ("recovered", "awaiting_ack", "flapping_stopped")

    trigger_col = AlertRoute.on_fire if is_firing else AlertRoute.on_recover
    if not is_firing and not is_recovering:
        return

    routes = (
        db.query(AlertRoute)
        .filter(
            AlertRoute.is_enabled == True,
            trigger_col == True,
            or_(
                AlertRoute.scope_kind == "all",
                and_(AlertRoute.scope_kind == "rule",     AlertRoute.scope_id == rule.id),
                and_(AlertRoute.scope_kind == "sensor",   AlertRoute.scope_id == rule.sensor_id),
                and_(AlertRoute.scope_kind == "severity", AlertRoute.scope_severity == rule.severity),
            ),
        )
        .all()
    )

    payload = {
        "subject":         f"[{rule.severity.upper()}] {rule.name}",
        "body":            (
            f"Alert '{rule.name}' is {event.state}. "
            f"Value: {event.observed_value if event.observed_value is not None else 'N/A'}"
        ),
        "rule_id":         rule.id,
        "rule_name":       rule.name,
        "severity":        rule.severity,
        "sensor_id":       rule.sensor_id,
        "event_state":     event.state,
        "observed_value":  event.observed_value,
        "observed_at":     event.observed_at.isoformat() if event.observed_at else None,
    }

    for route in routes:
        entry = AlertNotificationOutbox(
            event_id=event.id,
            route_id=route.id,
            channel=route.channel,
            target=route.target,
            payload=payload,
            status="pending",
        )
        db.add(entry)
```

**Call `_enqueue_notifications`** immediately after each `_write_event` call that produces a `firing`, `recovered`, `awaiting_ack`, `flapping_started`, or `flapping_stopped` event. Specifically:

In `_apply_state_machine`, after the line `self._check_flapping(db, rule, state, "fired", now)` (the firing branch):
```python
self._enqueue_notifications(db, rule, firing_event)
```

After the recovered branch's `_check_flapping` call:
```python
self._enqueue_notifications(db, rule, recovered_event)
```

After the awaiting_ack branch's `_check_flapping` call:
```python
self._enqueue_notifications(db, rule, awaiting_event)
```

For flapping events written by `_check_flapping`, those are already in `_write_event` calls inside that method — if you want to route them, you can call `_enqueue_notifications` from within `_check_flapping` as well. This is optional; skip if context is tight.

---

## Part B — Migration 0006: dashboard time-range columns (P2)

**Create** `backend/migrations/versions/0006_dashboard_time_range.py`

```python
"""Add time-range picker columns to dashboards

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('dashboards', sa.Column('default_time_range_hours', sa.Integer(), nullable=True))
    op.add_column('dashboards', sa.Column('default_from',             sa.DateTime(timezone=True), nullable=True))
    op.add_column('dashboards', sa.Column('default_to',               sa.DateTime(timezone=True), nullable=True))
    op.add_column('dashboards', sa.Column('auto_refresh_seconds',     sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('dashboards', 'auto_refresh_seconds')
    op.drop_column('dashboards', 'default_to')
    op.drop_column('dashboards', 'default_from')
    op.drop_column('dashboards', 'default_time_range_hours')
```

**Verify `down_revision`**: open `0005_annotations.py` and copy its `revision` string into `down_revision` above.

---

## Part C — Backend: Dashboard model + API (P2)

### `backend/DAL/models/dashboard.py`

Add 4 columns after `is_public`:
```python
default_time_range_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
default_from:             Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
default_to:               Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
auto_refresh_seconds:     Mapped[int | None] = mapped_column(Integer, nullable=True)
```

### `backend/routes/response_models/dashboard.py`

Add to `DashboardRead` (after `is_public`):
```python
default_time_range_hours: Optional[int] = None
default_from:             Optional[datetime] = None
default_to:               Optional[datetime] = None
auto_refresh_seconds:     Optional[int] = None
```

Add to `DashboardUpdate` (after `is_public`):
```python
default_time_range_hours: Optional[int] = None
default_from:             Optional[datetime] = None
default_to:               Optional[datetime] = None
auto_refresh_seconds:     Optional[int] = None
```

The existing `PUT /api/dashboards/{id}` route already calls `DashboardUpdate` — it will
pick up the new optional fields automatically if `DashboardService.update_dashboard()`
uses `exclude_unset=True`. Verify the service does so; if not, adjust.

---

## Part D — Frontend types (P2)

### `frontend/src/app/types/dashboard.ts`

Add 4 fields to `Dashboard` (after `is_public`):
```typescript
default_time_range_hours?: number | null;
default_from?: string | null;
default_to?: string | null;
auto_refresh_seconds?: number | null;
```

Add to `DashboardUpdate`:
```typescript
default_time_range_hours?: number | null;
default_from?: string | null;
default_to?: string | null;
auto_refresh_seconds?: number | null;
```

### `frontend/src/app/types/widget.ts`

Add to `WidgetSettings`:
```typescript
time_range_inherit?: boolean;
```

---

## Part E — DashboardTimeService (P2)

**Create** `frontend/src/app/core/dashboard/time.service.ts`

```typescript
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';

export type TimePreset = '15m' | '1h' | '6h' | '24h' | '7d' | '30d' | 'custom';

export interface TimeRange {
  preset: TimePreset;
  hours?: number;               // set when preset !== 'custom'
  from?: string;                // ISO — set when preset === 'custom'
  to?: string;                  // ISO — set when preset === 'custom'
  autoRefreshSeconds: number;   // 0 = off
}

export const PRESET_HOURS: Record<Exclude<TimePreset, 'custom'>, number> = {
  '15m': 0.25, '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720,
};

const DEFAULT_RANGE: TimeRange = { preset: '1h', hours: 1, autoRefreshSeconds: 0 };

@Injectable({ providedIn: 'root' })
export class DashboardTimeService implements OnDestroy {
  private _range$ = new BehaviorSubject<TimeRange>(DEFAULT_RANGE);
  readonly range$ = this._range$.asObservable();

  private _refreshTimer: ReturnType<typeof setInterval> | null = null;

  get current(): TimeRange { return this._range$.getValue(); }

  setRange(range: TimeRange): void {
    this._range$.next(range);
    this._resetRefreshTimer(range.autoRefreshSeconds);
  }

  /** Called by DashboardComponent when a dashboard is loaded, to restore its saved range. */
  loadFromDashboard(d: {
    default_time_range_hours?: number | null;
    default_from?: string | null;
    default_to?: string | null;
    auto_refresh_seconds?: number | null;
  }): void {
    if (d.default_time_range_hours) {
      const hours = d.default_time_range_hours;
      const preset = (Object.entries(PRESET_HOURS).find(([, h]) => h === hours)?.[0] ?? '1h') as TimePreset;
      this.setRange({ preset, hours, autoRefreshSeconds: d.auto_refresh_seconds ?? 0 });
    } else if (d.default_from && d.default_to) {
      this.setRange({ preset: 'custom', from: d.default_from, to: d.default_to, autoRefreshSeconds: d.auto_refresh_seconds ?? 0 });
    } else {
      this.setRange({ ...DEFAULT_RANGE, autoRefreshSeconds: d.auto_refresh_seconds ?? 0 });
    }
  }

  /** Resolve the current range to concrete ISO from/to strings. */
  resolveWindow(): { from: string; to: string } {
    const r = this._range$.getValue();
    if (r.preset === 'custom' && r.from && r.to) {
      return { from: r.from, to: r.to };
    }
    const hours = r.hours ?? PRESET_HOURS[r.preset as Exclude<TimePreset, 'custom'>] ?? 1;
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  private _resetRefreshTimer(seconds: number): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (seconds > 0) {
      this._refreshTimer = setInterval(() => {
        // Re-emit the same range object — widgets subscribed will reload
        this._range$.next({ ...this._range$.getValue() });
      }, seconds * 1000);
    }
  }

  ngOnDestroy(): void {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
  }
}
```

---

## Part F — Dashboard toolbar: time picker (P2)

### `frontend/src/app/modules/dashboard/dashboard.component.ts`

**Add import:**
```typescript
import { DashboardTimeService, TimeRange, TimePreset, PRESET_HOURS } from '../../core/dashboard/time.service';
```

**Add fields** (in the state section, near `editMode`):
```typescript
// ── Time picker ────────────────────────────────────────────────────────
readonly presets: TimePreset[] = ['15m', '1h', '6h', '24h', '7d', '30d'];
readonly autoRefreshOptions = [
  { label: 'Off', value: 0 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1m',  value: 60 },
  { label: '5m',  value: 300 },
];
timeRange: TimeRange = { preset: '1h', hours: 1, autoRefreshSeconds: 0 };
private _timeRangeSaveTimer: ReturnType<typeof setTimeout> | null = null;
```

**Inject** `DashboardTimeService` in the constructor:
```typescript
private readonly timeService: DashboardTimeService,
```

**Update `selectDashboardById`** — after `this.selectedDashboard` is set, call:
```typescript
if (this.selectedDashboard) {
  this.timeService.loadFromDashboard(this.selectedDashboard);
  this.timeRange = this.timeService.current;
}
```

Do the same after `this.selectedDashboard` is set in `loadDashboards()`.

**Add method `onPresetSelected(preset: TimePreset)`:**
```typescript
onPresetSelected(preset: TimePreset): void {
  const hours = preset !== 'custom' ? PRESET_HOURS[preset] : undefined;
  this.timeRange = { ...this.timeRange, preset, hours };
  this.timeService.setRange(this.timeRange);
  this._scheduleTimeRangeSave();
  this.refreshView();
}
```

**Add method `onAutoRefreshChanged(seconds: number)`:**
```typescript
onAutoRefreshChanged(seconds: number): void {
  this.timeRange = { ...this.timeRange, autoRefreshSeconds: seconds };
  this.timeService.setRange(this.timeRange);
  this._scheduleTimeRangeSave();
  this.refreshView();
}
```

**Add private method `_scheduleTimeRangeSave`:**
```typescript
private _scheduleTimeRangeSave(): void {
  if (!this.selectedDashboard?.is_owned) return;
  if (this._timeRangeSaveTimer) clearTimeout(this._timeRangeSaveTimer);
  this._timeRangeSaveTimer = setTimeout(async () => {
    const d = this.selectedDashboard;
    if (!d?.is_owned) return;
    const r = this.timeService.current;
    try {
      await this.api.updateDashboard(d.id, {
        default_time_range_hours: r.preset !== 'custom' ? (r.hours ?? null) : null,
        default_from:             r.preset === 'custom' ? (r.from ?? null) : null,
        default_to:               r.preset === 'custom' ? (r.to ?? null) : null,
        auto_refresh_seconds:     r.autoRefreshSeconds || null,
      });
    } catch { /* non-fatal */ }
  }, 500);
}
```

**Update `ngOnDestroy`:**
```typescript
if (this._timeRangeSaveTimer) clearTimeout(this._timeRangeSaveTimer);
```

### Dashboard toolbar template

In `dashboard.component.html`, find the toolbar area (wherever the "Add Widget", "Edit", "Delete" buttons live) and add the time picker controls. Use the existing button styles for consistency:

```html
<!-- Time picker toolbar — only when a dashboard is loaded -->
<div class="dashboard-toolbar__time" *ngIf="selectedDashboard">
  <!-- Preset buttons -->
  <div class="time-presets" role="group" aria-label="Time range">
    <button
      *ngFor="let p of presets"
      type="button"
      class="time-preset-btn"
      [class.is-active]="timeRange.preset === p"
      (click)="onPresetSelected(p)"
    >{{ p }}</button>
  </div>

  <!-- Auto-refresh selector -->
  <select
    class="time-refresh-select"
    [ngModel]="timeRange.autoRefreshSeconds"
    (ngModelChange)="onAutoRefreshChanged($event)"
    [ngModelOptions]="{ standalone: true }"
  >
    <option *ngFor="let o of autoRefreshOptions" [value]="o.value">{{ o.label }}</option>
  </select>
</div>
```

Add minimal CSS for `.time-presets`, `.time-preset-btn`, `.time-preset-btn.is-active`, `.time-refresh-select` in `dashboard.component.css` (or inline styles if no separate CSS file). Active preset button should use `var(--color-brand)` or similar accent.

---

## Part G — Widget subscribes to TimeService (P2)

### `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`

**Add import:**
```typescript
import { DashboardTimeService } from '../../core/dashboard/time.service';
import { debounceTime, skip } from 'rxjs/operators';
```

**Add field:**
```typescript
private _timeSub: Subscription | null = null;
```

**Inject** `DashboardTimeService` in the constructor:
```typescript
private readonly timeService: DashboardTimeService,
```

**Update `ngOnInit`** — after the existing `void this.reload()` call, subscribe to the time service:
```typescript
this._timeSub = this.timeService.range$.pipe(
  skip(1),           // skip the initial value; widget already loaded with ngOnInit's reload()
  debounceTime(250), // coalesce rapid preset changes
).subscribe(() => {
  if (this._usesInheritedRange()) void this.reload();
});
```

**Update `ngOnDestroy`:**
```typescript
this._timeSub?.unsubscribe();
```

**Add private helper:**
```typescript
private _usesInheritedRange(): boolean {
  const s = this.widget?.settings;
  if (!s) return false;
  // Inherit unless explicitly opted out
  if (s.time_range_inherit === false) return false;
  // Widgets with explicit absolute from/to and no inherit flag use their own range
  if (s.from && s.to && s.time_range_inherit === undefined) return false;
  return true;
}
```

**Update `resolveWindow`** — extend the existing method to consult the time service when the widget inherits:
```typescript
private resolveWindow(s: WidgetSettings): { from: string; to: string } {
  if (this._usesInheritedRange()) {
    return this.timeService.resolveWindow();
  }
  // Widget-level override
  if (s.time_range_hours && s.time_range_hours > 0) {
    const to   = new Date();
    const from = new Date(to.getTime() - s.time_range_hours * 3600_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  return { from: s.from!, to: s.to! };
}
```

### `frontend/src/app/modules/dashboard/dashboard.component.ts` — `widgetCatalog`

In `buildWidgetSettings()`, do not override `time_range_inherit`. For new widgets, add it to `defaultSettings` in the catalog:

Update each catalog entry's `defaultSettings` to include `time_range_inherit: true`. Example:
```typescript
defaultSettings: { sensor_ids: [], time_range_inherit: true, aggregated: true, bucket_minutes: 60, show_legend: true },
```

Do this for `line_chart`, `bar_chart`. For `gauge` and `stat_card`, `time_range_inherit` is not meaningful (they fetch the latest reading, not a window) — omit it.

In `buildWidgetSettings()`, if the form uses `timeMode === 'relative'` and the user hasn't explicitly changed the range from the dashboard default, you can leave `time_range_inherit: true`. If the user entered a custom widget-level range (i.e., `timeMode` is set and differs from the toolbar), set `time_range_inherit: false`. Simplest implementation: if `timeMode === 'relative'`, set `time_range_inherit: true` and omit `time_range_hours` (the dashboard default applies). If `timeMode === 'absolute'`, set `time_range_inherit: false`.

---

## Verification checklist

1. `alembic upgrade head` — no errors; `dashboards` table has `default_time_range_hours`, `default_from`, `default_to`, `auto_refresh_seconds` columns.
2. `PUT /api/dashboards/1` with `{"default_time_range_hours": 6}` returns 200 with the updated fields.
3. Tune icon in widget chrome opens the ranges drawer. Saving updated values calls `PUT /api/sensors/{id}/ranges` and the widget reloads with the new status colours.
4. Dashboard toolbar shows preset buttons (15m 1h 6h 24h 7d 30d). Clicking 6h reloads all line/bar chart widgets with that window.
5. Auto-refresh `30s` causes chart widgets to silently refetch every 30 seconds.
6. Setting `30d` and navigating away then back restores `30d` (persisted to server and reloaded from `selectedDashboard`).
7. A widget explicitly set to `time_range_inherit: false` with its own `from`/`to` does NOT reload when the toolbar preset changes.
8. `ng build` — zero TypeScript errors, zero Angular warnings.
9. `POST /api/alerts/rules` + trigger + `GET /api/alerts/events/active` shows firing event. `GET api/alerts/routes` shows a route. Verify that an `alert_notification_outbox` row exists after the firing event.

---

## State block (fill in after implementation)

```
SLICE_5_COMPLETE

Dead code removal:
- showRangesEditor / openRangesEditor / onRangesSaved / closeRangesEditor removed: [yes/no]
- Tune (ranges) icon button removed from widget chrome: [yes/no]

Trust tier completion:
- Outbox notification routing in AlertEvaluator: [yes/no]

Dashboard time picker:
- Migration 0006 created: [yes/no]
- Dashboard model + API updated: [yes/no]
- DashboardTimeService created: [yes/no]
- Dashboard types updated: [yes/no]
- WidgetSettings.time_range_inherit added: [yes/no]
- Toolbar preset buttons: [yes/no]
- Auto-refresh selector: [yes/no]
- Time range saved to server on change: [yes/no]
- Widget subscribes to TimeService: [yes/no]
- resolveWindow() uses TimeService when inheriting: [yes/no]

Issues encountered:
[list any deviations, bugs, or deferred items]
```
