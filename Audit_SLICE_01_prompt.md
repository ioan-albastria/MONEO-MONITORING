# Slice 1 — Prompt (as delivered to the implementing session)

Source: derived from MONEO_SYNC_AUDIT.md after user sign-off on the
4-slice plan (subsequently re-split to 5 slices; this slice was
unaffected).

---

You are implementing Slice 1 of the MONEO sync remediation plan. The
plan and rationale live in ./MONEO_SYNC_AUDIT.md — READ THAT FIRST,
especially the DTO mapping section, the four "critical findings", and
the "Slice 1" entry under Implementation plan. Repo-level ground
rules are in ./CLAUDE.md and ./backend/CLAUDE.md.

GOAL OF THIS SLICE
Make periodic polling actually produce sensor readings end-to-end
against the live MONEO API. Nothing about resumability, sync-runs
observability, frontend status surface, or token hygiene in this
slice — those are Slices 2–5.

SCOPE (do all of this, nothing more)

1. backend/services/moneo_api_client.py
   - Remove get_latest_sensor_reading() and get_sensor_readings().
     They call /sensors/{id}/latest and /sensors/{id}/readings, which
     return 404 against the live API.
   - Add:
       async def get_processdata(
           self,
           device_id: str,
           datasource_id: str,
           from_ms: int | None = None,
           to_ms: int | None = None,
           order: str = "+timestamp",
           page: int = 1,
           page_size: int = 500,
       ) -> dict
     Calls GET /processdata/device/{device_id}/datasource/{datasource_id}
     with query params fromTimestamp, toTimestamp, orderBy, pageNumber,
     pageSize. Returns the full envelope { pageNumber, pageSize,
     totalPages, totalCount, data } as a dict.
   - Comment heavily at the top of the method explaining: (a) why the
     "two ids" exist (topology node id vs reference.dataSource.id),
     (b) that timestamps are UTC int64 ms, (c) that the docs claim a
     "quality" field but the live response omits it.
   - Also remove get_device_sensors references — that method never
     existed on the client even though backend/routes/moneo_routes.py
     calls it. See route fix below.

2. backend/routes/moneo_routes.py
   - Replace the two broken proxy routes (/sensors/{id}/latest and
     /sensors/{id}/readings) so they call get_processdata under the
     hood. The route signatures and response shapes must stay as
     they are today — these are debug/admin proxies and the contract
     should not move. The path params are still the topology sensor
     id (string); look the sensor up by moneo_sensor_id, read its
     new moneo_datasource_ref column + its asset.moneo_asset_id, and
     pass those into get_processdata. /latest → page_size=1, default
     order. /readings → use the supplied from/to timestamps converted
     to ms.
   - Remove /devices/{id}/sensors (it calls a method that doesn't
     exist; no replacement endpoint upstream). Confirm by grepping
     the frontend — if nothing references it, drop the route.

3. backend/DAL/models/sensor.py
   - Add column:
       moneo_datasource_ref: Mapped[str | None] = mapped_column(
           String, nullable=True, index=True
       )
   - Comment: this is the inner reference.dataSource.id returned by
     /nodes; required by /processdata. Distinct from moneo_sensor_id
     (which is the topology node id, our stable handle).

4. backend/DAL/models/sensor_reading.py
   - Add UniqueConstraint on (sensor_id, timestamp). Keep the
     existing composite index too.

5. backend/services/moneo_poller.py — sync_sensor_metadata()
   - Stop hardcoding sensor_type="dataSource". Use the upstream
     reference.dataSource.category verbatim (one of "DataSource"
     or "CalcDataSource"). Include CalcDataSource nodes in the
     processed set (not just DataSource) — the live sandbox has zero
     today but the data model supports them.
   - Guard category against None before .lower().
   - Defensive unit extraction:
       ds_info = (reference.get("dataSource") or {})
       unit_info = ds_info.get("unit") or {}
       unit = unit_info.get("symbol", "")
   - Populate the new moneo_datasource_ref column from
     reference.dataSource.id on every insert/update.
   - Add a one-line comment above the device_id_to_asset map
     explaining we key off reference.deviceId (NOT node.id).

