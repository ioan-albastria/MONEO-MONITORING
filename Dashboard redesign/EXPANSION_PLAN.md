# MONEO Expansion Plan — Iteration 2

**Status:** planning only. No code. Pending user review.
**Date:** 2026-05-11
**Revision:** 2 — re-prioritized by *importance*, not effort, after operator-trust feedback.
**Author:** Opus 4.7 planning pass.
**Implementer (intended):** Sonnet agent, slice-by-slice. Two features are large enough to be sliced in separate chats (see §1.4 and §11).

---

## 1. Executive Summary

### 1.1 The shift in this revision

Revision 1 ordered features by where they were already started (alerts had a stub model; caching was the next obvious win). That's effort-driven prioritization. This revision re-orders by **importance — the features that decide whether operators actually rely on the dashboard at 3 AM**.

The reordering is concrete:

- **TRUST tier** moves to the top. Without it the dashboard shows data; with it the dashboard is a monitoring tool. Operators stop trusting screens that lie about freshness, hide normal ranges, or have no event context. These are the highest-importance changes regardless of implementation cost.
- **LEVERAGE tier** comes next — features that 10× the value an operator gets per minute of setup (dashboard-level time picker, hierarchical browsing, templating variables).
- **REACH tier** — getting the tool to where operators actually are (mobile, kiosks, shared links).
- **SUPPORTING tier** — caching and admin from revision 1, repositioned. They underpin everything but are user-invisible.

### 1.2 Features at a glance

| Tier | # | Feature | Effort | Note |
|---|---|---|---|---|
| TRUST | 3.1 | Data freshness on every widget | 1.5–2 d | Cross-cutting; standalone. |
| TRUST | 3.2 | Normal-range / status coloring | 3–4 d | Single source of truth shared with alerts. |
| TRUST | 3.3 | Threshold alerts | 12–18 d | Sliceable: schema+evaluator+in-app first, delivery second. |
| TRUST | 3.4 | Chart annotations | 3–4 d | Auto-from-alerts ties to 3.3. |
| LEVERAGE | 4.1 | Hierarchical sensor browsing | 5–7 d | Self-referential asset tree. |
| LEVERAGE | 4.2 | Dashboard-level time picker | 2–3 d | Quick, high payoff. |
| LEVERAGE | 4.3 | Dashboard variables / templating | 12–17 d | **Deep dive in separate chat.** |
| LEVERAGE | 4.4 | UX polish + quick wins | 6–8 d | Bundle: catalog cards, sensor picker, smart defaults, drill-down, bulk actions, gauge ratio, drag contrast. |
| REACH | 5.1 | Mobile-first PWA | 8–12 d | **Deep dive in separate chat.** |
| REACH | 5.2 | Kiosk mode | 1.5–2 d | Big adoption lever for one afternoon's work. |
| REACH | 5.3 | URL-shareable state | 1.5–2 d | Depends on §4.2, §4.3. |
| SUPPORT | 6.1 | Upstream + analytics caching | 6–9 d | Carries over from revision 1. |
| SUPPORT | 6.2 | Admin + user management | 8–12 d | Carries over from revision 1, slimmed. |

**Total scoped here:** ~70–100 engineering days. With one engineer at the iteration-1 cadence, plan **12–20 calendar weeks**. Two features (§4.3 and §5.1) account for ~20–29 of those days; if either is deferred, the budget drops correspondingly.

### 1.3 If we only ship the top of the list

The minimum useful expansion — what changes the *character* of the product — is the TRUST tier plus hierarchical browsing plus the dashboard-level time picker.

| Shippable slice | Days | What it unlocks |
|---|---|---|
| TRUST + §4.1 + §4.2 | ~32–43 | Operators see whether data is trustworthy; can find sensors in a 200+ sensor deployment; one click reframes the whole dashboard. Alerts are wired end-to-end. |

This is the "if we can only do one thing" version of iteration 2.

### 1.4 What gets sliced into a separate chat

Two features are too large to fully specify here without bloating the doc and creating false certainty about details that need their own design pass:

- **§4.3 Dashboard variables / templating** — non-trivial language design (variable reference DSL, cascading variables, cache key implications). Requirements + outcome live here; full design lives in `SLICE_DASHBOARD_VARIABLES.md`.
- **§5.1 Mobile-first PWA** — service worker strategy, push notification infrastructure, mobile layout breakpoints, iOS/Android quirks. Requirements + outcome live here; full design lives in `SLICE_PWA_MOBILE.md`.

Everything else is fully specified in this document and can be sliced into PR-sized chunks directly by the implementer.

### 1.5 Working assumptions (flag these if wrong)

1. **Iteration-2 visual redesign ("Outstaff" mockup) is still deferred.** New features land in the existing iteration-1 chrome. If you want the redesign folded in, the plan still works — most of the new feature surface is layout-agnostic — but a few sections grow.
2. **MONEO upstream API has no structured factory/line hierarchy.** We seed the asset tree by parsing `Asset.location` strings (operator-reviewed) and let operators edit the tree in admin. If MONEO does expose hierarchy, the poller can populate it later — schema is forward-compatible.
3. **An SMTP relay exists for email alerts.** If not, alerts fall back to webhook-only and the email channel is deferred.
4. **Single-tenant deployment now, multi-tenant-ready schema** — same as revision 1.
5. **Backend changes are now allowed.** Iteration 1 froze the backend; iteration 2 unfreezes it. Every TRUST and LEVERAGE feature touches the backend.

---

## 2. Operating Principles

### 2.1 Feature spec template

Every feature subsection has:

- **What it is** — one paragraph.
- **Why it matters** — connects to the importance argument; explicit about what's broken without it.
- **Requirements** — bullet list of must-haves; the contract.
- **Expected outcome** — what the operator sees / can do after this ships.
- **Technical sketch** — DDL, API endpoints, components. Compact, enough for the implementer to slice.
- **Dependencies** — other features that must land first.
- **Effort** — engineering-day range.

Features marked **[DEEP DIVE]** have the first four sections here but defer the technical sketch to a separate document.

### 2.2 Slicing rules for the implementer

- One Alembic migration per slice (Alembic is itself a prerequisite — added as the first migration of slice 1).
- Each slice ships behind a feature toggle until verified; toggles in `backend/config.py` and read in services. Remove after stabilization.
- Cross-cutting changes (e.g., the `expected_poll_seconds` field on sensors) ship as their own slice, ahead of the feature that consumes them.
- Slice commits follow the iteration-1 format: `Slice N - summary\n\n* change 1\n* change 2`.
- Never auto-commit. The user controls all git operations.
- Never use worktrees, make changes on the code base
### 2.3 Naming the new visible surfaces

Where the iteration-1 nav rail has disabled items, this expansion claims them:

- `Events` (`bolt` icon) → `/alerts` (active alerts + history + rules)
- `Admin` (`settings` icon) → `/admin/*`
- `Reports` and `Live View` stay disabled for this iteration.

---

## 3. TRUST Tier

The TRUST tier exists for one reason: a sensor dashboard that doesn't make data trustworthiness visible silently erodes operator confidence and gets replaced by a phone call. These four features turn the product from "data display" into "monitoring tool."

### 3.1 Data freshness on every widget

#### What it is

