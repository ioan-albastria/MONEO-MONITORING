# Slice 8 — Kiosk Mode (§5.2) + URL-Shareable State (§5.3)

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

## Context — what exists after Slice 7

### Migration chain
`0001` → … → `0007` (asset hierarchy). Slice 8 adds migration `0008`.

### Key files to know

**`backend/middleware.py`**
- `get_current_user` reads `user_id` from JWT payload, queries `users` table,
  returns `User` ORM object.
- `requires_role(*roles)` factory — rejects if `current_user.role not in roles`.
- JWT payload schema (existing): `{"user_id": int, "exp": ...}`.
- `AuthService.create_access_token(user_id, expires_delta?)` generates the JWT.

**`backend/routes/response_models/auth.py`**
```python
class UserRead(BaseModel):
    id: int; username: str; email: str; is_active: bool
    model_config = {"from_attributes": True}
```

**`backend/routes/auth_routes.py`**
- `GET /api/auth/me` returns `UserRead.model_validate(current_user)`.

**`backend/services/auth_service.py`**
- `create_access_token(user_id, expires_delta?)` — payload `{"user_id": N, "exp": ...}`.
- `decode_token(token)` — raises `ValueError` on invalid/expired token.
- JWT secret/algorithm from `settings.jwt_secret_key` / `settings.jwt_algorithm`.

**`backend/DAL/models/user.py`**
- Has columns: `id`, `username`, `email`, `hashed_password`, `is_active`, `role`, `created_at`, `updated_at`.
- `role` defaults to `'viewer'`; admins have `role='admin'`.

**`backend/migrations/env.py`** — model imports section (add `kiosk_token` here in Part B).

**`backend/main.py`** — router registration at bottom; add admin kiosk router.

**`frontend/src/app/app-module.ts`** — `AppModule`; currently has one provider:
`{ provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }`.

**`frontend/src/app/core/auth/auth.service.ts`**
- `TOKEN_KEY = 'auth_token'` stored in `localStorage`.
- `currentUser: UserRead | null`.
- `me()` calls `GET /api/auth/me` and returns `UserRead`.
- `getToken()` reads `localStorage`.

**`frontend/src/app/core/auth/auth.guard.ts`** — `CanMatchFn`; if no token → redirect
to `/login`; else calls `auth.me()` to hydrate `currentUser`, returns `true`.

**`frontend/src/app/modules/layout/app-shell.component.ts`**
- Injects `Router`, `AuthService`, `UiPreferencesService`, `PageHeaderStateService`, `ChangeDetectorRef`.
- `ngOnInit` reads `this.auth.currentUser?.username` for `userName`.
- Uses `ChangeDetectionStrategy.OnPush`.

**`frontend/src/app/modules/layout/app-shell.component.html`**
```html
<div class="flex flex-col min-h-dvh bg-surface-0 text-fg font-sans">
  <app-page-header ...></app-page-header>
  <div class="flex-1 min-h-0 flex">
    <app-nav-rail></app-nav-rail>
    <main ...>...</main>
  </div>
</div>
```

**`frontend/src/app/modules/dashboard/dashboard.component.ts`**
- `ngOnInit()` calls `await this.loadDashboards()`.
- `loadDashboards(preferredId?)` — fetches owned + public dashboards; picks
  `preferredId ?? restoreSelectedId() ?? firstOwned` as the selected ID; calls
  `timeService.loadFromDashboard()` on load.
- `selectDashboardById(rawValue)` — switches active dashboard; calls
  `timeService.loadFromDashboard(dashboard)` + `this.timeRange = timeService.current`.
- `onPresetSelected(preset)` and `onAutoRefreshChanged(seconds)` — update
  `this.timeRange`, call `timeService.setRange()`, call `_scheduleTimeRangeSave()`.
- `restoreSelectedId()` reads from `localStorage['dashboard.selectedId']`.
- `timeRange: TimeRange` field holds the current displayed time state.
- Injects: `DashboardApiService`, `SensorApiService`, `PageHeaderStateService`,
  `ChangeDetectorRef`, `AuthService`, `DashboardTimeService`, `DomSanitizer`.

