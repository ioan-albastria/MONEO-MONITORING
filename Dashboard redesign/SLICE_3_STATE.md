# Slice 3 — State

## What this slice covered

Full alert pipeline core: dropped the simplified Slice-2 alert tables and replaced them
with the complete §3.3 schema; wrote the streaming `AlertEvaluator` state machine; added
the alert rules/events API; wired in-app notifications (banner + toast); built the
`AlertsModule` with a two-tab page. A post-implementation UI polish session also landed
several widget improvements outside the original plan.

---

## Parts completed

**A — Migration 0004: full §3.3 alert schema** ✅
`migrations/versions/0004_alert_full_schema.py` (revision `0004`, down_revision `0003`)

Drops the five simplified Slice-2 alert tables (in dependency order) and recreates them
with the full §3.3 column set required by the evaluator:

| Table | Key columns added vs Slice 2 |
|---|---|
| `alert_rule` | `condition`, `threshold_lo/hi`, `recovery_lo/hi`, `severity`, `dwell_seconds`, `no_data_seconds`, `recovery_dwell_seconds`, `policy`, `created_by` |
| `alert_event` | `state` (varchar 20), `observed_value`, `observed_at`, `acknowledged_by/at`, `note`, `created_at` |
| `alert_state` | `current_state`, `state_since`, `last_value`, `last_value_at`, `flap_count_10m`, `is_flapping`; `rule_id` is the PK |
| `alert_route` | `scope_kind`, `scope_id`, `scope_severity`, `channel`, `target`, `on_fire`, `on_recover`, `is_enabled` |
| `alert_notification_outbox` | `event_id`, `route_id`, `channel`, `target`, `payload` (JSON, not JSONB), `status`, `attempts`, `last_error`, `next_attempt_at`, `sent_at` |

SQLite-compatible: all types use generic `String`/`JSON` rather than PostgreSQL-specific
`ARRAY`/`JSONB`. `BigInteger` used for all PKs.

**B — SQLAlchemy models rewritten (5 files)** ✅
All five model files rewritten to match the migration 0004 columns.
Relationships declared: `AlertRule → AlertState` (one-to-one, cascade delete-orphan),
`AlertRule → AlertEvent` (one-to-many), `AlertEvent → AlertNotificationOutbox`
(one-to-many, back_populates), `AlertRoute → AlertNotificationOutbox`.

Key model notes:
- `AlertState.rule_id` is the primary key (not a separate `id`)
- `AlertNotificationOutbox.payload` uses SQLAlchemy `JSON` (not `JSONB`) for SQLite compatibility
- `AlertRoute` has no `name` column (scope_kind + channel + target identifies a route)

**C — AlertEvaluator + no-data scheduler** ✅
`backend/services/alert_evaluator.py` — streaming evaluator called once per new reading
inside `poll_latest_readings()`. Wired into `moneo_poller.py` under the
`alert_evaluation_enabled` feature flag. Does not commit; caller owns the transaction.

State machine transitions:
```
ok → pending  (condition first met; dwell timer starts)
pending → firing  (condition still met after dwell_seconds)
pending → ok  (condition cleared before dwell elapsed; AlertState deleted)
firing → recovered  (condition cleared for recovery_dwell_seconds; policy=auto_clear)
firing → awaiting_ack  (condition cleared for recovery_dwell_seconds; policy=manual_ack)
awaiting_ack → (stays until POST /api/alerts/events/{id}/ack)
```

`_condition_met()` logic:
- `gt`: `value > threshold_hi`
- `lt`: `value < threshold_lo`
- `outside_range`: `value < threshold_lo OR value > threshold_hi`
- `inside_range`: `threshold_lo ≤ value ≤ threshold_hi`
- `no_data`: handled separately by the scheduler

`_sync_sensor_ranges()`: when condition is `outside_range` and `sensor.ranges_source ==
'from_alert_rule'`, copies `threshold_lo/hi` into the sensor's warning or critical bound
columns (depending on `rule.severity`).

Note: `flap_count_10m` and `is_flapping` exist in `AlertState` but the evaluator does
**not** yet update them — flapping detection is Slice 4.

`alert_no_data_scheduler.py` registration in `data_polling_scheduler.py` is
**unconfirmed** — verify on disk before Slice 4 assumes it runs.