A small "Updated 3s ago" line in muted text on every widget card, color-shifting to amber and red as the timestamp ages past the sensor's expected sample interval.

#### Why it matters

The single most-overlooked feature in developer-built dashboards. The failure mode is invisible: the upstream MONEO API stalls, a sensor goes offline, the cached number stays on screen, and the operator believes it. The damage to trust the first time this happens at 3 AM is hard to recover.

#### Requirements

- Every widget (line chart, bar chart, gauge, stat card) displays a freshness indicator showing time since the most recent data point feeding that widget.
- Three visual states, computed from the ratio of `age / expected_interval`:
  - **Fresh** (`ratio < 1`): muted text, default color.
  - **Stale** (`1 ≤ ratio < 5`): amber.
  - **Offline** (`ratio ≥ 5`): red, and the value itself is desaturated to signal "do not trust this number."
- Expected interval is per sensor (`sensors.expected_poll_seconds`), defaulting to a global config (today's MONEO poll cadence, 300s).
- Indicator updates live without an API roundtrip — a single client-side `interval(5_000)` recomputes age for all widgets on screen.
- For multi-sensor widgets, the indicator shows the **oldest** of the contributing sensors' last-update times. A "Mixed" pill appears when ages disagree by more than 2× the median.
- A separate **Live** pill (green dot) appears on widgets backed by an active WebSocket subscription that is currently delivering messages. Disappears the moment the socket drops.

#### Expected outcome

- Operator opens the dashboard. Every widget either shows fresh data or visibly admits it doesn't.
- When MONEO is in a partial outage, every affected widget glows amber within one minute. Cause-of-failure is visible without checking logs.
- When a single sensor dies, the operator notices within seconds.

#### Technical sketch

- DDL:
  ```sql
  ALTER TABLE sensors ADD COLUMN expected_poll_seconds integer;
  ```
- API: `SensorRead` adds `expected_poll_seconds` and `last_seen_at`.
- Frontend:
  - `AppWidgetsShellComponent` gains `@Input() freshAt?: string` and `@Input() expectedIntervalSeconds: number`.
  - Internal `interval(5_000)` recomputes `ageSeconds = (Date.now() - freshAt) / 1000` and applies a `data-state` attribute (`fresh|stale|offline`).
  - CSS uses `[data-state="stale"]` and `[data-state="offline"]` selectors with `--color-warning` and `--color-danger`.
  - DashboardWidget computes the right `freshAt` per widget type (oldest contributing reading for multi-sensor; single latest for gauge/stat).
- Backend: `sensor_service` exposes `last_seen_at` (max(timestamp) per sensor) on the existing `/api/sensors` route; cached for 30s in-process to avoid hammering the readings table on every dashboard load.

#### Dependencies

None. Ships standalone.

#### Effort

**1.5 – 2 days.**

---

### 3.2 Normal-range / status coloring

#### What it is

Every sensor has authoritative *normal* / *warning* / *critical* ranges, stored once and reflected on every widget that shows the sensor. Line charts show a shaded band for the normal range; bar charts color each bar by tier; gauge dials show zoned backgrounds; stat cards show a status pill.

#### Why it matters

A "42 bar" reading is meaningless without context. Operators who don't know the sensor cannot tell normal from dangerous. Showing the expected range turns a chart into a judgment instrument. This is the second-biggest gap between developer-built dashboards and industrial monitoring products.

#### Requirements

- Per-sensor configuration of up to four ranges:
  - `normal_min`, `normal_max` — the green zone.
  - `warning_min`, `warning_max` — outside normal, but tolerable.
  - `critical_min`, `critical_max` — outside warning; alarms apply.
- Single source of truth: ranges live on the **sensor**, not the widget. No per-widget overrides in v1.
- If a sensor has an `alert_rule` (§3.3), the rule's thresholds populate `warning_*` and `critical_*` automatically. A sensor-level override is allowed (e.g., for display-only sensors where alerts aren't configured).
- Coloring renders consistently across all widget types:
  - **Line chart:** semi-transparent shaded band for the normal range (via ApexCharts `annotations.yaxis`). Optional dashed lines at warning/critical bounds.
  - **Bar chart:** each bar's color picks from `{normal, warning, critical}` palette based on its value.
  - **Gauge:** the dial's conic gradient uses a multi-stop palette — green between `normal_min`-`normal_max`, amber in the warning bands, red beyond critical. The current reading's needle/fill is rendered on top.
  - **Stat card:** a status pill (`Normal` / `Warning` / `Critical`) next to the value; pill color matches.
- An operator can edit a sensor's ranges from a quick-edit shortcut on any widget (admin-only initially; relaxed in §6.2).

#### Expected outcome

- Looking at any widget, an operator can answer "is this OK?" without recalling the sensor's spec.
- The same coloring vocabulary applies everywhere; muscle memory transfers across pages.
- A new sensor onboarded with default ranges (or alert thresholds) renders correctly immediately.

#### Technical sketch

- DDL:
  ```sql
  ALTER TABLE sensors ADD COLUMN normal_min      double precision;
  ALTER TABLE sensors ADD COLUMN normal_max      double precision;
  ALTER TABLE sensors ADD COLUMN warning_min     double precision;
  ALTER TABLE sensors ADD COLUMN warning_max     double precision;
  ALTER TABLE sensors ADD COLUMN critical_min    double precision;
  ALTER TABLE sensors ADD COLUMN critical_max    double precision;
  ALTER TABLE sensors ADD COLUMN ranges_source   varchar(20) NOT NULL DEFAULT 'manual'
                              CHECK (ranges_source IN ('manual','from_alert_rule'));
  ```
- Service: when an `alert_rule` with `outside_range` is created/updated, `sensor_service.sync_ranges_from_alert(rule)` copies thresholds into `warning_*`/`critical_*` if `ranges_source = 'from_alert_rule'`. Sensors with `manual` ignore alert thresholds.
- API: `SensorRead` exposes the six fields.
- Frontend:
  - `core/sensors/status.ts` exports `statusOf(value, bounds): 'normal'|'warning'|'critical'`.
  - `dashboard-widget.component` reads `widget.sensors[*].bounds` and feeds chart annotations.
  - Gauge component renders a conic-gradient with up to five stops; calculation utility in `core/sensors/gauge-gradient.ts`.

#### Dependencies

Ships standalone, but **strongly recommended** to land after the `alert_rule` schema from §3.3 so the "single source of truth" wiring is in place from day one. Without that, sensors duplicate threshold state.

#### Effort

**3 – 4 days.**

---

### 3.3 Threshold alerts

(Restated from revision 1, with minor adjustments to dovetail with §3.2 and §3.4.)

#### What it is

Rule-based alerting on sensor readings. Rules combine a sensor, a condition, thresholds, hysteresis (dwell + asymmetric recovery), severity, and acknowledgment policy. State transitions are persisted as `alert_event` rows; the active set drives the in-app banner and the alerts page; the outbox dispatches notifications to email, webhook, and the WebSocket stream.

#### Why it matters

A monitoring tool that doesn't actively tell you when things go wrong is a monitoring tool that loses to a phone call. Alerts are also the integration point for status coloring (§3.2) and chart annotations (§3.4); shipping them right pulls those features together.

#### Requirements

