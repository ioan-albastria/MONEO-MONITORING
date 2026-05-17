# Slice 12 — Evaluator Tests · Alert Route Create Form · Analytics Cache

## Context

Slice 11 brought the backend test suite to 102 passing and zero failing. The alert
evaluator (`backend/services/alert_evaluator.py`) is fully implemented but has no
service-level integration tests — only TestClient-based tests in `test_slice3.py`.
The alerts UI is mostly complete: `AlertsListComponent`, `AlertRulesListComponent`,
and `AlertRoutesListComponent` (list/toggle/delete) all work, but `AlertRoutesListComponent`
has no create form. Finally, the `GET /api/analytics` endpoint is called on every
chart widget update with no caching, causing redundant DB queries.

**File locations to be aware of:**

| Area | Paths |
|---|---|
| Evaluator | `backend/services/alert_evaluator.py` |
| Conftest | `backend/tests/conftest.py` (provides `db` fixture) |
| Models | `backend/DAL/models/alert_rule.py`, `alert_state.py`, `alert_event.py`, `annotation.py`, `sensor.py`, `sensor_reading.py` |
| Analytics route | `backend/routes/analytics_routes.py` |
| Route component | `frontend/src/app/modules/alerts/alert-routes-list.component.ts/.html` |
| Alerts module | `frontend/src/app/modules/alerts/alerts.module.ts` |
| API service | `frontend/src/app/core/alerts/alerts-api.service.ts` |
| Alert types | `frontend/src/app/types/alert.ts` |

**Key model facts (read before writing tests):**

- `AlertState` PK is `rule_id` (not `id`). Look it up with `db.get(AlertState, rule.id)`.
- `SensorReading` column is `timestamp` (not `recorded_at`).
- `Sensor` required constructor args: `moneo_sensor_id`, `name`, `sensor_type`, `unit`.
- `conftest.py` `db` fixture uses `autoflush=False`. See the annotation-close test note below.
- `AlertEvaluator.evaluate()` does **not** commit — the caller owns the transaction.
  All tests must call `db.commit()` or `db.flush()` after `evaluate()` before asserting.
- `_dt_elapsed()` handles SQLite naive/tz-aware mismatch already. When backdating
  `state.state_since` in tests, use `datetime.utcnow() - timedelta(...)` (naive).
- `AlertRoute.scope_severity` type is `string | null` (not a strict union) in the TS
  type, so no cast is needed.

---

## Part A (P0) — `backend/tests/test_alert_evaluator.py`

Create `backend/tests/test_alert_evaluator.py` with **14 tests** using the `db` fixture
from `conftest.py`. Do not use `TestClient`. Do not use `StaticPool`. The tests exercise
`AlertEvaluator.evaluate()` and `AlertEvaluator.evaluate_no_data()` directly against the
SQLite in-memory database.

### Helper functions (define at module level)

```python
from datetime import datetime, timedelta, timezone

import pytest

from DAL.models.alert_event import AlertEvent
from DAL.models.alert_rule import AlertRule
from DAL.models.alert_state import AlertState
from DAL.models.annotation import Annotation
from DAL.models.sensor import Sensor
from DAL.models.sensor_reading import SensorReading
from services.alert_evaluator import AlertEvaluator


def _make_sensor(db, moneo_sensor_id="S1"):
    s = Sensor(moneo_sensor_id=moneo_sensor_id, name="Test Sensor",
               sensor_type="temperature", unit="°C")
    db.add(s); db.commit(); db.refresh(s)
    return s


def _make_rule(db, sensor_id, *,
               condition="gt",
               threshold_hi=100.0,
               threshold_lo=None,
               severity="warning",
               dwell_seconds=0,
               recovery_dwell_seconds=0,
               policy="auto_clear",
               is_enabled=True):
    r = AlertRule(
        sensor_id=sensor_id,
        name="Test Rule",
        condition=condition,
        threshold_hi=threshold_hi,
        threshold_lo=threshold_lo,
        severity=severity,
        dwell_seconds=dwell_seconds,
        recovery_dwell_seconds=recovery_dwell_seconds,
        policy=policy,
        is_enabled=is_enabled,
    )
    db.add(r); db.commit(); db.refresh(r)
    return r


def _make_reading(db, sensor_id, value):
    r = SensorReading(sensor_id=sensor_id, value=value,
                      timestamp=datetime.utcnow())
    db.add(r); db.commit(); db.refresh(r)
    return r
```

### Tests

**1. `test_no_rules_creates_no_state`**
Create a sensor and a reading. Call `evaluate()` with no rules in the DB.
Assert `db.query(AlertState).count() == 0` and `db.query(AlertEvent).count() == 0`.

