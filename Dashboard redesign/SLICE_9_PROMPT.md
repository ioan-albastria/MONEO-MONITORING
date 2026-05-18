# Slice 9 — Admin Panel + Kiosk/User Management

## Role and constraints

You are implementing a pre-designed feature slice for the MONEO sensor dashboard. Follow
every instruction exactly. Do not introduce new abstractions, rename existing files, or
modify files outside the scope listed. Never commit — the user controls git. Never use
worktrees.

**Stack:** FastAPI + SQLAlchemy 2 (`Mapped[]`/`mapped_column()`) + Pydantic v2 + Alembic.
Angular 20 NgModules (not standalone), `ChangeDetectionStrategy.OnPush` +
`ChangeDetectorRef.markForCheck()`. Default CD on page components.

**Project root:** `C:\Work\Albastria\FMC250\MONEO-MONITORING\`
**Backend root:** `backend\` · **Frontend root:** `frontend\src\app\`

---

## Context — what exists after Slice 8

### Backend
- **`backend/routes/admin_kiosk_routes.py`** — `admin_kiosk_router` registered under
  `/api/admin/kiosk-tokens`. Endpoints: `POST ""`, `GET ""`, `DELETE "/{token_id}"`.
- **No admin user routes exist yet.** The `User` model has a `role` column (`viewer`,
  `operator`, `admin`). No endpoint currently lets an admin list users or change roles.
- **`backend/tests/test_services.py`** — existing test file covering auth + dashboard service.
  Pattern: classes with `def test_xxx(self, db)` (or plain functions), `db` fixture from
  `conftest.py` (in-memory SQLite). **Do not modify this file.**
- **`backend/tests/conftest.py`** — `db` fixture at function scope; SQLite in-memory;
  `Base.metadata.create_all`. No HTTP test client is set up.

### Frontend
- **Nav rail** (`app-nav-rail.component.ts`) — `Admin` item exists with
  `route: '/admin', enabled: false`. Must enable it.
- **`app-routing.module.ts`** — has `dashboard` and `alerts` lazy-loaded children under
  `AppShellComponent`. The `'**'` redirect catches unknown paths to `dashboard`. The
  `/admin` route must be added **before** the wildcard.
- **`app-shell.component.ts`** `routeTitles` map — already has
  `'/admin': { title: 'Admin', subtitle: '' }`.
- **No AdminModule exists yet.** Create it at `modules/admin/`.
- **`AuthService.currentUser`** — `UserRead` with `is_kiosk?: boolean`. The role field
  is **not** in the frontend `UserRead` interface (it was omitted from `/api/auth/me`).
  For admin role-checking on the frontend, add a `role?: string` field to `UserRead`
  and include it in the backend `UserRead` response.

---

## Priority guidance

**P0 — backend (do first):**
Part A — Admin user API endpoints.
Part B — Backend pytest coverage for kiosk tokens.

**P1 — frontend:**
Part C — AdminModule scaffold + routing.
Part D — Admin kiosk tokens page.
Part E — Admin users page.

---

## Part A — Admin user API endpoints (P0)

### Response model

**`backend/routes/response_models/auth.py`** — add a new `UserAdminRead` model (do not
modify `UserRead`):

```python
class UserAdminRead(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
```

Also add `from datetime import datetime` at the top if not already present.

While here, add `role: str = 'viewer'` to the existing `UserRead` so the frontend can
check the current user's role:

```python
class UserRead(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    role: str = 'viewer'       # ← add this
    is_kiosk: bool = False
    kiosk_dashboard_ids: list[int] = []

    model_config = {"from_attributes": True}
```

### New routes file

**File to create:** `backend/routes/admin_user_routes.py`

```python
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.user import User
from middleware import requires_role
from routes.response_models.auth import UserAdminRead

admin_user_router = APIRouter(prefix="/api/admin/users", tags=["admin"])

VALID_ROLES = ("viewer", "operator", "admin")


class UserRoleUpdate(BaseModel):
    role: Literal["viewer", "operator", "admin"]


@admin_user_router.get("", response_model=list[UserAdminRead])
async def list_users(
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    return db.query(User).order_by(User.created_at.asc()).all()


@admin_user_router.patch("/{user_id}/role", response_model=UserAdminRead)
async def change_user_role(
    user_id: int,
    body: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin")),
):
    if hasattr(current_user, 'id') and current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = body.role
    db.commit()
    db.refresh(user)
    return user
```

**`backend/main.py`** — add router:

```python
from routes.admin_user_routes import admin_user_router
# ...
app.include_router(admin_user_router)
```

---

## Part B — Backend pytest coverage for kiosk tokens (P0)

**File to create:** `backend/tests/test_kiosk.py`

Tests should be plain functions (not classes, to match the style of `test_services.py`
class-based sections — but functions are also fine). Use the `db` fixture from `conftest.py`.

```python
from datetime import datetime, timedelta, timezone

import pytest

from DAL.models.kiosk_token import KioskToken
from DAL.models.user import User
from services.auth_service import AuthService

_auth = AuthService()


# ── Helpers ─────────────────────────────────────────────────────────────────

def _make_admin(db) -> User:
    user = User(
        username="admin",
        email="admin@test.com",
        hashed_password=_auth.hash_password("pass"),
        role="admin",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_kiosk_token(db, dashboard_ids=None, is_active=True,
                      expires_at=None) -> KioskToken:
    kt = KioskToken(
        dashboard_ids=dashboard_ids or [1, 2],
        label="Test token",
        is_active=is_active,
        expires_at=expires_at,
    )
    db.add(kt)
    db.commit()
    db.refresh(kt)
    return kt


# ── create_kiosk_token ───────────────────────────────────────────────────────

def test_create_kiosk_token_returns_valid_jwt(db):
    kt = _make_kiosk_token(db)
    expires = datetime.now(timezone.utc) + timedelta(days=365)
    token = _auth.create_kiosk_token(kt.id, expires)
    payload = _auth.decode_token(token)
    assert payload["kiosk_token_id"] == kt.id


def test_kiosk_token_payload_has_no_user_id(db):
    kt = _make_kiosk_token(db)
    expires = datetime.now(timezone.utc) + timedelta(days=365)
    token = _auth.create_kiosk_token(kt.id, expires)
    payload = _auth.decode_token(token)
    assert "user_id" not in payload


def test_kiosk_token_expired_raises(db):
    kt = _make_kiosk_token(db)
    expired = datetime.now(timezone.utc) - timedelta(seconds=1)
    token = _auth.create_kiosk_token(kt.id, expired)
    with pytest.raises(ValueError):
        _auth.decode_token(token)


# ── kiosk token model ────────────────────────────────────────────────────────

def test_kiosk_token_default_is_active(db):
    kt = _make_kiosk_token(db)
    assert kt.is_active is True


def test_kiosk_token_revoke(db):
    kt = _make_kiosk_token(db)
    kt.is_active = False
    db.commit()
    db.refresh(kt)
    assert kt.is_active is False


def test_kiosk_token_stores_dashboard_ids(db):
    kt = _make_kiosk_token(db, dashboard_ids=[3, 7, 42])
    db.refresh(kt)
    assert kt.dashboard_ids == [3, 7, 42]


def test_kiosk_token_no_expiry_is_none(db):
    kt = _make_kiosk_token(db, expires_at=None)
    assert kt.expires_at is None


def test_kiosk_token_future_expiry_not_expired(db):
    future = datetime.now(timezone.utc) + timedelta(days=365)
    kt = _make_kiosk_token(db, expires_at=future)
    assert kt.expires_at > datetime.now(timezone.utc)


# ── KioskPrincipal (middleware) ──────────────────────────────────────────────

def test_kiosk_principal_role_is_kiosk():
    from middleware import KioskPrincipal
    p = KioskPrincipal(kiosk_dashboard_ids=[1, 2])
    assert p.role == "kiosk"
    assert p.is_kiosk is True
    assert p.kiosk_dashboard_ids == [1, 2]


def test_kiosk_principal_is_not_admin():
    from middleware import KioskPrincipal
    p = KioskPrincipal()
    assert p.role not in ("admin", "operator")


# ── User model properties ────────────────────────────────────────────────────

def test_real_user_is_kiosk_false(db):
    user = _make_admin(db)
    assert user.is_kiosk is False
    assert user.kiosk_dashboard_ids == []


# ── admin user routes (service-level, no HTTP client) ────────────────────────

def test_change_role_in_db(db):
    user = _make_admin(db)
    user.role = "operator"
    db.commit()
    db.refresh(user)
    assert user.role == "operator"


def test_cannot_find_nonexistent_user(db):
    result = db.get(User, 999)
    assert result is None
```

Run with `pytest backend/tests/test_kiosk.py -v` from the backend directory.

---

## Part C — AdminModule scaffold + routing (P1)

### New files to create

**`frontend/src/app/modules/admin/admin-routing.module.ts`**

```typescript
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageComponent } from './admin-page.component';

const routes: Routes = [{ path: '', component: AdminPageComponent }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminRoutingModule {}
```

**`frontend/src/app/modules/admin/admin-page.component.ts`**

```typescript
import { ChangeDetectionStrategy, ChangeDetectorRef, Component } from '@angular/core';

type AdminTab = 'kiosk-tokens' | 'users';

@Component({
  selector: 'app-admin-page',
  standalone: false,
  templateUrl: './admin-page.component.html',
  styleUrl: './admin-page.component.css',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminPageComponent {
  activeTab: AdminTab = 'kiosk-tokens';

  setTab(tab: AdminTab): void {
    this.activeTab = tab;
  }
}
```

**`frontend/src/app/modules/admin/admin-page.component.html`**

```html
<div class="admin-page">
  <nav class="admin-tabs" role="tablist" aria-label="Admin sections">
    <button role="tab"
      class="admin-tab"
      [class.is-active]="activeTab === 'kiosk-tokens'"
      (click)="setTab('kiosk-tokens')"
    >
      <span class="icon">key</span> Kiosk Tokens
    </button>
    <button role="tab"
      class="admin-tab"
      [class.is-active]="activeTab === 'users'"
      (click)="setTab('users')"
    >
      <span class="icon">group</span> Users
    </button>
  </nav>

  <div class="admin-tab-content" role="tabpanel">
    <app-admin-kiosk-tokens *ngIf="activeTab === 'kiosk-tokens'"></app-admin-kiosk-tokens>
    <app-admin-users        *ngIf="activeTab === 'users'"></app-admin-users>
  </div>
</div>
```

**`frontend/src/app/modules/admin/admin-page.component.css`**

```css
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
}

.admin-tabs {
  display: flex;
  gap: 2px;
  padding: 0 0 0 0;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-0);
}

.admin-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-fg-muted);
  border: none;
  background: transparent;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}
.admin-tab:hover { color: var(--color-fg); }
.admin-tab.is-active {
  color: var(--color-brand);
  border-bottom-color: var(--color-brand);
}

.admin-tab-content {
  flex: 1;
  overflow: auto;
  padding: var(--page-pad);
}
```

**`frontend/src/app/modules/admin/admin.module.ts`**

```typescript
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AdminRoutingModule } from './admin-routing.module';
import { AdminPageComponent } from './admin-page.component';
import { AdminKioskTokensComponent } from './admin-kiosk-tokens.component';
import { AdminUsersComponent } from './admin-users.component';

@NgModule({
  declarations: [
    AdminPageComponent,
    AdminKioskTokensComponent,
    AdminUsersComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    AdminRoutingModule,
  ],
})
export class AdminModule {}
```

### Wire up the route

**`frontend/src/app/app-routing.module.ts`** — add the `/admin` route **before** the
`'**'` wildcard in the children array:

```typescript
{
  path: 'admin',
  loadChildren: () =>
    import('./modules/admin/admin.module').then(m => m.AdminModule),
},
```

### Enable the Admin nav item

**`frontend/src/app/modules/layout/app-nav-rail.component.ts`** — change `enabled: false`
to `enabled: true` for the Admin item:

```typescript
{ label: 'Admin', icon: 'settings', route: '/admin', enabled: true },
```

### Admin API service

**File to create:** `frontend/src/app/core/admin/admin-api.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface UserAdminRead {
  id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface KioskTokenAdminRead {
  id: number;
  dashboard_ids: number[];
  label: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  token?: string;  // only on creation
}

export interface KioskTokenCreate {
  dashboard_ids: number[];
  label?: string;
  expires_days?: number;
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  constructor(private http: HttpClient) {}

  // ── Users ──────────────────────────────────────────────────────────────

  listUsers(): Promise<UserAdminRead[]> {
    return firstValueFrom(this.http.get<UserAdminRead[]>('/api/admin/users'));
  }

  changeUserRole(userId: number, role: string): Promise<UserAdminRead> {
    return firstValueFrom(
      this.http.patch<UserAdminRead>(`/api/admin/users/${userId}/role`, { role })
    );
  }

  // ── Kiosk tokens ────────────────────────────────────────────────────────

  listKioskTokens(): Promise<KioskTokenAdminRead[]> {
    return firstValueFrom(
      this.http.get<KioskTokenAdminRead[]>('/api/admin/kiosk-tokens')
    );
  }

  createKioskToken(body: KioskTokenCreate): Promise<KioskTokenAdminRead> {
    return firstValueFrom(
      this.http.post<KioskTokenAdminRead>('/api/admin/kiosk-tokens', body)
    );
  }

  revokeKioskToken(tokenId: number): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`/api/admin/kiosk-tokens/${tokenId}`)
    );
  }
}
```

---

## Part D — Admin kiosk tokens page (P1)

**File to create:** `frontend/src/app/modules/admin/admin-kiosk-tokens.component.ts`

```typescript
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AdminApiService, KioskTokenAdminRead } from '../../core/admin/admin-api.service';