- **Rule scope:** per sensor. Same sensor → same rule across all dashboards. Widget `gauge_min`/`gauge_max` remain display bounds; not conflated with alert thresholds.
- **Conditions:** `gt`, `lt`, `outside_range`, `inside_range`, `no_data`.
- **Hysteresis:** `dwell_seconds` (must persist N seconds before firing; default 60) + asymmetric recovery thresholds (fire above X, clear below Y).
- **Severity:** `warning` | `critical`.
- **Policy:** `auto_clear` (default) | `manual_ack`.
- **State machine:** `OK → PENDING → FIRING → RECOVERED → OK` (or `AWAITING_ACK → OK` if manual).
- **Flapping detection:** ≥5 state transitions in 10 min suppresses notifications and emits a `flapping_started` event; clears after 30 min stable; matches Alertmanager's pattern.
- **Evaluation:** hybrid — threshold conditions stream from the poller on ingest; `no_data` conditions run in a 60s scheduled job; both write to the same tables.
- **Delivery channels:** in-app toast (transient), persistent banner (active alerts page), email (configurable), webhook (configurable). Outbox pattern decouples evaluation from delivery.
- **WebSocket auth:** carried as a prerequisite — `/ws/sensors/*` and `/api/alerts/stream` both gain JWT auth via `?token=` query param.

#### Expected outcome

- Operators see a persistent banner the instant any critical alert fires; ack flow drains the banner.
- An `/alerts` page lists active alerts, filterable by severity / sensor / asset, with rule history.
- Email and webhook subscribers get reliable, retried notifications.
- Flapping sensors don't carpet-bomb the team.
- Every fired event becomes a chart annotation (§3.4).

#### Technical sketch

(Full DDL was in revision 1; reproduced verbatim with no changes.)

```sql
CREATE TABLE alert_rule (
  id                   bigserial PRIMARY KEY,
  sensor_id            integer NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  name                 varchar(120) NOT NULL,
  description          text,
  condition            varchar(20) NOT NULL CHECK (condition IN ('gt','lt','outside_range','inside_range','no_data')),
  threshold_lo         double precision,
  threshold_hi         double precision,
  recovery_lo          double precision,
  recovery_hi          double precision,
  severity             varchar(10) NOT NULL CHECK (severity IN ('warning','critical')),
  dwell_seconds        integer NOT NULL DEFAULT 60,
  no_data_seconds      integer,
  recovery_dwell_seconds integer NOT NULL DEFAULT 30,
  policy               varchar(20) NOT NULL CHECK (policy IN ('auto_clear','manual_ack')) DEFAULT 'auto_clear',
  is_enabled           boolean NOT NULL DEFAULT true,
  created_by           integer REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_rule_sensor ON alert_rule(sensor_id) WHERE is_enabled;

CREATE TABLE alert_event (
  id                   bigserial PRIMARY KEY,
  rule_id              bigint NOT NULL REFERENCES alert_rule(id) ON DELETE CASCADE,
  sensor_id            integer NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  state                varchar(20) NOT NULL CHECK (state IN
                          ('pending','firing','recovered','awaiting_ack','cleared','flapping_started','flapping_stopped')),
  observed_value       double precision,
  observed_at          timestamptz NOT NULL,
  acknowledged_by      integer REFERENCES users(id),
  acknowledged_at      timestamptz,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_event_rule_time ON alert_event(rule_id, observed_at DESC);
CREATE INDEX idx_alert_event_state ON alert_event(state) WHERE state IN ('firing','awaiting_ack');

CREATE TABLE alert_state (
  rule_id              bigint PRIMARY KEY REFERENCES alert_rule(id) ON DELETE CASCADE,
  current_state        varchar(20) NOT NULL,
  state_since          timestamptz NOT NULL,
  last_value           double precision,
  last_value_at        timestamptz,
  flap_count_10m       integer NOT NULL DEFAULT 0,
  is_flapping          boolean NOT NULL DEFAULT false
);

CREATE TABLE alert_route (
  id                   bigserial PRIMARY KEY,
  scope_kind           varchar(20) NOT NULL CHECK (scope_kind IN ('rule','sensor','asset','severity','all')),
  scope_id             integer,
  scope_severity       varchar(10),
  channel              varchar(20) NOT NULL CHECK (channel IN ('in_app','email','webhook')),
  target               text NOT NULL,
  on_fire              boolean NOT NULL DEFAULT true,
  on_recover           boolean NOT NULL DEFAULT false,
  is_enabled           boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_notification_outbox (
  id                   bigserial PRIMARY KEY,
  event_id             bigint NOT NULL REFERENCES alert_event(id) ON DELETE CASCADE,
  route_id             bigint NOT NULL REFERENCES alert_route(id) ON DELETE CASCADE,
  channel              varchar(20) NOT NULL,
  target               text NOT NULL,
  payload              jsonb NOT NULL,
  status               varchar(20) NOT NULL DEFAULT 'pending',
  attempts             integer NOT NULL DEFAULT 0,
  last_error           text,
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz
);
CREATE INDEX idx_outbox_pending ON alert_notification_outbox(status, next_attempt_at) WHERE status = 'pending';
```

**API surface:**

```
GET    /api/alerts/rules                    list rules, filter by sensor / severity / enabled
POST   /api/alerts/rules                    create rule
GET    /api/alerts/rules/{id}
PUT    /api/alerts/rules/{id}
DELETE /api/alerts/rules/{id}
POST   /api/alerts/rules/{id}/test          dry-run against the last N readings
GET    /api/alerts/events                   event log, filterable
GET    /api/alerts/events/active            currently firing / awaiting_ack
POST   /api/alerts/events/{id}/ack          ack
GET    /api/alerts/routes                   list routes
POST   /api/alerts/routes
PUT    /api/alerts/routes/{id}
DELETE /api/alerts/routes/{id}
GET    /api/alerts/stream      (WebSocket)  push feed for the logged-in user
```

**Evaluator:** streaming evaluator runs at the end of `moneo_poller.poll_latest_readings()`. Staleness evaluator (`services/schedulers/alert_staleness_scheduler.py`) runs every 60s. Dispatcher (`services/notification_dispatcher.py`) drains the outbox via background task; channel handlers for `in_app`, `email` (`aiosmtplib`), `webhook` (`httpx` + HMAC signature).

**Frontend modules:**

- `core/alerts/alerts-api.service.ts`, `core/alerts/alerts-realtime.service.ts`
- `core/notifications/toast.service.ts`, `shared/ui/toast-host.component.ts`, `shared/ui/banner.component.ts`
- `modules/alerts/{alerts.module.ts, alerts-list.component, alert-rules-list.component, alert-rule-editor.component, alert-event-history.component}`

#### Slicing (for the implementer)

Two natural sub-slices:

1. **Alerts core** (~7–10 d): schema, evaluator, state machine, in-app + banner. Ships with email/webhook stubs that no-op.
2. **Alerts delivery** (~4–6 d): email + webhook outbox dispatcher, flapping detection, routes UI.

§3.2 and §3.4 both depend on the rule schema from slice 1, not slice 2.

#### Dependencies

- Minimal admin (User.role) is recommended before notification delivery so routing has a sane target. The core slice can ship without roles (notify "all logged-in users" as a fallback).

#### Effort

**12 – 18 days** total (sliceable as above).

---

