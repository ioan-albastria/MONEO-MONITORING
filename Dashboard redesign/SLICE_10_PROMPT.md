# Slice 10 — Test Coverage + Deep Tree + Bulk Widget Actions + Admin Assets

## Role and constraints

You are implementing a pre-designed feature slice for the MONEO sensor dashboard. Follow
every instruction exactly. Do not introduce new abstractions, rename existing files, or
modify files outside the scope listed. Never commit — the user controls git. Never use
worktrees.

**Stack:** FastAPI + SQLAlchemy 2 (`Mapped[]`/`mapped_column()`) + Pydantic v2 + Alembic.
Angular 20 NgModules (not standalone), `ChangeDetectionStrategy.OnPush` on widget/picker
components. Default CD on page/admin components.

**Project root:** `C:\Work\Albastria\FMC250\MONEO-MONITORING\`
**Backend root:** `backend\` · **Frontend root:** `frontend\src\app\`

---

## Context — what exists after Slice 9

### Backend
- **`backend/tests/conftest.py`** — `db` fixture (function-scope), SQLite in-memory,
  `Base.metadata.create_all`. No HTTP test client.
- **`backend/tests/test_services.py`** — existing tests; **do not modify**.
- **`backend/tests/test_kiosk.py`** — 13 kiosk tests from Slice 9; **do not modify**.
- **Sensor model** (`DAL/models/sensor.py`) has range columns: `normal_min`, `normal_max`,
  `warning_min`, `warning_max`, `critical_min`, `critical_max`, `ranges_source`.
  `PUT /api/sensors/{id}/ranges` accepts `SensorRangesUpdate` body.
- **`services/asset_service.py`** has `create()`, `update()`, `delete()`,
  `get_all_flat()`, `get_tree()`, `get_ancestors()`, `_compute_path()`,
  `_update_subtree_paths()`. The `_update_subtree_paths()` method recurses through
  `db.query(Asset).filter(Asset.parent_id == asset.id)`.

### Frontend
- **`asset-tree-picker.component.ts`** — `_buildNodes(assets)` recursively builds a
  `TreeNode[]` tree from `AssetNode[]`. The `TreeNode` interface already has
  `children: TreeNode[]`, so the data model handles arbitrary depth. The limitation is
  in the **template**, which only hardcodes two visual levels (root + one child level).
- **`asset-tree-picker.component.html`** — ~165 lines with a nested
  `*ngFor/ng-container` block that manually repeats the render logic for root nodes
  and their children. Grandchildren have no rendering.
- **`dashboard.component.ts`** — `deleteWidget(widget)` confirms, calls
  `api.deleteWidget(widget.id)`, reloads the whole dashboard from API, rebuilds
  grid items. `editMode: boolean`. `canEditSelected` getter. `selectedDashboard` has
  `is_owned` flag.
- **`dashboard.component.html`** — gridster section:
  ```html
  <gridster [options]="gridOptions" class="dashboard-grid">
    <gridster-item *ngFor="let item of gridItems; trackBy: trackGridItem" [item]="item.gridsterItem" class="p-0">
      <app-dashboard-widget [widget]="item.widget" [editable]="dashboard.is_owned"
        [editMode]="editMode"
        (configure)="openWidgetEditor(item.widget)"
        (remove)="deleteWidget(item.widget)">
      </app-dashboard-widget>
    </gridster-item>
  </gridster>
  ```
- **AdminModule** — `admin.module.ts` declares `AdminPageComponent`,
  `AdminKioskTokensComponent`, `AdminUsersComponent`. The `AdminPageComponent` tab
  shell has two tabs: `'kiosk-tokens'` and `'users'`. The root element of
  `admin-page.component.html` carries the `canvas-view` class (same layout utility
  used by the dashboard page) which positions the admin content correctly alongside
  the nav rail. Any new tab component (`AdminAssetsComponent`) added inside the tab
  shell inherits this layout automatically — do **not** add `canvas-view` again in
  the child component.
- **ToastService** — a pre-existing app-wide toast service is available
  (`providedIn: 'root'`). `AdminKioskTokensComponent` already uses it for clipboard
  copy feedback. Use it in `AdminAssetsComponent` for any clipboard operations (if
  needed).
- **KioskService.checkForKioskToken()** — now decodes any existing `localStorage`
  JWT before writing; skips storage if the existing token has a `user_id` field
  (regular session). This prevents an authenticated admin from being logged out by
  opening a kiosk URL. No changes needed to this method in Slice 10.
- **`core/assets/asset-api.service.ts`** — wraps all `/api/assets` CRUD endpoints.
  Methods: `getTree()`, `getFlat()`, `getAncestors()`, `create()`, `update()`, `delete()`.
- **`types/asset.ts`** —
  `AssetKind = 'factory' | 'area' | 'line' | 'cell' | 'machine' | 'equipment'`.

---

## Priority guidance

**P0 — tests (backend, no risk):**
Part A — `test_sensor_ranges.py`.
Part B — `test_asset_hierarchy.py`.

**P1 — frontend features:**
Part C — Deep tree fix (flatten `AssetTreePickerComponent`).
Part D — Bulk widget actions.

**P2 — admin asset editor (skip if P1 runs long):**
Part E — `AdminAssetsComponent`.

---

## Part A — test_sensor_ranges.py (P0)

**File to create:** `backend/tests/test_sensor_ranges.py`

The `SensorService` and `SensorRangesUpdate` model are tested at the service/ORM level.
No HTTP test client needed.

```python
import pytest
from services.auth_service import AuthService
from DAL.models.sensor import Sensor
from routes.response_models.sensor import SensorRangesUpdate


