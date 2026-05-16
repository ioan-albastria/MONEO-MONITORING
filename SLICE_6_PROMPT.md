# Slice 6 — Hierarchical Sensor Browsing (§4.1)

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

## Context — what exists after Slice 5

### Migration chain
`0001` → `0002` → `0003` → `0004` → `0005` → `0006` (dashboard time range).
Slice 6 adds **`0007`**.

### Key files to know before touching anything

**`backend/DAL/models/asset.py`**
The `Asset` model currently has: `id`, `moneo_asset_id`, `name`, `description`,
`location`, `latitude`, `longitude`, `extra_metadata`, `created_at`, `updated_at`.
It does **not** have `parent_id`, `kind`, or `path`. No `sensors` relationship.
No `parent`/`children` self-referential relationship.

**`backend/DAL/models/sensor.py`**
Has `asset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)` — a plain
integer, no `ForeignKey`. Has no `asset` relationship. Has no `asset_path` property.

**`backend/routes/response_models/sensor.py`**
`SensorRead` already exposes `asset_id: Optional[int] = None`. Does NOT expose
`asset_path`.

**`backend/services/sensor_service.py`**
`get_all_sensors()` does `db.query(Sensor).order_by(Sensor.name).all()` — no joinedload.
Accessing `sensor.asset` in this state would trigger N+1 queries.

**`frontend/src/app/modules/dashboard/dashboard.component.html`** (widget editor)
The sensor picker is a plain `<select multiple>` binding to `widgetForm.sensorIds`
(list of sensor IDs). Slice 6 replaces it with `<app-asset-tree-picker>`.

**`frontend/src/app/modules/dashboard/dashboard.module.ts`**
Declares: `DashboardComponent`, `DashboardWidgetComponent`. No tree picker declared.
Already imports `FormsModule`, `CommonModule`.

**`frontend/src/app/types/sensor.ts`**
`Sensor` interface has `asset_id` (number | null... actually `number | null` is not in it —
check the file; the API returns `asset_id` but the TypeScript interface may not list it).
Does NOT have `asset_path`.

**No asset API routes exist.** No `routes/asset_routes.py`. No `AssetService`.
No asset types in the frontend. No `AssetApiService`. No `AssetTreeService`.

---

## Priority guidance

**P0 — backend first:** Parts A → B → C → D → E (migration, models, service, routes,
sensor extension) — the tree picker depends on the API existing.
**P1 — frontend services:** Parts F → G (types, API service, tree service).
**P2 — UI:** Parts H → I → J (tree picker component, widget editor integration,
widget subtitle).

---

## Part A — Migration 0007: Asset hierarchy columns

**File to create:** `backend/migrations/versions/0007_asset_hierarchy.py`

```python
"""Asset hierarchy: parent_id, kind, path

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('assets', sa.Column('parent_id', sa.Integer(), nullable=True))
    op.add_column('assets', sa.Column(
        'kind', sa.String(20), nullable=False, server_default='machine'
    ))
    op.add_column('assets', sa.Column('path', sa.String(500), nullable=True))

    op.create_foreign_key(
        'fk_assets_parent_id', 'assets', 'assets',
        ['parent_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('idx_assets_parent', 'assets', ['parent_id'])
    op.create_index('idx_assets_path', 'assets', ['path'])

    # Seed path for any existing assets — they have no parent, so path == name.
    op.execute("UPDATE assets SET path = name WHERE path IS NULL")


def downgrade() -> None:
    op.drop_index('idx_assets_path', table_name='assets')
    op.drop_index('idx_assets_parent', table_name='assets')
    op.drop_constraint('fk_assets_parent_id', 'assets', type_='foreignkey')
    op.drop_column('assets', 'path')
    op.drop_column('assets', 'kind')
    op.drop_column('assets', 'parent_id')
```

---

## Part B — Asset model update + Sensor model relationship

### `backend/DAL/models/asset.py` — replace entirely

```python
from datetime import datetime, timezone
from typing import TYPE_CHECKING
from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from DAL.db_context import Base

if TYPE_CHECKING:
    from DAL.models.sensor import Sensor


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    moneo_asset_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    extra_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # ── Slice 6: hierarchy ────────────────────────────────────────────────
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False, server_default="machine")
    path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Self-referential relationships
    parent: Mapped["Asset | None"] = relationship(
        "Asset", remote_side="Asset.id", back_populates="children", lazy="select"
    )
    children: Mapped[list["Asset"]] = relationship(
        "Asset", back_populates="parent", lazy="select"
    )
    sensors: Mapped[list["Sensor"]] = relationship(
        "Sensor", back_populates="asset", lazy="select"
    )
```

