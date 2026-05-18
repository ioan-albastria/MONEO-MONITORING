# Slice 7 — State

## What this slice covered

Implemented §4.4 UX Polish Bundle: widget catalog cards with SVG thumbnails, smart
sensor-type defaults in the widget creator, drag-handle contrast fix, gauge semi-circle
mode at wide aspect ratios, backend sparklines + drill-down `around` endpoints, inline
sparklines in the asset-tree picker, and a drill-down modal on chart data-point click.
Part H (bulk widget actions) was skipped as a P2 item.

---

## Parts completed

**Part A — Widget catalog cards + SVG thumbnails**
`DashboardComponent` `WidgetCatalogItem` interface extended with `tags: string[]`,
`bestFor: string`, `thumbnail: string` (inline SVG).

All four catalog entries updated with SVG thumbnails (line chart with filled area,
stacked bars, arc gauge, big-number stat). `[innerHTML]` bindings needed `DomSanitizer`
to suppress Angular's XSS warning — resolved in spec-deviations section below.

Template updated: `.dashboard-widget-picker__card` now renders a
`.dashboard-widget-picker__thumb` div (SVG area), a `.dashboard-widget-picker__card-body`
block (title + description + tags + best-for), and a `.dashboard-widget-picker__status`
footer strip when selected.

CSS added in `dashboard.component.css`: 2-column grid for the picker, card hover/active
border states, thumb area, tag chips (brand-tinted), best-for italic line, status strip.

**Part B — Smart defaults per sensor type**
`SENSOR_TYPE_DEFAULTS` constant added outside the class in `dashboard.component.ts`.
Covers 8 sensor types (`temperature`, `pressure`, `humidity`, `distance`, `vibration`,
`current`, `voltage`, `flow`).

`(selectedIdsChange)` binding in the template changed from inline assignment to
`onWidgetSensorIdsChanged($event)`.

`onWidgetSensorIdsChanged(ids: number[])` method added: sets `widgetForm.sensorIds`;
in create mode with a single sensor selected, looks up `SENSOR_TYPE_DEFAULTS` by
`sensor_type` and fills form fields only if they are still at baseline values (compared
against `emptyWidgetForm()`).

**Part C — Drag handle contrast fix**
`app-widgets-shell.component.html` updated: a `.widget-drag-strip` div (containing
a `drag_handle` Material icon) inserted inside the `<header>` before the main content
block.

CSS added to `app-widgets-shell.component.css`:
- `.widget-drag-strip` — `opacity: 0`, `transition: opacity 0.15s`.
- `.group:hover .widget-drag-strip, .group:focus-within .widget-drag-strip` — `opacity: 1`.
- `.dashboard-widget-drag-handle:hover` — subtle background tint via
  `color-mix(in oklch, var(--color-fg) 3%, transparent)`.

**Part D — Gauge aspect-ratio semi-circle**
`dashboard-widget.component.ts` extended:
- `gaugeWide = false` field.
- `_gaugeResizeObs: ResizeObserver | null = null` field.
- `ElementRef<HTMLElement>` injected in constructor.
- `_observeGaugeSize()` private method: disconnects previous observer (guard), creates
  new `ResizeObserver`, observes `el.nativeElement`, sets `gaugeWide = (width/height) > 1.4`.
- `_observeGaugeSize()` called at the end of `applyGauge()`.
- `ngOnDestroy()` calls `this._gaugeResizeObs?.disconnect()`.

`dashboard-widget.component.html`: `[class.gauge--wide]="gaugeWide"` added to the
gauge grid div. `[style.background]` changed to
`[style.background]="gaugeWide ? null : (gaugeBackground || null)"`.

CSS added: `.gauge--wide .dashboard-gauge-card__dial` — semi-circle shape, conic
gradient spans 0–180°. `.gauge--wide .dashboard-gauge-card__dial-inner` — inner circle
repositioned. `.gauge--wide .gauge-scale-row` — width capped.

