# MONEO Frontend Rebuild Instructions

**Project Goal:** Rebuild the MONEO sensor dashboard frontend from scratch so it pixel-matches the look and feel and the dashboard / widget creation flows of the FMC250 reference app, while running against the existing MONEO backend (sensor-centric, JWT auth) **with no backend changes**.

**Reference Project (visual + UX template):** `..\fmc250-monitoring\frontend`
**Backend (consumed as-is):** `.\backend` — see `backend/routes/*.py` and `backend/main.py` for the endpoint contract. Do not modify the backend.

**Endpoint:** End goal is the light, modular mockup style ("Outstaff"-style cards with rounded corners and pastel charts). This document covers only the *first* iteration: a faithful FMC250 clone wired to MONEO data. Visual transformation toward the mockup is a later phase.

---

## DESIGN PRINCIPLES

1. **Replace, don't migrate.** The current `frontend/` folder is a thin sensor list + four basic widget templates. We discard it and rebuild. Old code in `frontend/` may be referenced for the auth flow shape, but everything else is replaced.
2. **Backend-frozen.** The backend already exposes everything we need for the first iteration. Do not add or change backend endpoints during this rebuild. Features that *would* need backend changes are explicitly marked **DEFERRED** and dropped from the first iteration.
3. **Sensor-centric.** Where FMC250 widgets reference vehicles + date ranges, our widgets reference **sensors** + a relative time window (or absolute from/to). The visual chrome stays the same; only the picker contents and API calls change.
4. **Pixel-match FMC250's chrome.** Same operational-dark default, same operational-green accent, same left nav rail, same top page header, same dashboard toolbar, same widget shell, same edit modal layout, same gridster grid (24 cols × 64 px). Same density toggle + theme toggle.
5. **No premature abstraction.** Use NgModules with lazy-loaded feature modules, the same pattern FMC250 uses. We can refactor to standalone components later.

---

## SCOPE: WHAT'S IN, WHAT'S OUT

### IN (first iteration)
- Login page + JWT auth flow against `POST /api/auth/login` and `GET /api/auth/me`.
- App shell: top header (tenant + theme/density/profile), left navigation rail with icons.
- Dashboard list, create / edit / delete dashboards.
- Public dashboard catalog (read-only browsing — backend already serves `/api/dashboards/public`).
- 24-column gridster layout with drag/resize, debounced layout persistence.
- Four widget types backed by MONEO's analytics + readings: `line_chart`, `bar_chart`, `gauge`, `stat_card`.
- Widget create / edit modal: type picker, sensor multi-select, time range, gauge bounds.
- Theme + density toggles persisted in `localStorage`.
- Real-time updates for `gauge` and `stat_card` via the existing `/ws/sensors/{sensor_id}` WebSocket.

### OUT (deferred — would need backend or design work)
- **Favoriting public dashboards** — backend has no `/favorite` endpoint. Showing the catalog read-only is fine; "favorite" buttons are hidden in iteration 1.
- **Vehicle-specific widget types** (`fuel_level`, `rpm_analysis`, etc.) — MONEO has no vehicle concept. We use the four sensor-aware widget types instead.
- **Reports, Trips, Live Map, Events, Raw Data, Admin** — those routes existed in FMC250's left rail; for iteration 1 we render the rail with the icons disabled / "Coming soon" and only `/dashboards` is wired up.
- **Mockup ("Outstaff") visual redesign** — separate iteration.

---

## PHASE 1: PROJECT SETUP

### Step 1.1 Wipe and re-scaffold the frontend folder

From the project root:

```powershell
# Backup the current frontend (optional, in case auth code is needed for reference)
Rename-Item .\frontend .\frontend.old

# Generate a fresh Angular 20 NgModule project (matches FMC250)
npx -p @angular/cli@20 ng new frontend `
  --routing `
  --style=css `
  --standalone=false `
  --ssr=false `
  --skip-git `
  --skip-install
cd frontend
```

Notes:
- `--standalone=false` is critical — FMC250 uses NgModules, and we are matching its structure file-for-file.
- We do not enable SSR for iteration 1.

### Step 1.2 Install dependencies

Replace the generated `package.json` `dependencies` and `devDependencies` blocks with:

```jsonc
{
  "dependencies": {
    "@angular/animations": "^20.0.0",
    "@angular/cdk": "^20.0.0",
    "@angular/common": "^20.0.0",
    "@angular/compiler": "^20.0.0",
    "@angular/core": "^20.0.0",
    "@angular/forms": "^20.0.0",
    "@angular/material": "^20.2.4",
    "@angular/platform-browser": "^20.0.0",
    "@angular/platform-browser-dynamic": "^20.0.0",
    "@angular/router": "^20.0.0",
    "angular-gridster2": "^20.2.3",
    "apexcharts": "^5.3.6",
    "ng-apexcharts": "^2.0.3",
    "rxjs": "~7.8.0",
    "tslib": "^2.3.0",
    "zone.js": "~0.15.0"
  },
  "devDependencies": {
    "@angular/build": "^20.0.0",
    "@angular/cli": "^20.0.0",
    "@angular/compiler-cli": "^20.0.0",
    "@types/jasmine": "~5.1.0",
    "jasmine-core": "~5.1.0",
    "karma": "~6.4.0",
    "karma-chrome-launcher": "~3.2.0",
    "karma-coverage": "~2.2.0",
    "karma-jasmine": "~5.1.0",
    "karma-jasmine-html-reporter": "~2.1.0",
    "typescript": "~5.6.0"
  }
}
```

Run `npm install`.

### Step 1.3 Configure dev proxy to the backend

Create `proxy.conf.json` next to `angular.json`:

```json
{
  "/api": { "target": "http://localhost:8000", "secure": false, "changeOrigin": true },
  "/ws":  { "target": "ws://localhost:8000",  "secure": false, "ws": true,        "changeOrigin": true }
}
```

