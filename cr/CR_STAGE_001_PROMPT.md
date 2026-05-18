# MONEO Monitoring — Code Review Agent Prompt (Stage 1)

> **Note:** This file is a historical record of the prompt used for Stage 1. The artifact layout has since changed — Stage 2 onward uses a single `cr/CR_STAGE_XXX_STATUS.md` per stage (no separate findings / out-of-scope files). Kept here for traceability.

You are running **Stage 1 — Backend: config, bootstrap, DAL, migrations** of a multi-stage code review of the MONEO Monitoring app (FastAPI backend + Angular 20 frontend). You have **read access to the whole repo** but you will **only modify files listed under "Stage scope"** below.

You are working under an **orchestrator** (the user's main Claude session). After each pass, you stop and report back so the orchestrator can craft the next stage's prompt. Do not try to plan or run later stages yourself.

Before doing anything else, read:
- `CLAUDE.md` (root)
- `backend/CLAUDE.md`
- `cr/` folder if it exists (prior stages and out-of-scope notes)

## Mission

Improve code design, clean-code adherence, and especially **eliminate duplication (DRY)** in the stage scope, **without changing behavior**. This is a sensitive refactor — correctness over cleverness.

## Hard constraints (violating any = abort and report)

1. **Behavior preservation is absolute.** No change to:
   - HTTP endpoint paths, methods, request/response shapes, status codes
   - WebSocket message shapes or topic names
   - DB schema (columns, types, constraints, indexes) unless the orchestrator explicitly approves a migration
   - Auth flow, token format, JWT claims
   - Public function signatures consumed across module boundaries (unless all call sites are in scope and updated in the same stage)
2. **No new dependencies** (Python or npm) without explicit approval.
3. **No commits, no `git add`, no `git push`.** User controls all VCS.
4. **No worktrees.** Edit in the main repo.
5. **Do not run tests.** Tell the user the exact command; they execute.
6. **No reformat-only edits.** Touch a line only if there is a real finding on it.

## Clean-code rules (priority order)

1. **DRY — top priority.** Extract only when there are **≥3 real repetitions with the same reason to change**, and only when the extraction does **not** create a long, hard-to-follow call chain. If extraction would obfuscate, document the duplication in findings but leave the code alone.
2. **Dead code** — remove unused imports, vars, functions, endpoints, settings.
3. **Naming** — intention-revealing; no `data`/`info`/`manager`/`helper` without a meaningful qualifier.
4. **Functions** — small, single responsibility, ~40 line target, ≤3 params (use dataclass/Pydantic for more). **Only split if the result is still readable** — do not fragment into long call chains.
5. **Comments** — delete stale, redundant, or commented-out code. **Add missing "why" comments** where intent is non-obvious (hidden constraints, subtle invariants, workarounds).
6. **Error handling** — no bare `except`, no swallowed exceptions, no `except: pass`. Validate at boundaries only.
7. **Magic values** — extract to module-level constants when reused or semantically meaningful.
8. **Type hints** — complete on public surfaces; eliminate unjustified `Any`.
9. **Async hygiene** — no blocking I/O in async paths; no `asyncio.run` inside a running loop; sessions always closed.
10. **Layering** — routes thin, services hold logic, DAL holds persistence. No SQL in routes, no FastAPI types in services. (Stage 1 mostly affects DAL boundary.)
11. **Security** — flag any JWT/secret leakage in logs or error responses; flag non-parameterized SQL.

## Stage scope

**Focus:** centralized settings (no scattered `os.getenv`), application startup order and lifecycle, DB session lifecycle, SQLAlchemy model layering and reuse, Alembic chain integrity.

**Files in scope (only these may be edited):**
- `backend/main.py`
- `backend/config.py` and any other `backend/config*.py` / `backend/settings*.py`
- `backend/DAL/**` (models, session, base)
- `backend/alembic.ini`
- `backend/migrations/**`

**Do NOT edit in this stage** (record findings as out-of-scope):
- `backend/routes/**`, `backend/services/**`, `backend/tests/**`, anything under `frontend/`

**DRY hot spots to probe specifically:**
- Repeated DB session boilerplate (`with`/`yield` patterns, commit/rollback) across DAL helpers
- Repeated SQLAlchemy column patterns (`created_at`/`updated_at`, soft-delete, `id`) that should be mixins
- Duplicated enum/string constants between models and elsewhere (record only — fix later if it crosses scope)
- Duplicated config access — any `os.getenv` outside the settings object
- Migration files: repeated helper functions, duplicated table/column definitions
- Repeated startup hooks or duplicated logging setup in `main.py`

## Workflow — two passes

### Pass 1: Audit (read-only)

Produce `cr/CR_FINDINGS_STAGE_1.md` with:

1. **Header** — stage name, files audited, date, brief description of what's in the stage scope.
2. **Findings table** — one row per issue:

   | ID | File:Line | Severity | Category | Finding | Proposed fix | Risk | Touches behavior? |

   - **Severity:** `Critical` · `Major` · `Minor` · `Nit`.
   - **Category:** `DRY` · `DeadCode` · `Naming` · `Function` · `Comment` · `Error` · `Magic` · `Types` · `Async` · `Layering` · `Security` · `Other`.
   - **Touches behavior?** must be `No` for any item you intend to apply. `Yes` items go to a separate "Behavior-affecting — needs explicit approval" section, **never** auto-applied.
   - IDs: `S1-C1`, `S1-M1`, `S1-m1` (minor), `S1-n1` (nit).

3. **Duplication map** — dedicated subsection: each cluster lists all locations, the proposed single home, and a short justification that extraction won't obfuscate.

4. **Deferred / leave-as-is** — duplications/smells intentionally not flagged for fix, with reasons.

5. **Out-of-scope findings** — append to `cr/CR_OUT_OF_SCOPE.md` (create if missing). Don't lose them; later stages will pick them up.

6. **Stop and report to orchestrator** (format below).

### Pass 2: Fix (only after orchestrator response)

The orchestrator will respond with:
- Baseline test result (green/red + failures)
- Per-Major-ID approvals (e.g., `S1-M3 ✓, S1-M7 ✗, S1-M9 ✓`)

If baseline tests are red, **stop** — do not fix on a broken baseline. Report and wait.

If green:
1. Apply all `Critical` (non-behavior-touching) + all approved `Major` + all `Minor`. Skip `Nit` unless trivial.
2. Edit only files in scope. One concern per edit.
3. For each applied finding, append an `Applied:` line to the findings file with a one-sentence summary of what changed.
4. Do **not** run tests. Report back to orchestrator (format below).

## Reports back to orchestrator

### After Pass 1 — `STAGE_1_AUDIT_REPORT`

```
STAGE 1 — AUDIT REPORT

Findings file: cr/CR_FINDINGS_STAGE_1.md
Out-of-scope file: cr/CR_OUT_OF_SCOPE.md (N new entries)

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

Surprises / notable observations about the codebase (≤5 bullets):
- ...

Cross-stage hooks (things later stages must know about):
- ...

Baseline test commands to run before Pass 2:
  cd backend
  pytest
  # Throwaway-DB Alembic check (use a temp sqlite or test DB):
  alembic upgrade head

Awaiting from orchestrator:
- Baseline test result (green/red)
- Per-Major-ID approval list (e.g., S1-M1 ✓, S1-M2 ✗, ...)
```

### After Pass 2 — `STAGE_1_FIX_REPORT`

```
STAGE 1 — FIX REPORT

Applied:
- S1-C1: <short summary>
- S1-M3: <short summary>
- S1-m1: <short summary>
...

Skipped (with reason):
- S1-M7: rejected by orchestrator
- S1-n2: nit, no clear benefit
...

Files modified:
- <path>
- <path>

Public surface changes inside scope (call sites all updated):
- <function/symbol> — <old → new>  (or "none")

Cross-stage notes for the orchestrator (things that may affect Stage 2+):
- ...

Test commands to run now:
  cd backend
  pytest
  alembic upgrade head    # throwaway DB

If failures appear, likely suspects:
- <edit X may have affected Y>

Stage 1 complete. Awaiting orchestrator's Stage 2 prompt.
```

## Abort conditions

Stop and report if:
- A proposed fix would change a public contract you can't verify is internal-only.
- A duplication cluster spans stage boundaries and extracting it now forces edits outside scope (record in out-of-scope, do not edit).
- You find a Critical security issue that requires a behavior change — flag, do not fix.
- Baseline tests are red.
- You're tempted to add a dependency.

## Output rules

- Be terse. No filler, no recap of these instructions.
- File refs as clickable links: `[backend/main.py:42](backend/main.py:42)`.
- Never invent file paths — verify with Read/Glob/Grep first.
- Pass 1 ends with the `STAGE_1_AUDIT_REPORT`. Pass 2 ends with the `STAGE_1_FIX_REPORT`. Nothing after.

---

## Post-stage addendum (orchestrator note)

After Stage 1 ran, two follow-up adjustments were made by the orchestrator:

1. **`_mixins.py` documentation pass.** The Stage 1 agent created `DAL/models/_mixins.py` without a module docstring. The orchestrator added a comprehensive docstring explaining why the file exists, the naive-vs-tz-aware variant invariant, the byte-equivalence requirement, and the deliberate Sensor/Asset exemption. **Rule change for all subsequent stages:** when an agent creates a new file or extracts a new abstraction, it must write a docstring covering purpose, invariants, and exemptions. The "default to no comments" repo rule is overridden for newly authored files / extracted abstractions.

2. **Artifact layout change.** The separate `CR_FINDINGS_STAGE_N.md` + `CR_OUT_OF_SCOPE.md` files used here are superseded from Stage 2 onward by a single `cr/CR_STAGE_XXX_STATUS.md` per stage. Stage 1's findings and out-of-scope content have been consolidated into `cr/CR_STAGE_001_STATUS.md`.
