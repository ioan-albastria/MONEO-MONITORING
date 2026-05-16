# Slice 7 — UX Polish Bundle (§4.4)

## Role and constraints

You are implementing a pre-designed feature slice for the MONEO sensor dashboard. Follow
every instruction exactly. Do not introduce new abstractions, rename existing files, or
modify files outside the scope listed. Never commit — the user controls git. Never use
worktrees.

**Stack:** FastAPI + SQLAlchemy 2 (`Mapped[]`/`mapped_column()`) + Pydantic v2 + Alembic.
Angular 20 NgModules (not standalone), `ChangeDetectionStrategy.OnPush` +
`ChangeDetectorRef.markForCheck()` on widget components. `DashboardComponent` uses
default CD with `cdr.detectChanges()`.

**Project root:** `C:\Work\Albastria\FMC250\MONEO-MONITORING\`
**Backend root:** `backend\` · **Frontend root:** `frontend\src\app\`

---

## Context — what exists after Slice 6

### Migration chain
`0001` → … → `0006` → `0007` (asset hierarchy). Slice 7 adds **no migration** — all
changes are either pure frontend or additive API endpoints with no schema changes.

### Key files to know before touching anything

**`frontend/src/app/modules/dashboard/dashboard.component.ts`**
- `widgetCatalog: WidgetCatalogItem[]` at line ~137 — array of 4 entries (line_chart,
  bar_chart, gauge, stat_card). Each has `type`, `label`, `description`, `defaultCols`,
  `defaultRows`, `defaultSettings`. No thumbnail, no tags, no bestFor yet.
- `WidgetCatalogItem` interface defined locally in the file.
- `widgetForm: WidgetFormModel` includes `sensorIds: number[]`, `gaugeMin`, `gaugeMax`,
  `normalMax`, `warningMax`, `criticalMax`. The form is populated in
  `openWidgetCreator()` / `openWidgetEditor()`.
- `availableSensors: Sensor[]` still exists (used in range-cache logic).

**`frontend/src/app/modules/dashboard/dashboard.component.html`**
- Widget type picker section at line ~302: a `<div class="dashboard-widget-picker">`
  containing buttons with `.dashboard-widget-picker__card`. Each card shows
  `.dashboard-widget-picker__title`, `.dashboard-widget-picker__description`, and a
  conditional `.dashboard-widget-picker__status` ("Selected"). No thumbnail element.
- Tree picker already wired: `<app-asset-tree-picker [selectedIds]="widgetForm.sensorIds"
  (selectedIdsChange)="widgetForm.sensorIds = $event">`.
- The `(selectedIdsChange)` binding calls `widgetForm.sensorIds = $event` **directly**
  in the template. To hook smart defaults, this needs to go through a method instead —
  change to `(selectedIdsChange)="onWidgetSensorIdsChanged($event)"`.

**`frontend/src/app/modules/dashboard/dashboard-widget.component.ts`**
- `applyGauge(reading, sensor)` at line ~410. Gauge rendering CSS is driven by
  `--gauge-progress` and `--gauge-color` custom properties set via `[style]` bindings.
- `chartType` field: `'apex' | 'gauge' | 'stat' | null`. The gauge template block is
  a simple `<div class="dashboard-gauge-grid">`.
- No `ResizeObserver` currently. No `gaugeWide` field.

**`frontend/src/app/modules/dashboard/dashboard-widget.component.html`** (gauge section)
```html
<div *ngIf="!loading && !error && chartType === 'gauge'" class="dashboard-gauge-grid">
  <div class="dashboard-gauge-card__dial"
       [style.--gauge-progress]="gaugePercent + '%'"
       [style.--gauge-color]="gaugeColor"
       [style.background]="gaugeBackground || null">
    ...
  </div>
  <div class="gauge-scale-row">...</div>
