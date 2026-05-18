# Slice 5 — Prompt (as delivered to the implementing session)

Final slice. Token hygiene + rotation runbook + the deferred doc
sweep that Slices 2 and 3 punted to "a later doc-pass". Backend-only.

---

You are implementing Slice 5 — the final slice — of the MONEO sync
remediation plan. The plan is in ./MONEO_SYNC_AUDIT.md — read
"P4. Token lifecycle + secret hygiene" and "Slice 5" under
Implementation plan. Slices 1–4 have landed.

GOAL OF THIS SLICE
Three deliverables:
(a) Secret hygiene — no MONEO PAT anywhere in the repo; no default
    value in code; `.env` gitignored; `.env.example` accurate.
(b) Auth visibility — boot-time probe that logs MONEO auth status
    once at startup, and an explicit failure message that points the
    reader at the runbook.
(c) Manual rotation runbook + the deferred doc sweep for backend
    CLAUDE.md (and a small note in frontend CLAUDE.md for the new
    Slice 4 components).

No backend route contract changes. The /api/admin/sync/health shape
is FROZEN by Slice 4 — do not add fields to it. MONEO 401s already
surface through the existing sync_errors → indicator → banner path
that Slices 3+4 built; this slice does not need to re-route them.

CONTEXT FROM SLICE 4 (carry-forwards / clarifications)
- The frontend user JWT, the kiosk JWT, and the MONEO PAT are three
  independent tokens with separate lifecycles. The runbook must say
  this in plain English so a future reader doesn't conflate them.
- The auth interceptor's redirect-on-401 behaviour is correct for
  the user JWT and is NOT changed by this slice. Do not touch
  frontend/src/app/core/auth/auth-interceptor.service.ts.
- The kiosk token in sessionStorage is also unaffected. Do not
  touch KioskService.
- Pre-existing Karma failures (sensor-status.spec.ts × 4,
  app.spec.ts × 1) are not in scope.

SCOPE (do all of this, nothing more)

1. backend/config.py — remove the MONEO_API_KEY default
   - Today line 8 has the actual leaked token as the default value.
     Change to:
       moneo_api_key: str = Field(..., description="MONEO platform API Personal Access Token. Required.")
     so Pydantic Settings raises a clear ValidationError at startup
     when MONEO_API_KEY is unset. Add a short comment above the
     field referencing the rotation runbook.
   - Also pin every other secret-shaped field (jwt_secret_key,
     webhook_hmac_secret, seed_admin_password) — but DO NOT remove
     their defaults, only add an inline comment noting "must be
     overridden in .env before any non-local deployment" if one
     isn't there. We want to fail-fast on the upstream token, not
     on local development.

2. backend/.env.example — make it the canonical template
   - Ensure all of these are listed with safe placeholder values
     (replace the real PAT with `<replace-me>` exactly):
       DATABASE_URL=postgresql://user:password@localhost/moneo_monitoring
       MONEO_API_BASE_URL=https://ifm-ro-sales.w-eu.moneo.ifm/api/platform/v1
       MONEO_API_KEY=<replace-me>            # See backend/CLAUDE.md → MONEO Token Rotation
       JWT_SECRET_KEY=change_this_to_a_long_random_secret
       JWT_ALGORITHM=HS256
       JWT_ACCESS_TOKEN_EXPIRE_HOURS=24
       REDIS_URL=redis://localhost:6379
       SENSOR_POLL_INTERVAL_SECONDS=300
       MAX_BACKFILL_HOURS=24
       MONEO_POLL_MAX_PAGES_PER_SENSOR=100
       SYNC_HISTORY_RETENTION_DAYS=90
       ALERT_EVALUATION_ENABLED=true
       NOTIFICATION_DISPATCH_ENABLED=true
       DEBUG=true
       ALLOWED_ORIGINS=["http://localhost:4200","http://localhost:3000"]
       SEED_ADMIN_USERNAME=admin
       SEED_ADMIN_EMAIL=admin@example.com
       SEED_ADMIN_PASSWORD=changeme
     Verify each env var is actually read in backend/config.py
     before listing it — do not invent variables.
   - The file already exists; edit it in place rather than
     replacing wholesale.

3. backend/.env — remove from git tracking
   - Add `backend/.env` (and `.env` as a defensive double-match) to
     the root `.gitignore`. The root `/tmp/` entry from Slice 1 +
     audit stays.
   - You CANNOT run git commands per the ground rules. In your
     deliverable, give the user the exact command to run:
         git rm --cached backend/.env
     plus a one-line reminder that the leaked PAT must be rotated
     in the MONEO UI (out-of-band, user action). Do not delete the
     file from disk — local development needs it.