### 3.4 Chart annotations

#### What it is

Events overlay on time-series widgets: fired alerts, maintenance windows, recipe changes, line shutdowns, free-form operator notes. Vertical markers on line/bar charts; clickable for detail.

#### Why it matters

Operators investigating an anomaly need to know what was happening at the time. Without annotations, every investigation begins with Slack archaeology. With annotations, the dashboard tells the whole story — and it pairs naturally with alerts: every fired alert becomes a marker for free.

#### Requirements

- **Annotation kinds:** `manual` (user-entered), `alert` (auto-created on fire/recovery), `maintenance` (planned window), `event` (free-form, e.g., "Recipe changed").
- **Scope:** per-sensor, per-asset, per-dashboard, or global.
- **Shape:** point (single timestamp) or range (start + end).
- **Display surface:** line and bar charts. Gauges and stat cards do not annotate.
- **Interaction:** marker click → popover (label, body, author, timestamp). Author edit/delete own; admins edit/delete any.
- **Automatic alerts:** when an `alert_event` is written with state `firing`, an annotation row is created scoped to the rule's sensor with `kind='alert'`, `source_event_id` set. Recovery updates `ended_at`. Annotations are not deleted on alert deletion — they remain as audit.
- **Performance:** annotations join into widget data fetches (per-window query); cached alongside analytics responses.

#### Expected outcome

- A spike on a line chart shows the alert marker that explains it.
- A maintenance crew tags the start of a swap-out; later viewers don't have to ask "why did the value drop at 14:00."
- The annotation feed is a parallel history surface in addition to alert_events; useful for post-mortems.

#### Technical sketch

- DDL:
  ```sql
  CREATE TABLE annotation (
    id              bigserial PRIMARY KEY,
    kind            varchar(20) NOT NULL CHECK (kind IN ('manual','alert','maintenance','event')),
    scope_kind      varchar(20) NOT NULL CHECK (scope_kind IN ('sensor','asset','dashboard','global')),
    scope_id        integer,
    label           varchar(160) NOT NULL,
    body            text,
    started_at      timestamptz NOT NULL,
    ended_at        timestamptz,
    color           varchar(20),
    source_event_id bigint REFERENCES alert_event(id) ON DELETE CASCADE,
    created_by      integer REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_annotation_sensor ON annotation(scope_id, started_at DESC) WHERE scope_kind='sensor';
  CREATE INDEX idx_annotation_time   ON annotation(started_at DESC);
  ```
- API:
  ```
  GET    /api/annotations?scope_kind=&scope_id=&from=&to=&kinds=
  POST   /api/annotations
  PUT    /api/annotations/{id}
  DELETE /api/annotations/{id}
  ```
- Service: at the end of the alerts evaluator's transaction, write an `annotation` row whose lifecycle mirrors the event.
- Frontend:
  - `dashboard-widget.component` augments its data fetch to include annotations for the widget's window/sensors.
  - ApexCharts `annotations.xaxis` (point + range) maps directly. Color from annotation row.
  - "Add note" toolbar button → small dialog with label, body, optional range.
- Caching: invalidate `analytics_cache` entries whose `sensor_ids` overlap when a new annotation is written; annotations themselves are cached separately with a 30s TTL.

#### Dependencies

- §3.3 (alerts) for `kind='alert'` auto-population. Manual / maintenance / event kinds ship standalone.

#### Effort

**3 – 4 days.**

---

## 4. LEVERAGE Tier

The LEVERAGE tier is about value per minute of operator effort. Each of these features replaces a long workflow with a short one — they don't add capabilities so much as remove friction from the capabilities we already have.

### 4.1 Hierarchical sensor browsing

#### What it is

Replace the flat sensor list with a tree picker: Factory → Line → Machine → Sensor (with variable depth). The same tree drives widget config, admin sensor management, the breadcrumb shown next to any sensor name, and the future templating variable system (§4.3).

#### Why it matters

A flat list of 200+ sensors with duplicate names (`temp`, `pressure-1` across many machines) is unusable. The two-sensors-same-name problem solves itself the moment the path is visible. This is structural — without it, the product has a hard scaling ceiling at ~50 sensors.

#### Requirements

- Asset tree of arbitrary depth, with conventional levels: `factory`, `area`, `line`, `cell`, `machine`, `equipment`.
- Each sensor belongs to exactly one asset (no multi-parenting).
- Tree picker UI supports browse + type-to-filter (path-substring match).
- Sensor name displays with its hierarchical path as a breadcrumb everywhere (widget shell subtitle; alert messages; annotation labels).
- One-time migration parses existing `Asset.location` free-text into a tree, with operator review before commit.
- Admin can edit the tree (add/move/rename nodes).
- API exposes both the tree (nested) and flat queries with path filter.

#### Expected outcome

- Adding a sensor to a widget: operator drills into Plant A → Line 3 → Compressor 2 → temperature, instead of searching a 400-entry flat list.
- Looking at a widget, the operator sees `Plant A / Line 3 / Compressor 2 / temp` — disambiguated automatically.
- A new sensor onboarded by the poller can be assigned to a node by an admin in one click.

#### Technical sketch

- DDL:
  ```sql
  ALTER TABLE assets ADD COLUMN parent_id integer REFERENCES assets(id) ON DELETE SET NULL;
  ALTER TABLE assets ADD COLUMN kind      varchar(20) NOT NULL DEFAULT 'machine'
                              CHECK (kind IN ('factory','area','line','cell','machine','equipment'));
  ALTER TABLE assets ADD COLUMN path      varchar(500);   -- denormalized "Plant A / Line 3 / Compressor 2"
  CREATE INDEX idx_assets_parent ON assets(parent_id);
  CREATE INDEX idx_assets_path   ON assets(path);
  ```
  `path` is maintained by an after-update trigger or by the service when `parent_id`/`name` change; we pick the service approach for simplicity (one fewer Postgres-specific thing).
- One-time migration: parse `Asset.location` using delimiters `/`, ` - `, `,`. Output a CSV of suggested (parent, child) splits for operator review. Apply via an admin-triggered "apply hierarchy migration" endpoint.
- API:
  ```
  GET    /api/assets/tree                          nested tree, cached (5 min)
  GET    /api/assets/{id}/ancestors
  GET    /api/assets?kind=&parent_id=&search=      flat filtered list
  POST   /api/assets                               admin: create node
  PUT    /api/assets/{id}                          admin: rename/move
  DELETE /api/assets/{id}                          admin: only if leaf or has no sensors
  POST   /api/assets/migrate-from-location         admin: one-time migration endpoint
  ```
- Frontend:
  - `shared/ui/asset-tree-picker.component.ts` — checkbox tree with virtual scroll for deep trees, type-to-filter, "select all under this node" action.
  - `core/assets/asset-tree.service.ts` — fetches and caches tree.
  - Sensor multi-select (§4.4) embeds the tree picker.
  - `modules/admin/asset-tree-editor.component.ts` (drag-drop reparenting).
- Poller extension (deferred until MONEO hierarchy availability is confirmed; see open questions): if upstream supports parent/child metadata, populate `parent_id` automatically.

#### Dependencies

- None on shipping the tree.
- The sensor multi-select rebuild (§4.4) is the natural integration point. It can ship without the tree (flat picker), but the combined slice is cleaner.