</div>
```

**`frontend/src/app/modules/widgets/app-widgets-shell.component.html`**
- Header/drag-handle is a `<header class="dashboard-widget-drag-handle ...">`. Currently
  no drag icon is visible — operators have no visual cue that the header is draggable.
  The entire header has `cursor-grab`.

**`frontend/src/app/modules/dashboard/asset-tree-picker.component.ts`** (Slice 6)
- Loads sensors via `sensorApi.listSensors()`. No sparkline data loaded.
- `TreeNode.sensors` contains full `Sensor[]`.
- Template renders sensor rows with name, unit, sensor_type. No sparkline SVG.

**`backend/routes/sensor_routes.py`**
- Routes defined in order: `GET ""`, `GET "/{sensor_id}"`, `GET "/{sensor_id}/readings"`,
  `GET "/{sensor_id}/latest"`, `PATCH "/{sensor_id}/active"`, `PUT "/{sensor_id}/ranges"`.
- **Critical:** new static-path routes (`/sparklines`, `/{sensor_id}/readings/around`)
  must be registered **before** `GET "/{sensor_id}"` to prevent FastAPI matching
  `"sparklines"` as a sensor_id integer. Place new routes at the top of the file.

---

## Priority guidance

**P0 — do first (pure frontend, no risk):**
Part A — Widget catalog cards with SVG thumbnails.
Part B — Smart defaults per sensor type.
Part C — Drag handle contrast fix.

**P1 — main work:**
Part D — Gauge aspect-ratio semi-circle.
Part E — Backend: sparklines endpoint + drill-down `around` endpoint.
Part F — Tree picker inline sparklines.
Part G — Drill-down modal on chart spike click.

**P2 — if time permits (complex, skip if running long):**
Part H — Bulk widget actions (shift-click, delete, duplicate).

---

## Part A — Widget catalog cards with SVG thumbnails (P0)

### `frontend/src/app/modules/dashboard/dashboard.component.ts`

Extend the `WidgetCatalogItem` interface:

```typescript
interface WidgetCatalogItem {
  type: DashboardWidgetType;
  label: string;
  description: string;
  tags: string[];
  bestFor: string;
  thumbnail: string;      // inline SVG string
  defaultCols: number;
  defaultRows: number;
  defaultSettings: WidgetSettings;
}
```

Replace the four existing `widgetCatalog` entries with these (copy the `defaultCols`,
`defaultRows`, `defaultSettings` values unchanged — only add `tags`, `bestFor`,
`thumbnail`):

```typescript
readonly widgetCatalog: WidgetCatalogItem[] = [
  {
    type: 'line_chart',
    label: 'Line Chart',
    description: 'Time-series readings for one or more sensors over a window.',
    tags: ['time-series', 'multi-sensor'],
    bestFor: 'Trend analysis, pattern detection',
    thumbnail: `<svg viewBox="0 0 80 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="0" y1="36" x2="80" y2="36" stroke="currentColor" stroke-opacity="0.12" stroke-dasharray="3 3"/>
      <line x1="0" y1="24" x2="80" y2="24" stroke="currentColor" stroke-opacity="0.12" stroke-dasharray="3 3"/>
      <polyline points="0,38 13,30 26,33 40,15 53,21 66,13 80,17"
        stroke="#37c79a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <polygon points="0,38 13,30 26,33 40,15 53,21 66,13 80,17 80,48 0,48"
        fill="#37c79a" fill-opacity="0.10"/>
    </svg>`,
    defaultCols: 12, defaultRows: 5,
    defaultSettings: { sensor_ids: [], time_range_inherit: true, aggregated: true, bucket_minutes: 60, show_legend: true },
  },
  {
    type: 'bar_chart',
    label: 'Bar Chart',
    description: 'Aggregated values per sensor (avg / min / max in a bucket).',
    tags: ['comparison', 'multi-sensor'],
    bestFor: 'Comparing sensors side-by-side',
    thumbnail: `<svg viewBox="0 0 80 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5"  y="24" width="14" height="20" rx="3" fill="#56b9ff" fill-opacity="0.80"/>
      <rect x="23" y="12" width="14" height="32" rx="3" fill="#37c79a" fill-opacity="0.80"/>
      <rect x="41" y="18" width="14" height="26" rx="3" fill="#f5b428" fill-opacity="0.80"/>
      <rect x="59" y="8"  width="14" height="36" rx="3" fill="#56b9ff" fill-opacity="0.80"/>
    </svg>`,
    defaultCols: 8, defaultRows: 5,
    defaultSettings: { sensor_ids: [], time_range_inherit: true, aggregated: true, bucket_minutes: 60 },
  },
  {
    type: 'gauge',
    label: 'Gauge',
    description: 'Live circular gauge for the most recent reading of one sensor.',
    tags: ['real-time', 'single-sensor'],
    bestFor: 'Live process values, current state',
    thumbnail: `<svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 44 A30 30 0 1 1 70 44"
        stroke="currentColor" stroke-opacity="0.15" stroke-width="7" stroke-linecap="round" fill="none"/>
      <path d="M10 44 A30 30 0 0 1 58 17"
        stroke="#37c79a" stroke-width="7" stroke-linecap="round" fill="none"/>
      <circle cx="40" cy="44" r="14"
        fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/>
      <text x="40" y="49" text-anchor="middle" font-size="9" font-weight="600"
        fill="currentColor" fill-opacity="0.55">67%</text>
    </svg>`,
    defaultCols: 4, defaultRows: 4,
    defaultSettings: { sensor_ids: [], gauge_min: 0, gauge_max: 100 },
  },
  {
    type: 'stat_card',
    label: 'Stat Card',
    description: 'Single big number with trend label, live-updating.',
    tags: ['real-time', 'single-sensor'],
    bestFor: 'KPIs, current value at a glance',
    thumbnail: `<svg viewBox="0 0 80 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="8" y="34" font-size="26" font-weight="700"
        fill="currentColor" fill-opacity="0.75">42</text>
      <text x="54" y="26" font-size="9" fill="#37c79a" font-weight="600">+2.3%</text>
      <polyline points="8,44 22,40 36,42 50,36 64,38 78,32"
        stroke="#37c79a" stroke-width="1.5" fill="none" opacity="0.65"/>
    </svg>`,
    defaultCols: 4, defaultRows: 3,
    defaultSettings: { sensor_ids: [] },
  },
];
```

### `frontend/src/app/modules/dashboard/dashboard.component.html`

Replace the inner content of each `.dashboard-widget-picker__card` button to include
the thumbnail, tags, and bestFor text. Find the existing card loop and replace it:

```html
<div class="dashboard-widget-picker">
  <button
    *ngFor="let cat of widgetCatalog"
    type="button"
    class="dashboard-widget-picker__card"
    [class.is-active]="widgetForm.type === cat.type"
    (click)="selectWidgetType(cat.type)"
  >
    <div class="dashboard-widget-picker__thumb"
         [innerHTML]="cat.thumbnail"
         aria-hidden="true">
    </div>
    <div class="dashboard-widget-picker__card-body">
      <div class="dashboard-widget-picker__title">{{ cat.label }}</div>
      <div class="dashboard-widget-picker__description">{{ cat.description }}</div>
      <div class="dashboard-widget-picker__meta">
        <span *ngFor="let tag of cat.tags" class="dashboard-widget-picker__tag">{{ tag }}</span>
      </div>
      <div class="dashboard-widget-picker__best-for">
        Best for: {{ cat.bestFor }}
      </div>
    </div>
    <div class="dashboard-widget-picker__status" *ngIf="widgetForm.type === cat.type">
      ✓ Selected
    </div>
  </button>
