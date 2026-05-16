import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostBinding,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { interval, Subscription } from 'rxjs';

export type WidgetTone      = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type WidgetChromeMode = 'hover' | 'off';
export type WidgetStatus    = 'ok' | 'warn' | 'crit' | 'stale';

// Hex palette — explicit overrides alongside OKLch theme tokens (F4 adaptation)
const TONE_HEX: Record<WidgetStatus, string> = {
  ok:    '#37c79a',
  warn:  '#f5b428',
  crit:  '#e64b3c',
  stale: '#9aa0a6',
};

// Alpha ramps — subtle intensity hard-coded for this slice;
// medium/strong retained as constants for future preference UI
const TINT_SUBTLE: Record<WidgetStatus, number> = {
  ok: 0.03, warn: 0.08, crit: 0.14, stale: 0.03,
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TINT_MEDIUM: Record<WidgetStatus, number> = {
  ok: 0.05, warn: 0.12, crit: 0.20, stale: 0.05,
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TINT_STRONG: Record<WidgetStatus, number> = {
  ok: 0.08, warn: 0.18, crit: 0.30, stale: 0.07,
};

const EDGE_ALPHA: Record<WidgetStatus, { light: number; dark: number }> = {
  ok:    { light: 0.08, dark: 0.10 },
  warn:  { light: 0.32, dark: 0.45 },
  crit:  { light: 0.50, dark: 0.65 },
  stale: { light: 0.08, dark: 0.10 },
};

const DARK_MULTIPLIER = 2.2;
const DARK_TINT_CAP   = 0.42;

const TEXT_LIGHT: Record<WidgetStatus, string> = {
  ok:    '#1d2024',
  warn:  '#1d2024',
  crit:  '#e64b3c',
  stale: '#6b7079',
};
const TEXT_DARK: Record<WidgetStatus, string> = {
  ok:    '#e6e8eb',
  warn:  '#e6e8eb',
  crit:  '#e64b3c',
  stale: '#8a9099',
};

type ToneKey = `${WidgetStatus}:${'light' | 'dark'}`;
interface ToneTokens { tint: string; edge: string; text: string; }

@Component({
  selector: 'app-widget-shell',
  standalone: false,
  templateUrl: './app-widgets-shell.component.html',
  styleUrl: './app-widgets-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppWidgetsShellComponent implements OnChanges, OnInit, OnDestroy {
  @Input() title    = 'Widget';
  @Input() subtitle?: string;
  @Input() loading  = false;
  @Input() tone: WidgetTone        = 'neutral';
  @Input() chromeMode: WidgetChromeMode = 'hover';
  @Input() status: WidgetStatus    = 'ok';
  @Input() theme: 'light' | 'dark' = 'dark';

  @Input() freshAt: string | null = null;
  @Input() expectedIntervalSeconds = 300;
  @Input() editMode = false;

  // Consumed by template [style.X] bindings
  toneTint = 'transparent';
  toneEdge = 'transparent';
  toneText = 'inherit';

  // At most 8 entries per instance (4 statuses × 2 themes)
  private readonly _cache = new Map<ToneKey, ToneTokens>();
  private _freshnessTick: Subscription | null = null;

  constructor(private readonly cdr: ChangeDetectorRef) {}

  @HostBinding('attr.data-state')
  get stateAttr(): string { return this.freshnessState; }

  get freshnessState(): 'fresh' | 'stale' | 'offline' | 'unknown' {
    if (!this.freshAt) return 'unknown';
    const age = (Date.now() - new Date(this.freshAt).getTime()) / 1000;
    if (age < this.expectedIntervalSeconds)          return 'fresh';
    if (age < this.expectedIntervalSeconds * 5)     return 'stale';
    return 'offline';
  }

  ngOnInit(): void {
    this._freshnessTick = interval(5_000).subscribe(() => this.cdr.markForCheck());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['status'] || changes['theme']) {
      this._applyTokens();
    }
  }

  ngOnDestroy(): void {
    this._freshnessTick?.unsubscribe();
  }

  cycleChromeMode(): void {
    this.chromeMode = this.chromeMode === 'hover' ? 'off' : 'hover';
  }

  private _applyTokens(): void {
    const key: ToneKey = `${this.status}:${this.theme}`;
    let tokens = this._cache.get(key);
    if (!tokens) {
      tokens = this._computeTokens(this.status, this.theme);
      this._cache.set(key, tokens);
    }
    this.toneTint = tokens.tint;
    this.toneEdge = tokens.edge;
    this.toneText = tokens.text;
  }

  private _computeTokens(status: WidgetStatus, theme: 'light' | 'dark'): ToneTokens {
    const [r, g, b] = this._hexToRgb(TONE_HEX[status]);
    const rawTint   = TINT_SUBTLE[status];
    const tintA     = theme === 'dark'
      ? Math.min(rawTint * DARK_MULTIPLIER, DARK_TINT_CAP)
      : rawTint;
    const edgeA = EDGE_ALPHA[status][theme];
    return {
      tint: this._rgba(r, g, b, tintA),
      edge: this._rgba(r, g, b, edgeA),
      text: theme === 'dark' ? TEXT_DARK[status] : TEXT_LIGHT[status],
    };
  }

  private _rgba(r: number, g: number, b: number, a: number): string {
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }

  private _hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
}
