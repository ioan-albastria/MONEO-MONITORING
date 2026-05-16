# Slice 4 — State

## What this slice covered

Completed the Trust tier: enabled the scheduler (alerts now actually run), added the
annotation table and its full lifecycle (auto-created on firing, closed on recovery),
built the annotation API, added alert routes CRUD, wired flapping detection into the
evaluator, built the notification dispatcher (in_app no-op, email, webhook), and added
the frontend annotation display on line charts, the full AlertRoutesListComponent, and
the third "Notification Routes" tab.

The `RangesEditorDrawerComponent` (carryover from Slice 3) was **not** completed —
it remains a compilation blocker entering Slice 5.

---

## Parts completed

**Part 0b — AlertRoutesListComponent**
`alert-routes-list.component.ts` + `.html` created (full implementation). The Slice 3
forward-declaration in `alerts.module.ts` is now satisfied.

**Part 0a — RangesEditorDrawerComponent — NOT completed**
`ranges-editor-drawer.component.ts/.html/.css` still do not exist on disk.
`DashboardModule` does not declare the component. The widget template does **not**
contain an `<app-ranges-editor-drawer>` tag (this is not a compile error yet — the
template simply has no reference). The tune icon button calls `openRangesEditor()` which
currently does nothing visible. Creating and wiring the drawer is the P0 task for
Slice 5 before any Leverage-tier work.

**Part A — Scheduler enabled**
`data_polling_scheduler.py`: `_scheduler.start()` uncommented. `dispatch_outbox`
registered at 30-second interval. Final job list:
- `poll_sensor_readings` — every `sensor_poll_interval_seconds`
- `sync_sensor_metadata` — every 6 hours
- `check_no_data_alerts` — every 60 seconds
- `dispatch_notifications` — every 30 seconds

`main.py`: `start_scheduler()` uncommented.

**Parts B + C — Migration 0005 + Annotation model**
Migration `0005_annotations.py` (revision `0005`, down_revision `0004`) was created
during Slice 3's post-implementation extra changes — it already existed on disk when
Slice 4 began. The Slice 4 agent found it in place and did not duplicate it.

`DAL/models/annotation.py` — SQLAlchemy model with `Mapped[]` fields for all columns.
`migrations/env.py` updated with `import DAL.models.annotation`.

**Parts D + G — Alert evaluator rewrite (merged)**
`alert_evaluator.py` — full rewrite merging annotation auto-creation (Part D) and
flapping detection (Part G) into a single coherent pass.

New module-level constant:
```python
_SEVERITY_COLOR = {"warning": "#f5b428", "critical": "#e64b3c"}
```

New methods added:
- `_write_annotation(db, rule, event, kind, label, started_at, ended_at, color)` → `Annotation`
- `_close_open_annotation(db, rule, now)` — extracted helper; queries for the most
  recent unfinalised annotation whose `source_event_id` points to a `firing` event for
  this rule, then sets its `ended_at`. Called from both the `recovered` and
  `awaiting_ack` branches (avoids duplicating the subquery).
- `_check_flapping(db, rule, state, transition, now)` — resets counter if last flip
  was > 600 s ago; increments `flap_count_10m`; sets/clears `is_flapping` when the
  count crosses 4, writing `flapping_started`/`flapping_stopped` events.

**Bug fixed:** in the `pending → firing` transition, the prompt draft named the return
value of `_write_event()` as `state`, which would have shadowed the `AlertState`
variable. Changed to `firing_event = self._write_event(...)` (and `recovered_event`,
`awaiting_event` in the recovery branches). Return values are captured where needed for
annotation linkage and discarded otherwise.

**Annotation trigger per transition:**
- `ok → firing` (via pending): `_write_annotation` called → open annotation created
- `firing → recovered`: `_close_open_annotation` called → `ended_at` set
- `firing → awaiting_ack`: `_close_open_annotation` called → `ended_at` set

**Part E — Annotation API**
`routes/annotation_routes.py` — `annotation_router` registered at `/api/annotations`.

Endpoints:
```
GET    /api/annotations   filter: scope_kind, scope_id, from, to, kinds, limit
POST   /api/annotations   create manual annotation (any authenticated user)
PUT    /api/annotations/{id}   creator or admin/operator only
DELETE /api/annotations/{id}   creator or admin/operator only
```

Pydantic models: `AnnotationRead`, `AnnotationCreate`, `AnnotationUpdate` (all inline
in `annotation_routes.py`).

`main.py` updated: `from routes.annotation_routes import annotation_router` +
`app.include_router(annotation_router)`.

**Part F — Alert routes CRUD API**
`routes/alert_routes.py` extended with four new endpoints:
```
GET    /api/alerts/routes
POST   /api/alerts/routes          admin/operator only
PUT    /api/alerts/routes/{id}     admin/operator only
DELETE /api/alerts/routes/{id}     admin/operator only
```

`routes/response_models/alert.py` extended with `AlertRouteCreate`,
`AlertRouteUpdate`, `AlertRouteRead`.

**Part H — Notification dispatcher**
`services/notification_dispatcher.py` created.

`dispatch_outbox()` drains up to 50 pending outbox rows per tick. Per entry:
- `in_app` — no-op (event itself is the notification)
- `email` — `aiosmtplib.send()` using SMTP settings from `config.py`
- `webhook` — `httpx.AsyncClient.post()` with `X-MONEO-Signature: sha256=<hmac>` header

Exponential backoff on failure: `60 × 2^attempts` seconds until `MAX_ATTEMPTS = 5`,
then `status = 'failed'`.

`requirements.txt`: `aiosmtplib>=3.0.0` added.

