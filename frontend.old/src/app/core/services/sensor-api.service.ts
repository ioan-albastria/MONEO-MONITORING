import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Sensor, SensorTimeSeriesData, LatestReading } from '../../types/sensor';
import { AnalyticsResponse } from '../../types/analytics';

@Injectable({ providedIn: 'root' })
export class SensorApiService {
  private readonly base = '/api/sensors';

  constructor(private http: HttpClient) {}

  getSensors(activeOnly = false): Observable<Sensor[]> {
    const params = new HttpParams().set('active_only', activeOnly);
    return this.http.get<Sensor[]>(this.base, { params });
  }

  getSensor(id: number): Observable<Sensor> {
    return this.http.get<Sensor>(`${this.base}/${id}`);
  }

  getSensorReadings(
    sensorId: number,
    fromTimestamp: Date,
    toTimestamp: Date,
  ): Observable<SensorTimeSeriesData> {
    const params = new HttpParams()
      .set('from_timestamp', fromTimestamp.toISOString())
      .set('to_timestamp', toTimestamp.toISOString());
    return this.http.get<SensorTimeSeriesData>(`${this.base}/${sensorId}/readings`, { params });
  }

  getLatestReading(sensorId: number): Observable<LatestReading> {
    return this.http.get<LatestReading>(`${this.base}/${sensorId}/latest`);
  }

  getAnalytics(
    sensorIds: number[],
    fromTimestamp: Date,
    toTimestamp: Date,
    aggregated = false,
    bucketMinutes = 60,
  ): Observable<AnalyticsResponse> {
    let params = new HttpParams()
      .set('from_timestamp', fromTimestamp.toISOString())
      .set('to_timestamp', toTimestamp.toISOString())
      .set('aggregated', aggregated)
      .set('bucket_minutes', bucketMinutes);
    sensorIds.forEach((id) => (params = params.append('sensor_id', id)));
    return this.http.get<AnalyticsResponse>('/api/analytics', { params });
  }
}