**2. `test_disabled_rule_is_skipped`**
Create sensor, rule with `is_enabled=False`, reading with value 150 (> threshold_hi=100).
Call `evaluate()`. Assert no `AlertState` or `AlertEvent` created.

**3. `test_no_data_rule_skipped_by_evaluate`**
Create sensor, rule with `condition="no_data"`, reading with value 150.
Call `evaluate()`. The evaluator filters out `condition="no_data"` rules — assert no state created.

**4. `test_gt_below_threshold_no_state`**
Sensor + gt rule (threshold_hi=100), reading value=50.
Call `evaluate()`, `db.commit()`. Assert no `AlertState` created.

**5. `test_gt_zero_dwell_fires_immediately`**
Sensor + gt rule (threshold_hi=100, dwell_seconds=0), reading value=150.
Call `evaluate()`, `db.commit()`.
Assert `db.get(AlertState, rule.id)` has `current_state == "firing"`.
Assert `db.query(AlertEvent).filter_by(rule_id=rule.id, state="firing").count() == 1`.

**6. `test_gt_positive_dwell_creates_pending`**
Sensor + gt rule (threshold_hi=100, dwell_seconds=60), reading value=150.
Call `evaluate()`, `db.commit()`.
Assert state `current_state == "pending"`.

**7. `test_pending_to_firing_after_dwell_elapsed`**
Sensor + gt rule (dwell_seconds=60), reading value=150 → first evaluate creates pending.
Then:
```python
state = db.get(AlertState, rule.id)
state.state_since = datetime.utcnow() - timedelta(seconds=61)
db.commit()
reading2 = _make_reading(db, sensor.id, 150.0)
evaluator.evaluate(db, sensor, reading2)
db.commit()
state = db.get(AlertState, rule.id)
assert state.current_state == "firing"
```

**8. `test_pending_clears_when_condition_not_met`**
Sensor + gt rule (dwell_seconds=60). First evaluate with value=150 → pending.
Second evaluate with value=50 (below threshold). `db.commit()`.
Assert `db.get(AlertState, rule.id) is None` (state deleted when condition clears
from pending).

**9. `test_firing_auto_clear_on_recovery`**
Create a firing state manually:
```python
state = AlertState(
    rule_id=rule.id,
    current_state="firing",
    state_since=datetime.utcnow(),
    last_value=150.0,
    last_value_at=datetime.utcnow() - timedelta(seconds=10),
)
db.add(state); db.commit()
```
Rule must have `recovery_dwell_seconds=0, policy="auto_clear"`.
Evaluate with value=50. `db.commit()`.
Assert `db.get(AlertState, rule.id) is None` (state deleted on auto_clear).
Assert a "recovered" event exists: `db.query(AlertEvent).filter_by(state="recovered").count() >= 1`.

**10. `test_firing_manual_ack_transitions_to_awaiting_ack`**
Same as test 9 but `policy="manual_ack"`.
Evaluate with value=50. `db.commit()`.
Assert state `current_state == "awaiting_ack"` (state NOT deleted).

**11. `test_firing_creates_annotation`**
Sensor + gt rule (dwell_seconds=0, severity="warning"), reading value=150.
`evaluator.evaluate(db, sensor, reading)`, `db.commit()`.
Assert `db.query(Annotation).filter_by(scope_kind="sensor", scope_id=sensor.id).count() == 1`.
Assert the annotation's `label` starts with "[WARNING]".

**12. `test_recovery_closes_annotation`**

**Note on autoflush=False and `source_event_id`:** The `conftest.py` `db` fixture uses
`autoflush=False`. Inside `AlertEvaluator._write_annotation()`, `event.id` is `None`
at construction time (not yet flushed). Therefore `Annotation.source_event_id` is `None`
in SQLite tests, and `_close_open_annotation()` — which queries annotations by
`source_event_id IN (firing event ids)` — will not find the annotation to close it.

To test annotation closing correctly, set up the firing state and annotation manually
with correct IDs, then call `evaluate()` for the recovery:

```python
sensor = _make_sensor(db)
rule = _make_rule(db, sensor.id, dwell_seconds=0, recovery_dwell_seconds=0,
                  policy="auto_clear")

# Create firing event explicitly, flush to get ID
firing_event = AlertEvent(rule_id=rule.id, sensor_id=sensor.id,
                          state="firing", observed_value=150.0,
                          observed_at=datetime.utcnow())
db.add(firing_event); db.flush()  # populates firing_event.id

# Create annotation referencing that event ID
ann = Annotation(kind="alert", scope_kind="sensor", scope_id=sensor.id,
                 label=f"[WARNING] {rule.name}",
                 started_at=datetime.utcnow(),
                 source_event_id=firing_event.id)
db.add(ann)

# Create firing AlertState
state = AlertState(rule_id=rule.id, current_state="firing",
                   state_since=datetime.utcnow(), last_value=150.0,
                   last_value_at=datetime.utcnow() - timedelta(seconds=10))
db.add(state); db.commit()

# Evaluate with recovery reading
reading = _make_reading(db, sensor.id, 50.0)
evaluator.evaluate(db, sensor, reading)
db.commit()

ann = db.query(Annotation).first()
assert ann.ended_at is not None
```

