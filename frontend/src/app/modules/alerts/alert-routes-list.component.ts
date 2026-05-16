import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AlertsApiService } from '../../core/alerts/alerts-api.service';
import { AlertRoute } from '../../types/alert';

@Component({
  selector: 'app-alert-routes-list',
  standalone: false,
  templateUrl: './alert-routes-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertRoutesListComponent implements OnInit {
  routes: AlertRoute[] = [];
  loading = false;
  error: string | null = null;

  constructor(
    private readonly alertsApi: AlertsApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.cdr.markForCheck();
    try {
      this.routes = await this.alertsApi.getRoutes();
    } catch {
      this.error = 'Failed to load notification routes.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async deleteRoute(route: AlertRoute): Promise<void> {
    if (!confirm(`Delete route "${route.channel} → ${route.target}"?`)) return;
    try {
      await this.alertsApi.deleteRoute(route.id);
      this.routes = this.routes.filter(r => r.id !== route.id);
      this.cdr.markForCheck();
    } catch {
      alert('Failed to delete route.');
    }
  }

  async toggleRoute(route: AlertRoute): Promise<void> {
    try {
      const updated = await this.alertsApi.updateRoute(route.id, { is_enabled: !route.is_enabled });
      const idx = this.routes.findIndex(r => r.id === route.id);
      if (idx >= 0) this.routes[idx] = updated;
      this.cdr.markForCheck();
    } catch {
      alert('Failed to update route.');
    }
  }
}
