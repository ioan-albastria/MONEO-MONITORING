# MONEO Sync Diagnostic — Investigation Prompt

## Goal
The MONEO readings sync is still returning zero rows despite the 5-slice remediation that
fixed the endpoint path, the bulk-upsert, and the watermark logic. The suspected root cause
is that the IDs used to build `/processdata/device/{deviceId}/datasource/{datasourceId}` URLs
do not match what the upstream API actually accepts. This session must:

1. Diagnose which IDs are wrong and why.
2. Add lightweight admin debug endpoints to expose the current DB state and let you test
   individual /processdata calls without running a full poll cycle.
3. Fix the ID extraction / mapping if the root cause is confirmed.

**No worktrees. No git operations. No changes to existing endpoint contracts.**

---

## Primary reference — MONEO OpenAPI spec

**Read `MONEO openapi docs.json` (repo root) before touching any code.**

### `/processdata` endpoint parameters (from the spec)

```json
{
  "name": "deviceId",
  "in": "path",
  "schema": { "type": "string", "format": "uuid", "maxLength": 36 },
  "example": "d8f3f705-02b9-47d1-8bf9-d239a12d9e3d"
},
{
  "name": "datasourceId",
  "in": "path",
  "description": "ID of the datasource",
  "schema": { "type": "string", "maxLength": 150, "pattern": "^[a-z0-9-_]*$" },
  "example": "temperature"
}
```

Key implications:
- `deviceId` is a standard UUID (36 chars). ✓ The current code uses `asset.moneo_asset_id`,
  which is stored as `reference.deviceId` from the Device node. This is consistent with the spec.
- `datasourceId` is a **lowercase slug** (pattern `^[a-z0-9-_]*$`, example `"temperature"`),
  NOT a 128-char hex — though a lowercase hex string would also match the pattern technically.
  The example `"temperature"` strongly signals a human-readable identifier.

### Node `reference` schema (from the spec)

The spec defines the `reference` field on a node as a `oneOf`:
```json
"reference": {
  "oneOf": [
    { "properties": { "deviceId":    { "type": "string", "format": "uuid" } } },
    { "properties": { "datasourceId": { "type": "string", "maxLength": 150, "pattern": "^[a-z0-9-_]*$" } } }
  ]
}
```