</div>
```

### `frontend/src/app/modules/dashboard/dashboard.component.css` (or global CSS)

Add card styles (append to wherever dashboard picker styles live):

```css
.dashboard-widget-picker {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.dashboard-widget-picker__card {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  text-align: left;
  cursor: pointer;
  background: var(--color-surface-1);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.dashboard-widget-picker__card:hover {
  border-color: color-mix(in oklch, var(--color-brand) 45%, var(--color-border));
  box-shadow: var(--shadow-lev-1);
}
.dashboard-widget-picker__card.is-active {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-brand) 22%, transparent);
}

.dashboard-widget-picker__thumb {
  width: 100%;
  background: color-mix(in oklch, var(--color-surface-0) 65%, transparent);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 16px 10px;
}
.dashboard-widget-picker__thumb svg {
  width: 80px;
  height: 48px;
  color: var(--color-fg);
}

.dashboard-widget-picker__card-body {
  padding: 10px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.dashboard-widget-picker__title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-fg);
}

.dashboard-widget-picker__description {
  font-size: 0.72rem;
  color: var(--color-fg-muted);
  line-height: 1.4;
}

.dashboard-widget-picker__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.dashboard-widget-picker__tag {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--color-brand) 12%, transparent);
  color: var(--color-brand);
}

.dashboard-widget-picker__best-for {
  font-size: 0.7rem;
  color: var(--color-fg-faint);
  font-style: italic;
  margin-top: 1px;
}

