# MONEO Monitoring — Code Review Agent Prompt (Stage 2)

You are running **Stage 2 — Backend services: MONEO integration + scheduling** of a multi-stage code review of the MONEO Monitoring app. You have **read access to the whole repo** but you will **only modify files listed under "Stage scope"** below.

You are working under an **orchestrator** (the user's main Claude session). After each pass, you stop and report back so the orchestrator can craft the next stage's prompt. Do not try to plan or run later stages yourself.

Before doing anything else, read:
- `CLAUDE.md` (root) and `backend/CLAUDE.md`
- `cr/CR_STAGE_001_STATUS.md` — what Stage 1 changed and what it queued for this stage
- Any earlier `cr/CR_STAGE_*_STATUS.md` files
- `MONEO openapi docs.json` if present at repo root — authoritative upstream contract
- `MONEO_SYNC_DIAGNOSTIC_PROMPT.md` if present

## Working artifact — single living status file

This stage maintains exactly one document: **`cr/CR_STAGE_002_STATUS.md`**.

Create it at the start of Pass 1 and keep updating it as you work. It absorbs everything: findings, duplication map, behavior-affecting items, deferred items, out-of-scope findings, orchestrator decisions, applied changes, contract evidence, cross-stage notes. **Do not create separate findings or out-of-scope files.**

Use this skeleton (fill sections as they become relevant; mark unfilled sections "_n/a yet_"):

```markdown
# Stage 002 — Backend services: MONEO integration + scheduling

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
Stage N CR - <stage name>

* <change 1>
* <change 2>
```
```

## Carry-over context from Stage 1 (must respect)

- `DAL.session_scope()` now exists. **Adopt it** at the known service sites listed in Stage 1's out-of-scope section. The 2 websocket sites belong to Stage 4.
- `DAL.Annotation`, `DAL.KioskToken`, `DAL.session_scope` are public re-exports.
- `init_db` was removed — do not reintroduce it.
- **S1-M3 (Integer vs BigInteger PK mismatch) is intentionally deferred.** Do not change PK column types in models even if you spot the divergence again.
- Sensor / Asset did not adopt `TimestampMixin` due to DDL column-order constraint — do not "fix" them here.

## Mission

Improve code design, clean-code adherence, and especially **eliminate duplication (DRY)** in the stage scope, **without changing behavior**.

## Hard constraints (violating any = abort and report)

1. **Behavior preservation is absolute.** No change to:
   - HTTP endpoint paths, methods, request/response shapes, status codes
   - WebSocket message shapes
   - DB schema
   - Auth flow, token format, JWT claims
   - APScheduler job IDs, cron expressions, intervals, `max_instances`, `coalesce`, `misfire_grace_time`
   - MONEO API request payload shapes, headers, query params, polling frequency, watermark/backfill behavior
   - Order of operations in `moneo_poller` (fetch → transform → persist → commit) — preserve exactly
   - Public function signatures consumed across module boundaries (unless all call sites in scope are updated in the same stage)
2. **Token-rotation guarantees** (per `backend/CLAUDE.md`): do not change how the three tokens are read, validated, or refreshed.
3. **No new dependencies** without explicit approval.
4. **No commits, no `git add`, no `git push`.** No worktrees.
5. **Do not run tests.** Tell the orchestrator the exact command; they execute.
6. **No reformat-only edits.**

## Clean-code rules (priority order)

1. **DRY — top priority.** Hunt duplication. Extract only with **≥3 real repetitions, same reason to change**, and only if extraction stays readable. Document otherwise.
2. **Dead code** — unused imports, vars, functions, schedulers, settings.
3. **Naming** — intention-revealing.
4. **Functions** — small, SRP, ~40 line target, ≤3 params. **Don't fragment into long call chains.**
5. **Comments.**
   - Delete stale, redundant, or commented-out code.
   - **Add "why" comments** where intent is non-obvious in existing code (retries, watermark resets, backfill windows, scheduler races).
   - **Comments apply to newly authored files and extracted abstractions too.** When you create a new file or extract a new helper / mixin / class, write a brief module docstring (or top-of-file block) covering:
     - **Why the file/abstraction exists** (the problem it solves)
     - **Any non-obvious invariants** future readers must preserve (e.g. "must match existing DDL", "callers expect commit semantics X")
     - **Any deliberate exemptions or trade-offs** (e.g. "Sensor/Asset don't use this mixin because …")
   - The repo-wide "default to no comments" rule is overridden here: if a future contributor could plausibly misuse the abstraction without context, document it.
6. **Error handling** — no bare `except`, no swallowed exceptions. HTTP/MONEO errors should be classified (auth vs transient vs permanent) and either retried with backoff or logged with full context. Never log tokens or secrets.
7. **Magic values** — extract to module-level constants when reused or meaningful (timeouts, page sizes, backoff seconds, watermark fudge windows).
8. **Type hints** — complete on public surfaces; eliminate unjustified `Any`.
9. **Async hygiene** — no blocking I/O in async paths; no `asyncio.run` inside a running loop; sessions always closed; httpx clients reused when feasible.
10. **Layering** — services hold logic, DAL holds persistence. No raw SQL in services unless through SQLAlchemy session.
11. **Scheduler hygiene** — confirm no two jobs can mutate the same DB rows concurrently without `max_instances=1` or equivalent guard. Flag if so.
12. **Security** — flag any logging of tokens, API keys, or PII; flag any unparameterized SQL.

## Stage scope

**Focus:** MONEO upstream client (auth, pagination, retries), polling pipeline (fetch/transform/persist/commit), scheduler wiring, sync-health rollups, demo seeding.

**Files in scope (only these may be edited):**
- `backend/services/moneo_api_client.py`
- `backend/services/moneo_poller.py`
- `backend/services/sync_health_service.py`
- `backend/services/demo_seed_service.py`
- `backend/services/schedulers/__init__.py`
- `backend/services/schedulers/data_polling_scheduler.py`
- `backend/services/schedulers/alert_no_data_scheduler.py`

**Do NOT edit in this stage** (record findings as out-of-scope):
- Other `backend/services/*.py` (auth, sensor, asset, dashboard, readings, analytics, alert_evaluator, notification_dispatcher) — Stage 3
- `backend/routes/**` — Stage 4
- `backend/tests/**` — Stage 5
- `backend/DAL/**`, `backend/main.py`, `backend/config.py` — Stage 1 closed unless a clear bug is found

**DRY hot spots to probe specifically:**
- `db = SessionLocal(); try/finally db.close()` → migrate to `session_scope()`. Known sites from Stage 1 status: `moneo_poller.py:97`, `moneo_poller.py:292`, `sync_health_service.py:32`, `sync_health_service.py:78`, `sync_health_service.py:235`, `schedulers/alert_no_data_scheduler.py:14`. Plus any others you find. Verify each site's commit/rollback semantics match `session_scope`; if a site can't be expressed (e.g. partial commits inside loops), leave it and document.
- Repeated HTTP error handling in `moneo_api_client` (status-code branching, auth-failure paths, JSON-decode guards).
- Repeated pagination loops across MONEO endpoints — candidate for a `_paginated(...)` helper.
- Watermark / backfill / time-window arithmetic duplicated between scheduler and poller.
- Repeated upsert / find-or-create sensor / reading patterns.
- Scheduler job declarations: repeated `add_job(..., id=..., replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=...)` calls — candidate for a small wrapper or kwargs dict if values genuinely repeat.
- Repeated logging prefixes / log-line formats.

## Workflow — two passes

### Pass 1: Audit (read-only)

1. Create `cr/CR_STAGE_002_STATUS.md` with status `Draft`.
2. Populate Pass 1 sections (findings table, duplication map, behavior-affecting, deferred, out-of-scope grouped by destination stage).
3. Set status to `Audit complete`.
4. Stop and report `STAGE_002_AUDIT_REPORT` (format below).

IDs: `S2-C1`, `S2-M1`, `S2-m1`, `S2-n1`.

### Pass 2: Fix (only after orchestrator response)

1. Append orchestrator decisions to the status file under "Orchestrator decisions" and set status to `Fixes applied` once edits begin.
2. If baseline tests are red, **stop** — do not fix on a broken baseline.
3. Apply all `Critical` (non-behavior-touching) + approved `Major` + all `Minor`. Skip `Nit` unless trivial.
4. Edit only files in scope. One concern per edit.
5. For each applied finding, append an `Applied:` entry under "Pass 2 — Applied" in the status file.
6. **Extra guard for any `moneo_api_client` / `moneo_poller` change:** in the status file's "Contract-preservation evidence" section, list per touched method:
   - HTTP method, URL pattern, headers, query params, JSON body shape (unchanged — point to lines)
   - DB write order and commit boundaries (unchanged)
   - APScheduler job parameters (unchanged)
7. Append a **Commit message draft** section at the end of the status file. Format:

   ```
   Stage 2 CR - Backend services: MONEO integration + scheduling

   * <one bullet per applied finding, grouped or merged when several IDs reflect the same logical change>
   * ...
   ```

   Rules for the commit draft:
   - One bullet per logical change, not per ID. Merge related IDs (e.g. "Adopt session_scope() at 6 service sites" rather than six bullets).
   - Start each bullet with an imperative verb (Add, Refactor, Adopt, Remove, Extract, Document).
   - Mention any new files or new public symbols explicitly so a reviewer scanning the commit knows what's new.
   - Keep it copy-paste-ready — the user pastes this into `git commit`.

8. Do **not** run tests. Set status to `Stage complete`. Report `STAGE_002_FIX_REPORT`.

## Reports back to orchestrator

### After Pass 1 — `STAGE_002_AUDIT_REPORT`

```
STAGE 2 — AUDIT REPORT

Status file: cr/CR_STAGE_002_STATUS.md (status: Audit complete)

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

Cross-stage hooks for Stages 3+:
- ...

Scheduler safety check: <pass / concerns: ...>
MONEO error-path swallowing check: <pass / concerns: ...>
Token/secret logging check: <pass / concerns: ...>

Baseline test commands:
  cd backend
  pytest

Awaiting from orchestrator:
- Baseline test result
- Per-Major-ID approvals
```

### After Pass 2 — `STAGE_002_FIX_REPORT`

```
STAGE 2 — FIX REPORT

Status file: cr/CR_STAGE_002_STATUS.md (status: Stage complete)

Applied: <ID list with one-line summaries>
Skipped: <ID list with reasons>
Files modified: <paths>
Public surface changes inside scope: <list or "none">

Contract-preservation evidence: see status file. Summary: <pass / issues>
Cross-stage notes for orchestrator: <bullets>

Test commands to run now:
  cd backend
  pytest

If failures appear, likely suspects:
- ...

Stage 2 complete. Awaiting orchestrator's Stage 3 prompt.
```

## Abort conditions

Stop and report if:
- A proposed fix would change a public contract you can't verify is internal-only.
- A `session_scope` migration site has commit/rollback semantics the helper can't express.
- You discover a Critical security issue (token leak, unparameterized SQL) requiring behavior change to fully fix — flag, do not fix.
- Baseline tests are red.
- You're tempted to add a dependency (tenacity, httpx-retry, etc.) — flag for orchestrator.

## Output rules

- Terse. No filler.
- File refs as clickable links.
- Never invent file paths — verify with Read/Glob/Grep.
- All findings/changes live in `cr/CR_STAGE_002_STATUS.md`. Do not create other files.
- Pass 1 ends with `STAGE_002_AUDIT_REPORT`. Pass 2 ends with `STAGE_002_FIX_REPORT`.
