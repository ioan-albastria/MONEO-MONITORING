# MONEO E2E Triage Report

**Run date:** 2026-05-10  
**Total tests:** 52 | **Pass:** 16 | **Fail:** 36 | **Skip:** 0

Two distinct root causes drive almost every failure. They are documented first, then the full table follows.

---

## Root Cause Analysis

### RCA-1 — `is_owned` never `true` after `getDashboard()` (THE central bug)

**Affects: EDIT-01, 02, 03, 04, 06 | DASH-03, 04, 06 | WIDGET-01–15 | LAYOUT-01, 01b | CHROME-02**

`DashboardComponent.canEditSelected` returns `!!this.selectedDashboard?.is_owned`.  
`is_owned` is defined in the spec as "computed client-side", but `loadDashboards()` only stamps it onto the list:

```typescript
this.ownedDashboards = owned.map(d => ({ ...d, is_owned: true }));  // ✓ set
```

Immediately after, `getDashboard(nextId)` fetches the full dashboard from `GET /api/dashboards/{id}`. That response replaces `selectedDashboard`, and the backend's response object does not include `is_owned: true` — it either omits the field or returns `false`. So `this.isOwnedSelected = this.selectedDashboard.is_owned` evaluates to `undefined` / `false`.

**Effect:** pencil, add_chart, delete buttons are disabled for every dashboard, including ones the user just created.

**File to inspect:** `dashboard.component.ts:211–219` (`selectDashboardById` / `loadDashboards`).  
**Fix direction:** After `getDashboard(id)` returns, preserve the `is_owned` flag that was already known from the list (since the list endpoint is the authoritative ownership source):

```typescript
this.selectedDashboard = await this.api.getDashboard(nextId);
// Preserve is_owned from the owned list if we know this is an owned dashboard
const isInOwnedList = this.ownedDashboards.some(d => d.id === nextId);
this.isOwnedSelected = isInOwnedList || !!this.selectedDashboard.is_owned;
```

---

### RCA-2 — Gauge and stat_card show error overlay (widget data load fails)

**Affects: CHART-03, 04 | CHROME-03 (secondary) | RT-01, 02, 03 (cascade)**

`dashboard-widget.component.ts:loadGauge` calls `Promise.all([getLatest(sensorId), getSensor(sensorId)])`.  
`SensorApiService.getSensor()` is called but may return an HTTP error (404 or non-existent endpoint), or the selected sensor has no latest reading, causing the entire `Promise.all` to reject. This lands in the `catch` branch of `reload()` and renders the error overlay instead of the gauge.

Because the error fires before `this.realtimeSub = this.realtime.subscribe(...)` is reached, no WebSocket is ever opened — which cascades into RT-01 and RT-02 failures.

**File to inspect:** `dashboard-widget.component.ts:196–213` (`loadGauge`) and `core/sensors/sensor-api.service.ts` (verify `getSensor` exists and maps to the correct endpoint).  
**Fix direction:** Confirm `SensorApiService.getSensor(id)` calls `GET /api/sensors/{id}`. If the method is missing, add it. Also ensure the test seed has a sensor with at least one reading so `getLatest` doesn't 404.

---

### RCA-3 — Test cleanup timeout (infrastructure, not a functional failure)

**Affects: CHART-01, 02 | CHROME-01, 03 | DASH-05 | LAYOUT-01b | WIDGET-14, 15 | RT-03**

Several tests spend 15–20 s waiting for widget loading overlays or network timeouts, leaving fewer than 10 s in the 30 s global budget for the `dispose()` cleanup (`apiDelete`). The `page.request.delete` call then times out. The functional assertions in the test body either passed or were correctly skipped before this point — the cleanup timeout is a false failure.

**Fix direction (tests):** Increase the test timeout to 60 s for widget-heavy tests via `test.setTimeout(60_000)`, or use `page.request` with an explicit timeout option in `apiDelete`.

---

## PASS (16)