**Part E — Backend sparklines + around endpoints**
`backend/routes/sensor_routes.py`:
- `GET /api/sensors/sparklines` placed **at the top** of the router (before
  `GET /{sensor_id}`). Returns `[{sensor_id, points: float[]}]` with up to 12
  downsampled values per sensor over a configurable window (`minutes`, 5–1440).
- `GET /api/sensors/{sensor_id}/readings/around` placed after `/sparklines`, before
  the existing `/{sensor_id}/readings`. Returns up to `radius` readings before and
  after the `at` timestamp, sorted ascending.

`frontend/src/app/core/sensors/sensor-api.service.ts`:
- `getSparklines(ids, minutes=60)` added — builds multi-value `ids` param via
  `params.append()` loop.
- `getReadingsAround(sensorId, at, radius=10)` added.

**Part F — Tree picker inline sparklines**
`asset-tree-picker.component.ts`:
- `sparklines = new Map<number, number[]>()` field added.
- `_loadSparklines()` private async method added — calls `sensorApi.getSparklines()`
  with all sensor IDs, populates the Map, calls `cdr.markForCheck()`. Fails silently.
- `void this._loadSparklines()` called after the initial `Promise.all` in `ngOnInit`.
- `sparklinePath(sensorId: number): string` helper method added — generates
  `M…L…` path string for a 64×18 viewBox with vertical scaling to 85% of height.

`asset-tree-picker.component.html`: sparkline `<svg>` added to each sensor row using
`*ngIf="sparklinePath(sensor.id)"`. Falls back to nothing when no data.

`asset-tree-picker.component.css`: `.tree-node__sparkline` — `flex-shrink: 0`,
`opacity: 0.7`, `margin-left: auto`.

**Part G — Drill-down modal**
`dashboard-widget.component.ts`:
- `drillOpen`, `drillLoading`, `drillTimestamp`, `drillReadings`, `drillUnit` fields added.
- `dataPointSelection` event handler added inside the `chart.events` config in
  `applyLineChart()`.
- `openDrillDown(sensorId, timestamp, unit)` — sets loading state, calls
  `sensorApi.getReadingsAround()`, populates `drillReadings`, clears loading.
- `closeDrillDown()` — sets `drillOpen = false`.

`dashboard-widget.component.html`: drill-down modal added as a sibling element at the
bottom of the template (see spec deviations for placement rationale). Backdrop click
closes; panel `$event.stopPropagation()` prevents propagation. Table rows with
`drillTimestamp === r.timestamp` get `.drill-table__row--pivot` highlight class.

`dashboard-widget.component.css`: `.drill-modal` (absolute overlay), `.drill-modal__panel`
(surface-1, centered), `.drill-modal__header`, `.drill-modal__body`, `.drill-table`,
`.drill-table__row--pivot` (brand background) styles added.

**Part H — Bulk widget actions: skipped (P2)**

---

## Files created

None — all changes were to existing files.

---

## Files changed

