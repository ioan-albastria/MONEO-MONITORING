# Frontend — MONEO Monitoring Dashboard

## What this app does
Angular 20 SPA. Operators log in with username/password, land on a gridster dashboard,
add and configure sensor widgets (line chart, bar chart, gauge, stat card), and watch
gauge/stat-card values update live via WebSocket. Dark/light theme and density toggle
are persisted in localStorage.

## Stack

| Concern | Technology |
|---|---|
| Framework | Angular 20.0.0, traditional **NgModules** (`standalone: false` everywhere) |
| Grid | `angular-gridster2` — fixed 64×64 px cells, 24-column layout |
| Charts | `ng-apexcharts` / ApexCharts (line, bar, sparkline); gauge is pure CSS conic-gradient |
| CSS | **Tailwind v4 CSS-first** — `@import "tailwindcss"` + `@theme` block in `src/styles.css`; no `tailwind.config.js` |
| Auth | JWT Bearer token in `localStorage['auth_token']`; class-based HTTP interceptor |
| Realtime | `rxjs/webSocket` — per-sensor WebSocket streams |
| E2E | Playwright — `frontend/e2e/`, run with `npm run e2e` |

## Folder structure

```
frontend/src/app/
├── core/
│   ├── auth/          # AuthService, AuthInterceptorService (class-based), auth.guard.ts (CanMatchFn)
│   ├── realtime/      # RealtimeService — rxjs WebSocket, per-sensor subscriptions
│   ├── sensors/       # SensorApiService — REST calls: readings, analytics, latest
│   ├── services/      # sync-health.service.ts — polls /api/admin/sync/health; data contract for sync status components
│   └── ui/            # UiPreferencesService — theme + density toggle, localStorage persistence
├── modules/
│   ├── dashboard/     # DashboardComponent (grid host), DashboardWidgetComponent (renderer), DashboardApiService
│   ├── layout/        # AppShellComponent, AppNavRailComponent, AppPageHeaderComponent
│   │                  #   — sync-status-indicator: nav-rail chip showing overall sync health
│   │                  #   — sync-status-panel: expandable detail panel (per-source rows)
│   │                  #   — sync-status-banner: full-width alert strip shown when sync is degraded/failed
│   ├── login/         # LoginComponent — login form
│   └── widgets/       # AppWidgetsShellComponent — presentational chrome wrapper for every widget
├── types/             # TypeScript interfaces: dashboard.ts, widget.ts, sensor.ts, analytics.ts
├── app.ts             # Root component — calls UiPreferencesService.init() on construction
├── app-module.ts      # AppModule — registers AuthInterceptor in HTTP_INTERCEPTORS
└── app-routing.module.ts  # Lazy-loads LoginModule and DashboardModule
```

## Conventions

- **NgModules only.** All components have `standalone: false`. Do not generate standalone components.
- **Tailwind v4 CSS-first.** All design tokens in `src/styles.css` `@theme` block. No utility class purging config needed.
- **Class-based interceptor.** `AuthInterceptorService` implements `HttpInterceptor`. Registered in `app-module.ts` via `HTTP_INTERCEPTORS`. Do not convert to functional interceptor.
- **Functional guard.** `auth.guard.ts` exports a `CanMatchFn` (not a class). This is intentional.
- **File naming.** Kebab-case + suffix: `dashboard-widget.component.ts / .html / .css`, `auth.service.ts`, `auth-interceptor.service.ts`, `dashboard.module.ts`, `dashboard-routing.module.ts`.
- **CSS variables.** Components reference tokens via `var(--color-*)`, `var(--r-*)`, `var(--radius-*)`, `var(--h-control)` etc. Never hard-code colours or pixel values that have a token equivalent.
- **No Tailwind config file.** `.postcssrc.json` (JSON, not JS) drives PostCSS — do not create `tailwind.config.js` or `tailwind.config.ts`.

## Auth flow