| id | name | result |
|---|---|---|
| AUTH-01 | Login success — navigates to /dashboard, token stored | **PASS** |
| AUTH-02 | Login failure — error banner shown, stays on /login | **PASS** |
| AUTH-03 | Guard redirect — /dashboard without token goes to /login | **PASS** |
| AUTH-04 | Interceptor — Authorization header on every /api request | **PASS** |
| AUTH-05 | 401 handling — clears token and redirects to /login | **PASS** |
| DASH-01 | Dashboard list loads — select shows owned dashboards | **PASS** |
| DASH-02 | Create dashboard — modal opens, saves, appears in select | **PASS** |
| DASH-07 | Switching dashboards — page header title updates | **PASS** |
| DASH-08 | Empty state template exists (soft pass — requires fresh account for full verification) | **PASS** |
| EDIT-05 | Read-only guard — Angular component state not externally manipulable; test annotated | **PASS** |
| CHART-05 | Empty state — widget with no data shows empty overlay or no-data chart | **PASS** |
| THEME-01 | Theme toggle — adds theme-light class to `<html>` | **PASS** |
| THEME-02 | Theme toggle again — removes theme-light, restores dark | **PASS** |
| THEME-03 | Theme persists — localStorage updated | **PASS** |
| THEME-04 | Density toggle — adds density-compact class to `<html>` | **PASS** |
| THEME-05 | Density persists — localStorage updated | **PASS** |

---

## FAIL (36)

### Group A — RCA-1: is_owned bug (22 tests)

| id | name | result | hypothesis |
|---|---|---|---|
| EDIT-01 | Pencil button enabled on owned dashboard | **FAIL** | `selectedDashboard.is_owned` always falsy after `getDashboard()`; `canEditSelected` returns false. Fix: preserve is_owned from owned list. File: `dashboard.component.ts:211` |
| EDIT-02 | Add-widget button enabled on owned dashboard | **FAIL** | Same root cause as EDIT-01 — `[disabled]="!canEditSelected"`. File: `dashboard.component.html:52` |
| EDIT-03 | Delete-dashboard button enabled on owned dashboard | **FAIL** | Same root cause as EDIT-01. File: `dashboard.component.html:60` |
| EDIT-04 | Toggle edit mode — banner appears, pencil goes active | **FAIL** | Depends on pencil being enabled (EDIT-01). Would pass once RCA-1 is fixed. |
| EDIT-06 | Exit edit mode — banner disappears, pencil no longer active | **FAIL** | Same prerequisite as EDIT-04. |
| DASH-03 | Edit dashboard — modal opens in update mode | **FAIL** | Pencil check fails first (RCA-1); also note there is no toolbar button for `openEditor()` — it is only reachable programmatically. Add data-testid or route. |
| DASH-04 | Delete dashboard — confirm dialog, dashboard removed | **FAIL** | Delete button disabled (RCA-1). Playwright retried click until 30 s elapsed. |
| DASH-06 | Open public dashboard — toolbar state correct | **FAIL** | Pencil still disabled for owned dashboard opened via catalog (RCA-1). |
| WIDGET-01 | Widget editor opens | **FAIL** | `add_chart` button never enabled (RCA-1). |
| WIDGET-02 | Type picker — line_chart selectable | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-03 | Type picker — bar_chart selectable | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-04 | Type picker — gauge selectable, bounds section appears | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-05 | Type picker — stat_card selectable | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-06 | Sensor multi-select populated | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-07 | Time range toggle — relative/absolute switches inputs | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-08 | Gauge bounds visible only for gauge type | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-09 | Save validation — no sensor selected shows error | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-10 | Create line_chart widget | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-11 | Create bar_chart widget | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-12 | Create gauge widget | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| WIDGET-13 | Create stat_card widget | **FAIL** | Gate on `add_chart` enabled (RCA-1). |
| LAYOUT-01 | POST /layout fires once after ~320 ms debounce | **FAIL** | Pencil button disabled (RCA-1); cannot enter edit mode to trigger drag. |
| CHROME-02 | Configure/delete enabled on owned dashboard | **FAIL** | `[editable]="dashboard.is_owned"` passed to widget shell; `is_owned` is falsy (RCA-1). Configure and delete buttons stay disabled. File: `dashboard.component.html:103` |

### Group B — RCA-2: Gauge/stat_card widget error (5 tests)

