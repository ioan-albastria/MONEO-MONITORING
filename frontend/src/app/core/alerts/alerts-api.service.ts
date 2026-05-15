import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { AlertEvent, AlertRule } from '../../types/alert';

@Injectable({ providedIn: 'root' })
export class AlertsApiService {
  constructor(private http: HttpClient) {}

  getRules(params?: {
    sensor_id?: number;
    severity?: string;
    enabled?: boolean;
  }): Promise<AlertRule[]> {
    let p = new HttpParams();
    if (params?.sensor_id != null) p = p.set('sensor_id', String(params.sensor_id));
    if (params?.severity) p = p.set('severity', params.severity);
    if (params?.enabled != null) p = p.set('enabled', String(params.enabled));
    return firstValueFrom(this.http.get<AlertRule[]>('/api/alerts/rules', { params: p }));
  }

  createRule(body: Partial<AlertRule>): Promise<AlertRule> {
    return firstValueFrom(this.http.post<AlertRule>('/api/alerts/rules', body));
  }

  updateRule(id: number, body: Partial<AlertRule>): Promise<AlertRule> {
    return firstValueFrom(this.http.put<AlertRule>(`/api/alerts/rules/${id}`, body));
  }

  deleteRule(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/alerts/rules/${id}`));
  }

  getEvents(params?: {
    sensor_id?: number;
    rule_id?: number;
    state?: string;
    limit?: number;
  }): Promise<AlertEvent[]> {
    let p = new HttpParams();
    if (params?.sensor_id != null) p = p.set('sensor_id', String(params.sensor_id));
    if (params?.rule_id != null) p = p.set('rule_id', String(params.rule_id));
    if (params?.state) p = p.set('state', params.state);
    if (params?.limit != null) p = p.set('limit', String(params.limit));
    return firstValueFrom(this.http.get<AlertEvent[]>('/api/alerts/events', { params: p }));
  }

  getActiveEvents(): Promise<AlertEvent[]> {
    return firstValueFrom(this.http.get<AlertEvent[]>('/api/alerts/events/active'));
  }

  ackEvent(id: number, note?: string): Promise<AlertEvent> {
    return firstValueFrom(
      this.http.post<AlertEvent>(`/api/alerts/events/${id}/ack`, note != null ? { note } : {})
    );
  }
}