### `backend/DAL/models/sensor.py` — add FK, relationship, and asset_path property

Change the `asset_id` column and add the relationship and property.
Keep all existing fields unchanged.

```python
# Change this existing line:
#   asset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
# To:
    asset_id: Mapped[int | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True
    )
    asset: Mapped["Asset | None"] = relationship("Asset", back_populates="sensors", lazy="select")
```

Add the import at the top:
```python
from typing import TYPE_CHECKING
from sqlalchemy import ForeignKey
if TYPE_CHECKING:
    from DAL.models.asset import Asset
```

Add this property after the `readings` relationship:
```python
    @property
    def asset_path(self) -> str | None:
        """Hierarchical path including the sensor name, e.g. 'Plant A / Line 3 / temp'.
        Returns None if the sensor has no assigned asset.
        Requires the `asset` relationship to be loaded (use joinedload in queries).
        """
        if self.asset and self.asset.path:
            return f"{self.asset.path} / {self.name}"
        return None
```

You will also need to add `Integer` removal from the import if `ForeignKey` is now the only
column type for `asset_id`. Keep `Integer` if it is still used for other columns
(`id`, `expected_poll_seconds`, etc.).

---

## Part C — AssetService

**File to create:** `backend/services/asset_service.py`

```python
from datetime import datetime, timezone

from sqlalchemy.orm import Session, selectinload

from DAL.models.asset import Asset


class AssetService:
    """CRUD + path maintenance for the asset hierarchy."""

    # ── Read ─────────────────────────────────────────────────────────────

    def get_all_flat(
        self,
        db: Session,
        kind: str | None = None,
        parent_id: int | None = None,
        search: str | None = None,
    ) -> list[Asset]:
        query = db.query(Asset)
        if kind:
            query = query.filter(Asset.kind == kind)
        if parent_id is not None:
            query = query.filter(Asset.parent_id == parent_id)
        if search:
            term = f"%{search.lower()}%"
            query = query.filter(
                Asset.name.ilike(term) | Asset.path.ilike(term)
            )
        return query.order_by(Asset.name).all()

    def get_tree(self, db: Session) -> list[Asset]:
        """Return root assets with children eagerly loaded (recursive selectinload)."""
        # Load all assets with their children (one extra level)
        # For deep trees, we iterate until no new children are found.
        all_assets = (
            db.query(Asset)
            .options(selectinload(Asset.children))
            .order_by(Asset.name)
            .all()
        )
        roots = [a for a in all_assets if a.parent_id is None]
        return roots

    def get_ancestors(self, db: Session, asset_id: int) -> list[Asset]:
        """Return [root, ..., direct_parent] for the given asset_id."""
        ancestors: list[Asset] = []
        current = db.get(Asset, asset_id)
        if current is None:
            return []
        current = db.get(Asset, current.parent_id) if current.parent_id else None
        while current:
            ancestors.insert(0, current)
            current = db.get(Asset, current.parent_id) if current.parent_id else None
        return ancestors

    def get_by_id(self, db: Session, asset_id: int) -> Asset | None:
        return db.get(Asset, asset_id)

    # ── Write ────────────────────────────────────────────────────────────

    def create(
        self,
        db: Session,
        name: str,
        kind: str = "machine",
        parent_id: int | None = None,
        description: str | None = None,
    ) -> Asset:
        asset = Asset(
            name=name,
            kind=kind,
            parent_id=parent_id,
            description=description,
        )
        db.add(asset)
        db.flush()  # get id before computing path
        asset.path = self._compute_path(db, asset)
        db.commit()
        db.refresh(asset)
        return asset

    def update(
        self,
        db: Session,
        asset: Asset,
        name: str | None = None,
        kind: str | None = None,
        parent_id: int | None = ...,  # use ... as sentinel for "not provided"
        description: str | None = ...,
    ) -> Asset:
        if name is not None:
            asset.name = name
        if kind is not None:
            asset.kind = kind
        if parent_id is not ...:
            asset.parent_id = parent_id
        if description is not ...:
            asset.description = description
        asset.updated_at = datetime.now(timezone.utc)
        # Recompute paths for this node and all descendants
        self._update_subtree_paths(db, asset)
        db.commit()
        db.refresh(asset)
        return asset

    def delete(self, db: Session, asset: Asset) -> None:
        db.delete(asset)
        db.commit()

    # ── Path helpers ─────────────────────────────────────────────────────

    def _compute_path(self, db: Session, asset: Asset) -> str:
        parts: list[str] = [asset.name]
        parent_id = asset.parent_id
        while parent_id is not None:
            parent = db.get(Asset, parent_id)
            if parent is None:
                break
            parts.append(parent.name)
            parent_id = parent.parent_id
        parts.reverse()
        return " / ".join(parts)

    def _update_subtree_paths(self, db: Session, asset: Asset) -> None:
        """Recursively recompute path for asset and all descendants."""
        asset.path = self._compute_path(db, asset)
        children = db.query(Asset).filter(Asset.parent_id == asset.id).all()
        for child in children:
            self._update_subtree_paths(db, child)
```

