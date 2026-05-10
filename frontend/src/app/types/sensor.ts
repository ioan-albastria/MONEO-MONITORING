export interface Sensor {
  id: number;
  name: string;
  unit?: string | null;
  description?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface SensorReading {
  id: number;
  sensor_id: number;
  value: number;
  timestamp: string;
}

export interface SensorTimeSeriesData {
  sensor_id: number;
  readings: SensorReading[];
}
