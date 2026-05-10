export type WidgetType = 'line_chart' | 'bar_chart' | 'gauge' | 'stat_card';

export interface WidgetSettings {
  sensor_ids?: number[];
  time_range_hours?: number;
  aggregated?: boolean;
  bucket_minutes?: number;
  color?: string;
  show_legend?: boolean;
  [key: string]: unknown;
}

export interface DashboardWidget {
  id: number;
  dashboard_id: number;
  widget_type: WidgetType;
  title?: string;
  subtitle?: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
  settings: WidgetSettings;
  created_at: string;
  updated_at?: string;
}

export interface DashboardWidgetCreate {
  widget_type: WidgetType;
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
