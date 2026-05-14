/* global React */
const { useEffect, useMemo, useRef, useState } = React;

/* ────────────────────────────────────────────────────────────────
   Status & tint logic — the heart of the Ambient retrofit
   ──────────────────────────────────────────────────────────────── */

// Their existing palette: ['#37c79a','#56b9ff', ...]
const PALETTE = ['#37c79a', '#56b9ff', '#b07cff', '#ffa84d', '#ff7a7a', '#7adcff'];

// Tone colors — the SAME values the existing --tone-color var uses, just expanded
// to derive a matching subtle background tint per status.
const TONE = {
  ok:    { bar: '#37c79a', name: 'OK'      },
  warn:  { bar: '#f5b428', name: 'WARN'    },
  crit:  { bar: '#e64b3c', name: 'CRIT'    },
  stale: { bar: '#9aa0a6', name: 'STALE'   },
};

// Tint intensity ramp — drives the alpha of the card background fill.
// Subtle-at-OK / strong-at-crit per requirement.
const TINT = {
  subtle: { ok: 0.03, warn: 0.08,  crit: 0.14, stale: 0.03 },
  medium: { ok: 0.05, warn: 0.12,  crit: 0.20, stale: 0.05 },
  strong: { ok: 0.08, warn: 0.18,  crit: 0.30, stale: 0.07 },
};

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0,2), 16);
  const g = parseInt(h.slice(2,4), 16);
  const b = parseInt(h.slice(4,6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Returns the four custom-property values that a widget needs to render Ambient.
// In the Angular shell these map 1:1 to existing --tone-color plus three new vars.
function toneStyle(status, intensity, dark) {
  const t = TONE[status];
  const alpha = TINT[intensity][status];
  // In dark mode push alpha slightly so it remains perceptible against #14171c.
  const tintA = dark ? Math.min(0.42, alpha * 2.2) : alpha;
  // Border picks up a hint of tone for crit/warn; stays neutral for ok/stale.
  const borderA = status === 'crit' ? (dark ? 0.65 : 0.5)
              : status === 'warn' ? (dark ? 0.45 : 0.32)
              : (dark ? 0.10 : 0.08);
  return {
    '--tone-color': t.bar,
    '--tone-tint':  hexToRgba(t.bar, tintA),
    '--tone-edge':  hexToRgba(t.bar, borderA),
    '--tone-text':  status === 'crit' ? t.bar : (dark ? '#e6e8eb' : '#1d2024'),
  };
}

/* ────────────────────────────────────────────────────────────────
   Tiny chart primitives (no ApexCharts — but shaped to feel like it)
   ──────────────────────────────────────────────────────────────── */

function makeSeries(n, base, variance, seed = 1) {
  const rng = mulberry32(seed);
  const pts = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v += (rng() - 0.5) * variance;
    pts.push(v);
  }
  return pts;
}
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function LineSpark({ series, color, dark, height = 56, smooth = true, area = true }) {
  // Multi-series small-multiple line chart, ApexCharts area-style.
  const seriesArr = Array.isArray(series[0]) ? series : [series];
  const colorArr  = Array.isArray(color) ? color : [color];
  const W = 100, H = 100; // viewBox; will stretch
  const all = seriesArr.flat();
  const min = Math.min(...all), max = Math.max(...all);
  const range = max - min || 1;
  const path = (s) => {
    const step = W / (s.length - 1);
    let d = '';
    s.forEach((v, i) => {
      const x = i * step;
      const y = H - ((v - min) / range) * (H - 8) - 4;
      if (i === 0) d += `M${x.toFixed(2)},${y.toFixed(2)}`;
      else if (smooth) {
        const px = (i - 1) * step;
        const cx1 = px + step / 2;
        const cx2 = x - step / 2;
        d += ` C${cx1.toFixed(2)},${(H - ((s[i-1]-min)/range)*(H-8)-4).toFixed(2)} ${cx2.toFixed(2)},${y.toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`;
      } else {
        d += ` L${x.toFixed(2)},${y.toFixed(2)}`;
      }
    });
    return d;
  };
  const areaPath = (s) => `${path(s)} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      <defs>
        {colorArr.map((c, i) => (
          <linearGradient key={i} id={`g${i}-${c.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity={dark ? 0.5 : 0.32} />
            <stop offset="100%" stopColor={c} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {seriesArr.map((s, i) => (
        <g key={i}>
          {area && <path d={areaPath(s)} fill={`url(#g${i}-${colorArr[i].replace('#','')})`} />}
          <path d={path(s)} fill="none" stroke={colorArr[i]} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </svg>
  );
}

function BarMini({ series, color, dark, height = 56 }) {
  const groups = series; // [[v,v,v,v], …] one row per sensor
  const max = Math.max(...groups.flat());
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, padding: '2px 0' }}>
      {groups[0].map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 1, alignItems: 'flex-end', flex: 1 }}>
          {groups.map((row, gi) => (
            <div key={gi}
              style={{
                width: `calc((100% - ${(groups.length-1)*1}px) / ${groups.length})`,
                height: `${(row[i] / max) * 100}%`,
                background: color[gi % color.length],
                opacity: 0.92,
                borderRadius: 1,
                minHeight: 2,
              }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Gauge({ value, min, max, unit, status, dark }) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const angle = -110 + pct * 220; // -110° to +110°
  const ringColor = dark ? '#2a2f37' : '#eceef1';
  const fill = TONE[status].bar;
  // Arc geometry
  const R = 36, cx = 50, cy = 50;
  const start = polar(cx, cy, R, -110);
  const end   = polar(cx, cy, R,  110);
  const cur   = polar(cx, cy, R, angle);
  const largeBg = 1;
  const largeFg = pct > 0.5 ? 1 : 0;
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', flex: 1, minHeight: 0 }}>
      <svg viewBox="0 0 100 70" style={{ width: '100%', maxHeight: '100%', display: 'block' }}>
        <path d={arcPath(start, end, R, largeBg)} fill="none" stroke={ringColor} strokeWidth="7" strokeLinecap="round" />
        <path d={arcPath(start, cur, R, largeFg)} fill="none" stroke={fill}      strokeWidth="7" strokeLinecap="round" />
        <circle cx={cur.x} cy={cur.y} r="3" fill={fill} stroke={dark ? '#14171c' : '#fff'} strokeWidth="1.5" />
      </svg>
      <div style={{ position: 'absolute', bottom: 2, left: 0, right: 0, textAlign: 'center', lineHeight: 1 }}>
        <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--tone-text)', letterSpacing: '-0.01em' }}>
          {value.toFixed(1)}<span style={{ fontSize: 11, fontWeight: 500, marginLeft: 3, color: dark ? '#8a9099' : '#6b7079' }}>{unit}</span>
        </div>
      </div>
    </div>
  );
  function polar(cx, cy, r, deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  function arcPath(a, b, r, large) {
    return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
  }
}

/* ────────────────────────────────────────────────────────────────
   Widget shell — preserves the existing AppWidgetsShellComponent
   conventions: 2 px tone bar, chrome on hover, drag handle.
   ──────────────────────────────────────────────────────────────── */

function WidgetShell({ title, status, sensorIds, dark, tintIntensity, showToneBar, children, foot, onAck, sparkColor, freshness, chromeMode = 'hover' }) {
  const style = toneStyle(status, tintIntensity, dark);
  const [hover, setHover] = useState(false);
  const showChrome = chromeMode === 'always' || (chromeMode === 'hover' && hover) || status === 'crit';
  return (
    <div
      className="widget"
      style={{
        ...style,
        background: `linear-gradient(0deg, var(--tone-tint), var(--tone-tint)), ${dark ? '#181c22' : '#ffffff'}`,
        border: `1px solid var(--tone-edge)`,
        boxShadow: dark ? '0 1px 0 rgba(255,255,255,0.02)' : '0 1px 2px rgba(15,20,30,0.04)',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {showToneBar && <div className="tone-bar" />}
      <div className="widget-head">
        <div className="widget-title">
          <span className="dot" style={{ background: 'var(--tone-color)' }} />
          <span>{title}</span>
          {sensorIds && <span className="sensor-ids">#{sensorIds.join(' #')}</span>}
        </div>
        <div className={`widget-chrome ${showChrome ? 'shown' : ''}`}>
          {status === 'crit' && onAck && (
            <button className="chrome-btn primary" onClick={onAck}>Acknowledge</button>
          )}
          <button className="chrome-btn" title="Edit settings">⚙</button>
          <button className="chrome-btn drag-handle" title="Drag">⋮⋮</button>
        </div>
      </div>
      <div className="widget-body">{children}</div>
      {foot && <div className="widget-foot">{foot}</div>}
      {freshness && (
        <div className="freshness">
          <span className="pulse" style={{ background: status === 'stale' ? '#9aa0a6' : '#37c79a' }} />
          {freshness}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   The four widget types, each retrofitted with Ambient
   ──────────────────────────────────────────────────────────────── */

function LineChartWidget({ widget, dark, tintIntensity, showToneBar }) {
  const colors = widget.sensor_ids.map((_, i) => PALETTE[i % PALETTE.length]);
  const series = widget.sensor_ids.map((id, i) => makeSeries(48, 4.7 + i*0.05, 0.12, id*7 + 3));
  return (
    <WidgetShell
      title={widget.title}
      sensorIds={widget.sensor_ids}
      status={widget.status}
      dark={dark}
      tintIntensity={tintIntensity}
      showToneBar={showToneBar}
      foot={
        <div className="legend-row">
          {widget.sensor_ids.map((id, i) => (
            <span key={id} className="legend-item">
              <i style={{ background: colors[i] }} />
              {widget.sensor_labels[i]}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', color: dark ? '#6b7079' : '#8a9099' }}>
            agg · 60m bucket
          </span>
        </div>
      }
    >
      <LineSpark series={series} color={colors} dark={dark} height={120} />
    </WidgetShell>
  );
}

function BarChartWidget({ widget, dark, tintIntensity, showToneBar }) {
  const colors = widget.sensor_ids.map((_, i) => PALETTE[i % PALETTE.length]);
  const series = widget.sensor_ids.map((id, i) => makeSeries(12, 60 + i*15, 14, id*13 + 11));
  return (
    <WidgetShell
      title={widget.title}
      sensorIds={widget.sensor_ids}
      status={widget.status}
      dark={dark}
      tintIntensity={tintIntensity}
      showToneBar={showToneBar}
      foot={
        <div className="legend-row">
          {widget.sensor_ids.map((id, i) => (
            <span key={id} className="legend-item">
              <i style={{ background: colors[i] }} />
              {widget.sensor_labels[i]}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', color: dark ? '#6b7079' : '#8a9099' }}>
            avg per sensor
          </span>
        </div>
      }
    >
      <BarMini series={series} color={colors} dark={dark} height={120} />
    </WidgetShell>
  );
}

function GaugeWidget({ widget, dark, tintIntensity, showToneBar, liveValue }) {
  const v = liveValue ?? widget.value;
  const pct = (v - widget.gauge_min) / (widget.gauge_max - widget.gauge_min);
  // Their existing tone logic: normal <80%, warning <95%, danger ≥95%
  const status = widget.forceStatus ?? (pct >= 0.95 ? 'crit' : pct >= 0.80 ? 'warn' : 'ok');
  return (
    <WidgetShell
      title={widget.title}
      sensorIds={widget.sensor_ids}
      status={status}
      dark={dark}
      tintIntensity={tintIntensity}
      showToneBar={showToneBar}
      freshness="live · 2s"
      foot={
        <div className="legend-row" style={{ justifyContent: 'space-between' }}>
          <span>{widget.gauge_min}</span>
          <span style={{ color: dark ? '#8a9099' : '#6b7079' }}>{widget.unit}</span>
          <span>{widget.gauge_max}</span>
        </div>
      }
    >
      <Gauge value={v} min={widget.gauge_min} max={widget.gauge_max} unit={widget.unit} status={status} dark={dark} />
    </WidgetShell>
  );
}

function StatCardWidget({ widget, dark, tintIntensity, showToneBar, liveValue, onAck }) {
  const v = liveValue ?? widget.value;
  const status = widget.status;
  const series = makeSeries(36, v, widget.variance ?? 1, widget.sensor_ids[0]*5 + 9);
  const delta = ((series[series.length-1] - series[0]) / series[0]) * 100;
  return (
    <WidgetShell
      title={widget.title}
      sensorIds={widget.sensor_ids}
      status={status}
      dark={dark}
      tintIntensity={tintIntensity}
      showToneBar={showToneBar}
      freshness={status === 'stale' ? 'stale · 14m ago' : (status === 'crit' ? 'no data · 14m' : 'live · 2s')}
      onAck={status === 'crit' ? onAck : null}
    >
      <div className="stat-body">
        <div className="stat-num">
          <span className="num" style={{ color: 'var(--tone-text)' }}>
            {status === 'stale' || status === 'crit' && widget.offline ? '—' : v.toFixed(widget.decimals ?? 1)}
          </span>
          <span className="unit">{widget.unit}</span>
        </div>
        <div className="stat-meta">
          <span className={`delta ${delta >= 0 ? 'up' : 'down'}`} style={{ color: status === 'ok' ? (delta >= 0 ? '#37c79a' : '#e64b3c') : 'inherit' }}>
            {status === 'stale' || (status === 'crit' && widget.offline) ? '—' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(2)}%`}
          </span>
          <span style={{ color: dark ? '#6b7079' : '#8a9099' }}>vs 2h ago</span>
        </div>
        <div className="stat-spark">
          {!(status === 'stale' || (status === 'crit' && widget.offline)) && (
            <LineSpark series={series} color={status === 'crit' ? '#e64b3c' : '#37c79a'} dark={dark} height={32} smooth area />
          )}
        </div>
      </div>
    </WidgetShell>
  );
}

Object.assign(window, {
  PALETTE, TONE, TINT, toneStyle, hexToRgba,
  LineSpark, BarMini, Gauge,
  WidgetShell, LineChartWidget, BarChartWidget, GaugeWidget, StatCardWidget,
  makeSeries,
});
