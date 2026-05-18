# Slice 11 — Test Debt Fix + test_alert_rules.py + Sensor Range Quick-Edit + Admin Alert Rules

## Role and constraints

You are implementing a pre-designed feature slice for the MONEO sensor dashboard. Follow
every instruction exactly. Do not introduce new abstractions, rename existing files, or
modify files outside the scope listed. Never commit — the user controls git. Never use
worktrees.

**Stack:** FastAPI + SQLAlchemy 2 (`Mapped[]`/`mapped_column()`) + Pydantic v2 + Alembic.
Angular 20 NgModules (not standalone), `ChangeDetectionStrategy.OnPush` on widget/picker
components. Default CD on page/admin components.

**Project root:** `C:\Work\Albastria\FMC250\MONEO-MONITORING\`
**Backend root:** `backend\` · **Frontend root:** `frontend\src\app\`

---

## Context — what exists after Slice 10

### Backend

**Test infrastructure:**
- `conftest.py` — `db` fixture (function-scope, SQLite in-memory, `Base.metadata.create_all`).
  Does **not** provide a TestClient.
- `test_services.py`, `test_kiosk.py`, `test_sensor_ranges.py`, `test_asset_hierarchy.py` —
  all passing (ORM/service-level, no HTTP). Do **not** modify these.
- **`test_slice2.py`** and **`test_slice3.py`** — 17 pre-existing failures. They define
  their own `db_engine` / `db` fixtures and use `fastapi.testclient.TestClient`. See
  failure analysis below.

**Alert system (fully implemented):**

`DAL/models/alert_rule.py` — `AlertRule` model. Key fields:
```python
id            BigInteger PK
sensor_id     FK→sensors.id  ON DELETE CASCADE
name          String(120)
description   Text nullable
condition     String(20)   # 'gt' | 'lt' | 'outside_range' | 'inside_range' | 'no_data'
threshold_lo  Float nullable
threshold_hi  Float nullable
recovery_lo   Float nullable
recovery_hi   Float nullable
severity      String(10)   # 'warning' | 'critical'
dwell_seconds         Integer  default=60
no_data_seconds       Integer nullable
recovery_dwell_seconds Integer default=30
policy        String(20)   # 'auto_clear' | 'manual_ack'
is_enabled    Boolean      default=True
created_by    FK→users.id nullable
created_at    DateTime(timezone=True)
updated_at    DateTime(timezone=True)
```

`DAL/models/alert_state.py` — `AlertState`. PK is `rule_id` (not `id`). Fields:
`current_state` (String 20), `state_since` (DateTime tz), `last_value` (Float nullable),
`last_value_at` (DateTime tz nullable), `flap_count_10m` (int), `is_flapping` (bool).

`DAL/models/alert_event.py` — `AlertEvent`. Fields: `id`, `rule_id`, `sensor_id`, `state`
(String 20 — 'pending' | 'firing' | 'recovered' | 'awaiting_ack' | 'cleared'), `observed_value`,
`observed_at`, `acknowledged_by`, `acknowledged_at`, `note`, `created_at`.

`services/alert_evaluator.py` — `AlertEvaluator` class. Methods:
- `evaluate(db, sensor, reading)` — main entry point; runs the state machine.
- `_condition_met(value, rule) → bool`.
- `_apply_state_machine(db, rule, state, condition_met, now, observed_value)` — the
  state machine (`ok → pending → firing → recovered/awaiting_ack`). Uses
  `now = datetime.now(timezone.utc)` for the "current time" reference.

`routes/alert_routes.py` — endpoints:
- `GET  /api/alerts/rules` — list (filter by sensor_id, severity, enabled)
- `POST /api/alerts/rules` — create (admin/operator)
- `GET  /api/alerts/rules/{id}`
- `PUT  /api/alerts/rules/{id}` — update (admin/operator)
- `DELETE /api/alerts/rules/{id}` — 204 (admin/operator)
- `GET  /api/alerts/events/active`
- `GET  /api/alerts/events`
- `POST /api/alerts/events/{id}/ack` — acknowledge a firing/awaiting_ack event
- `GET/POST/PUT/DELETE /api/alerts/routes`

**Sensor API:**
`routes/sensor_routes.py` has `PUT /api/sensors/{id}/ranges` (requires admin/operator).
`core/sensors/sensor-api.service.ts` has `updateRanges(id, body)` method.

### Frontend

- `DashboardWidgetComponent` has `activeSensor: Sensor | null` (set for single-sensor
  widgets) and `editable: boolean` input. The widget chrome already contains
  `icon-btn` buttons for "Refresh", "Configure", and "Remove".
- `SensorApiService.updateRanges(id, body)` exists.
- `AdminModule` has four tabs: `'kiosk-tokens'`, `'users'`, `'assets'`, (adding
  `'alert-rules'` in Part D).
- `core/alerts/alerts-api.service.ts` exists (wraps `/api/alerts` endpoints).
  Inspect its actual method names before referencing them in Part D.

---

## Failure analysis for test_slice2.py and test_slice3.py

**Step 0 — Before writing any fix, run:**
```
pytest backend/tests/test_slice2.py backend/tests/test_slice3.py backend/tests/test_services.py -v 2>&1
```
Read the output carefully. The root causes described below are the most likely, but
verify against actual failure messages.

### Expected root cause — test_slice3.py

`AlertEvaluator._apply_state_machine` uses `now = datetime.now(timezone.utc)` (tz-aware)
and then computes `elapsed = (now - state.state_since).total_seconds()` and
`recovery_elapsed = (now - last_met_at).total_seconds()`.

In the **SQLite** test DB, `DateTime(timezone=True)` columns are stored as offset-naive
strings. When `_apply_state_machine` loads an existing `AlertState` via `db.get()` and
then subtracts a tz-aware `now` from the naive `state.state_since`, Python raises:
```
TypeError: can't subtract offset-naive and offset-aware datetimes
```

**Fix — add a helper to `alert_evaluator.py` and use it in `_apply_state_machine`:**

Add this private static method to `AlertEvaluator`:
```python
@staticmethod
def _dt_elapsed(since: datetime, now: datetime) -> float:
    """Return (now - since).total_seconds() safely for both tz-aware and tz-naive datetimes.

    SQLite returns offset-naive datetimes for DateTime(timezone=True) columns.
    This helper strips tzinfo from `now` if `since` is naive, avoiding TypeError
    in tests. PostgreSQL always returns tz-aware datetimes, so both sides are aware
    and no stripping happens.
    """
    if since.tzinfo is None and now.tzinfo is not None:
        now = now.replace(tzinfo=None)
    return (now - since).total_seconds()