4. backend/services/moneo_api_client.py — add a verify_auth probe
   - New method:
       async def verify_auth(self) -> dict
     Issues `GET /nodes?pageSize=1`. Returns one of:
       {"ok": True,  "status_code": 200, "message": "MONEO auth OK"}
       {"ok": False, "status_code": 401, "message": "MONEO auth FAILED (401) — token expired or revoked. See backend/CLAUDE.md → MONEO Token Rotation."}
       {"ok": False, "status_code": <code>, "message": "MONEO probe got unexpected HTTP <code>: <truncated body>"}
       {"ok": False, "status_code": None,  "message": "MONEO probe transport error: <type>: <message>"}
     The probe must NOT retry on 401 (same policy as Slice 2).
     Total budget: one HTTP call, ~5s timeout cap.
   - Do NOT change the existing get_processdata / get_devices behaviour.

5. backend/main.py — call the probe once at startup
   - In the lifespan startup phase, AFTER the scheduler starts:
       try:
           client = MoneoApiClient()
           try:
               result = await asyncio.wait_for(client.verify_auth(), timeout=5)
           finally:
               await client.close()
           if result["ok"]:
               logger.info(result["message"])
           else:
               logger.error(result["message"])
       except Exception as e:
           logger.error("MONEO auth probe crashed: %s", e)
     Do NOT fail startup on a failed probe. The app should still
     serve auth + non-MONEO routes so an admin can read the health
     surface and the runbook.
   - Import asyncio at the top if not already imported.