interface KioskCreateForm {
  label: string;
  dashboardIds: string;   // comma-separated, parsed on submit
  expiresDays: number;
  cycleSeconds: number;   // for URL builder only
}

@Component({
  selector: 'app-admin-kiosk-tokens',
  standalone: false,
  templateUrl: './admin-kiosk-tokens.component.html',
  styleUrl: './admin-kiosk-tokens.component.css',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminKioskTokensComponent implements OnInit {
  tokens: KioskTokenAdminRead[] = [];
  loading = true;
  error: string | null = null;

  // Create form
  showCreateForm = false;
  creating = false;
  createError: string | null = null;
  form: KioskCreateForm = {
    label: '',
    dashboardIds: '',
    expiresDays: 365,
    cycleSeconds: 0,
  };

  // Newly created token display
  newToken: string | null = null;
  newTokenUrl: string | null = null;

  constructor(
    private readonly api: AdminApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadTokens();
  }

  async loadTokens(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.cdr.detectChanges();
    try {
      this.tokens = await this.api.listKioskTokens();
    } catch {
      this.error = 'Failed to load kiosk tokens.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  toggleCreateForm(): void {
    this.showCreateForm = !this.showCreateForm;
    this.newToken = null;
    this.newTokenUrl = null;
    this.createError = null;
  }

  async createToken(): Promise<void> {
    this.createError = null;
    const ids = this.form.dashboardIds
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0);

    if (ids.length === 0) {
      this.createError = 'Enter at least one dashboard ID.';
      return;
    }

    this.creating = true;
    this.cdr.detectChanges();
    try {
      const result = await this.api.createKioskToken({
        dashboard_ids: ids,
        label: this.form.label.trim() || undefined,
        expires_days: this.form.expiresDays,
      });
      this.newToken = result.token ?? null;
      this.newTokenUrl = this._buildKioskUrl(result, this.form.cycleSeconds);
      await this.loadTokens();
    } catch {
      this.createError = 'Failed to create kiosk token.';
    } finally {
      this.creating = false;
      this.cdr.detectChanges();
    }
  }

  async revokeToken(token: KioskTokenAdminRead): Promise<void> {
    if (!confirm(`Revoke token "${token.label || token.id}"? This cannot be undone.`)) return;
    try {
      await this.api.revokeKioskToken(token.id);
      await this.loadTokens();
    } catch {
      this.error = 'Failed to revoke token.';
      this.cdr.detectChanges();
    }
  }

  copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).catch(() => {
      const el = document.createElement('input');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
  }

  private _buildKioskUrl(token: KioskTokenAdminRead, cycleSeconds: number): string {
    const base = `${window.location.origin}/dashboard`;
    const params = new URLSearchParams();
    if (this.newToken) params.set('kt', this.newToken);
    if (token.dashboard_ids.length === 1) params.set('d', String(token.dashboard_ids[0]));
    if (cycleSeconds > 0 && token.dashboard_ids.length > 1) params.set('cycle', String(cycleSeconds));
    return `${base}?${params.toString()}`;
  }

  formatExpiry(expiresAt: string | null): string {
    if (!expiresAt) return 'Never';
    return new Date(expiresAt).toLocaleDateString();
  }
}
```

**File to create:** `frontend/src/app/modules/admin/admin-kiosk-tokens.component.html`

```html
<div class="admin-section">
  <div class="admin-section__header">
    <h2 class="admin-section__title">Kiosk Tokens</h2>
    <button class="btn btn-primary btn-sm" (click)="toggleCreateForm()">
      <span class="icon">add</span>
      {{ showCreateForm ? 'Cancel' : 'New Token' }}
    </button>
  </div>

  <!-- Create form -->
  <div *ngIf="showCreateForm" class="admin-create-form">
    <div *ngIf="createError" class="admin-alert admin-alert--error">{{ createError }}</div>

    <!-- Newly-created token display -->
    <div *ngIf="newToken" class="admin-new-token">
      <div class="admin-new-token__label">
        Token created — copy it now, it will not be shown again.
      </div>
      <div class="admin-new-token__row">
        <code class="admin-new-token__value">{{ newToken }}</code>
        <button class="btn btn-sm" (click)="copyToClipboard(newToken!)">Copy JWT</button>
      </div>
      <div *ngIf="newTokenUrl" class="admin-new-token__row">
        <span class="admin-new-token__url">{{ newTokenUrl }}</span>
        <button class="btn btn-sm" (click)="copyToClipboard(newTokenUrl!)">Copy URL</button>
      </div>
    </div>

    <div class="form-row">
      <label class="form-label">Label</label>
      <input type="text" class="form-input" [(ngModel)]="form.label"
             placeholder="e.g. Line 3 monitor" maxlength="100">
    </div>

    <div class="form-row">
      <label class="form-label">Dashboard IDs <span class="form-hint">(comma-separated)</span></label>
      <input type="text" class="form-input" [(ngModel)]="form.dashboardIds"
             placeholder="e.g. 1, 3, 7">
    </div>

    <div class="form-row form-row--inline">
      <div class="form-group">
        <label class="form-label">Expires in (days)</label>
        <input type="number" class="form-input form-input--short" [(ngModel)]="form.expiresDays"
               min="0" max="3650">
        <span class="form-hint">0 = never</span>
      </div>
      <div class="form-group">
        <label class="form-label">Auto-cycle (seconds)</label>
        <input type="number" class="form-input form-input--short" [(ngModel)]="form.cycleSeconds"
               min="0" max="3600">
        <span class="form-hint">0 = no cycling</span>
      </div>
    </div>

    <div class="form-actions">
      <button class="btn btn-primary" (click)="createToken()" [disabled]="creating">
        {{ creating ? 'Creating…' : 'Create Token' }}
      </button>
    </div>
  </div>

  <!-- Token list -->
  <div *ngIf="loading" class="admin-state">Loading…</div>
  <div *ngIf="error && !loading" class="admin-alert admin-alert--error">{{ error }}</div>

  <table *ngIf="!loading && tokens.length" class="admin-table">
    <thead>
      <tr>
        <th>ID</th>
        <th>Label</th>
        <th>Dashboards</th>
        <th>Status</th>
        <th>Expires</th>
        <th>Created</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr *ngFor="let t of tokens"
          [class.admin-table__row--inactive]="!t.is_active">
        <td class="mono">{{ t.id }}</td>
        <td>{{ t.label || '—' }}</td>
        <td>{{ t.dashboard_ids.join(', ') }}</td>
        <td>
          <span class="status-chip" [attr.data-status]="t.is_active ? 'active' : 'revoked'">
            {{ t.is_active ? 'Active' : 'Revoked' }}
          </span>
        </td>
        <td>{{ formatExpiry(t.expires_at) }}</td>
        <td>{{ t.created_at | date:'dd MMM yyyy' }}</td>
        <td>
          <button *ngIf="t.is_active"
                  class="btn btn-danger btn-sm"
                  (click)="revokeToken(t)">
            Revoke
          </button>
        </td>
      </tr>
    </tbody>
  </table>

  <div *ngIf="!loading && !tokens.length" class="admin-state">
    No kiosk tokens yet. Create one to allow kiosk access.
  </div>
</div>
```

**File to create:** `frontend/src/app/modules/admin/admin-kiosk-tokens.component.css`

```css
/* Inherit shared admin styles from admin-page; specific overrides here */

.admin-new-token {
  background: color-mix(in oklch, var(--color-brand) 8%, var(--color-surface-0));
  border: 1px solid color-mix(in oklch, var(--color-brand) 30%, var(--color-border));
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.admin-new-token__label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-brand);
}

.admin-new-token__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.admin-new-token__value {
  font-family: monospace;
  font-size: 0.72rem;
  background: var(--color-surface-0);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 3px 6px;
  word-break: break-all;
  flex: 1;
}

.admin-new-token__url {
  font-size: 0.72rem;
  color: var(--color-fg-muted);
  word-break: break-all;
  flex: 1;
}
```

**Note on `date` pipe:** `date` is an Angular built-in pipe from `CommonModule`.
`AdminModule` imports `CommonModule`, so the pipe is available in the template.

---

## Part E — Admin users page (P1)

**File to create:** `frontend/src/app/modules/admin/admin-users.component.ts`

```typescript
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AdminApiService, UserAdminRead } from '../../core/admin/admin-api.service';
import { AuthService } from '../../core/auth/auth.service';