In `angular.json`, on the `serve` builder options add:
```json
"proxyConfig": "proxy.conf.json"
```

### Step 1.4 Final folder structure

By the end of this document the `frontend/src/app` tree should look like:

```
src/
├── index.html
├── main.ts
├── styles.css
└── app/
    ├── app.module.ts
    ├── app-routing.module.ts
    ├── app.component.ts        (just <router-outlet>)
    ├── core/
    │   ├── auth/
    │   │   ├── auth.guard.ts
    │   │   ├── auth-interceptor.service.ts
    │   │   ├── auth.service.ts
    │   │   ├── auth-utils.ts
    │   │   └── current-user.service.ts
    │   ├── ui/
    │   │   ├── ui-preferences.service.ts
    │   │   └── page-header-state.service.ts
    │   ├── sensors/
    │   │   └── sensor-api.service.ts
    │   ├── realtime/
    │   │   └── realtime.service.ts
    │   └── notifications/
    │       └── notifications.service.ts
    ├── shared/
    │   └── ui/
    │       ├── icon.directive.ts
    │       └── modal.module.ts
    ├── modules/
    │   ├── layout/
    │   │   ├── app-shell.component.{ts,html,css}
    │   │   ├── app-page-header.component.{ts,html,css}
    │   │   ├── app-nav-rail.component.{ts,html,css}
    │   │   └── layout.module.ts
    │   ├── login/
    │   │   ├── login.component.{ts,html,css}
    │   │   ├── login-routing.module.ts
    │   │   └── login.module.ts
    │   ├── dashboard/
    │   │   ├── dashboard.component.{ts,html,css}
    │   │   ├── dashboard-widget.component.{ts,html,css}
    │   │   ├── dashboard-api.service.ts
    │   │   ├── dashboard-routing.module.ts
    │   │   └── dashboard.module.ts
    │   └── widgets/
    │       ├── app-widgets-shell.component.{ts,html,css}
    │       └── widgets.module.ts
    └── types/
        ├── dashboard.ts
        ├── widget.ts
        ├── sensor.ts
        └── analytics.ts
```

---

## PHASE 2: BACKEND CONTRACT (Frozen)

The frontend must speak to these endpoints exactly. Confirm by skimming `backend/routes/*.py`. If any of the assumptions below are wrong, **adjust the frontend service calls** — do not change the backend.

### 2.1 Auth (`backend/routes/auth_routes.py`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{ username, password }` | `TokenResponse { access_token, token_type }` |
| GET  | `/api/auth/me` | (Bearer token) | `UserRead` |

Token is sent as `Authorization: Bearer <token>` header on every other request.

### 2.2 Dashboards (`backend/routes/dashboard_routes.py`)

| Method | Path | Notes |
|---|---|---|
| GET    | `/api/dashboards` | Lists dashboards owned by the logged-in user. |
| GET    | `/api/dashboards/public` | Public dashboard catalog. Read-only in iteration 1. |
| GET    | `/api/dashboards/{id}` | Single dashboard with widgets. |
| POST   | `/api/dashboards` | `DashboardCreate` body, returns 201 + dashboard. |
| PUT    | `/api/dashboards/{id}` | `DashboardUpdate` body. |
| DELETE | `/api/dashboards/{id}` | 204. |
| POST   | `/api/dashboards/{id}/widgets` | `WidgetCreate` body, returns 201 + widget. |
| POST   | `/api/dashboards/{id}/layout` | **POST, not PUT.** Body shape: `[ { id, x, y, cols, rows }, ... ]`. Returns 204. |

### 2.3 Widgets (`backend/routes/widget_routes.py`)

| Method | Path | Notes |
|---|---|---|
| PUT    | `/api/widgets/{id}` | Update title/subtitle/settings/layout. |
| DELETE | `/api/widgets/{id}` | 204. |

### 2.4 Sensors (`backend/routes/sensor_routes.py`)

| Method | Path | Notes |
|---|---|---|
| GET    | `/api/sensors` | List of `SensorRead`. Used by the widget config sensor multi-select. |
| GET    | `/api/sensors/{id}` | Single sensor (rarely needed by the dashboard). |
| GET    | `/api/sensors/{id}/readings?from_timestamp=&to_timestamp=` | `SensorTimeSeriesData`. Used by single-sensor charts. |
| GET    | `/api/sensors/{id}/latest` | Latest single reading. Used by `gauge` / `stat_card`. |
| PATCH  | `/api/sensors/{id}/active` | Not needed by dashboards. |

### 2.5 Analytics (`backend/routes/analytics_routes.py`)

| Method | Path | Notes |
|---|---|---|
| GET    | `/api/analytics?sensor_ids=1&sensor_ids=2&from=...&to=...&aggregated=true&bucket_minutes=60` | `AnalyticsResponse` covering one or more sensors at once. Used by `line_chart` and `bar_chart` widgets. |

### 2.6 Real-time (`backend/routes/websocket_routes.py`)

WebSocket: `/ws/sensors/{sensor_id}` — emits new readings as they arrive. Used to keep `gauge` / `stat_card` widgets live without polling.

### 2.7 Things the backend does NOT have

| Missing | Frontend impact (iteration 1) |
|---|---|
| `/api/dashboards/{id}/favorite` | Hide the favorite button. Treat all public dashboards as "browse-only". |
| `/api/dashboards/{id}/widgets/{widget_id}` | Use `PUT /api/widgets/{id}` and `DELETE /api/widgets/{id}` instead. |
| Vehicle endpoints / aggregates | The `vehicles`, `trips`, `events`, `raw-data`, `live` routes are deferred. |

---

## PHASE 3: GLOBAL STYLES & THEME SYSTEM

