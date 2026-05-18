# Slice 4 — Prompt (as delivered to the implementing session)

Bakes in the five Slice-3 carry-forwards: dotted JSON keys (adapter
not a backend change), the never-synced state, null lag_seconds,
the partial-counts-as-failure tooltip need, and ISO 8601 timestamps.

The Slice 3 STATE file is the source of truth for the endpoint
contract this slice consumes.

---

You are implementing Slice 4 of the MONEO sync remediation plan. The
plan is in ./MONEO_SYNC_AUDIT.md — read the "Slice 4" entry under
Implementation plan. Slices 1–3 have landed; this slice is the
frontend status surface that consumes the new
GET /api/admin/sync/health endpoint added in Slice 3.

This is the only FRONTEND slice in the plan. No backend changes,
no schema, no .env / token work (that's Slice 5).

GOAL OF THIS SLICE
A logged-in admin sees a small always-visible sync-status indicator
in the app header; clicking it opens a panel with per-source detail
(readings and metadata). When derived_status is 'failed', a
dismissible red banner appears at the top of the app shell. Non-admin
users see nothing — the endpoint is admin-gated and a 403 hides the
surface.

The endpoint contract is FROZEN by Slice 3 — bind to it exactly. A
fresh smoke response looks like:
{
  "moneo.readings": {
    "derived_status": "healthy"|"degraded"|"failed",
    "last_status":   "success"|"partial"|"failed"|null,
    "last_run_started_at":  iso8601|null,
    "last_run_finished_at": iso8601|null,
    "last_success_at":      iso8601|null,
    "lag_seconds":          int|null,
    "consecutive_failures": int,
    "records_in": int,
    "records_written": int,
    "error_count": int,
    "last_error_kind":    str|null,
    "last_error_message": str|null
  },
  "moneo.metadata": { ...same shape... }
}

CONTEXT FROM SLICE 3 (carry-forwards, not optional)

A. Dotted JSON keys ('moneo.readings', 'moneo.metadata') — Angular
   templates can't use `health.moneo.readings`. Adapt at the service
   boundary into a typed model with camelCase fields (`readings`,
   `metadata`) so templates stay clean.

B. Empty / never-synced state. derived_status='failed' WITH
   last_success_at=null means "no run has ever completed", not
   "things just broke". Render this distinctly — wording like
   "Awaiting first sync", muted styling — and do NOT count it as
   a failure for the banner (the red banner is only for true
   failures, see scope item 5).

C. Null lag_seconds. Treat as "never" — do not render "0 s ago"
   or "just now".

D. consecutive_failures counts 'partial' runs too. A run with
   records_written > 0 plus a non-fatal sensor error still
   contributes. Surface this clearly in the panel — a tooltip on
   the consecutive-failures number explaining what counts.

E. All timestamps are tz-aware UTC ISO 8601. Use Angular's DatePipe
   ('medium' or 'short'); no manual parsing.

REPOSITORY CONVENTIONS (do not violate — see frontend/CLAUDE.md)

- NgModules only. `standalone: false` on every component. No
  standalone components, no `provideRouter()` style.
- Tailwind v4 CSS-first. All design tokens live in the `@theme`
  block in frontend/src/styles.css. NO `tailwind.config.js`. Reuse
  the existing token names (look at frontend/STYLE_AUDIT.md and
  frontend/STYLE_PATCH_REPORT.md before inventing colour or
  spacing values).
- Existing folder layout (frontend/src/app/): core/, shared/,
  modules/. Cross-cutting UI like the header lives under shared/
  components/ — find the existing header / nav-bar component and
  add the indicator there. If there isn't one, ask whether to
  create a shell-level header component or attach to an existing
  layout; do not silently invent a new chrome layer.

SCOPE (do all of this, nothing more)

1. frontend/src/app/core/services/sync-health.service.ts — new
   - Injectable, providedIn: 'root'.
   - Typed model:
       export type DerivedStatus = 'healthy' | 'degraded' | 'failed';
       export type LastStatus = 'success' | 'partial' | 'failed' | null;
       export interface SyncSource {
         derivedStatus: DerivedStatus;
         lastStatus: LastStatus;
         lastRunStartedAt: string | null;
         lastRunFinishedAt: string | null;
         lastSuccessAt: string | null;
         lagSeconds: number | null;
         consecutiveFailures: number;
         recordsIn: number;
         recordsWritten: number;
         errorCount: number;
         lastErrorKind: string | null;
         lastErrorMessage: string | null;
         /** True when derived_status='failed' AND last_success_at=null
             — first-boot state, not an actual failure. */
         neverSynced: boolean;
       }
       export interface SyncHealth {
         readings: SyncSource;
         metadata: SyncSource;
         /** Worst of {readings.derivedStatus, metadata.derivedStatus},
             but a neverSynced source contributes 'pending' not 'failed'. */
         overall: DerivedStatus | 'pending';
         fetchedAt: Date;
       }
   - getHealth(): Observable<SyncHealth | null>
       GET /api/admin/sync/health.
       On 200: adapt the dotted-key payload to the SyncHealth model
         above (the adapter maps "moneo.readings" → readings, etc.).
       On 403: return of(null). This is the "not an admin" signal —
         do not toast, do not error, just hide the surface.
       On 401: defer to the existing HTTP error handling — the auth
         interceptor will redirect to login if it does today.
       On other errors (network, 5xx): catchError → emit a synthetic
         SyncHealth where overall='failed' and both sources show
         derivedStatus='failed' with lastErrorMessage set to the
         transport-level error string. This way the indicator goes
         red on a real outage even if the endpoint itself is dead.
   - watchHealth(intervalMs = 30000): Observable<SyncHealth | null>
       Polls getHealth on a timer. Use timer(0, intervalMs)
       .pipe(switchMap(...), shareReplay(1)) so multiple subscribers
       share one HTTP cycle. Pause polling while document.hidden
       is true (visibility API) and resume on focus — saves on
       cycles when the tab is in the background.

2. frontend/src/app/shared/components/sync-status-indicator/
   - sync-status-indicator.component.ts/.html/.css
   - Selector: app-sync-status-indicator
   - Subscribes to syncHealth$ from SyncHealthService.
   - Renders nothing (return early in template) when health is null
     (non-admin / 403). Don't reserve space.
   - Visible state: a small pill / dot that's tap-friendly (≥ 32px
     hit target on mobile per existing accessibility patterns).
       overall === 'healthy'  → green dot, optional label "Sync OK"
       overall === 'degraded' → amber dot, label "Sync degraded"
       overall === 'failed'   → red dot, label "Sync failed"
       overall === 'pending'  → muted gray dot, label "Awaiting first sync"
   - Use existing semantic Tailwind tokens — do NOT hardcode hex.
     If a green/amber/red status palette doesn't exist in styles.css,
     ADD them to the @theme block as `--color-status-ok`,
     `--color-status-warn`, `--color-status-error`,
     `--color-status-pending` and use them. Document the addition
     in frontend/STYLE_PATCH_REPORT.md (one bullet under the
     correct section).
   - aria-label reflects the status; aria-haspopup="dialog";
     keyboard activatable (Enter/Space → opens the panel).
   - Click / Enter → opens SyncStatusPanelComponent (see #3) as a
     popover anchored to the indicator. Use whatever popover /
     overlay primitive the project already uses (search shared/
     components/ before introducing Angular CDK Overlay; if nothing
     exists, the CDK Overlay is acceptable — angular-cdk is already
     in package.json per IMPLEMENTATION_INSTRUCTIONS.md).

3. frontend/src/app/shared/components/sync-status-panel/
   - sync-status-panel.component.ts/.html/.css
   - Input: health: SyncHealth (non-null; parent only opens it
     when health is loaded).
   - Two sections, one per source (Readings, Metadata):
       Title row: source label + status badge (same colour token
                  as the indicator).
       Detail rows:
         "Last success"      — last_success_at via DatePipe 'medium',
                               OR "Never" when null.
         "Lag"               — humanised lag_seconds ("4 m 32 s",
                               "2 h 11 m"), OR "—" when null.
         "Last run"          — last_run_started_at → last_run_finished_at
                               (both via DatePipe), with a fallback
                               for in-flight runs (finished_at null).
         "Records in / written" — "200 / 195"
         "Consecutive failures" — number; on hover, tooltip:
           "Counts both 'failed' runs and 'partial' runs (where some
            sensors errored but readings still flowed)."
         "Last error"         — `lastErrorKind`: `lastErrorMessage`
                                (truncated at ~120 chars in the panel
                                with a "show more" expand if longer);
                                hidden when lastErrorKind is null.
   - First-boot empty state for the metadata source: when
     neverSynced is true, render a single muted line "Awaiting first
     sync" instead of the detail rows for that source. Do not show
     a red Last error block in this case.
   - Footer: "Updated <relative time>" from health.fetchedAt; a
     refresh button that calls SyncHealthService.getHealth() once.
   - Close on outside-click / Escape.