.dashboard-widget-picker__status {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-brand);
  padding: 4px 12px 6px;
  border-top: 1px solid color-mix(in oklch, var(--color-brand) 20%, var(--color-border));
  background: color-mix(in oklch, var(--color-brand) 6%, transparent);
}
```

**Security note:** The `[innerHTML]="cat.thumbnail"` binding renders the SVG strings
in `widgetCatalog`. These strings are defined as constants in the component class, not
from user input, so there is no XSS risk. Angular's `DomSanitizer` will still flag
inline SVG injection. To avoid this, either:
- Import `DomSanitizer` and `SafeHtml` and mark the thumbnails as trusted:
  ```typescript
  import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
  // In the component:
  constructor(..., private sanitizer: DomSanitizer) {}
  // Build a trustedThumbnail map after widgetCatalog is defined:
  readonly trustedThumbnails: Record<DashboardWidgetType, SafeHtml> =
    Object.fromEntries(
      this.widgetCatalog.map(c => [c.type, this.sanitizer.bypassSecurityTrustHtml(c.thumbnail)])
    ) as Record<DashboardWidgetType, SafeHtml>;
  ```
  Then bind `[innerHTML]="trustedThumbnails[cat.type]"` in the template.
- Or store thumbnails as `SafeHtml` directly in `WidgetCatalogItem.thumbnail` after
  sanitizing in the constructor. Either approach works; pick the cleanest.

---

## Part B — Smart defaults per sensor type (P0)

### `frontend/src/app/modules/dashboard/dashboard.component.ts`

Add a constant near the top of the file (outside the class):

```typescript
const SENSOR_TYPE_DEFAULTS: Record<string, {
  gaugeMin: number; gaugeMax: number;
  normalMax: number | null; warningMax: number | null; criticalMax: number | null;
}> = {
  'temperature':  { gaugeMin: 0,   gaugeMax: 100,  normalMax: 60,   warningMax: 80,  criticalMax: 95  },
  'pressure':     { gaugeMin: 0,   gaugeMax: 10,   normalMax: 7,    warningMax: 8.5, criticalMax: 9.5 },
  'humidity':     { gaugeMin: 0,   gaugeMax: 100,  normalMax: 70,   warningMax: 85,  criticalMax: 95  },
  'distance':     { gaugeMin: 0,   gaugeMax: 500,  normalMax: null, warningMax: null, criticalMax: null },
  'vibration':    { gaugeMin: 0,   gaugeMax: 50,   normalMax: 20,   warningMax: 35,  criticalMax: 45  },
  'current':      { gaugeMin: 0,   gaugeMax: 20,   normalMax: 15,   warningMax: 18,  criticalMax: 19  },
  'voltage':      { gaugeMin: 0,   gaugeMax: 500,  normalMax: 400,  warningMax: 440, criticalMax: 480 },
  'flow':         { gaugeMin: 0,   gaugeMax: 100,  normalMax: 80,   warningMax: 90,  criticalMax: null },
};
```

### In `dashboard.component.html`

Change the tree picker binding from:
```html
(selectedIdsChange)="widgetForm.sensorIds = $event"
```
to:
```html
(selectedIdsChange)="onWidgetSensorIdsChanged($event)"
```

### In `dashboard.component.ts`

Add the handler method:

```typescript
onWidgetSensorIdsChanged(ids: number[]): void {
  this.widgetForm.sensorIds = ids;
  // Apply smart defaults in create mode when exactly one sensor is selected
  if (this.widgetEditorMode !== 'create' || ids.length !== 1) return;
  const sensor = this.availableSensors.find(s => s.id === ids[0]);
  if (!sensor?.sensor_type) return;
  const defaults = SENSOR_TYPE_DEFAULTS[sensor.sensor_type.toLowerCase()];
  if (!defaults) return;
  // Only fill in defaults that the user hasn't manually changed
  // (check against emptyWidgetForm() baseline values)
  const blank = this.emptyWidgetForm();
  if (this.widgetForm.gaugeMin === blank.gaugeMin) this.widgetForm.gaugeMin = defaults.gaugeMin;
  if (this.widgetForm.gaugeMax === blank.gaugeMax) this.widgetForm.gaugeMax = defaults.gaugeMax;
  if (this.widgetForm.normalMax  === blank.normalMax)  this.widgetForm.normalMax  = defaults.normalMax;
  if (this.widgetForm.warningMax === blank.warningMax) this.widgetForm.warningMax = defaults.warningMax;
  if (this.widgetForm.criticalMax === blank.criticalMax) this.widgetForm.criticalMax = defaults.criticalMax;
}
```

**Note:** The `availableSensors` array must be populated when the widget editor opens.
Check whether `openWidgetCreator()` / `openWidgetEditor()` already loads `availableSensors`.
If it was removed in Slice 6, restore it: `this.availableSensors = await this.sensorApi.listSensors()`.
If it's populated elsewhere (e.g., lazily), ensure it's available when
`onWidgetSensorIdsChanged` fires. The simplest fix: populate it eagerly in
`openWidgetCreator()` + `openWidgetEditor()` if not already done.

---

## Part C — Drag handle contrast fix (P0)

### `frontend/src/app/modules/widgets/app-widgets-shell.component.html`

Inside the `<header>` element, before the `<div class="flex items-start gap-3">`,
add a drag indicator strip:

```html
<header
  class="dashboard-widget-drag-handle shrink-0 ...existing classes..."