### Step 3.1 Drop the FMC250 root stylesheet in place

Create `src/styles.css` with the following structure (the values below are the FMC250 operational palette — copy them verbatim):

```css
/* Material Symbols Sharp font */
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Sharp:opsz,wght,FILL,GRAD@20..48,400..700,0..1,-50..200&display=block');
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  /* Typography */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Layout primitives */
  --app-header-h: 72px;
  --nav-rail-w: 56px;
  --nav-rail-expand-w: 224px;
  --nav-rail-radius: 12px;
  --page-pad: 1rem;
  --h-control: 2.5rem;
  --icon-size: 20px;

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-xl: 14px;

  /* Motion */
  --dur-1: 140ms;
  --dur-2: 200ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  /* Default = Operational Dark (Operational Green) */
  --color-surface-0: oklch(0.17 0.02 255);
  --color-surface-1: oklch(0.20 0.02 255);
  --color-surface-2: oklch(0.24 0.02 255);
  --color-surface-3: oklch(0.28 0.02 255);
  --color-fg:        oklch(0.92 0.01 255);
  --color-fg-muted:  oklch(0.78 0.01 255);
  --color-fg-faint:  oklch(0.66 0.01 255);
  --color-border:    oklch(0.34 0.02 255);
  --color-divider:   oklch(0.28 0.02 255);
  --color-brand:     oklch(0.72 0.12 165);
  --color-brand-soft: oklch(0.72 0.12 165 / 0.48);
  --color-brand-muted: oklch(0.60 0.08 165);
  --color-success:   oklch(0.70 0.12 155);
  --color-warning:   oklch(0.78 0.14  85);
  --color-danger:    oklch(0.62 0.16  30);
  --color-info:      oklch(0.72 0.10 220);

  /* Shadows */
  --shadow-lev-0: 0 0 0 1px color-mix(in oklch, var(--color-border) 50%, transparent);
  --shadow-lev-1: 0 1px 1px rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.18);
  --shadow-lev-2: 0 2px 4px rgba(0,0,0,0.22), 0 8px 16px rgba(0,0,0,0.24);
}

html.theme-light {
  --color-surface-0: oklch(0.98 0.005 255);
  --color-surface-1: oklch(0.96 0.005 255);
  --color-surface-2: oklch(0.94 0.005 255);
  --color-surface-3: oklch(0.89 0.01  255);
  --color-fg:        oklch(0.20 0.01 255);
  --color-fg-muted:  oklch(0.36 0.01 255);
  --color-fg-faint:  oklch(0.46 0.01 255);
  --color-border:    oklch(0.84 0.01 255);
  --color-divider:   oklch(0.90 0.01 255);
  --shadow-lev-1:    0 1px 1px rgba(15,23,32,0.06), 0 4px 8px rgba(15,23,32,0.06);
  --shadow-lev-2:    0 2px 4px rgba(15,23,32,0.08), 0 8px 16px rgba(15,23,32,0.10);
}

html.density-compact {
  --app-header-h: 60px;
  --nav-rail-w: 48px;
  --nav-rail-expand-w: 188px;
  --nav-rail-radius: 10px;
  --page-pad: 0.5rem;
  --h-control: 2.25rem;
  --icon-size: 18px;
}

html, body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-surface-0);
  color: var(--color-fg);
  -webkit-font-smoothing: antialiased;
}

.icon { font-family: 'Material Symbols Sharp'; font-weight: 500; font-size: var(--icon-size); line-height: 1; user-select: none; }
.icon-muted { color: var(--color-fg-faint); }
.icon-active { color: var(--color-brand); }
```

### Step 3.2 `UiPreferencesService`

Create `core/ui/ui-preferences.service.ts`:

```typescript
@Injectable({ providedIn: 'root' })
export class UiPreferencesService {
  private static readonly THEME_KEY   = 'ui.theme';
  private static readonly DENSITY_KEY = 'ui.density';

  init() {
    this.setTheme(this.read(UiPreferencesService.THEME_KEY, 'operational-dark'),   false);
    this.setDensity(this.read(UiPreferencesService.DENSITY_KEY, 'density-comfortable'), false);
  }
  setTheme(theme: 'operational-dark' | 'operational-light', persist = true) {
    document.documentElement.classList.toggle('theme-dark',  theme === 'operational-dark');
    document.documentElement.classList.toggle('theme-light', theme === 'operational-light');
    if (persist) localStorage.setItem(UiPreferencesService.THEME_KEY, theme);
  }
  toggleTheme() { this.setTheme(this.getTheme() === 'operational-dark' ? 'operational-light' : 'operational-dark'); }
  getTheme()   { return document.documentElement.classList.contains('theme-light') ? 'operational-light' : 'operational-dark'; }

  setDensity(density: 'density-comfortable' | 'density-compact', persist = true) {
    document.documentElement.classList.toggle('density-compact',     density === 'density-compact');
    document.documentElement.classList.toggle('density-comfortable', density === 'density-comfortable');
    if (persist) localStorage.setItem(UiPreferencesService.DENSITY_KEY, density);
  }
  toggleDensity() { this.setDensity(this.getDensity() === 'density-comfortable' ? 'density-compact' : 'density-comfortable'); }
  getDensity()   { return document.documentElement.classList.contains('density-compact') ? 'density-compact' : 'density-comfortable'; }

  private read<T extends string>(key: string, fallback: T): T {
    const v = localStorage.getItem(key); return (v as T) || fallback;
  }
}
```

Call `uiPrefs.init()` from `AppComponent.ngOnInit`.

---

## PHASE 4: AUTH