#### Effort

**5 – 7 days.**

---

### 4.2 Dashboard-level time-range picker

#### What it is

A single time-range picker in the dashboard toolbar. It sets the range for every widget on the dashboard unless the widget has explicitly opted into an override.

#### Why it matters

Today, every widget owns its own from/to. In practice 90% of dashboard use is "show me everything for the last hour" or "the last 24 hours." Per-widget configuration is a friction tax we pay on every dashboard creation. Grafana figured this out a decade ago.

#### Requirements

- Toolbar picker with presets: `15m`, `1h`, `6h`, `24h`, `7d`, `30d`, `custom from/to`.
- Optional auto-refresh: `off`, `10s`, `30s`, `1m`, `5m`.
- New widgets default to `time_range_inherit = true`.
- Widget editor exposes an "Override" toggle that reveals the existing per-widget fields.
- Range change re-fetches all inheriting widgets (debounced 250 ms when scrubbing custom range).
- Range and auto-refresh persist on the dashboard.

#### Expected outcome

- Operator switches from "last hour" to "last 24 hours" once; entire dashboard reframes.
- Widget editor is shorter; most users never touch the time-range field.

#### Technical sketch

- DDL:
  ```sql
  ALTER TABLE dashboards ADD COLUMN default_time_range_hours integer DEFAULT 1;
  ALTER TABLE dashboards ADD COLUMN default_from             timestamptz;
  ALTER TABLE dashboards ADD COLUMN default_to               timestamptz;
  ALTER TABLE dashboards ADD COLUMN auto_refresh_seconds     integer;
  ```
  (relative range vs absolute is mutually exclusive; relative wins if both set, matching the widget convention.)
- Widget settings: add `time_range_inherit: boolean` (default `true`).
- Frontend:
  - `core/dashboard/time.service.ts` — per-dashboard `BehaviorSubject<TimeRange>`.
  - Toolbar picker writes to the service and the dashboard.
  - `DashboardWidgetComponent.ngOnInit` subscribes to the service when `time_range_inherit`; refetches on emit.

#### Dependencies

None (small, standalone, high payoff).

#### Effort

**2 – 3 days.**

---

### 4.3 Dashboard templating with variables  [DEEP DIVE]

#### What it is

Dashboards define variables (e.g., `$line`, `$machine`). Widget configurations reference variables. Switching a variable's value reconfigures every widget on the dashboard.

#### Why it matters

"Same dashboard but for Line 3" should be one dropdown selection, not 30 minutes of widget recreation. Without templating, dashboards multiply, diverge, and rot. With templating, one canonical "Line monitoring" dashboard serves every line. This is the difference between a dashboard tool and a dashboard product.

#### Requirements

- **Variable definition (per dashboard):**
  - `name` (e.g., `line`)
  - `type` (`single` | `multi` | `text`)
  - `options_source`:
    - `static` — hand-typed list
    - `assets` — assets matching a filter (e.g., `kind='line'`)
    - `sensors` — sensors matching a filter (e.g., `sensor_type='temperature'`)
  - `default_value`
  - `depends_on` — cascading variables (`$machine` depends on `$line`)
- **Widget references:** widgets reference variables in their `settings.sensor_ids` and other fields, e.g., `sensors_under_asset: "$line"` or `sensor_type_filter: "$kind"`.
- **Resolution:** on dashboard load and on every variable change, all widget configs are resolved (variable refs → concrete sensor IDs) before fetch.
- **URL state:** variable values encode in the URL (`?v.line=3&v.machine=12`); shareable.
- **Validation:** when a referenced asset/sensor is deleted, widgets show a clear "missing reference" state, not silent failure.
- **Permissions:** same as dashboard editing.

#### Expected outcome

- One canonical dashboard template; operators pick the line in the toolbar; whole dashboard re-targets.
- Sharing a URL preserves the exact variable selection.
- Adding a new line in admin doesn't require touching dashboards — the variable picks it up automatically.

#### Open complexities (why this is a deep dive)

- **Reference DSL:** simple substitution (`"$line"`) vs a small query language (`"$line.sensors.byType('temperature')"`). Too simple → escapes get awkward. Too rich → bug surface.
- **Cascading variable semantics:** what happens when the user changes the parent? Reset child to default? Preserve if still valid?
- **Cache key shape:** `analytics_cache` keys must include resolved sensor IDs *after* variable expansion, not the variable name. Affects §6.1.
- **Backward compatibility:** every existing widget gets `time_range_inherit=true` and no variable references — should be a no-op migration.
- **Editor UX:** variable definition is power-user territory and needs strong defaults to avoid scaring novices on first use.
- **Validation timing:** validate references at save vs at resolve? Both, with different UX.

#### Doc to produce (separate chat)

`SLICE_DASHBOARD_VARIABLES.md` — full design including:
- DSL grammar and resolver implementation
- Variable evaluator: how widget settings are transformed
- Cache key implications and invalidation flow
- Editor UX with wireframes
- Migration plan for existing widgets
- Permissions model

The deep-dive doc takes the implementer through the same level of detail as the rest of this plan.

#### Dependencies

- §4.1 (hierarchical browsing) is the natural source of `options_source='assets'`.
- §4.2 (dashboard time picker) — variables and time both live in the dashboard toolbar; ship variables after time picker so the toolbar pattern is established.
- §6.1 (caching) — cache keys must understand variable resolution.

#### Effort

**12 – 17 days** (to be refined in the deep dive).

---

### 4.4 UX polish + quick wins

A bundle of small features. Each is independently small but compounds into the perceived quality of the tool. Ship together to share a single QA pass and visual review.

#### 4.4.1 Widget catalog cards with thumbnails

- **Requirements:** type picker shows each widget type as a card with a hand-drawn SVG thumbnail, a description, a short "tags" line (`real-time`, `multi-sensor`, `single sensor`), and a "Best for" tagline.
- **Expected outcome:** new users immediately understand each type.
- **Effort:** ~1 d (SVGs are ~30 minutes each; CSS adapts existing cards).

#### 4.4.2 Sensor multi-select with tree, search, sparkline

- **Requirements:** custom dropdown using the asset tree picker from §4.1. Per-row: checkbox, name, type pill, asset path muted, unit, last-seen dot, inline sparkline (80×20 SVG, last 1h). Sticky footer with "select all matching," "clear," "N selected." Virtual scroll for >150 rows.
- **Backend:** `GET /api/sensors/sparklines?ids=…&minutes=60` returns a 12-point downsample per sensor, cached.
- **Expected outcome:** picking sensors becomes a 10-second task instead of a 1-minute task.
- **Effort:** ~2 d.

#### 4.4.3 Smart defaults per sensor type

- **Requirements:** new widget pre-fills sensible ranges and gauge bounds keyed by `sensor_type` (temperature → 0–100°C / 24h window; pressure → 0–10 bar; distance → 0–500 mm; etc.). Defaults table in code, override-friendly.
- **Expected outcome:** "Add widget" takes one less form pass for most cases.
- **Effort:** ~0.5 d.

#### 4.4.4 Drill-down on chart spikes

