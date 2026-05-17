# Slice 13 — Time Picker Custom Range · Widget Editor Inherit Fix

## Context

Both §4.2 (time picker) and §4.4 (UX bundle) are **almost entirely already
implemented**. Before writing any code, read the relevant files — do not
re-implement anything listed as done below.

### Already done — do NOT change

| Feature | Evidence |
|---|---|
| `DashboardTimeService` (BehaviorSubject, presets, `loadFromDashboard`, `resolveWindow`) | `frontend/src/app/core/dashboard/time.service.ts` |
| Preset buttons (15m/1h/6h/24h/7d/30d) + auto-refresh select in toolbar | `dashboard.component.html` lines 38-59 |
| `onPresetSelected()`, `onAutoRefreshChanged()`, `_scheduleTimeRangeSave()` | `dashboard.component.ts` |
| Saves time range to `PUT /api/dashboards/{id}` (all 4 columns) | `_scheduleTimeRangeSave()` |
| Loads dashboard time range on select via `timeService.loadFromDashboard()` | `selectDashboardById()` |
| Widget subscribes to `timeService.range$` (debounced 250 ms) and reloads | `ngOnInit()` `_timeSub` |
| `_usesInheritedRange()` + `resolveWindow()` in widget | `dashboard-widget.component.ts` |
| `WidgetSettings.time_range_inherit?: boolean` | `frontend/src/app/types/widget.ts` |
| Widget catalog cards with SVG thumbnails, description, tags, bestFor | `widgetCatalog` in `dashboard.component.ts` |
| Smart defaults table + applied in `onWidgetSensorIdsChanged()` | `SENSOR_TYPE_DEFAULTS` |
| Drill-down modal (click chart point → nearby readings table) | `dashboard-widget.component.html` + `.ts` |
| Backend `GET /api/sensors/{id}/readings/around` | `sensor_routes.py` |
| Gauge wide/semi-circle mode via `ResizeObserver` | `gaugeWide` + `.gauge--wide` CSS |
| Drag-handle strip (opacity 0 → 1 on hover, `color-fg-muted`) | `app-widgets-shell.component.html/.css` |
| URL-shareable state (preset, ar, from, to, d in query params) | `DashboardUrlService` |
| `buildWidgetSettings()` correctly maps relative → `time_range_inherit: true` | `dashboard.component.ts` |

### What IS missing

Only **two** gaps remain:

**Gap 1 — "Custom" preset missing from toolbar.**
`presets: TimePreset[] = ['15m', '1h', '6h', '24h', '7d', '30d']` — the
`'custom'` preset is never exposed in the UI. `onPresetSelected('custom')` and
`_scheduleTimeRangeSave()` already handle it correctly; the toolbar just doesn't
offer the button or the from/to datetime inputs.

**Gap 2 — Widget editor round-trip bug + misleading label.**
`openWidgetEditor()` sets `timeMode = 'absolute'` for any widget that has
`time_range_inherit: true` (because the check is
`(s.time_range_hours ?? 0) > 0`, which is `false` when `time_range_hours` is
absent). A widget saved with "inherit" is then re-opened showing "From / To" mode.

Additionally, the `timeMode === 'relative'` radio is labelled **"Last X hours"**
and shows a `timeRangeHours` number input, but `buildWidgetSettings()` ignores
that input — it only sets `time_range_inherit: true`. The label is wrong and the
input is dead code.

---

## Part A (P0) — Custom time-range inputs in toolbar

### `frontend/src/app/modules/dashboard/dashboard.component.ts`

**Add `'custom'` to the presets array:**
```typescript
readonly presets: TimePreset[] = ['15m', '1h', '6h', '24h', '7d', '30d', 'custom'];
```

**Add a `customFrom` / `customTo` form state and update method.**
These only need to be reactive when `timeRange.preset === 'custom'`:

```typescript
customFrom = '';   // datetime-local string, e.g. "2025-01-15T08:00"
customTo   = '';   // datetime-local string

onCustomRangeChanged(): void {
  if (!this.customFrom || !this.customTo) return;
  this.timeRange = {
    ...this.timeRange,
    preset: 'custom',
    from: new Date(this.customFrom).toISOString(),
    to:   new Date(this.customTo).toISOString(),
  };
  this.timeService.setRange(this.timeRange);
  this._scheduleTimeRangeSave();
  this.refreshView();
  this._syncUrlFromState();
}
```

Also update `onPresetSelected()` to initialise `customFrom`/`customTo` when
switching to `'custom'`:
```typescript
onPresetSelected(preset: TimePreset): void {
  const hours = preset !== 'custom' ? PRESET_HOURS[preset] : undefined;
  this.timeRange = { ...this.timeRange, preset, hours };
  if (preset === 'custom') {
    // Initialise custom inputs to the current resolved window so they
    // show a meaningful starting value.
    const { from, to } = this.timeService.resolveWindow();
    this.customFrom = this._toLocalDatetimeString(new Date(from));
    this.customTo   = this._toLocalDatetimeString(new Date(to));
  }
  this.timeService.setRange(this.timeRange);
  this._scheduleTimeRangeSave();
  this.refreshView();
  this._syncUrlFromState();
}
```

Add a private helper that converts a `Date` to the `datetime-local` input format
(`"YYYY-MM-DDTHH:mm"`):
```typescript
private _toLocalDatetimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

Also initialise `customFrom` / `customTo` when loading a dashboard whose saved
range is `'custom'`. In `selectDashboardById()` (and `loadDashboards()`), after
`this.timeRange = this.timeService.current;` add:
```typescript
if (this.timeRange.preset === 'custom') {
  this.customFrom = this._toLocalDatetimeString(
    new Date(this.timeRange.from ?? new Date().toISOString()));
  this.customTo   = this._toLocalDatetimeString(
    new Date(this.timeRange.to   ?? new Date().toISOString()));
}
```
There are two places where `this.timeRange = this.timeService.current;` is
assigned (in `selectDashboardById` and in `loadDashboards`) — apply the
custom-init block in both.

### `frontend/src/app/modules/dashboard/dashboard.component.html`

The toolbar's time section currently ends after the auto-refresh select. Add the
custom date inputs **inside** `<div class="dashboard-toolbar__time">`, after the
`<select>` for auto-refresh:

```html
<!-- Custom date range — shown only when preset === 'custom' -->
<div class="time-custom-range" *ngIf="timeRange.preset === 'custom'">
  <input
    type="datetime-local"
    class="time-custom-input"
    [(ngModel)]="customFrom"
    (change)="onCustomRangeChanged()"
    [ngModelOptions]="{ standalone: true }"
    aria-label="Custom range from"
  />
  <span class="time-custom-sep">→</span>
  <input
    type="datetime-local"
    class="time-custom-input"
    [(ngModel)]="customTo"
    (change)="onCustomRangeChanged()"
    [ngModelOptions]="{ standalone: true }"
    aria-label="Custom range to"
  />