> **A note about "two bearer tokens".** The MONEO backend uses *two* separate bearer tokens that should not be confused:
>
> 1. **Upstream MONEO API token** — the backend's credential to the third-party IFM MONEO sensor API. Lives in backend env/config and is used by `services/moneo_api_client.py` only. **The frontend never sees this token.** Nothing in this document refers to it.
> 2. **User auth JWT** — issued by `POST /api/auth/login` to the logged-in user. Sent on every frontend → backend request. Everything in Phase 4 is about *this* token.

### Step 4.1 `AuthService` (`core/auth/auth.service.ts`)

The backend's `/api/auth/login` returns `{ access_token, token_type: "bearer" }` and reads `Authorization: Bearer <token>` on every protected request. The frontend stores the token in `localStorage` and attaches it to outgoing requests via the interceptor.

Storage key: `auth_token` (matches FMC250's convention).

```typescript
@Injectable({ providedIn: 'root' })
export class AuthService {
  static readonly TOKEN_KEY = 'auth_token';
  currentUser: UserRead | null = null;
  constructor(private http: HttpClient, private router: Router) {}

  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(this.http.post<{ access_token: string; token_type: string }>(
      '/api/auth/login', { username, password }));
    localStorage.setItem(AuthService.TOKEN_KEY, res.access_token);
    this.currentUser = await this.me();
  }
  async me(): Promise<UserRead> {
    return firstValueFrom(this.http.get<UserRead>('/api/auth/me'));
  }
  logout(): void {
    localStorage.removeItem(AuthService.TOKEN_KEY);
    this.currentUser = null;
    this.router.navigate(['/login']);
  }
  getToken(): string | null { return localStorage.getItem(AuthService.TOKEN_KEY); }
  hasToken(): boolean { return !!this.getToken(); }
}
```

### Step 4.2 `AuthInterceptor` and `AuthGuard`

**Interceptor** — class-based, registered via `HTTP_INTERCEPTORS` in `AppModule.providers`. Two responsibilities:
1. Attach `Authorization: Bearer <token>` to every request to `/api/**` if a token exists.
2. On a `401` response, clear the stored token and `AuthService.currentUser`, then navigate to `/login`.

```typescript
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private auth: AuthService, private router: Router) {}
  intercept(req: HttpRequest<unknown>, next: HttpHandler) {
    const token = this.auth.getToken();
    const cloned = token
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;
    return next.handle(cloned).pipe(
      catchError(err => {
        if (err instanceof HttpErrorResponse && err.status === 401) {
          localStorage.removeItem(AuthService.TOKEN_KEY);
          this.auth.currentUser = null;
          this.router.navigate(['/login']);
        }
        return throwError(() => err);
      })
    );
  }
}
```

**Guard** — `CanMatchFn`. Short-circuits to `false`/redirect if no token is present (cheap), then probes `/api/auth/me` to confirm validity and cache the user.

```typescript
export const AuthGuard: CanMatchFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.hasToken()) { router.navigate(['/login']); return false; }
  if (auth.currentUser) return true;
  try {
    auth.currentUser = await auth.me();
    return true;
  } catch {
    router.navigate(['/login']);
    return false;
  }
};
```

### Step 4.3 WebSocket auth

The `RealtimeService` socket (`/ws/sensors/{id}`) needs the same JWT. Browsers don't let you set headers on a `WebSocket`, so pass the token as a query parameter — e.g. `/ws/sensors/{id}?token=<jwt>` — if the backend supports it, or fall back to whatever auth scheme the backend's `websocket_routes.py` actually accepts. Confirm against the backend before wiring this up; this is a Phase 12 concern, not Phase 4.

### Step 4.4 Login screen (`modules/login/`)

Centered card on `surface-0` background. Form fields: `username`, `password`. Submit button uses brand color. On submit, call `AuthService.login(...)`; on success, navigate to `/dashboard`. Show backend error message ("Invalid credentials") in a `.danger` banner. Keep it minimal — this screen is not part of the FMC250 visual reference but should match the dark palette.

---

## PHASE 5: APP SHELL

### Step 5.1 `AppShellComponent` (`modules/layout/app-shell.component.*`)

Layout (template skeleton):

```html
<app-page-header></app-page-header>
<div class="app-body">
  <app-nav-rail></app-nav-rail>
  <main class="app-main"><router-outlet></router-outlet></main>
</div>
```

CSS:
- `.app-body` is a flex row taking `100dvh - var(--app-header-h)`.
- `.app-main` has `flex: 1; min-width: 0; padding: var(--page-pad);` and `overflow: auto`.

### Step 5.2 `AppPageHeader` (top bar)

Match FMC250: fixed-height (`var(--app-header-h)`) bar with:
- Left: `Albastria Logistics` tenant text → small, `--color-fg-muted`. Below it: dashboard subtitle/title block (driven by `PageHeaderStateService` so the dashboard view can override).
- Right: notification bell, density toggle, theme toggle, user avatar pill (initial + name).
- Background: `bg-surface-1/70` with `backdrop-filter: blur(10px)`, border-bottom, shadow-lev-0.

### Step 5.3 `AppNavRail` (left rail)

- Floats: `position: fixed; left: 0.5rem; top: 50%; transform: translateY(-50%);`
- Width animates from `var(--nav-rail-w)` to `var(--nav-rail-expand-w)` on `:hover` / `:focus-within` over `var(--dur-2) var(--ease-out)`.
- Background: `bg-surface-1/75 backdrop-blur-xl`, border, shadow-lev-1, `border-radius: var(--nav-rail-radius)`.
- Items (icons from Material Symbols Sharp):

| Icon | Label | Route | Iteration 1 state |
|---|---|---|---|
| `dashboard` | Dashboard | `/dashboard` | active |
| `map` | Live View | `/live` | disabled, tooltip "Coming soon" |
| `route` | Trips | `/trips` | disabled |
| `local_shipping` | Vehicles | `/vehicles` | disabled |
| `bolt` | Events | `/events` | disabled |
| `data_object` | Raw Data | `/raw-data` | disabled |
| `analytics` | Reports | `/reports` | disabled |
| `settings` | Admin | `/admin` | disabled |

Disabled items render as buttons with `aria-disabled="true"` and `pointer-events: none`. They keep the same icon styling but at `opacity: 0.45`.

---

## PHASE 6: TYPES & API CLIENTS

### Step 6.1 `types/dashboard.ts`

```typescript
export type DashboardWidgetType = 'line_chart' | 'bar_chart' | 'gauge' | 'stat_card';

export interface DashboardWidget {
  id: number;
  dashboard_id: number;
  widget_type: DashboardWidgetType;
  title?: string | null;
  subtitle?: string | null;
  x: number; y: number; cols: number; rows: number;
  settings: WidgetSettings;
  created_at: string;
  updated_at?: string;
}

export interface DashboardSummary {
  id: number;
  name: string;
  description?: string | null;
  owner_id: number | string;
  is_public: boolean;
  is_owned: boolean;        // computed client-side: ownerId === currentUserId
  widget_count: number;
  created_at: string;
  updated_at?: string;
}

export interface Dashboard extends DashboardSummary {
  widgets: DashboardWidget[];
}

export interface DashboardCreate {
  name: string; description?: string; is_public?: boolean;
}
export interface DashboardUpdate {
  name?: string; description?: string; is_public?: boolean;
}
export interface DashboardWidgetLayoutItem {
  id: number; x: number; y: number; cols: number; rows: number;
}
```

### Step 6.2 `types/widget.ts`

```typescript
export interface WidgetSettings {
  sensor_ids?: number[];
  // Time window: either relative or absolute (relative wins if both present)
  time_range_hours?: number;
  from?: string; to?: string;        // ISO 8601 (datetime-local format)
  aggregated?: boolean;
  bucket_minutes?: number;
  gauge_min?: number;
  gauge_max?: number;
  show_legend?: boolean;
  color?: string;
  [k: string]: unknown;
}

export interface DashboardWidgetCreate {
  widget_type: DashboardWidgetType;
  title?: string; subtitle?: string;
  x: number; y: number; cols: number; rows: number;
  settings: WidgetSettings;
}
export interface DashboardWidgetUpdate {
  title?: string; subtitle?: string;
  x?: number; y?: number; cols?: number; rows?: number;
  settings?: WidgetSettings;
}
```

### Step 6.3 `DashboardApiService` (`modules/dashboard/dashboard-api.service.ts`)

Map every method to the **exact** backend path documented in Phase 2.

```typescript
@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  constructor(private http: HttpClient) {}

  listDashboards()           { return firstValueFrom(this.http.get<Dashboard[]>('/api/dashboards')); }
  listPublicDashboards()     { return firstValueFrom(this.http.get<Dashboard[]>('/api/dashboards/public')); }
  getDashboard(id: number)   { return firstValueFrom(this.http.get<Dashboard>(`/api/dashboards/${id}`)); }
  createDashboard(b: DashboardCreate)            { return firstValueFrom(this.http.post<Dashboard>('/api/dashboards', b)); }
  updateDashboard(id: number, b: DashboardUpdate){ return firstValueFrom(this.http.put<Dashboard>(`/api/dashboards/${id}`, b)); }
  deleteDashboard(id: number){ return firstValueFrom(this.http.delete<void>(`/api/dashboards/${id}`)); }

  createWidget(dashboardId: number, b: DashboardWidgetCreate) {
    return firstValueFrom(this.http.post<DashboardWidget>(`/api/dashboards/${dashboardId}/widgets`, b));
  }
  updateWidget(widgetId: number, b: DashboardWidgetUpdate) {
    return firstValueFrom(this.http.put<DashboardWidget>(`/api/widgets/${widgetId}`, b));
  }
  deleteWidget(widgetId: number) {
    return firstValueFrom(this.http.delete<void>(`/api/widgets/${widgetId}`));
  }
  saveLayout(dashboardId: number, items: DashboardWidgetLayoutItem[]) {
    // Backend uses POST, not PUT.
    return firstValueFrom(this.http.post<void>(`/api/dashboards/${dashboardId}/layout`, items));
  }
}
```

### Step 6.4 `SensorApiService`

Provides the sensor list for the widget config form, single-sensor histories (used by single-sensor widgets), and "latest reading" for gauges/stat-cards.

```typescript
@Injectable({ providedIn: 'root' })
export class SensorApiService {
  constructor(private http: HttpClient) {}
  listSensors() { return firstValueFrom(this.http.get<Sensor[]>('/api/sensors')); }
  getReadings(id: number, from: string, to: string) {
    return firstValueFrom(this.http.get<SensorTimeSeriesData>(
      `/api/sensors/${id}/readings`,
      { params: { from_timestamp: from, to_timestamp: to } }));
  }
  getLatest(id: number) { return firstValueFrom(this.http.get<SensorReading>(`/api/sensors/${id}/latest`)); }

  getAnalytics(sensor_ids: number[], from: string, to: string, opts: { aggregated?: boolean; bucket_minutes?: number } = {}) {
    let params = new HttpParams().set('from', from).set('to', to);
    sensor_ids.forEach(id => params = params.append('sensor_ids', String(id)));
    if (opts.aggregated)     params = params.set('aggregated', 'true');
    if (opts.bucket_minutes) params = params.set('bucket_minutes', String(opts.bucket_minutes));
    return firstValueFrom(this.http.get<AnalyticsResponse>('/api/analytics', { params }));
  }
}
```

### Step 6.5 `RealtimeService`

Wraps `/ws/sensors/{sensor_id}` in a multiplexer keyed by sensor id. Returns an `Observable<SensorReading>` per subscription. Reconnect on close with exponential backoff (1s → 30s). Used by `gauge` and `stat_card`.

---

## PHASE 7: ROUTING & MODULE WIRING

### Step 7.1 `AppRoutingModule`

```typescript
const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'login', loadChildren: () => import('./modules/login/login.module').then(m => m.LoginModule) },
  {
    path: '',
    component: AppShellComponent,
    canMatch: [AuthGuard],
    children: [
      { path: 'dashboard', loadChildren: () => import('./modules/dashboard/dashboard.module').then(m => m.DashboardModule) },
      { path: '**', redirectTo: 'dashboard' }
    ]
  }
];
```

### Step 7.2 `AppModule`

Declarations: `AppComponent`. Imports: `BrowserModule`, `HttpClientModule`, `BrowserAnimationsModule`, `AppRoutingModule`, `LayoutModule`. Providers: the `AuthInterceptor` registered with `HTTP_INTERCEPTORS`, `multi: true`.

### Step 7.3 `DashboardModule`

```typescript
@NgModule({
  declarations: [DashboardComponent, DashboardWidgetComponent],
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    GridsterComponent, GridsterItemComponent,
    NgApexchartsModule,
    WidgetsModule,
    RouterModule.forChild([{ path: '', component: DashboardComponent }])
  ]
})
export class DashboardModule {}
```

---

## PHASE 8: DASHBOARD COMPONENT

This is the heart of the rebuild. The component is large (~700 lines in FMC250). Below is the contract; copy the FMC250 file for the layout/CSS and adapt the data calls.

### Step 8.1 Component state

```typescript
ownedDashboards: DashboardSummary[] = [];
publicDashboards: DashboardSummary[] = [];
selectedDashboardId: number | null = null;
selectedDashboard: Dashboard | null = null;
isOwnedSelected = false;
loadError: string | null = null;
saving = false;

editorOpen = false;        editorMode: 'create' | 'edit' = 'create';
publicCatalogOpen = false;
widgetEditorOpen = false;  widgetEditorMode: 'create' | 'edit' = 'create';
editingWidget: DashboardWidget | null = null;

editMode = false;          // toggles drag/resize on gridster
gridOptions!: GridsterConfig;
gridItems: { gridsterItem: GridsterItem, widget: DashboardWidget }[] = [];
```

### Step 8.2 Toolbar HTML

Lay out two button groups inside `.dashboard-toolbar` (flex row, justify-between, padding 12px, gap 12px, surface-1 with border).

Left group:
1. `<select>.dashboard-toolbar__select` listing dashboards (owned first, then a separator, then public).
2. `+` icon button → `openCreator()`.
3. `public` (globe) icon button → `openPublicCatalog()`.

Right group (only enabled when `isOwnedSelected`):
1. `edit` (pencil) icon button → toggles `editMode`.
2. `add_chart` (accent) icon button → `openWidgetCreator()`.
3. `delete` icon button → `deleteSelectedDashboard()`.

All icons: Material Symbols Sharp, 20 px in comfortable / 18 px in compact density. Disabled buttons get `opacity: 0.45; cursor: not-allowed`.

### Step 8.3 Grid

- 24-column fixed grid, fixed cell 64×64, margin 12, drag handle class `dashboard-widget-drag-handle`, ignore-content class `gridster-item-content`.
- `pushItems: true`, `compactType: 'none'`, `displayGrid: 'none'`.
- `itemChangeCallback` and `itemResizeCallback` both call `queueLayoutPersistence()`.

```typescript
private queueLayoutPersistence() {
  if (!this.editMode || !this.selectedDashboard) return;
  if (this.layoutTimer) clearTimeout(this.layoutTimer);
  this.layoutTimer = setTimeout(() => this.flushLayout(), 320);
}
private async flushLayout() {
  const items = this.gridItems.map(({ gridsterItem, widget }) => ({
    id: widget.id,
    x: gridsterItem.x ?? 0, y: gridsterItem.y ?? 0,
    cols: gridsterItem.cols ?? 1, rows: gridsterItem.rows ?? 1
  }));
  await this.api.saveLayout(this.selectedDashboard!.id, items);
}
```

Re-entry guard: keep an "in-flight" flag; if `queueLayoutPersistence()` fires while a save is in flight, set a `pending` flag and re-flush after the current save resolves.

### Step 8.4 Empty states

- No dashboards at all: full-page card `.dashboard-empty-screen` with eyebrow "Dashboards", h2 "No dashboards yet", body copy, two buttons (Create dashboard, Browse public dashboards).
- Dashboard selected but no widgets: overlay card centered on the grid: "Add a widget to start visualizing data." with an "Add widget" accent button.

### Step 8.5 Dashboard editor modal (create/edit)

Modal panel 560 px wide, three rows: header (title + close), body (form), footer (Cancel + Save).

Form:
- Name — `text` input, required.
- Description — `textarea`, optional.
- Make this dashboard public — `checkbox`. (Public flag is honoured by the backend.)

Submitting calls `createDashboard()` or `updateDashboard()` and refreshes the list. Errors render in a red `.danger-banner` at the top of the form.

### Step 8.6 Public catalog modal

Read-only list of `publicDashboards`. Each item: name, description, widget count, "Open" button → loads it via `getDashboard(id)` and sets `isOwnedSelected = false` so all edit buttons become disabled. **The favorite button is omitted (deferred).**

### Step 8.7 Widget editor modal

Wider modal (920 px). Three sections stacked:

1. **Widget Type** — eyebrow + title + 2-column grid of selection cards (`dashboard-widget-picker__card`), one per item in the catalog (Phase 9). Selected card gets a brand-tinted border + "Selected" pill.
2. **Sensors** — `<select multiple>` populated from `SensorApiService.listSensors()`. 220 px tall. Required, must have ≥1 selection.
3. **Time Range** — radio toggle: "Last X hours" (numeric input, defaults to 24) **or** "From / To" two `datetime-local` inputs. Hint text: "Used to query sensor readings."
4. *(Optional, only for `gauge`)* — gauge_min and gauge_max numeric inputs.

Footer: Cancel + Save widget. On save, build a `DashboardWidgetCreate` (or `Update`) payload and call the API.

---

## PHASE 9: WIDGET CATALOG

In `dashboard.component.ts`:

```typescript
interface WidgetCatalogItem {
  type: DashboardWidgetType;
  label: string;
  description: string;
  defaultCols: number;
  defaultRows: number;
  defaultSettings: WidgetSettings;
}

readonly widgetCatalog: WidgetCatalogItem[] = [
  {
    type: 'line_chart',
    label: 'Line Chart',
    description: 'Time-series readings for one or more sensors over a window.',
    defaultCols: 12, defaultRows: 5,
    defaultSettings: { sensor_ids: [], time_range_hours: 24, aggregated: true, bucket_minutes: 60, show_legend: true }
  },
  {
    type: 'bar_chart',
    label: 'Bar Chart',
    description: 'Aggregated values per sensor (avg / min / max in a bucket).',
    defaultCols: 8, defaultRows: 5,
    defaultSettings: { sensor_ids: [], time_range_hours: 24, aggregated: true, bucket_minutes: 60 }
  },
  {
    type: 'gauge',
    label: 'Gauge',
    description: 'Live circular gauge for the most recent reading of one sensor.',
    defaultCols: 4, defaultRows: 4,
    defaultSettings: { sensor_ids: [], gauge_min: 0, gauge_max: 100 }
  },
  {
    type: 'stat_card',
    label: 'Stat Card',
    description: 'Single big number with trend label, live-updating.',
    defaultCols: 4, defaultRows: 3,
    defaultSettings: { sensor_ids: [] }
  }
];
```

Placement on add: stack new widgets below the current max-Y so nothing overlaps.

---

## PHASE 10: DASHBOARD WIDGET COMPONENT

`dashboard-widget.component.ts` is the per-widget renderer. It:

1. Wraps content in `<app-widget-shell>` (Phase 11).
2. Switches on `widget.widget_type` to render one of:
   - `line_chart` → `apx-chart` line config.
   - `bar_chart` → `apx-chart` bar config.
   - `gauge` → custom CSS conic-gradient dial (no ApexCharts, matches FMC250's max-speed cards).
   - `stat_card` → big number + delta arrow + sparkline (apex `area` chart, 30-pt window).
3. Reads CSS variables (`--color-fg`, `--color-fg-muted`, `--color-border`) at render time so charts match the active theme.
4. Re-renders charts when the theme class on `<html>` changes (use `MutationObserver` on `document.documentElement.classList`).
5. For `gauge` and `stat_card`: subscribes to `RealtimeService.subscribe(sensor_id)` and updates the number / dial in real time, falling back to `getLatest()` for the initial value.
6. Reload button in the chrome bar re-fetches data on demand. Configure / Delete buttons emit events the parent handles.

### 10.1 Time window resolution

Helper used by every widget:

```typescript
function resolveWindow(s: WidgetSettings): { from: string; to: string } {
  if (s.time_range_hours && s.time_range_hours > 0) {
    const to = new Date();
    const from = new Date(to.getTime() - s.time_range_hours * 3600_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  return { from: s.from!, to: s.to! };
}
```

### 10.2 Line chart options

```typescript
{
  chart: { type: 'line', height: '100%', toolbar: { show: false }, zoom: { enabled: true, type: 'x', autoScaleYaxis: true } },
  stroke: { curve: 'smooth', width: 2.5 },
  xaxis: { type: 'datetime', labels: { datetimeUTC: false } },
  yaxis: { labels: { formatter: (v) => v.toFixed(1) } },
  legend: { show: settings.show_legend !== false, position: 'top', horizontalAlign: 'left' },
  grid: { borderColor: cssVar('--color-border'), strokeDashArray: 4 },
  tooltip: { theme: isDark() ? 'dark' : 'light', x: { format: 'dd MMM yyyy HH:mm' } },
  colors: ['#37c79a', '#56b9ff', '#ffbf47', '#ff7a59', '#9b8cff', '#5ed3c6'],
  noData: { text: 'No readings in this window' }
}
```

Series: one per `sensor_ids[i]`, mapping `AnalyticsResponse.data[i].points` → `[ts, value]` tuples.

### 10.3 Bar chart options

Vertical bars, distributed colors, 48% column width, 6px border radius, datalabels showing the value with the sensor's unit (read from the sensor metadata that came back in the analytics response).

### 10.4 Gauge

CSS-only dial:

```css
.gauge {
  width: 148px; aspect-ratio: 1;
  background: conic-gradient(from 180deg,
              color-mix(in oklch, var(--color-brand) 76%, transparent) calc(var(--p) * 1%),
              color-mix(in oklch, var(--color-surface-3) 52%, transparent) 0);
  border-radius: 50%;
  display: grid; place-items: center;
}
.gauge::after { /* inner disc with value */ }
```

`--p` is `(value - gauge_min) / (gauge_max - gauge_min) * 100`, clamped to 0–100. Use the brand color for normal, warning at 80%, danger at 95%. Label shows the rounded value + unit.

### 10.5 Stat card

Two columns: big number left (font-size: clamp(2rem, 4vw, 3rem), mono font), small delta arrow + percentage versus the value 1 hour ago (computed from a tiny readings call). Right column: 30-point area sparkline (apex `area`, no axes, `colors` brand). Updates live via `RealtimeService`.

---

## PHASE 11: WIDGET SHELL (modules/widgets)

`AppWidgetsShellComponent` is a presentational wrapper used by every widget. It owns the card chrome FMC250 uses:

- Outer `<section>` with `border`, `border-radius: var(--radius-xl)`, `background: var(--color-surface-2)/65 backdrop-blur`, `box-shadow: var(--shadow-lev-1)`. On hover lift `translateY(-1px)` and bump to `--shadow-lev-2`.
- Optional left "tone bar" (2 px wide) colored per `tone` input: `success` | `warning` | `danger` | `info` | `neutral`.
- **Header row** — `dashboard-widget-drag-handle` (used by gridster), `cursor: grab`, contains:
  - `<h3>` title (truncated)
  - subtitle `<span>` (`xs`, `--color-fg-muted`)
  - `[widgetBadge]` projected slot (e.g. "3 SENSORS")
  - `[widgetActions]` projected slot (refresh button is always visible)
- **Body** — `<ng-content>`. Flex 1, padded with `var(--page-pad)`, `min-height: 0`.
- **Chrome bar** — absolute positioned at the bottom, hidden until the card is hovered. Contains `[widgetMeta]` on the left and `[widgetChrome]` on the right (typically reset-zoom, refresh, configure, delete buttons).

API:

```typescript
@Input() title: string;
@Input() subtitle?: string;
@Input() tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' = 'neutral';
@Input() chromeMode: 'auto' | 'pinned' = 'auto';
```

`tone` is computed by the dashboard-widget component from the widget type (e.g. `gauge`/`stat_card` → `info`, `line_chart` → `success`).

---

## PHASE 12: REAL-TIME UPDATES

`RealtimeService` opens one WebSocket per subscribed sensor (or one shared socket if you implement a hub). Use `RxJS` `webSocket(...)` from `rxjs/webSocket`. Reconnect with exponential backoff. Clean up sockets when no widget is subscribed.

Important: do **not** open WebSockets for `line_chart` / `bar_chart` widgets — those are pull-based on demand. WebSockets are only for `gauge` and `stat_card`.

---

## PHASE 13: STYLING DETAILS THAT MATTER FOR PIXEL MATCH

These are the spots where small CSS deviations make the dashboard look "off" compared to FMC250. Copy the values exactly.

- Toolbar background: `1px solid color-mix(in oklch, var(--color-border) 74%, transparent)`, gradient blend with brand at low alpha, `border-radius: var(--radius-lg)`.
- Toolbar buttons: pill (border-radius 999px) for text buttons; `38×38` icon-only buttons with border-radius 12px.
- Active accent button: tinted `color-mix(in oklch, var(--color-brand) 18%, var(--color-surface-1))` background, `--color-brand` text.
- Modal backdrop: `rgba(7,10,14,0.48)` with `backdrop-filter: blur(10px)`.
- Modal panel: `var(--color-surface-1)` background, border, `border-radius: var(--radius-xl)`, `box-shadow: var(--shadow-lev-2)`.
- Grid item hover: lift `translateY(-1px)`, surface from `surface-2` to `surface-3`, shadow `lev-1` → `lev-2`.
- Gridster resize handle (SE corner): 26×26 px transparent hit area, visual indicator only on hover (16×16 quarter-circle gradient with subtle border).

Spacing inside widgets must use `var(--page-pad)` and `var(--h-control)` so density compact mode shrinks the chrome correctly.

---

## PHASE 14: SUCCESS CRITERIA FOR ITERATION 1

The rebuild is "done" when:

1. `npm start` boots the app, the dev proxy reaches the running backend on port 8000, and the login screen accepts a valid backend user. The JWT is stored in `localStorage` under `auth_token` and attached as `Authorization: Bearer …` to every API request.
2. After login the user lands on `/dashboard` with the FMC250-style page header, the left nav rail (only Dashboard active), and the dashboards toolbar.
3. The user can:
   - Create a dashboard via the editor modal.
   - Open the public catalog and load a public dashboard read-only.
   - Add a widget of each of the four types via the widget editor modal, picking one or more sensors.
   - Drag and resize widgets in edit mode; layout is persisted (debounced 320 ms).
   - See live values on `gauge` and `stat_card` widgets via WebSocket.
   - Switch theme (dark ↔ light) and density (comfortable ↔ compact) — charts re-render with the new theme.
4. No backend code has been touched. No new endpoints are needed.
5. The codebase compiles under Angular 20 strict mode with no warnings.

---

## PHASE 15: NEXT ITERATION (preview only — do not start yet)

Once iteration 1 is in, the next step is the visual move toward the "Outstaff" mockup:

- Switch the default theme to a light, soft palette (white surfaces, pastel chart colors).
- Pull the nav rail flush left and convert it from a floating pill to a full-height sidebar with section headers.
- Replace the toolbar with separate pill-cards for each metric (today's totals, balance, etc.).
- Replace `gauge` and `stat_card` chrome with rounded, shadowed cards matching the mockup.
- Introduce a "Top tasks" / "Recent" panel pattern.

That iteration will be specified in a separate document. Nothing in iteration 1 should be designed to **block** that change — the CSS-variable theme system already supports it.

---

## REFERENCE MATERIALS

- FMC250 source (visual + UX template): `..\fmc250-monitoring\frontend\src\app`
  - Read first: `modules/dashboard/dashboard.component.{ts,html,css}`
  - Then: `modules/dashboard/dashboard-widget.component.{ts,html,css}`
  - Then: `modules/widgets/app-widgets-shell.component.{ts,html,css}`
  - Then: `modules/layout/app-shell.component.{ts,html,css}` and the page header / nav rail components.
  - Theme: `core/ui/ui-preferences-service.ts` and `styles.css`.
- MONEO backend (frozen contract): `.\backend\routes\*.py` and `.\backend\main.py`.
- Original spec for context: `.\IMPLEMENTATION_INSTRUCTIONS.md`.