| File | Change |
|---|---|
| `backend/routes/sensor_routes.py` | Added `GET /sparklines` and `GET /{id}/readings/around` routes at top of file |
| `frontend/src/app/core/sensors/sensor-api.service.ts` | Added `getSparklines()` and `getReadingsAround()` |
| `frontend/src/app/modules/dashboard/dashboard.component.ts` | `WidgetCatalogItem` extended; `widgetCatalog` rebuilt in constructor (DomSanitizer); `SENSOR_TYPE_DEFAULTS` constant; `onWidgetSensorIdsChanged()` method |
| `frontend/src/app/modules/dashboard/dashboard.component.html` | Catalog card template rewritten with thumb/tags/bestFor; tree picker binding changed to `onWidgetSensorIdsChanged` |
| `frontend/src/app/modules/dashboard/dashboard.component.css` | Catalog card grid + card styles + tag chip + best-for styles |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.ts` | `gaugeWide`, `_gaugeResizeObs`, `ElementRef` injection, `_observeGaugeSize()`, `ngOnDestroy` disconnect; drill-down fields + methods; `dataPointSelection` event |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.html` | `[class.gauge--wide]`, `[style.background]` conditional; drill-down modal |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.css` | Semi-circle gauge CSS; drill-down modal + table styles |
| `frontend/src/app/modules/dashboard/asset-tree-picker.component.ts` | `sparklines` Map, `_loadSparklines()`, `sparklinePath()` |
| `frontend/src/app/modules/dashboard/asset-tree-picker.component.html` | Sparkline `<svg>` added to sensor rows |
| `frontend/src/app/modules/dashboard/asset-tree-picker.component.css` | `.tree-node__sparkline` styles |
| `frontend/src/app/modules/widgets/app-widgets-shell.component.html` | `.widget-drag-strip` added to header |
| `frontend/src/app/modules/widgets/app-widgets-shell.component.css` | Drag strip fade + header hover tint |

---

## Spec deviations

**1 — `widgetCatalog` built in constructor (DomSanitizer)**
The prompt offered two approaches for `[innerHTML]` / `DomSanitizer`. The agent chose to
build `widgetCatalog` inside the constructor so `DomSanitizer` is available. The
`WidgetCatalogItem.thumbnail` field type was changed from `string` to `SafeHtml`, and
each entry's thumbnail is wrapped with `sanitizer.bypassSecurityTrustHtml(...)` at
construction time. The `readonly` keyword was removed from `widgetCatalog` since the
constructor assignment requires a mutable field (or `readonly` assigned in constructor
body, which TypeScript permits — either way is fine and the build passes).

**2 — `_observeGaugeSize()` guard prevents leak on realtime ticks**
`applyGauge()` is called on every WebSocket realtime reading. Without a guard, each call
would create a new `ResizeObserver` and accumulate them. The implementation adds:
`if (this._gaugeResizeObs) return;` at the top of `_observeGaugeSize()` so the observer
is created only once. `ngOnDestroy` still disconnects it. This deviates from the prompt's
`this._gaugeResizeObs?.disconnect()` (which would re-create on every tick); the guard
approach is strictly safer.

**3 — Drill-down modal placed as sibling to `<app-widget-shell>`**
The prompt placed the modal "at the bottom of the template (inside `:host`)". The
`DashboardWidgetComponent` template wraps its content in `<app-widget-shell>`, and
`ng-content` projection means the modal would be projected inside the shell's `ng-content`
slot — causing layout and z-index issues. Instead the modal was placed as a **sibling** to
`<app-widget-shell>` at the same level, and `:host` was given `position: relative` so the
`position: absolute` modal is contained within the widget card boundaries.

**4 — `(seriesData as any).unit` cast**
`AnalyticsResponse.data[]` is typed without a `unit` field at the series level. The
`dataPointSelection` callback accesses `seriesData.unit`. Resolved with
`(seriesData as any).unit ?? ''` to avoid a TypeScript error without modifying the
`AnalyticsResponse` interface (which would require verifying the backend actually returns
this field at the series level).

---

## Build status

`ng build` — zero TypeScript errors, zero Angular errors. Two **pre-existing** budget
warnings (bundle size, CSS size) remain; not introduced by Slice 7.

---

## Outstanding work entering Slice 8

1. **`test_slice3.py` through `test_slice7.py`** — backend test coverage absent across
   all recent slices.
2. **§5.2 Kiosk mode** — JWT kiosk tokens, kiosk dashboard cycling, kiosk CSS class.
3. **§5.3 URL-shareable dashboard state** — `?d=&preset=&ar=` URL params, copy-link button.
4. **Part H bulk widget actions** — skipped; shift-click multi-select, bulk delete/duplicate.
5. **Admin asset tree editor** — drag-drop reparenting UI (API exists from Slice 6).
6. **Deep tree nesting** — `AssetTreePickerComponent` only renders 2 levels; grandchildren
   not shown.
