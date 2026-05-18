# Slice 4 — State (implementing agent's feedback)

## Overlay / popover primitive used

Simple `*ngIf` + `position: absolute` — identical to the user-menu
dropdown already in `AppPageHeaderComponent`. No Angular CDK Overlay
introduced. This is consistent with the existing pattern and
requires no new imports.

## New design tokens added to `styles.css` `@theme`

```css
--color-status-ok:      oklch(0.70 0.12 155);   /* healthy  */
--color-status-warn:    oklch(0.78 0.14 85);    /* degraded */
--color-status-error:   oklch(0.62 0.16 30);    /* failed   */
--color-status-pending: oklch(0.66 0.01 255);   /* neverSynced / awaiting */
```

Documented in `frontend/STYLE_PATCH_REPORT.md` under "Slice 4 Token
Additions".

## Exact insertion points

| Element | File | Insertion |
|---|---|---|
| `<app-sync-status-indicator>` | `frontend/src/app/modules/layout/app-page-header.component.html` | Before the user-pill `<div class="relative user-menu">` (line 56 in the original) |
| `<app-sync-status-banner>` | `frontend/src/app/modules/layout/app-shell.component.html` | Between `<app-page-header>` and the `<div class="flex-1 min-h-0 flex">` wrapper |

## All new files

| File | Purpose |
|---|---|
| `frontend/src/app/types/sync-health.ts` | `DerivedStatus`, `LastStatus`, `SyncSource`, `SyncHealth` interfaces |
| `frontend/src/app/core/services/sync-health.service.ts` | Service — `getHealth()`, `watchHealth()`, `forceRefresh()`, adapter, `_computeOverall` |
| `frontend/src/app/core/services/sync-health.service.spec.ts` | 9 unit tests — adapter, overall matrix, 403→null, network error→synthetic |
| `shared/components/sync-status-indicator/` | Pill indicator, opens panel on click/Enter, hides on null health |
| `shared/components/sync-status-panel/` | Two-source detail panel, lag humanizer, error expand, refresh button |
| `shared/components/sync-status-banner/` | Red sticky banner for `overall=failed`, sessionStorage dismissal with error-signature |
| `frontend/e2e/sync-status.spec.ts` | 5 Playwright cases (SYNC-01…05) — all use `page.route()` to stub the health endpoint |

## Build & test results

- `ng build` — zero errors; two pre-existing budget warnings only
  (unchanged from before Slice 4).
- Karma — **68 passed / 5 failed**; all 5 failures are pre-existing
  (`sensor-status.spec.ts` × 4, `app.spec.ts` × 1); all 35 new
  Slice 4 specs pass.

## Deviations

1. **`watchHealth` stream memoised at service level** — the spec
   says `shareReplay(1)` to share one HTTP cycle; also added a
   `_manualRefresh$` Subject merged into the timer so the panel's
   Refresh button triggers an immediate re-poll via `forceRefresh()`.
   This keeps the banner and indicator always in sync.
2. **Banner hosts its own panel instance** — the "View details" link
   opens `SyncStatusPanelComponent` directly inside the banner
   (positioned `fixed top-right`). This avoids a cross-component
   communication bus between the banner and the indicator's panel.
   Both instances are separate; if both are open simultaneously,
   they'd show independent views of the same `watchHealth$` stream.
3. **Pre-existing Karma failures not introduced** — the 5
   pre-existing test failures (`sensor-status.spec.ts` +
   `app.spec.ts`) were failing before Slice 4 and remain unchanged.

## Notes for Slice 5 (token hygiene + rotation runbook)

- The `auth_token` in `localStorage` has no expiry enforcement in
  the frontend — the auth interceptor only reacts to 401s from the
  server. If Slice 5 introduces token rotation, the interceptor at
  `frontend/src/app/core/auth/auth-interceptor.service.ts` will need
  to handle 401 by attempting a refresh before redirecting.
  (Note from the planning side: this is about the user JWT, not the
  MONEO PAT — they're separate token lifecycles.)
- The kiosk token lives in `sessionStorage` (via `KioskService`) —
  if tokens rotate, kiosk sessions will need a re-injection
  mechanism.
- The new `watchHealth()` polling stream pauses on `document.hidden`
  — token rotation should not be tied to the poll cycle, but any
  401 from the health endpoint will be caught by the existing
  interceptor and redirect to login correctly.

## Suggested commit message

```
Slice 4 - Frontend sync-status surface

* types/sync-health.ts: DerivedStatus / LastStatus / SyncSource / SyncHealth interfaces
* SyncHealthService: getHealth(), watchHealth() (30s poll + visibility pause), forceRefresh()
  - 403 → null (hides surface for non-admins)
  - network/5xx → synthetic SyncHealth{overall:'failed'} so indicator goes red on real outage
  - neverSynced derived: failed + lastSuccessAt=null → pending, not failed
* SyncStatusIndicatorComponent: pill in header (green/amber/red/gray dot + label)
* SyncStatusPanelComponent: per-source detail rows, lag humanizer, error expand, refresh
* SyncStatusBannerComponent: sticky red banner on overall=failed; sessionStorage dismissal
  with error-signature re-show logic; "View details" opens inline panel
* SharedModule: registers + exports all three components
* app-page-header.component.html: indicator inserted before user-pill
* app-shell.component.html: banner inserted between header and main content
* styles.css @theme: --color-status-ok/warn/error/pending tokens added
* 35 new Karma unit tests (all pass); 5 Playwright e2e cases (SYNC-01…05)
```