Note: The `update()` sentinel pattern uses `...` (Ellipsis) to distinguish
"field not provided" from "field set to None". Call it as:
```python
# Only update name:
service.update(db, asset, name="New Name")
# Set description to None:
service.update(db, asset, description=None)
```

---

## Part D — Asset routes + response models + main.py

### `backend/routes/response_models/asset.py` — create

```python
from typing import Optional
from pydantic import BaseModel


class AssetRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    kind: str
    parent_id: Optional[int] = None
    path: Optional[str] = None
    location: Optional[str] = None

    model_config = {"from_attributes": True}


class AssetNodeRead(BaseModel):
    """Recursive tree node — children populated from the ORM relationship."""
    id: int
    name: str
    kind: str
    parent_id: Optional[int] = None
    path: Optional[str] = None
    description: Optional[str] = None
    children: list["AssetNodeRead"] = []

    model_config = {"from_attributes": True}


AssetNodeRead.model_rebuild()  # required for self-referential model


class AssetCreate(BaseModel):
    name: str
    kind: str = "machine"
    parent_id: Optional[int] = None
    description: Optional[str] = None


class AssetUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    parent_id: Optional[int] = None
    description: Optional[str] = None
```

### `backend/routes/asset_routes.py` — create

```python
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from DAL import get_db
from middleware import get_current_user, requires_role
from routes.response_models.asset import AssetRead, AssetNodeRead, AssetCreate, AssetUpdate
from services.asset_service import AssetService

asset_router = APIRouter(prefix="/api/assets", tags=["assets"])
_service = AssetService()


@asset_router.get("/tree", response_model=list[AssetNodeRead])
async def get_asset_tree(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Nested asset tree from roots down. Children loaded one level per node."""
    return _service.get_tree(db)


@asset_router.get("", response_model=list[AssetRead])
async def get_assets_flat(
    kind: str | None = Query(None),
    parent_id: int | None = Query(None),
    search: str | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _service.get_all_flat(db, kind=kind, parent_id=parent_id, search=search)


@asset_router.get("/{asset_id}/ancestors", response_model=list[AssetRead])
async def get_asset_ancestors(
    asset_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _service.get_ancestors(db, asset_id)


@asset_router.get("/{asset_id}", response_model=AssetRead)
async def get_asset(
    asset_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = _service.get_by_id(db, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    return asset


@asset_router.post("", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetCreate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin", "operator")),
):
    if body.parent_id is not None and _service.get_by_id(db, body.parent_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent asset not found")
    return _service.create(
        db, name=body.name, kind=body.kind,
        parent_id=body.parent_id, description=body.description,
    )


@asset_router.put("/{asset_id}", response_model=AssetRead)
async def update_asset(
    asset_id: int,
    body: AssetUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin", "operator")),
):
    asset = _service.get_by_id(db, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if body.parent_id is not None and _service.get_by_id(db, body.parent_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent asset not found")
    # Cycle guard: new parent must not be this node or a descendant
    if body.parent_id is not None and body.parent_id == asset_id:
        raise HTTPException(status_code=400, detail="Asset cannot be its own parent")
    return _service.update(
        db, asset,
        name=body.name,
        kind=body.kind,
        parent_id=body.parent_id if "parent_id" in body.model_fields_set else ...,
        description=body.description if "description" in body.model_fields_set else ...,
    )


@asset_router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin", "operator")),
):
    asset = _service.get_by_id(db, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    children = db.query(__import__('DAL.models.asset', fromlist=['Asset']).Asset).filter_by(parent_id=asset_id).count()
    if children > 0:
        raise HTTPException(status_code=400, detail="Cannot delete asset with children")
    _service.delete(db, asset)
```

Avoid the `__import__` hack — import `Asset` normally at the top:
```python
from DAL.models.asset import Asset as AssetModel
```
and use `db.query(AssetModel).filter_by(parent_id=asset_id).count()` in the delete route.

### `backend/main.py` — add router

```python
from routes.asset_routes import asset_router
# ...
app.include_router(asset_router)
```

---

## Part E — SensorService: joinedload + SensorRead: asset_path

### `backend/services/sensor_service.py`

Add `joinedload` to both queries so `sensor.asset` is preloaded:

