/* global React, ReactDOM, DASHBOARD, GaugeWidget, LineChartWidget, BarChartWidget, StatCardWidget */
const { useEffect, useMemo, useRef, useState } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "tintIntensity": "subtle",
  "showToneBar": true,
  "dark": false,
  "compact": false,
  "demoCritical": false,
  "showLegend": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [now, setNow] = useState(Date.now());
  const [acked, setAcked] = useState(new Set());

  // Simulate WebSocket ticks every 5s (per spec) — gauge + stat_card only
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Live values derived from a smooth oscillation around base
  const tick = (id, base, amp) => {
    const phase = (now / 30000) + id * 0.37;
    return base + Math.sin(phase) * amp;
  };

  const widgets = useMemo(() => {
    return DASHBOARD.widgets.map(w => {
      let mod = { ...w };
      // Demo critical: flip V-16 to a "live" crit and bump V-15 over 95% to trigger crit on the gauge
      if (t.demoCritical) {
        if (w.id === 106) { mod = { ...mod, offline: false, status: 'crit', value: 96.8, decimals: 1 }; }
        if (w.id === 104) { mod = { ...mod, value: 96.5, forceStatus: 'crit' }; }
      }
      return mod;
    });
  }, [t.demoCritical]);

  const dark = t.dark;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const ack = (id) => setAcked(s => new Set([...s, id]));

  const colWidth = t.compact ? 48 : 56;
  const rowHeight = t.compact ? 52 : 64;

  return (
    <div className={`app ${dark ? 'dark' : ''}`}>
      <Header dashboard={DASHBOARD} dark={dark} tweaks={t} setTweak={setTweak} />

      <main className="canvas">
        <div className="legend-strip" hidden={!t.showLegend}>
          <span className="lg-title">Ambient retrofit · status drives card background</span>
          <Swatch label="OK"    bg="#37c79a" status="ok"   tint={t.tintIntensity} dark={dark} />
          <Swatch label="WARN"  bg="#f5b428" status="warn" tint={t.tintIntensity} dark={dark} />
          <Swatch label="CRIT"  bg="#e64b3c" status="crit" tint={t.tintIntensity} dark={dark} />
          <Swatch label="STALE" bg="#9aa0a6" status="stale" tint={t.tintIntensity} dark={dark} />
          <span className="lg-note">tint(α): OK {TINT[t.tintIntensity].ok} · WARN {TINT[t.tintIntensity].warn} · CRIT {TINT[t.tintIntensity].crit}</span>
        </div>

        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(24, ${colWidth}px)`,
            gridAutoRows: `${rowHeight}px`,
          }}
        >
          {widgets.map(w => {
            const live = w.live ? tick(w.id, w.value, w.id === 104 ? 0.6 : 0.04) : null;
            const liveStat = w.type === 'stat_card' && !w.offline && w.status !== 'stale'
              ? tick(w.id, w.value, w.variance ?? 0.3)
              : null;
            return (
              <div
                key={w.id}
                className="cell"
                style={{
                  gridColumn: `${w.x+1} / span ${w.cols}`,
                  gridRow:    `${w.y+1} / span ${w.rows}`,
                }}
                data-acked={acked.has(w.id) ? 'true' : 'false'}
              >
                {w.type === 'line_chart' && <LineChartWidget widget={w} dark={dark} tintIntensity={t.tintIntensity} showToneBar={t.showToneBar} />}
                {w.type === 'bar_chart'  && <BarChartWidget  widget={w} dark={dark} tintIntensity={t.tintIntensity} showToneBar={t.showToneBar} />}
                {w.type === 'gauge'      && <GaugeWidget     widget={w} dark={dark} tintIntensity={t.tintIntensity} showToneBar={t.showToneBar} liveValue={live} />}
                {w.type === 'stat_card'  && <StatCardWidget  widget={w} dark={dark} tintIntensity={t.tintIntensity} showToneBar={t.showToneBar} liveValue={liveStat} onAck={() => ack(w.id)} />}
              </div>
            );
          })}
        </div>

        <DevNote dark={dark} />
      </main>

      <TweaksPanel title="Ambient retrofit · tweaks">
        <TweakSection title="Tint">
          <TweakRadio label="Intensity" value={t.tintIntensity} onChange={v => setTweak('tintIntensity', v)}
            options={[{value:'subtle',label:'Subtle'},{value:'medium',label:'Medium'},{value:'strong',label:'Strong'}]} />
          <TweakToggle label="2 px tone bar (existing)" value={t.showToneBar} onChange={v => setTweak('showToneBar', v)} />
        </TweakSection>
        <TweakSection title="Theme">
          <TweakToggle label="Dark mode" value={t.dark} onChange={v => setTweak('dark', v)} />
          <TweakToggle label="Compact grid (48 px cell)" value={t.compact} onChange={v => setTweak('compact', v)} />
        </TweakSection>
        <TweakSection title="Demo">
          <TweakToggle label="Trigger critical alarms (V-15, V-16)" value={t.demoCritical} onChange={v => setTweak('demoCritical', v)} />
          <TweakToggle label="Show legend strip" value={t.showLegend} onChange={v => setTweak('showLegend', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function Header({ dashboard, dark, tweaks, setTweak }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo"><span /></div>
        <div className="brand-text">
          <span className="brand-name">MONEO</span>
          <span className="brand-sub">Monitoring</span>
        </div>
      </div>
      <nav className="crumbs">
        <span>Plant A</span><span className="sep">/</span>
        <span>North Line 2</span><span className="sep">/</span>
        <span className="cur">{dashboard.name} <span className="caret">▾</span></span>
      </nav>
      <div className="spacer" />
      <div className="topchip live"><span className="pulse" />Live · 5 s</div>
      <button className="topchip">Last 1h <span className="caret">▾</span></button>
      <button className="topchip">Share</button>
      <button className="topchip primary">Edit dashboard</button>
      <button className="iconbtn" onClick={() => setTweak('dark', !tweaks.dark)} title="Toggle theme">
        {tweaks.dark ? '☀' : '☾'}
      </button>
    </header>
  );
}

function Swatch({ label, bg, status, tint, dark }) {
  const alpha = TINT[tint][status];
  const tintA = dark ? Math.min(0.42, alpha * 2.2) : alpha;
  const tinted = `linear-gradient(0deg, rgba(${hexRGB(bg)},${tintA}), rgba(${hexRGB(bg)},${tintA})), ${dark ? '#181c22' : '#ffffff'}`;
  return (
    <div className="swatch" style={{ background: tinted, borderColor: `rgba(${hexRGB(bg)}, ${status==='crit' ? (dark?0.65:0.5) : status==='warn' ? (dark?0.45:0.32) : (dark?0.10:0.08)})` }}>
      <span className="sw-bar" style={{ background: bg }} />
      <span className="sw-label">{label}</span>
    </div>
  );
}

function hexRGB(hex) {
  const h = hex.replace('#','');
  return `${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)}`;
}

function DevNote({ dark }) {
  return (
    <aside className="devnote">
      <div className="dn-head">
        <span className="dn-tag">DEV</span>
        <span>Retrofit map — what changes in AppWidgetsShellComponent</span>
      </div>
      <div className="dn-grid">
        <div className="dn-col">
          <h4>Existing</h4>
          <pre>{`<div class="widget"
  [style.--tone-color]="toneColor">
  <div class="tone-bar"></div>
  ...
