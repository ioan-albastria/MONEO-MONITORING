export interface Sensor {
  id: number;
  moneo_sensor_id: string;
  name: string;
  description?: string;
  sensor_type: string;
  unit: string;
  asset_id?: number;
  min_value?: number;
  max_value?: number;
  is_active: boolean;
  created_at: string;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface SensorTimeSeriesData {
  sensor_id: number;
  sensor_name: string;
  unit: string;
  points: TimeSeriesPoint[];
  min_value?: number;
  max_value?: number;
  avg_value?: number;
}

export interface LatestReading {
  value: number | null;
  timestamp: string | null;
  status: string;
}