```python
from sqlalchemy.orm import Session, joinedload
from DAL import Sensor

class SensorService:
    def get_all_sensors(self, db: Session, active_only: bool = False) -> list:
        query = db.query(Sensor).options(joinedload(Sensor.asset))
        if active_only:
            query = query.filter(Sensor.is_active == True)
        sensors = query.order_by(Sensor.name).all()
        return [SensorRead.model_validate(s) for s in sensors]

    def get_sensor(self, db: Session, sensor_id: int):
        sensor = (
            db.query(Sensor)
            .options(joinedload(Sensor.asset))
            .filter(Sensor.id == sensor_id)
            .first()
        )
        if not sensor:
            raise ValueError("Sensor not found")
        return SensorRead.model_validate(sensor)
    # ...
```

`set_sensor_active` does a db.refresh after commit — refresh doesn't re-load
relationships. Add a fresh query there too, or use `db.refresh(sensor, ["asset"])`.
Simplest: after `db.refresh(sensor)`, add `db.query(Sensor).options(joinedload(Sensor.asset)).filter(Sensor.id == sensor.id).first()` and return that.

### `backend/routes/response_models/sensor.py`

Add one field to `SensorRead`:

```python
asset_path: Optional[str] = None
```

Since `from_attributes=True` is already set and `asset_path` is a `@property` on the
`Sensor` ORM model, Pydantic will call the property automatically when serializing.

---

## Part F — Frontend: Asset types + extend Sensor type

### `frontend/src/app/types/asset.ts` — create

```typescript
export type AssetKind =
  | 'factory' | 'area' | 'line' | 'cell' | 'machine' | 'equipment';

export interface Asset {
  id: number;
  name: string;
  description?: string | null;
  kind: AssetKind;
  parent_id?: number | null;
  path?: string | null;
  location?: string | null;
}

/** Recursive tree node returned by GET /api/assets/tree */
export interface AssetNode extends Asset {
  children: AssetNode[];
}
```

### `frontend/src/app/types/sensor.ts`

Add two fields to the `Sensor` interface:

```typescript
  asset_id?: number | null;   // already returned by the API — add if not present
  asset_path?: string | null; // NEW: e.g. "Plant A / Line 3 / temp"
```

If `asset_id` is already in the interface (check the file), don't add it again.
Only add `asset_path`.

---

## Part G — Frontend: AssetApiService + AssetTreeService

### `frontend/src/app/core/assets/asset-api.service.ts` — create

```typescript
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Asset, AssetNode } from '../../types/asset';

@Injectable({ providedIn: 'root' })
export class AssetApiService {
  constructor(private http: HttpClient) {}

  getTree(): Promise<AssetNode[]> {
    return firstValueFrom(this.http.get<AssetNode[]>('/api/assets/tree'));
  }

  getFlat(params: { kind?: string; parent_id?: number; search?: string } = {}): Promise<Asset[]> {
    let p = new HttpParams();
    if (params.kind)      p = p.set('kind', params.kind);
    if (params.parent_id != null) p = p.set('parent_id', String(params.parent_id));
    if (params.search)    p = p.set('search', params.search);
    return firstValueFrom(this.http.get<Asset[]>('/api/assets', { params: p }));
  }

  getAncestors(id: number): Promise<Asset[]> {
    return firstValueFrom(this.http.get<Asset[]>(`/api/assets/${id}/ancestors`));
  }

  create(body: { name: string; kind?: string; parent_id?: number | null; description?: string | null }): Promise<Asset> {
    return firstValueFrom(this.http.post<Asset>('/api/assets', body));
  }

  update(id: number, body: Partial<Pick<Asset, 'name' | 'kind' | 'parent_id' | 'description'>>): Promise<Asset> {
    return firstValueFrom(this.http.put<Asset>(`/api/assets/${id}`, body));
  }

  delete(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/assets/${id}`));
  }
}
```

### `frontend/src/app/core/assets/asset-tree.service.ts` — create

```typescript
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AssetNode } from '../../types/asset';
import { AssetApiService } from './asset-api.service';

@Injectable({ providedIn: 'root' })
export class AssetTreeService {
  private _tree$ = new BehaviorSubject<AssetNode[]>([]);
  readonly tree$ = this._tree$.asObservable();

  private _loading = false;
  private _lastFetchMs = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

  constructor(private api: AssetApiService) {}

  get snapshot(): AssetNode[] { return this._tree$.getValue(); }