- **Requirements:** click a data point on a line chart → modal shows the 20 nearest raw samples (table) plus any annotations within ±5 min. Modal opens with the clicked sample highlighted.
- **Backend:** `GET /api/sensors/{id}/readings/around?at=ISO&radius=10` returns ±N samples.
- **Expected outcome:** the most common investigation step — "what was happening around this spike" — happens without leaving the dashboard.
- **Effort:** ~1.5 d.

#### 4.4.5 Bulk widget actions

- **Requirements:** shift-click to select multiple widgets in edit mode. Toolbar actions on the selection: delete, duplicate, copy-to-other-dashboard.
- **Expected outcome:** dashboard rearrangement and iteration get fast.
- **Effort:** ~1 d.

#### 4.4.6 Gauge aspect-ratio handling

- **Requirements:** when widget aspect ratio > 1.4, render a half-arc gauge (semi-circle). When ≤ 1.4, render the full conic dial. Switch live with `ResizeObserver`.
- **Expected outcome:** dial never looks awkward at any size.
- **Effort:** ~0.5–1 d.

#### 4.4.7 Drag/resize handle contrast fix

- **Requirements:** audit current rendering against `FRONTEND_REBUILD_INSTRUCTIONS.md` §13; bump opacity, switch to `--color-fg-muted`, add outline. Add a 3-dot `drag_handle` icon to the top grab strip that appears on hover.
- **Expected outcome:** users can see where to grab.
- **Effort:** ~0.5 d.

#### Dependencies for the bundle

- 4.4.2 depends on §4.1 (asset tree).
- 4.4.3 and 4.4.4 reference §3.4 (annotations) — drill-down shows annotations if §3.4 has shipped; otherwise omits them.
- Rest are standalone.

#### Bundle effort

**6 – 8 days** total for all seven sub-features.

---

## 5. REACH Tier

The REACH tier is about meeting operators where they are. The dashboard loses to a phone call if it requires a desktop, loses to a printout if it requires a login, and loses to a Slack screenshot if a URL doesn't carry context.

### 5.1 Mobile-first PWA  [DEEP DIVE]

#### What it is

Make the dashboard a Progressive Web App: responsive UI down to phone widths, installable via "Add to Home Screen," offline-tolerant via a service worker that caches static assets and last-known sensor readings, and push-notification-capable so alerts reach operators on the floor.

#### Why it matters

Operators walk the floor. If they have to find a desktop to check on a value, the dashboard isn't the tool — the phone call is. A PWA puts the dashboard in every operator's pocket. Push notifications make alerts reach them where they are without an SMS vendor.

#### Requirements

- **Responsive layouts** at breakpoints 480 / 768 / 1024 px:
  - Mobile (≤480): single-column dashboard, swipeable widgets, hidden admin section, compact alert banner.
  - Tablet (≤768): two-column dashboard, full nav rail collapsed.
  - Desktop (>1024): current layout.
- **Installable:** web app manifest with name, icons (192×192, 512×512, maskable), theme color, start_url, display=standalone.
- **Offline mode:** service worker caches static assets aggressively, sensor readings via stale-while-revalidate. Offline banner appears when network drops; dashboards render with last-known values; "Refresh" button reattempts.
- **Push notifications:** Web Push API + VAPID. Operator subscribes per device; backend stores subscription; alerts (severity ≥ chosen threshold) deliver as push. Subscription management page in profile.
- **Touch gestures:** swipe between dashboards (horizontal); pull-to-refresh on dashboard view.
- **Auth on mobile:** JWT refresh on app open; biometric unlock as future hook (not v1).

#### Expected outcome

- Operator installs the app in five seconds, has it on the home screen.
- They get a push notification when a critical alert fires, anywhere on the plant floor.
- Connectivity dead zones don't blank the screen; cached values stay visible with a clear "Offline" indicator.

#### Open complexities (why this is a deep dive)

- **Service worker strategy:** cache-first for static; network-first then cache for API; SWR for sensor readings. Each route has its own policy.
- **Push infrastructure:** VAPID key generation, subscription table schema, backend push delivery via `pywebpush`, retry/dead-subscription cleanup.
- **iOS quirks:** push not supported until iOS 16.4; install only via specific gestures; Safari service worker behavior diverges from Chrome.
- **Layout decisions:** which features collapse / strip down on mobile (full admin section probably hidden; widget editor uses sheet-style modal instead of side modal).
- **Testing matrix:** Chrome/Android, Safari/iOS, Edge/desktop. Real-device testing is non-negotiable.
- **Auth flow:** refresh tokens on background sync; what happens when the token expires while the app is offline.

#### Doc to produce (separate chat)

`SLICE_PWA_MOBILE.md` — full design including:
- Service worker strategy and Workbox setup
- Manifest and icon roster
- Mobile/tablet layout breakpoints with specific component changes
- Push notification: backend (`web_push_subscription` table, dispatcher integration, VAPID setup) and frontend (subscribe flow, permission UX)
- Auth + offline flow specifics
- Testing matrix and acceptance criteria

#### Dependencies

- §3.3 (alerts) to drive push payloads.
- §6.2 (admin) for subscription management UI surfaces.

#### Effort

**8 – 12 days** (to be refined in the deep dive).

---

### 5.2 Kiosk mode

#### What it is

A `?kiosk=true` URL that hides all chrome, optionally cycles through a configured set of dashboards, and stays logged in via a long-lived kiosk token.

#### Why it matters

One afternoon of work and the dashboard gets permanently mounted on a TV next to every production line. That's a permanent, in-plant adoption channel. Every operator who walks by sees the tool every shift.

#### Requirements

- URL param `?kiosk=true` activates kiosk shell.
- Hides: top header, nav rail, all edit buttons, all modals except errors.
- Optional `&cycle=N` cycles through configured dashboards every N seconds.
- Optional `&theme=dark|light`, `&density=compact`.
- Authentication: a *kiosk token* — a JWT with `role='kiosk'`, 1-year expiry (configurable), scoped to specific dashboard IDs only. Generated in admin.
- Auto-recovers from connection loss: retries every 10s with exponential backoff capped at 60s.
- A small `Kiosk` indicator in a corner (operator can confirm at a glance which mode is active; styled to fade after 10s).

#### Expected outcome

- Hang a tablet on a wall, paste a URL, never touch it again.

#### Technical sketch

- Frontend:
  - `AppShellComponent.ngOnInit` reads `kiosk` from `ActivatedRoute.queryParamMap`; toggles `kiosk` class on `<html>`.
  - CSS: `html.kiosk app-page-header, html.kiosk app-nav-rail, .widget-chrome-bar, .dashboard-toolbar__group--right { display: none }`.
  - `KioskRotatorService` cycles dashboards if `cycle` param present.
- Backend:
  - Kiosk token issued by admin endpoint: `POST /api/admin/kiosk-tokens` body `{ dashboard_ids: number[], expires_at?: ISO }`. Returns the token (shown once).
  - Token validates against a `kiosk_tokens` table (revocable). Auth dependency rejects kiosk tokens on any non-read endpoint and on dashboards outside the scope list.
- Admin UI: a "Kiosk tokens" page lists active tokens with dashboard scope, copy URL, revoke.

#### Dependencies

- Minimal admin (§6.2) for token generation UI.

#### Effort

**1.5 – 2 days.**

---

### 5.3 URL-shareable dashboard state

#### What it is

Encode dashboard ID, time range, variable values, and (optionally) a focused widget into the URL. Pasting the URL recreates the exact view.

