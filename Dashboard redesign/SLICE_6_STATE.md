# Slice 6 — State

## What this slice covered

Implemented §4.1 Hierarchical sensor browsing: added `parent_id`/`kind`/`path` to the
`Asset` model, built an `AssetService` with recursive path computation, exposed the full
asset CRUD + tree API, extended the `Sensor` model with a proper FK + relationship +
`asset_path` computed property, replaced the widget editor's flat sensor `<select>` with
an `AssetTreePickerComponent` that browses the asset hierarchy, and made widget subtitles
auto-populate from `asset_path` for single-sensor widgets.

---

## Parts completed

**Part A — Migration 0007**
`migrations/versions/0007_asset_hierarchy.py` created.
- revision `0007`, down_revision `0006`
- Adds `parent_id INT REFERENCES assets(id) ON DELETE SET NULL`, `kind VARCHAR(20) NOT
  NULL DEFAULT 'machine'`, `path VARCHAR(500)` to `assets`.
- Creates `idx_assets_parent` (on `parent_id`) and `idx_assets_path` (on `path`).
- Data migration: `UPDATE assets SET path = name WHERE path IS NULL` — seeds path for
  existing root assets (all existing assets have no parent, so path = name).
- `downgrade()` drops indexes, FK constraint, then the three columns.

**Part B — Asset model update**
`DAL/models/asset.py` rewritten with:
- `parent_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id", ondelete="SET NULL"))`
- `kind: Mapped[str] = mapped_column(String(20), nullable=False, server_default="machine")`
- `path: Mapped[str | None] = mapped_column(String(500), nullable=True)`
- `parent: Mapped["Asset | None"]` — self-referential relationship (remote_side=Asset.id)
- `children: Mapped[list["Asset"]]` — back-populates `parent`
- `sensors: Mapped[list["Sensor"]]` — back-populates `asset`

`DAL/models/sensor.py` updated:
- `asset_id` changed from `mapped_column(Integer, nullable=True)` to
  `mapped_column(ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)`
- `asset: Mapped["Asset | None"] = relationship("Asset", back_populates="sensors")`
  added (lazy="select")
- `asset_path` `@property` added: returns `f"{self.asset.path} / {self.name}"` when
  `self.asset` and `self.asset.path` are set; `None` otherwise. Requires the `asset`
  relationship to be eager-loaded.

**Part C — AssetService**
`services/asset_service.py` created.

Methods:
- `get_all_flat(db, kind, parent_id, search)` — filtered flat list; `search` matches
  against `name` and `path` using `ilike`.
- `get_tree(db)` — returns root assets; children loaded via `selectinload(Asset.children)`.
- `get_ancestors(db, asset_id)` — walks parent chain, returns `[root, …, direct_parent]`.
- `get_by_id(db, asset_id)` — simple `db.get`.
- `create(db, name, kind, parent_id, description)` — `db.flush()` to get ID, then
  `_compute_path()`, then `db.commit()`.
- `update(db, asset, name, kind, parent_id, description)` — uses Ellipsis (`...`) as
  sentinel to distinguish "not provided" from `None`; calls `_update_subtree_paths()`.
  `# type: ignore[assignment]` added to sentinel-default parameters to satisfy mypy.
- `delete(db, asset)` — plain `db.delete + commit`; caller is responsible for pre-checking
  for children.
- `_compute_path(db, asset)` — traverses parent chain collecting names; returns
  `" / ".join(reversed(parts))`.
- `_update_subtree_paths(db, asset)` — recursively recomputes `path` for all descendants.

**Part D — Asset routes + response models**
`routes/response_models/asset.py` created.
- `AssetRead` — flat response (id, name, description, kind, parent_id, path, location)
- `AssetNodeRead` — recursive tree response; uses `model_rebuild()` for self-reference
- `AssetCreate` — (name, kind, parent_id, description)
- `AssetUpdate` — all Optional fields

