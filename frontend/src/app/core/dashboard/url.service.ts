import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { TimePreset, PRESET_HOURS } from './time.service';

export interface UrlDashboardState {
  d?: number;
  preset?: string;
  ar?: number;
  from?: string;
  to?: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardUrlService {
  constructor(private readonly router: Router) {}

  /** Read current query params from window.location. */
  readParams(): UrlDashboardState {
    const p = new URLSearchParams(window.location.search);
    const d = p.get('d');
    const ar = p.get('ar');
    return {
      d:      d  ? +d                 : undefined,
      preset: p.get('preset')         ?? undefined,
      ar:     ar ? +ar                : undefined,
      from:   p.get('from')           ?? undefined,
      to:     p.get('to')             ?? undefined,
    };
  }

  /**
   * Replace the current URL query string without navigation.
   * Null values clear the corresponding param from the URL.
   */
  syncParams(state: UrlDashboardState): void {
    const qp: Record<string, string | null> = {};

    qp['d']      = state.d      != null ? String(state.d)  : null;
    qp['preset'] = state.preset != null ? state.preset      : null;
    qp['ar']     = (state.ar && state.ar > 0) ? String(state.ar) : null;

    if (state.preset === 'custom') {
      qp['from'] = state.from ?? null;
      qp['to']   = state.to   ?? null;
    } else {
      qp['from'] = null;
      qp['to']   = null;
    }

    void this.router.navigate([], {
      queryParams: qp,
      replaceUrl: true,
      queryParamsHandling: 'merge',
    });
  }

  /** Copy the current URL (with all params) to the clipboard. */
  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // Fallback: create a temporary input element
      const el = document.createElement('input');
      el.value = window.location.href;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  }
}