So DataSource nodes should have `reference.datasourceId` (the slug) — the same value that goes
into the `/processdata` URL. **The current code instead reads `reference.dataSource.id`** (a
128-char hex from a nested object that isn't in the official schema at all).

### The discrepancy to resolve

The original audit sample (`tmp/moneo-samples/node_category_examples.json`) showed the live API
returning a richer structure for DataSource nodes:
```json
"reference": {
  "deviceId": "dc3ca7c3-...",
  "dataSource": { "id": "217dc22e281a...(126 chars)", "category": "DataSource", "unit": {...} }
}
```

But the official schema says DataSource nodes should have `{ "datasourceId": "temperature" }` —
no `dataSource` nested object at all.

Either:
- (a) The live API is richer than the schema documents, AND the `datasourceId` slug exists
  alongside `reference.dataSource.id` in the actual response.
- (b) The spec field `reference.datasourceId` IS what maps to `reference.dataSource.id` in the
  live response (i.e. the slug and the hex are two different representations of the same thing).
- (c) The spec and the live API genuinely differ — `reference.dataSource.id` (hex) is what works,
  matching the pattern by accident.

**Task 1 must resolve which case applies by inspecting live `/nodes` data.**

---

## Context you must understand first

### Repository layout
- `backend/CLAUDE.md` — authoritative overview; read it before touching any file.
- `backend/services/moneo_poller.py` — the two key methods:
  - `sync_sensor_metadata()` — discovers devices and datasources from `/nodes`, upserts
    `Asset` (device) and `Sensor` (datasource) rows.
  - `poll_latest_readings()` — watermark-driven poll; builds the `/processdata` URL from
    `sensor.asset.moneo_asset_id` (device part) and `sensor.moneo_datasource_ref` (datasource part).
- `backend/services/moneo_api_client.py` — `get_devices()`, `get_processdata()`, `raw_get()`,
  `raw_get_response()`, `verify_auth()`.
- `backend/DAL/models/sensor.py` — `moneo_sensor_id` (topology UUID), `moneo_datasource_ref`
  (the hex required by `/processdata`).
- `backend/DAL/models/asset.py` — `moneo_asset_id` (the device UUID used in `/processdata`).
- `tmp/moneo-samples/` — JSON snapshots taken during the original audit. Read ALL of them.

### How the /processdata URL is currently built
`/processdata/device/{sensor.asset.moneo_asset_id}/datasource/{sensor.moneo_datasource_ref}`

Fields come from:
| DB field | Intended source in /nodes |
|---|---|
| `asset.moneo_asset_id` | Device node's `reference.deviceId` (NOT the topology `node.id`) |
| `sensor.moneo_datasource_ref` | DataSource node's `reference.dataSource.id` (128-char hex) |

The code in `sync_sensor_metadata()` has a comment confirming this intent:
> "Key this map off reference.deviceId (NOT the topology node's own 'id')"

### The discrepancy — two known URLs

**URL that works** (verified in Yaak by the user):
```
GET /processdata/device/a9f5bab6-cf3a-4670-95d3-e8d46024a508/datasource/Temperature
    ?fromTimestamp=1777292130000&toTimestamp=1777292000000
```
- Device UUID: `a9f5bab6-cf3a-4670-95d3-e8d46024a508`
- Datasource ID: `Temperature` — **a plain name, not a 128-char hex**

**URL the app is currently building** (sample from logs):
```
GET /processdata/device/fa39525e-c947-4f69-a79d-280e0d99eff7
         /datasource/fb968601d4091e9ce352b7b2a9044666d9bc17e06f9d8b062467fa6526e0970b...
```
- Device UUID: `fa39525e-...` (different from the working one)
- Datasource ID: 126-char hex hash

**Key observation — the two URLs are for different physical devices/sensors; the
different UUIDs and different datasource formats are both expected.**

What matters is:
1. The datasource in the working URL is a plain name (`Temperature`). Either:
   a. The MONEO API accepts the DataSource node's `name` field as the datasource ID, OR
   b. Some datasources have a short alphanumeric ID (their `reference.dataSource.id`
      is a name-like string, not the 128-char hex).
2. During the original audit (`tmp/moneo-samples/processdata_with_readings.json`), a
   **128-char hex DID return data** for one specific sensor. So the hex format works
   for some sensors, but may not work for others if their `moneo_datasource_ref` is
   null, stale, or was never populated from `reference.dataSource.id`.

---

## Investigation tasks (do these in order)

### Task 1 — Read the live /nodes structure and cross-reference with the spec

Use `raw_get_response()` (or `GET /api/moneo/raw/nodes?pageSize=500`) to fetch a fresh dump
of `/nodes`. Find at least one DataSource node and print its **complete `reference` object**
verbatim — every field at every level.

**Critical question A — which field is the datasourceId?**
The official spec says DataSource nodes have `reference.datasourceId` (a slug).
The audit sample shows `reference.dataSource.id` (a 128-char hex).
Does the live response have:
- Only `reference.dataSource.id` (no `datasourceId` flat field)?
- Only `reference.datasourceId` (the slug)?
- Both?

If `reference.datasourceId` exists and contains a short slug (e.g. `"temperature"`), that is
the correct value for the `/processdata` URL. If only the hex `reference.dataSource.id` exists,
the hex is what should be used (and it does match the pattern `^[a-z0-9-_]*$`).

**Critical question B — device UUID source:**
Compare `node.reference.deviceId` on a DataSource node with `node.reference.deviceId` on its
parent Device node. They should be equal. If they are, the asset mapping is correct.

**Deliverable for Task 1:** Print the full `reference` block for one Device node and one
DataSource node from the live API. State which field is the datasourceId slug.

### Task 2 — Inspect the current DB state

Add a **read-only** diagnostic endpoint that dumps all active sensors with the IDs the
poller would use and the exact URL it would build. The endpoint must be admin-only and
should not exist in production long-term — add a `# DIAGNOSTIC` comment so it can be
easily found and removed later.

```
GET /api/admin/debug/sensor-map
Auth: Bearer + admin
```

Response — one object per active sensor:
```json
[
  {
    "sensor_id": 1,
    "sensor_name": "Temperature",
    "moneo_sensor_id": "...(topology UUID)...",
    "moneo_datasource_ref": "...(hex or null)...",
    "asset_name": "Device A",
    "asset_moneo_asset_id": "...(device UUID or null)...",
    "processdata_url_preview": "/processdata/device/<asset_id>/datasource/<dsref>",
    "readings_count": 1234,
    "last_seen_at": "2026-05-17T13:28:00+00:00"
  }
]
```

`processdata_url_preview` should be `"INCOMPLETE — datasource_ref is null"` when
`moneo_datasource_ref` is None, and `"INCOMPLETE — asset is null"` when `asset` is None.

### Task 3 — Add a single-call processdata probe endpoint

Add an endpoint that fires one raw `/processdata` call with caller-supplied IDs and returns
exactly what MONEO responds — useful to test different ID combinations without changing DB
state or running a full poll.

```
POST /api/admin/debug/probe-processdata
Auth: Bearer + admin
Body: {
  "device_id": "a9f5bab6-cf3a-4670-95d3-e8d46024a508",
  "datasource_id": "Temperature",
  "from_ms": 1777200000000,
  "to_ms": 1777292130000
}
```

Response:
```json
{
  "url_called": "...",
  "status_code": 200,
  "total_count": 64730,
  "page_count": 1,
  "first_rows": [...]      // first 5 rows of data[], or [] if empty
}
```
On HTTP error: `{"url_called": "...", "status_code": 404, "error": "..."}`.
This endpoint must use `MoneoApiClient` directly (one-shot, no retry on 4xx).

### Task 4 — Add a single-sensor sync trigger

Add an endpoint that runs the poll loop for exactly one sensor (by its local `id`) and
returns a detailed trace. This is the equivalent of `POST /api/moneo/admin/sync-metadata`
but for readings, and scoped to one sensor so failures are isolated.

```
POST /api/admin/debug/sync-one-sensor/{sensor_id}
Auth: Bearer + admin
```

Response:
```json
{
  "sensor_id": 1,
  "sensor_name": "Temperature",
  "device_id_used": "...",
  "datasource_id_used": "...",
  "from_ms": 1777200000000,
  "to_ms": 1777292130000,
  "pages_fetched": 1,
  "records_in": 200,
  "records_written": 195,
  "error": null,
  "new_last_seen_at": "2026-05-17T13:30:00+00:00"
}
```

On any error return `"error": "<description>"` and `"records_in": 0`. Do NOT start a
`SyncRun` row from this debug endpoint — it must not pollute the health surface data.

### Task 5 — Find and fix the root cause

After running Task 1 + Task 2 together you will know:
- Which sensors have `moneo_datasource_ref = null` (skipped every poll cycle)
- Which sensors have a hex that doesn't match what `/nodes` currently returns
- Whether the device UUID stored in `asset.moneo_asset_id` matches what the live API returns

Based on findings, the fix will be one of:

**A. Wrong field name — `moneo_datasource_ref` populated with the wrong value or null.**
The current extraction path in `moneo_poller.py` is:
```python
ds_info = (reference.get("dataSource") or {})
moneo_datasource_ref = ds_info.get("id")
```
Per the official spec the correct field is `reference.datasourceId` (flat), not
`reference.dataSource.id` (nested). If the live API follows the spec, then
`reference.get("dataSource")` always returns `None`, so `moneo_datasource_ref` is always
`None`, and every sensor is silently skipped in the poll.

Fix: change the extraction to try both field names:
```python
# Try spec-compliant flat field first; fall back to the nested id seen in audit samples
moneo_datasource_ref = reference.get("datasourceId") or (
    (reference.get("dataSource") or {}).get("id")
)
```
Confirm which field the live API actually returns before applying this fix (Task 1).

**B. MONEO accepts the node name instead of the hex** → Add `sensor.name` as a fallback
datasource_id when `moneo_datasource_ref` is null. The poller's skip check would become:
```python
datasource_id = sensor.moneo_datasource_ref or sensor.name
if not datasource_id:
    # still skip — truly no identifier at all
```
Only apply this after confirming via Task 3 (probe endpoint) that using the name returns data.

**C. `reference.dataSource.id` is absent in the live API** → For some sensor categories
(e.g. CalcDataSource, or sensors where the hardware hasn't reported in), the MONEO platform
may not populate `reference.dataSource` at all, resulting in `moneo_datasource_ref = null`.
In that case the only viable identifier is the datasource **name** (as in the working Yaak URL).
Confirm by checking Task 1 results, then update `poll_latest_readings()` to fall back to
`sensor.name` when `moneo_datasource_ref` is null, after verifying via the probe endpoint
that names are accepted.

---

## Scope constraints

- **Do NOT touch** any existing endpoint contract (the `/api/admin/sync/health` shape is frozen).
- **Do NOT run** `git add`, `git commit`, or `git push`.
- **Do NOT create worktrees.** Edit files directly.
- The three new debug endpoints belong in a new file `backend/routes/admin_debug_routes.py`
  and must be registered in `backend/main.py` under a `/api/admin/debug` prefix.
- The debug routes do NOT need their own Pydantic response model classes — plain `dict` returns
  are acceptable for diagnostic endpoints.
- Add tests only if the root-cause fix changes existing logic in `moneo_poller.py` or
  `moneo_api_client.py`. The debug endpoints themselves don't need tests.

---

## Deliverable

A summary report covering:
1. What `/nodes` actually returns for the key fields (device UUID, datasource ID format).
2. What's currently in the DB — specifically: how many sensors have null `moneo_datasource_ref`,
   how many have a non-null value, and do those values match what `/nodes` returns today.
3. Which root cause (A, B, or C above) was confirmed, and the exact change made.
4. Evidence that the probe endpoint (`POST /api/admin/debug/probe-processdata`) returns data
   when called with the correct IDs.
5. Evidence that `POST /api/admin/debug/sync-one-sensor/{id}` writes at least one reading for
   a sensor that previously had zero readings.
6. Any follow-up work needed (e.g. if `moneo_datasource_ref` is always null because the live
   API never populates `reference.dataSource.id`, suggest a permanent fix for the metadata sync).
