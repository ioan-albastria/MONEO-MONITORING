# Slice 5 — State

## What this slice covered

Closed out the remaining Trust-tier gap (outbox routing), cleaned up the dead
`openRangesEditor()` stub that was left over from Slice 3, and implemented the full
dashboard-level time picker (§4.2 of EXPANSION_PLAN): migration 0006, four new
`Dashboard` model columns, updated API + frontend types, `DashboardTimeService`,
toolbar preset buttons + auto-refresh selector, and widget subscription that delegates
`resolveWindow()` to the service.

---

## Parts completed

**Part 0 — Dead code cleanup**
`dashboard-widget.component.ts`: `openRangesEditor()` removed.

Note: `showRangesEditor`, `onRangesSaved()`, `closeRangesEditor()` were **not** on disk
— only `openRangesEditor()` existed (it called `configure.emit()`). All four were listed
in the SLICE_4_STATE outstanding section, but only one was actually present. Template
already had no tune button and no `<app-ranges-editor-drawer>` reference. No template
change required.

**Part A — Outbox notification routing**
`services/alert_evaluator.py`: `_enqueue_notifications()` added.

New imports: `from sqlalchemy import or_, and_` and
`from DAL.models.alert_notification_outbox import AlertNotificationOutbox`,
`from DAL.models.alert_route import AlertRoute`.

`_enqueue_notifications(db, rule, event)` queries `AlertRoute` records using
`or_`/`and_` scope matching (`all`, `rule`, `sensor`, `severity`); filters by
`on_fire`/`on_recover` flag depending on event state; writes one
`AlertNotificationOutbox` row per matched route.

Call sites in `_apply_state_machine()`:
- Line ~116: `ok → firing` (dwell elapsed immediately in the `ok` branch)
- Line ~135: `pending → firing`
- Line ~153: `firing → recovered`
- Line ~161: `firing → awaiting_ack`

**Part B — Migration 0006**
`migrations/versions/0006_dashboard_time_range.py` created.
- revision `0006`, down_revision `0005`
- Adds 4 nullable columns to `dashboards`:
  - `default_time_range_hours` (Integer)
  - `default_from` (DateTime with timezone)
  - `default_to` (DateTime with timezone)
  - `auto_refresh_seconds` (Integer)
- `downgrade()` drops all four columns.

**Part C — Dashboard model + API**
`DAL/models/dashboard.py`: four new `Mapped[]` columns added (matching migration 0006).

`routes/response_models/dashboard.py`: `DashboardRead` + `DashboardUpdate` extended
with `default_time_range_hours`, `default_from`, `default_to`, `auto_refresh_seconds`.

`services/dashboard_service.py`: `update_dashboard()` uses `model_fields_set` to detect
explicitly-sent fields (including `None`), allowing callers to null out time-range values.
Field-by-field `if` checks used (instead of `exclude_unset`) to keep the explicit-null
detection reliable.

**Part D — Frontend Dashboard types**
`frontend/src/app/types/dashboard.ts`: `Dashboard` interface extended with
`default_time_range_hours`, `default_from`, `default_to`, `auto_refresh_seconds`.
`DashboardUpdate` partial type updated to match.

`frontend/src/app/types/widget.ts` (or `dashboard-widget.component.ts`):
`WidgetSettings` extended with `time_range_inherit?: boolean`.

**Part E — DashboardTimeService**
`frontend/src/app/core/dashboard/time.service.ts` created.

```typescript
export type TimePreset = '15m' | '1h' | '6h' | '24h' | '7d' | '30d' | 'custom';
export interface TimeRange {
  preset: TimePreset;
  hours?: number;
  from?: string;
  to?: string;
  autoRefreshSeconds: number;
}
export const PRESET_HOURS: Record<Exclude<TimePreset,'custom'>, number> = {
  '15m': 0.25, '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720,
};
```

`@Injectable({ providedIn: 'root' })` — singleton shared by toolbar + all widgets.

Key methods:
- `setRange(range)` — updates `BehaviorSubject<TimeRange>`, resets auto-refresh timer
- `loadFromDashboard(d)` — restores state from saved dashboard fields
- `resolveWindow()` — returns concrete `{ from: string; to: string }` ISO pair;
  for `custom` preset returns stored strings; for presets computes `now - hours * 3600s`
- `_resetRefreshTimer(seconds)` — clears previous `setInterval`, sets a new one that
  re-emits the current range object (triggering widget reloads)
- `ngOnDestroy()` — clears timer on service teardown

**Part F — DashboardComponent toolbar wiring**
`modules/dashboard/dashboard.component.ts` + `.html` updated:

- Toolbar preset buttons (15m, 1h, 6h, 24h, 7d, 30d) bound to `timeService.setRange()`
- Auto-refresh selector (`<select>`) bound to `autoRefreshSeconds` choice, included
  in each `setRange()` call
- Time range persisted to server on change: 500 ms debounce on `timeService.range$`
  subscription, then `dashboardsApiService.update(id, { default_time_range_hours, ... })`
- `loadFromDashboard()` called on both dashboard load paths (initial load + dashboard
  switch) so toolbar reflects the saved state on open

**Part G — Widget subscription to TimeService**
`modules/dashboard/dashboard-widget.component.ts` updated:

```typescript
// In ngOnInit():
this._timeSub = this.timeService.range$.pipe(
  skip(1),
  debounceTime(250)
).subscribe(() => {
  if (this._usesInheritedRange()) void this.reload();
});
```

`skip(1)` avoids the initial BehaviorSubject emission on subscribe.
`debounceTime(250)` coalesces rapid toolbar clicks.

New helper:
```typescript
private _usesInheritedRange(): boolean {
  const s = this.widget?.settings;
  if (!s) return false;
  if (s.time_range_inherit === false) return false;
  if (s.from && s.to && s.time_range_inherit === undefined) return false;
  return true;
}
```

Updated `resolveWindow()`:
```typescript
private resolveWindow(s: WidgetSettings): { from: string; to: string } {
  if (this._usesInheritedRange()) return this.timeService.resolveWindow();
  if (s.time_range_hours && s.time_range_hours > 0) { /* hours-based */ }
  return { from: s.from!, to: s.to! };
}
```

`DashboardTimeService` injected in widget constructor.

---

## Files created

| File | Notes |
|---|---|
| `backend/migrations/versions/0006_dashboard_time_range.py` | Migration — 4 time columns on dashboards |
| `frontend/src/app/core/dashboard/time.service.ts` | `DashboardTimeService` singleton |

---

## Files changed

| File | Change |
|---|---|
| `backend/DAL/models/dashboard.py` | 4 new `Mapped[]` columns |
| `backend/routes/response_models/dashboard.py` | `DashboardRead`/`DashboardUpdate` extended |
| `backend/services/dashboard_service.py` | `model_fields_set` pattern for time-range fields |
| `backend/services/alert_evaluator.py` | `_enqueue_notifications()` added; `or_`/`and_` imports |
| `frontend/src/app/types/dashboard.ts` | 4 new time-range fields on `Dashboard`/`DashboardUpdate` |
| `frontend/src/app/types/widget.ts` (or widget component) | `time_range_inherit?: boolean` in `WidgetSettings` |
| `frontend/src/app/modules/dashboard/dashboard.component.ts` | Toolbar wiring, persistence subscription |
| `frontend/src/app/modules/dashboard/dashboard.component.html` | Preset buttons + auto-refresh selector |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.ts` | `_timeSub`, `_usesInheritedRange()`, `resolveWindow()` delegation |

---

## Spec deviations

- `dashboard_service.update_dashboard()` uses explicit `model_fields_set` checks instead
  of `body.model_dump(exclude_unset=True)`. Semantically equivalent for null-clearing use
  cases; agent chose the more explicit form to match existing service patterns.
- `showRangesEditor`, `onRangesSaved()`, `closeRangesEditor()` were listed in the Part 0
  task but were not present on disk — only `openRangesEditor()` existed. Part 0 only
  removed that one method; no other change was needed.
- Flapping events (`flapping_started`, `flapping_stopped`) do **not** call
  `_enqueue_notifications()`. The method is wired only to the primary transitions:
  `firing`, `recovered`, `awaiting_ack`. Routing flapping events is a future gap.

---

## Build status

`ng build` — zero TypeScript errors, zero Angular errors. Two **pre-existing** bundle
budget warnings (initial bundle size and CSS size) remain; not introduced by Slice 5.

---

## Outstanding work entering Slice 6

1. **`test_slice3.py` + `test_slice4.py`** — backend test coverage still absent
   (carried from Slice 3). Slice 5 did not add test files either.
2. **Flapping notification gap** — `flapping_started`/`flapping_stopped` events written
   to `AlertEvent` but never enqueued in `AlertNotificationOutbox`.
3. **Leverage tier §4.1** — Hierarchical sensor browsing:
   - `parent_id` / `path` on Asset model (or Sensor model); tree API
   - `AssetTreePickerComponent` for sensor selection
   - Sensor path breadcrumbs in widget chrome
   - Estimated 5–7 days of work; the natural Slice 6 target.