**D — Alert rules/events API** ✅
`backend/routes/alert_routes.py` — `alert_router` registered at `/api/alerts`.

Endpoints implemented:
```
GET    /api/alerts/rules              list rules (filter: sensor_id, severity, enabled)
POST   /api/alerts/rules              create rule (admin/operator only)
GET    /api/alerts/rules/{id}
PUT    /api/alerts/rules/{id}         (admin/operator only)
DELETE /api/alerts/rules/{id}         (admin/operator only)
GET    /api/alerts/events/active      firing + awaiting_ack events (declared BEFORE /{id})
GET    /api/alerts/events             full event log (filter: sensor_id, rule_id, state, limit)
POST   /api/alerts/events/{id}/ack    ack event; sets state='cleared', updates AlertState
```

Pydantic models in `backend/routes/response_models/alert.py`:
`AlertRuleCreate`, `AlertRuleUpdate`, `AlertRuleRead`, `AlertEventRead`

`alert_router` registered in `main.py`.

**E — Frontend: alert types + AlertsApiService** ✅
`frontend/src/app/types/alert.ts` — `AlertRule`, `AlertEvent` interfaces (full §3.3 fields).

`frontend/src/app/core/alerts/alerts-api.service.ts` — `getRules(params?)`,
`createRule(body)`, `updateRule(id, body)`, `deleteRule(id)`, `getEvents(params?)`,
`getActiveEvents()`, `ackEvent(id, note?)`.

**F — SharedModule: toast + banner** ✅
`frontend/src/app/shared/toast.service.ts` — `BehaviorSubject<Toast[]>`; `push()` and
`dismiss()`. Severity values: `'info' | 'success' | 'warning' | 'critical'`.

`frontend/src/app/shared/toast-host.component.ts + .html` — subscribes to `toasts$`,
renders positioned stack, auto-dismisses after `toast.duration` ms.

`frontend/src/app/shared/alert-banner.component.ts + .html` — polls
`GET /api/alerts/events/active` every 30 seconds via `setInterval`. Renders a sticky
banner when active events exist.

`SharedModule` exports both. `AppModule` and `LayoutModule` import `SharedModule`.

**G — AlertsModule** ✅
`frontend/src/app/modules/alerts/alerts.module.ts` — declares:
`AlertsPageComponent`, `AlertsListComponent`, `AlertRulesListComponent`,
`AlertRoutesListComponent`.

Note: `AlertRoutesListComponent` was declared in this module but its implementation
file was **not** created in Slice 3 — Slice 4 delivered it.

`alerts-routing.module.ts` — routes `''` to `AlertsPageComponent`.

`alerts-page.component.ts` — `activeTab: 'events' | 'rules' = 'events'` (two tabs).

`alerts-list.component.ts` — renders active events table; `ack()` refreshes.

`alert-rules-list.component.ts` — renders rules table; `toggleEnabled()`;
`conditionSummary()` formats condition text.

`/alerts` lazy route registered in `app-routing.module.ts`.

**H — RangesEditorDrawer** ❌ INCOMPLETE
`sensor-api.service.ts` has `updateRanges()` (the HTTP PUT call). An `openRangesEditor()`
stub exists in `dashboard-widget.component.ts`. However:
- `ranges-editor-drawer.component.ts` — **does not exist**
- `ranges-editor-drawer.component.html/.css` — **do not exist**
- `dashboard-widget.component.html` has **no** `<app-ranges-editor-drawer>` tag
- `DashboardModule` does not declare it

This is a fully pending feature, not a partial compile error. The tune icon button in
the widget chrome calls `openRangesEditor()` which currently does nothing visible.
Completing this is the first P0 task for Slice 5.

**Tests** ❌ INCOMPLETE
`test_slice3.py` was not created.

---

## Extra changes (outside Slice 3 plan)

These were applied during a post-implementation UI polish session at the user's request:

- **Migration 0005**: `0005_annotations.py` added (annotation table, §3.4 DDL).
- **Annotations partial wiring**: `AnnotationsApiService` created; `Annotation` type created;
  both imported in `dashboard-widget.component.ts`. Chart xaxis annotation rendering was
  **not** completed — that is Slice 4's Part J.
