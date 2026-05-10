import { DashboardWidget } from './widget';

export interface Dashboard {
  id: number;
  name: string;
  description?: string;
  owner_id: number;
  is_public: boolean;
  created_at: string;
  updated_at?: string;
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
