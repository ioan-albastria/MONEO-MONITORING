# Slice 1 — Alembic foundations · sensor extensions · data freshness

Continue the MONEO sensor dashboard expansion.

Read **`EXPANSION_PLAN.md`** end to end before writing any code. Then read
every file listed under **CURRENT STATE** to understand what is already in
place. Do not guess at existing signatures; always read first, then edit.

---

## SOURCE OF TRUTH

| File / path | Role |
|---|---|
| `EXPANSION_PLAN.md` | **Primary spec for iteration 2.** §2.2 (slicing rules), §3.1 (data freshness), and §6.1 (caching note re `last_seen_at`) govern this slice directly. The range-bound columns laid down here (§3.2) are intentional schema prep; their UI rendering arrives in Slice 2. |
| `IMPLEMENTATION_INSTRUCTIONS.md` | Iteration-1 backend architecture (models, service patterns, route conventions). |
| `FRONTEND_REBUILD_INSTRUCTIONS.md` | Iteration-1 frontend patterns — CSS variables, NgModule structure, `ChangeDetectionStrategy.OnPush` convention, phase 13 styling rules. |
| `backend/` | Live codebase. Read before every edit. |
| `frontend/src/app/` | Live frontend. Same rule. |

**Constraints inherited from the project:**
- Never use git worktrees. All edits go directly into the working tree.
- Never commit. The user controls all git operations.
- Never modify files outside the scope defined below.

---

## CURRENT STATE

### Backend