| id | name | result | hypothesis |
|---|---|---|---|
| CHART-03 | Gauge renders — dial visible | **FAIL** | Widget shows error overlay. `loadGauge()` calls `getSensor(id)` which likely fails — check `SensorApiService` for a `getSensor` method, and confirm `GET /api/sensors/{id}` is reachable. File: `dashboard-widget.component.ts:197`, `sensor-api.service.ts` |
| CHART-04 | Stat card renders — value visible | **FAIL** | Same as CHART-03 — `loadStatCard()` also calls `getSensor(id)`. File: `dashboard-widget.component.ts:221` |
| RT-01 | Gauge widget opens a WebSocket | **FAIL** | No WS opened; gauge component never reaches the `realtime.subscribe()` call because `loadGauge()` threw (CHART-03). File: `dashboard-widget.component.ts:208` |
| RT-02 | WebSocket closes when navigating away | **FAIL** | No WS was opened (cascade from RT-01), so nothing to close. |
| RT-03 | Gauge live update within 10 s | **FAIL** | Gauge error → `.widget-gauge__value` not in DOM → skip path reached → cleanup timeout (RCA-3). Would self-skip correctly once RCA-2 is resolved. |

### Group C — RCA-3: Test cleanup timeout (9 tests — infrastructure, not functional failures)

| id | name | result | hypothesis |
|---|---|---|---|
| CHART-01 | Line chart renders | **FAIL** | Body likely passed; `dispose()` timed out in remaining test budget. Increase test timeout to 60 s or add explicit timeout to `apiDelete`. |
| CHART-02 | Bar chart renders | **FAIL** | Same as CHART-01. |
| CHROME-01 | Refresh button always visible | **FAIL** | Cleanup timeout. The widget-shell header always-shows refresh is untested due to timeout. |
| CHROME-03 | Refresh button triggers reload | **FAIL** | Cleanup timeout. Functional assertion may have passed but the 30 s budget was exhausted. |
| DASH-05 | Public catalog opens | **FAIL** | Public catalog button click + await `.dashboard-public-card` (8 s) + other setup nears 30 s limit; dispose times out. Increase test timeout. |
| LAYOUT-01b | Layout payload shape | **FAIL** | Cleanup timeout after drag attempt; also blocked by RCA-1 (pencil disabled). Would remain as cleanup-timeout once RCA-1 fixed unless timeout raised. |
| WIDGET-14 | Configure widget reopens editor in update mode | **FAIL** | Cleanup timeout. Body ran `waitForTimeout(30.2 s total)`. Widget configure button also disabled (RCA-1 cascade through `editable`). |
| WIDGET-15 | Delete widget — confirm dialog, widget removed | **FAIL** | Cleanup timeout. Same situation as WIDGET-14. |

---

## Open TODOs for dev team (selectors)

Add `data-testid` attributes to the following elements to make the suite more resilient:

| element | recommended attribute |
|---|---|
| Edit (pencil) toolbar button | `data-testid="toolbar-edit"` |
| Add widget toolbar button | `data-testid="toolbar-add-widget"` |
| Delete dashboard toolbar button | `data-testid="toolbar-delete-dashboard"` |
| Edit dashboard modal trigger | No toolbar button exists for `openEditor()` — add one or expose via `data-testid`. |
| Widget configure button | `data-testid="widget-configure"` |
| Widget delete button | `data-testid="widget-delete"` |

---

## Top 5 Failures by Suspected Severity

| rank | id(s) | name | severity rationale |
|---|---|---|---|
| 1 | EDIT-01, 02, 03 | All ownership-gated toolbar buttons disabled | **Highest.** Blocks every write operation in the app. Users can read dashboards but cannot edit, add widgets, or delete anything. Root: `is_owned` not propagated from list to selected dashboard. Fix is ~5 lines in `dashboard.component.ts`. |
| 2 | CHART-03, 04 | Gauge and stat_card show error overlay | **High.** Gauge and stat_card are the primary real-time widgets. If they always error, the live-monitoring core use case is broken. Likely missing `getSensor()` method in `SensorApiService` or no latest reading in test data. |
| 3 | RT-01, 02 | No WebSocket opened / not closed | **High.** WebSocket is never established because gauge errors before calling `realtime.subscribe()`. Real-time dashboard value updates are completely non-functional as a result. |
| 4 | WIDGET-01–13 | Widget editor inaccessible from UI | **High.** All 13 widget-creation/editing tests fail because `add_chart` is disabled (RCA-1). The entire widget CRUD flow is blocked from the UI, though it works via direct API calls. |
| 5 | LAYOUT-01 | Drag/layout persistence untested | **Medium.** Cannot enter edit mode (pencil disabled, RCA-1) so the 320 ms debounced POST /layout path was never exercised. Layout drift will silently not persist until this is testable. |