interface UserRow extends UserAdminRead {
  editRole: string;   // current selection in the role dropdown
  saving: boolean;
  saveError: string | null;
}

@Component({
  selector: 'app-admin-users',
  standalone: false,
  templateUrl: './admin-users.component.html',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminUsersComponent implements OnInit {
  rows: UserRow[] = [];
  loading = true;
  loadError: string | null = null;

  readonly roles = ['viewer', 'operator', 'admin'] as const;

  constructor(
    private readonly api: AdminApiService,
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();
    try {
      const users = await this.api.listUsers();
      this.rows = users.map(u => ({ ...u, editRole: u.role, saving: false, saveError: null }));
    } catch {
      this.loadError = 'Failed to load users.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  isCurrentUser(row: UserRow): boolean {
    return this.auth.currentUser?.id === row.id;
  }

  isDirty(row: UserRow): boolean {
    return row.editRole !== row.role;
  }

  async saveRole(row: UserRow): Promise<void> {
    if (!this.isDirty(row)) return;
    row.saving = true;
    row.saveError = null;
    this.cdr.detectChanges();
    try {
      const updated = await this.api.changeUserRole(row.id, row.editRole);
      row.role = updated.role;
      row.editRole = updated.role;
    } catch {
      row.saveError = 'Failed to save.';
      row.editRole = row.role;  // reset on error
    } finally {
      row.saving = false;
      this.cdr.detectChanges();
    }
  }

  trackUser(_: number, row: UserRow): number { return row.id; }
}
```

**File to create:** `frontend/src/app/modules/admin/admin-users.component.html`

```html
<div class="admin-section">
  <div class="admin-section__header">
    <h2 class="admin-section__title">Users</h2>
  </div>

  <div *ngIf="loading" class="admin-state">Loading…</div>
  <div *ngIf="loadError" class="admin-alert admin-alert--error">{{ loadError }}</div>

  <table *ngIf="!loading && rows.length" class="admin-table">
    <thead>
      <tr>
        <th>ID</th>
        <th>Username</th>
        <th>Email</th>
        <th>Role</th>
        <th>Active</th>
        <th>Created</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr *ngFor="let row of rows; trackBy: trackUser">
        <td class="mono">{{ row.id }}</td>
        <td>
          {{ row.username }}
          <span *ngIf="isCurrentUser(row)" class="badge badge--you">(you)</span>
        </td>
        <td class="text-fg-muted">{{ row.email }}</td>
        <td>
          <select class="form-select form-select--sm"
                  [(ngModel)]="row.editRole"
                  [disabled]="isCurrentUser(row) || row.saving">
            <option *ngFor="let r of roles" [value]="r">{{ r }}</option>
          </select>
        </td>
        <td>
          <span class="status-chip" [attr.data-status]="row.is_active ? 'active' : 'inactive'">
            {{ row.is_active ? 'Yes' : 'No' }}
          </span>
        </td>
        <td>{{ row.created_at | date:'dd MMM yyyy' }}</td>
        <td>
          <button
            class="btn btn-primary btn-sm"
            [disabled]="!isDirty(row) || row.saving || isCurrentUser(row)"
            (click)="saveRole(row)"
          >
            {{ row.saving ? '…' : 'Save' }}
          </button>
          <span *ngIf="row.saveError" class="save-error">{{ row.saveError }}</span>
        </td>
      </tr>
    </tbody>
  </table>

  <div *ngIf="!loading && !rows.length" class="admin-state">No users found.</div>
</div>
```

---

## Shared admin CSS

All shared admin styles (table, buttons, alerts, form elements) should go in a single
shared CSS file. Since Angular component CSS is scoped by default, place shared styles
in `frontend/src/styles.css` (global) or in each component's stylesheet. The simplest
approach: put all shared admin styles in `admin-page.component.css` and the child
components (kiosk tokens, users) inherit by using the same class names — but because
Angular view-encapsulates component styles, shared classes must be either:

1. **In `styles.css` (recommended)** — add an `/* ─── Admin panel */` section at the end.
2. Or use `ViewEncapsulation.None` on each admin component.

**Option 1 is recommended.** Add to `frontend/src/styles.css`:

```css
/* ─────────────────────────────────────────────────────────────────────────
   §6.2 Admin panel shared styles
   ───────────────────────────────────────────────────────────────────────── */

.admin-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.admin-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.admin-section__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-fg);
  margin: 0;
}

.admin-create-form {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}
.admin-table th {
  text-align: left;
  padding: 6px 12px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-fg-muted);
  background: var(--color-surface-0);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
}
.admin-table td {
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in oklch, var(--color-border) 50%, transparent);
  color: var(--color-fg);
  vertical-align: middle;
}
.admin-table__row--inactive td {
  opacity: 0.45;
}