`config.py`: `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `smtp_from`,
`smtp_tls`, `webhook_hmac_secret`, `notification_dispatch_enabled` added to `Settings`.

**Part I — Frontend: Annotation type + service**
`frontend/src/app/types/annotation.ts` — `Annotation` interface.

`frontend/src/app/core/annotations/annotations-api.service.ts` — `getAnnotations(params)`,
`createAnnotation(body)`, `deleteAnnotation(id)`.

**Part J — Frontend: Chart xaxis annotations**
`dashboard-widget.component.ts`:
- `widgetAnnotations: Annotation[] = []` field added
- `AnnotationsApiService` injected
- `loadWidgetAnnotations(sensorIds, from, to)` private method — fetches for single-sensor
  widgets; no-ops for multi-sensor
- `buildXaxisAnnotations()` — maps `Annotation[]` to ApexCharts xaxis entries: point
  (no `ended_at`) or range (has `ended_at`)
- `loadLineChart()` now awaits `loadWidgetAnnotations()` before calling `applyLineChart()`
- `applyLineChart()` annotations object now merges both sources:
  ```typescript
  annotations: {
    ...this.buildAnnotations(),    // yaxis normal-band (Slice 2)
    xaxis: this.buildXaxisAnnotations(),  // time markers (Slice 4)
  }
  ```

**Part K — Frontend: Alert routes UI**
`types/alert.ts`: `AlertRoute` interface added.

`core/alerts/alerts-api.service.ts`: `getRoutes()`, `createRoute(body)`,
`updateRoute(id, body)`, `deleteRoute(id)` methods added.

`modules/alerts/alert-routes-list.component.ts` + `.html` — full implementation:
table of routes with channel, target, scope, trigger flags; inline toggle
(`is_enabled` flip via `updateRoute`) and delete (with confirm dialog).

`modules/alerts/alerts-page.component.ts`: `activeTab` type extended to include
`'routes'`.

`modules/alerts/alerts-page.component.html`: third tab button "Notification Routes"
added; `<app-alert-routes-list>` panel added.

---

## Files created

| File | Notes |
|---|---|
| `backend/migrations/versions/0005_annotations.py` | Migration — annotation table |
| `backend/DAL/models/annotation.py` | Annotation SQLAlchemy model |
| `backend/routes/annotation_routes.py` | Annotation CRUD API |
| `backend/services/notification_dispatcher.py` | Outbox drain — email + webhook + in_app |
| `frontend/src/app/types/annotation.ts` | `Annotation` interface |
| `frontend/src/app/core/annotations/annotations-api.service.ts` | Angular service |
| `frontend/src/app/modules/alerts/alert-routes-list.component.ts` | Routes table component |
| `frontend/src/app/modules/alerts/alert-routes-list.component.html` | |

---

## Files changed

| File | Change |
|---|---|
| `backend/services/alert_evaluator.py` | Added annotation write/close + flapping detection; `_write_event` now returns `AlertEvent`; bug fix on variable shadowing |
| `backend/services/schedulers/data_polling_scheduler.py` | Uncommented `_scheduler.start()`; added `dispatch_outbox` job (30s) |
| `backend/migrations/env.py` | Added `import DAL.models.annotation` |
| `backend/routes/alert_routes.py` | Added routes CRUD endpoints |
| `backend/routes/response_models/alert.py` | Added `AlertRouteCreate/Update/Read` |
| `backend/main.py` | Uncommented `start_scheduler()`; added `annotation_router` |
| `backend/config.py` | Added SMTP + webhook + dispatcher settings |
| `backend/requirements.txt` | Added `aiosmtplib>=3.0.0` |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.ts` | Annotation fetch + xaxis merge |
| `frontend/src/app/types/alert.ts` | Added `AlertRoute` interface |
| `frontend/src/app/core/alerts/alerts-api.service.ts` | Added route CRUD methods |
| `frontend/src/app/modules/alerts/alerts-page.component.ts` | `activeTab` type includes `'routes'` |
| `frontend/src/app/modules/alerts/alerts-page.component.html` | Third tab + panel |

---

## Spec deviations

- `_close_open_annotation` was extracted as a named method rather than inlined twice
  (called from both `recovered` and `awaiting_ack` branches). Cleaner than the prompt draft.
- Parts D and G were implemented as a single file rewrite rather than two passes, which
  avoided an intermediate state where flapping detection was absent while annotation code
  was live.
- `_SEVERITY_COLOR` dict promoted to module-level constant (was inline in the prompt draft).

---

## Outstanding work entering Slice 5

**Ranges-drawer dead code** — the drawer was merged into the widget editor by the user.
`showRangesEditor`, `openRangesEditor()`, `onRangesSaved()`, `closeRangesEditor()` and
the tune icon button in `dashboard-widget.component.ts/.html` are dead code. Slice 5
removes them. The ranges editing flow is complete via the widget editor modal
(STATUS THRESHOLDS section) — no drawer needed.

---

## Open issues going into Slice 5

1. **Create `RangesEditorDrawerComponent`** — 3 files + wire in template + declare in
   `DashboardModule`. Not a compile blocker, but the tune icon is dead without it.
2. **Outbox never written** — the dispatcher drains the outbox correctly but
   `alert_evaluator.py` never enqueues rows into `alert_notification_outbox`. Routing
   logic (match `AlertRoute` scope to a fired event → insert `AlertNotificationOutbox`)
   is absent. Email/webhook delivery will not trigger without this.
3. **`test_slice3.py`** still missing (carried from Slice 3).
4. Begin Leverage tier (EXPANSION_PLAN §4):
   - §4.2 Dashboard-level time-range picker (2–3 d, standalone, high payoff)
   - §4.1 Hierarchical sensor browsing (5–7 d)
