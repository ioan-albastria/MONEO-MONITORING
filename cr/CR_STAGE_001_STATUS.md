# Stage 001 — Backend: config, bootstrap, DAL, migrations

**Status:** Stage complete
**Date:** 2026-05-18
**Files audited:**
- [backend/main.py](backend/main.py)
- [backend/config.py](backend/config.py)
- [backend/alembic.ini](backend/alembic.ini)
- [backend/migrations/env.py](backend/migrations/env.py)
- [backend/migrations/versions/0001_initial_schema.py](backend/migrations/versions/0001_initial_schema.py) through [0010_sync_runs.py](backend/migrations/versions/0010_sync_runs.py)
- [backend/DAL/__init__.py](backend/DAL/__init__.py)
- [backend/DAL/db_context.py](backend/DAL/db_context.py)
- [backend/DAL/models/](backend/DAL/models/) — all 13 model modules + `annotation.py`, `kiosk_token.py`

**Scope:** centralized settings, app startup lifecycle, DB session/engine setup, SQLAlchemy model layering, Alembic chain integrity.

---

## Pass 1 — Audit findings

| ID | File:Line | Severity | Category | Finding | Proposed fix | Risk | Touches behavior? |
|---|---|---|---|---|---|---|---|
| S1-M1 | [DAL/models/*](backend/DAL/models/) (≥11 occurrences) | Major | DRY | `created_at`/`updated_at` `mapped_column(... default=lambda: datetime.now(timezone.utc), onupdate=...)` duplicated across nearly every model. Several variants in tz-awareness (`DateTime` vs `DateTime(timezone=True)`). | Introduce `TimestampMixin` (+ `TimezoneTimestampMixin` if needed) in new `DAL/models/_mixins.py`. **Do not change** the underlying column type per model. | Low if mixin produces identical `Column` objects per model. Must verify table-by-table DDL byte-equivalence. | No |
| S1-M2 | [DAL/models/sensor.py:30](backend/DAL/models/sensor.py:30), [DAL/models/asset.py:21](backend/DAL/models/asset.py:21) | Major | DRY | `extra_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)` duplicated. Only 2 occurrences — below ≥3 threshold. | Leave as-is. | n/a | n/a |
| S1-M3 | [DAL/models/alert_rule.py:12](backend/DAL/models/alert_rule.py:12), [alert_event.py:12](backend/DAL/models/alert_event.py:12), [alert_route.py:12](backend/DAL/models/alert_route.py:12), [alert_notification_outbox.py:12](backend/DAL/models/alert_notification_outbox.py:12), [sync_run.py:21](backend/DAL/models/sync_run.py:21), [sync_error.py:34](backend/DAL/models/sync_error.py:34) | Major | Types | Model declares `id: Mapped[int] = mapped_column(Integer, primary_key=True)` but migrations 0004/0010 create the column as `BigInteger`. Autogenerate diffs are wrong; `sync_run.py`/`sync_error.py` carry explicit comments documenting the SQLite-test compatibility trade-off. | Change `Integer` → `BigInteger`. | Medium — SQLite autoincrement compatibility with BIGINT could break the test fixture. | **Yes** — needs explicit approval |
| S1-M4 | [backend/main.py:39-83](backend/main.py:39) | Major | Function | `lifespan()` mixes four startup concerns (migrations, seeding, scheduler, MONEO probe) + shutdown. ~45 lines, deep nesting. | Split into `_run_migrations()`, `_seed_initial_data()`, `_probe_moneo_auth()`. | Low | No |
| S1-M5 | [backend/main.py:54-61](backend/main.py:54) | Major | DRY | Manual `db = SessionLocal(); try: …; finally: db.close()` boilerplate. Same pattern repeats in 6+ places across services. | Add `session_scope()` context manager to `db_context.py`; use in `main.py`. Services adopt in later stages. | Low | No |
| S1-m1 | [backend/DAL/__init__.py:1,23](backend/DAL/__init__.py:1) | Minor | DeadCode | `init_db` re-exported but no caller exists. CLAUDE.md claims it's "preserved for tests" but conftest.py calls `Base.metadata.create_all()` directly. | Remove `init_db` from imports + `__all__`; delete function. | Low | No |
| S1-m2 | [backend/DAL/models/__init__.py](backend/DAL/models/__init__.py), [backend/DAL/__init__.py](backend/DAL/__init__.py) | Minor | DeadCode/Naming | `Annotation` and `KioskToken` not re-exported, but every other model is. `middleware.py:46` reaches in by full path. | Add to both `__init__.py` files' imports and `__all__`. | None | No |
| S1-m3 | [backend/main.py:66-78](backend/main.py:66) | Minor | Magic / Async | Hard-coded `timeout=5`; bare `except Exception as e`. | Extract `_MONEO_PROBE_TIMEOUT_SECONDS = 5` constant. Leave try/finally. | Low | No |
| S1-m4 | [backend/migrations/env.py:15-29](backend/migrations/env.py:15) | Minor | DRY/Naming | 14 lines of `import DAL.models.X  # noqa: F401` mirror `DAL/models/__init__.py`. | After S1-m2, replace with single `import DAL.models  # noqa: F401`. | Low | No |
| S1-m5 | [backend/migrations/versions/0005_annotations.py:33](backend/migrations/versions/0005_annotations.py:33) | Minor | Other | `server_default=sa.text('now()')` vs `sa.func.now()` everywhere else. | **Do not edit applied migrations.** Record only. | n/a | n/a |
| S1-m6 | [backend/main.py:32-35](backend/main.py:32) | Minor | Layering | `logging.basicConfig` runs at module import. | Acceptable; leave. | n/a | n/a |
| S1-n1 | [backend/DAL/db_context.py:1-7](backend/DAL/db_context.py:1) | Nit | Naming | `SessionLocal` could be `Session` idiomatically; renaming ripples. Leave. | Leave. | n/a | n/a |
| S1-n2 | [backend/config.py:34-42](backend/config.py:34) | Nit | Other | `parse_debug` accepts `"debug"`/`"prod"` — env-style values, non-obvious. | Add one-line comment. | None | No |
| S1-n3 | [backend/DAL/models/dashboard.py:15-18](backend/DAL/models/dashboard.py:15) | Nit | Other | Visual-alignment whitespace. | Leave. | n/a | n/a |

---

## Duplication map

**Cluster 1 — Timestamp columns** (S1-M1)
- 11 model files declare `created_at`; 9 also declare `updated_at`.
- Locations: `user.py`, `dashboard.py`, `dashboard_widget.py`, `sensor.py`, `asset.py` (naive `DateTime`); `alert_rule.py`, `alert_event.py`, `alert_route.py`, `alert_notification_outbox.py`, `annotation.py`, `kiosk_token.py` (`DateTime(timezone=True)`).
- **Proposed home:** `backend/DAL/models/_mixins.py` exposing `TimestampMixin` (naive) and `TimestampMixinTZ` (tz-aware). Each model inherits the variant matching its current column type — DDL unchanged.

**Cluster 2 — `default=lambda: datetime.now(timezone.utc)` lambda** (covered by Cluster 1)
- 25+ literal occurrences absorbed by the mixin.

**Cluster 3 — `db = SessionLocal(); try/finally db.close()`** (S1-M5, partial)
- In scope: [main.py:55-61](backend/main.py:55), [db_context.py:10-15](backend/DAL/db_context.py:10).
- Out of scope (services + routes): 6+ more occurrences — listed below.
- **Proposed home:** `session_scope()` in `db_context.py`; use in `main.py`. Out-of-scope files adopt later.

---

## Behavior-affecting — needs explicit approval

- **S1-M3** Change `Integer` → `BigInteger` on `alert_*` and `sync_*` model PKs/FKs to match DDL. Explicit in-code comments warn about SQLite test-fixture autoincrement compatibility.

---

## Deferred / leave-as-is

- **S1-M2** — below ≥3 threshold.
- **S1-M3** — behavior-affecting; rejected by orchestrator (see decisions).
- **S1-m5** — applied migration, do not edit.
- **S1-m6** — acceptable in current architecture.
- **S1-n1, S1-n3** — pure style.

---

## Out-of-scope findings (for future stages)

### Services / routes — `SessionLocal()` boilerplate (route to Stage 2 + Stage 4)

Same pattern as S1-M5 outside the DAL boundary:

- [services/moneo_poller.py:97](backend/services/moneo_poller.py:97)
- [services/moneo_poller.py:292](backend/services/moneo_poller.py:292)
- [services/notification_dispatcher.py:30](backend/services/notification_dispatcher.py:30)
- [services/sync_health_service.py:32](backend/services/sync_health_service.py:32)
- [services/sync_health_service.py:78](backend/services/sync_health_service.py:78)
- [services/sync_health_service.py:235](backend/services/sync_health_service.py:235)
- [services/schedulers/alert_no_data_scheduler.py:14](backend/services/schedulers/alert_no_data_scheduler.py:14)
- [routes/websocket_routes.py:47](backend/routes/websocket_routes.py:47)
- [routes/websocket_routes.py:63](backend/routes/websocket_routes.py:63)

### middleware.py — lazy import (route to Stage 4)

[middleware.py:46](backend/middleware.py:46) imports `KioskToken` inside `get_current_user`. After S1-m2 re-export, the lazy import can be hoisted.

### Tests — `Base.metadata.create_all` direct usage (route to Stage 5)

- [tests/conftest.py:17](backend/tests/conftest.py:17)
- [tests/test_moneo_sync.py:50](backend/tests/test_moneo_sync.py:50)
- [tests/test_sync_health.py:49](backend/tests/test_sync_health.py:49)
- [tests/test_slice3.py:40](backend/tests/test_slice3.py:40)
- [tests/test_slice2.py:31](backend/tests/test_slice2.py:31)

### CLAUDE.md doc drift (route to final docs pass)

- `backend/CLAUDE.md:31` claims `init_db()` is "preserved for tests" — false after S1-m1.
- `backend/CLAUDE.md` folder structure mentions `DAL/models/alert_config.py` — file does not exist (replaced 0003 → 0004).

---

## Orchestrator decisions

- **Baseline tests:** GREEN
- **Approvals:**
  - S1-M1 ✓
  - S1-M3 ✗ (deliberate SQLite trade-off per in-code comments)
  - S1-M4 ✓
  - S1-M5 ✓
  - Minors: auto-applied per rule
  - S1-m5, S1-m6 deferred; nits skipped (S1-n2 applied as quick comment)
- **Extra guard for S1-M1:** verify byte-equivalent CREATE TABLE DDL per model after mixin adoption.

---

## Pass 2 — Applied

### Applied
- **S1-M1** — Added `DAL/models/_mixins.py` (`TimestampMixin` / `TimestampMixinTZ` / `CreatedAtMixinTZ`); 8 models refactored (user, dashboard, dashboard_widget, alert_rule, alert_event, alert_route, annotation, kiosk_token). Followup: comprehensive module docstring + invariant comments added to `_mixins.py` (orchestrator pass).
- **S1-M4** — `main.py` lifespan split into `_run_migrations` / `_seed_initial_data` / `_probe_moneo_auth`.
- **S1-M5** — Added `session_scope()` context manager in `DAL/db_context.py`; adopted at `main.py` seed block.
- **S1-m1** — Removed `init_db` (function + `DAL/__init__` exports).
- **S1-m2** — `Annotation` and `KioskToken` re-exported from `DAL/models/__init__.py` and `DAL/__init__.py`.
- **S1-m3** — `_MONEO_PROBE_TIMEOUT_SECONDS = 5` constant in `main.py`.
- **S1-m4** — 14 explicit model imports in `migrations/env.py` collapsed to one `import DAL.models`.
- **S1-n2** — Comment added to `config.parse_debug` explaining env-style values.

### Skipped
- **S1-M2** — n=2, below threshold.
- **S1-M3** — rejected by orchestrator (SQLite trade-off).
- **S1-m5** — applied migration, do not edit.
- **S1-m6, S1-n1, S1-n3** — accepted as-is.

### Files modified
- `backend/main.py`
- `backend/config.py`
- `backend/migrations/env.py`
- `backend/DAL/__init__.py`
- `backend/DAL/db_context.py`
- `backend/DAL/models/__init__.py`
- `backend/DAL/models/_mixins.py` (new)
- `backend/DAL/models/user.py`
- `backend/DAL/models/dashboard.py`
- `backend/DAL/models/dashboard_widget.py`
- `backend/DAL/models/alert_rule.py`
- `backend/DAL/models/alert_event.py`
- `backend/DAL/models/alert_route.py`
- `backend/DAL/models/annotation.py`
- `backend/DAL/models/kiosk_token.py`

### Public surface changes inside scope
- `DAL.init_db` — REMOVED (no callers; grep-confirmed).
- `DAL.session_scope` — NEW (additive).
- `DAL.Annotation`, `DAL.KioskToken` — NEW re-exports (additive; existing full-path import still works).
- `Sensor.created_at/updated_at` and `Asset.created_at/updated_at` UNCHANGED — mixin intentionally not applied (DDL column-order constraint).

### Contract-preservation evidence

Compiled `CreateTable(M.__table__).compile(dialect=postgresql.dialect())` for all 8 refactored tables:
- Column order: `created_at` / `updated_at` at end of each table — identical to original declaration order.
- Column types: TIMESTAMP WITHOUT TIME ZONE for the older 3; TIMESTAMP WITH TIME ZONE for the alert/annotation/kiosk_token group. Match pre-refactor types.
- NULL/NOT NULL flags, FKs, uniques, primary keys preserved.
- **Conclusion:** byte-equivalent DDL. `alembic revision --autogenerate` against current head produces an empty migration.

### Cross-stage notes (for future stages)
- Stage 2 (services) should migrate the 7 service-side `SessionLocal()` sites to `session_scope()`. Stage 4 (routes) owns the 2 websocket sites.
- `middleware.py:46` lazy import can be hoisted in Stage 4.
- `backend/CLAUDE.md` doc drift on `init_db` note and `alert_config.py` reference — final docs pass.
- `Sensor` and `Asset` did not adopt mixin (DDL column-order). Future cleanup that reorders their post-Slice-1 columns above timestamps would let them join the pattern — record only.

### Test commands run
```
cd backend
pytest
alembic upgrade head    # throwaway DB
alembic revision --autogenerate -m "verify_no_diff"  # empty; discarded
```

---

## Commit message draft

```
Stage 1 CR - Backend config, bootstrap, DAL, migrations

* Add DAL/models/_mixins.py (TimestampMixin / TimestampMixinTZ / CreatedAtMixinTZ) with module docstring documenting variant invariants and Sensor/Asset exemption; refactor 8 models to use it (byte-equivalent DDL verified)
* Split main.py lifespan into _run_migrations / _seed_initial_data / _probe_moneo_auth helpers
* Add session_scope() context manager in DAL/db_context.py; adopt at main.py seed block
* Re-export Annotation and KioskToken from DAL/models/__init__.py and DAL/__init__.py
* Collapse 14 explicit model imports in migrations/env.py to single `import DAL.models`
* Remove unused init_db (function + DAL re-export; no callers)
* Extract _MONEO_PROBE_TIMEOUT_SECONDS constant in main.py
* Document parse_debug env-style value handling in config.py
```
