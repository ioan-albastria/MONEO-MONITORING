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
  styleUrls: ['./alert-routes-list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertRoutesListComponent implements OnInit {
  routes: AlertRoute[] = [];
  loading = false;
  error: string | null = null;

  createOpen    = false;
  createSaving  = false;
  createError: string | null = null;

  createScopeKind     = 'all';
  createScopeId: number | null = null;
  createScopeSeverity: string | null = null;
  createChannel       = 'in_app';
  createTarget        = '';
  createOnFire        = true;
  createOnRecover     = true;

  constructor(
    private readonly alertsApi: AlertsApiService,
    readonly cdr: ChangeDetectorRef,
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

  openCreateForm(): void {
    this.createOpen = true;
    this.cdr.markForCheck();
  }

  cancelCreate(): void {
    this.createOpen = false;
    this._resetCreateForm();
    this.cdr.markForCheck();
  }

  async createRoute(): Promise<void> {
    this.createSaving = true;
    this.createError = null;
    this.cdr.markForCheck();
    try {
      const body: Partial<AlertRoute> = {
        scope_kind: this.createScopeKind as AlertRoute['scope_kind'],
        scope_id: ['rule', 'sensor', 'asset'].includes(this.createScopeKind)
          ? this.createScopeId : null,
        scope_severity: this.createScopeKind === 'severity'
          ? this.createScopeSeverity : null,
        channel: this.createChannel as AlertRoute['channel'],
        target: this.createChannel === 'in_app' ? '' : this.createTarget,
        on_fire: this.createOnFire,
        on_recover: this.createOnRecover,
        is_enabled: true,
      };
      const created = await this.alertsApi.createRoute(body);
      this.routes = [...this.routes, created];
      this.createOpen = false;
      this._resetCreateForm();
    } catch {
      this.createError = 'Failed to create route.';
    } finally {
      this.createSaving = false;
      this.cdr.markForCheck();
    }
  }

  private _resetCreateForm(): void {
    this.createScopeKind     = 'all';
    this.createScopeId       = null;
    this.createScopeSeverity = null;
    this.createChannel       = 'in_app';
    this.createTarget        = '';
    this.createOnFire        = true;
    this.createOnRecover     = true;
    this.createError         = null;
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
