# Tokens — Ambient status tinting

All values are designed to compose with the existing `--tone-color` and `.tone-bar` treatment without replacing them. The shell stays; this just adds three more CSS custom properties driven by the same status value.

## Tone colours (bar + tint source)

| Status | Hex       | Notes |
|--------|-----------|-------|
| `ok`   | `#37c79a` | Already the brand primary in the existing palette `['#37c79a','#56b9ff',…]`. |
| `warn` | `#f5b428` | New. Slightly desaturated amber. |
| `crit` | `#e64b3c` | New. Avoid pure red — too aggressive in dark mode. |
| `stale`| `#9aa0a6` | Neutral grey; signals *no data* rather than *bad data*. |

## Tint alpha ramp (`--tone-tint`)

Tint is applied as a `linear-gradient` overlay on top of `var(--bg-card)`. Default intensity is **subtle**. Each level is exposed as a per-user preference (cheap; renders in the same shell).

| Intensity | OK   | WARN | CRIT | STALE |
|-----------|------|------|------|-------|
| subtle    | 0.03 | 0.08 | 0.14 | 0.03  |
| medium    | 0.05 | 0.12 | 0.20 | 0.05  |
| strong    | 0.08 | 0.18 | 0.30 | 0.07  |

In dark mode, multiply by **2.2** (clamp at 0.42) — the same hex colour reads fainter against `#181c22` than against `#ffffff`, so the perceptual ramp needs a boost.

## Border alpha (`--tone-edge`)

Border is also derived from the tone colour, but with a much steeper ramp so `crit` borders are clearly coloured while `ok`/`stale` borders stay near-neutral.

| Status | Light | Dark |
|--------|-------|------|
| ok     | 0.08  | 0.10 |
| warn   | 0.32  | 0.45 |
| crit   | 0.50  | 0.65 |
| stale  | 0.08  | 0.10 |

## Text colour (`--tone-text`)

Used by the headline value in `stat_card` and the centred number in `gauge`.

| Status     | Light       | Dark        |
|------------|-------------|-------------|
| ok / warn  | `#1d2024`   | `#e6e8eb`   |
| crit       | `#e64b3c`   | `#e64b3c`   |
| stale      | `#6b7079`   | `#8a9099`   |

## Surface tokens (already in app — listed for completeness)

| Token        | Light       | Dark        |
|--------------|-------------|-------------|
| `--bg`       | `#f4f5f7`   | `#0e1116`   |
| `--bg-card`  | `#ffffff`   | `#181c22`   |
| `--line`     | `#e4e6eb`   | `#262b32`   |
| `--ink`      | `#1d2024`   | `#e6e8eb`   |
| `--muted`    | `#6b7079`   | `#8a9099`   |

## Animation

- Background and border transitions: `180ms ease`. Status changes shouldn't strobe.
- No pulse animation by default. If we ever ship one, gate it behind a user preference and limit to `crit`-state widgets that haven't been acknowledged.

## Grid metrics (unchanged — do not modify)

- Columns: 24
- Cell width: 56 px (48 px in compact mode)
- Cell height: 64 px (52 px in compact mode)
- Gap: 8 px
- Drag-handle class: `dashboard-widget-drag-handle`

## CSS-only fallback (no JS recompute)

If you want the cascade-only version (no `MutationObserver` rebind on theme toggle), you can move the tint computation into CSS variables scoped by status class — but the perceptual dark-mode multiplier is the reason we bake the alpha in JS. Recommend keeping it in JS.