1. User submits form → `AuthService.login()` → `POST /api/auth/login` → `{ access_token, token_type }`.
2. Token stored: `localStorage.setItem('auth_token', token)`.
   - Service: `frontend/src/app/core/auth/auth.service.ts` — `TOKEN_KEY = 'auth_token'`
3. Every outgoing HTTP request: `AuthInterceptorService` clones it with `Authorization: Bearer <token>`.
   - File: `frontend/src/app/core/auth/auth-interceptor.service.ts`
   - On 401 response: clears token, clears `currentUser`, redirects to `/login`.
4. Route guard: `frontend/src/app/core/auth/auth.guard.ts` (exported `CanMatchFn`).
   - If `auth.currentUser` exists → allow.
   - If token exists but no user → calls `GET /api/auth/me` to rehydrate user.
   - If no token → `router.navigate(['/login'])`.
5. Guard applied to protected routes in `frontend/src/app/app-routing.module.ts` via `canMatch: [AuthGuard]`.

**WebSocket auth:** Token is appended as `?token=<jwt>` query param (browsers cannot send
custom headers on WS upgrade). `RealtimeService` reads the token via `auth.getToken()` and
completes the stream immediately if no token is present. The backend validates the token
before calling `websocket.accept()` — see `backend/routes/websocket_routes.py`.

## Dashboard module

**Key files:**
- `frontend/src/app/modules/dashboard/dashboard.component.ts` (724 lines) — grid host, widget CRUD UI, layout persistence
- `frontend/src/app/modules/dashboard/dashboard-widget.component.ts` (471 lines) — renders a single widget
- `frontend/src/app/modules/dashboard/dashboard-api.service.ts` — REST calls for dashboards/widgets

**Gridster config** (dashboard.component.ts ~line 528):
- `GridType.Fixed`, 64×64 px cells, 24 columns, 12px margin
- Drag handle: `.dashboard-widget-drag-handle` CSS class
- Drag/resize enabled only in `editMode`; `compactType: CompactType.None`

**Layout persistence** (dashboard.component.ts ~line 274):
- `itemChangeCallback` / `itemResizeCallback` → `queueLayoutPersistence()` → 320 ms debounce → `flushLayout()`
- Flush: `POST /api/dashboards/{id}/layout` with `[{ id, x, y, cols, rows }]` per widget
- Service call in: `dashboard-api.service.ts` line ~34

**Widget catalog** (dashboard.component.ts ~line 121):
Hard-coded array of `WidgetCatalogItem` with label, description, default grid dimensions and default `WidgetSettings` per type:
| Type | Default size | Notes |
|---|---|---|
| `line_chart` | 12 cols × 5 rows | `aggregated: true`, `bucket_minutes: 60`, `show_legend: true` |
| `bar_chart` | 8 cols × 5 rows | Same aggregation |
| `gauge` | 4 cols × 4 rows | `gauge_min`, `gauge_max` inputs; CSS conic-gradient, not ApexCharts |
| `stat_card` | 4 cols × 3 rows | Big number + delta arrow + 30-point sparkline |

**Widget editor modal** (dashboard.component.ts ~line 405):
- Fields: type, title, subtitle, sensor IDs (multi-select), time mode (relative hours or absolute from/to), gauge min/max.
- Create: `POST /api/dashboards/{id}/widgets`; Update: `PUT /api/widgets/{id}`.

## Widget system

**Type definitions:** `frontend/src/app/types/widget.ts`
```typescript
type DashboardWidgetType = 'line_chart' | 'bar_chart' | 'gauge' | 'stat_card'
interface WidgetSettings {
  sensor_ids?: number[];
  time_range_hours?: number;
  from?: string; to?: string;
  aggregated?: boolean; bucket_minutes?: number;
  gauge_min?: number; gauge_max?: number;
  show_legend?: boolean; color?: string;
  [k: string]: unknown;
}
```

