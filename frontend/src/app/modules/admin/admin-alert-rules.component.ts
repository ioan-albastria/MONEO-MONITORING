import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit,
} from '@angular/core';
import { AlertsApiService } from '../../core/alerts/alerts-api.service';
import { SensorApiService } from '../../core/sensors/sensor-api.service';
import { AlertRule } from '../../types/alert';
import { Sensor } from '../../types/sensor';

interface AlertRuleRow extends AlertRule {
  saving: boolean;
}

@Component({
  selector: 'app-admin-alert-rules',
  standalone: false,
  templateUrl: './admin-alert-rules.component.html',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminAlertRulesComponent implements OnInit {
  rules: AlertRuleRow[] = [];
  sensors: Sensor[] = [];
  loading = true;
  error: string | null = null;

  showCreateForm = false;
  createSensorId: number | null = null;
  createName = '';
  createCondition = 'gt';
  createThresholdHi: number | null = null;
  createThresholdLo: number | null = null;
  createSeverity = 'warning';
  createDwellSeconds = 60;
  creating = false;

  readonly conditions = ['gt', 'lt', 'outside_range', 'inside_range'];
  readonly severities = ['warning', 'critical'];

  constructor(
    private readonly alertsApi: AlertsApiService,
    private readonly sensorApi: SensorApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadRules(), this.loadSensors()]);
  }

  async loadRules(): Promise<void> {
    this.loading = true; this.cdr.detectChanges();
    try {
      const rules = await this.alertsApi.getRules();
      this.rules = rules.map(r => ({ ...r, saving: false }));
    } catch { this.error = 'Failed to load alert rules.'; }
    finally { this.loading = false; this.cdr.detectChanges(); }
  }

  async loadSensors(): Promise<void> {
    try { this.sensors = await this.sensorApi.listSensors(); }
    catch { /* non-critical */ }
  }

  sensorName(id: number): string {
    return this.sensors.find(s => s.id === id)?.name ?? String(id);
  }

  async toggleEnabled(row: AlertRuleRow): Promise<void> {
    row.saving = true; this.cdr.detectChanges();
    try {
      await this.alertsApi.updateRule(row.id, { is_enabled: !row.is_enabled });
      row.is_enabled = !row.is_enabled;
    } catch { /* revert on failure — row.is_enabled unchanged */ }
    finally { row.saving = false; this.cdr.detectChanges(); }
  }

  async deleteRule(row: AlertRuleRow): Promise<void> {
    if (!confirm(`Delete rule "${row.name}"?`)) return;
    try {
      await this.alertsApi.deleteRule(row.id);
      this.rules = this.rules.filter(r => r.id !== row.id);
      this.cdr.detectChanges();
    } catch (e: any) {
      this.error = e?.error?.detail ?? 'Delete failed.';
      this.cdr.detectChanges();
    }
  }

  async createRule(): Promise<void> {
    if (!this.createName.trim() || this.createSensorId == null) return;
    this.creating = true; this.cdr.detectChanges();
    try {
      await this.alertsApi.createRule({
        sensor_id: this.createSensorId,
        name: this.createName.trim(),
        condition: this.createCondition as AlertRule['condition'],
        threshold_lo: this.createThresholdLo ?? undefined,
        threshold_hi: this.createThresholdHi ?? undefined,
        severity: this.createSeverity as 'warning' | 'critical',
        dwell_seconds: this.createDwellSeconds,
      });
      this.createName = ''; this.showCreateForm = false;
      await this.loadRules();
    } catch { /* leave form open on failure */ }
    finally { this.creating = false; this.cdr.detectChanges(); }
  }

  trackRule(_: number, r: AlertRuleRow): number { return r.id; }
}
