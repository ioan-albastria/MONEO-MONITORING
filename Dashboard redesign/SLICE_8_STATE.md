# Slice 8 — State

## What this slice covered

Implemented §5.2 Kiosk mode and §5.3 URL-shareable dashboard state. Backend: migration
0008 (`kiosk_tokens` table), `KioskToken` SQLAlchemy model, `AuthService.create_kiosk_token()`
helper, admin CRUD endpoints for kiosk tokens, `KioskPrincipal` dataclass in middleware
(kiosk JWT path in `get_current_user`), and `UserRead` extension. Frontend: `KioskService`
(URL token detection, CSS class, badge fade, dashboard cycling), `APP_INITIALIZER` for
kiosk token detection before the auth guard fires, `AppShellComponent` kiosk integration,
global CSS hiding rules, `DashboardUrlService`, and `DashboardComponent` URL sync on
every state change plus a copy-link button.

---

## Parts completed

**Part A — Migration 0008**
`backend/migrations/versions/0008_kiosk_tokens.py` created.
- revision `0008`, down_revision `0007`
- Creates `kiosk_tokens` table: `id`, `dashboard_ids` (JSON, `server_default='[]'`),
  `label`, `expires_at` (nullable timestamptz), `created_by` FK→users.id ON DELETE SET NULL,
  `is_active` (bool default true), `created_at` (timestamptz default NOW()).
- Creates `idx_kiosk_tokens_active` on `is_active`.
- `downgrade()` drops index then table.

**Part B — KioskToken model**
`backend/DAL/models/kiosk_token.py` created with `Mapped[]`/`mapped_column()` pattern.
`backend/migrations/env.py` updated: `import DAL.models.kiosk_token  # noqa: F401` added.

**Part C — AuthService helper**
`AuthService.create_kiosk_token(kiosk_token_id, expires_at)` static method added.
Payload: `{"kiosk_token_id": int, "exp": datetime}`. Uses same secret + algorithm as
regular tokens.

**Part D — Admin kiosk endpoints**
`backend/routes/admin_kiosk_routes.py` created.
- `POST /api/admin/kiosk-tokens` — creates row, flushes to get ID, generates kiosk JWT
  (long-lived fallback: +10y if `expires_days=0`), commits, returns `KioskTokenRead` with
  `token` field (JWT shown once).
- `GET /api/admin/kiosk-tokens` — lists all tokens (no JWT).
- `DELETE /api/admin/kiosk-tokens/{id}` — soft-revoke (`is_active = False`), status 204.
- All protected by `requires_role("admin")`.

`backend/main.py` updated: `admin_kiosk_router` imported and registered with
`app.include_router(admin_kiosk_router)`.

**Part E — Middleware: KioskPrincipal + updated get_current_user**
`backend/middleware.py` rewritten:
- `KioskPrincipal` dataclass added: `id=0, username='kiosk', email='', is_active=True,
  role='kiosk', is_kiosk=True, kiosk_dashboard_ids: list`.
- `get_current_user` updated: if payload has `kiosk_token_id`, looks up `KioskToken`,
  validates `is_active`, checks `expires_at` (see deviations), returns `KioskPrincipal`.
  Existing `user_id` path unchanged.
- `requires_role` signature updated to use un-annotated `current_user=Depends(...)` for
  compatibility with both `User` and `KioskPrincipal` return types.

**Part F — UserRead + User model extensions**
`backend/routes/response_models/auth.py`: `is_kiosk: bool = False` and
`kiosk_dashboard_ids: list[int] = []` added to `UserRead`.

`backend/DAL/models/user.py`: `is_kiosk` and `kiosk_dashboard_ids` added as `@property`
methods returning `False`/`[]` so Pydantic's `from_attributes=True` serialisation works
for real `User` ORM objects without `getattr` errors.

**Part G — KioskService**
`frontend/src/app/core/kiosk/kiosk.service.ts` created (`providedIn: 'root'`).
- `checkForKioskToken()` — reads `?kt=` from `window.location.search`, stores in
  `localStorage['auth_token']`. Called from `APP_INITIALIZER`.
- `activateIfKiosk(user)` — if `user.is_kiosk`, adds `kiosk` class to
  `document.documentElement`, emits `_isKiosk$.next(true)`, shows badge for 10s,
  starts cycling timer if `?cycle=N` and `kiosk_dashboard_ids.length > 1`.
- `activeDashboardId$: BehaviorSubject<number | null>` — emits current cycling ID.
- `_startCycle(intervalSeconds)` — `setInterval` rotating through `dashboardIds`.
- Cleans up timers in `ngOnDestroy`.

**Part H — APP_INITIALIZER**
`frontend/src/app/app-module.ts` updated:
- `APP_INITIALIZER` provider added: `initKioskToken(kiosk) => () => kiosk.checkForKioskToken()`.
- `KioskService` added to `deps`.
- Runs synchronously before the router fires any guards.

**Part I — AppShellComponent kiosk integration**
`frontend/src/app/modules/layout/app-shell.component.ts`: `KioskService` injected;
`this.kiosk.activateIfKiosk(this.auth.currentUser!)` called in `ngOnInit` after
`userName` is set. `kioskService` exposed as a `readonly` field for template bindings.

`frontend/src/app/modules/layout/app-shell.component.html`: kiosk badge div added
(`*ngIf="kioskService.showBadge$ | async"`, class `kiosk-badge`).

`frontend/src/app/modules/layout/layout.module.ts`: `CommonModule` confirmed present
(needed for `async` pipe in the badge `*ngIf`).