**Shell (chrome wrapper):** `frontend/src/app/modules/widgets/app-widgets-shell.component.ts`
- Selector: `<app-widget-shell>`; inputs: `title`, `subtitle`, `loading`, `tone`, `chromeMode`, `status: WidgetStatus`, `theme: 'light'|'dark'`, `freshAt: string|null`, `expectedIntervalSeconds: number` (default 300)
- `cycleChromeMode()` toggles chrome between `'hover'` and `'off'`
- **Ambient tinting:** `status` + `theme` drive three CSS custom properties (`--tone-tint`, `--tone-edge`, `--tone-text`) computed in `_computeTokens()`, memoized per `{status, theme}` key. Subtle intensity hard-coded; medium/strong constants kept for future preference UI. Hex palette and alpha ramps are at the top of the TS file.
- **Data freshness:** `freshAt` + `expectedIntervalSeconds` drive a `freshnessState` getter (`'fresh'|'stale'|'offline'|'unknown'`). A 5-second `interval()` calls `cdr.markForCheck()` so the footer text updates without extra HTTP calls. `@HostBinding('attr.data-state')` exposes `freshnessState` on the host element (used by the offline desaturation CSS rule). A `<footer *ngIf="freshAt !== null">` renders the `relativeTime` pipe output in muted text.
- **`RelativeTimePipe`** (`relative-time.pipe.ts`, declared + exported in `WidgetsModule`): pure pipe; thresholds: <90s → "Xs ago", <5400s → "X min ago", <86400s → "Xh ago", else "Xd ago". null → "N/A".

**Renderer:** `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`
- Selector: `<app-dashboard-widget>`; required input: `widget: DashboardWidget`; input: `editable`
- Outputs: `configure` (EventEmitter), `remove` (EventEmitter)
- Fetches data on init, re-fetches on theme change (MutationObserver on `<html>`)
- Loads all sensors via `sensorApi.listSensors()` once on init (cached in `this.sensors`). Computes `expectedIntervalSeconds` = min non-null `expected_poll_seconds` across the widget's sensors (fallback 300). Sets `freshAt` after every data load and realtime tick: max timestamp across analytics points for line/bar; `latestReading.timestamp` for gauge/stat_card.
- `widgetStatus: WidgetStatus` computed by `computeStatus()` on every data tick; `currentTheme` updated in the same MutationObserver; both passed to shell as inputs.

**Data flow per type:**

| Type | Data source | Live updates | Render method |
|---|---|---|---|
| `line_chart` | `SensorApiService.getAnalytics()` (multi-sensor) | No | `applyLineChart()` ~line 269 |
| `bar_chart` | `SensorApiService.getAnalytics()` | No | `applyBarChart()` ~line 306 |
| `gauge` | Sensor metadata + `latest` reading | Yes — `RealtimeService.subscribe(sensorId)` | `applyGauge()` ~line 346 |
| `stat_card` | Last 2h readings + latest + metadata | Yes — `RealtimeService.subscribe(sensorId)` | `applyStatCard()` ~line 359 |

**Theme re-render:** widget watches `<html>` class changes via `MutationObserver`. On toggle,
reads CSS custom properties with `getComputedStyle()` and re-calls the relevant `apply*()` method.

## Theme + density

**Service:** `frontend/src/app/core/ui/ui-preferences.service.ts`

**Storage keys:** `localStorage['ui.theme']` (`'operational-dark'` | `'operational-light'`),
`localStorage['ui.density']` (`'density-comfortable'` | `'density-compact'`)

**CSS classes toggled on `<html>`:**
- Theme: `.theme-dark` (default) or `.theme-light`
- Density: `.density-comfortable` or `.density-compact`

**How `setTheme()` works:** removes both `.theme-dark` / `.theme-light`, adds the target class,
optionally persists to localStorage. Init called from `app.ts` constructor.