.admin-state {
  padding: 24px;
  text-align: center;
  color: var(--color-fg-faint);
  font-size: 0.85rem;
}

.admin-alert {
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 0.8rem;
}
.admin-alert--error {
  background: color-mix(in oklch, #e64b3c 12%, transparent);
  color: #e64b3c;
  border: 1px solid color-mix(in oklch, #e64b3c 30%, transparent);
}

.status-chip {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.status-chip[data-status="active"]   { background: #37c79a22; color: #37c79a; }
.status-chip[data-status="revoked"]  { background: #e64b3c22; color: #e64b3c; }
.status-chip[data-status="inactive"] { background: #8898aa22; color: #8898aa; }

.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-row--inline {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 16px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-fg-muted);
}
.form-hint {
  font-size: 0.72rem;
  font-weight: 400;
  color: var(--color-fg-faint);
}
.form-input {
  background: var(--color-surface-0);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  font-size: 0.8125rem;
  color: var(--color-fg);
  outline: none;
  width: 100%;
}
.form-input:focus {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-brand) 20%, transparent);
}
.form-input--short { width: 100px; }
.form-select { /* same as form-input */ }
.form-select--sm { font-size: 0.78rem; padding: 3px 6px; }
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.badge--you {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-brand);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--color-brand) 12%, transparent);
  margin-left: 4px;
}
.save-error { font-size: 0.72rem; color: #e64b3c; margin-left: 6px; }
.mono { font-family: monospace; font-size: 0.78rem; }
.text-fg-muted { color: var(--color-fg-muted); }

.btn { /* assume global button styles exist; if not, define minimal ones */
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px; border-radius: var(--radius-md);
  font-size: 0.8125rem; font-weight: 500; cursor: pointer;
  border: 1px solid transparent; transition: opacity 0.12s;
}
.btn:disabled { opacity: 0.45; cursor: default; }
.btn-primary { background: var(--color-brand); color: #fff; }
.btn-primary:hover:not(:disabled) { opacity: 0.88; }
.btn-danger  { background: #e64b3c22; color: #e64b3c; border-color: #e64b3c44; }
.btn-danger:hover:not(:disabled)  { background: #e64b3c33; }
.btn-sm { padding: 3px 8px; font-size: 0.75rem; }
```

**Note on existing `.btn` classes:** The project may already define global button styles.
Check `styles.css` or any shared stylesheet for existing `.btn`, `.btn-primary`, `.btn-sm`
definitions before adding duplicates. If they already exist, skip those declarations and
only add the admin-specific classes.

---

## Part F — UserRead: add role to frontend type (P1)

**`frontend/src/app/core/auth/auth.service.ts`** — add `role` to `UserRead`:

```typescript
export interface UserRead {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  role?: string;             // ← add
  is_kiosk?: boolean;
  kiosk_dashboard_ids?: number[];
}
```

This is optional (`?`) so existing code that creates `UserRead` objects without `role`
doesn't break. The backend now returns `role` from `GET /api/auth/me` (added in Part A).

---

## Verification checklist

1. `pytest backend/tests/test_kiosk.py -v` — all tests pass (no DB or import errors).
   SQLite in-memory is used; no PostgreSQL needed.
2. `GET /api/admin/users` with admin JWT → list of all users including `role` field.
3. `GET /api/admin/users` with viewer JWT → `403 Insufficient role`.
4. `PATCH /api/admin/users/{id}/role` with `{"role": "operator"}` → user's role updated.
5. `PATCH /api/admin/users/{self_id}/role` → `400 Cannot change your own role`.
6. `GET /api/auth/me` returns `role: "admin"` (or the user's actual role) in the response.
7. Navigating to `/admin` in the browser shows the Admin page with "Kiosk Tokens" and
   "Users" tabs. The Admin nav item in the rail is enabled and active on this route.
8. Kiosk Tokens tab: "New Token" form accepts dashboard IDs, label, expiry, cycle
   interval. On creation, shows the JWT and full kiosk URL with copy buttons.
   Revoke button sets token to inactive. Revoked tokens show greyed-out rows.
9. Users tab: lists all users with role dropdown. Changing a role and clicking Save
   persists the change. Own row shows "(you)" and the Save button is disabled.
10. `ng build` — zero TypeScript errors, zero Angular errors.

---

## State block template

```
SLICE_9_COMPLETE

Part A (admin user API): yes/no
Part B (kiosk pytest coverage): yes/no
Part C (AdminModule + routing): yes/no
Part D (admin kiosk tokens page): yes/no
Part E (admin users page): yes/no
Part F (UserRead role field): yes/no

Issues encountered:
- <describe any deviations>

pytest test_kiosk.py: all pass / <failures>
ng build: zero errors / <list errors>
```
