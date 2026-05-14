# Handoff — Ambient status tinting for the dashboard widgets

> **Prompt for the agent — paste this into Claude Code / Cursor / your tool of choice as the first message:**
>
> > Implement the Ambient status-tinting retrofit described in `README.md` of this folder. The change is **additive** to `AppWidgetsShellComponent` — keep the existing 2 px `.tone-bar`, the chrome-on-hover pattern, the dragHandleClass, the `--tone-color` CSS custom property, and the existing tone-state derivation (the "normal <80% / warning <95% / danger ≥95%" rule for gauges, plus whatever you currently use for stat_card / line_chart). Add three new CSS custom properties (`--tone-tint`, `--tone-edge`, `--tone-text`) computed from the same status. Use the values in `tokens.md`. Visual reference: open `MONEO Ambient Dashboard.html` in this folder — light & dark modes, four widget types, four status states. Stop after the shell + tokens change; do not touch widget bodies, chart configs, or API code. Acceptance criteria are in `README.md §6`.

---

## 1. Overview

The current dashboard renders widgets on a plain `--bg-card` background with a 2 px left tone bar reflecting status. From across a room, all widgets look the same regardless of whether they're healthy, warning, critical, or stale — the operator has to land on the tone bar (or the gauge needle, or the numbers) to read state.

**Ambient retrofit:** the widget's *entire background* becomes a very subtle wash of its status colour. Healthy widgets are barely tinted (α ≈ 0.03 in light mode, 0.06 in dark). Critical widgets fill noticeably (α ≈ 0.14 / 0.30). The 2 px tone bar stays — it's the second redundant cue, useful for colour-blind users and for screenshots where saturation may be crushed.

**What it changes:** purely the visual treatment of `app-widgets-shell` (the widget chrome). No template restructure, no new components, no API changes, no behavioural changes.

## 2. About the design files

The HTML/JSX files in this folder are **design references created as a prototype**, not production code to copy. The agent's job is to **port the visual treatment into the existing Angular codebase**, reusing `AppWidgetsShellComponent` and its Tailwind classes. Treat the JSX shell as documentation of intent; the Angular shell stays the source of truth for structure and behaviour.

## 3. Fidelity

**High-fidelity.** All colour values, tint alphas, border treatments, and dark-mode pairings are specified exactly in `tokens.md`. Padding, typography, drag-handle position, chrome behaviour and grid metrics are **not** part of this change — leave them untouched.

## 4. The change, in code

### 4a. New CSS custom properties on `.widget`

The existing shell already sets `--tone-color`. Compute three more from the same status value:

```html
<!-- before (current shell template, simplified) -->
<div class="widget" [style.--tone-color]="toneColor">
  <div class="tone-bar"></div>
  <header class="widget-head"> … </header>
  <ng-content></ng-content>
</div>
```

```html
<!-- after — three additional inline custom properties -->
<div
  class="widget"
  [style.--tone-color]="toneColor"
  [style.--tone-tint]="toneTint"
  [style.--tone-edge]="toneEdge"
  [style.--tone-text]="toneText">
  <div class="tone-bar"></div>
  <header class="widget-head"> … </header>
  <ng-content></ng-content>
</div>
```

### 4b. Derive the three new values

In the component class, alongside whatever already computes `toneColor` from status:

```ts
type Status = 'ok' | 'warn' | 'crit' | 'stale';

// Single source of truth for the alpha ramp.
// Default to 'subtle'. Promote to 'medium' or 'strong' from user preference
// later — they're already covered by the constant.
private static TINT = {
  subtle: { ok: 0.03, warn: 0.08, crit: 0.14, stale: 0.03 },
  medium: { ok: 0.05, warn: 0.12, crit: 0.20, stale: 0.05 },
  strong: { ok: 0.08, warn: 0.18, crit: 0.30, stale: 0.07 },
} as const;

private static EDGE = {
  ok:    { light: 0.08, dark: 0.10 },
  warn:  { light: 0.32, dark: 0.45 },
  crit:  { light: 0.50, dark: 0.65 },
  stale: { light: 0.08, dark: 0.10 },
} as const;

private toneOf(status: Status, hex: string, intensity: keyof typeof AppWidgetsShellComponent.TINT = 'subtle'): {
  color: string; tint: string; edge: string; text: string;
} {
  const dark = document.documentElement.classList.contains('dark');
  const tintA = AppWidgetsShellComponent.TINT[intensity][status] * (dark ? 2.2 : 1);
  const edgeA = AppWidgetsShellComponent.EDGE[status][dark ? 'dark' : 'light'];
  return {
    color: hex,
    tint:  this.rgba(hex, Math.min(0.42, tintA)),
    edge:  this.rgba(hex, edgeA),
    text:  status === 'crit' ? hex : (dark ? '#e6e8eb' : '#1d2024'),
  };
}

private rgba(hex: string, a: number) {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
```

