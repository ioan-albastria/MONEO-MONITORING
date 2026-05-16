# Slice 9 — State

## What this slice covered

Implemented §6.2 minimal admin panel: backend admin user routes (list users, change
role), kiosk-token pytest coverage, `AdminModule` with a tab-shell page, a kiosk-token
management page (list / create / revoke + URL builder), and a user management page
(inline role editor). Also added `role` to `UserRead` on both backend and frontend so
the current user's role is available throughout the app.

---

## Parts completed

**Part A — Admin user API**
`backend/routes/admin_user_routes.py` created.
- `UserAdminRead` Pydantic model added to `auth.py` response models (id, username, email,
  role, is_active, created_at).
- `role: str = 'viewer'` added to existing `UserRead` so `GET /api/auth/me` now returns
  the user's role.
- `GET /api/admin/users` — returns all users ordered by `created_at`; protected by
  `requires_role("admin")`.
- `PATCH /api/admin/users/{user_id}/role` — validates role is a valid literal, blocks
  self-change (400), 404 on unknown user, commits and returns updated `UserAdminRead`.
- `admin_user_router` registered in `main.py`.

**Part B — Kiosk pytest coverage**
`backend/tests/test_kiosk.py` created with 13 tests. Coverage:
- `create_kiosk_token` generates a JWT with `kiosk_token_id` and no `user_id` in payload.
- Expired kiosk JWT raises `ValueError` from `decode_token`.
- `KioskToken` model: default `is_active`, soft-revoke, JSON `dashboard_ids` round-trip,
  `None` expiry, future expiry.
- `KioskPrincipal`: role is `'kiosk'`, `is_kiosk` is `True`, not in admin/operator roles.
- Real `User.is_kiosk` property returns `False`; `kiosk_dashboard_ids` returns `[]`.
- Role mutation in DB via direct ORM write.
- `db.get(User, 999)` returns `None`.

All 13 tests pass. Three `python-jose` deprecation warnings (from `jwt.utcnow()`
internal usage — not project code) are present but benign.

**Part C — AdminModule scaffold + routing**
`frontend/src/app/modules/admin/` directory created with:
- `admin-routing.module.ts` — single route `{ path: '', component: AdminPageComponent }`.
- `admin-page.component.ts/.html/.css` — tab-shell with "Kiosk Tokens" and "Users" tabs;
  `activeTab: AdminTab` field; simple `setTab()` method. Root element given `canvas-view`
  class (see deviation 5) to avoid nav-rail overlap.
- `admin.module.ts` — declares `AdminPageComponent`, `AdminKioskTokensComponent`,
  `AdminUsersComponent`; imports `CommonModule`, `FormsModule`, `AdminRoutingModule`.

`frontend/src/app/app-routing.module.ts` — `{ path: 'admin', loadChildren: ... }` added
before the `'**'` wildcard.

`frontend/src/app/modules/layout/app-nav-rail.component.ts` — Admin nav item changed
from `enabled: false` to `enabled: true`.

`frontend/src/app/core/admin/admin-api.service.ts` created (`providedIn: 'root'`); wraps
all `/api/admin/users` and `/api/admin/kiosk-tokens` endpoints.

**Part D — Admin kiosk tokens page**
`admin-kiosk-tokens.component.ts/.html/.css` created.
- Loads token list on init; table shows id, label, dashboard IDs, status chip,
  expiry date, created date, revoke button.
- "New Token" toggle shows inline create form: label, dashboard IDs (comma-separated),
  expires-days, cycle-seconds (for URL builder).
- On creation: calls `api.createKioskToken()`, builds kiosk URL
  (`/dashboard?kt=<jwt>&d=<id>&cycle=<n>`), then opens a **"Token Created" modal**
  (see deviation 2) that shows the JWT + URL with copy buttons. JWT is shown once and
  not retrievable after the modal is dismissed. Copy buttons use `ToastService`
  (see deviation 3).
- Revoke calls `DELETE /api/admin/kiosk-tokens/{id}`; prompts `confirm()` first.
- Cancel button uses `btn-ghost` with a `close` icon (see deviation 4).

**Part E — Admin users page**
`admin-users.component.ts/.html` created.
- Loads users on init; wraps each in `UserRow` with `editRole` + `saving` + `saveError`.
- Inline `<select>` for role; "Save" button enabled only when `editRole !== role`.
- Own row shows "(you)" badge and disables Save.
- `saveRole()` calls `PATCH /api/admin/users/{id}/role`; resets `editRole` to original
  on error.

**Part F — Frontend UserRead role field**
`frontend/src/app/core/auth/auth.service.ts` — `role?: string` added to `UserRead`.
Since `GET /api/auth/me` now returns `role`, the current user's role is available as
`auth.currentUser?.role` anywhere in the app.

---

## Files created