>
  <!-- Drag indicator strip — visible on hover, fades in -->
  <div class="widget-drag-strip" aria-hidden="true">
    <span class="icon widget-drag-icon">drag_handle</span>
  </div>

  <div class="flex items-start gap-3">
    <!-- ... existing content unchanged ... -->
  </div>
</header>
```

### `frontend/src/app/modules/widgets/app-widgets-shell.component.css`
(or in global CSS — wherever existing widget shell styles live)

```css
.widget-drag-strip {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 12px;
  margin-bottom: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}
.group:hover .widget-drag-strip,
.group:focus-within .widget-drag-strip {
  opacity: 1;
}

.widget-drag-icon {
  font-size: 16px;
  color: var(--color-fg-muted);
  user-select: none;
}
```

The `.group` class is already on the `<section>` element that wraps the shell — the
existing Tailwind `group` class drives the hover state propagation.

Also, strengthen the existing `cursor-grab` visual by ensuring the header background
shifts slightly on hover. Add to the header class or CSS:

```css
/* In app-widgets-shell.component.css */
.dashboard-widget-drag-handle:hover {
  background-color: color-mix(in oklch, var(--color-fg) 3%, transparent);
}
```

---

## Part D — Gauge aspect-ratio: semi-circle when wide (P1)

When the widget is wider than it is tall (aspect ratio > 1.4), render the gauge as a
semi-circle dial (speedometer style) instead of a full circle.

### `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`

Add field and ResizeObserver:

```typescript
gaugeWide = false;
private _gaugeResizeObs: ResizeObserver | null = null;
```

In `ngOnInit()` (or wherever the component acquires its host element), set up the
observer. Since `DashboardWidgetComponent` doesn't currently inject `ElementRef`,
add it:

```typescript
constructor(
  ...,
  private readonly el: ElementRef<HTMLElement>,
) {}
```

Add a private method called after the gauge loads:

```typescript
private _observeGaugeSize(): void {
  this._gaugeResizeObs?.disconnect();
  this._gaugeResizeObs = new ResizeObserver(entries => {
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;
    const wide = height > 0 && (width / height) > 1.4;
    if (wide !== this.gaugeWide) {
      this.gaugeWide = wide;
      this.cdr.markForCheck();
    }
  });
  this._gaugeResizeObs.observe(this.el.nativeElement);
}
```

Call `this._observeGaugeSize()` at the end of `applyGauge()`.

In `ngOnDestroy()`:
```typescript
this._gaugeResizeObs?.disconnect();
```

### `frontend/src/app/modules/dashboard/dashboard-widget.component.html`

Add `[class.gauge--wide]="gaugeWide"` to the gauge grid div:

```html
<div *ngIf="!loading && !error && chartType === 'gauge'"
     class="dashboard-gauge-grid"
     [class.gauge--wide]="gaugeWide">
```

### `frontend/src/app/modules/dashboard/dashboard-widget.component.css`

```css
/* Semi-circle mode: clip the dial to its bottom half */
.gauge--wide .dashboard-gauge-card__dial {
  /* Override width/height: fill the available width, half the height */
  width:  min(100cqw, 200px);
  height: min(calc(50cqw), 100px);
  border-radius: 999px 999px 0 0;
  overflow: hidden;
  /* Rotate the conic so the sweep spans the semicircle bottom.
     from 90deg: sweep starts at the right edge of the semicircle.
     progress maps 0-100% to 0deg-180deg (half circle). */
  background:
    conic-gradient(
      from 90deg,
      var(--gauge-color) 0 calc(var(--gauge-progress) / 2),
      color-mix(in oklch, var(--color-fg) 14%, var(--color-border))
        calc(var(--gauge-progress) / 2) 50%,
      transparent 50%
    ) !important;
}

.gauge--wide .dashboard-gauge-card__dial-inner {
  /* Shift the inner circle down so it peeks above the flat edge */
  border-radius: 999px;
  width: calc(100% - 20px);
  height: calc(200% - 20px);
  align-self: flex-start;
  margin-top: 10px;
}