**`frontend/src/app/core/dashboard/time.service.ts`**
- `DashboardTimeService` (`providedIn: 'root'`).
- `TimePreset = '15m' | '1h' | '6h' | '24h' | '7d' | '30d' | 'custom'`.
- `PRESET_HOURS: Record<Exclude<TimePreset, 'custom'>, number>`.
- `setRange(range: TimeRange)` — emits to `range$` BehaviorSubject.
- `loadFromDashboard(d)` — applies dashboard defaults.
- `current` getter — returns current `TimeRange`.

**`frontend/src/styles.css`** — global stylesheet; kiosk hiding rules go here.

---

## Priority guidance

**P0 — do first (no risk):**
Part A — Migration 0008.
Part B — KioskToken model.
Part C — AuthService helper.
Part D — Admin kiosk endpoints.
Part E — Middleware kiosk path.
Part F — UserRead + User model extensions.

**P1 — main frontend work:**
Part G — Frontend KioskService.
Part H — AppModule APP_INITIALIZER.
Part I — AppShellComponent kiosk integration.
Part J — DashboardUrlService + DashboardComponent URL state.

---

## Part A — Migration 0008: kiosk_tokens (P0)

**File to create:** `backend/migrations/versions/0008_kiosk_tokens.py`

```python
"""kiosk_tokens table

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'kiosk_tokens',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column(
            'dashboard_ids', sa.JSON, nullable=False,
            server_default='[]',
            comment='List of dashboard IDs this token may access / cycle through',
        ),
        sa.Column('label', sa.String(100), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_by', sa.Integer,
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('NOW()'),
        ),
    )
    op.create_index('idx_kiosk_tokens_active', 'kiosk_tokens', ['is_active'])


def downgrade() -> None:
    op.drop_index('idx_kiosk_tokens_active', table_name='kiosk_tokens')
    op.drop_table('kiosk_tokens')
```

---

## Part B — KioskToken model (P0)

**File to create:** `backend/DAL/models/kiosk_token.py`

```python
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from DAL.db_context import Base


class KioskToken(Base):
    __tablename__ = 'kiosk_tokens'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dashboard_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
```

**`backend/migrations/env.py`** — add one import line to the model-registration block:

```python
import DAL.models.kiosk_token          # noqa: F401
```

---

## Part C — AuthService: create_kiosk_token helper (P0)

**`backend/services/auth_service.py`** — add a new `@staticmethod` to the `AuthService`
class:

```python
@staticmethod
def create_kiosk_token(kiosk_token_id: int, expires_at: datetime) -> str:
    """Generate a JWT for a kiosk token row. Payload uses 'kiosk_token_id'
    so middleware can distinguish it from regular user tokens."""
    payload = {"kiosk_token_id": kiosk_token_id, "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
```

Import `datetime` is already imported in the file. No other changes needed.

---

## Part D — Admin kiosk endpoints (P0)

**File to create:** `backend/routes/admin_kiosk_routes.py`

