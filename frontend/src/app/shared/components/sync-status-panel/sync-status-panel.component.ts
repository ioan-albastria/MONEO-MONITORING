import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { SyncHealth, SyncSource } from '../../../types/sync-health';
import { SyncHealthService } from '../../../core/services/sync-health.service';

@Component({
  selector: 'app-sync-status-panel',
  standalone: false,
  templateUrl: './sync-status-panel.component.html',
  styleUrl: './sync-status-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncStatusPanelComponent {
  @Input() health!: SyncHealth;
  @Output() closePanel = new EventEmitter<void>();

  showMoreReadingsError = false;
  showMoreMetadataError = false;

  private readonly syncHealth = inject(SyncHealthService);
  private readonly cdr = inject(ChangeDetectorRef);

  close(): void {
    this.closePanel.emit();
  }

  refresh(): void {
    this.syncHealth.forceRefresh();
  }

  humanizeLag(seconds: number | null): string {
    if (seconds === null) return '—';
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return s > 0 ? `${m} m ${s} s` : `${m} m`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h} h ${m} m` : `${h} h`;
  }

  relativeTime(date: Date): string {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 90) return 'just now';
    if (secs < 5400) return `${Math.round(secs / 60)} min ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
    return `${Math.round(secs / 86400)}d ago`;
  }

  badgeClass(source: SyncSource): string {
    switch (source.derivedStatus) {
      case 'healthy':  return 'sync-badge--ok';
      case 'degraded': return 'sync-badge--warn';
      case 'failed':   return 'sync-badge--error';
      default:         return '';
    }
  }
}
