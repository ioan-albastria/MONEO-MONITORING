# Out-of-scope findings — recorded for later stages

Entries here were spotted while reviewing a stage's files but live in files outside the current stage's scope. Pick them up when the stage that owns them runs.

---

## From Stage 1 audit (2026-05-18)

### Services / routes — `SessionLocal()` boilerplate

Same `db = SessionLocal(); try: …; finally: db.close()` pattern (Stage 1 finding S1-M5 / Cluster 3) appears repeatedly outside the DAL boundary:

- [services/moneo_poller.py:97](backend/services/moneo_poller.py:97)
- [services/moneo_poller.py:292](backend/services/moneo_poller.py:292)
- [services/notification_dispatcher.py:30](backend/services/notification_dispatcher.py:30)
- [services/sync_health_service.py:32](backend/services/sync_health_service.py:32)
- [services/sync_health_service.py:78](backend/services/sync_health_service.py:78)
- [services/sync_health_service.py:235](backend/services/sync_health_service.py:235)
- [services/schedulers/alert_no_data_scheduler.py:14](backend/services/schedulers/alert_no_data_scheduler.py:14)
- [routes/websocket_routes.py:47](backend/routes/websocket_routes.py:47)
- [routes/websocket_routes.py:63](backend/routes/websocket_routes.py:63)

**Action for owning stage:** after Stage 1 introduces `session_scope()` in `db_context.py`, migrate these call sites to use it. Each replacement is a localized edit; behavior-preserving as long as commit/rollback semantics in the existing block match the helper's semantics.

### middleware.py — lazy import inside function

[middleware.py:46](backend/middleware.py:46) imports `KioskToken` inside `get_current_user`. Likely there to avoid a circular import on module load. Once S1-m2 re-exports `KioskToken` from `DAL.models`, the lazy import can be hoisted.

### Tests — `Base.metadata.create_all` direct usage

Stage 1 leaves `init_db` removal (S1-m1) on the table. Test fixtures already bypass it:
- [tests/conftest.py:17](backend/tests/conftest.py:17)
- [tests/test_moneo_sync.py:50](backend/tests/test_moneo_sync.py:50)
- [tests/test_sync_health.py:49](backend/tests/test_sync_health.py:49)
- [tests/test_slice3.py:40](backend/tests/test_slice3.py:40)
- [tests/test_slice2.py:31](backend/tests/test_slice2.py:31)

If the future Tests stage centralizes the SQLite-fixture setup, this is a good consolidation target (Cluster: 5 occurrences of the same engine+create_all+session block).

### CLAUDE.md doc drift (defer to a docs pass)

- `backend/CLAUDE.md:31` claims `init_db()` is "preserved for use in tests/conftest.py" — no test calls it; if S1-m1 is approved, this line should be deleted.
- `backend/CLAUDE.md` Folder structure mentions `DAL/models/alert_config.py` — that model file does not exist (replaced in migrations 0003 → 0004). Doc-only fix.
