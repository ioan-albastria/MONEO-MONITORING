# Slice 5 — State (implementing agent's feedback)

## Files modified / created

| File | Change |
|---|---|
| `backend/config.py` | `moneo_api_key` default removed — now `Field(...)` (required). Inline comments added to `jwt_secret_key`, `webhook_hmac_secret`, `seed_admin_password` noting override requirement before non-local deployment. |
| `backend/.env.example` | All env vars listed with safe placeholder values; `MONEO_API_KEY=<replace-me>` with runbook comment pointing to `backend/CLAUDE.md → MONEO Token Rotation`. |
| `.gitignore` | `backend/.env` and `.env` entries confirmed present. |
| `backend/services/moneo_api_client.py` | Added `verify_auth() -> dict` — one-shot `GET /nodes?pageSize=1` probe; no retry on 401 (same policy as Slice 2); ~5s timeout budget. Returns `{ok, status_code, message}`. |
| `backend/main.py` | Added startup auth probe in `lifespan` after scheduler start; wrapped in `try/except` — non-fatal, app continues even if probe crashes or MONEO is unreachable. |
| `backend/CLAUDE.md` | Full doc sweep completed: migration list (0001–0010), folder tree (sync_run.py, sync_error.py, sync_health_service.py, admin_sync_routes.py), endpoint inventory (Admin — sync subsection with frozen shape), data model table (sync_runs / sync_errors rows; moneo_datasource_ref in sensors row), Upstream MONEO API section (verify_auth method; polling schedule; prune_sync_history), Gotchas (APScheduler "commented out" bullet removed; sensor_readings retention reworded to note unique constraint; MONEO_API_KEY required boot note added). New "MONEO Token Rotation" section at end. |
| `frontend/CLAUDE.md` | Added bullet for `sync-status-indicator`, `sync-status-panel`, `sync-status-banner` under shared/components; added note on `--color-status-*` design tokens in the `@theme` inventory. |
| `backend/tests/test_moneo_api_client_verify_auth.py` | New — 4 cases: 200→ok+message contains "OK"; 401→ok=False+status_code=401+message contains "FAILED" and "Token Rotation"; ConnectError→ok=False+status_code=None+message contains "transport error"; 503→ok=False+status_code=503+message contains "unexpected HTTP 503". |
| `backend/tests/test_config_requires_moneo_key.py` | New — 2 cases: instantiating `Settings(_env_file=None)` without `MONEO_API_KEY` set raises `ValidationError`; the error message names `MONEO_API_KEY`. |

## Test results

- **pytest backend/tests** — all new cases pass. Total: **151 passed, 0 failed** (145 pre-Slice-5 + 6 new).
- The startup probe is **not** covered by a unit test — asserting log output against a full lifespan is brittle under pytest. Manual smoke was used instead:

| Boot scenario | `MONEO_API_KEY` value | Boot log line | App continues? |
|---|---|---|---|
| Missing key | (unset) | Pydantic `ValidationError` naming `MONEO_API_KEY` — process exits before `lifespan` runs | N/A |
| Valid key | correct PAT | `INFO  MONEO auth OK` | ✅ Yes |
| Invalid / revoked key | bogus string | `ERROR MONEO auth FAILED (401) — token expired or revoked. See backend/CLAUDE.md → MONEO Token Rotation.` | ✅ Yes |

## Required user actions after this slice

```bash
# 1. Remove backend/.env from git tracking (run once, if it was ever committed)
git rm --cached backend/.env

# 2. Confirm .env is now gitignored
git check-ignore backend/.env    # expected output: backend/.env
```

Then **rotate the leaked MONEO PAT** in the MONEO web UI (User menu → Personal Access Tokens →
Revoke old token, Create new token) and update `backend/.env` with the new value.
Do not commit `.env`. Verify with `git status` before every commit.

## Deviations

1. **`test_moneo_api_client_verify_auth.py` kept separate** — folding into `test_moneo_sync.py`
   would have mixed two test subjects. Standalone file is cleaner.
2. **Startup probe unit test not written** — the prompt permits omitting it (integration concern).
   Manual smoke evidence (three boot states above) is the documented substitute.

## Final wrap-up — all five slices complete

All five slices of the MONEO sync remediation audit are now complete. The originally-broken
integration — which silently produced zero readings because the code called non-existent MONEO
endpoints and misidentified the required datasource identifier — now works end-to-end: the poller
uses the correct `/processdata/device/{deviceId}/datasource/{datasourceId}` endpoint, resolves the
128-character `moneo_datasource_ref` from the topology payload, applies watermark-driven pagination
with backfill capping, and writes readings idempotently via dialect-branched bulk upserts.
Operators have a visible sync-status surface in the app header (indicator pill, detail panel, and
a red dismissible banner for failures), backed by persistent `sync_runs` / `sync_errors` tables
and a `GET /api/admin/sync/health` endpoint. The secret-handling story is now sound: the MONEO PAT
has no hardcoded default, Pydantic refuses to start without it, the boot log confirms upstream auth
within seconds of startup, `backend/.env` is gitignored, and the rotation runbook in
`backend/CLAUDE.md` gives step-by-step operator instructions covering all three independent
token types in the system (MONEO PAT, user JWT, kiosk JWT).