```python
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.kiosk_token import KioskToken
from middleware import requires_role
from services.auth_service import AuthService

admin_kiosk_router = APIRouter(prefix="/api/admin/kiosk-tokens", tags=["admin"])
_auth = AuthService()


class KioskTokenCreate(BaseModel):
    dashboard_ids: list[int]
    label: Optional[str] = None
    expires_days: int = 365    # days until expiry; 0 = never expires


class KioskTokenRead(BaseModel):
    id: int
    dashboard_ids: list[int]
    label: Optional[str]
    expires_at: Optional[datetime]
    is_active: bool
    created_at: datetime
    token: Optional[str] = None  # Only included on creation response


class KioskTokenRevoke(BaseModel):
    pass   # no body needed


@admin_kiosk_router.post("", response_model=KioskTokenRead)
async def create_kiosk_token(
    body: KioskTokenCreate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    expires_at = (
        None if body.expires_days == 0
        else datetime.now(timezone.utc) + timedelta(days=body.expires_days)
    )
    kt = KioskToken(
        dashboard_ids=body.dashboard_ids,
        label=body.label,
        expires_at=expires_at,
        created_by=current_user.id if hasattr(current_user, 'id') and current_user.id else None,
        is_active=True,
    )
    db.add(kt)
    db.flush()   # get kt.id
    token_jwt = _auth.create_kiosk_token(
        kt.id,
        expires_at or datetime.now(timezone.utc) + timedelta(days=3650),
    )
    db.commit()
    db.refresh(kt)
    return KioskTokenRead(
        id=kt.id,
        dashboard_ids=kt.dashboard_ids,
        label=kt.label,
        expires_at=kt.expires_at,
        is_active=kt.is_active,
        created_at=kt.created_at,
        token=token_jwt,
    )


@admin_kiosk_router.get("", response_model=list[KioskTokenRead])
async def list_kiosk_tokens(
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    tokens = db.query(KioskToken).order_by(KioskToken.created_at.desc()).all()
    return [
        KioskTokenRead(
            id=kt.id, dashboard_ids=kt.dashboard_ids, label=kt.label,
            expires_at=kt.expires_at, is_active=kt.is_active, created_at=kt.created_at,
        )
        for kt in tokens
    ]


@admin_kiosk_router.delete("/{token_id}", status_code=204)
async def revoke_kiosk_token(
    token_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    kt = db.get(KioskToken, token_id)
    if not kt:
        raise HTTPException(status_code=404, detail="Kiosk token not found")
    kt.is_active = False
    db.commit()
```

**`backend/main.py`** — add router registration:

```python
from routes.admin_kiosk_routes import admin_kiosk_router
# ...
app.include_router(admin_kiosk_router)
```

---

## Part E — Middleware: KioskPrincipal + updated get_current_user (P0)

**`backend/middleware.py`** — full replacement:

```python
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from DAL import User, get_db
from services.auth_service import AuthService

_bearer = HTTPBearer()
_auth_service = AuthService()


@dataclass
class KioskPrincipal:
    """Synthetic principal returned by get_current_user for kiosk JWTs.
    Has the same attribute interface as User for role-checking and UserRead serialisation."""
    id: int = 0
    username: str = 'kiosk'
    email: str = ''
    is_active: bool = True
    role: str = 'kiosk'
    is_kiosk: bool = True
    kiosk_dashboard_ids: list = dc_field(default_factory=list)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
):
    token = credentials.credentials
    try:
        payload = _auth_service.decode_token(token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ── Kiosk token path ─────────────────────────────────────────────────────
    kiosk_token_id = payload.get("kiosk_token_id")
    if kiosk_token_id is not None:
        from DAL.models.kiosk_token import KioskToken
        kt = db.get(KioskToken, kiosk_token_id)
        if not kt or not kt.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Kiosk token revoked or not found",
            )
        if kt.expires_at and kt.expires_at.replace(tzinfo=timezone.utc
                if kt.expires_at.tzinfo is None else None) < datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Kiosk token expired",
            )
        return KioskPrincipal(
            kiosk_dashboard_ids=list(kt.dashboard_ids or []),
        )

    # ── Regular user path ────────────────────────────────────────────────────
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


def requires_role(*roles: str) -> Callable:
    """Dependency factory — restricts an endpoint to users with one of the given roles."""
    async def _check(current_user=Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role",
            )
        return current_user

    return _check
```

**Note on timezone handling:** `kt.expires_at` is stored as a timezone-aware datetime
(PostgreSQL `TIMESTAMP WITH TIME ZONE`). SQLAlchemy returns it as tz-aware. The comparison
`kt.expires_at < datetime.now(timezone.utc)` is safe. The `.replace(tzinfo=...)` in the
code above handles the edge case where the column returns a naive datetime (e.g., SQLite
in tests); remove it if not needed and it causes issues — just use
`kt.expires_at < datetime.now(timezone.utc)` directly.

---

## Part F — UserRead + User model extensions (P0)

### `backend/routes/response_models/auth.py`

```python
from typing import Optional
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserRead(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    is_kiosk: bool = False
    kiosk_dashboard_ids: list[int] = []

    model_config = {"from_attributes": True}
```

### `backend/DAL/models/user.py`

Add two `@property` definitions at the end of the `User` class (after the `dashboards`
relationship). These allow `UserRead.model_validate(real_user)` with `from_attributes=True`
to populate the new fields with their defaults:

```python
    @property
    def is_kiosk(self) -> bool:
        return False

    @property
    def kiosk_dashboard_ids(self) -> list:
        return []
```

**Why:** Pydantic v2 with `from_attributes=True` calls `getattr(obj, field_name)` for
each `UserRead` field. Without these properties, `getattr(user, 'is_kiosk')` raises
`AttributeError` — which Pydantic v2 treats as a validation error rather than silently
using the field default. Adding the `@property` ensures existing `GET /api/auth/me`
calls continue to work without change.

---

## Part G — Frontend types + KioskService (P1)

### `frontend/src/app/core/auth/auth.service.ts`

Extend the `UserRead` interface:

```typescript
export interface UserRead {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_kiosk?: boolean;
  kiosk_dashboard_ids?: number[];
}
```

Add a `storeToken(token: string)` method (used by the kiosk flow):

```typescript
storeToken(token: string): void {
  localStorage.setItem(AuthService.TOKEN_KEY, token);
}
```

### New file: `frontend/src/app/core/kiosk/kiosk.service.ts`

```typescript
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class KioskService implements OnDestroy {
  private _isKiosk$ = new BehaviorSubject<boolean>(false);
  private _showBadge$ = new BehaviorSubject<boolean>(false);
  readonly isKiosk$ = this._isKiosk$.asObservable();
  readonly showBadge$ = this._showBadge$.asObservable();

  dashboardIds: number[] = [];
  cycleIntervalSeconds = 0;

  private _badgeTimer: ReturnType<typeof setTimeout> | null = null;
  private _cycleTimer: ReturnType<typeof setInterval> | null = null;
  private _cycleIndex = 0;

  private _activeDashboard$ = new BehaviorSubject<number | null>(null);
  readonly activeDashboardId$ = this._activeDashboard$.asObservable();

  get isKiosk(): boolean { return this._isKiosk$.getValue(); }

  /**
   * Called from APP_INITIALIZER before the auth guard runs.
   * If `?kt=<token>` is in the URL, store it as the auth token so the
   * guard finds it and calls me() with the kiosk JWT.
   */
  checkForKioskToken(): void {
    const params = new URLSearchParams(window.location.search);
    const kt = params.get('kt');
    if (kt) {
      localStorage.setItem(AuthService.TOKEN_KEY, kt);
    }
  }

  /**
   * Called after auth.me() resolves. If the user is a kiosk principal,
   * activates kiosk mode and starts the dashboard cycle if requested.
   */
  activateIfKiosk(user: import('../auth/auth.service').UserRead): void {
    if (!user.is_kiosk) return;

    const params = new URLSearchParams(window.location.search);
    const cycleSeconds = params.has('cycle') ? Math.max(5, +params.get('cycle')!) : 0;

    this.dashboardIds = user.kiosk_dashboard_ids ?? [];
    this.cycleIntervalSeconds = cycleSeconds;

    // Activate CSS class on <html>
    document.documentElement.classList.add('kiosk');

    this._isKiosk$.next(true);
    this._showBadge$.next(true);

    // Fade badge after 10 s
    if (this._badgeTimer) clearTimeout(this._badgeTimer);
    this._badgeTimer = setTimeout(() => this._showBadge$.next(false), 10_000);

    // Start cycling if multiple dashboards
    if (cycleSeconds > 0 && this.dashboardIds.length > 1) {
      this._startCycle(cycleSeconds);
    } else if (this.dashboardIds.length === 1) {
      this._activeDashboard$.next(this.dashboardIds[0]);
    }
  }

  private _startCycle(intervalSeconds: number): void {
    if (this._cycleTimer) clearInterval(this._cycleTimer);
    this._cycleIndex = 0;
    this._activeDashboard$.next(this.dashboardIds[0] ?? null);
    this._cycleTimer = setInterval(() => {
      this._cycleIndex = (this._cycleIndex + 1) % this.dashboardIds.length;
      this._activeDashboard$.next(this.dashboardIds[this._cycleIndex]);
    }, intervalSeconds * 1_000);
  }

  ngOnDestroy(): void {
    if (this._badgeTimer) clearTimeout(this._badgeTimer);
    if (this._cycleTimer)  clearInterval(this._cycleTimer);
  }
}
```

