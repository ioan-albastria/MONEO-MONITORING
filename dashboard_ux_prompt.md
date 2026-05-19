# =====================================================================
# A. ORIENTATION
# =====================================================================
You are working on the MONEO sensor dashboard.
Read ./CLAUDE.md first, then ./frontend/CLAUDE.md and ./backend/CLAUDE.md.
Skim, don't re-read the codebase from scratch.

# =====================================================================
# B. SCOPE
# =====================================================================
TASK: Port dashboard CSS/UX stability improvements from the sibling FMC250 project
(C:\Work\Albastria\FMC250\fmc250-monitoring) into this app's dashboard. Six concrete
changes, described below.

IN SCOPE:
- Fix widget resize growing-down bug (gridster config + grid-shell CSS)
- Fix widget header to a fixed 2-line height (no more growing/shrinking header)
- Redesign edit mode: drag/resize always-on for owner (no explicit toggle);
  the edit button opens a name/description/public dialog instead
- Add horizontal_bar_chart widget type (ApexCharts horizontal bar)
- Add multi_gauge widget type (side-by-side CSS mini-gauges, up to 4 sensors)
- Flag dashboard favorites as a future backend requirement (comment + CLAUDE.md note)

EXPLICITLY OUT OF SCOPE:
- Favorites UI implementation (no backend endpoint; flag only)
- Any backend file changes
- Playwright test changes (update only if a test asserts the exact edit-mode
  button label/behavior that you change; otherwise leave them)
- Changing the public catalog modal (beyond what edit-mode redesign requires)
- Any new libraries or ApexCharts plugins not already installed

# =====================================================================
# C. CODE CONVENTIONS
# =====================================================================
Follow frontend/CLAUDE.md. Specifically:
- NgModules only (standalone: false)
- Tailwind v4 CSS-first — no tailwind.config.js
- Match existing patterns in dashboard-widget.component.ts for new widget types
  (look at applyBarChart() as the template for applyHorizontalBarChart(),
   and applyGauge() for the multi_gauge approach)
- File naming: kebab-case + suffix

# =====================================================================
# D. CLARIFICATIONS POLICY
# =====================================================================
Stop and ask if:
- Any change appears to require a backend endpoint not in backend/CLAUDE.md
- An existing Playwright test explicitly asserts the old edit-mode toggle behavior
  and the fix would break more than 2 tests

For the multi_gauge default grid size: use 8 cols × 4 rows. No need to ask.

# =====================================================================
# E. BACKEND CONSTRAINT
# =====================================================================
Do not modify any file under ./backend. If your task appears to require a backend
change, STOP and flag it.

# =====================================================================
# F. IMPLEMENTATION DETAILS
# =====================================================================

## Slice 1 — Fix widget resize growing down + smoother movement

**Root cause:** Two issues combined:
1. `outerMargin: true` in MONEO gridster config (FMC250 uses `false`). With outerMargin
   on, gridster adds padding around the whole grid that participates in resize hit-testing,
   creating a feedback loop when you hold the resize handle.
2. `.dashboard-grid-shell` CSS lacks `flex: 1; min-height: 0; overflow: auto;
   overscroll-behavior: contain` — FMC250 has all four. Without `min-height: 0`, the
   shell expands to fit gridster's growing internal height, which triggers more growth.

**Fix in dashboard.component.ts** (buildGridOptions ~line 755):
- Change `outerMargin: true` → `outerMargin: false`
- Remove the `cols: 24` property and replace with `minCols: 24, maxCols: 24` to match
  FMC250. Verify the MONEO angular-gridster2 version accepts these properties; if `cols`
  is the only accepted property, keep it and add a comment.

**Fix in dashboard.component.css** (.dashboard-grid-shell rule ~line 149):
- Replace `position: relative` with:
  `position: relative; flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain`
- The `.dashboard-grid-shell--loading` opacity rule stays unchanged.


## Slice 2 — Fixed 2-line widget header

**File:** frontend/src/app/modules/widgets/app-widgets-shell.component.html

**Current problem:** The header uses `min-h-[52px]` (can grow) and has three potential
content rows: title, `widgetHeaderMeta`, and conditional subtitle. This makes the header
height variable across widgets.

**Fix:** Change the header height to fixed: replace `min-h-[52px]` with `h-[52px]`.
Add `overflow-hidden` to the header element so a long subtitle cannot push the height.
All text elements inside should already have `truncate` — verify and add where missing.