**Token location:** `frontend/src/styles.css`
- `@theme` block (lines 13–100): all design tokens as CSS custom properties
- `:root.theme-light` (lines 275–291): overrides surface + foreground colours for light mode
- `.density-compact` rules (lines 296–318): tighter `--h-control`, `--h-row`, `--pad-widget`, `--gap-grid`
- Slice 4 added four sync-status tokens: `--color-status-healthy`, `--color-status-degraded`, `--color-status-failed`, `--color-status-unknown`

**Colour space:** OKLch throughout (e.g. `oklch(0.98 0.01 255)`).

## Realtime

**Service:** `frontend/src/app/core/realtime/realtime.service.ts`

- Uses `rxjs/webSocket` (`WebSocketSubject`)
- URL pattern: `ws[s]://${host}/ws/sensors/{sensorId}` (protocol matches page protocol)
- `subscribe(sensorId)` is lazy — creates stream on first call, shared via `pipe(share())`
- Reconnect: exponential backoff on error/close (1s → 2s → 4s → … → 30s cap)

**Message shape:**
```typescript
interface WsMessage { id?: number; sensor_id: number; value: number | null; timestamp: string | null; }
```

**Subscribers:** `gauge` (~line 222 in dashboard-widget.component.ts) and
`stat_card` (~line 260) — both subscribe on widget init, unsubscribe on destroy.

## Testing

**Framework:** Playwright  
**Location:** `frontend/e2e/`  
**Config:** `frontend/playwright.config.ts`  
**Run:** `cd frontend && npm run e2e`

- Runs sequentially (`workers: 1`, `fullyParallel: false`)
- Dev server auto-started on port 4200 (`reuseExistingServer: true`)
- Requires backend running at `http://localhost:8000` with seed data
- Screenshots on failure, trace on first retry
- HTML report: `frontend/playwright-report/index.html`

**Test inventory (52 cases):**

| File | IDs | Coverage |
|---|---|---|
| `auth.spec.ts` | AUTH-01–05 | Login success/failure, guard redirect, interceptor header, 401 handling |
| `dashboards.spec.ts` | DASH-01–08 | Dashboard CRUD, public catalog, selection, empty state |
| `edit-mode.spec.ts` | EDIT-01–06 | Edit mode toggle, ownership guards, button states |
| `widgets.spec.ts` | WIDGET-01–15 | Widget editor, type picker, sensor select, time range, all 4 types |
| `layout.spec.ts` | LAYOUT-01 | Drag & debounced layout persistence POST |
| `charts.spec.ts` | CHART-01–05 | Line/bar/gauge/stat render, empty-state overlay |
| `realtime.spec.ts` | RT-01–03 | WS connection, lifecycle, gauge live update |

**Current status:** 36 passed / 15 failed (pre-existing backend DELETE timeouts in cleanup) / 1 skipped (DASH-03, requires Angular devtools — intentional `test.skip`)

## Spec deviations

| # | Spec said | Reality | Source |
|---|---|---|---|
| 1 | Gauge CSS variable `--gauge-progress` | **Fixed.** Was emitting `--gauge-pct` (unitless); now emits `--gauge-progress` with `%` unit — conic-gradient dial renders correctly. | ambient-tinting retrofit |
| 2 | Stat card has layout CSS | **Fixed.** Added `.widget-stat`, `.widget-stat__value`, `.widget-stat__delta` etc. rules to `dashboard-widget.component.css`; `.widget-stat__value` uses `color: var(--tone-text)`. | ambient-tinting retrofit |
| 3 | WebSocket auth via `?token=<jwt>` query param | **Implemented.** Was missing on both sides; fixed — frontend appends token, backend validates before `accept()` | FRONTEND_REBUILD_INSTRUCTIONS.md |
| 4 | Ambient status tinting | **Implemented.** `AppWidgetsShellComponent` accepts `status: WidgetStatus` + `theme` inputs; computes `--tone-tint` / `--tone-edge` / `--tone-text` per status. Subtle intensity hard-coded; medium/strong constants in shell TS for future preference UI. No pulse animations. | ambient-tinting retrofit |

