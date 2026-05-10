import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { DashboardApiService } from './dashboard-api.service';
import { PageHeaderStateService } from '../../core/ui/page-header-state.service';
import {
  Dashboard,
  DashboardCreate,
  DashboardSummary,
  DashboardUpdate,
  DashboardWidget,
  DashboardWidgetLayoutItem,
} from '../../types/dashboard';

// --- local form model ---

type DashboardFormModel = {
  name: string;
  description: string;
  is_public: boolean;
};

// --- component ---

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly selectedDashboardStorageKey = 'dashboard.selectedId';
  private destroyed = false;

  // --- Phase 8.1 state ---
  ownedDashboards: DashboardSummary[] = [];
  publicDashboards: DashboardSummary[] = [];
  selectedDashboardId: number | null = null;
  selectedDashboard: Dashboard | null = null;
  isOwnedSelected = false;
  loadError: string | null = null;
  publicError: string | null = null;
  layoutError: string | null = null;
  loading = true;
  publicLoading = false;
  saving = false;

  editorOpen = false;
  editorMode: 'create' | 'edit' = 'create';
  dashboardForm: DashboardFormModel = this.emptyForm();

  publicCatalogOpen = false;

  // widget editor — slate 3 no-ops
  widgetEditorOpen = false;
  widgetEditorMode: 'create' | 'edit' = 'create';
  editingWidget: DashboardWidget | null = null;

  editMode = false;

  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private layoutInFlight = false;
  private layoutQueued = false;
  private suppressLayout = false;

  constructor(
    private readonly api: DashboardApiService,
    private readonly pageHeaderState: PageHeaderStateService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadDashboards();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.pageHeaderState.clear();
  }

  // --- computed getters ---

  get canEditSelected(): boolean {
    return !!this.selectedDashboard?.is_owned;
  }

  trackDashboard(_: number, d: DashboardSummary): number { return d.id; }
  trackWidget(_: number, w: DashboardWidget): number { return w.id; }

  // --- dashboard selection ---

  async selectDashboardById(rawValue: string | number): Promise<void> {
    const nextId = Number(rawValue);
    if (!Number.isFinite(nextId) || nextId <= 0) {
      this.selectedDashboardId = null;
      this.selectedDashboard = null;
      this.isOwnedSelected = false;
      this.persistSelectedId(null);
      this.syncPageHeader();
      this.refreshView();
      return;
    }

    this.selectedDashboardId = nextId;
    this.persistSelectedId(nextId);
    this.refreshView();

    try {
      this.selectedDashboard = await this.api.getDashboard(nextId);
      this.isOwnedSelected = this.selectedDashboard.is_owned;
      this.syncPageHeader();
      this.refreshView();
    } catch {
      this.loadError = 'Failed to load dashboard.';
      this.refreshView();
    }
  }

  // --- dashboard editor ---

  openCreator(): void {
    this.editorMode = 'create';
    this.dashboardForm = this.emptyForm();
    this.loadError = null;
    this.editorOpen = true;
  }

  openEditor(): void {
    const d = this.selectedDashboard;
    if (!d?.is_owned) return;
    this.editorMode = 'edit';
    this.dashboardForm = { name: d.name, description: d.description ?? '', is_public: d.is_public };
    this.loadError = null;
    this.editorOpen = true;
  }

  closeEditor(): void {
    this.editorOpen = false;
  }

  async saveDashboard(): Promise<void> {
    if (this.saving) return;
    const name = this.dashboardForm.name.trim();
    if (!name) { this.loadError = 'Dashboard name is required.'; return; }

    this.saving = true;
    this.loadError = null;

    try {
      let saved: Dashboard;
      if (this.editorMode === 'create') {
        const body: DashboardCreate = {
          name,
          description: this.dashboardForm.description.trim() || undefined,
          is_public: !!this.dashboardForm.is_public,
        };
        saved = await this.api.createDashboard(body);
      } else {
        const body: DashboardUpdate = {
          name,
          description: this.dashboardForm.description.trim() || undefined,
          is_public: !!this.dashboardForm.is_public,
        };
        saved = await this.api.updateDashboard(this.selectedDashboard!.id, body);
      }
      this.editorOpen = false;
      await this.loadDashboards(saved.id);
    } catch (err: unknown) {
      this.loadError = err instanceof Error ? err.message : 'Failed to save dashboard.';
    } finally {
      this.saving = false;
    }
  }

  async deleteSelectedDashboard(): Promise<void> {
    const d = this.selectedDashboard;
    if (!d?.is_owned || this.saving) return;
    if (!window.confirm(`Delete dashboard "${d.name}"? This cannot be undone.`)) return;

    this.saving = true;
    this.loadError = null;
    try {
      await this.api.deleteDashboard(d.id);
      await this.loadDashboards();
    } catch (err: unknown) {
      this.loadError = err instanceof Error ? err.message : 'Failed to delete dashboard.';
    } finally {
      this.saving = false;
    }
  }

  // --- public catalog ---

  async openPublicCatalog(): Promise<void> {
    this.publicCatalogOpen = true;
    this.publicError = null;
    this.refreshView();
    await this.refreshPublicDashboards();
  }

  closePublicCatalog(): void {
    this.publicCatalogOpen = false;
    this.refreshView();
  }

  async openPublicDashboard(id: number): Promise<void> {
    this.publicCatalogOpen = false;
    this.refreshView();
    await this.selectDashboardById(id);
  }

  // --- widget editor (no-op stubs — slice 3) ---

  openWidgetCreator(): void {
    if (!this.selectedDashboard?.is_owned) return;
    this.widgetEditorMode = 'create';
    this.editingWidget = null;
    this.widgetEditorOpen = true;
  }

  openWidgetEditor(widget: DashboardWidget): void {
    if (!this.selectedDashboard?.is_owned) return;
    this.widgetEditorMode = 'edit';
    this.editingWidget = widget;
    this.widgetEditorOpen = true;
  }

  closeWidgetEditor(): void {
    this.widgetEditorOpen = false;
    this.editingWidget = null;
  }

  async deleteWidget(widget: DashboardWidget): Promise<void> {
    const d = this.selectedDashboard;
    if (!d?.is_owned || this.saving) return;
    if (!window.confirm('Remove this widget from the dashboard?')) return;

    this.saving = true;
    this.loadError = null;
    try {
      await this.api.deleteWidget(widget.id);
      this.selectedDashboard = await this.api.getDashboard(d.id);
      this.syncPageHeader();
      this.refreshView();
    } catch (err: unknown) {
      this.loadError = err instanceof Error ? err.message : 'Failed to delete widget.';
    } finally {
      this.saving = false;
    }
  }

  // --- layout persistence (gridster callbacks — wired in slice 3) ---

  queueLayoutPersistence(): void {
    if (!this.canEditSelected || this.suppressLayout) return;
    this.layoutQueued = true;
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = null;
      void this.flushLayout();
    }, 320);
  }

  private async flushLayout(): Promise<void> {
    const d = this.selectedDashboard;
    if (!d?.is_owned || !this.layoutQueued) return;
    if (this.layoutInFlight) return;

    this.layoutQueued = false;
    this.layoutInFlight = true;
    this.layoutError = null;

    try {
      const items: DashboardWidgetLayoutItem[] = d.widgets.map((w) => ({
        id: w.id, x: w.x, y: w.y, cols: w.cols, rows: w.rows,
      }));
      await this.api.saveLayout(d.id, items);
    } catch (err: unknown) {
      this.layoutError = err instanceof Error ? err.message : 'Failed to save layout.';
    } finally {
      this.layoutInFlight = false;
      if (this.layoutQueued) void this.flushLayout();
    }
  }

  // --- private helpers ---

  private async loadDashboards(preferredId?: number): Promise<void> {
    this.loading = true;
    this.loadError = null;
    this.layoutError = null;
    this.refreshView();

    try {
      this.suppressLayout = true;
      const [owned, pub] = await Promise.all([
        this.api.listDashboards(),
        this.api.listPublicDashboards(),
      ]);

      this.ownedDashboards = owned.map((d) => ({ ...d, is_owned: true }));
      const ownedIds = new Set(owned.map((d) => d.id));
      this.publicDashboards = pub.map((d) => ({ ...d, is_owned: ownedIds.has(d.id) }));

      const allIds = new Set([...owned.map((d) => d.id), ...pub.map((d) => d.id)]);
      const restoredId = preferredId ?? this.restoreSelectedId();
      const nextId = restoredId && allIds.has(restoredId) ? restoredId
        : owned[0]?.id ?? null;

      this.selectedDashboardId = nextId;
      this.persistSelectedId(nextId);

      if (nextId) {
        this.selectedDashboard = await this.api.getDashboard(nextId);
        this.isOwnedSelected = this.selectedDashboard.is_owned;
      } else {
        this.selectedDashboard = null;
        this.isOwnedSelected = false;
      }
      this.syncPageHeader();
    } catch (err: unknown) {
      this.loadError = err instanceof Error ? err.message : 'Failed to load dashboards.';
      this.ownedDashboards = [];
      this.publicDashboards = [];
      this.selectedDashboard = null;
      this.selectedDashboardId = null;
      this.isOwnedSelected = false;
      this.syncPageHeader();
    } finally {
      this.loading = false;
      this.refreshView();
      setTimeout(() => { this.suppressLayout = false; }, 0);
    }
  }

  private async refreshPublicDashboards(): Promise<void> {
    this.publicLoading = true;
    this.publicError = null;
    this.refreshView();
    try {
      const pub = await this.api.listPublicDashboards();
      const ownedIds = new Set(this.ownedDashboards.map((d) => d.id));
      this.publicDashboards = pub.map((d) => ({ ...d, is_owned: ownedIds.has(d.id) }));
    } catch (err: unknown) {
      this.publicError = err instanceof Error ? err.message : 'Failed to load public dashboards.';
    } finally {
      this.publicLoading = false;
      this.refreshView();
    }
  }

  private syncPageHeader(): void {
    const d = this.selectedDashboard;
    if (!d) {
      this.pageHeaderState.set({
        title: 'Dashboard',
        subtitle: 'Create a dashboard or open one from the public catalog.',
        stats: this.ownedDashboards.length ? [`${this.ownedDashboards.length} dashboards`] : [],
      });
      return;
    }
    const stats = [`${d.widgets.length} widgets`, d.is_public ? 'Public' : 'Private'];
    if (!d.is_owned) stats.push('Read-only');
    this.pageHeaderState.set({
      title: d.name,
      subtitle: d.description || 'Operational sensor dashboard.',
      stats,
    });
  }

  private emptyForm(): DashboardFormModel {
    return { name: '', description: '', is_public: false };
  }

  private restoreSelectedId(): number | null {
    try {
      const raw = localStorage.getItem(this.selectedDashboardStorageKey);
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch { return null; }
  }

  private persistSelectedId(value: number | null): void {
    try {
      if (value === null) localStorage.removeItem(this.selectedDashboardStorageKey);
      else localStorage.setItem(this.selectedDashboardStorageKey, String(value));
    } catch { /* ignore */ }
  }

  private refreshView(): void {
    if (this.destroyed) return;
    this.cdr.detectChanges();
  }
}