  async ensureLoaded(): Promise<void> {
    const age = Date.now() - this._lastFetchMs;
    if (this._loading || age < this.CACHE_TTL_MS) return;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    try {
      const tree = await this.api.getTree();
      this._tree$.next(tree);
      this._lastFetchMs = Date.now();
    } catch {
      // Leave stale data; don't crash
    } finally {
      this._loading = false;
    }
  }
}
```

---

## Part H — AssetTreePickerComponent

Declare this component in **`DashboardModule`** (not a separate module).
Place files at:
- `frontend/src/app/modules/dashboard/asset-tree-picker.component.ts`
- `frontend/src/app/modules/dashboard/asset-tree-picker.component.html`
- `frontend/src/app/modules/dashboard/asset-tree-picker.component.css`

### `asset-tree-picker.component.ts`

```typescript
import {
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component, EventEmitter, Input, OnInit, Output,
} from '@angular/core';
import { AssetNode } from '../../types/asset';
import { Sensor } from '../../types/sensor';
import { AssetTreeService } from '../../core/assets/asset-tree.service';
import { SensorApiService } from '../../core/sensors/sensor-api.service';

interface TreeNode {
  asset: AssetNode;
  sensors: Sensor[];
  expanded: boolean;
  visible: boolean;  // determined by filter
  children: TreeNode[];
}

