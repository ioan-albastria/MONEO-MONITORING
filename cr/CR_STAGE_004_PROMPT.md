# MONEO Monitoring — Code Review Agent Prompt (Stage 4)

You are running **Stage 4 — Backend: routes, Pydantic response models, middleware** of a multi-stage code review of the MONEO Monitoring app. You have **read access to the whole repo** but you will **only modify files listed under "Stage scope"** below.

You are working under an **orchestrator** (the user's main Claude session). After each pass, you stop and report back so the orchestrator can craft the next stage's prompt. Do not try to plan or run later stages yourself.

Before doing anything else, read:
- `CLAUDE.md` (root) and `backend/CLAUDE.md` — note the authoritative endpoint inventory and the **frozen `/api/admin/sync/health` shape**
- `cr/CR_STAGE_001_STATUS.md`, `cr/CR_STAGE_002_STATUS.md`, `cr/CR_STAGE_003_STATUS.md` — accumulated context and cross-stage hooks
- Any other `cr/CR_STAGE_*_STATUS.md` files
- `MONEO openapi docs.json` if present at repo root — upstream contract (relevant if you touch `moneo_routes.py`)

## Working artifact — single living status file

Maintain exactly one document: **`cr/CR_STAGE_004_STATUS.md`**.

Skeleton (fill sections as they become relevant; mark unfilled "_n/a yet_"):

```markdown
# Stage 004 — Backend: routes, response models, middleware

**Status:** <Draft | Audit complete | Awaiting decisions | Fixes applied | Stage complete>
**Date:** YYYY-MM-DD
**Files in scope:** <list>

---

## Pass 1 — Audit findings
<table>

## Duplication map
## Behavior-affecting — needs explicit approval
## Deferred / leave-as-is
## Out-of-scope findings (for future stages)

---

## Orchestrator decisions

---

## Pass 2 — Applied
### Applied
### Skipped
### Files modified
### Public surface changes inside scope
### Contract-preservation evidence
### Cross-stage notes
### Test commands run

---

## Commit message draft
```

## Carry-over context from Stages 1–3 (must respect)

- **`DAL.session_scope()`** is the canonical DB-session helper. Adopt it where appropriate in this stage — known sites carried from Stage 1: `routes/websocket_routes.py:47` and `routes/websocket_routes.py:63`. Find any others.
- **`DAL.Annotation`, `DAL.KioskToken`, `DAL.session_scope`** are public re-exports — use the short import form.
- **`middleware.py:46`** has a lazy `from DAL.models.kiosk_token import KioskToken` inside `get_current_user`. It exists to avoid a circular import. Since Stage 1 re-exported `KioskToken` from `DAL.models`, the lazy import can now be hoisted to module top. Verify there is still no circular import after hoisting; if there is, leave it as-is and document why.
- **`init_db`** was removed in Stage 1 — do not reintroduce.
- **S1-M3 (Integer vs BigInteger PK mismatch)** is intentionally deferred.
- **Sensor / Asset did not adopt `TimestampMixin`** (DDL column-order constraint).
- **S2-M1 (scheduler `max_instances=1`)** is a separate standalone task — do not touch.
- **AlertEvaluator is stateless** — confirmed by Stage 3. Do not change this assumption.
- **Datasource-ID bug at `moneo_poller.py:167`** is a separate standalone task — do not touch.
- **Stage 3 introduced new module-level constants and helpers** in `auth_service`, `alert_evaluator`, `notification_dispatcher` (e.g. `_DUMMY_HASH`, `_STATE_*`, `_COND_*`, `_FLAP_WINDOW_SECONDS`, `_alert_label`, `_DISPATCH_BATCH_SIZE`). These are private to their modules; do not import them from routes.

## Mission

Improve code design, clean-code adherence, and especially **eliminate duplication (DRY)** in the stage scope, **without changing the public HTTP/WebSocket contract**.

## Hard constraints (violating any = abort and report)

1. **Public contract preservation is absolute.** No change to:
   - **HTTP endpoint paths, methods, status codes, response shapes, query/body parameter names, error response shapes.** The endpoint inventory in `backend/CLAUDE.md` is the authoritative reference.
   - **The `/api/admin/sync/health` response shape is FROZEN.** It is documented in `backend/CLAUDE.md` with the full JSON example. Do not add, remove, rename, or reorder any field — not even cosmetically.
   - **WebSocket protocol:** path `/ws/sensors/{sensor_id}`, `?token=<jwt>` query-param auth, close code `1008` on invalid token, JSON message shapes, push cadence.
   - **Admin authorization is a `username == "admin"` string check in `moneo_routes.py`.** Per `backend/CLAUDE.md` gotchas, this is intentional — there is no `is_admin` column. Do not "refactor" this into a role check, do not extract it into a new dependency that changes the check, and do not add an `is_admin` field anywhere.
   - **`/api/dashboards/public` must remain registered before `/api/dashboards/{id}`** so FastAPI's declaration-order matching keeps working. If you reorder routes for any other reason, do not violate this.
   - **`POST /api/dashboards/{id}/layout` returns 204 no-body** — the frontend depends on this. Do not "improve" it to return the updated dashboard.
   - **JWT claim shape, algorithm, TTL, password hashing** — unchanged.
2. **Pydantic response models** — field names, types, defaults, optionality, alias behavior, `model_config`/`Config` flags, JSON serialization (especially datetime ISO format and `populate_by_name`) **must remain identical**. If you find a model that adds a field that wasn't there before, that is a contract change requiring approval.
3. **No new dependencies** without explicit approval.
4. **No commits, no `git add`, no `git push`.** No worktrees.
5. **Do not run tests.** Tell the orchestrator the exact command; they execute.
6. **No reformat-only edits.**

## Contract baseline guard

**Before any edits in Pass 2, capture an OpenAPI snapshot:**

```
cd backend
python -c "from main import app; import json; print(json.dumps(app.openapi(), indent=2))" > ../cr/openapi_pre_stage4.json
```

(If `main.py` can't be imported standalone for any reason, document that in the status file and propose an alternative — do not skip the baseline.)

After Pass 2 edits, capture the same snapshot to `cr/openapi_post_stage4.json` and **diff them**. The diff must be empty. Include the diff result (empty / non-empty with details) in the Contract-preservation evidence section.

## Clean-code rules (priority order)

1. **DRY — top priority.** Hunt duplication across the 9+ route files and the response_models package. Extract only with **≥3 real repetitions, same reason to change**, and only if extraction stays readable.
2. **Dead code** — unused imports, vars, route functions, response model fields (the latter is a contract change — flag, do not delete).
3. **Naming** — intention-revealing.
4. **Functions / route handlers** — small, SRP, ~40 line target. **Don't fragment into long call chains.** A route handler is allowed to be slightly longer than a pure helper because it's the boundary that wires parsing → service call → response shaping.
5. **Comments.**
   - Delete stale, redundant, or commented-out code.
   - **Add "why" comments** where intent is non-obvious (declaration-order route ordering, admin string check, 204 no-body responses, websocket close codes).
   - **Comments apply to newly authored files and extracted abstractions too.** When you create a new file or extract a new helper/dependency, write a brief module docstring covering:
     - Why the file/abstraction exists
     - Non-obvious invariants future readers must preserve
     - Deliberate exemptions or trade-offs
   - The repo-wide "default to no comments" rule is overridden for newly authored files / extracted abstractions.
6. **Error handling** — no bare `except`, no swallowed exceptions. `HTTPException` is the right boundary type in routes; ensure status codes and detail shapes match what the frontend expects (look at usages before adjusting any wording).
7. **Magic values** — extract to module-level constants when reused or meaningful (default pagination size, time-range defaults, status codes only if reused — usually unnecessary).
8. **Type hints** — complete on public surfaces; eliminate unjustified `Any`.
9. **Async hygiene** — no blocking I/O in async route handlers; sessions always closed.
10. **Layering** — routes thin: parse → call service → shape response. **No raw SQL in route files. No business logic in route bodies that belongs in services.** If you spot business logic in a route, flag as Major and propose extraction; only apply if the called service has a natural home for it (i.e. the move is in scope).
11. **Security** — flag any token/PII/error-detail leak in error responses (e.g. echoing user-supplied input back unsanitized, leaking internal exception messages), any unparameterized SQL, any authorization check missing on a protected route, any place a request body is trusted without validation.

## Stage scope

**Focus:** thin routes, consistent error envelopes, dependency reuse, response-model layering, websocket session lifecycle, middleware import hygiene.

**Files in scope (only these may be edited):**
- `backend/routes/auth_routes.py`
- `backend/routes/dashboard_routes.py`
- `backend/routes/widget_routes.py`
- `backend/routes/sensor_routes.py`
- `backend/routes/analytics_routes.py`
- `backend/routes/moneo_routes.py`
- `backend/routes/admin_sync_routes.py`
- `backend/routes/admin_debug_routes.py` (if present)
- `backend/routes/websocket_routes.py`
- `backend/routes/response_models/` — all files
- `backend/middleware.py`

**Do NOT edit in this stage** (record findings as out-of-scope):
- Everything under `backend/services/**` — Stages 2 and 3 closed
- `backend/DAL/**`, `backend/main.py`, `backend/config.py` — Stage 1 closed
- `backend/tests/**` — Stage 5
- `backend/migrations/**` — Stage 1 closed

**DRY hot spots to probe specifically:**
- The two `SessionLocal()` sites in `websocket_routes.py:47, :63` → `session_scope()`. Verify the websocket's commit/rollback semantics match the helper; if there's anything unusual (long-lived session held across receive loop, partial commits inside the loop), document and consider leaving in place.
- Repeated `Depends(get_current_user)` + ownership-check pattern (e.g. "load entity → check `entity.owner_id == current_user.id` → 404/403"). Likely candidate for a small dependency function — but only if the check is *truly* identical across ≥3 routes (status code, detail message, and which entity types). Distinct ownership rules per entity often look similar but aren't.
- Repeated 404-pattern: `entity = service.get(...)` → `if not entity: raise HTTPException(404, "...")`. If the message and status are identical across ≥3 places, a helper is worth it.
- Repeated time-range query param parsing in `sensor_routes` and `analytics_routes` (`from`, `to`, defaults, ISO parsing).
- Repeated pagination parameter parsing if any.
- Response models: shared base classes, repeated `model_config = ConfigDict(from_attributes=True)`, repeated common fields (`id`, `created_at`). If a base class would save real lines and doesn't break Pydantic discrimination, propose it — but be aware that touching response models is contract-sensitive. Field additions/removals/renames/reorderings are forbidden.
- Repeated logger initialization or log-line formatting in routes.
- Repeated upstream-MONEO error handling in `moneo_routes.py` (the proxy routes).
- Middleware: the lazy `KioskToken` import — hoist if no circular dependency reappears.

## Specific traps to watch for

- **`/api/dashboards` route order.** Per `backend/CLAUDE.md`, `/api/dashboards/public` is declared before `/api/dashboards/{id}`. If you reorder anything in `dashboard_routes.py`, preserve this. Worth adding a one-line "why" comment above the public route if none exists.
- **Admin check.** In `moneo_routes.py`, the check `if current_user.username != "admin"` is intentional. If you extract it into a dependency, the dependency must use the exact same string comparison. Document the choice (with a "why" comment) explaining the design and pointing at the gotcha in CLAUDE.md.
- **Layering vs services-import-from-routes.** Stage 3 documented that several services import Pydantic models from `routes/response_models/`. That's a soft layering concern. **Do not fix it in this stage** — moving models to a new `schemas/` package would change import paths used by services and is high-blast-radius. Record as out-of-scope for a future architectural pass.
- **WebSocket token validation.** Per `backend/CLAUDE.md`: token is validated before `websocket.accept()`; missing/invalid → close `1008`. If you refactor the websocket auth flow, preserve this exact sequence and close code. Do not switch to a header-based scheme.
- **Response-model field additions.** Even adding an `Optional[X] = None` field to a response model is a contract change (the frontend's TypeScript types may not include it). Flag any such addition as behavior-affecting.

## Workflow — two passes

### Pass 1: Audit (read-only)

1. Create `cr/CR_STAGE_004_STATUS.md` with status `Draft`.
2. Populate Pass 1 sections.
3. Set status to `Audit complete`.
4. Stop and report `STAGE_004_AUDIT_REPORT`.

IDs: `S4-C1`, `S4-M1`, `S4-m1`, `S4-n1`.

### Pass 2: Fix (only after orchestrator response)

1. Append orchestrator decisions to the status file under "Orchestrator decisions".
2. If baseline tests are red, **stop**.
3. **Capture `cr/openapi_pre_stage4.json` BEFORE any edit.**
4. Apply `Critical` (non-behavior-touching) + approved `Major` + all `Minor`. Skip `Nit` unless trivial.
5. Edit only files in scope. One concern per edit.
6. Append `Applied:` entries to the status file.
7. **Capture `cr/openapi_post_stage4.json` AFTER edits.** Diff the two files. The diff must be empty.
8. In the Contract-preservation evidence section, include:
   - The OpenAPI diff result (empty / non-empty with details).
   - For each route handler touched: confirm path, method, status code, request params, response shape unchanged.
   - For each response model touched: confirm field names, types, defaults, `model_config` unchanged.
   - For any websocket change: confirm close codes, message shapes, accept-after-auth ordering preserved.
   - For middleware: confirm `get_current_user` return type and exception behavior unchanged.
9. Append a **Commit message draft** section at the end of the status file. Format:

   ```
   Stage 4 CR - Backend: routes, response models, middleware

   * <one bullet per logical change, merging related IDs>
   ```

   Rules: imperative verbs, mention new files / new symbols, copy-paste-ready.
10. Set status to `Stage complete`. Report `STAGE_004_FIX_REPORT`.

## Reports back to orchestrator

### After Pass 1 — `STAGE_004_AUDIT_REPORT`

```
STAGE 4 — AUDIT REPORT

Status file: cr/CR_STAGE_004_STATUS.md (status: Audit complete)

Counts:
- Critical: X
- Major: X
- Minor: X
- Nit: X
- Behavior-affecting (needs approval): X

Top 3 DRY clusters:
1. <one line>
2. <one line>
3. <one line>

Surprises / notable observations (≤5 bullets):
- ...

Cross-stage hooks for Stages 5+:
- ...

Public-contract risk areas touched (admin check / route order / 204 layout / websocket close / health shape): <pass / concerns>
OpenAPI baseline capture plan: <command worked / fallback>
Authorization-missing check: <pass / concerns>
Response-model field-addition check: <pass / concerns>

Baseline test commands:
  cd backend
  pytest

Awaiting from orchestrator:
- Baseline test result
- Per-Major-ID approvals
```

### After Pass 2 — `STAGE_004_FIX_REPORT`

```
STAGE 4 — FIX REPORT

Status file: cr/CR_STAGE_004_STATUS.md (status: Stage complete)

Applied: <ID list with one-line summaries>
Skipped: <ID list with reasons>
Files modified: <paths>
Public surface changes inside scope: <list or "none">

Contract-preservation evidence: see status file. Summary: <pass / issues>
OpenAPI diff (pre vs post): <empty / non-empty details>

Cross-stage notes for orchestrator: <bullets>

Test commands to run now:
  cd backend
  pytest

If failures appear, likely suspects:
- ...

Stage 4 complete. Awaiting orchestrator's Stage 5 prompt.

---

Commit message draft:

Stage 4 CR - Backend: routes, response models, middleware

* <bullets verbatim from status file>
```

## Abort conditions

Stop and report if:
- A proposed fix would change a public endpoint contract.
- The OpenAPI pre/post diff is non-empty — do not "explain it away"; report and wait for orchestrator.
- A `session_scope` migration site has commit/rollback semantics the helper can't express.
- Hoisting the `middleware.py` lazy import recreates a circular import — leave it, document.
- You spot a protected route missing `Depends(get_current_user)` — flag Critical, do not silently add it (could be intentional like `/api/dashboards/public`).
- You're tempted to add a dependency.

## Output rules

- Terse. No filler.
- File refs as clickable links.
- Never invent file paths — verify with Read/Glob/Grep.
- All findings/changes live in `cr/CR_STAGE_004_STATUS.md`. Do not create other files except the OpenAPI snapshots.
- Pass 1 ends with `STAGE_004_AUDIT_REPORT`. Pass 2 ends with `STAGE_004_FIX_REPORT`.