`routes/asset_routes.py` created.
- `GET /api/assets/tree` — nested tree
- `GET /api/assets` — flat list with `?kind=&parent_id=&search=`
- `GET /api/assets/{id}/ancestors`
- `GET /api/assets/{id}`
- `POST /api/assets` — admin/operator
- `PUT /api/assets/{id}` — admin/operator; includes cycle guard (parent_id == asset_id → 400)
- `DELETE /api/assets/{id}` — admin/operator; child-count guard (children > 0 → 400)

`main.py` updated: `from routes.asset_routes import asset_router` + `app.include_router(asset_router)`.

**Part E — SensorService joinedload + SensorRead asset_path**
`services/sensor_service.py`: `joinedload(Sensor.asset)` added to `get_all_sensors()` and
`get_sensor()` queries. `set_sensor_active()` re-queries with `joinedload` after `db.refresh`
to avoid stale relationship.

`routes/response_models/sensor.py`: `asset_path: Optional[str] = None` added to `SensorRead`.
Since `from_attributes=True` is set and `asset_path` is a `@property` on the `Sensor` ORM
model, Pydantic calls the property automatically on serialization.

**Part F — Frontend types**
`types/asset.ts` created:
```typescript
export type AssetKind = 'factory' | 'area' | 'line' | 'cell' | 'machine' | 'equipment';
export interface Asset { id; name; description?; kind; parent_id?; path?; location? }
export interface AssetNode extends Asset { children: AssetNode[] }
```

`types/sensor.ts` extended with three fields:
- `asset_id?: number | null` — if not already present
- `asset_path?: string | null` — NEW
- `sensor_type?: string` — was missing from the interface but referenced in the tree
  picker template (`sensor.sensor_type`); added as optional to prevent `strictTemplates`
  build failure.

**Part G — AssetApiService + AssetTreeService**
`core/assets/asset-api.service.ts` created — wraps all `/api/assets` endpoints.
`core/assets/asset-tree.service.ts` created — `BehaviorSubject<AssetNode[]>` with a
5-minute cache TTL; `ensureLoaded()` skips fetch if cache is fresh.

**Part H — AssetTreePickerComponent**
`modules/dashboard/asset-tree-picker.component.ts/.html/.css` created.

Key behaviour:
- Injects `AssetTreeService` + `SensorApiService`; loads both on `ngOnInit` via
  `Promise.all([treeService.ensureLoaded(), sensorApi.listSensors()])`.
- Groups sensors by `asset_id`; sensors with `null` asset_id → "Unassigned" group.
- Filter input matches asset name, asset path, or sensor name (case-insensitive substring).
- Nodes expand/collapse on click. Filter auto-expands matching nodes.
- Checkboxes emit `selectedIdsChange` on every toggle. "Clear all" button resets.
- Two nesting levels rendered in template (root + one child level).

Declared in `DashboardModule` alongside `DashboardComponent` and `DashboardWidgetComponent`.

**Part I — Widget editor: tree picker replaces flat select**
`modules/dashboard/dashboard.component.html`: flat `<select multiple>` removed; replaced
with `<app-asset-tree-picker [selectedIds]="widgetForm.sensorIds" (selectedIdsChange)="widgetForm.sensorIds = $event">`.

`modules/dashboard/dashboard.component.ts`:
- `loadSensors()` private method removed (dead code — tree picker loads its own sensors).
- `sensorsLoading` field removed (no longer needed).
- `availableSensors: Sensor[]` **kept** — still referenced in `populateRangesFromSensor()`
  and the range-cache update inside `saveWidget()`.

**Part J — Widget subtitle auto-population**
`modules/dashboard/dashboard-widget.component.ts` — `subtitle` getter updated:
```typescript
get subtitle(): string {
  const manual = this.widget.subtitle?.trim() || '';
  if (manual) return manual;
  if (this.activeSensor?.asset_path) return this.activeSensor.asset_path;
  return '';
}
```
Display-only; no widget data migration required.

---

## Files created