@Component({
  selector: 'app-asset-tree-picker',
  standalone: false,
  templateUrl: './asset-tree-picker.component.html',
  styleUrl: './asset-tree-picker.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetTreePickerComponent implements OnInit {
  @Input()  selectedIds: number[] = [];
  @Output() selectedIdsChange = new EventEmitter<number[]>();

  filterText = '';
  roots: TreeNode[] = [];
  unassignedSensors: Sensor[] = [];
  loading = true;
  error = false;

  private allSensors: Sensor[] = [];

  constructor(
    private readonly treeService: AssetTreeService,
    private readonly sensorApi: SensorApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await Promise.all([
        this.treeService.ensureLoaded(),
        this.sensorApi.listSensors().then(s => { this.allSensors = s; }),
      ]);
      this.roots = this._buildNodes(this.treeService.snapshot);
      this.unassignedSensors = this.allSensors.filter(s => s.asset_id == null);
      this._applyFilter();
    } catch {
      this.error = true;
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  onFilterChange(): void {
    this._applyFilter();
    this.cdr.markForCheck();
  }

  toggleNode(node: TreeNode): void {
    node.expanded = !node.expanded;
    this.cdr.markForCheck();
  }

  isSensorSelected(id: number): boolean {
    return this.selectedIds.includes(id);
  }

  toggleSensor(id: number): void {
    const next = this.selectedIds.includes(id)
      ? this.selectedIds.filter(x => x !== id)
      : [...this.selectedIds, id];
    this.selectedIds = next;
    this.selectedIdsChange.emit(next);
    this.cdr.markForCheck();
  }

  clearAll(): void {
    this.selectedIds = [];
    this.selectedIdsChange.emit([]);
    this.cdr.markForCheck();
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private _buildNodes(assets: AssetNode[]): TreeNode[] {
    return assets.map(a => ({
      asset: a,
      sensors: this.allSensors.filter(s => s.asset_id === a.id),
      expanded: false,
      visible: true,
      children: this._buildNodes(a.children),
    }));
  }

  private _applyFilter(): void {
    const q = this.filterText.trim().toLowerCase();
    if (!q) {
      this._setAllVisible(this.roots, true);
      return;
    }
    this._filterNodes(this.roots, q);
  }

  private _setAllVisible(nodes: TreeNode[], visible: boolean): void {
    for (const n of nodes) {
      n.visible = visible;
      n.expanded = false;
      this._setAllVisible(n.children, visible);
    }
  }

  private _filterNodes(nodes: TreeNode[], q: string): boolean {
    let anyVisible = false;
    for (const n of nodes) {
      const nameMatch = n.asset.name.toLowerCase().includes(q)
        || (n.asset.path ?? '').toLowerCase().includes(q);
      const sensorMatch = n.sensors.some(s => s.name.toLowerCase().includes(q));
      const childVisible = this._filterNodes(n.children, q);
      n.visible = nameMatch || sensorMatch || childVisible;
      n.expanded = n.visible;
      if (n.visible) anyVisible = true;
    }
    return anyVisible;
  }

  /** Sensors under node matching the current filter. */
  visibleSensors(node: TreeNode): Sensor[] {
    const q = this.filterText.trim().toLowerCase();
    if (!q) return node.sensors;
    return node.sensors.filter(s => s.name.toLowerCase().includes(q));
  }

  visibleUnassigned(): Sensor[] {
    const q = this.filterText.trim().toLowerCase();
    if (!q) return this.unassignedSensors;
    return this.unassignedSensors.filter(s => s.name.toLowerCase().includes(q));
  }

  trackById(_i: number, item: { id: number }): number { return item.id; }
  trackByAssetId(_i: number, n: TreeNode): number { return n.asset.id; }
}
```

### `asset-tree-picker.component.html`

```html
<div class="tree-picker">
  <!-- Filter input -->
  <div class="tree-picker__search">
    <span class="icon tree-picker__search-icon">search</span>
    <input
      class="tree-picker__search-input"
      type="text"
      placeholder="Filter sensors…"
      [(ngModel)]="filterText"
      (ngModelChange)="onFilterChange()"
    />
  </div>

  <!-- Status bar -->
  <div class="tree-picker__status">
    <span class="text-fg-faint">{{ selectedIds.length }} selected</span>
    <button
      *ngIf="selectedIds.length > 0"
      type="button"
      class="tree-picker__clear-btn"
      (click)="clearAll()"
    >Clear all</button>
  </div>

  <!-- Loading / error -->
  <div *ngIf="loading" class="tree-picker__state">Loading…</div>
  <div *ngIf="!loading && error" class="tree-picker__state tree-picker__state--error">
    Failed to load assets.
  </div>

  <!-- Tree -->
  <div *ngIf="!loading && !error" class="tree-picker__tree">

    <!-- Asset nodes -->
    <ng-container *ngFor="let node of roots; trackBy: trackByAssetId">
      <ng-container *ngIf="node.visible">
        <div class="tree-node tree-node--asset" [class.is-expanded]="node.expanded">
          <button
            type="button"
            class="tree-node__toggle"
            (click)="toggleNode(node)"
            [attr.aria-expanded]="node.expanded"
          >
            <span class="icon tree-node__chevron">chevron_right</span>
            <span class="tree-node__kind-pill">{{ node.asset.kind }}</span>
            <span class="tree-node__name">{{ node.asset.name }}</span>
            <span class="text-fg-faint text-xs" *ngIf="node.sensors.length">
              ({{ node.sensors.length }})
            </span>
          </button>
        </div>

        <!-- Sensors under this node -->
        <ng-container *ngIf="node.expanded">
          <div
            *ngFor="let sensor of visibleSensors(node); trackBy: trackById"
            class="tree-node tree-node--sensor"
          >
            <label class="tree-node__sensor-label">
              <input
                type="checkbox"
                class="tree-node__checkbox"
                [checked]="isSensorSelected(sensor.id)"
                (change)="toggleSensor(sensor.id)"
              />
              <span class="tree-node__sensor-name">{{ sensor.name }}</span>
              <span class="tree-node__sensor-unit text-fg-faint" *ngIf="sensor.unit">
                {{ sensor.unit }}
              </span>
              <span class="tree-node__sensor-type text-fg-faint">{{ sensor.sensor_type }}</span>
            </label>
          </div>
          <!-- Recurse into children -->
          <ng-container *ngFor="let child of node.children; trackBy: trackByAssetId">
            <ng-container *ngIf="child.visible">
              <div class="tree-node tree-node--asset tree-node--child"
                   [class.is-expanded]="child.expanded">
                <button type="button" class="tree-node__toggle"
                  (click)="toggleNode(child)" [attr.aria-expanded]="child.expanded">
                  <span class="icon tree-node__chevron">chevron_right</span>
                  <span class="tree-node__kind-pill">{{ child.asset.kind }}</span>
                  <span class="tree-node__name">{{ child.asset.name }}</span>
                  <span class="text-fg-faint text-xs" *ngIf="child.sensors.length">
                    ({{ child.sensors.length }})
                  </span>
                </button>
              </div>
              <ng-container *ngIf="child.expanded">
                <div
                  *ngFor="let sensor of visibleSensors(child); trackBy: trackById"
                  class="tree-node tree-node--sensor tree-node--sensor-child"
                >
                  <label class="tree-node__sensor-label">
                    <input type="checkbox" class="tree-node__checkbox"
                      [checked]="isSensorSelected(sensor.id)"
                      (change)="toggleSensor(sensor.id)" />
                    <span class="tree-node__sensor-name">{{ sensor.name }}</span>
                    <span class="tree-node__sensor-unit text-fg-faint" *ngIf="sensor.unit">
                      {{ sensor.unit }}
                    </span>
                    <span class="tree-node__sensor-type text-fg-faint">{{ sensor.sensor_type }}</span>
                  </label>
                </div>
              </ng-container>
            </ng-container>
          </ng-container>
        </ng-container>
      </ng-container>
    </ng-container>

    <!-- Unassigned sensors group -->
    <ng-container *ngIf="visibleUnassigned().length > 0">
      <div class="tree-node tree-node--unassigned-header">
        <span class="icon text-fg-faint">folder_off</span>
        <span class="tree-node__name text-fg-faint">Unassigned</span>
      </div>
      <div
        *ngFor="let sensor of visibleUnassigned(); trackBy: trackById"
        class="tree-node tree-node--sensor"
      >
        <label class="tree-node__sensor-label">
          <input type="checkbox" class="tree-node__checkbox"
            [checked]="isSensorSelected(sensor.id)"
            (change)="toggleSensor(sensor.id)" />
          <span class="tree-node__sensor-name">{{ sensor.name }}</span>
          <span class="tree-node__sensor-unit text-fg-faint" *ngIf="sensor.unit">
            {{ sensor.unit }}
          </span>
        </label>
      </div>
    </ng-container>

    <!-- Empty state -->
    <div
      *ngIf="roots.length === 0 && unassignedSensors.length === 0"
      class="tree-picker__state"
    >
      No assets or sensors available.
    </div>
  </div>
</div>
```

**Note on recursion depth:** The template above handles two levels of nesting (root
assets and one level of children). For the initial implementation this is sufficient.
Deep trees can be addressed in a later slice. If the real data is deeply nested,
the agent may add one more nesting level.

### `asset-tree-picker.component.css`

```css
.tree-picker {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  max-height: 320px;
}

.tree-picker__search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-1);
}

.tree-picker__search-icon { font-size: 16px; color: var(--color-fg-faint); }

.tree-picker__search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--color-fg);
  font-size: 0.8125rem;
  outline: none;
}
.tree-picker__search-input::placeholder { color: var(--color-fg-faint); }