def _make_sensor(db, name="TempSensor") -> Sensor:
    s = Sensor(
        moneo_sensor_id=f"ms-{name}",
        name=name,
        sensor_type="temperature",
        unit="°C",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


# ── SensorRangesUpdate model ──────────────────────────────────────────────────

def test_ranges_update_all_optional():
    body = SensorRangesUpdate()
    assert body.normal_min is None
    assert body.ranges_source == "manual"


def test_ranges_update_partial():
    body = SensorRangesUpdate(normal_min=10.0, normal_max=80.0)
    assert body.normal_min == 10.0
    assert body.normal_max == 80.0
    assert body.warning_min is None


# ── Sensor model range columns ────────────────────────────────────────────────

def test_sensor_range_columns_default_null(db):
    s = _make_sensor(db)
    assert s.normal_min is None
    assert s.critical_max is None
    assert s.ranges_source == "manual"


def test_sensor_range_columns_set_and_persist(db):
    s = _make_sensor(db)
    s.normal_min  = 10.0
    s.normal_max  = 80.0
    s.warning_min = 5.0
    s.warning_max = 90.0
    s.critical_min = 0.0
    s.critical_max = 100.0
    s.ranges_source = "auto"
    db.commit()
    db.refresh(s)
    assert s.normal_min  == 10.0
    assert s.normal_max  == 80.0
    assert s.warning_min == 5.0
    assert s.warning_max == 90.0
    assert s.critical_min == 0.0
    assert s.critical_max == 100.0
    assert s.ranges_source == "auto"


def test_sensor_ranges_update_via_model_dump(db):
    """Simulate what PUT /{sensor_id}/ranges does: apply body.model_dump() to sensor."""
    s = _make_sensor(db)
    body = SensorRangesUpdate(normal_min=20.0, normal_max=75.0, ranges_source="manual")
    for field, val in body.model_dump().items():
        setattr(s, field, val)
    db.commit()
    db.refresh(s)
    assert s.normal_min == 20.0
    assert s.normal_max == 75.0
    assert s.warning_min is None   # not set in body — should remain None


def test_sensor_ranges_cleared_when_set_to_none(db):
    s = _make_sensor(db)
    s.normal_min = 10.0
    db.commit()
    body = SensorRangesUpdate(normal_min=None)
    for field, val in body.model_dump().items():
        setattr(s, field, val)
    db.commit()
    db.refresh(s)
    assert s.normal_min is None


# ── sensor_service integration ────────────────────────────────────────────────

def test_sensor_not_found_returns_none(db):
    result = db.get(Sensor, 9999)
    assert result is None


def test_sensor_update_ranges_source(db):
    s = _make_sensor(db)
    s.ranges_source = "moneo"
    db.commit()
    db.refresh(s)
    assert s.ranges_source == "moneo"


def test_multiple_sensors_independent_ranges(db):
    s1 = _make_sensor(db, "Sensor1")
    s2 = _make_sensor(db, "Sensor2")
    s1.normal_max = 50.0
    s2.normal_max = 99.0
    db.commit()
    db.refresh(s1)
    db.refresh(s2)
    assert s1.normal_max == 50.0
    assert s2.normal_max == 99.0
```

---

## Part B — test_asset_hierarchy.py (P0)

**File to create:** `backend/tests/test_asset_hierarchy.py`

```python
import pytest
from services.asset_service import AssetService

_svc = AssetService()


# ── create + path ──────────────────────────────────────────────────────────────

def test_create_root_asset(db):
    a = _svc.create(db, name="Plant A", kind="factory")
    assert a.id is not None
    assert a.path == "Plant A"
    assert a.parent_id is None


def test_create_child_asset(db):
    parent = _svc.create(db, name="Plant A", kind="factory")
    child  = _svc.create(db, name="Line 1", kind="line", parent_id=parent.id)
    assert child.path == "Plant A / Line 1"
    assert child.parent_id == parent.id


def test_create_grandchild_path(db):
    factory = _svc.create(db, name="Factory",  kind="factory")
    area    = _svc.create(db, name="Area B",   kind="area",    parent_id=factory.id)
    machine = _svc.create(db, name="Machine X", kind="machine", parent_id=area.id)
    assert machine.path == "Factory / Area B / Machine X"


def test_path_root_only(db):
    a = _svc.create(db, name="Solo", kind="equipment")
    assert a.path == "Solo"


# ── get_all_flat ───────────────────────────────────────────────────────────────

def test_get_all_flat_returns_all(db):
    _svc.create(db, name="A", kind="factory")
    _svc.create(db, name="B", kind="factory")
    results = _svc.get_all_flat(db)
    assert len(results) == 2


def test_get_all_flat_filter_kind(db):
    _svc.create(db, name="Factory", kind="factory")
    _svc.create(db, name="Machine", kind="machine")
    results = _svc.get_all_flat(db, kind="machine")
    assert len(results) == 1
    assert results[0].name == "Machine"


def test_get_all_flat_search(db):
    _svc.create(db, name="Alpha Plant",  kind="factory")
    _svc.create(db, name="Beta Factory", kind="factory")
    results = _svc.get_all_flat(db, search="alpha")
    assert len(results) == 1
    assert results[0].name == "Alpha Plant"


# ── get_tree ───────────────────────────────────────────────────────────────────

def test_get_tree_returns_roots_only(db):
    parent = _svc.create(db, name="Root",  kind="factory")
    child  = _svc.create(db, name="Child", kind="area", parent_id=parent.id)
    roots = _svc.get_tree(db)
    assert len(roots) == 1
    assert roots[0].name == "Root"


# ── update + path propagation ──────────────────────────────────────────────────

def test_update_asset_name_updates_path(db):
    parent = _svc.create(db, name="Old Name", kind="factory")
    child  = _svc.create(db, name="Child",    kind="machine", parent_id=parent.id)
    _svc.update(db, parent, name="New Name")
    db.refresh(child)
    assert parent.path == "New Name"
    assert child.path  == "New Name / Child"


def test_update_reparent_updates_paths(db):
    a = _svc.create(db, name="Alpha", kind="factory")
    b = _svc.create(db, name="Beta",  kind="factory")
    c = _svc.create(db, name="Child", kind="machine", parent_id=a.id)
    assert c.path == "Alpha / Child"
    _svc.update(db, c, parent_id=b.id)
    db.refresh(c)
    assert c.path == "Beta / Child"


def test_update_subtree_three_levels(db):
    root  = _svc.create(db, name="R",   kind="factory")
    mid   = _svc.create(db, name="M",   kind="area",    parent_id=root.id)
    leaf  = _svc.create(db, name="L",   kind="machine", parent_id=mid.id)
    _svc.update(db, root, name="Root2")
    db.refresh(mid)
    db.refresh(leaf)
    assert mid.path  == "Root2 / M"
    assert leaf.path == "Root2 / M / L"


# ── delete ─────────────────────────────────────────────────────────────────────

def test_delete_asset(db):
    a = _svc.create(db, name="ToDelete", kind="factory")
    _svc.delete(db, a)
    assert _svc.get_by_id(db, a.id) is None


# ── get_ancestors ──────────────────────────────────────────────────────────────

def test_get_ancestors_root_returns_empty(db):
    root = _svc.create(db, name="Root", kind="factory")
    ancestors = _svc.get_ancestors(db, root.id)
    assert ancestors == []


def test_get_ancestors_child_returns_parent(db):
    root  = _svc.create(db, name="Root",  kind="factory")
    child = _svc.create(db, name="Child", kind="machine", parent_id=root.id)
    ancestors = _svc.get_ancestors(db, child.id)
    assert len(ancestors) == 1
    assert ancestors[0].id == root.id


def test_get_ancestors_deep(db):
    a = _svc.create(db, name="A", kind="factory")
    b = _svc.create(db, name="B", kind="area",    parent_id=a.id)
    c = _svc.create(db, name="C", kind="machine", parent_id=b.id)
    ancestors = _svc.get_ancestors(db, c.id)
    assert [x.name for x in ancestors] == ["A", "B"]
```

---

## Part C — Deep tree fix: flatten AssetTreePickerComponent (P1)

The fix replaces the hardcoded two-level template with a flat display list that handles
arbitrary depth. Changes are entirely in the component `.ts` and `.html` files.

### `frontend/src/app/modules/dashboard/asset-tree-picker.component.ts`

**1. Add a `FlatDisplayNode` interface** (at the top of the file, alongside `TreeNode`):

```typescript
interface FlatDisplayNode {
  kind: 'asset' | 'sensor';
  treeNode?: TreeNode;   // defined when kind === 'asset'
  sensor?: Sensor;       // defined when kind === 'sensor'
  depth: number;
}
```

**2. Add a `flatDisplayNodes: FlatDisplayNode[] = []` field** to the class:

```typescript
flatDisplayNodes: FlatDisplayNode[] = [];
```

**3. Add two private methods** (`_rebuildFlat` and `_collectFlat`) to the class:

```typescript
private _rebuildFlat(): void {
  const result: FlatDisplayNode[] = [];
  this._collectFlat(this.roots, 0, result);
  this.flatDisplayNodes = result;
}

private _collectFlat(nodes: TreeNode[], depth: number, result: FlatDisplayNode[]): void {
  for (const n of nodes) {
    if (!n.visible) continue;
    result.push({ kind: 'asset', treeNode: n, depth });
    if (n.expanded) {
      for (const s of this.visibleSensors(n)) {
        result.push({ kind: 'sensor', sensor: s, depth: depth + 1 });
      }
      this._collectFlat(n.children, depth + 1, result);
    }
  }
}
```

**4. Add a `trackFlatNode` method:**

```typescript
trackFlatNode(_: number, flat: FlatDisplayNode): string {
  return flat.kind === 'asset'
    ? `a-${flat.treeNode!.asset.id}`
    : `s-${flat.sensor!.id}`;
}
```

**5. Call `_rebuildFlat()` in the right places:**

- At the end of `ngOnInit()` (after `this._applyFilter()` and before `this.cdr.markForCheck()`):
  ```typescript
  this._rebuildFlat();
  ```
- Replace the body of `toggleNode()`:
  ```typescript
  toggleNode(node: TreeNode): void {
    node.expanded = !node.expanded;
    this._rebuildFlat();
    this.cdr.markForCheck();
  }
  ```
- At the end of `_applyFilter()` (after `this._filterNodes(...)` or `this._setAllVisible(...)`):
  ```typescript
  this._rebuildFlat();
  ```
- At the end of `_loadSparklines()` after `this.cdr.markForCheck()`:
  Sparklines don't change the tree structure; no rebuild needed here. But sensor rows
  reference `sparklinePath()` which reads from the Map — `markForCheck()` is sufficient.

### `frontend/src/app/modules/dashboard/asset-tree-picker.component.html`

Replace the entire `<!-- Tree -->` section (from `<div *ngIf="!loading && !error"...>`
to its closing `</div>`) with the following:

```html
<!-- Tree (flat rendering, supports arbitrary depth) -->
<div *ngIf="!loading && !error" class="tree-picker__tree">

  <!-- Flat node list — handles root, children, grandchildren, etc. -->
  <ng-container *ngFor="let flat of flatDisplayNodes; trackBy: trackFlatNode">

    <!-- Asset header row -->
    <div *ngIf="flat.kind === 'asset'"
         class="tree-node tree-node--asset"
         [class.is-expanded]="flat.treeNode!.expanded"
         [style.paddingLeft.px]="flat.depth * 14">
      <button type="button" class="tree-node__toggle"
              (click)="toggleNode(flat.treeNode!)"
              [attr.aria-expanded]="flat.treeNode!.expanded">
        <span class="icon tree-node__chevron">chevron_right</span>
        <span class="tree-node__kind-pill">{{ flat.treeNode!.asset.kind }}</span>
        <span class="tree-node__name">{{ flat.treeNode!.asset.name }}</span>
        <span class="text-fg-faint text-xs" *ngIf="flat.treeNode!.sensors.length">
          ({{ flat.treeNode!.sensors.length }})
        </span>
      </button>
    </div>

    <!-- Sensor row -->
    <div *ngIf="flat.kind === 'sensor'"
         class="tree-node tree-node--sensor"
         [style.paddingLeft.px]="flat.depth * 14">
      <label class="tree-node__sensor-label">
        <input type="checkbox" class="tree-node__checkbox"
               [checked]="isSensorSelected(flat.sensor!.id)"
               (change)="toggleSensor(flat.sensor!.id)" />
        <span class="tree-node__sensor-name">{{ flat.sensor!.name }}</span>
        <span class="tree-node__sensor-unit text-fg-faint" *ngIf="flat.sensor!.unit">
          {{ flat.sensor!.unit }}
        </span>
        <span class="tree-node__sensor-type text-fg-faint" *ngIf="flat.sensor!.sensor_type">
          {{ flat.sensor!.sensor_type }}
        </span>
        <svg *ngIf="sparklinePath(flat.sensor!.id)"
             class="tree-node__sparkline"
             [attr.viewBox]="'0 0 64 18'" width="64" height="18" aria-hidden="true">
          <path [attr.d]="sparklinePath(flat.sensor!.id)"
                stroke="#37c79a" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        </svg>
      </label>
    </div>

  </ng-container>

  <!-- Unassigned sensors group -->
  <ng-container *ngIf="visibleUnassigned().length > 0">
    <div class="tree-node tree-node--unassigned-header">
      <span class="icon text-fg-faint">folder_off</span>
      <span class="tree-node__name text-fg-faint">Unassigned</span>
    </div>
    <div *ngFor="let sensor of visibleUnassigned(); trackBy: trackById"
         class="tree-node tree-node--sensor">
      <label class="tree-node__sensor-label">
        <input type="checkbox" class="tree-node__checkbox"
               [checked]="isSensorSelected(sensor.id)"
               (change)="toggleSensor(sensor.id)" />
        <span class="tree-node__sensor-name">{{ sensor.name }}</span>
        <span class="tree-node__sensor-unit text-fg-faint" *ngIf="sensor.unit">
          {{ sensor.unit }}
        </span>
        <svg *ngIf="sparklinePath(sensor.id)"
             class="tree-node__sparkline"
             [attr.viewBox]="'0 0 64 18'" width="64" height="18" aria-hidden="true">
          <path [attr.d]="sparklinePath(sensor.id)"
                stroke="#37c79a" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        </svg>
      </label>
    </div>
  </ng-container>

  <!-- Empty state -->
  <div *ngIf="roots.length === 0 && unassignedSensors.length === 0" class="tree-picker__state">
    No assets or sensors available.
  </div>

</div>
```

**Note on CSS:** The existing `.tree-node--child` and `.tree-node--sensor-child` classes
are no longer emitted (all nodes use `tree-node--asset` and `tree-node--sensor`). The
`paddingLeft` inline style handles indentation for all depths. If existing CSS used those
removed classes for indentation, they are superseded and can be left in place (no harm)
or removed.

---

## Part D — Bulk widget actions (P1)

### `frontend/src/app/modules/dashboard/dashboard.component.ts`

**1. Add a selection set field** (near the `editMode` field):

```typescript
selectedWidgetIds = new Set<number>();
```

**2. Add selection methods:**

```typescript
toggleWidgetSelection(id: number): void {
  if (this.selectedWidgetIds.has(id)) {
    this.selectedWidgetIds.delete(id);
  } else {
    this.selectedWidgetIds.add(id);
  }
  // Force change detection — Set mutation is not detected by default CD
  this.selectedWidgetIds = new Set(this.selectedWidgetIds);
}

clearSelection(): void {
  this.selectedWidgetIds = new Set();
}

async deleteSelected(): Promise<void> {
  const d = this.selectedDashboard;
  if (!d?.is_owned || this.saving) return;
  const count = this.selectedWidgetIds.size;
  if (count === 0) return;
  if (!window.confirm(`Remove ${count} widget${count === 1 ? '' : 's'} from the dashboard?`)) return;

  this.saving = true;
  this.loadError = null;
  const ids = [...this.selectedWidgetIds];
  this.selectedWidgetIds = new Set();  // clear selection immediately
  try {
    await Promise.all(ids.map(id => this.api.deleteWidget(id)));
    this.selectedDashboard = this.stampOwnership(await this.api.getDashboard(d.id));
    this.isOwnedSelected = this.selectedDashboard.is_owned;
    this.buildGridItems();
    this.syncPageHeader();
  } catch {
    this.loadError = 'Failed to delete some widgets.';
  } finally {
    this.saving = false;
    this.refreshView();
  }
}
```

**3. Clear selection when edit mode is turned off.** In `toggleEditMode()`, after
`this.editMode = !this.editMode`, add:

```typescript
if (!this.editMode) this.clearSelection();
```

### `frontend/src/app/modules/dashboard/dashboard.component.html`

**1. Add selection checkbox overlay** inside `<gridster-item>`, as a sibling before
`<app-dashboard-widget>`:

```html
<gridster-item
  *ngFor="let item of gridItems; trackBy: trackGridItem"
  [item]="item.gridsterItem"
  class="p-0"
>
  <!-- Bulk-select checkbox — visible only in edit mode on owned dashboard -->
  <div
    *ngIf="editMode && selectedDashboard?.is_owned"
    class="widget-select-overlay"
    [class.is-selected]="selectedWidgetIds.has(item.widget.id)"
    (click)="toggleWidgetSelection(item.widget.id)"
  >
    <span class="icon widget-select-icon">
      {{ selectedWidgetIds.has(item.widget.id) ? 'check_box' : 'check_box_outline_blank' }}
    </span>
  </div>

  <app-dashboard-widget
    [widget]="item.widget"
    [editable]="selectedDashboard!.is_owned"
    [editMode]="editMode"
    (configure)="openWidgetEditor(item.widget)"
    (remove)="deleteWidget(item.widget)"
  ></app-dashboard-widget>
</gridster-item>
```

**2. Add the selection bar** after `</gridster>` and before the `<!-- Overlay: refreshing -->`
comment:

```html
<!-- Bulk selection bar -->
<div
  *ngIf="editMode && selectedWidgetIds.size > 0"
  class="selection-bar"
>
  <span class="selection-bar__count">
    {{ selectedWidgetIds.size }} widget{{ selectedWidgetIds.size === 1 ? '' : 's' }} selected
  </span>
  <button class="btn btn-danger btn-sm" (click)="deleteSelected()" [disabled]="saving">
    <span class="icon">delete</span>
    Delete selected
  </button>
  <button class="btn btn-sm" (click)="clearSelection()">
    <span class="icon">close</span>
    Clear
  </button>
</div>
```

### CSS for selection overlay and bar

Add to `frontend/src/app/modules/dashboard/dashboard.component.css`
(or `frontend/src/styles.css` if dashboard component styles live there):

```css
/* ── Bulk widget selection ──────────────────────────────────────────────── */

.widget-select-overlay {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 20;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
  border-radius: var(--radius-sm);
  padding: 2px;
  background: color-mix(in oklch, var(--color-surface-1) 80%, transparent);
}
/* Show overlay whenever edit mode is active on the containing widget */
.p-0:hover .widget-select-overlay,
.widget-select-overlay.is-selected {
  opacity: 1;
}
.widget-select-icon {
  font-size: 20px;
  color: var(--color-fg-muted);
  display: block;
}
.widget-select-overlay.is-selected .widget-select-icon {
  color: var(--color-brand);
}

.selection-bar {
  position: sticky;
  bottom: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--color-surface-1);
  border-top: 1px solid var(--color-border);
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
}