---

## Part H — AppModule: APP_INITIALIZER (P1)

**`frontend/src/app/app-module.ts`** — add `APP_INITIALIZER`:

```typescript
import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { App } from './app';
import { LayoutModule } from './modules/layout/layout.module';
import { SharedModule } from './shared/shared.module';
import { AuthInterceptor } from './core/auth/auth-interceptor.service';
import { KioskService } from './core/kiosk/kiosk.service';

export function initKioskToken(kiosk: KioskService): () => void {
  return () => kiosk.checkForKioskToken();
}

@NgModule({
  declarations: [App],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    AppRoutingModule,
    LayoutModule,
    SharedModule,
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    {
      provide: APP_INITIALIZER,
      useFactory: initKioskToken,
      deps: [KioskService],
      multi: true,
    },
  ],
  bootstrap: [App],
})
export class AppModule {}
```

The `APP_INITIALIZER` runs before the router activates guards. By the time `AuthGuard`
reads `localStorage['auth_token']`, the kiosk JWT has already been stored.

---

## Part I — AppShellComponent: kiosk mode integration (P1)

### `frontend/src/app/modules/layout/app-shell.component.ts`

Inject `KioskService`. After setting `this.userName` in `ngOnInit`, call:

```typescript
import { KioskService } from '../../core/kiosk/kiosk.service';

// In constructor, add:
private readonly kiosk: KioskService,

// In ngOnInit, after setting userName:
this.userName = this.auth.currentUser?.username ?? '';
if (this.auth.currentUser) {
  this.kiosk.activateIfKiosk(this.auth.currentUser);
}
```

Also expose the service for the template:

```typescript
readonly kioskService = this.kiosk;
```

### `frontend/src/app/modules/layout/app-shell.component.html`

Add a kiosk indicator badge as a sibling inside the root div, just before `</div>`:

```html
<!-- Kiosk mode indicator — fades after 10 s -->
<div
  *ngIf="kioskService.showBadge$ | async"
  class="kiosk-badge"
  aria-label="Kiosk mode active"
>
  KIOSK
</div>
```

The `kiosk-badge` styles go in `frontend/src/styles.css` (see Part I CSS below, along
with the global hiding rules).

### `frontend/src/styles.css` — add at the end

```css
/* ─────────────────────────────────────────────────────────────────────────
   §5.2 Kiosk mode
   ───────────────────────────────────────────────────────────────────────── */

/* Hide chrome in kiosk mode */
html.kiosk app-page-header { display: none !important; }
html.kiosk app-nav-rail     { display: none !important; }

/* Hide dashboard management controls but leave the grid and toolbar time pickers */
html.kiosk .dashboard-toolbar__group--right { display: none !important; }

/* Remove top/side padding so grid fills screen */
html.kiosk main.flex-1 {
  padding: 0 !important;
}

/* Kiosk indicator badge */
.kiosk-badge {
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: 9999;
  background: color-mix(in oklch, var(--color-brand) 85%, black);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border-radius: var(--radius-sm, 4px);
  opacity: 1;
  animation: kiosk-badge-fade 10s forwards;
  pointer-events: none;
}

@keyframes kiosk-badge-fade {
  0%,  70% { opacity: 1; }
  100%      { opacity: 0; }
}
```

The CSS animation drives the badge visibility rather than JavaScript. The `*ngIf` on
`showBadge$ | async` still works because `showBadge$` becomes `false` at t=10s (from the
`setTimeout` in `KioskService`), which removes the element entirely.

### `LayoutModule` — if `AsyncPipe` is not already available

`AsyncPipe` is in `CommonModule`. Check that `LayoutModule` (at
`modules/layout/layout.module.ts`) imports `CommonModule`. If it does not, add it.

---

## Part J — DashboardUrlService + DashboardComponent URL state (P1)

### New file: `frontend/src/app/core/dashboard/url.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { TimePreset, PRESET_HOURS } from './time.service';

