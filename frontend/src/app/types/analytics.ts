export interface AnalyticsPoint {
  timestamp: string;
  value: number;
}

export interface AnalyticsSensorData {
  sensor_id: number;
  sensor_name: string;
  unit?: string | null;
  points: AnalyticsPoint[];
}

export interface AnalyticsResponse {
  from: string;
  to: string;
  data: AnalyticsSensorData[];
}