4. frontend/src/app/shared/components/sync-status-banner/
   - sync-status-banner.component.ts/.html/.css
   - Subscribes to syncHealth$.
   - Renders only when overall === 'failed' (NOT for 'degraded'
     and NOT for 'pending').
   - Red banner, full width, sticky to the top of the app shell,
     above the main content but below the header.
   - Copy: "Sync failed — readings may be stale. <link>View details</link>"
     where "View details" opens the SyncStatusPanel.
   - Dismissible per session (sessionStorage key
     `sync-banner-dismissed`). Re-appears after page reload OR if
     the failure shape changes (e.g. lastErrorKind changes — store
     the dismissed-error-signature next to the flag).
   - Hide entirely when SyncHealth is null (non-admin).

5. Integrate into the app shell
   - Find the existing app shell / layout / header component
     (grep for `<router-outlet>` and trace up). Add
     <app-sync-status-indicator> into the header next to the user
     menu / logout button.
   - Add <app-sync-status-banner> directly under the header,
     before the main content area.
   - Register the three components in the appropriate NgModule
     (shared.module.ts or equivalent). Export them so they're
     usable by whatever module hosts the shell.

6. frontend/src/app/types/ (or wherever cross-cutting types live)
   - Move the SyncHealth / SyncSource interfaces here if that's the
     existing pattern. If types live alongside services, leave them
     in sync-health.service.ts.

