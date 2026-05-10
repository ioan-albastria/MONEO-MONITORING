import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Dashboard, DashboardCreate, DashboardUpdate, DashboardWidgetLayoutItem, DashboardWidget } from '../../types/dashboard';
import { DashboardWidgetCreate, DashboardWidgetUpdate } from '../../types/widget';

@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  constructor(private http: HttpClient) {}

  listDashboards()         { return firstValueFrom(this.http.get<Dashboard[]>('/api/dashboards')); }
  listPublicDashboards()   { return firstValueFrom(this.http.get<Dashboard[]>('/api/dashboards/public')); }
  getDashboard(id: number) { return firstValueFrom(this.http.get<Dashboard>(`/api/dashboards/${id}`)); }

  createDashboard(b: DashboardCreate) {
    return firstValueFrom(this.http.post<Dashboard>('/api/dashboards', b));
  }
  updateDashboard(id: number, b: DashboardUpdate) {
    return firstValueFrom(this.http.put<Dashboard>(`/api/dashboards/${id}`, b));
  }
  deleteDashboard(id: number) {
    return firstValueFrom(this.http.delete<void>(`/api/dashboards/${id}`));
  }

  createWidget(dashboardId: number, b: DashboardWidgetCreate) {
    return firstValueFrom(this.http.post<DashboardWidget>(`/api/dashboards/${dashboardId}/widgets`, b));
  }
  updateWidget(widgetId: number, b: DashboardWidgetUpdate) {
    return firstValueFrom(this.http.put<DashboardWidget>(`/api/widgets/${widgetId}`, b));
  }
  deleteWidget(widgetId: number) {
    return firstValueFrom(this.http.delete<void>(`/api/widgets/${widgetId}`));
  }
  saveLayout(dashboardId: number, items: DashboardWidgetLayoutItem[]) {
    return firstValueFrom(this.http.post<void>(`/api/dashboards/${dashboardId}/layout`, items));
  }
}
