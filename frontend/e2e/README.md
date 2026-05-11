# MONEO E2E Tests — Setup Guide

## Prerequisites

### 1. Backend (manual seed required)

Start the backend on port 8000:

```powershell
cd backend
pip install -r requirements.txt   # if not already done
uvicorn main:app --host 0.0.0.0 --port 8000
```

The suite expects:

| Item | Value |
|---|---|
| Admin credentials | `admin` / `changeme` |
| Sensors | ≥ 3 sensors present in the database |
| Recent readings | At least one sensor with readings in the last 24 h |

If the backend has no user-creation endpoint accessible without auth, the admin account must be seeded directly in the database before running the tests. Example (adjust to your DB):

```bash
# SQLite example — adjust table/column names to match your schema
sqlite3 backend/moneo.db "INSERT OR IGNORE INTO users (username, password_hash, is_active) VALUES ('admin', '<bcrypt-hash-of-changeme>', 1);"
```

### 2. Frontend

The Playwright `webServer` block in `playwright.config.ts` starts `ng serve` automatically when you run `npm run e2e`. No manual step needed.

If `ng serve` is already running on port 4200, Playwright will reuse it (`reuseExistingServer: true`).

## Running the tests

```powershell
cd frontend
npm run e2e
# or for headed mode:
npx playwright test --headed
# single spec file:
npx playwright test e2e/auth.spec.ts
```

## Interpreting results

- `PASS` — behavior matches the spec.
- `FAIL` — check `playwright-report/index.html` for screenshots and traces.
- `SKIP` — test was skipped with a reason (typically: no live WebSocket data arrived within the timeout, or a known limitation such as requiring a second user account).

See `TRIAGE.md` for the full run results and failure hypotheses.