.selection-bar__count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-fg);
  flex: 1;
}
```

**Note:** The `.p-0` selector targets the `gridster-item` element (which has `class="p-0"` in
the template). If the class name changes or hover isn't reliable, change the opacity rule to
`[edit-mode] .widget-select-overlay { opacity: 0.4 }` — but `.p-0:hover` approach is simpler.
Alternatively, always show the overlay at `opacity: 0.4` when `editMode` is true, which is
achieved by adding `[class.always-visible]="editMode"` to the overlay and
`.always-visible { opacity: 0.4; }` in the CSS. Use whichever feels cleaner.

---

## Part E — Admin asset editor (P2)

Only implement if Parts C and D are complete and the build is green.

**Layout note:** `AdminPageComponent` already carries the `canvas-view` class on its
root element. The new `AdminAssetsComponent` will be embedded inside that tab shell and
needs no extra layout wrapper. Use standard `admin-section` markup as shown below.

### `frontend/src/app/modules/admin/admin-assets.component.ts`

```typescript
import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit,
} from '@angular/core';
import { AssetApiService } from '../../core/assets/asset-api.service';
import { Asset, AssetKind } from '../../types/asset';

interface AssetRow extends Asset {
  editName: string;
  editKind: AssetKind;
  editParentId: number | null;
  saving: boolean;
  dirty: boolean;
}

