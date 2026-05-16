import {
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
import { DashboardTimeService, TimeRange, TimePreset, PRESET_HOURS } from '../../core/dashboard/time.service';
import { DashboardUrlService } from '../../core/dashboard/url.service';
import { KioskService } from '../../core/kiosk/kiosk.service';
import { ToastService } from '../../shared/toast.service';
import { Subscription } from 'rxjs';

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

// ── Smart defaults by sensor type ──────────────────────────────────────────

const SENSOR_TYPE_DEFAULTS: Record<string, {
  gaugeMin: number; gaugeMax: number;
  normalMax: number | null; warningMax: number | null; criticalMax: number | null;
}> = {
  'temperature':  { gaugeMin: 0,   gaugeMax: 100,  normalMax: 60,   warningMax: 80,  criticalMax: 95  },
  'pressure':     { gaugeMin: 0,   gaugeMax: 10,   normalMax: 7,    warningMax: 8.5, criticalMax: 9.5 },
  'humidity':     { gaugeMin: 0,   gaugeMax: 100,  normalMax: 70,   warningMax: 85,  criticalMax: 95  },
  'distance':     { gaugeMin: 0,   gaugeMax: 500,  normalMax: null, warningMax: null, criticalMax: null },
  'vibration':    { gaugeMin: 0,   gaugeMax: 50,   normalMax: 20,   warningMax: 35,  criticalMax: 45  },
  'current':      { gaugeMin: 0,   gaugeMax: 20,   normalMax: 15,   warningMax: 18,  criticalMax: 19  },
  'voltage':      { gaugeMin: 0,   gaugeMax: 500,  normalMax: 400,  warningMax: 440, criticalMax: 480 },
  'flow':         { gaugeMin: 0,   gaugeMax: 100,  normalMax: 80,   warningMax: 90,  criticalMax: null },
};

// ── Widget catalog ─────────────────────────────────────────────────────────

interface WidgetCatalogItem {
  type: DashboardWidgetType;
  label: string;
  description: string;
  tags: string[];
  bestFor: string;
  thumbnail: SafeHtml;
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

  // ── Time picker ────────────────────────────────────────────────────────
  readonly presets: TimePreset[] = ['15m', '1h', '6h', '24h', '7d', '30d'];
  readonly autoRefreshOptions = [
    { label: 'Off', value: 0 },
    { label: '10s', value: 10 },
    { label: '30s', value: 30 },
    { label: '1m',  value: 60 },
    { label: '5m',  value: 300 },
  ];
  timeRange: TimeRange = { preset: '1h', hours: 1, autoRefreshSeconds: 0 };
  private _timeRangeSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _kioskSub: Subscription | null = null;

  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private layoutInFlight = false;
  private layoutQueued = false;
  private suppressLayout = false;

  // ── Widget catalog (Phase 9) ───────────────────────────────────────────

  readonly widgetCatalog: WidgetCatalogItem[];

  // ── Widget editor (Phase 8.7) ──────────────────────────────────────────

  widgetEditorOpen = false;
  widgetEditorMode: 'create' | 'edit' = 'create';
  editingWidget: DashboardWidget | null = null;
  widgetForm: WidgetFormModel = this.emptyWidgetForm();
  widgetError: string | null = null;
  widgetSaving = false;
  availableSensors: Sensor[] = [];


  constructor(
    private readonly api: DashboardApiService,
    private readonly sensorApi: SensorApiService,
    private readonly pageHeaderState: PageHeaderStateService,
    private readonly cdr: ChangeDetectorRef,
    private readonly auth: AuthService,
    private readonly timeService: DashboardTimeService,
    private readonly sanitizer: DomSanitizer,
    private readonly urlService: DashboardUrlService,
    private readonly kioskService: KioskService,
    private readonly toast: ToastService,
  ) {
    const trust = (svg: string): SafeHtml => sanitizer.bypassSecurityTrustHtml(svg);
    this.widgetCatalog = [
      {
        type: 'line_chart',
        label: 'Line Chart',
        description: 'Time-series readings for one or more sensors over a window.',
        tags: ['time-series', 'multi-sensor'],
        bestFor: 'Trend analysis, pattern detection',
        thumbnail: trust(`<svg viewBox="0 0 80 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="0" y1="36" x2="80" y2="36" stroke="currentColor" stroke-opacity="0.12" stroke-dasharray="3 3"/>
          <line x1="0" y1="24" x2="80" y2="24" stroke="currentColor" stroke-opacity="0.12" stroke-dasharray="3 3"/>
          <polyline points="0,38 13,30 26,33 40,15 53,21 66,13 80,17"
            stroke="#37c79a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <polygon points="0,38 13,30 26,33 40,15 53,21 66,13 80,17 80,48 0,48"
            fill="#37c79a" fill-opacity="0.10"/>
        </svg>`),
        defaultCols: 12, defaultRows: 5,
        defaultSettings: { sensor_ids: [], time_range_inherit: true, aggregated: true, bucket_minutes: 60, show_legend: true },
      },
      {
        type: 'bar_chart',
        label: 'Bar Chart',
        description: 'Aggregated values per sensor (avg / min / max in a bucket).',
        tags: ['comparison', 'multi-sensor'],
        bestFor: 'Comparing sensors side-by-side',
        thumbnail: trust(`<svg viewBox="0 0 80 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="5"  y="24" width="14" height="20" rx="3" fill="#56b9ff" fill-opacity="0.80"/>
          <rect x="23" y="12" width="14" height="32" rx="3" fill="#37c79a" fill-opacity="0.80"/>
          <rect x="41" y="18" width="14" height="26" rx="3" fill="#f5b428" fill-opacity="0.80"/>
          <rect x="59" y="8"  width="14" height="36" rx="3" fill="#56b9ff" fill-opacity="0.80"/>
        </svg>`),
        defaultCols: 8, defaultRows: 5,
        defaultSettings: { sensor_ids: [], time_range_inherit: true, aggregated: true, bucket_minutes: 60 },
      },
      {
        type: 'gauge',
        label: 'Gauge',
        description: 'Live circular gauge for the most recent reading of one sensor.',
        tags: ['real-time', 'single-sensor'],
        bestFor: 'Live process values, current state',
        thumbnail: trust(`<svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 44 A30 30 0 1 1 70 44"
            stroke="currentColor" stroke-opacity="0.15" stroke-width="7" stroke-linecap="round" fill="none"/>
          <path d="M10 44 A30 30 0 0 1 58 17"
            stroke="#37c79a" stroke-width="7" stroke-linecap="round" fill="none"/>
          <circle cx="40" cy="44" r="14"
            fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/>
          <text x="40" y="49" text-anchor="middle" font-size="9" font-weight="600"
            fill="currentColor" fill-opacity="0.55">67%</text>
        </svg>`),
        defaultCols: 4, defaultRows: 4,
        defaultSettings: { sensor_ids: [], gauge_min: 0, gauge_max: 100 },
      },
      {
        type: 'stat_card',
        label: 'Stat Card',
        description: 'Single big number with trend label, live-updating.',
        tags: ['real-time', 'single-sensor'],
        bestFor: 'KPIs, current value at a glance',
        thumbnail: trust(`<svg viewBox="0 0 80 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <text x="8" y="34" font-size="26" font-weight="700"
            fill="currentColor" fill-opacity="0.75">42</text>
          <text x="54" y="26" font-size="9" fill="#37c79a" font-weight="600">+2.3%</text>
          <polyline points="8,44 22,40 36,42 50,36 64,38 78,32"
            stroke="#37c79a" stroke-width="1.5" fill="none" opacity="0.65"/>
        </svg>`),
        defaultCols: 4, defaultRows: 3,
        defaultSettings: { sensor_ids: [] },
      },
    ];
  }

  async ngOnInit(): Promise<void> {
    const urlParams = this.urlService.readParams();
    await this.loadDashboards(urlParams.d);

    // Apply URL time overrides (take precedence over dashboard defaults)
    this._applyUrlTimeParams(urlParams);

    // Sync URL with initial state after load
    this._syncUrlFromState();

    // If kiosk cycling is active, subscribe to dashboard rotation
    if (this.kioskService.isKiosk) {
      this._kioskSub = this.kioskService.activeDashboardId$.subscribe(id => {
        if (id != null && id !== this.selectedDashboardId) {
          void this.selectDashboardById(id);
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this._kioskSub?.unsubscribe();
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    if (this._timeRangeSaveTimer) clearTimeout(this._timeRangeSaveTimer);
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
      this.timeService.loadFromDashboard(this.selectedDashboard);
      this.timeRange = this.timeService.current;
      this.buildGridItems();
      this.syncPageHeader();
      this.refreshView();
      this._syncUrlFromState();
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

  async openWidgetCreator(): Promise<void> {
    if (!this.selectedDashboard?.is_owned) return;
    this.widgetEditorMode = 'create';
    this.editingWidget = null;
    this.widgetForm = this.emptyWidgetForm();
    this.widgetError = null;
    this.availableSensors = await this.sensorApi.listSensors();
    this.widgetEditorOpen = true;
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
    void this.sensorApi.listSensors().then(s => {
      this.availableSensors = s;
      this.populateRangesFromSensor();
      this.refreshView();
    });
    this.refreshView();
  }

  closeWidgetEditor(): void {
    this.widgetEditorOpen = false;
    this.editingWidget = null;
  }

  selectWidgetType(type: DashboardWidgetType): void {
    this.widgetForm = { ...this.widgetForm, type };
  }

  onWidgetSensorIdsChanged(ids: number[]): void {
    this.widgetForm.sensorIds = ids;
    if (this.widgetEditorMode !== 'create' || ids.length !== 1) return;
    const sensor = this.availableSensors.find(s => s.id === ids[0]);
    if (!sensor?.sensor_type) return;
    const defaults = SENSOR_TYPE_DEFAULTS[sensor.sensor_type.toLowerCase()];
    if (!defaults) return;
    const blank = this.emptyWidgetForm();
    if (this.widgetForm.gaugeMin === blank.gaugeMin)     this.widgetForm.gaugeMin     = defaults.gaugeMin;
    if (this.widgetForm.gaugeMax === blank.gaugeMax)     this.widgetForm.gaugeMax     = defaults.gaugeMax;
    if (this.widgetForm.normalMax  === blank.normalMax)  this.widgetForm.normalMax    = defaults.normalMax;
    if (this.widgetForm.warningMax === blank.warningMax) this.widgetForm.warningMax   = defaults.warningMax;
    if (this.widgetForm.criticalMax === blank.criticalMax) this.widgetForm.criticalMax = defaults.criticalMax;
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

  // ── Time picker ────────────────────────────────────────────────────────

  onPresetSelected(preset: TimePreset): void {
    const hours = preset !== 'custom' ? PRESET_HOURS[preset] : undefined;
    this.timeRange = { ...this.timeRange, preset, hours };
    this.timeService.setRange(this.timeRange);
    this._scheduleTimeRangeSave();
    this.refreshView();
    this._syncUrlFromState();
  }

  onAutoRefreshChanged(seconds: number): void {
    this.timeRange = { ...this.timeRange, autoRefreshSeconds: Number(seconds) };
    this.timeService.setRange(this.timeRange);
    this._scheduleTimeRangeSave();
    this.refreshView();
    this._syncUrlFromState();
  }

  private _scheduleTimeRangeSave(): void {
    if (!this.selectedDashboard?.is_owned) return;
    if (this._timeRangeSaveTimer) clearTimeout(this._timeRangeSaveTimer);
    this._timeRangeSaveTimer = setTimeout(async () => {
      const d = this.selectedDashboard;
      if (!d?.is_owned) return;
      const r = this.timeService.current;
      try {
        await this.api.updateDashboard(d.id, {
          default_time_range_hours: r.preset !== 'custom' ? (r.hours ?? null) : null,
          default_from:             r.preset === 'custom' ? (r.from ?? null) : null,
          default_to:               r.preset === 'custom' ? (r.to ?? null) : null,
          auto_refresh_seconds:     r.autoRefreshSeconds || null,
        });
      } catch { /* non-fatal */ }
    }, 500);
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
      s.time_range_inherit = true;
    } else {
      s.time_range_inherit = false;
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
        this.timeService.loadFromDashboard(this.selectedDashboard);
        this.timeRange = this.timeService.current;
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

  // ── URL state ──────────────────────────────────────────────────────────

  private _applyUrlTimeParams(urlParams: { preset?: string; ar?: number; from?: string; to?: string }): void {
    const { preset, ar, from, to } = urlParams;
    if (!preset && ar == null) return;

    if (preset === 'custom' && from && to) {
      this.timeService.setRange({ preset: 'custom', from, to, autoRefreshSeconds: ar ?? 0 });
    } else if (preset && preset !== 'custom') {
      const hours = PRESET_HOURS[preset as Exclude<TimePreset, 'custom'>];
      if (hours) {
        this.timeService.setRange({ preset: preset as TimePreset, hours, autoRefreshSeconds: ar ?? 0 });
      }
    } else if (ar != null) {
      this.timeService.setRange({ ...this.timeService.current, autoRefreshSeconds: ar });
    }
    this.timeRange = this.timeService.current;
  }

  private _syncUrlFromState(): void {
    this.urlService.syncParams({
      d:      this.selectedDashboardId ?? undefined,
      preset: this.timeRange.preset,
      ar:     this.timeRange.autoRefreshSeconds || undefined,
      from:   this.timeRange.from,
      to:     this.timeRange.to,
    });
  }

  copyDashboardLink(): void {
    void this.urlService.copyLink().then(() => {
      this.toast.push('Link copied to clipboard', 'success', 3000);
    });
  }
}