**13. `test_evaluate_no_data_fires_immediately`**
Create sensor, rule with `condition="no_data", dwell_seconds=0`.
Call `evaluator.evaluate_no_data(db, sensor, rule)`, `db.commit()`.
Assert state `current_state == "firing"`.

**14. `test_multiple_rules_independent`**
Create sensor and TWO rules:
- rule_a: condition="gt", threshold_hi=100, dwell_seconds=0
- rule_b: condition="lt", threshold_lo=0, dwell_seconds=0

Evaluate with value=150 (triggers rule_a, not rule_b). `db.commit()`.
Assert `db.get(AlertState, rule_a.id).current_state == "firing"`.
Assert `db.get(AlertState, rule_b.id) is None`.

---

## Part B (P1) — Alert route create form in `AlertRoutesListComponent`

### `frontend/src/app/modules/alerts/alerts.module.ts`

`AlertsModule` currently does **not** import `FormsModule`. Add `FormsModule` from
`@angular/forms` to the `imports` array. `FormsModule` is needed for `[(ngModel)]` in
the create form.

### `frontend/src/app/modules/alerts/alert-routes-list.component.ts`

The component uses `ChangeDetectionStrategy.OnPush` — every state mutation must be
followed by `this.cdr.markForCheck()`.

Add these fields (after the existing `routes`, `loading`, `error` fields):

```typescript
createOpen    = false;
createSaving  = false;
createError: string | null = null;

// Form model fields
createScopeKind     = 'all';
createScopeId: number | null = null;
createScopeSeverity: string | null = null;
createChannel       = 'in_app';
createTarget        = '';
createOnFire        = true;
createOnRecover     = true;
```

Add `createRoute()` method:

```typescript
async createRoute(): Promise<void> {
  this.createSaving = true;
  this.createError = null;
  this.cdr.markForCheck();
  try {
    const body: Partial<AlertRoute> = {
      scope_kind: this.createScopeKind as AlertRoute['scope_kind'],
      scope_id: ['rule', 'sensor', 'asset'].includes(this.createScopeKind)
        ? this.createScopeId : null,
      scope_severity: this.createScopeKind === 'severity'
        ? this.createScopeSeverity : null,
      channel: this.createChannel as AlertRoute['channel'],
      target: this.createChannel === 'in_app' ? '' : this.createTarget,
      on_fire: this.createOnFire,
      on_recover: this.createOnRecover,
      is_enabled: true,
    };
    const created = await this.alertsApi.createRoute(body);
    this.routes = [...this.routes, created];
    this.createOpen = false;
    this._resetCreateForm();
  } catch {
    this.createError = 'Failed to create route.';
  } finally {
    this.createSaving = false;
    this.cdr.markForCheck();
  }
}

private _resetCreateForm(): void {
  this.createScopeKind     = 'all';
  this.createScopeId       = null;
  this.createScopeSeverity = null;
  this.createChannel       = 'in_app';
  this.createTarget        = '';
  this.createOnFire        = true;
  this.createOnRecover     = true;
  this.createError         = null;
}
```

### `frontend/src/app/modules/alerts/alert-routes-list.component.html`

At the top of the `.alert-routes-list` div (before the loading indicator), add a "New
Route" toggle button and the inline create form panel:

```html
<div class="routes-toolbar">
  <button type="button" class="btn btn-sm btn-primary"
          *ngIf="!createOpen"
          (click)="createOpen = true; cdr.markForCheck()">
    + New Route
  </button>
</div>

<div class="routes-create-panel" *ngIf="createOpen">
  <div *ngIf="createError" class="routes-state routes-state--error">{{ createError }}</div>

  <div class="create-row">
    <label>Scope</label>
    <select [(ngModel)]="createScopeKind">
      <option value="all">All</option>
      <option value="rule">Rule</option>
      <option value="sensor">Sensor</option>
      <option value="asset">Asset</option>
      <option value="severity">Severity</option>
    </select>

    <input *ngIf="['rule','sensor','asset'].includes(createScopeKind)"
           type="number" [(ngModel)]="createScopeId"
           placeholder="ID" style="width:80px" />

    <select *ngIf="createScopeKind === 'severity'"
            [(ngModel)]="createScopeSeverity">
      <option value="warning">Warning</option>
      <option value="critical">Critical</option>
    </select>
  </div>

  <div class="create-row">
    <label>Channel</label>
    <select [(ngModel)]="createChannel">
      <option value="in_app">In-app</option>
      <option value="email">Email</option>
      <option value="webhook">Webhook</option>
    </select>
  </div>

  <div class="create-row" *ngIf="createChannel !== 'in_app'">
    <label>Target</label>
    <input type="text" [(ngModel)]="createTarget"
           [placeholder]="createChannel === 'email' ? 'email@example.com' : 'https://...'" />
  </div>

  <div class="create-row">
    <label>
      <input type="checkbox" [(ngModel)]="createOnFire" />
      On fire
    </label>
    <label>
      <input type="checkbox" [(ngModel)]="createOnRecover" />
      On recover
    </label>
  </div>

  <div class="create-actions">
    <button type="button" class="btn btn-sm btn-primary"
            [disabled]="createSaving"
            (click)="createRoute()">
      {{ createSaving ? 'Saving…' : 'Save' }}
    </button>
    <button type="button" class="btn btn-sm btn-ghost"
            [disabled]="createSaving"
            (click)="createOpen = false; _resetCreateForm()">
      Cancel
    </button>
  </div>
</div>
```

