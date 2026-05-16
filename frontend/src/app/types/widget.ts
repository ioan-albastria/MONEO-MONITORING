import { DashboardWidgetType } from './dashboard';

export interface WidgetSettings {
  sensor_ids?: number[];
  time_range_hours?: number;
  from?: string;
  to?: string;
  time_range_inherit?: boolean;
  aggregated?: boolean;
  bucket_minutes?: number;
  gauge_min?: number;
  gauge_max?: number;
  show_legend?: boolean;
  color?: string;
  [k: string]: unknown;
}

export interface DashboardWidgetCreate {
  widget_type: DashboardWidgetType;
  title?: string;
  subtitle?: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
  settings: WidgetSettings;
}

export interface DashboardWidgetUpdate {
  title?: string;
  subtitle?: string;
  x?: number;
  y?: number;
  cols?: number;
  rows?: number;
  settings?: WidgetSettings;
}