.gauge--wide .gauge-scale-row {
  width: min(100cqw, 200px);
}
```

**Note:** The semi-circle CSS uses `!important` to override the inline `[style.background]`
binding when `gaugeBackground` (multi-zone gradient) is set. If `gaugeBackground` is
non-empty and `gaugeWide` is true, the multi-zone wide-mode gradient needs a separate
code path. For simplicity, when `gaugeWide` is true, clear `gaugeBackground` (no multi-zone
gradient in wide mode) — or generate a wide-mode version. The simplest acceptable approach:
when `gaugeWide`, bind `null` for `[style.background]` so the CSS class controls it.

Update the template binding:
```html
[style.background]="gaugeWide ? null : (gaugeBackground || null)"
```

---

## Part E — Backend: sparklines + drill-down endpoints (P1)

Both new routes use path prefixes that could conflict with `GET /{sensor_id}`.
**Place them at the top of `sensor_routes.py`**, before `GET /{sensor_id}`.

### `GET /api/sensors/sparklines`

```python
from datetime import timedelta

@sensor_router.get("/sparklines")
async def get_sensor_sparklines(
    ids: list[int] = Query(..., description="Sensor IDs"),
    minutes: int = Query(60, ge=5, le=1440),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a 12-point downsampled value array for each requested sensor.
    Response: [{"sensor_id": int, "points": [float, ...]}, ...]
    """
    from DAL.models.sensor_reading import SensorReading as SR
    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=minutes)
    result = []
    for sid in ids:
        readings = (
            db.query(SR)
            .filter(SR.sensor_id == sid, SR.timestamp >= since)
            .order_by(SR.timestamp.asc())
            .all()
        )
        if not readings:
            result.append({"sensor_id": sid, "points": []})
            continue
        target = 12
        if len(readings) <= target:
            pts = [r.value for r in readings]
        else:
            step = len(readings) / target
            pts = [readings[int(i * step)].value for i in range(target)]
        result.append({"sensor_id": sid, "points": pts})
    return result
```

Adjust the import at the top of `sensor_routes.py` to include `SensorReading` if not
already imported. `SensorReadingsService` may already do so — check the file.

### `GET /api/sensors/{sensor_id}/readings/around`

Add this route **after** `/sparklines` but **before** `GET /{sensor_id}/readings`:

```python
@sensor_router.get("/{sensor_id}/readings/around")
async def get_readings_around(
    sensor_id: int,
    at: datetime = Query(..., description="Centre timestamp (ISO 8601)"),
    radius: int = Query(10, ge=1, le=50),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return up to `radius` readings before and after `at`, sorted ascending.
    Response: [{"timestamp": str, "value": float}, ...]
    """
    from DAL.models.sensor_reading import SensorReading as SR
    before = (
        db.query(SR)
        .filter(SR.sensor_id == sensor_id, SR.timestamp <= at)
        .order_by(SR.timestamp.desc())
        .limit(radius)
        .all()
    )
    after = (
        db.query(SR)
        .filter(SR.sensor_id == sensor_id, SR.timestamp > at)
        .order_by(SR.timestamp.asc())
        .limit(radius)
        .all()
    )
    combined = sorted(before + after, key=lambda r: r.timestamp)
    return [{"timestamp": r.timestamp.isoformat(), "value": r.value} for r in combined]
```

### `frontend/src/app/core/sensors/sensor-api.service.ts`

Add two new methods:

```typescript
getSparklines(ids: number[], minutes = 60): Promise<{ sensor_id: number; points: number[] }[]> {
  let params = new HttpParams().set('minutes', String(minutes));
  ids.forEach(id => (params = params.append('ids', String(id))));
  return firstValueFrom(
    this.http.get<{ sensor_id: number; points: number[] }[]>(
      '/api/sensors/sparklines', { params }
    )
  );
}

getReadingsAround(
  sensorId: number,
  at: string,
  radius = 10
): Promise<{ timestamp: string; value: number }[]> {
  const params = new HttpParams().set('at', at).set('radius', String(radius));
  return firstValueFrom(
    this.http.get<{ timestamp: string; value: number }[]>(
      `/api/sensors/${sensorId}/readings/around`, { params }
    )
  );
}
```

---

## Part F — Tree picker inline sparklines (P1)

### `frontend/src/app/modules/dashboard/asset-tree-picker.component.ts`

Add sparkline loading after the initial data fetch:

```typescript
// New field:
sparklines = new Map<number, number[]>(); // sensor_id → points

// In ngOnInit, after Promise.all resolves:
void this._loadSparklines();

// New private method:
private async _loadSparklines(): Promise<void> {
  if (!this.allSensors.length) return;
  const ids = this.allSensors.map(s => s.id);
  try {
    const data = await this.sensorApi.getSparklines(ids, 60);
    for (const item of data) {
      if (item.points.length > 1) {
        this.sparklines.set(item.sensor_id, item.points);
      }
    }
    this.cdr.markForCheck();
  } catch {
    // Sparklines are optional — fail silently
  }
}

// Helper to build SVG path:
sparklinePath(sensorId: number): string {
  const pts = this.sparklines.get(sensorId);
  if (!pts || pts.length < 2) return '';
  const W = 64, H = 18;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  return pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - ((v - min) / range) * H * 0.85 - H * 0.075;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
```

Inject `SensorApiService` — it is already injected in the component.

### `frontend/src/app/modules/dashboard/asset-tree-picker.component.html`

In each sensor row (both the root-level and child-level sensor `<label>` blocks),
add the sparkline SVG after the sensor type label:

```html
<svg
  *ngIf="sparklinePath(sensor.id)"
  class="tree-node__sparkline"
  [attr.viewBox]="'0 0 64 18'"
  width="64" height="18"
  aria-hidden="true"
>
  <path [attr.d]="sparklinePath(sensor.id)"
    stroke="#37c79a" stroke-width="1.5" fill="none" stroke-linecap="round"/>
</svg>
```

### `frontend/src/app/modules/dashboard/asset-tree-picker.component.css`

```css
.tree-node__sparkline {
  flex-shrink: 0;
  opacity: 0.7;
  margin-left: auto;
}
```

---

## Part G — Drill-down modal on chart spike click (P1)

When a user clicks a data point on a line chart, show a modal with the ±10 raw readings
around that timestamp, plus any annotations within ±5 minutes.

### `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`

Add drill-down fields:

```typescript
drillOpen = false;
drillLoading = false;
drillTimestamp: string | null = null;
drillReadings: { timestamp: string; value: number }[] = [];
drillUnit = '';
```

In `applyLineChart()`, add `dataPointSelection` inside the `chart:` config object:

```typescript
chart: {
  type: 'line', height: '100%', toolbar: { show: false },
  zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
  animations: { easing: 'easeinout', speed: 220 },
  foreColor: theme.fgMuted,
  events: {
    dataPointSelection: (_e: unknown, _ctx: unknown, cfg: { seriesIndex: number; dataPointIndex: number }) => {
      const seriesData = this.latestAnalytics?.data[cfg.seriesIndex];
      if (!seriesData) return;
      const point = seriesData.points[cfg.dataPointIndex];
      if (!point) return;
      const sensorId = seriesData.sensor_id;
      void this.openDrillDown(sensorId, point.timestamp, seriesData.unit ?? '');
    },
  },
},
```

Add the drill-down methods:

```typescript
async openDrillDown(sensorId: number, timestamp: string, unit: string): Promise<void> {
  this.drillOpen    = true;
  this.drillLoading = true;
  this.drillTimestamp = timestamp;
  this.drillUnit    = unit;
  this.drillReadings = [];
  this.cdr.markForCheck();
  try {
    this.drillReadings = await this.sensorApi.getReadingsAround(sensorId, timestamp, 10);
  } catch {
    this.drillReadings = [];
  } finally {
    this.drillLoading = false;
    this.cdr.markForCheck();
  }
}

closeDrillDown(): void {
  this.drillOpen = false;
  this.cdr.markForCheck();
}
```

### `frontend/src/app/modules/dashboard/dashboard-widget.component.html`

Add the drill-down modal at the bottom of the template (inside `:host`):

```html
<!-- ─── Drill-down modal ─────────────────────────────────────────────────── -->
<div *ngIf="drillOpen" class="drill-modal" (click)="closeDrillDown()">
  <div class="drill-modal__panel" (click)="$event.stopPropagation()">
    <header class="drill-modal__header">
      <div class="drill-modal__title">
        Readings around
        <span class="text-fg-muted">{{ drillTimestamp | date:'dd MMM yyyy HH:mm:ss' }}</span>
      </div>
      <button type="button" class="icon-btn" (click)="closeDrillDown()" title="Close">
        <span class="icon icon-muted">close</span>
      </button>
    </header>
    <div class="drill-modal__body">
      <div *ngIf="drillLoading" class="drill-modal__state">Loading…</div>
      <table *ngIf="!drillLoading && drillReadings.length" class="drill-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Value{{ drillUnit ? ' (' + drillUnit + ')' : '' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let r of drillReadings"
              [class.drill-table__row--pivot]="r.timestamp === drillTimestamp">
            <td>{{ r.timestamp | date:'HH:mm:ss.SSS' }}</td>
            <td>{{ r.value | number:'1.2-4' }}</td>
          </tr>
        </tbody>
      </table>
      <div *ngIf="!drillLoading && !drillReadings.length" class="drill-modal__state">
        No readings found around this point.
      </div>
    </div>
  </div>
</div>
```

**Note:** `date` and `number` pipes require `CommonModule`. `DashboardModule` already
imports `CommonModule` via the Angular module system, so the pipes are available.

### `frontend/src/app/modules/dashboard/dashboard-widget.component.css`

```css
/* Drill-down modal */
.drill-modal {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xl);
}

.drill-modal__panel {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lev-2);
  width: min(420px, calc(100% - 24px));
  max-height: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drill-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-0);
}

