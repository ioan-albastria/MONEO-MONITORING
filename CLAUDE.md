# MONEO Monitoring Dashboard

## What this is
Real-time sensor dashboard for IFM MONEO industrial sensors. Operators log in, build
gridster-based dashboards from four widget types (line chart, bar chart, gauge, stat card),
and watch live readings stream in over WebSocket. Backend polls the upstream MONEO/IFM API
every 5 minutes; frontend consumes the results via REST + WebSocket.

## Repository layout

| Path | Purpose |
|---|---|
| `backend/` | FastAPI 0.115+ API server, PostgreSQL via SQLAlchemy 2.0, JWT auth, MONEO API client |
| `frontend/` | Angular 20 SPA (NgModules), gridster dashboard, ApexCharts, Tailwind v4, Playwright e2e |
| `frontend/e2e/` | Playwright end-to-end tests (52 cases across 8 files) |
| `frontend/src/` | Angular source — see `frontend/CLAUDE.md` for full breakdown |
| `backend/DAL/` | SQLAlchemy models + db session |
| `backend/routes/` | FastAPI route handlers |
| `backend/services/` | Business logic + MONEO API client |

## When working on …

| Task | Read |
|---|---|
| Frontend component / template / CSS | `frontend/CLAUDE.md` |
| Auth flow, guards, interceptors | `frontend/CLAUDE.md` → Auth flow section |
| Dashboard layout, gridster, widget CRUD | `frontend/CLAUDE.md` → Dashboard module section |
| Widget rendering (charts, gauge, stat card) | `frontend/CLAUDE.md` → Widget system section |
| Theme / dark-light / density | `frontend/CLAUDE.md` → Theme + density section |
| WebSocket / live updates | `frontend/CLAUDE.md` → Realtime section |
| Backend endpoints, data model, auth | `backend/CLAUDE.md` |
| Upstream MONEO/IFM integration | `backend/CLAUDE.md` → Upstream MONEO API section |
| Full-stack feature (e.g. new widget type) | Read **both** area files |

## Ground rules

- **Backend is frozen.** No endpoint or schema changes unless the user explicitly approves.
  If a frontend need seems to require a backend change, flag it and wait.
- **NgModules only.** This project uses traditional Angular NgModules with `standalone: false`.
  Do not generate or suggest standalone components.
- **Tailwind v4 CSS-first.** No `tailwind.config.js`. All tokens live in the `@theme` block
  in `frontend/src/styles.css`. Do not add a config file.
- **No auto-commit.** Never run `git add`, `git commit`, or `git push`. The user controls all
  version control operations.
- **No worktrees.** Edit directly in the main repo.

## Reference documents

| File | Purpose |
|---|---|
| `FRONTEND_REBUILD_INSTRUCTIONS.md` | Authoritative spec for iteration 1 — architecture, auth, component patterns, grid config, widget defaults |
| `IMPLEMENTATION_INSTRUCTIONS.md` | Broader project spec covering backend + frontend; foundation for the rebuild instructions |
| `EXPANSION_PLAN.md` | Iteration 2 roadmap — TRUST/LEVERAGE/REACH/SUPPORT tiers, slice ordering |
| `frontend/STYLE_AUDIT.md` | Full audit of the FMC250 design system adopted here (tokens, fonts, layers) |
| `frontend/STYLE_PATCH_REPORT.md` | Record of Tailwind v4 migration: what changed, known CSS bugs, test status |
