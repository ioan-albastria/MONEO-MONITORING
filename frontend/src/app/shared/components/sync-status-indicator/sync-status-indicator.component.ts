import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  HostListener,
  inject,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SyncHealth } from '../../../types/sync-health';
import { SyncHealthService } from '../../../core/services/sync-health.service';

@Component({
  selector: 'app-sync-status-indicator',
  standalone: false,
  templateUrl: './sync-status-indicator.component.html',
  styleUrl: './sync-status-indicator.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncStatusIndicatorComponent implements OnInit {
  health: SyncHealth | null = null;
  isPanelOpen = false;

  private readonly syncHealth = inject(SyncHealthService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.syncHealth
      .watchHealth()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(h => {
        this.health = h;
        this.cdr.markForCheck();
      });
  }

  get label(): string {
    switch (this.health?.overall) {
      case 'healthy':  return 'Sync OK';
      case 'degraded': return 'Sync degraded';
      case 'failed':   return 'Sync failed';
      case 'pending':  return 'Awaiting first sync';
      default:         return '';
    }
  }

  get ariaLabel(): string {
    return `Sync status: ${this.label}`;
  }

  get dotClass(): string {
    switch (this.health?.overall) {
      case 'healthy':  return 'sync-dot--ok';
      case 'degraded': return 'sync-dot--warn';
      case 'failed':   return 'sync-dot--error';
      case 'pending':  return 'sync-dot--pending';
      default:         return '';
    }
  }

  togglePanel(): void {
    this.isPanelOpen = !this.isPanelOpen;
    this.cdr.markForCheck();
  }

  closePanel(): void {
    this.isPanelOpen = false;
    this.cdr.markForCheck();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('app-sync-status-indicator')) {
      this.isPanelOpen = false;
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isPanelOpen) {
      this.isPanelOpen = false;
      this.cdr.markForCheck();
    }
  }
}