7. Tests
   Unit (Karma/Jasmine — match existing test infra):
   - SyncHealthService:
     * Adapter: dotted keys → camelCase, snake_case fields → camelCase,
       neverSynced derivation, overall calculation matrix
       (healthy+healthy → healthy; healthy+pending → healthy not
       pending; degraded+healthy → degraded; failed+pending →
       failed; pending+pending → pending).
     * 403 → emits null.
     * Network error → emits synthetic "failed" health.
     * watchHealth pauses on document.hidden (use a fake clock and
       a faked Visibility API to assert no HTTP during hidden).
   - SyncStatusIndicatorComponent:
     * Renders nothing when health is null.
     * Dot colour reflects overall.
     * Pending state shows "Awaiting first sync" label.
     * Keyboard activation opens panel.
   - SyncStatusPanelComponent:
     * Renders "Never" for last_success_at=null.
     * Renders "—" for lag_seconds=null (NOT "0 seconds").
     * neverSynced source shows the "Awaiting first sync" block,
       not the Last error block.
     * Tooltip text on consecutive_failures is present.
   - SyncStatusBannerComponent:
     * Hidden when overall != 'failed'.
     * Hidden when overall='pending'.
     * Dismissal persists in sessionStorage; re-appears when the
       error signature changes.

   Playwright e2e (frontend/e2e/):
   - admin sees indicator → clicks → panel opens → shows two sources.
   - non-admin (or kiosk) does NOT see the indicator.
   - With the backend stubbed to return overall=failed, the red
     banner appears; dismissing it hides it for the session.
   - With the backend stubbed to return last_success_at=null for
     both sources, the indicator is "Awaiting first sync" and the
     red banner is NOT shown.

   Add new spec files; do not bloat existing ones. Follow the
   filename and structure pattern in frontend/e2e/TEST_PLAN.md.

OUT OF SCOPE (do NOT touch)
- No backend changes whatsoever (the health endpoint contract is
  frozen).
- No changes to the auth flow / interceptor.
- No changes to existing widgets, dashboards, sensors UI.
- No .env / config / token work (Slice 5).
- No frontend doc updates beyond the one bullet in
  STYLE_PATCH_REPORT.md mentioned in scope item 2.
- No retroactive refactor of the existing header / shell beyond
  inserting the two new components.
- No replacement of existing popover / overlay primitives if one
  is already in use.

GROUND RULES
- No git add / commit / push (user commits between slices).
- No worktrees.
- NgModules only. `standalone: false` everywhere. If you find
  yourself wanting standalone, stop and reconsider.
- Tailwind v4 CSS-first. No tailwind.config.js. Tokens live in
  styles.css @theme.

SUCCESS CRITERIA
- Frontend builds clean: `ng build`.
- Lint passes if there's a lint script.
- Karma unit tests pass, including all new specs.
- Playwright e2e suite passes; the new e2e cases pass.
- Manual smoke:
  1. `ng serve`, log in as admin.
  2. Indicator visible in header; click → panel opens → both
     sources listed.
  3. On a fresh DB (or after deleting from sync_runs), indicator
     reads "Awaiting first sync" for at least the metadata source
     and NO red banner appears.
  4. Stop the backend; within 30 seconds the indicator goes red
     and the banner appears with the network error message.
  5. Log out, log in as a non-admin (or kiosk JWT); indicator and
     banner are both absent.

DELIVERABLE
A summary report covering:
- The popover/overlay primitive you used (existing or CDK Overlay)
  and why.
- Any new design tokens added to styles.css @theme.
- The exact location in the app shell where the indicator + banner
  were inserted (file path + line numbers).
- Any deviations with reasons.
- Manual smoke evidence (screenshots OR a short numbered description
  of each state observed).
- Anything worth tightening in Slice 5 (token hygiene + rotation
  runbook).

When you are done, STOP. Do not start Slice 5.
