import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService, UserRead } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class KioskService implements OnDestroy {
  private _isKiosk$ = new BehaviorSubject<boolean>(false);
  private _showBadge$ = new BehaviorSubject<boolean>(false);
  readonly isKiosk$ = this._isKiosk$.asObservable();
  readonly showBadge$ = this._showBadge$.asObservable();

  dashboardIds: number[] = [];
  cycleIntervalSeconds = 0;

  private _badgeTimer: ReturnType<typeof setTimeout> | null = null;
  private _cycleTimer: ReturnType<typeof setInterval> | null = null;
  private _cycleIndex = 0;

  private _activeDashboard$ = new BehaviorSubject<number | null>(null);
  readonly activeDashboardId$ = this._activeDashboard$.asObservable();

  get isKiosk(): boolean { return this._isKiosk$.getValue(); }

  /**
   * Called from APP_INITIALIZER before the auth guard runs.
   * If `?kt=<token>` is in the URL, store it as the auth token so the
   * guard finds it and calls me() with the kiosk JWT.
   */
  checkForKioskToken(): void {
    const params = new URLSearchParams(window.location.search);
    const kt = params.get('kt');
    if (!kt) return;

    // If there is already a regular (non-kiosk) session, keep it.
    // A kiosk device starts fresh so there is no prior token; an admin
    // who opens a kiosk URL already has a regular JWT in storage.
    const existing = localStorage.getItem(AuthService.TOKEN_KEY);
    if (existing && !this._isKioskJwt(existing)) return;

    localStorage.setItem(AuthService.TOKEN_KEY, kt);
  }

  private _isKioskJwt(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return 'kiosk_token_id' in payload;
    } catch {
      return false;
    }
  }

  /**
   * Called after auth.me() resolves. If the user is a kiosk principal,
   * activates kiosk mode and starts the dashboard cycle if requested.
   */
  activateIfKiosk(user: UserRead): void {
    if (!user.is_kiosk) return;

    const params = new URLSearchParams(window.location.search);
    const cycleSeconds = params.has('cycle') ? Math.max(5, +params.get('cycle')!) : 0;

    this.dashboardIds = user.kiosk_dashboard_ids ?? [];
    this.cycleIntervalSeconds = cycleSeconds;

    // Activate CSS class on <html>
    document.documentElement.classList.add('kiosk');

    this._isKiosk$.next(true);
    this._showBadge$.next(true);

    // Fade badge after 10 s
    if (this._badgeTimer) clearTimeout(this._badgeTimer);
    this._badgeTimer = setTimeout(() => this._showBadge$.next(false), 10_000);

    // Start cycling if multiple dashboards
    if (cycleSeconds > 0 && this.dashboardIds.length > 1) {
      this._startCycle(cycleSeconds);
    } else if (this.dashboardIds.length === 1) {
      this._activeDashboard$.next(this.dashboardIds[0]);
    }
  }

  private _startCycle(intervalSeconds: number): void {
    if (this._cycleTimer) clearInterval(this._cycleTimer);
    this._cycleIndex = 0;
    this._activeDashboard$.next(this.dashboardIds[0] ?? null);
    this._cycleTimer = setInterval(() => {
      this._cycleIndex = (this._cycleIndex + 1) % this.dashboardIds.length;
      this._activeDashboard$.next(this.dashboardIds[this._cycleIndex]);
    }, intervalSeconds * 1_000);
  }

  ngOnDestroy(): void {
    if (this._badgeTimer) clearTimeout(this._badgeTimer);
    if (this._cycleTimer)  clearInterval(this._cycleTimer);
  }
}