</div>
```

### `frontend/src/app/modules/dashboard/dashboard.component.css`

Add CSS for the custom range row after the existing `.time-refresh-select` block:

```css
.time-custom-range {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.time-custom-input {
  height: 30px;
  padding: 0 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  color: var(--color-fg);
  font-size: 0.75rem;
  cursor: pointer;
  /* Narrow so the row doesn't overflow on small viewports */
  width: 148px;
}

.time-custom-sep {
  font-size: 0.75rem;
  color: var(--color-fg-faint);
  user-select: none;
}
```

---

## Part B (P0) — Widget editor inherit round-trip fix + label cleanup

All changes are in two files only.

### `frontend/src/app/modules/dashboard/dashboard.component.ts`

**Fix 1 — `openWidgetEditor()` round-trip.**
The current line:
```typescript
timeMode: (s.time_range_hours ?? 0) > 0 ? 'relative' : 'absolute',
```
Replace with:
```typescript
timeMode: (s.time_range_inherit === true || (s.time_range_hours ?? 0) > 0)
  ? 'relative' : 'absolute',
```
This ensures a widget saved as "inherit dashboard" reopens in "relative" (inherit)
mode instead of incorrectly showing "absolute".

**Fix 2 — Remove `timeRangeHours` from `buildWidgetSettings`.**
The `timeRangeHours` field in `WidgetFormModel` is dead — `buildWidgetSettings`
never uses it. No change to `buildWidgetSettings` itself is needed (it already
only sets `time_range_inherit: true` for relative mode). The form model field can
stay; only the HTML changes.

### `frontend/src/app/modules/dashboard/dashboard.component.html`

**Fix 3 — Widget editor time section.**
In Section 3 "Time Range" of the widget editor (around line 406), replace the
entire time-mode sub-section:

**Remove:**
```html
<div class="flex gap-4 mb-2">
  <label class="flex items-center gap-2 text-sm text-fg-muted">
    <input type="radio" name="timeMode" value="relative" [(ngModel)]="widgetForm.timeMode" />
    <span>Last X hours</span>
  </label>
  <label class="flex items-center gap-2 text-sm text-fg-muted">
    <input type="radio" name="timeMode" value="absolute" [(ngModel)]="widgetForm.timeMode" />
    <span>From / To</span>
  </label>
</div>

<div class="dashboard-date-grid" *ngIf="widgetForm.timeMode === 'relative'">
  <label class="dashboard-form-field">
    <span class="dashboard-toolbar__label">Hours</span>
    <input class="dashboard-toolbar__input dashboard-toolbar__input--sm" type="number"
      [(ngModel)]="widgetForm.timeRangeHours" min="1" max="8760" />
  </label>
</div>
```

**Replace with:**
```html
<div class="flex gap-4 mb-2">
  <label class="flex items-center gap-2 text-sm text-fg-muted">
    <input type="radio" name="timeMode" value="relative" [(ngModel)]="widgetForm.timeMode" />
    <span>Inherit dashboard time range</span>
  </label>
  <label class="flex items-center gap-2 text-sm text-fg-muted">
    <input type="radio" name="timeMode" value="absolute" [(ngModel)]="widgetForm.timeMode" />
    <span>Override: fixed range</span>
  </label>
</div>

<div class="dashboard-editor-section__hint" *ngIf="widgetForm.timeMode === 'relative'">
  This widget follows the dashboard time picker. Change the preset in the
  toolbar to update all inheriting widgets at once.
</div>
```

The From / To `datetime-local` inputs below the radio (for `absolute` mode) are
correct and should not be changed.

---

## Verification

1. **Custom preset in toolbar:**
   - Open a dashboard. Toolbar shows: 15m · 1h · 6h · 24h · 7d · 30d · **custom**.
   - Click "custom" → button becomes active; two `datetime-local` inputs appear.
   - Set a from/to range → widgets reload with that exact window.
   - Reload the page → dashboard loads with saved custom range; inputs show the
     saved values.

2. **Widget editor inherit:**
   - Open a widget created from a line-chart catalog card (which defaults to
     `time_range_inherit: true`). Editor opens with "Inherit dashboard time range"
     selected (not "Override"). ✓
   - Change to "Override: fixed range" → From/To inputs appear. Save. Reopen →
     editor shows Override selected. ✓
   - Change back to "Inherit". Save. Reopen → shows Inherit. ✓

3. `ng build` — zero TypeScript errors, zero Angular errors.
4. `pytest backend/tests/` — all 116 tests still pass (no backend changes).

---

## SLICE_13_COMPLETE block format

```
SLICE_13_COMPLETE
Part A (custom time range in toolbar): yes/partial/no
Part B (widget editor inherit fix + label): yes/partial/no
Issues encountered: [deviations, unexpected behaviour, anything skipped]
pytest: N passed / N failed
ng build: zero errors / [errors]
```