export interface UrlDashboardState {
  d?: number;
  preset?: string;
  ar?: number;
  from?: string;
  to?: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardUrlService {
  constructor(private readonly router: Router) {}

  /** Read current query params from window.location. */
  readParams(): UrlDashboardState {
    const p = new URLSearchParams(window.location.search);
    const d = p.get('d');
    const ar = p.get('ar');
    return {
      d:      d  ? +d                 : undefined,
      preset: p.get('preset')         ?? undefined,
      ar:     ar ? +ar                : undefined,
      from:   p.get('from')           ?? undefined,
      to:     p.get('to')             ?? undefined,
    };
  }

  /**
   * Replace the current URL query string without navigation.
   * Null values clear the corresponding param from the URL.
   */
  syncParams(state: UrlDashboardState): void {
    const qp: Record<string, string | null> = {};

    qp['d']      = state.d      != null ? String(state.d)  : null;
    qp['preset'] = state.preset != null ? state.preset      : null;
    qp['ar']     = (state.ar && state.ar > 0) ? String(state.ar) : null;

    if (state.preset === 'custom') {
      qp['from'] = state.from ?? null;
      qp['to']   = state.to   ?? null;
    } else {
      qp['from'] = null;
      qp['to']   = null;
    }

    void this.router.navigate([], {
      queryParams: qp,
      replaceUrl: true,
      queryParamsHandling: 'merge',
    });
  }

  /** Copy the current URL (with all params) to the clipboard. */
  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // Fallback: create a temporary input element
      const el = document.createElement('input');
      el.value = window.location.href;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  }
}
```

### `frontend/src/app/modules/dashboard/dashboard.component.ts`

**1. Import + inject `DashboardUrlService` and `KioskService`:**

```typescript
import { DashboardUrlService } from '../../core/dashboard/url.service';
import { KioskService } from '../../core/kiosk/kiosk.service';
import { Subscription } from 'rxjs';
```

Add to constructor parameters:

```typescript
private readonly urlService: DashboardUrlService,
private readonly kioskService: KioskService,
```

**2. Add a subscription field:**

```typescript
private _kioskSub: Subscription | null = null;
```

**3. Update `ngOnInit()`:**

Replace the existing `await this.loadDashboards()` with:

```typescript
async ngOnInit(): Promise<void> {
  const urlParams = this.urlService.readParams();
  await this.loadDashboards(urlParams.d);

  // Apply URL time overrides (take precedence over dashboard defaults)
  this._applyUrlTimeParams(urlParams);

  // Sync URL with initial state after load
  this._syncUrlFromState();

  // If kiosk cycling is active, subscribe to dashboard rotation
  if (this.kioskService.isKiosk) {
    this._kioskSub = this.kioskService.activeDashboardId$.subscribe(id => {
      if (id != null && id !== this.selectedDashboardId) {
        void this.selectDashboardById(id);
      }
    });
  }
}
```

**4. Add `_applyUrlTimeParams()` private method:**

```typescript
private _applyUrlTimeParams(urlParams: { preset?: string; ar?: number; from?: string; to?: string }): void {
  const { preset, ar, from, to } = urlParams;
  if (!preset && ar == null) return;   // nothing to apply

  if (preset === 'custom' && from && to) {
    this.timeService.setRange({ preset: 'custom', from, to, autoRefreshSeconds: ar ?? 0 });
  } else if (preset && preset !== 'custom') {
    const hours = PRESET_HOURS[preset as Exclude<TimePreset, 'custom'>];
    if (hours) {
      this.timeService.setRange({ preset: preset as TimePreset, hours, autoRefreshSeconds: ar ?? 0 });
    }
  } else if (ar != null) {
    // Only auto-refresh override
    this.timeService.setRange({ ...this.timeService.current, autoRefreshSeconds: ar });
  }
  this.timeRange = this.timeService.current;
}
```

You will need `PRESET_HOURS` in the dashboard component — it is already imported via the
`DashboardTimeService` barrel. Verify the import at the top of the file:
```typescript
import { DashboardTimeService, TimeRange, TimePreset, PRESET_HOURS } from '../../core/dashboard/time.service';
```
`PRESET_HOURS` is already exported from that module. If it is not in the existing import
statement, add it.

**5. Add `_syncUrlFromState()` private method:**

```typescript
private _syncUrlFromState(): void {
  this.urlService.syncParams({
    d:      this.selectedDashboardId ?? undefined,
    preset: this.timeRange.preset,
    ar:     this.timeRange.autoRefreshSeconds || undefined,
    from:   this.timeRange.from,
    to:     this.timeRange.to,
  });
}
```

**6. Call `_syncUrlFromState()` after each state-change:**

- At the **end** of `selectDashboardById()` (after `this.refreshView()` in the success
  branch): add `this._syncUrlFromState()`.
- At the **end** of `onPresetSelected()`: add `this._syncUrlFromState()`.
- At the **end** of `onAutoRefreshChanged()`: add `this._syncUrlFromState()`.

**7. Unsubscribe in `ngOnDestroy()`:**

```typescript
this._kioskSub?.unsubscribe();
```

**8. Inject `DashboardUrlService` — verify `DashboardModule` has no extra imports needed.**
`DashboardUrlService` is `providedIn: 'root'`, so no module declaration is needed.

### Copy-link button in the dashboard toolbar

In `frontend/src/app/modules/dashboard/dashboard.component.html`, find the toolbar section
(look for `class="dashboard-toolbar"` or similar). Inside the right-side toolbar group
(the group that contains the preset selector and auto-refresh), add a copy-link button:

```html
<button
  type="button"
  class="icon-btn"
  title="Copy shareable link"
  (click)="copyDashboardLink()"
