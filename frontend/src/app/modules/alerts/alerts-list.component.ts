import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AlertEvent } from '../../types/alert';
import { AlertsApiService } from '../../core/alerts/alerts-api.service';

@Component({
  selector: 'app-alerts-list',
  standalone: false,
  templateUrl: './alerts-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertsListComponent implements OnInit {
  events: AlertEvent[] = [];
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
      this.events = await this.alertsApi.getActiveEvents();
    } catch {
      this.error = 'Failed to load active events.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async ack(event: AlertEvent): Promise<void> {
    try {
      await this.alertsApi.ackEvent(event.id);
      await this.load();
    } catch {
      this.error = 'Failed to acknowledge event.';
      this.cdr.markForCheck();
    }
  }

  severityClass(state: AlertEvent['state']): string {
    if (state === 'firing') return 'pill pill--critical';
    if (state === 'awaiting_ack') return 'pill pill--warning';
    return 'pill';
  }
}
