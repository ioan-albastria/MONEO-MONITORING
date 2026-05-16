import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, startWith } from 'rxjs';
import { UiPreferencesService } from '../../core/ui/ui-preferences.service';
import { PageHeaderStateService } from '../../core/ui/page-header-state.service';
import { AuthService } from '../../core/auth/auth.service';
import { KioskService } from '../../core/kiosk/kiosk.service';

@Component({
  selector: 'app-shell',
  standalone: false,
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent implements OnInit {
  pageTitle    = 'Dashboard';
  pageSubtitle = '';
  pageStats: string[] = [];
  userName = '';

  private readonly router          = inject(Router);
  private readonly destroyRef      = inject(DestroyRef);
  private readonly pageHeaderState = inject(PageHeaderStateService);
  private readonly cdr             = inject(ChangeDetectorRef);
  readonly ui                      = inject(UiPreferencesService);
  private readonly auth            = inject(AuthService);
  private readonly kiosk           = inject(KioskService);
  readonly kioskService            = this.kiosk;

  private readonly routeTitles: Record<string, { title: string; subtitle: string }> = {
    '/dashboard': { title: 'Dashboard',  subtitle: 'Sensor Overview' },
    '/alerts':    { title: 'Alerts',     subtitle: 'Active Events & Rules' },
    '/live':      { title: 'Live View',  subtitle: 'Realtime Tracking' },
    '/trips':     { title: 'Trips',      subtitle: '' },
    '/vehicles':  { title: 'Vehicles',   subtitle: '' },
    '/events':    { title: 'Events',     subtitle: '' },
    '/raw-data':  { title: 'Raw Data',   subtitle: '' },
    '/reports':   { title: 'Reports',    subtitle: '' },
    '/admin':     { title: 'Admin',      subtitle: '' },
  };

  ngOnInit(): void {
    this.userName = this.auth.currentUser?.username ?? '';
    if (this.auth.currentUser) {
      this.kiosk.activateIfKiosk(this.auth.currentUser);
    }

    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      startWith(null),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => {
      const entry = this.routeTitles[this.router.url.split('?')[0]] ?? { title: 'Dashboard', subtitle: '' };
      this.pageTitle    = entry.title;
      this.pageSubtitle = entry.subtitle;
      this.pageStats    = [];
      this.cdr.markForCheck();
    });

    this.pageHeaderState.state$.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(state => {
      if (state) {
        this.pageTitle    = state.title;
        this.pageSubtitle = state.subtitle ?? '';
        this.pageStats    = state.stats ?? [];
        this.cdr.markForCheck();
      }
    });
  }

  logout(): void {
    this.auth.logout();
  }
}