The header has two information rows:
- Row 1: `<h3>{{ title }}</h3>` + badge slot (text-sm)
- Row 2: `widgetHeaderMeta` sub-line (text-[10px]) OR subtitle if meta is empty

The `subtitle` paragraph (`<p *ngIf="subtitle">`) currently sits below the meta line,
making a potential 3rd row. Since the header is now fixed-height with overflow-hidden,
any subtitle content is simply clipped — no template restructuring needed.


## Slice 3 — Edit mode redesign: editable by default for owner

**Current behavior (MONEO):** Drag/resize is OFF by default. User must click "Enter edit
mode" button to enable it. This is the root `toggleEditMode()` method.

**Target behavior (like FMC250):** For owned dashboards, drag/resize is always enabled.
For non-owned (public) dashboards, always disabled. The edit button instead opens a small
dialog/form to edit the dashboard's name, description, and is_public flag.

**Step 0 — before writing code:** Search for all usages of `editMode` across the
dashboard module files and list them. Then proceed with the changes below.

**Changes in dashboard.component.ts:**

1. In `buildGridOptions()`, change the initial gridster config:
   - `draggable: { ..., enabled: true }` (was false)
   - `resizable: { ..., enabled: true }` (was false)
   The actual enabled state will be corrected per-dashboard by `applyGridInteractivity()`.

2. Add a method `applyGridInteractivity()`:
   ```typescript
   private applyGridInteractivity(): void {
     const editable = this.canEditSelected;
     this.gridOptions = {
       ...this.gridOptions,
       draggable: { ...this.gridOptions.draggable, enabled: editable },
       resizable: { ...this.gridOptions.resizable, enabled: editable },
       displayGrid: editable ? DisplayGrid.Always : DisplayGrid.None,
     };
     this.gridOptions.api?.optionsChanged?.();
   }
   ```

3. Call `applyGridInteractivity()` at the end of `loadDashboard()` (after widgets are set),
   replacing whatever currently initializes edit state on load.

4. Add a `dashboardSettingsOpen: boolean = false` flag to control the dashboard settings
   dialog. Rename or repurpose `editMode` only if it has no other responsibilities — check
   all usages first (see Step 0). If `editMode` is also used as the `[editable]` input to
   widgets, replace those bindings with `canEditSelected`.

5. The edit button in the toolbar should now set `dashboardSettingsOpen = true` instead of
   calling `toggleEditMode()`. The button label/icon can change to "Dashboard settings"
   or keep a pencil icon — match the FMC250 spirit (settings, not a mode toggle).

6. Add a dashboard settings panel/dialog in the template. It needs three fields:
   - Name (text input, required)
   - Description (text input, optional)
   - Public (checkbox)
   Reuse the same `PUT /api/dashboards/{id}` call already used in the create/edit flow
   (`DashboardApiService`). Keep the form simple — no new modal component needed; an
   inline panel or the existing edit modal structure is fine.

7. `toggleEditMode()` can be removed after its responsibilities are reassigned.

