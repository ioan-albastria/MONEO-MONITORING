# MONEO Frontend E2E Test Plan

## Prerequisites

- **Backend:** running at `http://localhost:8000`
- **Seed data (manual step):** The backend must have the following data before running the suite. Since there is no public user-creation endpoint, seed this manually:
  - User: `admin` / `changeme` (or whatever credentials the backend was initialised with)
  - At least 3 sensors with recent readings (within the last 24 h)
  - At least one public dashboard (created by admin)
- **Frontend:** `ng serve` at `http://localhost:4200` — Playwright's `webServer` block starts it automatically.

---

## Test Cases

### AUTH — Authentication & Authorization

| id | description | spec section | expected |
|---|---|---|---|
| AUTH-01 | Login success: correct credentials → navigates to `/dashboard`, `auth_token` written to `localStorage` | Phase 4.1, Phase 14 criterion 1 | pass |
| AUTH-02 | Login failure: wrong password → error banner visible, user stays on `/login`, no token stored | Phase 4.4 | pass |
| AUTH-03 | Guard redirect: navigating to `/dashboard` without a stored token redirects to `/login` | Phase 4.2 (AuthGuard) | pass |
| AUTH-04 | Interceptor: every XHR to `/api/**` carries `Authorization: Bearer <token>` header | Phase 4.2 (AuthInterceptor) | pass |
| AUTH-05 | 401 handling: a `401` response from the backend clears `auth_token` and redirects to `/login` | Phase 4.2 (AuthInterceptor) | pass |

---

### DASH — Dashboard List & CRUD

| id | description | spec section | expected |
|---|---|---|---|
| DASH-01 | Dashboard list loads: after login the select dropdown contains the user's owned dashboards | Phase 8.1, Phase 14 criterion 2 | pass |
| DASH-02 | Create dashboard: clicking `+` opens the editor modal; filling name, description, public flag and saving produces a new entry in the select | Phase 8.5, Phase 14 criterion 3 | pass |
| DASH-03 | Edit dashboard: with an owned dashboard selected the editor opens in "Update dashboard" mode and saves new values | Phase 8.5 | pass |
| DASH-04 | Delete dashboard: confirm dialog appears, on confirm the dashboard is removed from the list | Phase 8.2, Phase 14 criterion 3 | pass |
| DASH-05 | Public catalog opens: clicking the globe button shows the public catalog modal with at least one entry | Phase 8.6, Phase 14 criterion 3 | pass |
| DASH-06 | Open public dashboard: clicking "Open" in the catalog loads the dashboard and `isOwnedSelected` is `false` (toolbar shows disabled right-group buttons) | Phase 8.6 | pass |
| DASH-07 | Toolbar select: switching between two owned dashboards via the `<select>` updates the page header title | Phase 8.1, Phase 8.2 | pass |
| DASH-08 | Empty state: a fresh user with no dashboards sees the "No dashboards yet" empty screen with Create and Browse buttons | Phase 8.4 | pass |

---

### EDIT — Edit Mode & Ownership Guards

| id | description | spec section | expected |
|---|---|---|---|
| EDIT-01 | Pencil button enabled: with an owned dashboard selected the edit (pencil) button is **not** disabled | Phase 8.2, known bug | pass |
| EDIT-02 | Add-widget button enabled: with an owned dashboard selected the `add_chart` button is **not** disabled | Phase 8.2, known bug | pass |
| EDIT-03 | Delete-dashboard button enabled: with an owned dashboard selected the delete button is **not** disabled | Phase 8.2 | pass |
| EDIT-04 | Edit mode toggle: clicking the pencil on an owned dashboard switches the button to "active" state and shows the edit-mode banner | Phase 8.2 | pass |
| EDIT-05 | Read-only guard: opening a non-owned public dashboard disables pencil, add_chart, and delete buttons | Phase 8.2, Phase 8.6 | pass |
| EDIT-06 | Leaving edit mode: clicking the pencil again while active exits edit mode (banner disappears, button no longer active) | Phase 8.2 | pass |

---

### WIDGET — Widget Editor & CRUD

| id | description | spec section | expected |
|---|---|---|---|
| WIDGET-01 | Widget editor opens: clicking `add_chart` on an owned dashboard opens the widget editor modal | Phase 8.7 | pass |
| WIDGET-02 | Type picker — line_chart: clicking the Line Chart card marks it selected (`.widget-picker-card--selected`) | Phase 8.7, Phase 9 | pass |
| WIDGET-03 | Type picker — bar_chart: clicking the Bar Chart card selects it | Phase 8.7, Phase 9 | pass |
| WIDGET-04 | Type picker — gauge: clicking the Gauge card selects it and reveals the gauge bounds section | Phase 8.7, Phase 9 | pass |
| WIDGET-05 | Type picker — stat_card: clicking the Stat Card card selects it | Phase 8.7, Phase 9 | pass |
| WIDGET-06 | Sensor multi-select populated: opening the widget editor fetches and lists at least 3 sensor options | Phase 8.7, Phase 6.4 | pass |
| WIDGET-07 | Time range toggle: switching from "Last X hours" to "From / To" hides the hours input and shows two datetime-local inputs | Phase 8.7 | pass |
| WIDGET-08 | Gauge bounds visible only for gauge type: min/max inputs appear for gauge and are absent for line_chart | Phase 8.7 | pass |
| WIDGET-09 | Save validation: trying to save without selecting a sensor shows "Select at least one sensor." error | Phase 8.7 | pass |
| WIDGET-10 | Create line_chart widget: select a sensor, save → widget appears on the grid at row ≥ 0 | Phase 8.7, Phase 9, Phase 14 criterion 3 | pass |
| WIDGET-11 | Create bar_chart widget: select a sensor, save → widget appears on the grid | Phase 8.7, Phase 9 | pass |
| WIDGET-12 | Create gauge widget: select a sensor, save → gauge widget appears on the grid | Phase 8.7, Phase 9 | pass |
| WIDGET-13 | Create stat_card widget: select a sensor, save → stat card widget appears on the grid | Phase 8.7, Phase 9 | pass |
| WIDGET-14 | Configure widget: clicking the chrome-bar configure (tune) button opens the editor in "Update widget" mode | Phase 8.7, Phase 10 | pass |
| WIDGET-15 | Delete widget: clicking the chrome-bar delete button shows a confirm dialog; on confirm the widget is removed | Phase 10, Phase 14 criterion 3 | pass |

