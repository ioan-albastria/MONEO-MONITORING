# Stage 1 — Backend: config, bootstrap, DAL, migrations

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

## Findings

| ID | File:Line | Severity | Category | Finding | Proposed fix | Risk | Touches behavior? |
|---|---|---|---|---|---|---|---|
| S1-M1 | [DAL/models/*](backend/DAL/models/) (≥11 occurrences) | Major | DRY | `created_at`/`updated_at` `Mapped[datetime] = mapped_column(... default=lambda: datetime.now(timezone.utc), onupdate=...)` is duplicated across nearly every model (`user`, `dashboard`, `dashboard_widget`, `sensor`, `asset`, `alert_rule`, `alert_event`, `alert_route`, `alert_notification_outbox`, `annotation`, `kiosk_token`). Several variants in tz-awareness (`DateTime` vs `DateTime(timezone=True)`) — model definitions disagree with DB column types established in migrations. | Introduce `TimestampMixin` (and `TimezoneTimestampMixin` if needed) in a new `DAL/models/_mixins.py`. **Do not change** the underlying column type per model (keep each model's existing `DateTime` vs `DateTime(timezone=True)` — pick the mixin variant accordingly) so on-disk schema and Pydantic serialization don't shift. | Low if mixin literally produces the same `Column` objects per model. Must verify table-by-table that the resulting SQL DDL is identical to the current model's. | No (column type per model preserved) |
| S1-M2 | [DAL/models/sensor.py:30](backend/DAL/models/sensor.py:30), [DAL/models/asset.py:21](backend/DAL/models/asset.py:21) | Major | DRY | `extra_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)` duplicated. Only 2 occurrences — below the ≥3 threshold; record but **do not extract**. | Leave as-is; future model with `metadata` JSON column should use a shared mixin. | n/a | n/a |
| S1-M3 | [DAL/models/alert_rule.py:12](backend/DAL/models/alert_rule.py:12), [alert_event.py:12](backend/DAL/models/alert_event.py:12), [alert_route.py:12](backend/DAL/models/alert_route.py:12), [alert_notification_outbox.py:12](backend/DAL/models/alert_notification_outbox.py:12), [sync_run.py:21](backend/DAL/models/sync_run.py:21), [sync_error.py:34](backend/DAL/models/sync_error.py:34) | Major | Types | Model declares `id: Mapped[int] = mapped_column(Integer, primary_key=True)` but migration 0004 (`alert_*`) / 0010 (`sync_*`) creates the column as `BigInteger`. SQLAlchemy maps Python `int → INTEGER` for autoincrement but the actual on-disk column is `BIGINT`. ORM still works (Python `int` is arbitrary precision) but autogenerate diffs are wrong and any id > 2^31 will surprise readers expecting INT. `SyncRun` and `SyncError` have explicit comments documenting the divergence as a SQLite-test compatibility workaround. | Change `Integer` → `BigInteger` on `id` (and `rule_id` BigInteger FKs in `AlertEvent`, `AlertNotificationOutbox`, `AlertState`) to match DDL. **Touches behavior** for the SQLite test fixture (sync_run.py/sync_error.py comments warn about this). Flag and defer. | Medium — SQLite autoincrement compatibility with BIGINT primary keys could break the test fixture. | **Yes** — needs explicit approval (test fixture compatibility) |
| S1-M4 | [backend/main.py:39-83](backend/main.py:39) | Major | Function | `lifespan()` mixes four startup concerns (migrations, seeding, scheduler, MONEO probe) plus shutdown. ~45 lines, deep nesting. | Split into helpers `_run_migrations()`, `_seed_initial_data()`, `_probe_moneo_auth()`. Keep `lifespan` as a thin orchestrator. | Low — pure refactor, no behavior change if helpers are awaited/called in the same order. | No |
| S1-M5 | [backend/main.py:54-61](backend/main.py:54) | Major | DRY | Manual `db = SessionLocal(); try: …; finally: db.close()` boilerplate. Same pattern repeats in 6+ places across services (see [CR_OUT_OF_SCOPE](cr/CR_OUT_OF_SCOPE.md) — service layer is out of scope for Stage 1). | Replace local block with `from DAL.db_context import session_scope` (new context-manager helper) once. Single occurrence in scope; leaving alone here would mean adding the helper but not using it. Extract the helper to `db_context.py`, use it in `main.py`. Later stages can adopt it across services. | Low | No |
| S1-m1 | [backend/DAL/__init__.py:1,23](backend/DAL/__init__.py:1) | Minor | DeadCode | `init_db` is re-exported, but no caller exists. CLAUDE.md claims it is "preserved for use in tests/conftest.py" but conftest.py calls `Base.metadata.create_all(bind=engine)` directly. Genuine dead export. | Remove `init_db` from imports + `__all__`; delete the function in `db_context.py`. Update CLAUDE.md note in a later doc-only pass (not in this stage). | Low — public-looking name but no consumers grep-confirmed. | No |
| S1-m2 | [backend/DAL/models/__init__.py](backend/DAL/models/__init__.py), [backend/DAL/__init__.py](backend/DAL/__init__.py) | Minor | DeadCode/Naming | `Annotation` and `KioskToken` model classes are **not** re-exported from `DAL/models/__init__.py` or `DAL/__init__.py`, but every other model is. Consumers in `middleware.py:46` (`from DAL.models.kiosk_token import KioskToken`) reach in by full path — works, but inconsistent with the discoverability pattern set by the other 13 models. | Add `Annotation` and `KioskToken` to both `__init__.py` files' imports and `__all__`. (Does not change behavior — only adds names.) | None — additive only. | No |
| S1-m3 | [backend/main.py:66-78](backend/main.py:66) | Minor | Magic / Async | Hard-coded `timeout=5` for MONEO auth probe; bare `except Exception as e`. | Extract `_MONEO_PROBE_TIMEOUT_SECONDS = 5` module constant. Use `async with MoneoApiClient() as client:` if the client supports it; else keep try/finally. (Quick check of `moneo_api_client.py` is out of scope — leave try/finally as-is.) | Low | No |
| S1-m4 | [backend/migrations/env.py:15-29](backend/migrations/env.py:15) | Minor | DRY/Naming | 14 lines of `import DAL.models.X  # noqa: F401` mirror the `DAL/models/__init__.py` registry. If `DAL/models/__init__.py` is updated (e.g. add `Annotation` / `KioskToken` per S1-m2) the import list drifts. | After applying S1-m2, replace the 14 explicit imports with a single `import DAL.models  # noqa: F401` — `__init__.py` becomes the single source of truth for model registration. | Low — relies on `__init__.py` importing every model module. | No |
| S1-m5 | [backend/migrations/versions/0005_annotations.py:33](backend/migrations/versions/0005_annotations.py:33) | Minor | Other | `server_default=sa.text('now()')` here vs `sa.func.now()` in every other migration (0003, 0004, 0008, 0010). Same SQL emitted, just inconsistent style. | Change to `sa.func.now()`. **Migration files for already-applied revisions should not be edited** unless the change is functionally identical and we accept the alembic-history-hash risk. **Defer** — record only. | n/a — do not touch. | No (but: avoid editing) |
| S1-m6 | [backend/main.py:32-35](backend/main.py:32) | Minor | Layering | `logging.basicConfig` runs at module import. Side-effect at import time, fine for a single-process app, but means importing `main` in a test reconfigures the root logger. | Acceptable for now; leave as-is. Record only. | n/a | n/a |
| S1-n1 | [backend/DAL/db_context.py:1-7](backend/DAL/db_context.py:1) | Nit | Naming | `engine` and `SessionLocal` are module-level singletons. Fine, just worth documenting that `SessionLocal` is a `sessionmaker` (a factory) — naming-wise `Session` would be more idiomatic, but renaming would ripple across the whole codebase. | Leave. Record only. | n/a | n/a |
| S1-n2 | [backend/config.py:34-42](backend/config.py:34) | Nit | Other | `parse_debug` accepts `"debug"` as truthy and `"release"`/`"production"`/`"prod"` as falsy — these are env-style values, slightly outside Pydantic's normal bool parsing. Not wrong, just non-obvious. | Add a one-line comment noting why `"debug"`/`"prod"` are accepted (env-name-style values). | None. | No |
| S1-n3 | [backend/DAL/models/dashboard.py:15-18](backend/DAL/models/dashboard.py:15) | Nit | Other | Visual alignment whitespace in column declarations. Style only. | Leave. | n/a | n/a |

---

## Duplication map

**Cluster 1 — Timestamp columns** (S1-M1)
- 11 model files declare `created_at` (all of them) and 9 also declare `updated_at`.
- Locations:
  - [user.py:16-23](backend/DAL/models/user.py:16) — `DateTime` (naive)
  - [dashboard.py:19-26](backend/DAL/models/dashboard.py:19) — `DateTime` (naive)
  - [dashboard_widget.py:22-29](backend/DAL/models/dashboard_widget.py:22) — `DateTime` (naive)
  - [sensor.py:31-38](backend/DAL/models/sensor.py:31) — `DateTime` (naive)
  - [asset.py:22-29](backend/DAL/models/asset.py:22) — `DateTime` (naive)
  - [alert_rule.py:30-37](backend/DAL/models/alert_rule.py:30) — `DateTime(timezone=True)`
  - [alert_event.py:27-29](backend/DAL/models/alert_event.py:27) — `DateTime(timezone=True)`, created_at only
  - [alert_route.py:21-23](backend/DAL/models/alert_route.py:21) — `DateTime(timezone=True)`, created_at only
  - [alert_notification_outbox.py:25-27](backend/DAL/models/alert_notification_outbox.py:25) — `next_attempt_at` default, not really created_at
  - [annotation.py:27-29](backend/DAL/models/annotation.py:27) — `DateTime(timezone=True)`
  - [kiosk_token.py:23-26](backend/DAL/models/kiosk_token.py:23) — `DateTime(timezone=True)`
- **Proposed home:** `backend/DAL/models/_mixins.py` exposing `TimestampMixin` (naive) and `TimestampMixinTZ` (tz-aware). Each model inherits the variant matching its current column type — DDL is unchanged.
- **Justification not obfuscating:** mixin is a single short class; consumers just add it to the bases tuple. No long call chain — read `class Foo(TimestampMixin, Base): ...` and the columns appear inline via mixin inspection.

**Cluster 2 — `default=lambda: datetime.now(timezone.utc)` lambda** (covered by Cluster 1 — same fix)
- 25+ literal occurrences across models. The mixin in Cluster 1 absorbs all of them.

**Cluster 3 — `db = SessionLocal(); try: yield/use; finally: db.close()`** (S1-M5, partial)
- In scope: [main.py:55-61](backend/main.py:55), [db_context.py:10-15](backend/DAL/db_context.py:10) (the `get_db` generator).
- Out of scope (services): 6+ more occurrences in `services/` and `routes/websocket_routes.py` — see CR_OUT_OF_SCOPE.
- **Proposed home:** add `session_scope()` context manager to `db_context.py` (next to `get_db`); use in `main.py:55-61`. Out-of-scope files adopt it in later stages.

---

## Deferred / leave-as-is

- **S1-M2** (`extra_metadata` duplicate, n=2) — below the ≥3 threshold.
- **S1-M3** (`Integer` vs `BigInteger` model/migration mismatch) — behavior-affecting (SQLite test fixture autoincrement); needs explicit approval.
- **S1-m5** (sa.text vs sa.func) — already-applied migration, do not edit.
- **S1-m6** (`logging.basicConfig` at import) — acceptable in current architecture.
- **S1-n1, S1-n3** — pure style.

---

## Behavior-affecting — needs explicit approval

- **S1-M3** Change `Integer` → `BigInteger` on `alert_*` and `sync_*` model primary keys/FKs to match DDL. Risk: SQLite test fixtures rely on `Integer` autoincrement; per the explicit comment in `sync_run.py:5-6` and `sync_error.py:5-6`, this was a deliberate trade-off.

---

## Out-of-scope findings

Recorded in [cr/CR_OUT_OF_SCOPE.md](cr/CR_OUT_OF_SCOPE.md).

---

## Pass 2 — Applied

- **Applied: S1-M1** — Added `DAL/models/_mixins.py` (`TimestampMixin`, `TimestampMixinTZ`, `CreatedAtMixinTZ`); refactored 8 models (`user`, `dashboard`, `dashboard_widget`, `alert_rule`, `alert_event`, `alert_route`, `annotation`, `kiosk_token`). Skipped `sensor`/`asset` because they declare columns AFTER `created_at`/`updated_at`, so mixin would reorder DDL. DDL byte-equivalence verified by compiling `CreateTable` against the postgresql dialect — column order, types, and timezone-awareness preserved per model.
- **Applied: S1-M4** — Split `main.py` `lifespan()` into `_run_migrations()`, `_seed_initial_data()`, and `_probe_moneo_auth()` helpers. `lifespan` is now a thin orchestrator.
- **Applied: S1-M5** — Added `session_scope()` context manager to `DAL/db_context.py`; adopted at the single in-scope call site (`main.py` seed block). Listed remaining out-of-scope call sites in CR_OUT_OF_SCOPE.
- **Applied: S1-m1** — Removed `init_db()` from `DAL/db_context.py` and dropped it from `DAL/__init__.py` (imports + `__all__`). No callers existed.
- **Applied: S1-m2** — Re-exported `Annotation` and `KioskToken` from both `DAL/models/__init__.py` and `DAL/__init__.py`.
- **Applied: S1-m3** — Extracted `_MONEO_PROBE_TIMEOUT_SECONDS = 5` module constant in `main.py`.
- **Applied: S1-m4** — Replaced 14 explicit `import DAL.models.X  # noqa` lines in `migrations/env.py` with a single `import DAL.models  # noqa`. The package `__init__` now reigns as the single registration source.
- **Applied: S1-n2** — Added a comment on `config.py:parse_debug` documenting why `"debug"`/`"prod"` style values are accepted.

## Pass 2 — Skipped

- **S1-M2** (`extra_metadata` n=2): below DRY threshold, self-deferred.
- **S1-M3** (Integer vs BigInteger PK mismatch): rejected by orchestrator — deliberate SQLite trade-off per in-code comments.
- **S1-m5** (`sa.text('now()')` vs `sa.func.now()`): already-applied migration; do not edit.
- **S1-m6** (`logging.basicConfig` at import): acceptable for current arch.
- **S1-n1, S1-n3**: pure style; skipped.
