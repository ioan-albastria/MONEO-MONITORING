import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AdminApiService, KioskTokenAdminRead } from '../../core/admin/admin-api.service';
import { ToastService } from '../../shared/toast.service';

interface KioskCreateForm {
  label: string;
  dashboardIds: string;   // comma-separated, parsed on submit
  expiresDays: number;
  cycleSeconds: number;   // for URL builder only
}

@Component({
  selector: 'app-admin-kiosk-tokens',
  standalone: false,
  templateUrl: './admin-kiosk-tokens.component.html',
  styleUrl: './admin-kiosk-tokens.component.css',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminKioskTokensComponent implements OnInit {
  tokens: KioskTokenAdminRead[] = [];
  loading = true;
  error: string | null = null;

  // Create form
  showCreateForm = false;
  creating = false;
  createError: string | null = null;
  form: KioskCreateForm = {
    label: '',
    dashboardIds: '',
    expiresDays: 365,
    cycleSeconds: 0,
  };

  // Newly created token — shown in modal
  newToken: string | null = null;
  newTokenUrl: string | null = null;
  showTokenModal = false;

  constructor(
    private readonly api: AdminApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly toast: ToastService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadTokens();
  }

  async loadTokens(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.cdr.detectChanges();
    try {
      this.tokens = await this.api.listKioskTokens();
    } catch {
      this.error = 'Failed to load kiosk tokens.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  toggleCreateForm(): void {
    this.showCreateForm = !this.showCreateForm;
    this.createError = null;
  }

  dismissTokenModal(): void {
    this.showTokenModal = false;
    this.newToken = null;
    this.newTokenUrl = null;
  }

  async createToken(): Promise<void> {
    this.createError = null;
    const ids = this.form.dashboardIds
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0);

    if (ids.length === 0) {
      this.createError = 'Enter at least one dashboard ID.';
      return;
    }

    this.creating = true;
    this.cdr.detectChanges();
    try {
      const result = await this.api.createKioskToken({
        dashboard_ids: ids,
        label: this.form.label.trim() || undefined,
        expires_days: this.form.expiresDays,
      });
      this.newToken = result.token ?? null;
      this.newTokenUrl = this._buildKioskUrl(result, this.form.cycleSeconds);
      this.showTokenModal = true;
      this.showCreateForm = false;
      await this.loadTokens();
    } catch {
      this.createError = 'Failed to create kiosk token.';
    } finally {
      this.creating = false;
      this.cdr.detectChanges();
    }
  }

  async revokeToken(token: KioskTokenAdminRead): Promise<void> {
    if (!confirm(`Revoke token "${token.label || token.id}"? This cannot be undone.`)) return;
    try {
      await this.api.revokeKioskToken(token.id);
      await this.loadTokens();
    } catch {
      this.error = 'Failed to revoke token.';
      this.cdr.detectChanges();
    }
  }

  copyToClipboard(text: string, label = 'Copied to clipboard!'): void {
    navigator.clipboard.writeText(text).then(
      () => this.toast.push(label, 'success', 2500),
      () => {
        const el = document.createElement('input');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        this.toast.push(label, 'success', 2500);
      }
    );
  }

  private _buildKioskUrl(token: KioskTokenAdminRead, cycleSeconds: number): string {
    const base = `${window.location.origin}/dashboard`;
    const params = new URLSearchParams();
    if (this.newToken) params.set('kt', this.newToken);
    if (token.dashboard_ids.length === 1) params.set('d', String(token.dashboard_ids[0]));
    if (cycleSeconds > 0 && token.dashboard_ids.length > 1) params.set('cycle', String(cycleSeconds));
    return `${base}?${params.toString()}`;
  }

  formatExpiry(expiresAt: string | null): string {
    if (!expiresAt) return 'Never';
    return new Date(expiresAt).toLocaleDateString();
  }
}