@Component({
  selector: 'app-admin-assets',
  standalone: false,
  templateUrl: './admin-assets.component.html',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminAssetsComponent implements OnInit {
  assets: AssetRow[] = [];
  loading = true;
  error: string | null = null;

  showCreateForm = false;
  createName = '';
  createKind: AssetKind = 'machine';
  createParentId: number | null = null;
  creating = false;

  readonly kinds: AssetKind[] = ['factory','area','line','cell','machine','equipment'];

  constructor(
    private readonly api: AssetApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> { await this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();
    try {
      const flat = await this.api.getFlat();
      this.assets = flat.map(a => ({
        ...a,
        editName: a.name,
        editKind: (a.kind ?? 'machine') as AssetKind,
        editParentId: a.parent_id ?? null,
        saving: false,
        dirty: false,
      }));
    } catch { this.error = 'Failed to load assets.'; }
    finally { this.loading = false; this.cdr.detectChanges(); }
  }

  markDirty(row: AssetRow): void {
    row.dirty = row.editName !== row.name
      || row.editKind !== row.kind
      || row.editParentId !== (row.parent_id ?? null);
  }

  async saveRow(row: AssetRow): Promise<void> {
    if (!row.dirty) return;
    row.saving = true; this.cdr.detectChanges();
    try {
      await this.api.update(row.id, {
        name: row.editName,
        kind: row.editKind,
        parent_id: row.editParentId,
      });
      await this.load();
    } catch { row.saving = false; this.cdr.detectChanges(); }
  }

  async deleteRow(row: AssetRow): Promise<void> {
    if (!confirm(`Delete "${row.name}"?`)) return;
    try {
      await this.api.delete(row.id);
      await this.load();
    } catch (e: any) {
      this.error = e?.error?.detail ?? 'Delete failed (asset may have children).';
      this.cdr.detectChanges();
    }
  }

  async createAsset(): Promise<void> {
    if (!this.createName.trim()) return;
    this.creating = true; this.cdr.detectChanges();
    try {
      await this.api.create({
        name: this.createName.trim(),
        kind: this.createKind,
        parent_id: this.createParentId,
      });
      this.createName = ''; this.showCreateForm = false;
      await this.load();
    } catch { this.creating = false; this.cdr.detectChanges(); }
    finally { this.creating = false; }
  }

  parentName(parentId: number | null): string {
    if (parentId == null) return '—';
    return this.assets.find(a => a.id === parentId)?.name ?? String(parentId);
  }

  trackAsset(_: number, a: AssetRow): number { return a.id; }
}
```

**File to create:** `frontend/src/app/modules/admin/admin-assets.component.html`

```html
<div class="admin-section">
  <div class="admin-section__header">
    <h2 class="admin-section__title">Assets</h2>
    <button class="btn btn-primary btn-sm" (click)="showCreateForm = !showCreateForm">
      <span class="icon">add</span>{{ showCreateForm ? 'Cancel' : 'New Asset' }}
    </button>
  </div>

  <div *ngIf="showCreateForm" class="admin-create-form">
    <div class="form-row--inline">
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-input" [(ngModel)]="createName" placeholder="Asset name">
      </div>
      <div class="form-group">
        <label class="form-label">Kind</label>
        <select class="form-select" [(ngModel)]="createKind">
          <option *ngFor="let k of kinds" [value]="k">{{ k }}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Parent</label>
        <select class="form-select" [(ngModel)]="createParentId">
          <option [value]="null">— none —</option>
          <option *ngFor="let a of assets" [value]="a.id">{{ a.path || a.name }}</option>
        </select>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" (click)="createAsset()" [disabled]="creating || !createName.trim()">
        {{ creating ? 'Creating…' : 'Create' }}
      </button>
    </div>
  </div>

  <div *ngIf="error" class="admin-alert admin-alert--error">{{ error }}</div>
  <div *ngIf="loading" class="admin-state">Loading…</div>

  <table *ngIf="!loading" class="admin-table">
    <thead>
      <tr><th>ID</th><th>Name</th><th>Kind</th><th>Parent</th><th>Path</th><th></th></tr>
    </thead>
    <tbody>
      <tr *ngFor="let row of assets; trackBy: trackAsset">
        <td class="mono">{{ row.id }}</td>
        <td>
          <input class="form-input form-input--inline"
                 [(ngModel)]="row.editName"
                 (ngModelChange)="markDirty(row)">
        </td>
        <td>
          <select class="form-select form-select--sm"
                  [(ngModel)]="row.editKind"
                  (ngModelChange)="markDirty(row)">
            <option *ngFor="let k of kinds" [value]="k">{{ k }}</option>
          </select>
        </td>
        <td>
          <select class="form-select form-select--sm"
                  [(ngModel)]="row.editParentId"
                  (ngModelChange)="markDirty(row)">
            <option [value]="null">— none —</option>
            <option *ngFor="let a of assets" [value]="a.id"
                    [disabled]="a.id === row.id">
              {{ a.name }}
            </option>
          </select>
        </td>
        <td class="text-fg-muted" style="font-size:0.72rem">{{ row.path }}</td>
        <td style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-primary btn-sm" [disabled]="!row.dirty || row.saving"
                  (click)="saveRow(row)">
            {{ row.saving ? '…' : 'Save' }}
          </button>
          <button class="btn btn-danger btn-sm" (click)="deleteRow(row)">Del</button>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

**`admin.module.ts`** — add `AdminAssetsComponent` to `declarations`:

```typescript
import { AdminAssetsComponent } from './admin-assets.component';
// ...
declarations: [
  AdminPageComponent,
  AdminKioskTokensComponent,
  AdminUsersComponent,
  AdminAssetsComponent,   // ← add
],
```

**`admin-page.component.ts`** — add `'assets'` to the `AdminTab` type and add a tab button:

```typescript
type AdminTab = 'kiosk-tokens' | 'users' | 'assets';
```

**`admin-page.component.html`** — add a third tab button in the `<nav>`:

```html
<button role="tab" class="admin-tab"
  [class.is-active]="activeTab === 'assets'"
  (click)="setTab('assets')">
  <span class="icon">account_tree</span> Assets
</button>
```

And add the conditional content in the tab panel:

```html
<app-admin-assets *ngIf="activeTab === 'assets'"></app-admin-assets>
```

Add to `styles.css` (under admin styles):

```css
.form-input--inline {
  width: 100%;
  min-width: 80px;
}
```

---

## Verification checklist

1. `pytest backend/tests/test_sensor_ranges.py -v` — all 8 tests pass.
2. `pytest backend/tests/test_asset_hierarchy.py -v` — all 16 tests pass.
3. All existing tests still pass: `pytest backend/tests/ -v`.
4. Asset tree picker with a 3-level hierarchy (factory → area → machine) shows all
   three levels when expanded. Expanding factory shows the area; expanding area shows
   the machine. Grandchildren are correctly indented.
5. Filter text in the tree picker shows matching nodes at all depths and hides non-matches.
6. In dashboard edit mode (owned dashboard), a checkbox icon appears in the top-left of
   each widget on hover.
7. Clicking the checkbox selects the widget; clicking again deselects it.
8. When ≥1 widget is selected, a sticky selection bar appears at the bottom with
   "N widgets selected", "Delete selected", and "Clear" buttons.
9. "Delete selected" confirms, deletes all selected widgets in parallel, reloads the
   dashboard.
10. Turning off edit mode clears the selection and hides the bar.
11. (If Part E done) `/admin` → Assets tab shows all assets with editable name/kind/parent
    fields. Changing a name and clicking Save updates the asset and refreshes the path.
    Delete on a leaf asset removes it. Delete on a parent with children shows the API
    error.
12. `ng build` — zero TypeScript errors, zero Angular errors.

---

## State block template

```
SLICE_10_COMPLETE

Part A (test_sensor_ranges.py): yes/no — N tests passed
Part B (test_asset_hierarchy.py): yes/no — N tests passed
Part C (deep tree fix): yes/no
Part D (bulk widget actions): yes/no
Part E (admin asset editor): yes/no/skipped

Issues encountered:
- <describe any deviations>

pytest backend/tests/: N passed / <failures>
ng build: zero errors / <list errors>
```