| File | Notes |
|---|---|
| `backend/routes/admin_user_routes.py` | List users + change role |
| `backend/tests/test_kiosk.py` | 13 pytest tests |
| `frontend/src/app/core/admin/admin-api.service.ts` | HTTP wrapper for admin endpoints |
| `frontend/src/app/modules/admin/admin-routing.module.ts` | |
| `frontend/src/app/modules/admin/admin-page.component.ts/.html/.css` | Tab shell; canvas-view class for layout |
| `frontend/src/app/modules/admin/admin-kiosk-tokens.component.ts/.html/.css` | JWT modal; ToastService copy |
| `frontend/src/app/modules/admin/admin-users.component.ts/.html` | |
| `frontend/src/app/modules/admin/admin.module.ts` | |

---

## Files changed

| File | Change |
|---|---|
| `backend/routes/response_models/auth.py` | Added `UserAdminRead`; added `role` to `UserRead` |
| `backend/main.py` | Added `admin_user_router` |
| `frontend/src/app/app-routing.module.ts` | Added `/admin` lazy-loaded child route |
| `frontend/src/app/modules/layout/app-nav-rail.component.ts` | Enabled Admin nav item |
| `frontend/src/app/core/auth/auth.service.ts` | Added `role?: string` to `UserRead` |
| `frontend/src/app/core/kiosk/kiosk.service.ts` | `checkForKioskToken()` skips storage if regular session detected (see deviation 7) |
| `frontend/src/styles.css` | Admin panel shared styles + kiosk scrollbar fix appended |

---

## Spec deviations

**1 — SQLite naive-datetime comparison in test_kiosk_token_future_expiry_not_expired**
SQLite stores `DateTime` columns as offset-naive strings. Comparing a naive datetime
from SQLite against `datetime.now(timezone.utc)` (tz-aware) raises `TypeError`.
Fixed in the test by stripping tzinfo before comparing:
```python
assert kt.expires_at.replace(tzinfo=None) > datetime.now().replace(tzinfo=None)
```
Production code (PostgreSQL) is unaffected.

**2 — JWT display moved to acknowledged modal**
The prompt specified showing the JWT + kiosk URL inline below the create form. The agent
moved this to a dedicated "Token Created" modal that requires an explicit dismiss. The
modal is shown immediately after `createKioskToken()` resolves and contains the JWT,
the full kiosk URL, and copy buttons. This prevents accidental form resets from losing
the JWT before it is copied. The inline create form is reset and hidden after the modal
is dismissed. The JWT is still shown only once (not retrievable after navigation).

**3 — Copy buttons use ToastService instead of raw clipboard API**
The prompt did not specify feedback for clipboard copy operations. The agent wired the
copy buttons in `AdminKioskTokensComponent` to `ToastService` (a pre-existing app-wide
toast service) so that a brief "Copied!" notification appears after each copy. This
matches the UX pattern used elsewhere in the app (e.g. `DashboardUrlService.copyLink()`).

**4 — Cancel button changed to btn-ghost with close icon**
The inline create form's cancel button was rendered as `btn-ghost` with a Material
`close` icon rather than a plain text button. No functional difference.

**5 — Admin page uses canvas-view class to fix nav-rail overlap**
Without the `canvas-view` class on the admin page root element, the page content was
positioned behind the left nav rail. The agent added `canvas-view` (an existing layout
utility class used by the dashboard and other full-canvas views) to `admin-page.component.html`.
All tab content inside the admin page benefits from this fix automatically.

**6 — Kiosk mode scrollbars fixed with CSS**
In kiosk mode, the dashboard area was showing scrollbars because `canvas-view` padding
and the dashboard's implicit height were not overridden. Fixed by adding two CSS rules
in `styles.css`:
```css
html.kiosk .canvas-view { padding: 0 !important; }
html.kiosk app-dashboard { height: 100%; display: block; }
```
These rules are purely additive; non-kiosk views are unaffected.

**7 — KioskService.checkForKioskToken() skips storage if regular session present**
The original implementation unconditionally wrote the `?kt=<jwt>` URL parameter into
`localStorage['auth_token']`, which overwrote any logged-in user's session if the URL
contained a kiosk token. Fixed by decoding the existing localStorage JWT (if any) before
writing: if the existing payload contains a `user_id` field (i.e. it is a regular
session token), storage is skipped and the kiosk token from the URL is ignored.
This means an authenticated admin can preview a kiosk URL without being logged out.

---

## Build / test status

`pytest backend/tests/test_kiosk.py` — **13 passed**, 3 warnings (python-jose internal
`utcnow()` deprecation — not project code).

`ng build` — zero TypeScript errors, zero Angular errors. Two pre-existing budget
warnings remain.

---

## Outstanding work entering Slice 10

1. **Backend test coverage gaps** — `test_sensor_ranges.py` (Slice 2 range-bounds API),
   `test_asset_hierarchy.py` (Slice 6 asset CRUD and path computation),
   `test_alert_rules.py` (Slice 3 alert rule CRUD) — all still absent.
2. **Deep tree nesting** — `AssetTreePickerComponent` renders only 2 levels (root +
   one child); grandchildren not shown for 3+ level asset hierarchies.
3. **Bulk widget actions** — skipped as P2 in Slice 7; shift-click multi-select +
   bulk delete/duplicate.
4. **Admin asset tree editor** — simple editor for reparenting assets; API is fully in
   place (Slice 6), only the frontend page is missing.
5. **§6.1 Upstream + analytics caching** — not yet started; deferred.