| File | Notes |
|---|---|
| `backend/migrations/versions/0007_asset_hierarchy.py` | Migration — asset hierarchy |
| `backend/services/asset_service.py` | CRUD + path computation |
| `backend/routes/asset_routes.py` | Asset CRUD + tree API |
| `backend/routes/response_models/asset.py` | `AssetRead`, `AssetNodeRead`, `AssetCreate`, `AssetUpdate` |
| `frontend/src/app/types/asset.ts` | `Asset`, `AssetNode`, `AssetKind` |
| `frontend/src/app/core/assets/asset-api.service.ts` | HTTP wrapper |
| `frontend/src/app/core/assets/asset-tree.service.ts` | Cached tree BehaviorSubject |
| `frontend/src/app/modules/dashboard/asset-tree-picker.component.ts` | Tree picker |
| `frontend/src/app/modules/dashboard/asset-tree-picker.component.html` | |
| `frontend/src/app/modules/dashboard/asset-tree-picker.component.css` | |

---

## Files changed

| File | Change |
|---|---|
| `backend/DAL/models/asset.py` | Added `parent_id`, `kind`, `path`, self-referential + sensors relationships |
| `backend/DAL/models/sensor.py` | Changed `asset_id` to `ForeignKey`; added `asset` relationship + `asset_path` property |
| `backend/services/sensor_service.py` | `joinedload(Sensor.asset)` on all queries |
| `backend/routes/response_models/sensor.py` | Added `asset_path: Optional[str]` to `SensorRead` |
| `backend/main.py` | Added `asset_router` |
| `frontend/src/app/types/sensor.ts` | Added `asset_id`, `asset_path`, `sensor_type` (optional) |
| `frontend/src/app/modules/dashboard/dashboard.module.ts` | Declared `AssetTreePickerComponent` |
| `frontend/src/app/modules/dashboard/dashboard.component.html` | Replaced flat select with tree picker |
| `frontend/src/app/modules/dashboard/dashboard.component.ts` | Removed `loadSensors()`, `sensorsLoading`; kept `availableSensors` |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.ts` | `subtitle` getter falls back to `asset_path` |

---

## Spec deviations

- `sensor_type?: string` added to the `Sensor` TypeScript interface. It was already
  returned by the API (`SensorRead.sensor_type`) but absent from the TS type; the tree
  picker template referenced it directly. Adding it as optional was the minimal fix.
- `AssetService.update()` uses Ellipsis (`...`) as "not provided" sentinel for optional
  fields. mypy flags the parameter default type as `Ellipsis` ≠ `int | None | str | None`.
  Resolved with `# type: ignore[assignment]` on the affected parameter lines without
  changing logic.
- `loadSensors()` and `sensorsLoading` removed from `DashboardComponent` — these were
  only used to drive the old flat picker. `availableSensors` retained because it is still
  consumed by `populateRangesFromSensor()` and by the range-cache update in `saveWidget()`.

---

## Build status

`ng build` — zero TypeScript errors, zero Angular errors. Two **pre-existing** budget
warnings (bundle size, CSS size) remain; not introduced by Slice 6.

---

## Outstanding work entering Slice 7

1. **`test_slice3.py` / `test_slice4.py` / `test_slice5.py` / `test_slice6.py`** — backend
   test coverage still absent across all recent slices.
2. **Admin asset tree editor** — drag-drop reparenting in an admin UI; deferred from
   §4.1. The API is fully in place; only the frontend admin screen is missing.
3. **Deep tree nesting** — the `AssetTreePickerComponent` renders two levels (root +
   one child). Data with 3+ levels will not display grandchildren. Recursive template
   component or a flattened approach needed for deep hierarchies.
4. **§4.4 UX polish bundle** — widget catalog cards, sparkline endpoint, sensor picker
   sparklines, smart defaults, drill-down, bulk widget actions, gauge aspect ratio,
   drag-handle contrast. Natural Slice 7.
5. **§5.2 Kiosk mode** — small (1.5–2 d); could be bundled into Slice 7 or a standalone
   tiny slice.
6. **§5.3 URL-shareable dashboard state** — depends on §4.2 (done) and optionally §4.3.
