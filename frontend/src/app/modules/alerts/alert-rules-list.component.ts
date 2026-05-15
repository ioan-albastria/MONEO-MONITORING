import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AlertRule } from '../../types/alert';
import { AlertsApiService } from '../../core/alerts/alerts-api.service';

@Component({
  selector: 'app-alert-rules-list',
  standalone: false,
  templateUrl: './alert-rules-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertRulesListComponent implements OnInit {
  rules: AlertRule[] = [];
  loading = true;
  error = '';

  constructor(
    private readonly alertsApi: AlertsApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.rules = await this.alertsApi.getRules();
    } catch {
      this.error = 'Failed to load alert rules.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async toggleEnabled(rule: AlertRule): Promise<void> {
    try {
      await this.alertsApi.updateRule(rule.id, { is_enabled: !rule.is_enabled });
      await this.load();
    } catch {
      this.error = 'Failed to update rule.';
      this.cdr.markForCheck();
    }
  }

  conditionSummary(rule: AlertRule): string {
    switch (rule.condition) {
      case 'gt':
        return `> ${rule.threshold_hi}`;
      case 'lt':
        return `< ${rule.threshold_lo}`;
      case 'outside_range':
        return `outside [${rule.threshold_lo}, ${rule.threshold_hi}]`;
      case 'inside_range':
        return `inside [${rule.threshold_lo}, ${rule.threshold_hi}]`;
      case 'no_data':
        return `no data > ${rule.no_data_seconds}s`;
      default:
        return rule.condition;
    }
  }
}