## Gotchas

- **Gridster column width depends on container width**, not a fixed pixel value — `GridType.Fixed` means the *cell* is 64px, but the dashboard wrapper must be wide enough to fit 24 columns + gutters or the grid will overflow.
- **Theme re-render is driven by `MutationObserver`** watching `<html>` class changes, not an RxJS observable. Chart options are rebuilt from scratch on every toggle — do not diff them.
- **`@HostBinding('attr.data-state')` on `AppWidgetsShellComponent`** sets `data-state` on the `<app-widget-shell>` host element. The CSS rule `:host([data-state="offline"]) .widget-body` desaturates the body when data goes offline. `data-state` is distinct from `data-chrome` and `data-tone` — no conflict. The `.widget-body` class is on the body `<div>` inside the shell template.
- **`RelativeTimePipe` is pure** — it won't re-evaluate automatically when time passes. The shell component drives re-evaluation via a 5-second `interval()` subscription that calls `cdr.markForCheck()`. Do not make the pipe impure to solve this.
- **`dashboard.component.ts` is 724 lines** — widget catalog, modal state, gridster config, layout persistence, and dashboard CRUD all live here. Navigate by line number comments when editing.
- **`NgApexchartsModule`** must be in the `imports` of `DashboardModule`, not the root module — it is only used inside the dashboard feature.
- **Edit/Add widget buttons** were reported as a known bug (EDIT-01, EDIT-02): they should not be disabled for owned dashboards, but tests were written to expect them enabled. If they appear disabled, investigate `editMode` state and ownership check logic in `dashboard.component.ts`.

## Where to look for X

| X | File |
|---|---|
| Token storage key (`auth_token`) | `core/auth/auth.service.ts` — `TOKEN_KEY` constant |
| Bearer header attachment | `core/auth/auth-interceptor.service.ts` |
| 401 redirect logic | `core/auth/auth-interceptor.service.ts` |
| Route guard | `core/auth/auth.guard.ts` |
| Gridster config object | `modules/dashboard/dashboard.component.ts` ~line 528 |
| Widget catalog (defaults) | `modules/dashboard/dashboard.component.ts` ~line 121 |
| Layout persistence debounce | `modules/dashboard/dashboard.component.ts` ~line 274 |
| Widget editor modal | `modules/dashboard/dashboard.component.ts` ~line 405 |
| REST calls for dashboards/widgets | `modules/dashboard/dashboard-api.service.ts` |
| REST calls for sensor data | `core/sensors/sensor-api.service.ts` |
| Gauge CSS conic-gradient render | `modules/dashboard/dashboard-widget.component.ts` `applyGauge()` ~line 346 |
| Stat card sparkline / delta | `modules/dashboard/dashboard-widget.component.ts` `applyStatCard()` ~line 359 |
| Ambient tinting hex palette + alpha ramps | `modules/widgets/app-widgets-shell.component.ts` — `TONE_HEX`, `TINT_SUBTLE`, `EDGE_ALPHA`, `TEXT_LIGHT/DARK` |
| Widget status derivation | `modules/dashboard/dashboard-widget.component.ts` `computeStatus()` |
| Theme/density service | `core/ui/ui-preferences.service.ts` |
| CSS design tokens (all) | `src/styles.css` `@theme` block |
| Light-mode colour overrides | `src/styles.css` `:root.theme-light` |
| Density overrides | `src/styles.css` `.density-compact` rules |
| WebSocket service | `core/realtime/realtime.service.ts` |
| TypeScript widget types | `types/widget.ts` |
| TypeScript dashboard types | `types/dashboard.ts` |
| TypeScript sensor/analytics types | `types/sensor.ts`, `types/analytics.ts` |
| AppModule (interceptor registration) | `app-module.ts` |
| Lazy route definitions | `app-routing.module.ts` |
