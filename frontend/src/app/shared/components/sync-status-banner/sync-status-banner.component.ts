import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SyncHealth } from '../../../types/sync-health';
import { SyncHealthService } from '../../../core/services/sync-health.service';

const DISMISSED_KEY     = 'sync-banner-dismissed';
const DISMISSED_SIG_KEY = 'sync-banner-error-sig';

@Component({
  selector: 'app-sync-status-banner',
  standalone: false,
  templateUrl: './sync-status-banner.component.html',
  styleUrl: './sync-status-banner.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncStatusBannerComponent implements OnInit {
  health: SyncHealth | null = null;
  showBanner = false;
  isPanelOpen = false;

  readonly syncHealth = inject(SyncHealthService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.syncHealth
      .watchHealth()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(h => {
        this.health = h;
        this.showBanner = this._computeShowBanner(h);
        this.cdr.markForCheck();
      });
  }

  dismiss(): void {
    if (!this.health) return;
    const sig = this._errorSignature(this.health);
    sessionStorage.setItem(DISMISSED_KEY, 'true');
    sessionStorage.setItem(DISMISSED_SIG_KEY, sig);
    this.showBanner = false;
    this.isPanelOpen = false;
    this.cdr.markForCheck();
  }

  openPanel(): void {
    this.isPanelOpen = true;
    this.cdr.markForCheck();
  }

  closePanel(): void {
    this.isPanelOpen = false;
    this.cdr.markForCheck();
  }

  private _computeShowBanner(h: SyncHealth | null): boolean {
    if (!h || h.overall !== 'failed') return false;
    const currentSig = this._errorSignature(h);
    const isDismissed = sessionStorage.getItem(DISMISSED_KEY) === 'true';
    const storedSig   = sessionStorage.getItem(DISMISSED_SIG_KEY);
    return !(isDismissed && storedSig === currentSig);
  }

  private _errorSignature(h: SyncHealth): string {
    return `${h.readings.lastErrorKind ?? ''}|${h.metadata.lastErrorKind ?? ''}`;
  }
}