8. The drag strip indicator in app-widgets-shell (`*ngIf="editMode"`) should receive the
   owner state: find where `[editMode]` is passed to `<app-widget-shell>` in
   dashboard-widget.component.html and replace with `[editMode]="editable"` (the widget
   component's `editable` input already reflects ownership).


## Slice 4 — Favorites: flag as future work

No UI changes. Two things only:

1. In dashboard.component.ts, add a comment above `openPublicCatalog()`:
   ```typescript
   // TODO(favorites): Add star/unfavorite UI once backend adds POST /api/dashboards/{id}/favorite
   // and DELETE /api/dashboards/{id}/favorite endpoints. Track in EXPANSION_PLAN.md.
   ```

2. Add a line to the "Gotchas" section of frontend/CLAUDE.md:
   - "**Favorites not yet implemented** — backend has no `/favorite` endpoint. A TODO
     comment is in `openPublicCatalog()`. See `EXPANSION_PLAN.md` for roadmap context."


## Slice 5 — Horizontal bar chart widget type

**New type:** `'horizontal_bar_chart'`

**Files to change:**
- `frontend/src/app/types/dashboard.ts`: add `'horizontal_bar_chart'` to `DashboardWidgetType`
- `frontend/src/app/modules/dashboard/dashboard.component.ts`:
  - Add to widget catalog array:
    - label: "Horizontal Bar Chart"
    - description: "Side-by-side bar comparison across sensors — good for current-value ranking"
    - default size: 10 cols × 5 rows
    - tags: `['comparison', 'multi-sensor']`
    - bestFor: `'Ranking sensors by current value'`
    - thumbnail: adapt the existing bar_chart SVG thumbnail (rotate bars to horizontal)
    - defaultSettings: same as bar_chart (`aggregated: true, bucket_minutes: 60`)
- `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`:
  - Add `applyHorizontalBarChart()` modeled on `applyBarChart()` but with:
    `plotOptions: { bar: { horizontal: true } }` in the ApexCharts config
  - The ApexCharts `chart.type` remains `'bar'`
  - Add `'horizontal_bar_chart'` to the widget type dispatch (call `applyHorizontalBarChart`)
  - The data fetch is identical to bar_chart (same analytics endpoint, no backend change)
  - `chartType` output remains `'apex'`


## Slice 6 — Multi-gauge widget type

**New type:** `'multi_gauge'`

**Concept:** Displays 2–4 sensors as mini circular gauges in a 2×2 grid layout inside one
widget. Each mini-gauge shows current value, unit, sensor name (truncated), using the same
CSS conic-gradient as the existing single gauge.

**Before writing any code for this slice:** Read `applyGauge()` and the gauge HTML/CSS
in full to understand the existing approach. Model multi_gauge as a composition of the
same pattern.

**Files to change:**

- `frontend/src/app/types/dashboard.ts`: add `'multi_gauge'` to `DashboardWidgetType`

- `frontend/src/app/modules/dashboard/dashboard.component.ts`:
  - Add to widget catalog:
    - label: "Multi-Gauge"
    - description: "Up to 4 sensors as side-by-side mini gauges — good for live status overview"
    - default size: 8 cols × 4 rows
    - tags: `['live', 'multi-sensor', 'gauge']`
    - bestFor: `'Live comparison of related sensors'`
    - defaultSettings: `{ sensor_ids: [], time_range_hours: 1 }`

- `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`:
  - Add interface (file-local, no export needed):
    ```typescript
    interface MultiGaugeEntry {
      name: string; value: number | null; unit: string;
      percent: number; color: string; min: number; max: number;
    }
    ```
  - Add `multiGauges: MultiGaugeEntry[] = []` property
  - Add `applyMultiGauge()` method:
    - For each sensor in `widget.settings.sensor_ids` (up to 4):
      - Use `SensorApiService.getLatestReading(sensorId)` if it exists; if not, use
        `getAnalytics()` with a short window and take the last point
      - Compute percent from sensor `normal_min`/`normal_max` (fall back to
        `gauge_min`/`gauge_max` from settings, then 0/100)
      - Pick color using the same tier logic as `applyGauge()` / `computeStatus()`
    - Set `chartType = 'multi_gauge'`
    - Set `this.multiGauges = [...]`
  - For live updates: subscribe to RealtimeService for each sensor, same pattern as
    the existing gauge widget (see `applyGauge()` for the subscription setup)
  - Add `'multi_gauge'` to the widget type dispatch

- `dashboard-widget.component.html`:
  Add a `*ngIf="!loading && !error && chartType === 'multi_gauge'"` block:
  ```html
  <div class="multi-gauge-grid">
    <div *ngFor="let g of multiGauges" class="mini-gauge">
      <div class="mini-gauge__dial"
           [style.--gauge-progress]="g.percent + '%'"
           [style.--gauge-color]="g.color">
        <div class="mini-gauge__dial-inner">
          <span class="mini-gauge__value">{{ g.value !== null ? g.value.toFixed(1) : '—' }}</span>
          <span class="mini-gauge__unit">{{ g.unit }}</span>
        </div>
      </div>
      <div class="mini-gauge__label">{{ g.name }}</div>
    </div>
  </div>
  ```

- `dashboard-widget.component.css`:
  Add CSS for `.multi-gauge-grid` (2-column CSS grid, centered, gap 8px),
  `.mini-gauge` (flex column, align-center), `.mini-gauge__dial` (smaller version of
  `.dashboard-gauge-card__dial` — use ~80px diameter), `.mini-gauge__dial-inner`,
  `.mini-gauge__value` (smaller font than main gauge), `.mini-gauge__unit`,
  `.mini-gauge__label` (truncate, text-[10px], text-fg-faint).
  Reuse the same `--gauge-progress` and `--gauge-color` CSS custom properties.
  Do NOT add new conic-gradient syntax — copy the existing dial's background rule.

**Constraint:** No new libraries. Use the existing conic-gradient technique only.


## Slice 7 — Widget editor modal: 2-column layout (no scroll)

**Problem:** The MONEO widget editor modal stacks all sections vertically — type picker,
title/subtitle, time window, sensor picker, gauge settings, thresholds — forcing the user
to scroll to reach lower sections. The FMC250 editor avoids this by placing the sensor
selection and time range side by side in a two-column layout.

**Target layout:**
```
┌─────────────────────────────────────────────────────┐
│  WIDGET TYPE  (full width, type cards 2-col grid)   │
├─────────────────────────────────────────────────────┤
│  DETAILS — title / subtitle        (full width)     │
├──────────────────────────┬──────────────────────────┤
│  DATA / Sensors          │  TIME WINDOW             │
│  (asset tree picker,     │  (presets + from/to +    │
│   data filters)          │   auto-refresh)          │
├─────────────────────────────────────────────────────┤
│  GAUGE / THRESHOLDS  (full width, *ngIf gauge type) │
└─────────────────────────────────────────────────────┘
```

**Files to change:**

- `frontend/src/app/modules/dashboard/dashboard.component.html`:
  Inside the widget editor modal, wrap the Data section and Time Window section in a
  two-column container div. Everything above (type picker, details) and below (gauge,
  thresholds) stays full-width. The two-column split should use CSS Grid, not Flexbox,
  for consistent column widths. Add a CSS class like `.widget-editor-columns` to the
  wrapper div.

- `frontend/src/app/modules/dashboard/dashboard.component.css`:
  Add `.widget-editor-columns` rule:
  ```css
  .widget-editor-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;
  }
  ```
  On narrow viewports (< 640px) collapse to a single column:
  ```css
  @media (max-width: 639px) {
    .widget-editor-columns { grid-template-columns: 1fr; }
  }
  ```

**Constraints:**
- Do not change the modal's overall width or the section card styles (border, padding,
  labels) — only the arrangement of which sections are side by side.
