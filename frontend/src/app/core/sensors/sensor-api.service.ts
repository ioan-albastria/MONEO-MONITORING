import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Sensor, SensorReading, SensorTimeSeriesData } from '../../types/sensor';
import { AnalyticsResponse } from '../../types/analytics';

@Injectable({ providedIn: 'root' })
export class SensorApiService {
  constructor(private http: HttpClient) {}

  listSensors() {
    return firstValueFrom(this.http.get<Sensor[]>('/api/sensors'));
  }

  getSensor(id: number) {
    return firstValueFrom(this.http.get<Sensor>(`/api/sensors/${id}`));
  }

  getReadings(id: number, from: string, to: string) {
    return firstValueFrom(
      this.http.get<SensorTimeSeriesData>(`/api/sensors/${id}/readings`, {
        params: { from_timestamp: from, to_timestamp: to },
      })
    );
  }

  getLatest(id: number) {
    return firstValueFrom(this.http.get<SensorReading>(`/api/sensors/${id}/latest`));
  }

  getAnalytics(
    sensor_ids: number[],
    from: string,
    to: string,
    opts: { aggregated?: boolean; bucket_minutes?: number } = {}
  ) {
    let params = new HttpParams().set('from_timestamp', from).set('to_timestamp', to);
    sensor_ids.forEach((id) => (params = params.append('sensor_id', String(id))));
    if (opts.aggregated) params = params.set('aggregated', 'true');
    if (opts.bucket_minutes) params = params.set('bucket_minutes', String(opts.bucket_minutes));
    return firstValueFrom(this.http.get<AnalyticsResponse>('/api/analytics', { params }));
  }

  updateRanges(id: number, body: Partial<import('../../types/sensor').Sensor>): Promise<import('../../types/sensor').Sensor> {
    return firstValueFrom(this.http.put<import('../../types/sensor').Sensor>(`/api/sensors/${id}/ranges`, body));
  }
}