> The same `MutationObserver` you already use for ApexCharts theme re-binding should fire `cdr.markForCheck()` on the shell so the tint alpha recomputes when the user toggles theme. The tint values are *not* CSS-only — they bake the alpha at compute time so the rendered colour is correct against the per-theme card background.

### 4c. Replace the `.widget` background rule

```scss
// before
.widget {
  background: var(--bg-card);
  border: 1px solid var(--line);
}

// after
.widget {
  background:
    linear-gradient(0deg, var(--tone-tint), var(--tone-tint)),
    var(--bg-card);
  border: 1px solid var(--tone-edge);
  transition: background-color 180ms ease, border-color 180ms ease;
}

// Crit widgets get a stronger visual escalation — the 2px tone bar's
// opacity stays the same, but the border colour is now ~50% saturated.
// No new shadow, no animation by default. (If you want a pulse, gate
// it behind a per-user setting; pulsing alarms wear thin fast.)
```

### 4d. Critical-state text colour

The headline value (e.g. `46.2 %RH`, `5.1 bar`) currently uses `var(--ink)`. Switch it to `var(--tone-text)` so it picks up the tone colour only when status is `crit`:

```scss
.stat-card .value,
.gauge-widget .value {
  color: var(--tone-text);
}
```

## 5. Status mapping (don't change unless we agree)

| Widget type | Status comes from |
|---|---|
| `gauge`     | Existing rule: `pct = (value − min) / (max − min)`. `crit` if pct ≥ 0.95, `warn` if ≥ 0.80, else `ok`. |
| `stat_card` | `AlertConfig` once wired. Until then, `crit` only if last WS tick > 30 s old (treat as offline). |
| `line_chart`, `bar_chart` | `ok` unless any of their `sensor_ids` is `crit` or `warn` — propagate the highest severity. |
| Any         | `stale` if no WS tick in 30 s. (See gap below.) |

**Backend gap to fix in parallel:** `GET /api/sensors/{id}/latest` currently returns the value but no timestamp. Add `recorded_at` (ISO 8601) to the response so the shell can resolve `stale` independently of WS health. Until then, infer stale from `Date.now() − lastWsTick > 30_000`.

## 6. Acceptance criteria

1. **OK at rest:** an all-healthy dashboard reads as "almost no colour." Diff vs current ≈ 3 % tint, not 10 %.
2. **Critical reads from 2 m:** with one widget in `crit` and the rest `ok`, the offending widget is unambiguous without leaning into the screen.
3. **Tone bar preserved:** the existing 2 px left bar still renders identically. No regression in chrome-on-hover, drag-handle, or settings/edit affordances.
4. **Theme parity:** light and dark mode each look right; the tint alpha multiplier handles the perceptual difference.
5. **Per-widget cost:** `toneOf()` runs once per status-change, not per CD cycle. Memoize on `{status, intensity, theme}`.
6. **No layout shift.** Border width stays 1 px; padding unchanged.

## 7. Files in this bundle

| File | What it is |
|---|---|
| `MONEO Ambient Dashboard.html` | The hi-fi prototype. Open it; toggle the Tweaks panel to compare subtle/medium/strong tint, theme, and critical-demo. |
| `widgets.jsx` | JSX implementation of the four widget types — read this for the tint/edge/text math and the gauge/spark primitives. |
| `app.jsx` | The dashboard shell — header, grid, dev-note. |
| `data.jsx` | Fixture data shaped like a real `DashboardWidget` row (mirrors your settings JSON). |
| `tokens.md` | Just the design tokens, as a flat reference. |
| `current-state.png` | Screenshot the user provided of the current production dashboard, for before/after orientation. |

## 8. What this handoff is NOT asking for

- ❌ New widget types
- ❌ Sensor picker rework (deferred to a later pass)
- ❌ Drill-down redesign
- ❌ Edit mode redesign
- ❌ Replacing ApexCharts
- ❌ Migrating off angular-gridster2
- ❌ Touching the `RealtimeService` WS contract

If the agent thinks any of these is required to land the change, it's wrong — push back.