.tree-picker__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 10px;
  font-size: 0.7rem;
  background: var(--color-surface-0);
  border-bottom: 1px solid var(--color-border);
}

.tree-picker__clear-btn {
  color: var(--color-brand);
  font-size: 0.7rem;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}
.tree-picker__clear-btn:hover { text-decoration: underline; }

.tree-picker__tree {
  flex: 1;
  overflow-y: auto;
}

.tree-picker__state {
  padding: 20px;
  text-align: center;
  color: var(--color-fg-faint);
  font-size: 0.8rem;
}
.tree-picker__state--error { color: var(--color-danger); }

/* Nodes */
.tree-node { display: flex; align-items: center; }

.tree-node--asset { border-bottom: 1px solid color-mix(in oklch, var(--color-border) 50%, transparent); }

.tree-node__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: 0.8125rem;
  color: var(--color-fg);
  transition: background 0.12s;
}
.tree-node__toggle:hover { background: var(--color-surface-2); }

.tree-node--child .tree-node__toggle { padding-left: 26px; }

.tree-node__chevron {
  font-size: 16px;
  color: var(--color-fg-faint);
  transition: transform 0.15s;
}
.is-expanded > .tree-node__toggle .tree-node__chevron { transform: rotate(90deg); }

.tree-node__kind-pill {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-fg-muted);
}

.tree-node__name { font-weight: 500; }

/* Sensor rows */
.tree-node--sensor {
  padding: 4px 10px 4px 32px;
}
.tree-node--sensor-child { padding-left: 48px; }

.tree-node__sensor-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  width: 100%;
  font-size: 0.8125rem;
}
.tree-node__sensor-label:hover { color: var(--color-brand); }

.tree-node__checkbox { accent-color: var(--color-brand); flex-shrink: 0; }

.tree-node__sensor-name { flex: 1; }

.tree-node__sensor-unit,
.tree-node__sensor-type {
  font-size: 0.7rem;
  flex-shrink: 0;
}

/* Unassigned header */
.tree-node--unassigned-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 0.75rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-0);
}
```

### `frontend/src/app/modules/dashboard/dashboard.module.ts` — add declaration

```typescript
import { AssetTreePickerComponent } from './asset-tree-picker.component';

@NgModule({
  declarations: [DashboardComponent, DashboardWidgetComponent, AssetTreePickerComponent],
  // ...
})
export class DashboardModule {}
```

---

## Part I — Widget editor: replace flat select with tree picker

### `frontend/src/app/modules/dashboard/dashboard.component.html`

In the widget editor section (`<!-- Section 2: Sensor multi-select -->`), replace the
`<select multiple>` block with the tree picker:

**Remove:**
```html
<div class="dashboard-widget__state" *ngIf="sensorsLoading">Loading sensors…</div>
<select
  *ngIf="!sensorsLoading"
  multiple
  class="dashboard-toolbar__select dashboard-toolbar__select--multi"
  size="6"
  [(ngModel)]="widgetForm.sensorIds"
