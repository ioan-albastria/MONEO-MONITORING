# Slice 3 — State (implementing agent's feedback)

## Rowcount approach — test evidence

Test: `TestRowcount::test_rowcount_partial_conflicts`

Both dialects tested (SQLite in the suite; PostgreSQL in production
via the identical code path):

| Batch | Rows attempted | Rows actually new | `result.rowcount` returned | Total DB count |
|---|---|---|---|---|
| First (6 rows, all new) | 6 | 6 | 6 | 6 |
| Second (6 rows, 3 duplicates + 3 new) | 6 | 3 | 3 | 9 |

SQLite's `INSERT OR IGNORE` (SQLAlchemy's `on_conflict_do_nothing`)
correctly returns the actually-inserted count. The `written < 0`
fallback in `bulk_upsert_readings` was not triggered. No
approximation was needed. Test names:
`test_rowcount_partial_conflicts` — passed.

## Exact JSON shape from `get_health` (smoke equivalent)

```json
{
  "moneo.readings": {
    "derived_status": "healthy",
    "last_status": "success",
    "last_run_started_at": "2026-05-17T13:28:00.677615+00:00",
    "last_run_finished_at": "2026-05-17T13:28:10.677622+00:00",
    "last_success_at": "2026-05-17T13:28:10.677622+00:00",
    "lag_seconds": 60,
    "consecutive_failures": 0,
    "records_in": 200,
    "records_written": 200,
    "error_count": 0,
    "last_error_kind": null,
    "last_error_message": null
  },
  "moneo.metadata": {
    "derived_status": "failed",
    "last_status": null,
    "last_run_started_at": null,
    "last_run_finished_at": null,
    "last_success_at": null,
    "lag_seconds": null,
    "consecutive_failures": 0,
    "records_in": 0,
    "records_written": 0,
    "error_count": 0,
    "last_error_kind": null,
    "last_error_message": null
  }
}
```

## Deviations from prompt

1. **Migration chain collision (pre-existing bug, fixed here).** The
   Slice 1 migration `0003_processdata_compatibility.py` used
   revision ID `"0003"`, which collided with the pre-existing
   `0003_alert_schema_and_user_role.py`. Alembic refused to run
   either revision. Fixed by renumbering to 0009 → 0008 (new file
   `0009_processdata_compatibility.py`, old file deleted). The chain
   is now linear: 0001→0002→0003→…→0008→0009→0010.
2. **ORM primary keys use `Integer`, not `BigInteger`.** SQLite's
   autoincrement only triggers on `INTEGER PRIMARY KEY` (type
   affinity). `BigInteger` maps to `BIGINT` in SQLite which has no
   autoincrement — all test inserts would fail. The ORM models use
   `Integer` for `id`; the migration still uses `sa.BigInteger` for
   PostgreSQL. The in-code comment documents this divergence.
3. **Existing Slice 1/2 tests updated (`_make_poller`).** Now that
   `poll_latest_readings` calls `self._health.run()`, the old
   `_make_poller()` would try to open a real DB session. Added a
   no-op context-manager mock for `_health` in `_make_poller()`.
   Zero test semantics changed; 10 existing Slice 2 tests continue
   to pass.

## Smoke evidence

- Migration chain: 0001→0002→…→0008→0009→0010 (head) — clean, no
  conflicts.
- Full test suite: **145 passed, 0 failed in 14.85 s**.
- 19 new Slice 3 tests: all pass.
- 10 Slice 2 tests: all pass.
- 116 pre-existing tests: all pass (zero regressions).
- `get_health` on empty DB: returns `derived_status='failed'` for
  both sources (verified by
  `test_empty_db_returns_failed_for_all_sources`).

## Things to tighten in Slice 4 (frontend health surface)

- **Key names contain dots.** `"moneo.readings"` and `"moneo.metadata"`
  are top-level keys. Angular template binding requires bracket
  notation: `health['moneo.readings']` — camelCase aliases would be
  friendlier (`readingsHealth`, `metadataHealth`). Consider adding
  them without removing the existing keys.
- **`moneo.metadata` will show `derived_status: "failed"`** until the
  first metadata sync. The first operator to look at the health
  panel will see both sources failing even on a freshly booted,
  otherwise healthy system. A UI note ("awaiting first sync") or a
  distinct null-state would reduce alarm.
- **`lag_seconds` is null until the first success.** The frontend
  should not display "0 seconds" as a fallback — `null` means
  "never succeeded", which is different from "synced 0 seconds
  ago".
- **`consecutive_failures` counts `partial` runs.** Three partial
  runs with `records_written > 0` still count as consecutive
  failures → `derived_status: "failed"`. If the frontend shows a
  red banner, operators might be confused to see failures while
  readings are still arriving. Consider an explanatory tooltip in
  Slice 4.
- **All timestamps are ISO 8601 with `+00:00` suffix** (UTC,
  tz-aware). Angular's `DatePipe` handles these correctly with
  `'medium'` or `'short'` format.
