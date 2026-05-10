import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Dashboard } from '../../types/dashboard';
import { DashboardWidget, DashboardWidgetCreate } from '../../types/widget';
import { Sensor } from '../../types/sensor';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { SensorApiService } from '../../core/services/sensor-api.service';
import { AuthService } from '../../core/services/auth.service';
import { DashboardListComponent } from './dashboard-list.component';
import { DashboardGridComponent } from './dashboard-grid.component';
import { WidgetConfigComponent } from './widget-config.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    DashboardListComponent,
    DashboardGridComponent,
    WidgetConfigComponent,
  ],
  template: `
    <div class="app-shell">
      <header class="topbar">
        <span class="app-title">MONEO Sensor Dashboard</span>
        <div class="topbar-actions">
          <span class="user-name">{{ auth.currentUser()?.username }}</span>
          <button (click)="auth.logout()">Sign out</button>
        </div>
      </header>

      <div class="content">
        <aside class="sidebar">
          <app-dashboard-list
            [dashboards]="dashboards"
            [selected]="currentDashboard"
            (select)="selectDashboard($event)"
            (create)="createDashboard($event)"
            (delete)="deleteDashboard($event)"
          ></app-dashboard-list>
        </aside>

        <main class="main">
          <ng-container *ngIf="currentDashboard; else empty">
            <div class="main-toolbar">
              <h2>{{ currentDashboard.name }}</h2>
              <div class="toolbar-actions">
                <button *ngIf="editMode" class="btn-primary" (click)="openAddWidget()">
                  + Add Widget
                </button>
                <button class="btn-secondary" (click)="toggleEdit()">
                  {{ editMode ? 'Done' : 'Edit' }}
                </button>
                <button *ngIf="editMode" class="btn-primary" (click)="saveLayout()">
                  Save Layout
                </button>
              </div>
            </div>

            <div class="grid-wrapper">
              <app-dashboard-grid
                [dashboard]="currentDashboard"
                [editMode]="editMode"
                (layoutChanged)="onLayoutChanged($event)"
                (editWidget)="openEditWidget($event)"
                (deleteWidget)="deleteWidget($event)"
              ></app-dashboard-grid>
            </div>
          </ng-container>

          <ng-template #empty>
            <div class="empty-state">
              <p>Select a dashboard from the sidebar or create a new one.</p>
            </div>
          </ng-template>
        </main>
      </div>

      <app-widget-config
        *ngIf="showWidgetConfig"
        [sensors]="sensors"
        [widget]="editingWidget"
        (save)="onWidgetSaved($event)"
        (cancel)="showWidgetConfig = false; editingWidget = null"
      ></app-widget-config>
    </div>
  `,
  styles: [`
    .app-shell { display: flex; flex-direction: column; height: 100vh; }
    .topbar { display: flex; justify-content: space-between; align-items: center; padding: 0 1.5rem; height: 52px; background: #1a73e8; color: white; flex-shrink: 0; }
    .app-title { font-weight: 600; font-size: 1rem; }
    .topbar-actions { display: flex; align-items: center; gap: 1rem; }
    .user-name { font-size: 0.85rem; opacity: 0.85; }
    .topbar-actions button { background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
    .content { display: flex; flex: 1; min-height: 0; }
    .sidebar { width: 220px; flex-shrink: 0; border-right: 1px solid #e0e0e0; background: white; }
    .main { flex: 1; display: flex; flex-direction: column; min-width: 0; background: #f8f9fa; }
    .main-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.25rem; background: white; border-bottom: 1px solid #e0e0e0; }
    .main-toolbar h2 { margin: 0; font-size: 1rem; }
    .toolbar-actions { display: flex; gap: 0.5rem; }
    .btn-primary { background: #1a73e8; color: white; border: none; border-radius: 4px; padding: 5px 14px; cursor: pointer; font-size: 0.85rem; }
    .btn-secondary { background: transparent; border: 1px solid #ccc; border-radius: 4px; padding: 5px 14px; cursor: pointer; font-size: 0.85rem; }
    .grid-wrapper { flex: 1; overflow-y: auto; padding: 1rem; }
    .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; }
  `],
})
export class DashboardComponent implements OnInit {
  dashboards: Dashboard[] = [];
  currentDashboard: Dashboard | null = null;
  sensors: Sensor[] = [];
  editMode = false;
  showWidgetConfig = false;
  editingWidget: DashboardWidget | null = null;

  private pendingLayout: { id: number; x: number; y: number; cols: number; rows: number }[] = [];

  constructor(
    private dashboardApi: DashboardApiService,
    private sensorApi: SensorApiService,
    public auth: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadDashboards();
    this.sensorApi.getSensors().subscribe((s) => (this.sensors = s));
  }

  loadDashboards(): void {
    this.dashboardApi.getDashboards().subscribe((list) => {
      this.dashboards = list;
      if (this.currentDashboard) {
        this.currentDashboard = list.find((d) => d.id === this.currentDashboard!.id) ?? null;
      }
    });
  }

  selectDashboard(d: Dashboard): void {
    this.dashboardApi.getDashboard(d.id).subscribe((full) => {
      this.currentDashboard = full;
      this.editMode = false;
    });
  }

  createDashboard(payload: { name: string }): void {
    this.dashboardApi.createDashboard(payload).subscribe(() => this.loadDashboards());
  }

  deleteDashboard(id: number): void {
    if (!confirm('Delete this dashboard?')) return;
    this.dashboardApi.deleteDashboard(id).subscribe(() => {
      if (this.currentDashboard?.id === id) this.currentDashboard = null;
      this.loadDashboards();
    });
  }

  toggleEdit(): void {
    this.editMode = !this.editMode;
  }

  openAddWidget(): void {
    this.editingWidget = null;
    this.showWidgetConfig = true;
  }

  openEditWidget(widget: DashboardWidget): void {
    this.editingWidget = widget;
    this.showWidgetConfig = true;
  }

  onWidgetSaved(payload: DashboardWidgetCreate): void {
    if (!this.currentDashboard) return;
    this.showWidgetConfig = false;

    if (this.editingWidget) {
      this.dashboardApi.updateWidget(this.editingWidget.id, payload).subscribe(() => {
        this.reloadCurrentDashboard();
      });
    } else {
      this.dashboardApi.addWidget(this.currentDashboard.id, payload).subscribe(() => {
        this.reloadCurrentDashboard();
      });
    }
    this.editingWidget = null;
  }

  deleteWidget(widgetId: number): void {
    if (!confirm('Remove this widget?')) return;
    this.dashboardApi.deleteWidget(widgetId).subscribe(() => this.reloadCurrentDashboard());
  }

  onLayoutChanged(items: { widget: { id: number }; x: number; y: number; cols: number; rows: number }[]): void {
    this.pendingLayout = items.map((i) => ({
      id: i.widget.id,
      x: i.x,
      y: i.y,
      cols: i.cols,
      rows: i.rows,
    }));
  }

  saveLayout(): void {
    if (!this.currentDashboard || !this.pendingLayout.length) return;
    this.dashboardApi.saveLayout(this.currentDashboard.id, this.pendingLayout).subscribe(() => {
      this.editMode = false;
      this.pendingLayout = [];
      this.reloadCurrentDashboard();
    });
  }

  private reloadCurrentDashboard(): void {
    if (!this.currentDashboard) return;
    this.dashboardApi.getDashboard(this.currentDashboard.id).subscribe(
      (d) => (this.currentDashboard = d),
    );
  }
}