>
  <option *ngFor="let s of availableSensors" [ngValue]="s.id">
    {{ s.name }}{{ s.unit ? ' (' + s.unit + ')' : '' }}
  </option>
</select>
<div class="dashboard-editor-section__hint" *ngIf="!sensorsLoading && !availableSensors.length">
  No sensors available. Check the backend has sensor data.
</div>
<div class="dashboard-editor-section__hint" *ngIf="!sensorsLoading && availableSensors.length">
  Hold Ctrl / Cmd to select multiple sensors.
</div>
```

**Insert:**
```html
<app-asset-tree-picker
  [selectedIds]="widgetForm.sensorIds"
  (selectedIdsChange)="widgetForm.sensorIds = $event"
></app-asset-tree-picker>
<div class="dashboard-editor-section__hint">
  Browse the asset tree or type to filter. Click a sensor to select it.
</div>
```

### `frontend/src/app/modules/dashboard/dashboard.component.ts`

The `availableSensors` field and `sensorsLoading` field are no longer driven by a
manual sensor-load in the widget editor. The `AssetTreePickerComponent` manages its
own data. **Remove** the sensor-loading logic from `openWidgetEditor()` /
`openWidgetCreator()` if it calls `sensorApi.listSensors()` and assigns
`availableSensors`. Keep `availableSensors` and `sensorsLoading` as fields only if
they are referenced elsewhere (e.g., in other parts of the template). If they are
only used for the old sensor picker, remove them.

Keep the `SensorApiService` injection if it is used elsewhere (e.g., in widget editor
"STATUS THRESHOLDS" section). Do not remove the import.

---

## Part J — Widget subtitle auto-population from asset_path

### `frontend/src/app/modules/dashboard/dashboard-widget.component.ts`

Change the `subtitle` getter to fall back to `activeSensor.asset_path` when the
widget's `subtitle` field is blank:

```typescript
get subtitle(): string {
  const manual = this.widget.subtitle?.trim() || '';
  if (manual) return manual;
  // For single-sensor widgets: show the hierarchical path as auto-subtitle
  if (this.activeSensor?.asset_path) return this.activeSensor.asset_path;
  return '';
}
```

This is a display-only change — no widget data migration, no stored-value change.
The `widget.subtitle` field in the database is unchanged; the getter simply computes
a better fallback.

---

## Verification checklist

1. `alembic upgrade head` runs cleanly; `\d assets` shows `parent_id`, `kind`, `path`
   columns; `idx_assets_parent` and `idx_assets_path` indexes exist.
2. `GET /api/assets/tree` returns `[]` when no assets exist; returns a nested structure
   when assets with parent/child relationships exist.
3. `GET /api/sensors` returns `asset_path: "Plant A / Line 3 / temp"` for a sensor
   assigned to an asset with a path, and `asset_path: null` for unassigned sensors.
4. `POST /api/assets` with `{"name":"Plant A","kind":"factory"}` returns `201` with
   `path:"Plant A"`.
5. `PUT /api/assets/{id}` with `{"parent_id": <parent>}` correctly recomputes path
   for the asset and all its descendants.
6. `DELETE /api/assets/{id}` on an asset with children returns `400`.
7. Widget editor opens and shows the tree picker instead of the flat select. Sensors
   without assets appear under "Unassigned". Filter input narrows the displayed nodes.
   Checking a sensor adds it to the selection; saving the widget persists the IDs.
8. A gauge/stat widget for a sensor in `"Plant A / Line 3 / Compressor"` shows
   `"Plant A / Line 3 / Compressor / temp"` as the subtitle when no manual subtitle is set.
9. `ng build` — zero TypeScript errors, zero Angular errors.

---

## State block template

When done, report:

```
SLICE_6_COMPLETE

Migration 0007 created: yes/no
Asset model updated (parent_id, kind, path, relationships): yes/no
Sensor model: ForeignKey + asset relationship + asset_path property: yes/no
AssetService created: yes/no
Asset routes (tree, flat, ancestors, CRUD): yes/no
Asset router registered in main.py: yes/no
SensorService: joinedload added: yes/no
SensorRead: asset_path field added: yes/no
Frontend: types/asset.ts created: yes/no
Frontend: sensor.ts extended (asset_path): yes/no
Frontend: AssetApiService created: yes/no
Frontend: AssetTreeService created: yes/no
Frontend: AssetTreePickerComponent created + declared in DashboardModule: yes/no
Widget editor: tree picker replaces flat select: yes/no
Widget subtitle: auto-population from asset_path: yes/no

Issues encountered:
- <describe any deviations from the spec>

ng build: zero errors / <list errors>
```
