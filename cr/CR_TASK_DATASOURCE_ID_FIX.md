# Task — Fix `datasource_id` argument in MONEO poller

You are running a focused, single-purpose fix. This is **not** part of the staged code review — it is a spin-off task identified during Stage 3 of the CR. There is no orchestrator workflow here; finish the work in one pass and report.

## Background

`backend/services/moneo_poller.py:167` calls `MoneoApiClient.get_processdata(...)` and passes `sensor.name` as the `datasource_id` argument. The client's docstring (`backend/services/moneo_api_client.py`) says `datasource_id` must be `reference.dataSource.id` — i.e. the spec-required path component for the `/processdata` API call.

`sensor.name` is the human-readable display name pulled from the MONEO node response. `sensor.moneo_datasource_ref` is the spec-required datasource ID, populated in `sync_sensor_metadata` from `reference.datasourceId` (falling back to `ds_info.id`).

The Stage 3 audit found that:
- The two values come from different fields of the MONEO response and will diverge for any sensor whose display name differs from its datasource ID.
- Divergence causes silent data loss: `get_processdata` is called with the wrong path component, the upstream API returns empty `data` or 404, no `sync_error` row is written, and `SyncRun.records_in` stays 0.
- This is a latent bug whose blast radius depends on live MONEO data.

Full writeup with evidence is in `cr/CR_STAGE_003_STATUS.md` under "Datasource-ID investigation".

## What you must do

1. **Read** the following before changing anything:
   - `backend/services/moneo_poller.py` — entire file
   - `backend/services/moneo_api_client.py` — focus on `get_processdata` docstring and request construction
   - `backend/DAL/models/sensor.py` — to confirm what fields exist
   - `cr/CR_STAGE_003_STATUS.md` — Datasource-ID investigation section
   - `backend/CLAUDE.md` — upstream MONEO API section

2. **Apply the fix** at `moneo_poller.py:167`:

   Replace:
   ```python
   datasource_id=sensor.name
   ```
   with:
   ```python
   datasource_id=sensor.moneo_datasource_ref or sensor.name
   ```

   The `or sensor.name` fallback preserves current behavior for any sensor whose `moneo_datasource_ref` is still NULL (sensors seeded before migration 0009 added the column, or sensors whose MONEO response lacked a datasource reference). Without the fallback, those sensors would start failing immediately.

3. **Add a comment** above the call explaining:
   - Why `moneo_datasource_ref` is the correct value (the API spec)
   - Why `sensor.name` is the fallback (legacy rows without `moneo_datasource_ref`)
   - One-line pointer to `cr/CR_STAGE_003_STATUS.md` for the full investigation history

   Keep the comment to ≤4 lines. The "why this exists" rule from the CR applies.

4. **Log a warning** when the fallback path is taken, so an operator can see which sensors are running on the legacy name-based path. Use the module logger; do not log secrets or PII. Suggested form:
   ```python
   if not sensor.moneo_datasource_ref:
       logger.warning(
           "Sensor id=%s name=%s has no moneo_datasource_ref; "
           "using sensor.name as datasource_id (legacy fallback)",
           sensor.id, sensor.name,
       )
   ```
   Place the log *before* the API call. **Throttling/dedup is out of scope** — if the legacy population is large, an operator-driven backfill is the right answer.

## Hard constraints

1. **One-line code change** plus the surrounding comment and the warning log. Nothing else in this file or any other file.
2. **No changes to `moneo_api_client.py`.**
3. **No new dependencies.**
4. **No commits, no `git add`, no `git push`.**
5. **Do not run tests** — tell the user the exact commands; they execute.
6. **No changes to existing tests** — if a test currently mocks `get_processdata` with assertions on the `datasource_id` argument, that test may now fail. **Flag it; do not edit the test.** The user will decide whether the test or the fix needs adjusting (the test was almost certainly asserting buggy current behavior).

## Verification you must do before declaring done

1. **Grep confirmation:** confirm `sensor.name` no longer appears as a `datasource_id=` argument anywhere in `backend/`. (One occurrence will remain — the fallback inside the changed line. That's fine.)
2. **Read the call graph:** confirm the changed line is the only call site that passes a sensor-derived value to `get_processdata`. If there are others, list them and apply the same fix.
3. **Confirm the model field exists:** `Sensor.moneo_datasource_ref` must be a real column (added in migration 0009). Read `backend/DAL/models/sensor.py` and confirm.

## Report

After applying the fix, output:

```
DATASOURCE-ID FIX — REPORT

Files modified:
- backend/services/moneo_poller.py

Lines changed:
- moneo_poller.py:<line>: datasource_id arg now reads `sensor.moneo_datasource_ref or sensor.name`
- moneo_poller.py:<line>: legacy-fallback warning log added
- moneo_poller.py:<line-range>: 3-4 line comment explaining the fix

Grep confirmation: `sensor.name` no longer used as datasource_id argument outside the fallback expression.

Affected tests (not edited): <list any tests that mock get_processdata and assert datasource_id; or "none found">

Verification steps for the user:
1. cd backend && pytest
2. In a dev environment with a live MONEO connection:
   - Confirm `SyncRun.records_in` for `moneo.readings` is non-zero on the next poll cycle for sensors that previously had divergent name vs. moneo_datasource_ref.
   - Check logs for "legacy fallback" warnings — these identify sensors that still need their moneo_datasource_ref populated (run `sync_sensor_metadata` or wait for the 6 h scheduled run).
3. If the warning is noisy in your environment, consider running `sync_sensor_metadata` manually via the admin endpoint to backfill `moneo_datasource_ref` for all sensors.

Commit message draft:

Fix - Use moneo_datasource_ref for MONEO processdata calls

* moneo_poller.py:167 previously passed sensor.name as datasource_id to MoneoApiClient.get_processdata, but the API spec requires reference.dataSource.id (stored as Sensor.moneo_datasource_ref). The two values diverge for any sensor whose display name differs from its datasource ID, causing silent data loss (empty processdata responses, no sync_error row, SyncRun.records_in stays 0).
* Now passes sensor.moneo_datasource_ref or sensor.name, preserving behavior for legacy rows whose moneo_datasource_ref is still NULL.
* Adds a warning log when the legacy fallback is used so operators can identify sensors needing a metadata backfill (run sync_sensor_metadata via the admin endpoint or wait for the 6 h scheduled run).
* Investigation history: cr/CR_STAGE_003_STATUS.md (Datasource-ID investigation section).
```

## Stop conditions

Stop and report if:
- The fix breaks any existing tests in ways that look like they assert buggy behavior — list them, do not edit them.
- You find additional call sites of `get_processdata` passing sensor data — apply the same fix uniformly and report.
- `Sensor.moneo_datasource_ref` does not exist as a column — something is wrong with the migration chain; stop and ask.
- You're tempted to do *anything else* in this file or elsewhere.
