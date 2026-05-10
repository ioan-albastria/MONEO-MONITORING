import { WidgetSettings } from './widget';

export type DashboardWidgetType = 'line_chart' | 'bar_chart' | 'gauge' | 'stat_card';

export interface DashboardWidget {
  id: number;
  dashboard_id: number;
  widget_type: DashboardWidgetType;
  title?: string | null;
  subtitle?: string | null;
  x: number;
  y: number;
  cols: number;
  rows: number;
  settings: WidgetSettings;
  created_at: string;
  updated_at?: string;
}

export interface DashboardSummary {
  id: number;
  name: string;
  description?: string | null;
  owner_id: number | string;
  is_public: boolean;
  is_owned: boolean;
  widget_count: number;
  created_at: string;
  updated_at?: string;
}

export interface Dashboard extends DashboardSummary {
  widgets: DashboardWidget[];
}

export interface DashboardCreate {
  name: string;
  description?: string;
  is_public?: boolean;
}

export interface DashboardUpdate {
  name?: string;
  description?: string;
  is_public?: boolean;
}

export interface DashboardWidgetLayoutItem {
  id: number;
  x: number;
  y: number;
  cols: number;
  rows: number;
}
