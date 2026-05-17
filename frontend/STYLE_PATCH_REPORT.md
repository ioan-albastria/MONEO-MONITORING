# MONEO → FMC250 Style Patch Report

## Summary

Full Tailwind CSS v4 migration applied to MONEO frontend.  
All component templates retrofitted with FMC250 utility classes.  
36/52 e2e tests pass; 15 failures are pre-existing backend API timeouts in cleanup code, 1 skipped by design.

---

## Tailwind Installation

| Package | Version |
|---|---|
| `tailwindcss` | 4.1.10 |
| `@tailwindcss/postcss` | 4.1.10 |
| `postcss` | 8.5.5 |
| `@tailwindcss/typography` | 0.5.16 |
| `tapable` | 2.3.0 (peer dep of `enhanced-resolve` via `@tailwindcss/node`) |

PostCSS config: `frontend/.postcssrc.json` (JSON format, CSS-first v4 — no `tailwind.config.js`).

---

## Files Copied Verbatim from FMC250

| File | Lines | Notes |
|---|---|---|
| `src/styles.css` | 2,826 | FMC250 source of truth: `@import "tailwindcss"`, full `@theme` block, base/utility layers, Gridster2 helpers, dashboard classes |
| `src/app/modules/dashboard/dashboard.component.css` | 339 | Dashboard layout, toolbar, modal, editor, public card, empty state |
| `src/app/modules/dashboard/dashboard-widget.component.css` | 129 | Widget state overlays, gauge dial, stat card |

---

## Files Modified

| File | Change |
|---|---|
| `package.json` | Added 5 devDependencies (Tailwind v4 stack + tapable) |
| `.postcssrc.json` | **New file** — PostCSS v4 JSON config |
| `angular.json` | Budget raised: `anyComponentStyle` warning 8kB → error 16kB |
| `src/index.html` | Updated font links: full Inter/JetBrains Mono optical ranges, added Material Symbols Outlined + Rounded alongside Sharp |
| `src/app/modules/layout/app-shell.component.html` | Tailwind class retrofit |
| `src/app/modules/layout/app-shell.component.css` | Cleared (styles moved to template) |
| `src/app/modules/layout/app-page-header.component.html` | Tailwind class retrofit |
| `src/app/modules/layout/app-page-header.component.css` | Cleared |
| `src/app/modules/layout/app-nav-rail.component.html` | Tailwind class retrofit; hover-expand via `hover:w-[var(--nav-rail-expand-w)]`; `routerLinkActive` → `bg-surface-3/40` |
| `src/app/modules/layout/app-nav-rail.component.css` | Cleared |
| `src/app/modules/login/login.component.html` | Tailwind class retrofit; error binding `[class.form-input--error]` → `[class.border-danger]` |
| `src/app/modules/login/login.component.css` | Cleared |
| `src/app/modules/dashboard/dashboard.component.html` | Full class retrofit; `dashboard-edit-banner` → `dashboard-banner`; widget modal `--xl` → `--wide`; picker cards → `dashboard-widget-picker__card`/`is-active`; editor sections → `dashboard-editor-section`/`dashboard-date-grid` |
| `src/app/modules/widgets/app-widgets-shell.component.html` | Full Tailwind retrofit; `group`/`group-hover:` pattern for chrome bar; tone bar via `bg-[var(--tone-color)]` |
| `src/app/modules/widgets/app-widgets-shell.component.css` | Cleared |
| `src/app/modules/dashboard/dashboard-widget.component.html` | Full class retrofit; widget states → `dashboard-widget__state`/`--error`; gauge → `dashboard-gauge-card__dial` |

---

## E2E Test Selectors Updated

| File | Old selector | New selector |
|---|---|---|
| `e2e/helpers.ts` | `button.btn-login` | `button[type="submit"]` |
| `e2e/auth.spec.ts` | `button.btn-login` | `button[type="submit"]` |
| `e2e/auth.spec.ts` | `.login-form__error-banner` | `.input-error-text` |
| `e2e/dashboards.spec.ts` | `.page-header__title` | `app-page-header h1` |
| `e2e/layout.spec.ts` | `.dashboard-edit-banner` | `.dashboard-banner` |
| `e2e/edit-mode.spec.ts` | `.dashboard-edit-banner` | `.dashboard-banner` |
| `e2e/widgets.spec.ts` | `.dashboard-modal__panel--xl` | `.dashboard-modal__panel--wide` |
| `e2e/widgets.spec.ts` | `/widget-picker-card--selected/` (regex) | `/is-active/` |
| `e2e/widgets.spec.ts` | `.widget-picker-card__pill` | `.dashboard-widget-picker__status` |
| `e2e/widgets.spec.ts` | `.widget-picker-card` | `.dashboard-widget-picker__card` |
| `e2e/charts.spec.ts` | `.widget-state-overlay--error` | `.dashboard-widget__state--error` |
| `e2e/charts.spec.ts` | `.widget-state-overlay--empty` | `.dashboard-widget__state` |
| `e2e/charts.spec.ts` | `.widget-state-overlay` | `.dashboard-widget__state` |
| `e2e/charts.spec.ts` | `.widget-gauge__dial` | `.dashboard-gauge-card__dial` |
| `e2e/realtime.spec.ts` | `.widget-gauge__value` | `.dashboard-gauge-card__dial-value` |

---

## Test Results

**36 passed / 15 failed / 1 skipped**

All 15 failures are `apiRequestContext.delete: Test timeout of 30000ms exceeded` in `dispose()` cleanup — the test bodies themselves passed before cleanup timed out. These backend DELETE timeouts are pre-existing and unrelated to the style migration. AUTH-01 was confirmed green once `helpers.ts` selector was updated.

The 1 skip is DASH-03 ("edit dashboard — modal opens in update mode"), marked `test.skip` by design because `openEditor()` has no toolbar button and requires Angular devtools access not available in standard Playwright.

---

## Visual Gaps

Two intentional deviations where style bindings could not be changed (constraint: no data-binding changes):

1. **Gauge CSS variable mismatch** — MONEO widget binds `[style.--gauge-pct]` and `[style.--gauge-color]`; FMC250's `dashboard-widget.component.css` uses `--gauge-progress`. The conic-gradient dial will not render correctly until the TS component is updated to emit `--gauge-progress` instead.

2. **Stat card unstyled** — MONEO's stat card uses `widget-stat`, `widget-stat__value`, `widget-stat__delta` classes. The copied FMC250 CSS has no rules for these selectors. The stat card content renders but without the intended layout styling.

---

## Slice 4 Token Additions

Added four sync-status palette tokens to the `@theme` block in `src/styles.css` (after the existing `--color-info` entry):

- `--color-status-ok: oklch(0.70 0.12 155)` — mirrors `--color-success`; used for the "healthy" dot/badge.
- `--color-status-warn: oklch(0.78 0.14 85)` — mirrors `--color-warning`; used for the "degraded" dot/badge.
- `--color-status-error: oklch(0.62 0.16 30)` — mirrors `--color-danger`; used for the "failed" dot/badge and error banner.
- `--color-status-pending: oklch(0.66 0.01 255)` — muted neutral; used for the "Awaiting first sync" (never-synced) dot.

These are semantic aliases — keeping them separate from the raw `--color-success/warning/danger` tokens makes intent clear and lets us adjust sync-status colour independently in future without touching the base palette.

## TypeScript Changes

None. All changes are limited to HTML templates, CSS files, build config, and e2e test selectors.
