export interface AlertRule {
  id: number;
  sensor_id: number;
  name: string;
  description: string | null;
  condition: 'gt' | 'lt' | 'outside_range' | 'inside_range' | 'no_data';
  threshold_lo: number | null;
  threshold_hi: number | null;
  recovery_lo: number | null;
  recovery_hi: number | null;
  severity: 'warning' | 'critical';
  dwell_seconds: number;
  no_data_seconds: number | null;
  recovery_dwell_seconds: number;
  policy: 'auto_clear' | 'manual_ack';
  is_enabled: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface AlertEvent {
  id: number;
  rule_id: number;
  sensor_id: number;
  state:
    | 'pending'
    | 'firing'
    | 'recovered'
    | 'awaiting_ack'
    | 'cleared'
    | 'flapping_started'
    | 'flapping_stopped';
  observed_value: number | null;
  observed_at: string;
  acknowledged_by: number | null;
  acknowledged_at: string | null;
  note: string | null;
  created_at: string;
}

export interface AlertRoute {
  id: number;
  scope_kind: 'rule' | 'sensor' | 'asset' | 'severity' | 'all';
  scope_id: number | null;
  scope_severity: string | null;
  channel: 'in_app' | 'email' | 'webhook';
  target: string;
  on_fire: boolean;
  on_recover: boolean;
  is_enabled: boolean;
  created_at: string;
}