**Note:** `_resetCreateForm()` is private in the `.ts` — rename it to `resetCreateForm()`
(public, no underscore) if calling it from the template. Alternatively keep the
underscore but call it from a public `cancelCreate()` method:

```typescript
cancelCreate(): void {
  this.createOpen = false;
  this._resetCreateForm();
  this.cdr.markForCheck();
}
```

And update the Cancel button to `(click)="cancelCreate()"`.

**Note:** `(click)="createOpen = true; cdr.markForCheck()"` — Angular templates cannot
call `cdr.markForCheck()` directly (it's a private injected dependency). Replace with:

```typescript
openCreateForm(): void {
  this.createOpen = true;
  this.cdr.markForCheck();
}
```

And use `(click)="openCreateForm()"` in the template.

---

## Part C (P2) — Analytics endpoint TTL cache

### New file: `backend/utils/simple_cache.py`

```python
"""Tiny in-memory TTL cache, suitable for analytics responses."""
import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
_TTL_SECONDS: int = 60


def cache_get(key: str) -> Any | None:
    """Return cached value if still within TTL, else None."""
    entry = _store.get(key)
    if entry is None:
        return None
    ts, value = entry
    if time.time() - ts > _TTL_SECONDS:
        del _store[key]
        return None
    return value


def cache_set(key: str, value: Any) -> None:
    """Store value under key, timestamped now."""
    _store[key] = (time.time(), value)


def make_key(*parts: Any) -> str:
    """Stable string key from arbitrary positional parts."""
    return "|".join(str(p) for p in parts)
```

### `backend/routes/analytics_routes.py`

Wrap the service call with cache lookup/store. Replace the current `try/except` block:

```python
from utils.simple_cache import cache_get, cache_set, make_key

# inside get_analytics():
key = make_key(
    sorted(sensor_ids),
    from_timestamp.isoformat(),
    to_timestamp.isoformat(),
    aggregated,
    bucket_minutes,
)
cached = cache_get(key)
if cached is not None:
    return cached

try:
    result = _service.get_multi_sensor_analytics(
        db,
        sensor_ids,
        from_timestamp,
        to_timestamp,
        aggregated=aggregated,
        bucket_minutes=bucket_minutes,
    )
    cache_set(key, result)
    return result
except ValueError as e:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
```

The `from utils.simple_cache import ...` import goes at the top of `analytics_routes.py`
alongside the existing imports.

---

## Verification

1. `pytest backend/tests/` — **≥116 passed** (102 existing + 14 new), 0 failures.
   Run with `pytest backend/tests/test_alert_evaluator.py -v` to see each test name.

2. `ng build` — zero TypeScript errors, zero Angular errors.

3. Manual check: In the Alerts page → "Notification Routes" tab, a "+ New Route" button
   appears above the table (or empty-state message). Clicking it opens the inline form;
   "Scope" select changes between All / Rule / Sensor / Asset / Severity; when Severity
   is selected, a warning/critical select appears; "Channel" select changing to email/webhook
   shows the Target field; Save creates the route and adds it to the list; Cancel hides
   the form.

4. Repeated `GET /api/analytics?sensor_id=1&...` calls within 60 s return identical
   responses without hitting the DB a second time (verify via server logs if needed).

---

## SLICE_12_COMPLETE block format

When done, report back with:

```
SLICE_12_COMPLETE
Part A (test_alert_evaluator.py): yes/partial/no — N tests pass
Part B (alert route create form): yes/partial/no
Part C (analytics TTL cache): yes/partial/no
Issues encountered: [list deviations, unexpected behaviours, anything skipped]
pytest: N passed / N failed
ng build: zero errors / [errors]
```