#### Why it matters

Operators paste links into Teams and Slack when reporting issues. Today every such link loses context — the receiver sees "default state," not what the sender saw. With shareable state, "look at this" links work properly.

#### Requirements

- URL captures: dashboard id, time range (preset or from/to), variable values (per §4.3), optional `focus=widget-{id}`.
- Pasting a URL = bookmark + share.
- Reading the URL on load configures the dashboard before initial fetch (no flash of default state).
- Backward-compatible with existing `/dashboard` routes.
- Copy-link button in the dashboard toolbar.

#### Expected outcome

- "Look at this temperature spike" links work.
- Operators bookmark specific views as named saved searches in their browser.

#### Technical sketch

- Route: `/dashboard/:id?from=&to=&v.line=3&v.machine=12&focus=widget-42`.
- `DashboardUrlService` provides `serialize(state) → URLSearchParams` and `deserialize(params) → state`.
- `DashboardComponent.ngOnInit` reads `route.queryParamMap` once; subsequent state changes (time picker, variable picker) call `router.navigate([], { queryParams, queryParamsHandling: 'merge' })`.
- Copy-link button just calls `navigator.clipboard.writeText(window.location.href)` and toasts confirmation.

#### Dependencies

- §4.2 (time picker) — provides the time-range state to serialize.
- §4.3 (variables) — provides variable state. Ships without variables if §4.3 hasn't landed yet; URL just doesn't carry them.

#### Effort

**1.5 – 2 days** (assuming dependencies in place).

---

## 6. SUPPORTING Tier

Carried over from revision 1, repositioned. These features underpin the TRUST and LEVERAGE tiers but are user-invisible by themselves.

### 6.1 Upstream + analytics caching