.drill-modal__title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-fg);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.drill-modal__body {
  overflow-y: auto;
  flex: 1;
}

.drill-modal__state {
  padding: 20px;
  text-align: center;
  color: var(--color-fg-faint);
  font-size: 0.8rem;
}

.drill-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.drill-table th {
  text-align: left;
  padding: 6px 14px;
  color: var(--color-fg-muted);
  font-weight: 600;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-0);
  position: sticky;
  top: 0;
}

.drill-table td {
  padding: 5px 14px;
  border-bottom: 1px solid color-mix(in oklch, var(--color-border) 50%, transparent);
  color: var(--color-fg);
  font-variant-numeric: tabular-nums;
}

.drill-table__row--pivot td {
  background: color-mix(in oklch, var(--color-brand) 8%, transparent);
  font-weight: 600;
  color: var(--color-brand);
}
```

The drill-down modal uses `position: absolute` so it is contained within the widget
card. This avoids z-index conflicts with other widgets. The backdrop `(click)="closeDrillDown()"` closes the modal on background click; the panel `$event.stopPropagation()` prevents that.

---

## Part H — Bulk widget actions (P2 — skip if running long)

If time permits, add shift-click selection of multiple widgets in edit mode, with a
"Delete selected" action in the toolbar. This part is intentionally left high-level;
implement it if all P0/P1 parts are complete and build is green.

- `selectedWidgetIds: Set<number>` field in `DashboardComponent`.
- In edit mode, clicking a widget header adds/removes it from `selectedWidgetIds`.
  Shift-click should add contiguously.
- A selection bar appears at the bottom of the dashboard when `selectedWidgetIds.size > 0`:
  `{{ n }} selected · [Delete] [Duplicate] [Clear]`.
- Delete: bulk-calls `deleteWidget()` for each ID.
- Duplicate: calls the existing `duplicateWidget()` logic (if any) or a new POST-based
  copy endpoint.

This is genuinely P2 — skip entirely if any P1 part is incomplete or the build has issues.

---

## Verification checklist

1. Widget type picker in the editor shows SVG thumbnails, tags, and "Best for" lines.
   Cards have a thumbnail area above the text body. Selected card has brand border.
2. In create mode, selecting a `temperature` sensor auto-fills `gaugeMax = 100`,
   `normalMax = 60`, `warningMax = 80`, `criticalMax = 95`. Selecting a different sensor
   type fills different values. Edit mode does NOT change existing values.
3. Hovering over any widget card shows a faint `drag_handle` icon at the top of the header.
4. `GET /api/sensors/sparklines?ids=1,2&minutes=60` returns a list of `{sensor_id, points}`
   with at most 12 floats each. `GET /api/sensors/1/readings/around?at=<ISO>&radius=5`
   returns up to 10 readings centred on the timestamp.
5. Asset tree picker rows show a 64×18 sparkline SVG where readings are available; rows
   without readings show no SVG (no layout shift).
6. Clicking a line chart data point opens the drill-down modal. The clicked row is
   highlighted in brand colour. Background click closes the modal.
7. A gauge widget wider than it is tall renders a semi-circle dial. Resizing below the
   1.4 threshold restores the full circle.
8. `ng build` — zero TypeScript errors, zero Angular errors.

---

## State block template

```
SLICE_7_COMPLETE

Part A (catalog cards + SVG thumbnails): yes/no
Part B (smart defaults per sensor type): yes/no
Part C (drag handle contrast fix): yes/no
Part D (gauge semi-circle aspect ratio): yes/no
Part E (sparklines + around backend endpoints): yes/no
Part F (tree picker sparklines): yes/no
Part G (drill-down modal): yes/no
Part H (bulk widget actions): yes/no/skipped

Issues encountered:
- <describe any deviations>

ng build: zero errors / <list errors>
```
