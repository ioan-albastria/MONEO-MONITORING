# MONEO Monitoring — Code Review Agent Prompt (Stage 3)

You are running **Stage 3 — Backend services: domain layer (auth, sensors, readings, dashboards, assets, analytics, alerts, notifications)** of a multi-stage code review of the MONEO Monitoring app. You have **read access to the whole repo** but you will **only modify files listed under "Stage scope"** below.

You are working under an **orchestrator** (the user's main Claude session). After each pass, you stop and report back so the orchestrator can craft the next stage's prompt. Do not try to plan or run later stages yourself.

Before doing anything else, read:
- `CLAUDE.md` (root) and `backend/CLAUDE.md`
- `cr/CR_STAGE_001_STATUS.md` and `cr/CR_STAGE_002_STATUS.md` — accumulated context and cross-stage hooks
- Any other `cr/CR_STAGE_*_STATUS.md` files

## Working artifact — single living status file

Maintain exactly one document: **`cr/CR_STAGE_003_STATUS.md`**.

Create it at the start of Pass 1 and keep updating it across both passes. It absorbs findings, duplication map, behavior-affecting items, deferred items, out-of-scope findings, orchestrator decisions, applied changes, contract evidence, cross-stage notes, and the commit-message draft at the end. **Do not create separate findings or out-of-scope files.**

Skeleton (fill sections as they become relevant; mark unfilled sections "_n/a yet_"):

```markdown
# Stage 003 — Backend services: domain layer

**Status:** <Draft | Audit complete | Awaiting decisions | Fixes applied | Stage complete>
**Date:** YYYY-MM-DD
**Files in scope:** <list>

---

## Pass 1 — Audit findings
<table: ID | File:Line | Severity | Category | Finding | Proposed fix | Risk | Touches behavior?>

## Duplication map
<clusters>

## Behavior-affecting — needs explicit approval
<items>

## Deferred / leave-as-is
<items with reasons>

## Out-of-scope findings (for future stages)
<grouped by destination stage>

---

## Orchestrator decisions
- Baseline tests: <green/red>
- Approvals: <per-ID list>

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

## Carry-over context from Stages 1–2 (must respect)

- **`DAL.session_scope()`** is the canonical DB-session helper. Adopt it in this stage's scope wherever `db = SessionLocal(); try/finally db.close()` appears. Known site queued by Stage 2: `services/notification_dispatcher.py:30`. Find any others.
- **`DAL.Annotation`, `DAL.KioskToken`, `DAL.session_scope`** are public re-exports — use the short import form.
- **`init_db`** was removed — do not reintroduce.
- **S1-M3 (Integer vs BigInteger PK mismatch)** is intentionally deferred. Do not change PK column types even if you notice the divergence again.
- **Sensor / Asset** did not adopt `TimestampMixin` (DDL column-order constraint). Do not "fix" them.
- **S2-M1 (APScheduler `max_instances=1` / `coalesce` / `misfire_grace_time`)** was deferred to a dedicated standalone task. Do not touch scheduler job kwargs here.
- **`AlertEvaluator` must remain stateless.** Stage 2 hoisted a single `AlertEvaluator()` instance above the per-sensor loop in `moneo_poller.poll_latest_readings`, relying on the invariant that no instance state is mutated per call and there are no per-sensor caches. **If you refactor `AlertEvaluator` and break that invariant, the Stage 2 change becomes a bug.** Preserve statelessness, or — if a refactor genuinely needs instance state — flag it explicitly in the status file as a behavior-affecting item with a note that `moneo_poller.py:247` (the hoisted-instantiation line) must be reverted to per-iteration instantiation in the same change.
- **`_to_iso`** is now a module-level function in `sync_health_service.py`. Any DRY cluster you find involving ISO formatting in this stage should NOT cross over to import `_to_iso` from `sync_health_service` — that would create a wrong-direction dependency. If the same pattern appears multiple times in domain services, extract a local helper.

## Investigation flag (carried from Stage 2)

`moneo_poller.py:165` passes `sensor.name` as `datasource_id` to `MoneoApiClient.get_processdata()`, where the client docstring says it must be `reference.dataSource.id`. The poller is out of scope for Stage 3 (closed in Stage 2), but `sensor_service.py` and the upsert path that populates `Sensor.moneo_datasource_ref` are in scope.

**Action for this stage:**
1. Read `services/moneo_poller.py:165` and surrounding context — understand how `sensor.name` ends up as the datasource path component today.
2. Read `services/sensor_service.py` and the upsert code that sets `moneo_datasource_ref` — confirm what value is stored there and where it comes from.
3. **Do not change** `moneo_poller.py`. Do not change behavior in `sensor_service.py` based on this finding.
4. In the status file, under a section titled "**Datasource-ID investigation**", record:
   - Where `sensor.name` and `sensor.moneo_datasource_ref` are populated.
   - Whether the two values are always equal in practice (e.g. seeded the same way), making the apparent bug benign.
   - Whether the values can diverge — and if so, what the impact would be.
   - A recommendation: ignore / spin off as a separate task / escalate as a Critical finding.

The orchestrator will decide based on this writeup.

## Mission

Improve code design, clean-code adherence, and especially **eliminate duplication (DRY)** in the stage scope, **without changing behavior**.

## Hard constraints (violating any = abort and report)

1. **Behavior preservation is absolute.** No change to:
   - HTTP endpoint paths, methods, request/response shapes, status codes (these live in routes; services feed them)
   - WebSocket message shapes
   - DB schema
   - Auth flow, JWT issuance/validation, token claims, password hashing (`auth_service` must keep its exact behavior, including bcrypt cost factor)
   - APScheduler job parameters (scheduler files are out of scope this stage)
   - Public function signatures consumed by routes / other modules (unless all call sites in scope are updated in the same stage)
   - Time-bucket aggregation arithmetic in `analytics_service` and `sensor_readings_service` — keep window boundaries, bucket edge inclusivity, and ordering identical
   - Alert-evaluation severity classification and notification routing logic
2. **No new dependencies** without explicit approval.
3. **No commits, no `git add`, no `git push`.** No worktrees.
4. **Do not run tests.** Tell the orchestrator the exact command; they execute.
5. **No reformat-only edits.**

## Clean-code rules (priority order)

1. **DRY — top priority.** Hunt duplication across the 8 services. Extract only with **≥3 real repetitions, same reason to change**, and only if extraction stays readable. Document otherwise.
2. **Dead code** — unused imports, vars, functions, settings.
3. **Naming** — intention-revealing.
4. **Functions** — small, SRP, ~40 line target, ≤3 params. **Don't fragment into long call chains.**
5. **Comments.**
   - Delete stale, redundant, or commented-out code.
   - **Add "why" comments** where intent is non-obvious (alert severity rules, aggregation windowing, time-zone handling, soft-delete behavior, idempotency assumptions).
   - **Comments apply to newly authored files and extracted abstractions too.** When you create a new file or extract a new helper / mixin / class, write a brief module docstring covering:
     - Why the file/abstraction exists
     - Non-obvious invariants future readers must preserve
     - Deliberate exemptions or trade-offs
   - The repo-wide "default to no comments" rule is overridden for newly authored files / extracted abstractions.
6. **Error handling** — no bare `except`, no swallowed exceptions. Validate at boundaries (here: where data enters from routes or upstream services).
7. **Magic values** — extract to module-level constants when reused or meaningful (default page sizes, aggregation bucket sizes, alert cooldown windows, JWT TTL hours if any are hardcoded outside `config`).
8. **Type hints** — complete on public surfaces; eliminate unjustified `Any`.
9. **Async hygiene** — no blocking I/O in async paths; sessions always closed.
10. **Layering** — services hold logic, DAL holds persistence. No raw SQL outside the SQLAlchemy session. No FastAPI imports (e.g. `HTTPException`) leaking into services — if you spot any, flag as Major.
11. **Security** — flag any logging of tokens, password hashes, or PII; flag any unparameterized SQL; flag any place a request body is trusted without validation; flag any timing-attack-prone equality check in auth code.

## Stage scope

**Focus:** auth (JWT issuance, password hashing), sensor CRUD + status, time-series readings retrieval + aggregation, dashboard + widget CRUD, asset CRUD, multi-sensor analytics, alert evaluation, notification dispatch.

**Files in scope (only these may be edited):**
- `backend/services/auth_service.py`
- `backend/services/sensor_service.py`
- `backend/services/sensor_readings_service.py`
- `backend/services/dashboard_service.py`
- `backend/services/asset_service.py`
- `backend/services/analytics_service.py`
- `backend/services/alert_evaluator.py`
- `backend/services/notification_dispatcher.py`

**Do NOT edit in this stage** (record findings as out-of-scope):
- `backend/services/moneo_*` and `backend/services/sync_health_service.py`, `backend/services/demo_seed_service.py`, `backend/services/schedulers/**` — Stage 2 closed
- `backend/routes/**` — Stage 4
- `backend/tests/**` — Stage 5
- `backend/DAL/**`, `backend/main.py`, `backend/config.py`, `backend/middleware.py` — Stage 1 closed (middleware is a Stage 4 concern)

**DRY hot spots to probe specifically:**
- Remaining `db = SessionLocal(); try/finally db.close()` sites (Stage 2 noted `notification_dispatcher.py:30`; find any others).
- Repeated "fetch entity by id, return None if missing" patterns across `sensor_service`, `dashboard_service`, `asset_service`. If they all follow the same shape, a small generic helper may be warranted — but only if it stays readable (no over-engineered Generic[T] gymnastics).
- Repeated ownership / permission checks (e.g. "does this user own this dashboard?") if they appear in service code.
- Time-bucket / aggregation math shared between `sensor_readings_service` and `analytics_service` — likely candidate for a shared helper, but **be very careful**: bucket edge inclusivity and timezone handling are exact-preservation territory.
- Repeated query construction patterns (paginate-by-cursor, paginate-by-offset, filter-by-time-range).
- Repeated alert-state / severity-classification literals between `alert_evaluator` and `notification_dispatcher`.
- Repeated outbox-row construction or notification-channel dispatch boilerplate in `notification_dispatcher`.
- Hardcoded timezone strings or `datetime.utcnow()` calls (deprecated) vs `datetime.now(timezone.utc)`.

## Workflow — two passes

### Pass 1: Audit (read-only)

1. Create `cr/CR_STAGE_003_STATUS.md` with status `Draft`.
2. Populate Pass 1 sections (findings table, duplication map, behavior-affecting, deferred, out-of-scope grouped by destination stage).
3. Complete the **Datasource-ID investigation** section (see above).
4. Set status to `Audit complete`.
5. Stop and report `STAGE_003_AUDIT_REPORT` (format below).

IDs: `S3-C1`, `S3-M1`, `S3-m1`, `S3-n1`.

### Pass 2: Fix (only after orchestrator response)

1. Append orchestrator decisions to the status file under "Orchestrator decisions" and set status to `Fixes applied` once edits begin.
2. If baseline tests are red, **stop** — do not fix on a broken baseline.
3. Apply all `Critical` (non-behavior-touching) + approved `Major` + all `Minor`. Skip `Nit` unless trivial.
4. Edit only files in scope. One concern per edit.
5. For each applied finding, append an `Applied:` entry under "Pass 2 — Applied" in the status file.
6. **Extra guards in the Contract-preservation evidence section:**
   - For any `auth_service` change: confirm JWT claim shape, algorithm, expiry math, and bcrypt verification semantics are byte-identical.
   - For any `analytics_service` / `sensor_readings_service` change: confirm aggregation bucket edges, window inclusivity, ordering, and `None`/empty-result handling are identical.
   - For any `alert_evaluator` change: confirm severity classification thresholds and state transitions are identical, **and explicitly confirm whether the class remains stateless** (so Stage 2's hoist remains correct).
   - For any service whose function is called by a route: list the public functions touched and confirm their signatures and return shapes are unchanged.
7. Append a **Commit message draft** section at the end of the status file. Format:

   ```
   Stage 3 CR - Backend services: domain layer

   * <one bullet per logical change, merging related IDs>
   * ...
   ```

   Rules: imperative verbs (Add/Refactor/Adopt/Remove/Extract/Document), mention new files or new public symbols, copy-paste-ready.
8. Do **not** run tests. Set status to `Stage complete`. Report `STAGE_003_FIX_REPORT`.

## Reports back to orchestrator

### After Pass 1 — `STAGE_003_AUDIT_REPORT`

```
STAGE 3 — AUDIT REPORT

Status file: cr/CR_STAGE_003_STATUS.md (status: Audit complete)

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

Datasource-ID investigation: <recommendation in one sentence>

Surprises / notable observations (≤5 bullets):
- ...

Cross-stage hooks for Stages 4+:
- ...

AlertEvaluator statelessness check (if touched): <pass / concerns>
Auth security check: <pass / concerns>
Aggregation / time-bucket preservation check: <pass / concerns>
Token / secret / PII logging check: <pass / concerns>
FastAPI types leaking into services check: <pass / concerns>

Baseline test commands:
  cd backend
  pytest

Awaiting from orchestrator:
- Baseline test result
- Per-Major-ID approvals
- Decision on Datasource-ID investigation
```

### After Pass 2 — `STAGE_003_FIX_REPORT`

```
STAGE 3 — FIX REPORT

Status file: cr/CR_STAGE_003_STATUS.md (status: Stage complete)

Applied: <ID list with one-line summaries>
Skipped: <ID list with reasons>
Files modified: <paths>
Public surface changes inside scope: <list or "none">

Contract-preservation evidence: see status file. Summary: <pass / issues>
AlertEvaluator statelessness preserved: <yes / details>

Cross-stage notes for orchestrator: <bullets>

Test commands to run now:
  cd backend
  pytest

If failures appear, likely suspects:
- ...

Stage 3 complete. Awaiting orchestrator's Stage 4 prompt.
```

## Abort conditions

Stop and report if:
- A proposed fix would change a public contract you can't verify is internal-only.
- A `session_scope` migration site has commit/rollback semantics the helper can't express.
- A refactor of `alert_evaluator` would break the statelessness invariant — flag, do not apply without explicit orchestrator decision.
- You discover a Critical security issue (secret leak, unparameterized SQL, timing-attack-prone auth check) — flag, do not silently fix if the fix changes behavior.
- The Datasource-ID investigation reveals values can diverge in production — flag as Critical, do not change code.
- Baseline tests are red.
- You're tempted to add a dependency.

## Output rules

- Terse. No filler.
- File refs as clickable links.
- Never invent file paths — verify with Read/Glob/Grep.
- All findings/changes live in `cr/CR_STAGE_003_STATUS.md`. Do not create other files.
- Pass 1 ends with `STAGE_003_AUDIT_REPORT`. Pass 2 ends with `STAGE_003_FIX_REPORT`.
