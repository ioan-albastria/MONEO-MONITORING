export interface Annotation {
  id: number;
  kind: 'manual' | 'alert' | 'maintenance' | 'event';
  scope_kind: 'sensor' | 'asset' | 'dashboard' | 'global';
  scope_id: number | null;
  label: string;
  body: string | null;
  started_at: string;
  ended_at: string | null;
  color: string | null;
  source_event_id: number | null;
  created_by: number | null;
  created_at: string;
}