`frontend/src/styles.css`: kiosk hiding rules + badge + `@keyframes kiosk-badge-fade`
appended:
- `html.kiosk app-page-header { display: none !important }`
- `html.kiosk app-nav-rail { display: none !important }`
- `html.kiosk .dashboard-toolbar__group--right { display: none !important }` (see deviations)
- `html.kiosk main.flex-1 { padding: 0 !important }`
- `.kiosk-badge` — fixed bottom-right, brand background, fade animation.

**Part J — DashboardUrlService + DashboardComponent URL state**
`frontend/src/app/core/dashboard/url.service.ts` created (`providedIn: 'root'`).
- `readParams()` — reads `d`, `preset`, `ar`, `from`, `to` from `window.location.search`.
- `syncParams(state)` — calls `router.navigate([], { queryParams, replaceUrl: true,
  queryParamsHandling: 'merge' })`. Null-valued params are cleared.
- `copyLink()` — `navigator.clipboard.writeText(window.location.href)` with textarea
  fallback.

`frontend/src/app/modules/dashboard/dashboard.component.ts` updated:
- `DashboardUrlService` and `KioskService` injected in constructor.
- `_kioskSub: Subscription | null` field added; unsubscribed in `ngOnDestroy`.
- `ngOnInit()`: reads URL params before `loadDashboards(urlParams.d)`, calls
  `_applyUrlTimeParams()` then `_syncUrlFromState()` after load, subscribes to
  `kioskService.activeDashboardId$` if kiosk mode is active.
- `_applyUrlTimeParams(urlParams)` private method: applies `preset`/`ar`/`from`/`to`
  overrides to `DashboardTimeService` (URL params take precedence over dashboard defaults).
- `_syncUrlFromState()` private method: calls `urlService.syncParams(...)` with current
  `selectedDashboardId`, `timeRange.preset`, `timeRange.autoRefreshSeconds`,
  `timeRange.from`, `timeRange.to`.
- `_syncUrlFromState()` called at the end of `selectDashboardById()`,
  `onPresetSelected()`, and `onAutoRefreshChanged()`.
- `copyDashboardLink()` method: calls `void this.urlService.copyLink()`.

`frontend/src/app/modules/dashboard/dashboard.component.html`: copy-link button added
to the right toolbar group with `(click)="copyDashboardLink()"` and Material icon `link`.

---

## Files created

| File | Notes |
|---|---|
| `backend/migrations/versions/0008_kiosk_tokens.py` | Migration — kiosk_tokens table |
| `backend/DAL/models/kiosk_token.py` | KioskToken ORM model |
| `backend/routes/admin_kiosk_routes.py` | Admin CRUD + kiosk JWT generation |
| `frontend/src/app/core/kiosk/kiosk.service.ts` | KioskService |
| `frontend/src/app/core/dashboard/url.service.ts` | DashboardUrlService |

---

## Files changed

| File | Change |
|---|---|
| `backend/migrations/env.py` | Added `import DAL.models.kiosk_token` |
| `backend/services/auth_service.py` | Added `create_kiosk_token()` static method |
| `backend/middleware.py` | Added `KioskPrincipal`; updated `get_current_user`; `requires_role` return type loosened |
| `backend/routes/response_models/auth.py` | Added `is_kiosk`, `kiosk_dashboard_ids` to `UserRead` |
| `backend/DAL/models/user.py` | Added `is_kiosk` and `kiosk_dashboard_ids` as `@property` |
| `backend/main.py` | Added `admin_kiosk_router` |
| `frontend/src/app/app-module.ts` | Added `APP_INITIALIZER` for kiosk token detection |
| `frontend/src/app/core/auth/auth.service.ts` | Extended `UserRead` interface; added `storeToken()` |
| `frontend/src/app/modules/layout/app-shell.component.ts` | Injected `KioskService`; calls `activateIfKiosk` |
| `frontend/src/app/modules/layout/app-shell.component.html` | Added kiosk badge |
| `frontend/src/app/modules/dashboard/dashboard.component.ts` | URL sync, kiosk cycling sub, `copyDashboardLink` |
| `frontend/src/app/modules/dashboard/dashboard.component.html` | Copy-link button; `dashboard-toolbar__group--right` class |
| `frontend/src/styles.css` | Kiosk hiding rules + badge CSS + animation |

---

## Spec deviations

**1 — expires_at comparison simplified**
The prompt included a `.replace(tzinfo=timezone.utc ...)` edge-case guard for naive
datetimes. PostgreSQL always returns tz-aware datetimes for `TIMESTAMP WITH TIME ZONE`
columns, so the guard was unnecessary. Simplified to:
```python
if kt.expires_at and kt.expires_at < datetime.now(timezone.utc):
```

**2 — `.dashboard-toolbar__group--right` class added to existing div**
The CSS kiosk hiding rule targets `.dashboard-toolbar__group--right` to hide edit/save
buttons in kiosk mode. This class was not present on the right toolbar group div in
`dashboard.component.html`. The agent added it to the existing `<div>` element wrapping
the right-side toolbar controls. No layout change — it's additive.

---

## Build status

`ng build` — zero TypeScript errors, zero Angular errors. Two **pre-existing** budget
warnings (bundle size, CSS size) remain; not introduced by Slice 8.

---

## Outstanding work entering Slice 9

1. **Backend test coverage** — `test_slice3.py` through `test_slice8.py` still absent.
   Kiosk token security (Slice 8) is the highest priority for test coverage.
2. **Admin panel UI** — kiosk token management and user role management have full backend
   APIs but no frontend admin page. Route `/admin` exists in `routeTitles` but no module
   or component has been created.
3. **Admin asset tree editor** — drag-drop reparenting UI (API in place from Slice 6).
4. **Deep tree nesting** — `AssetTreePickerComponent` renders 2 levels; grandchildren not shown.
5. **Bulk widget actions** — Part H from Slice 7, skipped as P2.
6. **§6.1 Upstream + analytics caching** — not yet started.
