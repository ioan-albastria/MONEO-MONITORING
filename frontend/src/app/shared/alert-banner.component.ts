import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { AlertEvent } from '../types/alert';
import { AlertsApiService } from '../core/alerts/alerts-api.service';

@Component({
  selector: 'app-alert-banner',
  standalone: false,
  templateUrl: './alert-banner.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertBannerComponent implements OnInit, OnDestroy {
  activeEvents: AlertEvent[] = [];
  private _interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly alertsApi: AlertsApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    void this._fetchActive();
    this._interval = setInterval(() => void this._fetchActive(), 30_000);
  }

  ngOnDestroy(): void {
    if (this._interval !== null) clearInterval(this._interval);
  }

  get critCount(): number {
    return this.activeEvents.filter((e) => e.state === 'firing' || e.state === 'awaiting_ack').length;
  }

  get hasActive(): boolean {
    return this.activeEvents.length > 0;
  }

  private async _fetchActive(): Promise<void> {
    try {
      this.activeEvents = await this.alertsApi.getActiveEvents();
      this.cdr.markForCheck();
    } catch {
      // silently ignore — banner is non-critical
    }
  }
}