- **Stat-card centering** fix.
- **Gauge fallback range**: when no bounds configured, uses percentage heuristic.
- **Range bounds cache**: sensor ranges cached alongside sensor list to avoid redundant fetches.
- **Error banner placement**: moved to avoid overlapping widget chrome.
- **Sensor label moved to header** in widget shell.
- **Minimum 3×3 widget** size enforced in gridster config.
- **Faded grid lines** in charts.
- **Overshoot = vivid-red**: gauge needle goes full critical colour when value exceeds max.

---

## Files created

| File | Notes |
|---|---|
| `backend/migrations/versions/0004_alert_full_schema.py` | Migration — drop + recreate 5 alert tables |
| `backend/services/alert_evaluator.py` | Streaming alert state machine |
| `backend/services/schedulers/alert_no_data_scheduler.py` | 60-second no-data check (registration unconfirmed) |
| `backend/routes/alert_routes.py` | Rules CRUD + events + ack |
| `backend/routes/response_models/alert.py` | Pydantic request/response models |
| `backend/migrations/versions/0005_annotations.py` | Extra — annotation table (§3.4 DDL) |
| `frontend/src/app/types/alert.ts` | `AlertRule`, `AlertEvent` interfaces |
| `frontend/src/app/types/annotation.ts` | Extra — `Annotation` interface |
| `frontend/src/app/core/alerts/alerts-api.service.ts` | Angular service for alert API |
| `frontend/src/app/core/annotations/annotations-api.service.ts` | Extra — annotation service |
| `frontend/src/app/shared/toast.service.ts` | BehaviorSubject toast queue |
| `frontend/src/app/shared/toast-host.component.ts + .html` | Toast stack renderer |
| `frontend/src/app/shared/alert-banner.component.ts + .html` | 30s-polling active-alert banner |
| `frontend/src/app/modules/alerts/alerts.module.ts` | AlertsModule |
| `frontend/src/app/modules/alerts/alerts-routing.module.ts` | |
| `frontend/src/app/modules/alerts/alerts-page.component.ts + .html` | Two-tab alerts page |
| `frontend/src/app/modules/alerts/alerts-list.component.ts + .html` | Active events list |
| `frontend/src/app/modules/alerts/alert-rules-list.component.ts + .html` | Rules list |

---

## Files changed

| File | Change |
|---|---|
| `backend/DAL/models/alert_rule.py` | Full rewrite — §3.3 schema |
| `backend/DAL/models/alert_event.py` | Full rewrite — §3.3 schema |
| `backend/DAL/models/alert_state.py` | Full rewrite — rule_id as PK, flap fields |
| `backend/DAL/models/alert_route.py` | Full rewrite — scope/channel model |
| `backend/DAL/models/alert_notification_outbox.py` | Full rewrite — JSON payload (not JSONB) |
| `backend/services/moneo_poller.py` | Wired `AlertEvaluator.evaluate()` under feature flag |
| `backend/services/schedulers/data_polling_scheduler.py` | Added `check_no_data_alerts` job (confirm on disk) |
| `backend/main.py` | Registered `alert_router` |
| `backend/migrations/env.py` | Added 5 alert model imports |
| `frontend/src/app/shared/shared.module.ts` | Added `AlertBannerComponent`, `ToastHostComponent` |
| `frontend/src/app/app-routing.module.ts` | Added `/alerts` lazy route |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.ts` | Added `openRangesEditor()` stub; extra annotation imports wired |
| `frontend/src/app/modules/dashboard/dashboard-widget.component.css` | UI polish tweaks |

---

## Open issues going into Slice 4

1. **RangesEditorDrawer** — create 3 files + declare in `DashboardModule` + wire in template (P0).
2. **Annotations** — migration 0005 and service exist; chart rendering not done (Slice 4 Part J).
3. **Flapping detection** — `flap_count_10m`/`is_flapping` fields exist but evaluator doesn't update them.
4. **Scheduler not started** — `_scheduler.start()` still commented out.
5. **Alert routes CRUD API** — model exists, no endpoints yet.
6. **Notification dispatcher** — outbox model exists, no drain service.
7. **`test_slice3.py`** — not created.
8. **Confirm** `alert_no_data_scheduler.py` is registered in `data_polling_scheduler.py`.
9. Pre-existing test failure: `test_aggregated_readings` — invalid `datetime(…, minute=60)`.