</div>`}</pre>
        </div>
        <div className="dn-col">
          <h4>After (add 3 vars)</h4>
          <pre>{`<div class="widget"
  [style.--tone-color]="toneColor"
  [style.--tone-tint]="toneTint"
  [style.--tone-edge]="toneEdge"
  [style.--tone-text]="toneText">
  <div class="tone-bar"></div>
  ...
</div>`}</pre>
        </div>
        <div className="dn-col">
          <h4>Derive in component</h4>
          <pre>{`// existing tone logic emits status
//   'ok' | 'warn' | 'crit' | 'stale'
toneTint = rgba(toneColor, TINT[intensity][s])
toneEdge = rgba(toneColor, EDGE[s])
toneText = s==='crit' ? toneColor
         : themed neutral`}</pre>
        </div>
        <div className="dn-col">
          <h4>CSS</h4>
          <pre>{`.widget {
  background:
    linear-gradient(0deg,
      var(--tone-tint),
      var(--tone-tint)),
    var(--bg-card);
  border: 1px solid var(--tone-edge);
}`}</pre>
        </div>
      </div>
      <div className="dn-foot">
        <b>Gap to backfill on the server:</b> <code>/api/sensors/&#123;id&#125;/latest</code> needs a <code>recorded_at</code> field so the shell can resolve <code>stale</code> independently of the WebSocket pulse. Until then, fall back to <code>Date.now() − lastWsTick &gt; 30 s</code>.
      </div>
    </aside>
  );
}

// Boot
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
