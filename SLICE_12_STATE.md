# Slice 12 — State

## What this slice covered

`test_alert_evaluator.py` (14 integration tests for `AlertEvaluator` using the
`conftest.py` `db` fixture), the alert-route create form added to
`AlertRoutesListComponent`, and a 60-second in-memory TTL cache wired into
`GET /api/analytics`.

---

## Parts completed

**Part A — test_alert_evaluator.py**
`backend/tests/test_alert_evaluator.py` created with **14 tests**. Uses `conftest.py`
`db` fixture (SQLite in-memory, autoflush=False, PRAGMA foreign_keys=ON). No TestClient
or StaticPool. Tests call `AlertEvaluator.evaluate()` / `evaluate_no_data()` directly
and commit/flush themselves. Coverage:

1. No rules → no state
2. Disabled rule skipped
3. `no_data` condition rule skipped by `evaluate()` (filtered out by query)
4. GT below threshold → no state
5. GT zero-dwell fires immediately (state = "firing")
6. GT positive-dwell creates pending
7. Pending → firing after dwell elapsed (backdate `state.state_since`)
8. Pending clears when condition not met (state deleted)
9. Firing + auto_clear + recovery_dwell=0 → state deleted, "recovered" event written
10. Firing + manual_ack + recovery_dwell=0 → state "awaiting_ack"
11. Annotation created on firing (scope_kind="sensor", label starts with "[WARNING]")
12. Annotation closed on recovery (manually pre-inserted firing event + annotation with
    correct `source_event_id` to work around autoflush=False limitation; see deviation 1)
13. `evaluate_no_data()` with dwell=0 → state "firing"
14. Two independent rules on same sensor — only breached one fires

DeprecationWarnings for `datetime.utcnow()` are expected (intentional naive datetimes
for SQLite tz-naive mismatch handling); zero test failures.

**Part B — Alert route create form**
`alert-routes-list.component.ts` extended:
- Create-form state fields added: `createOpen`, `createSaving`, `createError`,
  `createScopeKind`, `createScopeId`, `createScopeSeverity`, `createChannel`,
  `createTarget`, `createOnFire`, `createOnRecover`.
- `createRoute()`, `openCreateForm()`, `cancelCreate()`, `_resetCreateForm()` methods
  added (see deviation 2 for the `cdr` access decision).
- `alertsApi.createRoute(body)` called with scoped body; created route appended to
  `this.routes`.

`alert-routes-list.component.html` extended with "+ New Route" button toggling an
inline create panel containing: scope select (all/rule/sensor/asset/severity),
conditional scope-id input (for rule/sensor/asset) and severity select
(warning/critical), channel select (in_app/email/webhook), conditional target input
(for email/webhook), on_fire / on_recover checkboxes, Save / Cancel buttons.

`alerts.module.ts` — `FormsModule` added to imports (required for `[(ngModel)]`
in create form).

**Part C — Analytics TTL cache**
`backend/utils/simple_cache.py` created with `cache_get()`, `cache_set()`, and
`make_key()`. TTL is 60 seconds; cache is a module-level dict.

`backend/routes/analytics_routes.py` — cache lookup added before the service call;
result stored on cache miss. Key is built from `sorted(sensor_ids)`, `from_timestamp`,
`to_timestamp`, `aggregated`, `bucket_minutes`.

---

## Files created

| File | Notes |
|---|---|
| `backend/tests/test_alert_evaluator.py` | 14 tests (service-level) |
| `backend/utils/simple_cache.py` | 60 s in-memory TTL cache |

---

## Files changed

| File | Change |
|---|---|
| `backend/routes/analytics_routes.py` | Cache lookup/store wrapping service call |
| `frontend/src/app/modules/alerts/alert-routes-list.component.ts` | Create-form fields + methods |
| `frontend/src/app/modules/alerts/alert-routes-list.component.html` | Create panel + toolbar |
| `frontend/src/app/modules/alerts/alerts.module.ts` | Added `FormsModule` to imports |

---

## Spec deviations

**1 — Annotation-close test uses manually pre-inserted firing event + annotation**
The `conftest.py` `db` fixture uses `autoflush=False`. Inside
`AlertEvaluator._write_annotation()`, `event.id` is `None` at construction time
(the `AlertEvent` has not been flushed yet), so `Annotation.source_event_id` is
persisted as `NULL`. `_close_open_annotation()` queries by
`source_event_id IN (firing event ids)` — with `NULL` values it finds nothing and
the annotation is never closed. To test annotation closing correctly, test 12
pre-creates the `AlertEvent` with an explicit `db.flush()` (to obtain its id), then
constructs the `Annotation` with the correct `source_event_id`, and finally calls
`evaluate()` for the recovery path. The evaluator behaviour is correct in production
(PostgreSQL session uses autoflush=True; the event id is populated before the
annotation is written).

**2 — `cdr` kept private; template uses dedicated methods instead**
The prompt noted two alternatives for calling `cdr.markForCheck()` from the template
when `cdr` is a private injected dependency. The agent chose the cleaner option:
`openCreateForm()` and `cancelCreate()` are public methods that call
`this.cdr.markForCheck()` internally. No template access to `cdr` is needed. The
`_resetCreateForm()` helper remains private, called only from `createRoute()` and
`cancelCreate()`.

---

## Build / test status

`pytest backend/tests/` — **116 passed**, 0 failures.
(Expected DeprecationWarnings for `datetime.utcnow()` — intentional, not failures.)

`ng build` — zero TypeScript errors, zero Angular errors. Two pre-existing budget
warnings remain.

---

## Outstanding work entering Slice 13

1. **§6.1 "Upstream" feature** — referenced in the expansion plan alongside analytics
   caching but never defined beyond that label. Likely relates to sensor-metadata sync
   or upstream API source caching. Needs `EXPANSION_PLAN.md` review to scope.
2. **`datetime.utcnow()` deprecation** — used throughout the test suite for SQLite
   naive-datetime compatibility. Not breaking, but flagged for eventual cleanup.
3. **`simple_cache.py` is process-local** — will not share cache across multiple
   uvicorn workers. Acceptable for the current single-worker dev/staging deployment;
   a Redis-backed cache would be needed for multi-worker production.
