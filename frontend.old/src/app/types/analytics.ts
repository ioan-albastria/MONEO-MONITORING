import { SensorTimeSeriesData } from './sensor';

export interface AnalyticsResponse {
  generated_at: string;
  range_start: string;
  range_end: string;
  data: SensorTimeSeriesData[];
}
