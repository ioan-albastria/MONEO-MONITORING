import {
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {
  GridsterConfig,
  GridsterItem,
  GridType,
  CompactType,
  DisplayGrid,
} from 'angular-gridster2';
import { DashboardApiService } from './dashboard-api.service';
import { SensorApiService } from '../../core/sensors/sensor-api.service';
import { PageHeaderStateService } from '../../core/ui/page-header-state.service';
import { AuthService } from '../../core/auth/auth.service';
import {
  Dashboard,
  DashboardCreate,
  DashboardSummary,
  DashboardUpdate,
  DashboardWidget,
  DashboardWidgetLayoutItem,
  DashboardWidgetType,
} from '../../types/dashboard';
import { DashboardWidgetCreate, DashboardWidgetUpdate, WidgetSettings } from '../../types/widget';
import { Sensor } from '../../types/sensor';

// ── Local form models ──────────────────────────────────────────────────────

type DashboardFormModel = {
  name: string;
  description: string;
  is_public: boolean;
};

type WidgetFormModel = {
  type: DashboardWidgetType;
  title: string;
  subtitle: string;
  sensorIds: number[];
  timeMode: 'relative' | 'absolute';
  timeRangeHours: number;
  from: string;
  to: string;
  gaugeMin: number;
  gaugeMax: number;
  normalMax:   number | null;
  warningMax:  number | null;
  criticalMax: number | null;
};

// ── Widget catalog ─────────────────────────────────────────────────────────

interface WidgetCatalogItem {
  type: DashboardWidgetType;
  label: string;
  description: string;
  defaultCols: number;
  defaultRows: number;
  defaultSettings: WidgetSettings;
}

// ── Grid item ──────────────────────────────────────────────────────────────

interface GridItem {
  gridsterItem: GridsterItem;
  widget: DashboardWidget;
}

// ── Component ──────────────────────────────────────────────────────────────

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {

  private readonly selectedDashboardStorageKey = 'dashboard.selectedId';
  private destroyed = false;
  private lastSelectFocusMs = 0;

  // ── Phase 8.1 state ────────────────────────────────────────────────────

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

  // ── Dashboard editor ───────────────────────────────────────────────────

  editorOpen = false;
  editorMode: 'create' | 'edit' = 'create';
  dashboardForm: DashboardFormModel = this.emptyDashboardForm();

  // ── Public catalog ─────────────────────────────────────────────────────

  publicCatalogOpen = false;

  // ── Gridster (Phase 8.3) ───────────────────────────────────────────────

  editMode = false;
  gridItems: GridItem[] = [];
  gridOptions: GridsterConfig = this.buildGridOptions();

  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private layoutInFlight = false;
  private layoutQueued = false;
  private suppressLayout = false;

  // ── Widget catalog (Phase 9) ───────────────────────────────────────────

  readonly widgetCatalog: WidgetCatalogItem[] = [
    {
      type: 'line_chart',
      label: 'Line Chart',
      description: 'Time-series readings for one or more sensors over a window.',
      defaultCols: 12,
      defaultRows: 5,
      defaultSettings: { sensor_ids: [], time_range_hours: 24, aggregated: true, bucket_minutes: 60, show_legend: true },
    },
    {
      type: 'bar_chart',
      label: 'Bar Chart',
      description: 'Aggregated values per sensor (avg / min / max in a bucket).',
      defaultCols: 8,
      defaultRows: 5,
      defaultSettings: { sensor_ids: [], time_range_hours: 24, aggregated: true, bucket_minutes: 60 },
    },
    {
      type: 'gauge',
      label: 'Gauge',
      description: 'Live circular gauge for the most recent reading of one sensor.',
      defaultCols: 4,
      defaultRows: 4,
      defaultSettings: { sensor_ids: [], gauge_min: 0, gauge_max: 100 },
    },
    {
      type: 'stat_card',
      label: 'Stat Card',
      description: 'Single big number with trend label, live-updating.',
      defaultCols: 4,
      defaultRows: 3,
      defaultSettings: { sensor_ids: [] },
    },
  ];

  // ── Widget editor (Phase 8.7) ──────────────────────────────────────────

  widgetEditorOpen = false;
  widgetEditorMode: 'create' | 'edit' = 'create';
  editingWidget: DashboardWidget | null = null;
  widgetForm: WidgetFormModel = this.emptyWidgetForm();
  widgetError: string | null = null;
  widgetSaving = false;
  availableSensors: Sensor[] = [];
  sensorsLoading = false;


  constructor(
    private readonly api: DashboardApiService,
    private readonly sensorApi: SensorApiService,
    private readonly pageHeaderState: PageHeaderStateService,
    private readonly cdr: ChangeDetectorRef,
    private readonly auth: AuthService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadDashboards();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.pageHeaderState.clear();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.publicCatalogOpen) { this.closePublicCatalog(); return; }
    if (this.editorOpen) { this.closeEditor(); return; }
    if (this.widgetEditorOpen) { this.closeWidgetEditor(); return; }
  }

  // ── Computed ───────────────────────────────────────────────────────────

  get canEditSelected(): boolean {
    return !!this.selectedDashboard?.is_owned;
  }

  trackDashboard(_: number, d: DashboardSummary): number { return d.id; }
  trackWidget(_: number, w: DashboardWidget): number { return w.id; }
  trackGridItem(_: number, gi: GridItem): number { return gi.widget.id; }

  // ── Dashboard selection ────────────────────────────────────────────────

  async onSelectFocus(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSelectFocusMs < 1500) return;
    this.lastSelectFocusMs = now;
    try {
      const owned = await this.api.listDashboards();
      this.ownedDashboards = owned.map(d => ({ ...d, is_owned: true }));
      this.refreshView();
    } catch { /* best-effort refresh */ }
  }

  async selectDashboardById(rawValue: string | number): Promise<void> {
    const nextId = Number(rawValue);
    if (!Number.isFinite(nextId) || nextId <= 0) {
      this.selectedDashboardId = null;
      this.selectedDashboard = null;
      this.isOwnedSelected = false;
      this.gridItems = [];
      this.persistSelectedId(null);
      this.syncPageHeader();
      this.refreshView();
      return;
    }

    const isKnown = this.ownedDashboards.some(d => d.id === nextId)
      || this.publicDashboards.some(d => d.id === nextId);

    if (!isKnown) {
      // Dashboard not yet in any local list (e.g. just created via API in a test).
      // Refresh the full lists so the <option> appears in the DOM before Angular
      // re-evaluates [value], preventing the browser from resetting the select.
      await this.loadDashboards(nextId);
      return;
    }

    this.selectedDashboardId = nextId;
    this.selectedDashboard = null;
    this.isOwnedSelected = false;
    this.gridItems = [];
    this.persistSelectedId(nextId);
    this.refreshView();

    try {
      this.selectedDashboard = this.stampOwnership(await this.api.getDashboard(nextId));
      this.isOwnedSelected = this.selectedDashboard.is_owned;
      this.buildGridItems();
      this.syncPageHeader();
      this.refreshView();
    } catch {
      this.loadError = 'Failed to load dashboard.';
      this.refreshView();
    }
  }

  // ── Edit mode toggle ───────────────────────────────────────────────────

  toggleEditMode(): void {
    if (!this.canEditSelected) return;
    this.editMode = !this.editMode;
    this.gridOptions = {
      ...this.gridOptions,
      draggable: { ...this.gridOptions.draggable, enabled: this.editMode },
      resizable: { ...this.gridOptions.resizable, enabled: this.editMode },
      displayGrid: this.editMode ? DisplayGrid.Always : DisplayGrid.None,
    };
    this.gridOptions.api?.optionsChanged?.();
    this.refreshView();
  }

  // ── Layout persistence ─────────────────────────────────────────────────

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
      const items: DashboardWidgetLayoutItem[] = this.gridItems.map(({ gridsterItem, widget }) => ({
        id: widget.id,
        x: gridsterItem['x'] ?? 0,
        y: gridsterItem['y'] ?? 0,
        cols: gridsterItem['cols'] ?? 1,
        rows: gridsterItem['rows'] ?? 1,
      }));
      await this.api.saveLayout(d.id, items);
    } catch (err: unknown) {
      this.layoutError = err instanceof Error ? err.message : 'Failed to save layout.';
    } finally {
      this.layoutInFlight = false;
      if (this.layoutQueued) void this.flushLayout();
    }
  }

  // ── Dashboard editor ───────────────────────────────────────────────────

  openCreator(): void {
    this.editorMode = 'create';
    this.dashboardForm = this.emptyDashboardForm();
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

  // ── Public catalog ─────────────────────────────────────────────────────

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

  // ── Widget editor ──────────────────────────────────────────────────────

  openWidgetCreator(): void {
    if (!this.selectedDashboard?.is_owned) return;
    this.widgetEditorMode = 'create';
    this.editingWidget = null;
    this.widgetForm = this.emptyWidgetForm();
    this.widgetError = null;
    this.widgetEditorOpen = true;
    void this.loadSensors();
  }

  async openWidgetEditor(widget: DashboardWidget): Promise<void> {
    if (!this.selectedDashboard?.is_owned) return;
    this.widgetEditorMode = 'edit';
    this.editingWidget = widget;
    const s = widget.settings ?? {};
    this.widgetForm = {
      ...this.emptyWidgetForm(),
      type: widget.widget_type,
      title: widget.title ?? '',
      subtitle: widget.subtitle ?? '',
      sensorIds: [...(s.sensor_ids ?? [])],
      timeMode: (s.time_range_hours ?? 0) > 0 ? 'relative' : 'absolute',
      timeRangeHours: s.time_range_hours ?? 24,
      from: s.from ?? '',
      to: s.to ?? '',
      gaugeMin: s.gauge_min ?? 0,
      gaugeMax: s.gauge_max ?? 100,
    };
    this.widgetError = null;
    this.widgetEditorOpen = true;
    await this.loadSensors();
    this.populateRangesFromSensor();
    this.refreshView();
  }

  closeWidgetEditor(): void {
    this.widgetEditorOpen = false;
    this.editingWidget = null;
  }

  selectWidgetType(type: DashboardWidgetType): void {
    this.widgetForm = { ...this.widgetForm, type };
  }

  async saveWidget(): Promise<void> {
    if (this.widgetSaving) return;

    if (!this.widgetForm.sensorIds.length) {
      this.widgetError = 'Select at least one sensor.';
      return;
    }

    // Coerce to number — Angular may return "" for cleared number inputs at runtime
    const toNum = (v: number | null): number | null => {
      if (v === null || v === ('' as unknown as null)) return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };

    const gMin = toNum(this.widgetForm.gaugeMin);
    const gMax = toNum(this.widgetForm.gaugeMax);
    if (gMin !== null && gMax !== null && gMin >= gMax) {
      this.widgetError = 'Gauge max must be greater than gauge min.';
      return;
    }

    const nMax = toNum(this.widgetForm.normalMax);
    const wMax = toNum(this.widgetForm.warningMax);
    const cMax = toNum(this.widgetForm.criticalMax);
    if (nMax !== null && wMax !== null && nMax >= wMax) {
      this.widgetError = 'Warning threshold must be greater than Normal.';
      return;
    }
    if (wMax !== null && cMax !== null && wMax >= cMax) {
      this.widgetError = 'Critical threshold must be greater than Warning.';
      return;
    }
    if (nMax !== null && cMax !== null && wMax === null && nMax >= cMax) {
      this.widgetError = 'Critical threshold must be greater than Normal.';
      return;
    }

    this.widgetSaving = true;
    this.widgetError = null;

    try {
      const d = this.selectedDashboard!;
      const settings = this.buildWidgetSettings(this.widgetForm);

      if (this.widgetEditorMode === 'create') {
        const catalog = this.widgetCatalog.find(c => c.type === this.widgetForm.type)!;
        const nextY = this.computeNextY();
        const payload: DashboardWidgetCreate = {
          widget_type: this.widgetForm.type,
          title: this.widgetForm.title.trim() || undefined,
          subtitle: this.widgetForm.subtitle.trim() || undefined,
          x: 0,
          y: nextY,
          cols: catalog.defaultCols,
          rows: catalog.defaultRows,
          settings,
        };
        await this.api.createWidget(d.id, payload);
      } else {
        const payload: DashboardWidgetUpdate = {
          title: this.widgetForm.title.trim() || undefined,
          subtitle: this.widgetForm.subtitle.trim() || undefined,
          settings,
        };
        await this.api.updateWidget(this.editingWidget!.id, payload);
      }

      if (this.widgetForm.sensorIds.length === 1) {
        try {
          const updated = await this.sensorApi.updateRanges(this.widgetForm.sensorIds[0], {
            normal_max:   nMax,
            warning_max:  wMax,
            critical_max: cMax,
          });
          // Bust the stale sensor cache so re-opening the editor shows saved values
          const idx = this.availableSensors.findIndex(s => s.id === updated.id);
          if (idx >= 0) this.availableSensors[idx] = updated;
        } catch { /* non-fatal: widget saved, ranges silently skipped */ }
      }

      this.widgetEditorOpen = false;
      this.editingWidget = null;
      this.selectedDashboard = this.stampOwnership(await this.api.getDashboard(d.id));
      this.isOwnedSelected = this.selectedDashboard.is_owned;
      this.buildGridItems();
      this.syncPageHeader();
      this.refreshView();
    } catch (err: unknown) {
      this.widgetError = err instanceof Error ? err.message : 'Failed to save widget.';
    } finally {
      this.widgetSaving = false;
    }
  }

  async deleteWidget(widget: DashboardWidget): Promise<void> {
    const d = this.selectedDashboard;
    if (!d?.is_owned || this.saving) return;
    if (!window.confirm('Remove this widget from the dashboard?')) return;

    this.saving = true;
    this.loadError = null;
    try {
      await this.api.deleteWidget(widget.id);
      this.selectedDashboard = this.stampOwnership(await this.api.getDashboard(d.id));
      this.isOwnedSelected = this.selectedDashboard.is_owned;
      this.buildGridItems();
      this.syncPageHeader();
      this.refreshView();
    } catch (err: unknown) {
      this.loadError = err instanceof Error ? err.message : 'Failed to delete widget.';
    } finally {
      this.saving = false;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private stampOwnership(dashboard: Dashboard): Dashboard {
    const uid = this.auth.currentUser?.id;
    const isOwned = this.ownedDashboards.some(d => d.id === dashboard.id)
      || (uid != null && String(dashboard.owner_id) === String(uid));
    return { ...dashboard, is_owned: isOwned || !!dashboard.is_owned };
  }

  private buildGridOptions(): GridsterConfig {
    return {
      gridType: GridType.Fixed,
      fixedColWidth: 64,
      fixedRowHeight: 64,
      margin: 12,
      outerMargin: true,
      cols: 24,
      draggable: {
        enabled: false,
        ignoreContentClass: 'gridster-item-content',
        dragHandleClass: 'dashboard-widget-drag-handle',
      },
      resizable: { enabled: false },
      pushItems: true,
      compactType: CompactType.None,
      displayGrid: DisplayGrid.None,
      itemChangeCallback: () => this.queueLayoutPersistence(),
      itemResizeCallback: () => this.queueLayoutPersistence(),
    };
  }

  private buildGridItems(): void {
    this.suppressLayout = true;
    this.gridItems = (this.selectedDashboard?.widgets ?? []).map(w => ({
      gridsterItem: {
        x: w.x, y: w.y, cols: w.cols, rows: w.rows,
        minItemCols: 3,
        minItemRows: 3,
      } as GridsterItem,
      widget: w,
    }));
    setTimeout(() => { this.suppressLayout = false; }, 0);
  }

  private computeNextY(): number {
    if (!this.gridItems.length) return 0;
    return Math.max(...this.gridItems.map(gi =>
      (gi.gridsterItem['y'] ?? 0) + (gi.gridsterItem['rows'] ?? 1)
    ));
  }

  private buildWidgetSettings(form: WidgetFormModel): WidgetSettings {
    const s: WidgetSettings = { sensor_ids: [...form.sensorIds] };
    if (form.timeMode === 'relative') {
      s.time_range_hours = form.timeRangeHours;
    } else {
      s.from = form.from;
      s.to = form.to;
    }
    if (form.type === 'gauge') {
      s.gauge_min = form.gaugeMin;
      s.gauge_max = form.gaugeMax;
    }
    if (form.type === 'line_chart' || form.type === 'bar_chart') {
      s.aggregated = true;
      s.bucket_minutes = 60;
    }
    return s;
  }

  private async loadSensors(): Promise<void> {
    if (this.availableSensors.length) return;
    this.sensorsLoading = true;
    this.refreshView();
    try {
      this.availableSensors = await this.sensorApi.listSensors();
    } catch {
      // Non-fatal: sensor list stays empty, user sees empty multi-select
    } finally {
      this.sensorsLoading = false;
      this.refreshView();
    }
  }

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

      this.ownedDashboards = owned.map(d => ({ ...d, is_owned: true }));
      const ownedIds = new Set(owned.map(d => d.id));
      this.publicDashboards = pub.map(d => ({ ...d, is_owned: ownedIds.has(d.id) }));

      const allIds = new Set([...owned.map(d => d.id), ...pub.map(d => d.id)]);
      const restoredId = preferredId ?? this.restoreSelectedId();
      const nextId = restoredId && allIds.has(restoredId) ? restoredId
        : owned[0]?.id ?? null;

      this.selectedDashboardId = nextId;
      this.persistSelectedId(nextId);

      if (nextId) {
        this.selectedDashboard = this.stampOwnership(await this.api.getDashboard(nextId));
        this.isOwnedSelected = this.selectedDashboard.is_owned;
        this.buildGridItems();
      } else {
        this.selectedDashboard = null;
        this.isOwnedSelected = false;
        this.gridItems = [];
      }
      this.syncPageHeader();
    } catch (err: unknown) {
      this.loadError = err instanceof Error ? err.message : 'Failed to load dashboards.';
      this.ownedDashboards = [];
      this.publicDashboards = [];
      this.selectedDashboard = null;
      this.selectedDashboardId = null;
      this.isOwnedSelected = false;
      this.gridItems = [];
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
      const ownedIds = new Set(this.ownedDashboards.map(d => d.id));
      this.publicDashboards = pub.map(d => ({ ...d, is_owned: ownedIds.has(d.id) }));
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

  private emptyDashboardForm(): DashboardFormModel {
    return { name: '', description: '', is_public: false };
  }

  private emptyWidgetForm(): WidgetFormModel {
    return {
      type: 'line_chart',
      title: '',
      subtitle: '',
      sensorIds: [],
      timeMode: 'relative',
      timeRangeHours: 24,
      from: '',
      to: '',
      gaugeMin: 0,
      gaugeMax: 100,
      normalMax:   null,
      warningMax:  null,
      criticalMax: null,
    };
  }

  private populateRangesFromSensor(): void {
    if (this.widgetForm.sensorIds.length !== 1) return;
    const sensor = this.availableSensors.find(s => s.id === this.widgetForm.sensorIds[0]);
    if (!sensor) return;
    this.widgetForm.normalMax   = sensor.normal_max;
    this.widgetForm.warningMax  = sensor.warning_max;
    this.widgetForm.criticalMax = sensor.critical_max;
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
