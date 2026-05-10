import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Dashboard, DashboardCreate, DashboardUpdate } from '../../types/dashboard';
import { DashboardWidget, DashboardWidgetCreate, DashboardWidgetUpdate } from '../../types/widget';

@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private readonly base = '/api/dashboards';

  constructor(private http: HttpClient) {}

  getDashboards(): Observable<Dashboard[]> {
    return this.http.get<Dashboard[]>(this.base);
  }

  getPublicDashboards(): Observable<Dashboard[]> {
    return this.http.get<Dashboard[]>(`${this.base}/public`);
  }

  getDashboard(id: number): Observable<Dashboard> {
    return this.http.get<Dashboard>(`${this.base}/${id}`);
  }

  createDashboard(payload: DashboardCreate): Observable<Dashboard> {
    return this.http.post<Dashboard>(this.base, payload);
  }

  updateDashboard(id: number, payload: DashboardUpdate): Observable<Dashboard> {
    return this.http.put<Dashboard>(`${this.base}/${id}`, payload);
  }

  deleteDashboard(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  addWidget(dashboardId: number, payload: DashboardWidgetCreate): Observable<DashboardWidget> {
    return this.http.post<DashboardWidget>(`${this.base}/${dashboardId}/widgets`, payload);
  }

  saveLayout(dashboardId: number, layout: { id: number; x: number; y: number; cols: number; rows: number }[]): Observable<void> {
    return this.http.post<void>(`${this.base}/${dashboardId}/layout`, layout);
  }

  updateWidget(widgetId: number, payload: DashboardWidgetUpdate): Observable<DashboardWidget> {
    return this.http.put<DashboardWidget>(`/api/widgets/${widgetId}`, payload);
  }

  deleteWidget(widgetId: number): Observable<void> {
    return this.http.delete<void>(`/api/widgets/${widgetId}`);
  }
}