- FastAPI + SQLAlchemy 2 + Postgres. Schema managed with `Base.metadata.create_all()` — **no Alembic yet**.
- **`backend/requirements.txt`** — does NOT include `alembic`. It does include `apscheduler`, `redis` (unused), and `pydantic-settings`.
- **`backend/config.py` / `Settings`** — key existing field: `sensor_poll_interval_seconds: int = 300`. Use this name; do not add a duplicate.
- **`backend/DAL/models/sensor.py`** — current columns: `id, moneo_sensor_id, name, description, sensor_type, unit, asset_id, min_value, max_value, is_active, extra_metadata (JSON), created_at, updated_at`. No freshness or range columns.
- **`backend/routes/response_models/sensor.py` → `SensorRead`** — exposes: `id, moneo_sensor_id, name, description, sensor_type, unit, asset_id, min_value, max_value, is_active, created_at`. No `last_seen_at`, no `expected_poll_seconds`.
- **`backend/services/moneo_poller.py` → `MoneoPoller.poll_latest_readings()`** — queries all active sensors, calls `get_latest_sensor_reading()`, skips duplicates, writes `SensorReading` rows, commits. Does NOT update `last_seen_at` (column doesn't exist yet).
- **`backend/DAL/models/alert_config.py`** — a thin stub table that exists in DB. Do not touch it this slice; it is replaced properly in Slice 2.

### Frontend

- Angular 20, NgModules (`--standalone=false`), `ChangeDetectionStrategy.OnPush` on every component.
- **`frontend/src/app/types/sensor.ts`** → `Sensor` interface: `id, name, unit, description, is_active, created_at, updated_at`. No new fields yet.
- **`frontend/src/app/core/sensors/sensor-api.service.ts`** — `listSensors()`, `getSensor()`, `getReadings()`, `getLatest()`, `getAnalytics()`. Returns `Sensor[]` etc.
- **`frontend/src/app/modules/widgets/app-widgets-shell.component.ts`** — `@Input() title, subtitle, loading, tone, chromeMode`. No freshness inputs. Uses `ChangeDetectionStrategy.OnPush`.
- **`frontend/src/app/modules/widgets/widgets.module.ts`** — declares and exports `AppWidgetsShellComponent`. This is where the new `RelativeTimePipe` is declared.
- **`frontend/src/app/modules/dashboard/dashboard-widget.component.ts`** — loads analytics / readings / latest per widget type; already injects `ChangeDetectorRef` and calls `cdr.markForCheck()` in realtime subscriptions. Holds `latestReading: SensorReading | null`.
- There is no `frontend/src/app/shared/` directory yet.

---

## THIS SESSION: Slice 1 — Alembic foundations + Sensor extensions + Data freshness

### Part A — Introduce Alembic (backend)

**Goal:** replace `Base.metadata.create_all()` with a proper Alembic migration chain so all future schema changes are tracked.

1. Add `alembic>=1.14.0` to `backend/requirements.txt`.

2. Initialise Alembic inside the backend:
   ```
   backend/
     alembic.ini
     migrations/
       env.py
       script.py.mako
       versions/
   ```
   Configure `alembic.ini` to set `script_location = migrations` and leave `sqlalchemy.url` blank (it is set programmatically).

3. Edit `migrations/env.py`:
   - Import `Base` from `DAL.db_context` and import all model modules so every mapper is registered before autogenerate runs (import `DAL.models.user`, `DAL.models.sensor`, `DAL.models.sensor_reading`, `DAL.models.dashboard`, `DAL.models.dashboard_widget`, `DAL.models.asset`, `DAL.models.alert_config`).
   - Read the database URL from `config.settings.database_url`, not from `os.environ` or `alembic.ini`.
   - Support both offline and online migration modes (standard Alembic env.py pattern).

4. Create **`migrations/versions/0001_initial_schema.py`** — a baseline snapshot. Do NOT use autogenerate for this one; write the `upgrade()` function to call `pass` (the tables already exist in prod). The `downgrade()` should also be a no-op for baseline. Add a comment: `# Baseline — tables pre-exist; this migration documents initial state only.`

5. Create **`migrations/versions/0002_sensor_extensions.py`** — adds the nine new columns to `sensors` (see Part B). Use `op.add_column` with `server_default` where appropriate. Write a proper `downgrade()` that removes them.

6. In **`backend/main.py`**: add a `Settings` field `auto_migrate: bool = True`. On startup, when `auto_migrate` is True, run `alembic upgrade head` programmatically:
   ```python
   from alembic.config import Config
   from alembic import command
   alembic_cfg = Config("alembic.ini")
   command.upgrade(alembic_cfg, "head")
   ```
   Wrap in a `try/except` that logs and re-raises so a broken migration fails fast rather than silently serving stale schema.
   Remove the old `init_db()` / `Base.metadata.create_all()` call entirely.

---

### Part B — Sensor model extensions (backend)

Add to **`backend/DAL/models/sensor.py`**:

```python
from sqlalchemy import DateTime   # already imported; add Integer, String if not present

expected_poll_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
normal_min:   Mapped[float | None] = mapped_column(Float, nullable=True)
normal_max:   Mapped[float | None] = mapped_column(Float, nullable=True)
warning_min:  Mapped[float | None] = mapped_column(Float, nullable=True)
warning_max:  Mapped[float | None] = mapped_column(Float, nullable=True)
critical_min: Mapped[float | None] = mapped_column(Float, nullable=True)
critical_max: Mapped[float | None] = mapped_column(Float, nullable=True)
ranges_source: Mapped[str] = mapped_column(String(20), nullable=False, server_default="manual")
```

These nine columns are what migration 0002 adds.

Update **`backend/routes/response_models/sensor.py`** → `SensorRead`:
- Add `expected_poll_seconds: Optional[int] = None`
- Add `last_seen_at: Optional[datetime] = None`
- Do **NOT** expose the six range-bound or `ranges_source` fields yet — they're schema-only this slice; the API surface for them opens in Slice 2.

Update **`backend/services/moneo_poller.py`** → `poll_latest_readings()`:
- After `db.add(reading)` and before `db.commit()`, set:
  ```python
  sensor.last_seen_at = timestamp
  ```
  This stays inside the same DB session, so no extra round-trip.

---

### Part C — Frontend: data freshness indicator

**Goal:** every widget card shows "Updated 3s ago" in muted text, shifting to amber then red as the reading ages.

#### Step C.1 — Extend `Sensor` type

**`frontend/src/app/types/sensor.ts`** — add two fields to the `Sensor` interface:
```typescript
expected_poll_seconds: number | null;
last_seen_at: string | null;   // ISO 8601 timestamp
```

#### Step C.2 — `RelativeTimePipe`

Create **`frontend/src/app/modules/widgets/relative-time.pipe.ts`**:

```typescript
@Pipe({ name: 'relativeTime', pure: true })
export class RelativeTimePipe implements PipeTransform {
  transform(isoTimestamp: string | null): string {
    if (!isoTimestamp) return 'N/A';
    const seconds = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
    if (seconds < 0)    return 'just now';
    if (seconds < 90)   return `${seconds}s ago`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
  }
}
```

Declare and export it in **`WidgetsModule`** (`widgets.module.ts`).

#### Step C.3 — Update `AppWidgetsShellComponent`

**`app-widgets-shell.component.ts`** changes:

1. Inject `ChangeDetectorRef` in the constructor.
2. Add inputs:
   ```typescript
   @Input() freshAt: string | null = null;
   @Input() expectedIntervalSeconds = 300;
   ```
3. Add a computed property `freshnessState: 'fresh' | 'stale' | 'offline' | 'unknown'` — computed from the difference between `Date.now()` and `freshAt` vs `expectedIntervalSeconds`:
   - `unknown` — `freshAt` is null.
   - `fresh`   — age < 1× interval.
   - `stale`   — 1× ≤ age < 5× interval.
   - `offline` — age ≥ 5× interval.
4. In `ngOnInit`, start an `interval(5_000)` (from `rxjs`) that calls `this.cdr.markForCheck()` so the pipe re-evaluates. Store the subscription and unsubscribe in `ngOnDestroy`.

**`app-widgets-shell.component.html`** — add a freshness footer line **inside** the card, below the existing body `<ng-content>` slot but above (or inside) the chrome bar:
```html
<footer *ngIf="freshAt !== null" class="widget-freshness" [attr.data-state]="freshnessState">
  {{ freshAt | relativeTime }}
</footer>
```
Do not show the footer while `freshAt` is null (initial loading — this is not an error state).

**`app-widgets-shell.component.css`** — add:
```css
.widget-freshness {
  font-size: 0.7rem;
  color: var(--color-fg-faint);
  padding: 2px var(--page-pad) 4px;
  transition: color var(--dur-1);
}
.widget-freshness[data-state="stale"]   { color: var(--color-warning); }
.widget-freshness[data-state="offline"] { color: var(--color-danger);  }

/* Desaturate the body content when data is offline */
:host([data-state="offline"]) .widget-body { opacity: 0.55; filter: saturate(0.3); }
```

Also bind `[attr.data-state]="freshnessState"` on the outermost host element so the CSS rule above works. Use `@HostBinding('attr.data-state') get stateAttr() { return this.freshnessState; }`.

#### Step C.4 — Compute `freshAt` in `DashboardWidgetComponent`

**`dashboard-widget.component.ts`** — add:

```typescript
freshAt: string | null = null;
expectedIntervalSeconds = 300;
```

Set `freshAt` after every data load and realtime update:

- **`line_chart` / `bar_chart`**: after loading analytics, set:
  ```typescript
  // max timestamp across all series points
  this.freshAt = this.maxTimestamp(this.analyticsData);
  ```
  Add a private helper:
  ```typescript
  private maxTimestamp(resp: AnalyticsResponse | null): string | null {
    if (!resp) return null;
    const all = resp.data.flatMap(s => s.points.map((p: any) => p.timestamp as string));
    return all.length ? all.reduce((a, b) => (a > b ? a : b)) : null;
  }
  ```
- **`gauge` / `stat_card`**: after `getLatest()` resolves and after each realtime message, set:
  ```typescript
  this.freshAt = this.latestReading?.timestamp ?? null;
  ```
- Set `expectedIntervalSeconds` from the first sensor's `expected_poll_seconds` (fall back to `300` if null or multi-sensor):
  ```typescript
  // After sensor list is loaded in the widget config:
  this.expectedIntervalSeconds = this.sensors?.[0]?.expected_poll_seconds ?? 300;
  ```
  For `line_chart` / `bar_chart` use the minimum non-null `expected_poll_seconds` across all sensors (or `300` if all null).

Wire the new inputs in **`dashboard-widget.component.html`** wherever `<app-widget-shell>` is called:
```html
<app-widget-shell
  ...existing bindings...
  [freshAt]="freshAt"
  [expectedIntervalSeconds]="expectedIntervalSeconds"
>
```

Note: `DashboardWidgetComponent` does not currently load full `Sensor` objects alongside the widget config. Add a `sensors: Sensor[]` property populated by calling `sensorApi.listSensors()` once and filtering by `widget.settings.sensor_ids`. Cache the full list in-component (or reuse a service-level cache if one already exists).

---

## EXPLICITLY OUT OF THIS SLICE

- `alert_rule`, `alert_event`, `alert_state`, `alert_route`, `outbox` tables — Slice 2.
- `User.role` column — Slice 2.
- Status coloring on charts / gauges / stat cards (the range-bound columns exist after this slice, but no rendering code) — Slice 2.
- Chart annotations — Slice 3.
- Caching layer (§6.1) — later.
- WebSocket auth fix — Slice 2.
- Admin section — later.
- Dashboard-level time picker — later.
- The "Live" pill (green dot for active WebSocket) — **include only if trivially implementable alongside the freshness footer**; otherwise defer to Slice 2.

---

## DELIVERABLE

The slice is done when **all** of the following are true:

1. `pip install alembic` succeeds from `backend/`; `alembic upgrade head` runs cleanly against a fresh Postgres DB and produces all current tables plus the nine new sensor columns.
2. `GET /api/sensors` returns `expected_poll_seconds` (null or integer) and `last_seen_at` (null or ISO timestamp) for every sensor.
3. `MoneoPoller.poll_latest_readings()` sets `sensor.last_seen_at` on every successful reading write.
4. Every widget card in the Angular dashboard — line chart, bar chart, gauge, stat card — shows a small "Updated Xs ago" line in muted text at the bottom of the card once data has loaded.
5. That text shifts amber when `age ≥ 1× expected_poll_seconds` and red (with desaturated body) when `age ≥ 5× expected_poll_seconds`. It remains muted-grey when fresh.
6. The freshness text updates live every 5 seconds with no extra HTTP requests.
7. `ng build` produces zero TypeScript errors and zero Angular compilation warnings.
8. All existing backend tests pass (`pytest backend/tests/`).
9. New tests added: unit tests for `RelativeTimePipe` covering `null` input, 0–89 s, 90 s–89 min, 1–23 h, ≥24 h edge cases. At minimum a Jasmine spec in `frontend/` or a pytest test depending on where tests live.

---

## WORKFLOW

Use a **TodoList** to track progress through parts A, B, and C.

**Pause once** — after you have sketched the full file-change list and before writing any code — and confirm the scope matches this prompt. Continue only after that check.

Work through all three parts to completion. Do not skip the Alembic baseline migration (0001); it is the foundation that makes all future migrations incremental.

---

## STATE BLOCK FOR NEXT SESSION

At the very end of this session, write a **"Slice 1 — state for next session"** block. Keep it under 20 lines. Cover:

- Parts completed (A / B / C fully or partially).
- Files created and files changed (list them explicitly).
- Spec deviations accepted and the reason for each.
- Anything left unfinished and why.
- Open questions or surprises for Slice 2.

Output it as a fenced markdown block so it can be pasted verbatim into the Slice 2 prompt.