```

Replace every occurrence of `(now - state.state_since).total_seconds()` and
`(now - last_met_at).total_seconds()` inside `_apply_state_machine` with calls to
`self._dt_elapsed(state.state_since, now)` and `self._dt_elapsed(last_met_at, now)`.

Also replace `(now - state.last_value_at).total_seconds()` in `_check_flapping`.

This change is safe for production (PostgreSQL) because both datetimes will be tz-aware,
so the `if since.tzinfo is None` branch never fires.

### Expected root cause — test_services.py (1 failure)

`test_aggregated_readings` calls `SensorReadingsService.get_aggregated_readings(...)`.
If that method does not exist, the test raises `AttributeError`. Verify by reading
`services/sensor_readings_service.py`.

If the method is absent, add it. The test expects:
```python
result = svc.get_aggregated_readings(
    db, sensor_id,
    from_dt,  to_dt,
    bucket_minutes=60,
)
assert len(result.points) == 2  # two 60-min buckets from 5 readings
```

The method should bucket readings into `bucket_minutes`-width windows and return the
same `SensorTimeSeriesData` response model as `get_sensor_readings`. Each bucket's `value`
is the average of readings in that window. If no readings fall in a bucket, it is omitted.
Use SQLite-compatible SQL (no `date_trunc`; use Python-side grouping):

```python
def get_aggregated_readings(
    self,
    db: Session,
    sensor_id: int,
    from_ts: datetime,
    to_ts: datetime,
    bucket_minutes: int = 60,
) -> SensorTimeSeriesData:
    sensor = db.get(Sensor, sensor_id)
    if not sensor:
        raise ValueError(f"Sensor {sensor_id} not found")

    from DAL.models.sensor_reading import SensorReading
    readings = (
        db.query(SensorReading)
        .filter(
            SensorReading.sensor_id == sensor_id,
            SensorReading.timestamp >= from_ts,
            SensorReading.timestamp <= to_ts,
        )
        .order_by(SensorReading.timestamp.asc())
        .all()
    )

    if not readings:
        return SensorTimeSeriesData(
            sensor_id=sensor_id, unit=sensor.unit,
            points=[], min_value=None, max_value=None, avg_value=None,
        )

    from collections import defaultdict
    import math
    bucket_secs = bucket_minutes * 60
    origin = from_ts.replace(tzinfo=None) if from_ts.tzinfo else from_ts

    buckets: dict[int, list[float]] = defaultdict(list)
    for r in readings:
        ts = r.timestamp.replace(tzinfo=None) if r.timestamp.tzinfo else r.timestamp
        bucket_idx = int((ts - origin).total_seconds() // bucket_secs)
        buckets[bucket_idx].append(r.value)

    from routes.response_models.analytics import SensorTimeSeriesPoint
    points = []
    for idx in sorted(buckets):
        vals = buckets[idx]
        mid = origin + timedelta(seconds=idx * bucket_secs + bucket_secs / 2)
        points.append(SensorTimeSeriesPoint(
            timestamp=mid.isoformat(),
            value=sum(vals) / len(vals),
        ))

    all_vals = [r.value for r in readings]
    return SensorTimeSeriesData(
        sensor_id=sensor_id,
        unit=sensor.unit,
        points=points,
        min_value=min(all_vals),
        max_value=max(all_vals),
        avg_value=sum(all_vals) / len(all_vals),
    )
```

Check the actual `SensorTimeSeriesData` and `SensorTimeSeriesPoint` models before
writing this — adapt field names to match what exists.

### Possible causes — test_slice2.py

test_slice2.py builds a minimal FastAPI app with `sensor_router` and overrides
`get_current_user`. After reading the actual failures, fix any of:
- TestClient interaction issues (unlikely; the pattern is correct in principle).
- If `requires_role` in `middleware.py` captures `get_current_user` by reference at
  import time (not as a `Depends()` argument), the override won't propagate. The current
  implementation uses `Depends(get_current_user)` inside the closure, which FastAPI
  resolves via `dependency_overrides` correctly — but verify this matches the actual file.
- Any `ImportError` due to transitive dependencies of `sensor_routes.py` that don't exist
  in the test environment.

---

## Part A — Fix pre-existing test failures (P0)

1. **Run** the failing tests and read the output (as described above).
2. **Fix `alert_evaluator.py`** — add `_dt_elapsed()` helper; replace all datetime
   arithmetic that mixes tz-aware `now` with potentially tz-naive DB-loaded datetimes.
   Do **not** change any other business logic.
3. **Fix `sensor_readings_service.py`** — add `get_aggregated_readings()` if missing.
4. **Fix `test_slice2.py` and `test_slice3.py`** — if failures remain after the production
   code fixes above, apply the minimal fix needed (import corrections, fixture adjustments,
   assertion updates). Do **not** delete tests.
5. **Acceptance:** `pytest backend/tests/ -v` — all tests that were passing before
   Slice 11 still pass, AND all previously-failing tests in test_slice2.py, test_slice3.py,
   test_services.py now pass.

---

## Part B — test_alert_rules.py (P0)

**File to create:** `backend/tests/test_alert_rules.py`

Use the `db` fixture from `conftest.py`. No HTTP test client. Test the `AlertRule` ORM
model using the **actual** schema (`condition`, `threshold_lo`/`threshold_hi`, `severity`,
`dwell_seconds`, `is_enabled`).

```python
import pytest
from DAL.models.alert_rule import AlertRule
from DAL.models.alert_state import AlertState
from DAL.models.sensor import Sensor


def _make_sensor(db, name="TestSensor") -> Sensor:
    s = Sensor(moneo_sensor_id=f"ms-{name}", name=name,
               sensor_type="temperature", unit="°C")
    db.add(s); db.commit(); db.refresh(s)
    return s


def _make_rule(db, sensor_id: int, *, condition="gt", threshold_hi=100.0,
               severity="warning", dwell_seconds=60, name="High Temp") -> AlertRule:
    r = AlertRule(
        sensor_id=sensor_id, name=name, condition=condition,
        threshold_hi=threshold_hi, severity=severity,
        dwell_seconds=dwell_seconds, is_enabled=True,
    )
    db.add(r); db.commit(); db.refresh(r)
    return r


# ── create ────────────────────────────────────────────────────────────────

def test_create_rule(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    assert r.id is not None
    assert r.sensor_id == s.id
    assert r.condition == "gt"
    assert r.threshold_hi == 100.0
    assert r.severity == "warning"
    assert r.is_enabled is True
    assert r.policy == "auto_clear"
    assert r.dwell_seconds == 60
    assert r.recovery_dwell_seconds == 30


def test_rule_threshold_lo_hi(db):
    s = _make_sensor(db)
    r = AlertRule(sensor_id=s.id, name="Range", condition="outside_range",
                  threshold_lo=10.0, threshold_hi=90.0, severity="warning")
    db.add(r); db.commit(); db.refresh(r)
    assert r.threshold_lo == 10.0
    assert r.threshold_hi == 90.0


def test_rule_description_optional(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    assert r.description is None


def test_rule_with_description(db):
    s = _make_sensor(db)
    r = AlertRule(sensor_id=s.id, name="WithDesc", condition="gt",
                  threshold_hi=80.0, severity="critical", description="Too hot")
    db.add(r); db.commit(); db.refresh(r)
    assert r.description == "Too hot"


# ── query ─────────────────────────────────────────────────────────────────

def test_query_rules_for_sensor(db):
    s = _make_sensor(db)
    _make_rule(db, s.id, name="R1")
    _make_rule(db, s.id, name="R2")
    rules = db.query(AlertRule).filter(AlertRule.sensor_id == s.id).all()
    assert len(rules) == 2


def test_query_rules_empty_for_new_sensor(db):
    s = _make_sensor(db)
    rules = db.query(AlertRule).filter(AlertRule.sensor_id == s.id).all()
    assert rules == []


# ── update ────────────────────────────────────────────────────────────────

def test_update_threshold(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id, threshold_hi=100.0)
    r.threshold_hi = 120.0
    db.commit(); db.refresh(r)
    assert r.threshold_hi == 120.0


def test_disable_rule(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    r.is_enabled = False
    db.commit(); db.refresh(r)
    assert r.is_enabled is False


def test_filter_enabled_rules(db):
    s = _make_sensor(db)
    _make_rule(db, s.id, name="Enabled")
    r2 = _make_rule(db, s.id, name="Disabled")
    r2.is_enabled = False; db.commit()
    enabled = (db.query(AlertRule)
               .filter(AlertRule.sensor_id == s.id, AlertRule.is_enabled.is_(True))
               .all())
    assert len(enabled) == 1
    assert enabled[0].name == "Enabled"


# ── delete ────────────────────────────────────────────────────────────────

def test_delete_rule(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    rid = r.id
    db.delete(r); db.commit()
    assert db.get(AlertRule, rid) is None


def test_cascade_delete_when_sensor_deleted(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id)
    rid = r.id
    db.delete(s); db.commit()
    assert db.get(AlertRule, rid) is None


# ── condition / severity / policy values ──────────────────────────────────

def test_all_conditions(db):
    s = _make_sensor(db)
    for cond in ("gt", "lt", "outside_range", "inside_range"):
        r = _make_rule(db, s.id, condition=cond, name=f"r_{cond}")
        assert r.condition == cond


def test_critical_severity(db):
    s = _make_sensor(db)
    r = _make_rule(db, s.id, severity="critical")
    assert r.severity == "critical"


def test_manual_ack_policy(db):
    s = _make_sensor(db)
    r = AlertRule(sensor_id=s.id, name="ManualAck", condition="gt",
                  threshold_hi=80.0, severity="warning", policy="manual_ack")
    db.add(r); db.commit(); db.refresh(r)
    assert r.policy == "manual_ack"


def test_multiple_rules_independent(db):
    s1 = _make_sensor(db, "S1")
    s2 = _make_sensor(db, "S2")
    _make_rule(db, s1.id, name="R-S1")
    _make_rule(db, s2.id, name="R-S2")
    assert db.query(AlertRule).count() == 2
    assert db.query(AlertRule).filter(AlertRule.sensor_id == s1.id).count() == 1
```

That is **14 tests**. Verify they all pass: `pytest backend/tests/test_alert_rules.py -v`.

---

## Part C — Sensor range quick-edit inline panel (P1)

`SensorApiService.updateRanges()` already exists. The widget's `activeSensor` and
`editable` inputs are already in place. Add the inline ranges panel entirely inside
`DashboardWidgetComponent`.

### `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`

**1. Add fields** (near `activeSensor`):

```typescript
// ── Ranges editor ──────────────────────────────────────────────────────
rangesEditorOpen  = false;
rangesSaving      = false;
rangesSaveError: string | null = null;
rangesForm = {
  normal_min:    null as number | null,
  normal_max:    null as number | null,
  warning_min:   null as number | null,
  warning_max:   null as number | null,
  critical_min:  null as number | null,
  critical_max:  null as number | null,
  ranges_source: 'manual' as string,
};
```

**2. Inject `SensorApiService`** in the constructor (it may already be injected — check
before adding):

```typescript
constructor(
  ...,
  private readonly sensorApi: SensorApiService,
) {}
```

If `SensorApiService` is already injected under a different name, use the existing field.

**3. Add methods:**

```typescript
openRangesEditor(): void {
  const s = this.activeSensor;
  if (!s) return;
  this.rangesForm = {
    normal_min:    s.normal_min   ?? null,
    normal_max:    s.normal_max   ?? null,
    warning_min:   s.warning_min  ?? null,
    warning_max:   s.warning_max  ?? null,
    critical_min:  s.critical_min ?? null,
    critical_max:  s.critical_max ?? null,
    ranges_source: s.ranges_source ?? 'manual',
  };
  this.rangesSaveError = null;
  this.rangesEditorOpen = true;
  this.cdr.markForCheck();
}

closeRangesEditor(): void {
  this.rangesEditorOpen = false;
  this.rangesSaveError  = null;
  this.cdr.markForCheck();
}

async saveRanges(): Promise<void> {
  const s = this.activeSensor;
  if (!s || this.rangesSaving) return;
  this.rangesSaving    = true;
  this.rangesSaveError = null;
  this.cdr.markForCheck();
  try {
    const updated = await this.sensorApi.updateRanges(s.id, this.rangesForm);
    // Reflect updated bounds in the local sensor reference
    const idx = this.sensors.findIndex(x => x.id === s.id);
    if (idx >= 0) this.sensors[idx] = updated;
    this.activeSensor = updated;
    this.rangesEditorOpen = false;
    this.reload();          // reload chart to redraw annotations
  } catch {
    this.rangesSaveError = 'Failed to save. Check values and try again.';
  } finally {
    this.rangesSaving = false;
    this.cdr.markForCheck();
  }
}
```

### `frontend/src/app/modules/dashboard/dashboard-widget.component.html`

**1. Add the "Edit ranges" button** in the widget chrome — place it immediately before
the "Configure widget" button (which calls `configure.emit()`):

```html
<!-- Edit sensor ranges — only for single-sensor widgets when editable -->
<button
  type="button"
  class="icon-btn"
  title="Edit sensor ranges"
  *ngIf="editable && activeSensor && !rangesEditorOpen"
  (click)="openRangesEditor()"
>
  <span class="icon icon-muted">tune</span>
</button>
```

**2. Add the inline ranges panel** after the main widget content area but still inside
the `app-widget-shell` content. Place it as the last child of the outer widget wrapper
div (after the drill-down modal or chart area):

```html
<!-- Inline ranges editor panel -->
<div *ngIf="rangesEditorOpen" class="ranges-editor">
  <div class="ranges-editor__header">
    <span class="ranges-editor__title">Edit sensor ranges</span>
    <button type="button" class="icon-btn" (click)="closeRangesEditor()" title="Close">
      <span class="icon icon-muted">close</span>
    </button>
  </div>

  <div class="ranges-editor__grid">
    <label class="ranges-editor__label">Normal min</label>
    <input class="ranges-editor__input" type="number"
           [(ngModel)]="rangesForm.normal_min" placeholder="—">

    <label class="ranges-editor__label">Normal max</label>
    <input class="ranges-editor__input" type="number"
           [(ngModel)]="rangesForm.normal_max" placeholder="—">

    <label class="ranges-editor__label">Warning min</label>
    <input class="ranges-editor__input" type="number"
           [(ngModel)]="rangesForm.warning_min" placeholder="—">

    <label class="ranges-editor__label">Warning max</label>
    <input class="ranges-editor__input" type="number"
           [(ngModel)]="rangesForm.warning_max" placeholder="—">

    <label class="ranges-editor__label">Critical min</label>
    <input class="ranges-editor__input" type="number"
           [(ngModel)]="rangesForm.critical_min" placeholder="—">

    <label class="ranges-editor__label">Critical max</label>
    <input class="ranges-editor__input" type="number"
           [(ngModel)]="rangesForm.critical_max" placeholder="—">
  </div>

  <div *ngIf="rangesSaveError" class="ranges-editor__error">{{ rangesSaveError }}</div>

  <div class="ranges-editor__actions">
    <button class="btn btn-primary btn-sm" (click)="saveRanges()" [disabled]="rangesSaving">
      {{ rangesSaving ? 'Saving…' : 'Save' }}
    </button>
    <button class="btn btn-sm" (click)="closeRangesEditor()">Cancel</button>
  </div>
</div>
```

**Note on `ngModel`:** If `FormsModule` is not already imported in `DashboardModule`,
add it. Check `dashboard.module.ts` before modifying.

### `frontend/src/app/modules/dashboard/dashboard-widget.component.css`

Add:

```css
/* ── Inline ranges editor panel ──────────────────────────────────────── */

.ranges-editor {
  position: absolute;
  inset: 0;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow-y: auto;
}

.ranges-editor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ranges-editor__title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-fg);
}

.ranges-editor__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
  align-items: center;
}

.ranges-editor__label {
  font-size: 0.72rem;
  color: var(--color-fg-muted);
  text-align: right;
}

.ranges-editor__input {
  width: 100%;
  padding: 3px 6px;
  font-size: 0.8125rem;
  background: var(--color-surface-2, var(--color-surface-1));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-fg);
}

.ranges-editor__error {
  font-size: 0.72rem;
  color: var(--color-danger, #e64b3c);
}

.ranges-editor__actions {
  display: flex;
  gap: 8px;
}
```

---

## Part D — Admin alert rules tab (P2)

Only implement if Parts A–C are complete and `ng build` is green.

The admin panel already has a `core/alerts/alerts-api.service.ts`. Before writing
`AdminAlertRulesComponent`, read that service to understand its method signatures and
return types. Do not duplicate methods — use the existing service.

### `frontend/src/app/modules/admin/admin-alert-rules.component.ts`

```typescript
import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit,
} from '@angular/core';
import { AlertsApiService } from '../../core/alerts/alerts-api.service';
import { SensorApiService } from '../../core/sensors/sensor-api.service';
import { Sensor } from '../../types/sensor';

// Inline type for the alert rule shape returned by the alerts API
// Adapt field names if alerts-api.service.ts uses a different interface.
interface AlertRuleRow {
  id: number;
  sensor_id: number;
  name: string;
  condition: string;
  threshold_lo: number | null;
  threshold_hi: number | null;
  severity: string;
  dwell_seconds: number;
  policy: string;
  is_enabled: boolean;
  // row-level UI state
  saving: boolean;
}

@Component({
  selector: 'app-admin-alert-rules',
  standalone: false,
  templateUrl: './admin-alert-rules.component.html',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminAlertRulesComponent implements OnInit {
  rules: AlertRuleRow[] = [];
  sensors: Sensor[] = [];
  loading = true;
  error: string | null = null;

  showCreateForm = false;
  createSensorId: number | null = null;
  createName = '';
  createCondition = 'gt';
  createThresholdHi: number | null = null;
  createThresholdLo: number | null = null;
  createSeverity = 'warning';
  createDwellSeconds = 60;
  creating = false;

  readonly conditions = ['gt', 'lt', 'outside_range', 'inside_range'];
  readonly severities = ['warning', 'critical'];

  constructor(
    private readonly alertsApi: AlertsApiService,
    private readonly sensorApi: SensorApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadRules(), this.loadSensors()]);
  }

  async loadRules(): Promise<void> {
    this.loading = true; this.cdr.detectChanges();
    try {
      // Adapt the method call to match alertsApi's actual interface
      const rules = await this.alertsApi.listRules?.()
        ?? await (this.alertsApi as any).getRules?.()
        ?? [];
      this.rules = rules.map((r: any) => ({ ...r, saving: false }));
    } catch { this.error = 'Failed to load alert rules.'; }
    finally { this.loading = false; this.cdr.detectChanges(); }
  }

  async loadSensors(): Promise<void> {
    try { this.sensors = await this.sensorApi.listSensors(); }
    catch { /* non-critical */ }
  }

  sensorName(id: number): string {
    return this.sensors.find(s => s.id === id)?.name ?? String(id);
  }

  async toggleEnabled(row: AlertRuleRow): Promise<void> {
    row.saving = true; this.cdr.detectChanges();
    try {
      await (this.alertsApi as any).updateRule(row.id, { is_enabled: !row.is_enabled });
      row.is_enabled = !row.is_enabled;
    } catch { /* revert */ }
    finally { row.saving = false; this.cdr.detectChanges(); }
  }

  async deleteRule(row: AlertRuleRow): Promise<void> {
    if (!confirm(`Delete rule "${row.name}"?`)) return;
    try {
      await (this.alertsApi as any).deleteRule(row.id);
      this.rules = this.rules.filter(r => r.id !== row.id);
      this.cdr.detectChanges();
    } catch (e: any) {
      this.error = e?.error?.detail ?? 'Delete failed.';
      this.cdr.detectChanges();
    }
  }

  async createRule(): Promise<void> {
    if (!this.createName.trim() || this.createSensorId == null) return;
    this.creating = true; this.cdr.detectChanges();
    try {
      await (this.alertsApi as any).createRule({
        sensor_id: this.createSensorId,
        name: this.createName.trim(),
        condition: this.createCondition,
        threshold_lo: this.createThresholdLo,
        threshold_hi: this.createThresholdHi,
        severity: this.createSeverity,
        dwell_seconds: this.createDwellSeconds,
      });
      this.createName = ''; this.showCreateForm = false;
      await this.loadRules();
    } catch { this.creating = false; this.cdr.detectChanges(); }
    finally { this.creating = false; }
  }

  trackRule(_: number, r: AlertRuleRow): number { return r.id; }
}
```

**Important:** The `(this.alertsApi as any)` casts are a fallback because the actual
method names are unknown at design time. After reading `alerts-api.service.ts`, replace
each cast with the correct strongly-typed call.

**File to create:** `frontend/src/app/modules/admin/admin-alert-rules.component.html`

```html
<div class="admin-section">
  <div class="admin-section__header">
    <h2 class="admin-section__title">Alert Rules</h2>
    <button class="btn btn-primary btn-sm" (click)="showCreateForm = !showCreateForm">
      <span class="icon">add</span>{{ showCreateForm ? 'Cancel' : 'New Rule' }}
    </button>
  </div>

  <div *ngIf="showCreateForm" class="admin-create-form">
    <div class="form-row--inline">
      <div class="form-group">
        <label class="form-label">Sensor</label>
        <select class="form-select" [(ngModel)]="createSensorId">
          <option [ngValue]="null">— select —</option>
          <option *ngFor="let s of sensors" [ngValue]="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-input" [(ngModel)]="createName" placeholder="Rule name">
      </div>
      <div class="form-group">
        <label class="form-label">Condition</label>
        <select class="form-select" [(ngModel)]="createCondition">
          <option *ngFor="let c of conditions" [value]="c">{{ c }}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Threshold Hi</label>
        <input class="form-input" type="number" [(ngModel)]="createThresholdHi" placeholder="—">
      </div>
      <div class="form-group">
        <label class="form-label">Threshold Lo</label>
        <input class="form-input" type="number" [(ngModel)]="createThresholdLo" placeholder="—">
      </div>
      <div class="form-group">
        <label class="form-label">Severity</label>
        <select class="form-select" [(ngModel)]="createSeverity">
          <option *ngFor="let s of severities" [value]="s">{{ s }}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Dwell (s)</label>
        <input class="form-input" type="number" [(ngModel)]="createDwellSeconds">
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" (click)="createRule()"
              [disabled]="creating || !createName.trim() || createSensorId == null">
        {{ creating ? 'Creating…' : 'Create' }}
      </button>
    </div>
  </div>

  <div *ngIf="error" class="admin-alert admin-alert--error">{{ error }}</div>
  <div *ngIf="loading" class="admin-state">Loading…</div>

  <table *ngIf="!loading" class="admin-table">
    <thead>
      <tr>
        <th>ID</th><th>Sensor</th><th>Name</th><th>Condition</th>
        <th>Threshold</th><th>Severity</th><th>Dwell</th><th>Enabled</th><th></th>
      </tr>
    </thead>
    <tbody>
      <tr *ngFor="let row of rules; trackBy: trackRule">
        <td class="mono text-fg-muted">{{ row.id }}</td>
        <td>{{ sensorName(row.sensor_id) }}</td>
        <td>{{ row.name }}</td>
        <td class="mono">{{ row.condition }}</td>
        <td class="text-fg-muted" style="font-size:0.72rem">
          <span *ngIf="row.threshold_lo != null">≥{{ row.threshold_lo }} </span>
          <span *ngIf="row.threshold_hi != null">≤{{ row.threshold_hi }}</span>
        </td>
        <td>
          <span class="status-chip"
                [class.status-chip--warning]="row.severity === 'warning'"
                [class.status-chip--critical]="row.severity === 'critical'">
            {{ row.severity }}
          </span>
        </td>
        <td class="text-fg-muted">{{ row.dwell_seconds }}s</td>
        <td>
          <button class="btn btn-sm" [disabled]="row.saving"
                  (click)="toggleEnabled(row)">
            {{ row.is_enabled ? 'Disable' : 'Enable' }}
          </button>
        </td>
        <td>
          <button class="btn btn-danger btn-sm" (click)="deleteRule(row)">Del</button>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

**`admin.module.ts`** — add `AdminAlertRulesComponent` to declarations.

**`admin-page.component.ts`** — extend `AdminTab`:
```typescript
type AdminTab = 'kiosk-tokens' | 'users' | 'assets' | 'alert-rules';
```

**`admin-page.component.html`** — add fourth tab button and content:
```html
<button role="tab" class="admin-tab"
  [class.is-active]="activeTab === 'alert-rules'"
  (click)="setTab('alert-rules')">
  <span class="icon">notifications_active</span> Alert Rules
</button>
```
```html
<app-admin-alert-rules *ngIf="activeTab === 'alert-rules'"></app-admin-alert-rules>
```

---

## Verification checklist

1. `pytest backend/tests/ -v` — zero failures. Previously failing tests in
   test_slice2.py, test_slice3.py, test_services.py now pass.
2. `pytest backend/tests/test_alert_rules.py -v` — all 14 tests pass.
3. On a single-sensor widget in edit mode (owned dashboard), a `tune` icon button
   appears in the widget chrome. Clicking it opens the inline ranges panel.
4. Entering values and clicking Save calls `PUT /api/sensors/{id}/ranges`, closes the
   panel, and reloads the widget (chart annotations update).
5. Clicking Cancel closes the panel without saving.
6. (If Part D done) `/admin` → Alert Rules tab shows the rule list. Disable/Enable
   toggles `is_enabled`. Delete removes the row. Create form produces a new rule.
7. `ng build` — zero TypeScript errors, zero Angular errors.

---

## State block template

```
SLICE_11_COMPLETE

Part A (fix test failures): yes/no — N tests now pass (was N failures)
Part B (test_alert_rules.py): yes/no — N tests passed
Part C (sensor range quick-edit): yes/no
Part D (admin alert rules tab): yes/no/skipped

Issues encountered:
- <describe any deviations>

pytest backend/tests/: N passed / N failures
ng build: zero errors / <list errors>
```