6. backend/CLAUDE.md — doc sweep + new "MONEO Token Rotation" section

   Update the existing inventory; do not rewrite the file. Specific
   edits:

   a. Status — FROZEN section: no change.

   b. Migrations section: update the migration list to reflect the
      current chain through 0010 (Slice 3 STATE called out the
      Slice-1 migration was renumbered to 0009 and Slice 3's is
      0010; verify by listing backend/migrations/versions/ and
      list every file with a one-line purpose).

   c. Folder structure tree: add the new files
      - DAL/models/sync_run.py
      - DAL/models/sync_error.py
      - services/sync_health_service.py
      - routes/admin_sync_routes.py

   d. Endpoint inventory: add a new "Admin — sync" subsection
      | Method | Path                       | Auth         | Purpose          | Response |
      | GET    | /api/admin/sync/health     | Bearer+admin | Sync health JSON | (inline shape) |
      And include the paste of the Slice 3 STATE file's get_health
      JSON shape verbatim (it is the authoritative contract).

   e. Data model table: add two new rows for sync_runs and
      sync_errors. Add `moneo_datasource_ref` to the sensors row's
      "Key columns" list.

   f. Upstream MONEO API section: rewrite to reflect the
      post-Slice-1/2/3 state:
      - Client methods: get_devices, get_processdata, verify_auth,
        raw_get, raw_get_response (drop the deleted methods).
      - Polling schedule: poll_latest_readings runs every
        SENSOR_POLL_INTERVAL_SECONDS, uses watermark from
        sensor.last_seen_at, paginates up to
        MONEO_POLL_MAX_PAGES_PER_SENSOR pages at page_size=500;
        backfill capped at MAX_BACKFILL_HOURS.
      - sync_sensor_metadata runs every 6h; persists
        moneo_datasource_ref alongside moneo_sensor_id.
      - prune_sync_history runs daily at 03:00, retains
        SYNC_HISTORY_RETENTION_DAYS.

   g. Caching section: no change.

   h. Gotchas section:
      - REMOVE the "APScheduler start is currently commented out"
        bullet — it is no longer true (verify in
        services/schedulers/data_polling_scheduler.py).
      - REPHRASE "sensor_readings grows unbounded" to note that a
        unique constraint exists on (sensor_id, timestamp) since
        Slice 1, but there is still no row-level retention.
      - ADD a bullet: "MONEO_API_KEY is required at boot — Pydantic
        will refuse to start without it. The boot log line
        `MONEO auth OK / FAILED` confirms upstream credentials."

   i. NEW SECTION at the end of the file: "MONEO Token Rotation"

      Recommended cadence: as needed (immediately on suspected leak
      or 401s observed in sync_errors), and at least quarterly.

      Content checklist for the section:
      - Why the token rotates: PAT is bound to the issuing user's
        permissions; no refresh-token flow exists.
      - Three independent tokens — do not conflate:
          * MONEO PAT (this runbook) — backend-only, in .env.
          * User JWT issued by /api/auth/login — frontend,
            localStorage, 24h TTL, no refresh.
          * Kiosk JWT — frontend sessionStorage, has its own
            expires_at on the kiosk_tokens row.
      - When to rotate:
          * Boot log shows "MONEO auth FAILED (401)".
          * sync_errors rows accumulate with kind='http_401'.
          * /api/admin/sync/health → derived_status='failed' with
            last_error_kind='http_401' on either source.
          * Suspected leak (token appeared in chat, screenshot,
            commit, etc.).
          * Quarterly hygiene rotation.
      - How to rotate (step-by-step):
          1. Mint a new PAT in the MONEO web UI (mention the page,
             a generic path is fine: "User menu → Personal Access
             Tokens → Create").
          2. Edit backend/.env locally — replace MONEO_API_KEY
             value. Do not commit; .env is gitignored.
          3. Restart the backend service.
          4. Verify the boot log shows "MONEO auth OK".
          5. Verify via `curl -H "Authorization: Bearer <admin-jwt>"
             http://localhost:8000/api/admin/sync/health` returns
             derived_status='healthy' for moneo.readings within
             one poll cycle.
          6. Revoke the OLD PAT in the MONEO UI.
      - Don't:
          * Don't commit .env (gitignored, but check `git status`).
          * Don't paste the token in chat, screenshots, or logs.
          * Don't reuse a PAT across environments.
      - If rotation breaks: roll back by restoring the previous
        token in .env and restart. Investigate the new token before
        retrying.

7. frontend/CLAUDE.md — small update only
   - Under shared/components (or whatever the equivalent section
     is), add a one-line bullet noting the three new components:
       - sync-status-indicator
       - sync-status-panel
       - sync-status-banner
     pointing the reader at frontend/src/app/core/services/sync-health.service.ts
     for the data contract.
   - Under styles.css / @theme inventory (or design tokens), add
     a one-line note about the four new --color-status-* tokens
     introduced in Slice 4.
   - Do NOT restructure the file; one bullet under each existing
     section.

8. backend/tests/
   - test_moneo_api_client_verify_auth.py (or fold into
     test_moneo_sync.py — your call):
     * Stub /nodes?pageSize=1 returning 200 → ok=True, message
       contains "OK".
     * Stub returning 401 → ok=False, status_code=401, message
       contains "FAILED" and "Token Rotation".
     * Stub raising ConnectError → ok=False, status_code=None,
       message contains "transport error".
     * Stub returning 503 → ok=False, status_code=503, message
       contains "unexpected HTTP 503".
   - test_config_requires_moneo_key.py:
     * Instantiating Settings(_env_file=None) without
       MONEO_API_KEY environment variable raises ValidationError.
     * The error message names MONEO_API_KEY (so the reader
       knows exactly what to fix).
   - Do NOT add a test that asserts the lifespan startup probe
     runs — that's an integration concern; one log assertion under
     pytest is brittle. Document this in the deliverable.

OUT OF SCOPE (do NOT touch)
- No new endpoints; no changes to existing endpoint contracts.
- No frontend code changes (only frontend/CLAUDE.md updates per
  item 7).
- No changes to auth-interceptor, KioskService, or the user-JWT
  refresh flow (none exists; correct as-is).
- No new schema, no migration.
- No alert subsystem changes.
- No single-instance lock, no circuit breaker.
- The pre-existing Karma failures Slice 4 flagged stay as-is.

GROUND RULES
- No git add / commit / push. The user runs all git commands.
- No worktrees.
- Do not write the leaked PAT into any file you produce — including
  test fixtures, comments, or commit messages. Use `<replace-me>`
  or environment variables exclusively.

SUCCESS CRITERIA
- pytest backend/tests passes, including new cases.
- Starting the backend with MONEO_API_KEY unset raises a clear
  ValidationError naming MONEO_API_KEY at startup (manual test;
  describe steps in the deliverable).
- Starting the backend with a valid MONEO_API_KEY logs
  "MONEO auth OK" within seconds of boot.
- Starting with a bogus MONEO_API_KEY logs "MONEO auth FAILED
  (401) — ..." within seconds of boot, but the app continues to
  serve / does not crash.
- `grep -r "<the leaked PAT value>" .` returns no hits in tracked
  files (do this check in your deliverable using a redacted
  reference — don't paste the actual token).
- `git check-ignore backend/.env` succeeds (i.e. .env is now
  ignored).

DELIVERABLE
A summary report covering:
- The exact git command(s) the user must run after this slice
  (git rm --cached backend/.env, then rotate the leaked PAT in
  the MONEO UI). Spell them out.
- The list of backend/CLAUDE.md sections you edited or added.
- The list of files newly tracked / no-longer-tracked.
- Manual smoke evidence for the three boot-time states (missing,
  valid, invalid token). Redact the actual token value in any
  pasted output.
- Test results and any deviations.
- A FINAL wrap-up paragraph: 3–5 sentences confirming that all
  five slices are complete, that the originally-broken integration
  now works end-to-end, that operators have a visible status
  surface, and that the secret-handling story is sound. This is
  the closing report for the entire audit remediation.

When you are done, STOP. There is no Slice 6. Hand the wrap-up
back to the user.
