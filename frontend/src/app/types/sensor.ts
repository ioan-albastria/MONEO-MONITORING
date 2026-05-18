export interface Sensor {
  id: number;
  name: string;
  unit?: string | null;
  description?: string | null;
  sensor_type?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  asset_id?: number | null;
  asset_path?: string | null;
  expected_poll_seconds: number | null;
  last_seen_at: string | null;
  // Slice 2: range-bound fields
  normal_min:    number | null;
  normal_max:    number | null;
  warning_min:   number | null;
  warning_max:   number | null;
  critical_min:  number | null;
  critical_max:  number | null;
  ranges_source: string;
  has_readings: boolean;
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