(Unchanged from revision 1 §3. Restated tightly here; full design lives in revision 1 of this doc, reproduced in this file's git history if needed.)

- **Two layers:**
  - Layer A (`moneo_api_client`): raw upstream window cache. Postgres table `moneo_upstream_cache`. Sealed-window pattern; entries permanent until invalidated.
  - Layer B (`analytics_service`): computed `AnalyticsResponse` cache. Postgres table `analytics_cache`, keyed by hash of canonical request. In-process L1 LRU in front (256 entries, 30s).
- **Sealed window:** any window ending more than 15 min before now. Bucket-aligned keys (snap to hour for 60-min buckets) to maximize hit rate.
- **Downsampling tiers** in `sensor_readings_1m`, `sensor_readings_1h`, `sensor_readings_1d`, filled by `AggregationScheduler` running hourly. `analytics_service` selects from the most-coarse table that satisfies the requested `bucket_minutes`.
- **Invalidation:** sensor metadata change; manual flush; daily reconciliation against a sample of sensors.
- **Variable-aware (new in this revision):** when §4.3 ships, cache keys hash *resolved* sensor IDs, not variable names. Variable change → different key → fresh fetch.
- **Admin endpoints:** `POST /api/admin/cache/flush`, `GET /api/admin/cache/stats`.

#### Effort

**6 – 9 days.**

---

### 6.2 Admin + user management

(Mostly unchanged from revision 1 §5. Sliced into "minimal" and "full" for sequencing.)

#### Minimal admin (~2–3 d, prerequisite for alerts delivery)

- `users.role` column with `viewer` | `operator` | `admin`.
- `users.organization_id` column with default 1 (multi-tenant-ready schema, no UI).
- `@requires_role` FastAPI dependency on mutating endpoints.
- Login page stays as-is; role enforcement is server-side only at this stage.

#### Full admin (~6–8 d, lowest urgency)

- User CRUD + password reset flow:
  - `POST /api/users`, `PUT /api/users/{id}`, `DELETE /api/users/{id}` (soft delete via `is_active`).
  - `POST /api/auth/password-reset/request`, `POST /api/auth/password-reset/confirm`.
- Sensor label overrides — likely subsumed by hierarchical asset editing (§4.1). Keep a thin `sensor_label_override.display_name` column for cases where the hierarchy is right but the leaf name needs a friendly label.
- Audit log: `audit_log` table; service-layer helper `record_audit(actor, action, resource, before, after)` invoked from every mutating service.
- System health page: poll status, upstream API health, DB size, websocket count, cache hit rate. Read-only, all from existing data.
- Alert routing config UI (the rule + route entities are created in §3.3; this is just the management screen).
- Kiosk tokens (referenced from §5.2).

Schema details and full DDL match revision 1 of this document and remain valid.

---

## 7. Build Order & Sequencing

### 7.1 The dependency graph

```
TRUST: §3.1 freshness ────────── standalone
TRUST: §3.2 status coloring ──── needs §3.3 alert_rule schema (recommended)
TRUST: §3.3 alerts core ──┬───── needs minimal admin (§6.2.min) for role-aware routing
                          └───── unblocks §3.2, §3.4, §5.1 push
TRUST: §3.3 alerts delivery ─── needs core + email infra
TRUST: §3.4 annotations ────── needs §3.3 alerts core for auto-annotation

LEVERAGE: §4.1 hierarchy ────── standalone (one-time migration)
LEVERAGE: §4.2 time picker ──── standalone
LEVERAGE: §4.3 variables ────── needs §4.1 + §4.2 + §6.1 caching key shape
LEVERAGE: §4.4 UX bundle ────── 4.4.2 depends on §4.1; rest standalone

REACH: §5.1 PWA ────────────── needs §3.3 alerts core for push
REACH: §5.2 kiosk ──────────── needs minimal admin
REACH: §5.3 URL state ──────── needs §4.2 (+§4.3 if available)

SUPPORT: §6.1 caching ──────── standalone; benefits everything
SUPPORT: §6.2.min admin ────── prerequisite for alerts delivery + kiosk
SUPPORT: §6.2.full admin ───── independent, lowest urgency
```

### 7.2 Recommended build order

Importance-first with dependencies honored. Effort ranges are cumulative engineering days for that slice.

| Slice | Features | Days | Why this slice |
|---|---|---|---|
| **1 — Trust foundations** | Alembic setup (~0.5d) · §3.1 freshness · §3.3 alerts core (schema + evaluator + in-app + banner) · §6.2.min role enum · §3.2 status coloring · §3.4 annotations · WebSocket auth fix | 22 – 29 | Highest importance; one cohesive feature group that delivers the most operator value. Alerts core ships first within the slice; freshness, status coloring, annotations layer on once the rule schema exists. |
| **2 — Leverage foundations** | §4.1 hierarchy · §4.2 time picker · §4.4 UX bundle · §5.3 URL state | 14 – 19 | Each operator interaction becomes 10× faster. Hierarchy unlocks the templating future. |
| **3 — Supporting + delivery** | §6.1 caching · §3.3 alerts delivery (email/webhook/flapping/outbox) | 10 – 15 | Performance and reliability. Caching pays for itself the moment §1 dashboards have real data; delivery completes the alerts story. |
| **4 — Reach quick wins** | §5.2 kiosk | 1.5 – 2 | Cheap, high adoption leverage. |
| **5 — Heavy lift A (separate chat)** | §5.1 PWA mobile [DEEP DIVE] | 8 – 12 | After alerts core is live so push has a real payload. |
| **6 — Heavy lift B (separate chat)** | §4.3 Dashboard variables [DEEP DIVE] | 12 – 17 | After hierarchy, time picker, and caching are in place. |
| **7 — Operational polish** | §6.2.full admin | 6 – 8 | Last because nothing else depends on it; useful but not visible to users in normal flow. |

**Slice 1 alone is the minimum viable iteration 2.** If everything after slice 1 is deferred, the product is meaningfully better and the operator-trust gap is closed.

### 7.3 What this is *not*

This is not a Gantt chart — slices are review-and-iterate units, not parallel work streams. The implementer is expected to slice each table row into PR-sized commits (typically 1–3 days each) and post for review at each boundary.

### 7.4 Mid-iteration off-ramp

After slice 1 lands and before starting slice 2, evaluate:
- Did alerts produce false-positive flapping? Adjust thresholds before adding more surface.
- Did status coloring expose sensors with bad ranges? Fix data before adding more widgets.
- Are operators using the alerts page? If not, learn why before building variables.

Tempting to skip; don't. The mid-slice review is what keeps iteration 2 from becoming iteration 2.5.

---

## 8. Industry Best Practices (Reference)

Compressed from revision 1. Same recommendations.

| Pattern | Source | Status here |
|---|---|---|
| Rules + contact points + notification policies | Grafana | Adopted as rule + route split (§3.3). Skip label-based matching. |
| `for:` dwell + asymmetric recovery | Prometheus / Alertmanager | Adopted as `dwell_seconds` + asymmetric recovery (§3.3). |
| Flap detection by count | PagerDuty / Alertmanager | Adopted (§3.3 — 5-in-10 model). |
| Active alerts list ("drain to zero") | SCADA (Wonderware, Ignition) | Adopted (§3.3 active alerts page). |
| Manual acknowledge / latching | AWS IoT SiteWise | Adopted as optional policy (§3.3 `manual_ack`). |
| Sealed-window cache | InfluxDB | Adopted (§6.1). |
| Continuous aggregates | TimescaleDB | Adopted via hand-rolled rollups (§6.1). Schema migration-compatible if we move to Timescale later. |
| Dashboard variables / templating | Grafana | Adopted (§4.3). |
| Single dashboard time picker | Grafana | Adopted (§4.2). |
| Annotations | Grafana | Adopted (§3.4). |
| ISA-95 hierarchy (Enterprise → Site → Area → Line → Cell → Equipment) | Industrial standards | Partially adopted (§4.1 — variable depth, but with optional fixed levels). |
| Mobile PWA with Web Push | General web | Adopted (§5.1). |
| Kiosk mode | Grafana / commercial dashboards | Adopted (§5.2). |
| URL state | Grafana | Adopted (§5.3). |

**Explicitly skipped** (out of scope, justified):
- TimescaleDB / InfluxDB migration — Postgres scales fine through §6.1.
- ThingsBoard rule-chain DAGs — over-engineered for v1.
- Custom RBAC role builder — three hard-coded roles are sufficient.
- Alert correlation / ML deduplication — v3 problem.
- Per-sensor ACLs — role-only in v1.
- Real SSO wiring — schema hook only.
- SMS notifications — push covers urgent; webhook covers Slack/Teams/PagerDuty.

---

## 9. Out of Scope (Explicit)

- Iteration-2 "Outstaff" visual redesign — separate iteration unless §1.5 assumption 1 is wrong.
- Multi-tenancy beyond schema-ready (`organization_id` columns; single-tenant UI).
- TimescaleDB / InfluxDB migration.
- Real SSO (OIDC/SAML). Schema hook only.
- SMS / vendor-mobile-push (separate from PWA web push).
- Per-sensor ACLs.
- Custom RBAC builder.
- Alert correlation / ML.
- Vehicle / trip / live-map routes from the iteration-1 nav rail (still deferred).

---

## 10. Open Questions

In priority order — first three are blocking the implementer, rest can be answered before their respective slice.

1. **Iteration-2 visual redesign — fold in, or still deferred?** (§1.5 assumption 1.) If folded in, several frontend sections grow to include the Outstaff palette migration and component restyle.
2. **MONEO upstream hierarchy availability.** Does the upstream API expose factory/line/machine metadata, or do we rely on the `Asset.location` parse + operator-edited tree (§1.5 assumption 2)? If upstream has it, the migration can be skipped in favor of poller extension.
3. **Backend changes are unfrozen now — confirm.** Iteration 1 explicitly froze the backend; every TRUST and LEVERAGE feature touches it. Confirming this once avoids later surprise.
4. **Email delivery infrastructure.** SMTP relay available, transactional vendor (SendGrid / Postmark / SES), or webhook-only first?
5. **Push notification infrastructure for PWA.** Acceptance of VAPID keys + browser-native push, or do we need to wire to a vendor (FCM/APNs proxy)? Will defer to the PWA deep dive but want a steer.
6. **Sensor scale.** "Hundreds" — 200 or 2000? Drives sparkline endpoint cadence and tree picker virtualization decisions.
7. **Reading sample rate.** Per-sensor interval — 1 minute, 5 minutes, 1 second? Drives §6.1 retention math and §3.3 evaluator cadence.
8. **Default acknowledgment policy.** `auto_clear` for warning, `manual_ack` for critical (recommended), or both default `auto_clear`?
9. **Data correction frequency from MONEO.** Have you observed MONEO amending historical readings? Drives whether the daily reconciliation job is required or optional.
10. **Compliance / audit retention.** Are there ISO 27001 / regulatory retention requirements on alert events and audit log? Default plan is indefinite retention; rolling deletion is a small addition if needed.
11. **Existing identity provider.** Azure AD / Okta / other? Even if v1 ships local-auth-only, knowing the target IdP shapes `users.external_id`.
12. **Kiosk token expiry default.** 1 year? 6 months? Affects rotation cadence.

---

## 11. Deep-Dive Doc Roster

Two documents are deliberately not written here; they are the next planning step in their own chats.

| Doc | Covers | Trigger to write |
|---|---|---|
| `SLICE_DASHBOARD_VARIABLES.md` | §4.3 full design: DSL grammar, resolver, cache implications, editor UX, migration plan. | After slice 1 lands and before slice 6 starts. |
| `SLICE_PWA_MOBILE.md` | §5.1 full design: service worker strategy, manifest, mobile layouts, push backend + frontend flow, auth + offline behavior, testing matrix. | After slice 3 lands and before slice 5 starts. |

Both are intended for a planning chat similar to this one. Each must end with the same level of detail this plan has for its non-deep-dive features (Requirements / Outcome / Technical sketch / Dependencies / Effort, but at the slice-PR level rather than the feature level).

---

## Pointers for the implementer

- Slices map to sections of §7.2. Sub-slice each into PR-sized chunks of 1–3 engineering days.
- First migration is the Alembic introduction. Every subsequent slice adds one Alembic revision.
- Follow the iteration-1 commit format: `Slice N - summary\n\n* change 1\n* change 2`.
- Never auto-commit. The user controls staging.
- Reference docs already on disk: `IMPLEMENTATION_INSTRUCTIONS.md`, `FRONTEND_REBUILD_INSTRUCTIONS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`.
- The "TRUST tier ships first" decision is load-bearing — do not reorder without going back to the user.