---

### CHROME — Widget Shell Chrome

| id | description | spec section | expected |
|---|---|---|---|
| CHROME-01 | Refresh button in widget header (header-row action) is always visible | Phase 11 | pass |
| CHROME-02 | Configure and delete buttons in chrome bar are disabled when `editable` is false (non-owned dashboard) | Phase 10, Phase 11 | pass |
| CHROME-03 | Chrome bar buttons enabled on owned dashboard: configure and delete buttons have no `disabled` attribute | Phase 10, Phase 11 | pass |

---

### LAYOUT — Drag & Layout Persistence

| id | description | spec section | expected |
|---|---|---|---|
| LAYOUT-01 | After dragging a widget in edit mode, `POST /api/dashboards/{id}/layout` is sent exactly once after the ~320 ms debounce with a body that is an array of `{ id, x, y, cols, rows }` | Phase 8.3, Phase 14 criterion 3 | pass |

---

### CHART — Widget Rendering

| id | description | spec section | expected |
|---|---|---|---|
| CHART-01 | Line chart renders: a line_chart widget with a sensor with recent data shows an `apx-chart` element (no error/empty overlay) | Phase 10, Phase 14 criterion 3 | pass |
| CHART-02 | Bar chart renders: a bar_chart widget with data shows an `apx-chart` element | Phase 10 | pass |
| CHART-03 | Gauge renders: a gauge widget with data shows `.widget-gauge__dial` with a non-zero value | Phase 10 | pass |
| CHART-04 | Stat card renders: a stat_card widget with data shows `.widget-stat__value` with a numeric value | Phase 10 | pass |
| CHART-05 | Empty state: a widget configured with a sensor that has no readings in the selected window shows `.widget-state-overlay--empty` | Phase 10 | pass |

---

### THEME — Theme & Density Toggles

| id | description | spec section | expected |
|---|---|---|---|
| THEME-01 | Theme toggle (header): clicking "Theme" button adds `theme-light` class to `<html>` when starting from dark | Phase 3.2, Phase 14 criterion 3 | pass |
| THEME-02 | Theme toggle returns: clicking again removes `theme-light` and restores dark | Phase 3.2 | pass |
| THEME-03 | Theme persists: after toggle, `localStorage['ui.theme']` reflects the new value | Phase 3.2 | pass |
| THEME-04 | Density toggle (nav rail): clicking the density button adds `density-compact` class to `<html>` | Phase 3.2, Phase 14 criterion 3 | pass |
| THEME-05 | Density persists: after toggle, `localStorage['ui.density']` reflects the new value | Phase 3.2 | pass |

---

### RT — Real-time WebSocket

| id | description | spec section | expected |
|---|---|---|---|
| RT-01 | Opening a dashboard with a gauge widget causes a WebSocket connection to `/ws/sensors/{id}` | Phase 12, Phase 14 criterion 3 | pass |
| RT-02 | Navigating away from the dashboard (or destroying the widget) closes the WebSocket | Phase 12 | pass |
| RT-03 | Gauge value live update: within 10 s of the WS connecting, the gauge value displayed changes to the incoming reading's value — **skipped with note if no reading arrives in that window** | Phase 12, Phase 14 criterion 3 | pass |

---

## Selector Notes (no `data-testid` in source)

The source has no `data-testid` attributes. Tests use the stable CSS classes and `aria-label` / `title` attributes present in the templates:

| element | selector used |
|---|---|
| Username input | `#username` |
| Password input | `#password` |
| Login submit | `button.btn-login` |
| Login error | `.login-form__error-banner` |
| Dashboard select | `select.dashboard-toolbar__select` |
| New dashboard btn | `button[aria-label="New dashboard"]` |
| Public catalog btn | `button[aria-label="Public dashboards"]` |
| Edit (pencil) btn | `button[aria-label="Toggle edit mode"]` |
| Add widget btn | `button[aria-label="Add widget"]` |
| Delete dashboard btn | `button[aria-label="Delete dashboard"]` |
| Dashboard modal | `.dashboard-modal` |
| Dashboard name input | `.dashboard-modal input[type=text]` (first) |
| Widget editor modal | `.dashboard-modal__panel--xl` |
| Widget type cards | `.widget-picker-card` |
| Sensor multi-select | `select[multiple].dashboard-toolbar__select--multi` |
| Edit mode banner | `.dashboard-edit-banner` |
| Gauge dial | `.widget-gauge__dial` |
| Stat card value | `.widget-stat__value` |
| ApexCharts element | `apx-chart` |
| Empty-state overlay | `.widget-state-overlay--empty` |
| Theme button (header) | `button[title="Toggle theme"]` |
| Density button (header) | `button[title="Toggle density"]` |

**TODO for dev team:** Add `data-testid` attributes to the edit, add-widget, and delete toolbar buttons to make selectors more resilient against title/aria-label changes.
