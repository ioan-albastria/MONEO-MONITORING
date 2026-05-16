import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type TimePreset = '15m' | '1h' | '6h' | '24h' | '7d' | '30d' | 'custom';

export interface TimeRange {
  preset: TimePreset;
  hours?: number;               // set when preset !== 'custom'
  from?: string;                // ISO — set when preset === 'custom'
  to?: string;                  // ISO — set when preset === 'custom'
  autoRefreshSeconds: number;   // 0 = off
}

export const PRESET_HOURS: Record<Exclude<TimePreset, 'custom'>, number> = {
  '15m': 0.25, '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720,
};

const DEFAULT_RANGE: TimeRange = { preset: '1h', hours: 1, autoRefreshSeconds: 0 };

@Injectable({ providedIn: 'root' })
export class DashboardTimeService implements OnDestroy {
  private _range$ = new BehaviorSubject<TimeRange>(DEFAULT_RANGE);
  readonly range$ = this._range$.asObservable();

  private _refreshTimer: ReturnType<typeof setInterval> | null = null;

  get current(): TimeRange { return this._range$.getValue(); }

  setRange(range: TimeRange): void {
    this._range$.next(range);
    this._resetRefreshTimer(range.autoRefreshSeconds);
  }

  loadFromDashboard(d: {
    default_time_range_hours?: number | null;
    default_from?: string | null;
    default_to?: string | null;
    auto_refresh_seconds?: number | null;
  }): void {
    if (d.default_time_range_hours) {
      const hours = d.default_time_range_hours;
      const preset = (Object.entries(PRESET_HOURS).find(([, h]) => h === hours)?.[0] ?? '1h') as TimePreset;
      this.setRange({ preset, hours, autoRefreshSeconds: d.auto_refresh_seconds ?? 0 });
    } else if (d.default_from && d.default_to) {
      this.setRange({ preset: 'custom', from: d.default_from, to: d.default_to, autoRefreshSeconds: d.auto_refresh_seconds ?? 0 });
    } else {
      this.setRange({ ...DEFAULT_RANGE, autoRefreshSeconds: d.auto_refresh_seconds ?? 0 });
    }
  }

  resolveWindow(): { from: string; to: string } {
    const r = this._range$.getValue();
    if (r.preset === 'custom' && r.from && r.to) {
      return { from: r.from, to: r.to };
    }
    const hours = r.hours ?? PRESET_HOURS[r.preset as Exclude<TimePreset, 'custom'>] ?? 1;
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  private _resetRefreshTimer(seconds: number): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (seconds > 0) {
      this._refreshTimer = setInterval(() => {
        this._range$.next({ ...this._range$.getValue() });
      }, seconds * 1000);
    }
  }

  ngOnDestroy(): void {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
  }
}