>
  <span class="icon icon-muted">link</span>
</button>
```

Add the handler to `dashboard.component.ts`:

```typescript
copyDashboardLink(): void {
  void this.urlService.copyLink();
}
```

---

## Verification checklist

1. `alembic upgrade head` — `\d kiosk_tokens` shows all columns; `down_revision = '0007'`
   is respected.
2. `POST /api/admin/kiosk-tokens` with admin JWT, body
   `{"dashboard_ids": [1], "label": "Line 3 TV"}` → returns `201` with `token` field
   (a JWT string).
3. `GET /api/auth/me` with the kiosk JWT → returns
   `{"id": 0, "username": "kiosk", "is_kiosk": true, "kiosk_dashboard_ids": [1], ...}`.
4. `GET /api/auth/me` with the kiosk JWT, after `DELETE /api/admin/kiosk-tokens/{id}` →
   returns `401 "Kiosk token revoked"`.
5. `GET /api/auth/me` with a regular user JWT → `is_kiosk: false`,
   `kiosk_dashboard_ids: []`.
6. Opening `/dashboard?kt=<kiosk_jwt>&cycle=10` in the browser:
   - Page loads normally (no redirect to `/login`).
   - Top header and nav rail are hidden.
   - A "KIOSK" badge appears in the bottom-right corner and fades after 10 s.
   - If `kiosk_dashboard_ids` has >1 entry and `?cycle=N`, the dashboard switches
     every N seconds.
7. Opening `/dashboard?d=2&preset=6h&ar=30`:
   - Dashboard 2 is selected (overriding localStorage).
   - Time preset is set to 6h.
   - Auto-refresh is set to 30s.
   - URL retains these params after initial load.
8. Changing the time preset in the toolbar → URL updates to `?preset=1h` (or whatever
   was chosen) without a page reload.
9. Clicking the link button → `window.location.href` is copied to the clipboard.
10. `ng build` — zero TypeScript errors, zero Angular errors.

---

## State block template

```
SLICE_8_COMPLETE

Part A (migration 0008): yes/no
Part B (KioskToken model): yes/no
Part C (AuthService helper): yes/no
Part D (admin kiosk endpoints): yes/no
Part E (middleware KioskPrincipal): yes/no
Part F (UserRead + User model extensions): yes/no
Part G (KioskService): yes/no
Part H (APP_INITIALIZER): yes/no
Part I (AppShellComponent kiosk integration): yes/no
Part J (DashboardUrlService + URL sync): yes/no

Issues encountered:
- <describe any deviations>

ng build: zero errors / <list errors>
```