6. backend/services/moneo_poller.py — poll_latest_readings()
   - For each active sensor, call
       client.get_processdata(
           device_id=sensor.asset.moneo_asset_id,
           datasource_id=sensor.moneo_datasource_ref,
           page_size=1,
       )
     (No range query in this slice — that's Slice 2.)
   - Skip the sensor if asset is None or moneo_datasource_ref is
     None — log a single WARNING with sensor.id and the missing
     field name.
   - Parse timestamp as datetime.fromtimestamp(raw_ts / 1000,
     tz=timezone.utc). raw_ts is an int.
   - Replace the per-row "SELECT then INSERT" with a Postgres
     INSERT … ON CONFLICT DO NOTHING using
     sqlalchemy.dialects.postgresql.insert. The SQLite test fixture
     in backend/tests/conftest.py also has to keep working —
     SQLite supports INSERT OR IGNORE; either branch on dialect, or
     use a SQLAlchemy-portable pattern (savepoint + IntegrityError
     catch is fine). Whatever you pick, document it inline.
   - Continue to update sensor.last_seen_at on every newly inserted
     row.

7. backend/migrations/versions/0003_processdata_compatibility.py
   - upgrade():
     a. ALTER TABLE sensors ADD COLUMN moneo_datasource_ref VARCHAR;
        CREATE INDEX ix_sensors_moneo_datasource_ref ON sensors
          (moneo_datasource_ref).
     b. Backfill from existing JSON:
          UPDATE sensors
          SET moneo_datasource_ref =
              (metadata::jsonb #>> '{reference,dataSource,id}')
          WHERE metadata IS NOT NULL;
        (column name in the DB is "metadata" — the Python attribute
        is extra_metadata; see Sensor model.)
     c. Pre-flight: SELECT sensor_id, timestamp, count(*)
          FROM sensor_readings GROUP BY 1,2 HAVING count(*)>1.
        If any exist, DELETE all but MIN(id) per group in the
        migration. Log the count.
     d. ALTER TABLE sensor_readings
          ADD CONSTRAINT uq_sensor_reading_sensor_timestamp
          UNIQUE (sensor_id, timestamp);
   - downgrade(): reverse in opposite order.

8. backend/tests/
   - Add an integration-style test with a stub MONEO server
     (respx or httpx MockTransport) that:
       (i)  returns the documented /nodes envelope on metadata sync;
            asserts sensors get the deep id stored;
       (ii) returns one /processdata page on poll; asserts a reading
            row appears; re-runs the poll; asserts no duplicate row;
       (iii) returns category=CalcDataSource for one node and asserts
            it is persisted as a sensor.
   - Existing tests must keep passing.

OUT OF SCOPE (do NOT touch in this slice)
- No watermark / range queries / pagination loop (Slice 2).
- No sync_runs table, no /api/admin/sync/health (Slice 3).
- No frontend changes (Slice 4).
- No .env / token / config.py changes (Slice 5).
- No retention / pruning job, no Redis lock, no circuit breaker.

GROUND RULES (from CLAUDE.md, do not violate)
- Do not run git add / commit / push. The user does git themselves.
- No worktrees — edit in the main repo.
- Backend was frozen pre-audit; this slice's schema change is
  pre-approved per the audit. Do not make additional, unrelated
  schema changes.

SUCCESS CRITERIA (must demonstrate before declaring done)
- Alembic upgrade head runs cleanly on a fresh DB AND on a DB
  carrying existing sensor + sensor_readings rows (test both).
- New / updated unit + integration tests pass: pytest backend/tests.
- Manual smoke (document the steps in your final summary, don't
  commit a script): boot the backend with the .env from this repo,
  wait ~one minute, then
    SELECT count(*) FROM sensor_readings WHERE id > <pre-boot-max>;
  is > 0. If MONEO returns no fresh data for the sandbox sensors in
  the window, document that and instead show one full poll cycle's
  log lines proving get_processdata was called with the deep id and
  returned 200 with non-empty data for at least one sensor.

DELIVERABLE
A summary report covering: files changed, the dialect-portability
choice for ON CONFLICT, any deviations from this prompt (with
reasons), the smoke-test evidence, and a flagged list of anything
worth tightening in Slice 2.

When you are done, STOP. Do not start Slice 2.

---

### ADDENDUM appended after initial prompt (frontend safety check)

Before changing sensor_type away from the literal "dataSource" and
before removing /api/moneo/devices/{id}/sensors:

a) grep frontend/src for the string "dataSource" (case-sensitive).
   If any code branches on it, either:
     - leave the literal in place (keep the hardcoded
       sensor_type="dataSource") and instead add a new
       sensor_subtype column for the real upstream value, OR
     - flag the conflict in your final report and stop before
       editing further. Do not silently break the frontend.

b) grep frontend/src for "devices/" and for "moneo/devices".
   If anything calls /api/moneo/devices/{id}/sensors, leave that
   route alive and rewrite it to call get_processdata-style logic
   (return [] if no equivalent upstream call exists, with a comment
   explaining why). If nothing calls it, delete the route as planned.

Document the grep results in your final summary regardless of
outcome. No frontend code edits in this slice — that's Slice 4.