- The gauge/thresholds section must remain full-width and only appear for gauge/multi_gauge
  widget types (existing `*ngIf` logic stays unchanged).
- The sensor picker (asset tree) is taller than the time window section; the
  `align-items: start` on the grid prevents the time window card from stretching to match.
- Read the current modal HTML in full before editing to understand the existing section
  wrapper divs and avoid breaking the `*ngIf` conditions.

# =====================================================================
# G. DOCUMENTATION UPDATE
# =====================================================================
At the end of the session, update frontend/CLAUDE.md:
- Widget catalog table: add `horizontal_bar_chart` and `multi_gauge` rows
- Widget editor modal: note the 2-column layout and the `.widget-editor-columns` CSS class
- Gridster config entry (~line referencing buildGridOptions): update to reflect
  `outerMargin: false` and the `minCols`/`maxCols` change
- Edit mode section: replace the `toggleEditMode()` description with
  `applyGridInteractivity()` pattern; note that edit button now opens settings dialog
- Gotchas: add the favorites note (from Slice 4)
- "Where to look for X" table: add multi_gauge render row

# =====================================================================
# H. ROLLBACK DISCIPLINE
# =====================================================================
Work slice by slice: implement → TypeScript compile check → move on.
Run `cd frontend && npx tsc --noEmit` (or `ng build --no-progress`) after Slice 3
and after Slice 6. If a slice breaks the build, revert that slice before continuing.
Slices 1 and 2 are pure CSS/config — lowest risk. Slice 3 is the most structurally
invasive; Slice 6 is the most code-heavy.

# =====================================================================
# I. WORKFLOW
# =====================================================================
- Use a TodoList. One todo per slice.
- For Slice 3, list all usages of `editMode` before writing any code.
- For Slice 6, read `applyGauge()` in full before writing any code.
- Run a TypeScript compile check after Slice 3 and Slice 6.

# =====================================================================
# J. HANDOFF
# =====================================================================
At the end of the session, write a fenced markdown "Current state" block, under 15
lines, covering:
- what shipped (1-2 lines)
- files changed (list)
- any deviation from the plan and why
- any new TODOs or gotchas added to CLAUDE.md
- anything unfinished and what blocks it
