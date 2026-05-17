import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { debounceTime, skip } from 'rxjs/operators';
import { DashboardWidget } from '../../types/dashboard';
import { WidgetSettings } from '../../types/widget';
import { WidgetTone, WidgetStatus } from '../widgets/app-widgets-shell.component';
import { SensorApiService } from '../../core/sensors/sensor-api.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { AnalyticsResponse } from '../../types/analytics';
import { Sensor, SensorReading, SensorTimeSeriesData } from '../../types/sensor';
import { StatusTier, STATUS_COLOR_HEX, statusOf } from '../../core/sensors/sensor-status';
import { AnnotationsApiService } from '../../core/annotations/annotations-api.service';
import { Annotation } from '../../types/annotation';
import { DashboardTimeService } from '../../core/dashboard/time.service';

const PALETTE = ['#37c79a', '#56b9ff', '#ffbf47', '#ff7a59', '#9b8cff', '#5ed3c6'];

@Component({
  selector: 'app-dashboard-widget',
  standalone: false,
  templateUrl: './dashboard-widget.component.html',
  styleUrl: './dashboard-widget.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardWidgetComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() editable = false;
  @Input() editMode = false;
  @Output() configure = new EventEmitter<void>();
  @Output() remove    = new EventEmitter<void>();

  // ── Display state ──────────────────────────────────────────────────────
  loading  = false;
  error: string | null = null;
  emptyMessage = '';
  chartType: 'apex' | 'gauge' | 'stat' | null = null;
  chartConfig: any = null;
  widgetStatus: WidgetStatus = 'ok';
  currentTheme: 'light' | 'dark' = document.documentElement.classList.contains('theme-light') ? 'light' : 'dark';

  // ── Freshness ──────────────────────────────────────────────────────────
  freshAt: string | null = null;
  expectedIntervalSeconds = 300;

  // ── Gauge ──────────────────────────────────────────────────────────────
  gaugeValue: number | null = null;
  gaugeUnit  = '';
  gaugePercent = 0;
  gaugeTone: 'normal' | 'warning' | 'danger' = 'normal';
  gaugeMin = 0;
  gaugeMax = 100;
  /** Hex color for the gauge needle/progress — set by applyGauge(). */
  gaugeColor = STATUS_COLOR_HEX.unknown;
  /** Multi-stop conic-gradient for zone coloring; empty string = no bounds configured. */
  gaugeBackground = '';
  gaugeWide = false;
  private _gaugeResizeObs: ResizeObserver | null = null;

  // ── Stat card ──────────────────────────────────────────────────────────
  statValue: number | null = null;
  statUnit  = '';
  statDelta: number | null = null;
  statDeltaDir: 'up' | 'down' | 'flat' = 'flat';
  statSparklineConfig: any = null;
  statStatusTier: StatusTier = 'unknown';
  statStatusLabel = '';

  // ── Drill-down modal ───────────────────────────────────────────────────
  drillOpen = false;
  drillLoading = false;
  drillTimestamp: string | null = null;
  drillReadings: { timestamp: string; value: number }[] = [];
  drillUnit = '';

  // ── Active sensor (single-sensor widgets) ──────────────────────────────
  /** The sensor object for single-sensor widgets; null for multi-sensor or while loading. */
  activeSensor: Sensor | null = null;

  // ── Ranges editor ──────────────────────────────────────────────────────
  rangesEditorOpen  = false;
  rangesSaving      = false;
  rangesSaveError: string | null = null;
  rangesForm = {
    normal_min:    null as number | null,
    normal_max:    null as number | null,
    warning_min:   null as number | null,
    warning_max:   null as number | null,
    critical_min:  null as number | null,
    critical_max:  null as number | null,
    ranges_source: 'manual' as string,
  };

  // ── Private ────────────────────────────────────────────────────────────
  private loadVersion  = 0;
  private lastSettingsKey = '';
  private latestAnalytics: AnalyticsResponse | null = null;
  private widgetAnnotations: Annotation[] = [];
  private latestReading: SensorReading | null = null;
  private latestReadings: SensorTimeSeriesData | null = null;
  private themeObserver: MutationObserver | null = null;
  private realtimeSub: Subscription | null = null;
  private _timeSub: Subscription | null = null;
  private sensors: Sensor[] = [];
  /** Resolved time-window bounds (ms) for pinning the line-chart X axis. */
  private chartFrom: number | null = null;
  private chartTo:   number | null = null;

  constructor(
    private readonly sensorApi: SensorApiService,
    private readonly realtime: RealtimeService,
    private readonly cdr: ChangeDetectorRef,
    private readonly annotationsApi: AnnotationsApiService,
    private readonly timeService: DashboardTimeService,
    private readonly el: ElementRef<HTMLElement>,
    private readonly zone: NgZone,
  ) {}

  ngOnInit(): void {
    this.observeTheme();
    void this.sensorApi.listSensors().then(all => {
      this.sensors = all;
      this.updateExpectedInterval();
      this.cdr.markForCheck();
    });
    void this.reload();
    this._timeSub = this.timeService.range$.pipe(
      skip(1),
      debounceTime(250),
    ).subscribe(() => {
      if (this._usesInheritedRange()) void this.reload();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.widget) return;
    if (changes['widget']) {
      const key = JSON.stringify({ type: this.widget.widget_type, settings: this.widget.settings });
      if (key !== this.lastSettingsKey) {
        this.lastSettingsKey = key;
        void this.reload();
      }
    }
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
    this._gaugeResizeObs?.disconnect();
    this.stopRealtime();
    this._timeSub?.unsubscribe();
  }

  // ── Public getters ─────────────────────────────────────────────────────

  get title(): string {
    return this.widget.title?.trim() || this.catalogLabel;
  }

  get subtitle(): string {
    const manual = this.widget.subtitle?.trim() || '';
    if (manual) return manual;
    if (this.activeSensor?.asset_path) return this.activeSensor.asset_path;
    return '';
  }

  get badgeText(): string {
    const ids = this.widget.settings?.sensor_ids ?? [];
    return ids.length === 1 ? '1 SENSOR' : `${ids.length} SENSORS`;
  }

  get metaText(): string {
    const ids = this.widget.settings?.sensor_ids ?? [];
    const label = ids.length === 1 ? '1 sensor' : `${ids.length} sensors`;
    const h = this.widget.settings?.time_range_hours;
    return h ? `${label} • last ${h}h` : label;
  }

  get tone(): WidgetTone {
    switch (this.widget.widget_type) {
      case 'gauge':
      case 'stat_card':  return 'info';
      case 'line_chart': return 'success';
      case 'bar_chart':  return 'neutral';
      default:           return 'neutral';
    }
  }

  get statDeltaLabel(): string {
    if (this.statDelta === null) return '';
    const sign = this.statDelta > 0 ? '+' : '';
    return `${sign}${this.statDelta.toFixed(1)}%`;
  }

  // ── Reload ─────────────────────────────────────────────────────────────

  async reload(): Promise<void> {
    this.stopRealtime();
    this.updateExpectedInterval();
    const s = this.widget?.settings;
    if (!s?.sensor_ids?.length) {
      this.setEmpty('Configure sensors in widget settings.');
      return;
    }

    this.loading = true;
    this.error   = null;
    this.cdr.markForCheck();
    const version = ++this.loadVersion;

    try {
      switch (this.widget.widget_type) {
        case 'line_chart': await this.loadLineChart(s, version); break;
        case 'bar_chart':  await this.loadBarChart(s, version);  break;
        case 'gauge':      await this.loadGauge(s, version);     break;
        case 'stat_card':  await this.loadStatCard(s, version);  break;
      }
    } catch (err: unknown) {
      if (version !== this.loadVersion) return;
      this.chartType  = null;
      this.error = err instanceof Error ? err.message : 'Failed to load widget data.';
    } finally {
      if (version !== this.loadVersion) return;
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  // ── Data loaders ───────────────────────────────────────────────────────

  private async loadLineChart(s: WidgetSettings, version: number): Promise<void> {
    const { from, to } = this.resolveWindow(s);
    this.chartFrom = new Date(from).getTime();
    this.chartTo   = new Date(to).getTime();
    const resp = await this.sensorApi.getAnalytics(s.sensor_ids!, from, to, {
      aggregated: s.aggregated, bucket_minutes: s.bucket_minutes,
    });
    if (version !== this.loadVersion) return;
    this.latestAnalytics = resp;
    this.freshAt = this.maxTimestamp(resp);
    this.activeSensor = this.sensorForId(s.sensor_ids?.[0]);
    await this.loadWidgetAnnotations(s.sensor_ids!, from, to);
    this.applyLineChart(resp, s);
  }

  private async loadBarChart(s: WidgetSettings, version: number): Promise<void> {
    const { from, to } = this.resolveWindow(s);
    const resp = await this.sensorApi.getAnalytics(s.sensor_ids!, from, to, {
      aggregated: s.aggregated, bucket_minutes: s.bucket_minutes,
    });
    if (version !== this.loadVersion) return;
    this.latestAnalytics = resp;
    this.freshAt = this.maxTimestamp(resp);
    this.activeSensor = s.sensor_ids?.length === 1 ? this.sensorForId(s.sensor_ids[0]) : null;
    this.applyBarChart(resp);
  }

  private async loadGauge(s: WidgetSettings, version: number): Promise<void> {
    const sensorId = s.sensor_ids![0];
    const sensor = await this.sensorApi.getSensor(sensorId);
    if (version !== this.loadVersion) return;

    this.activeSensor = this.sensorForId(sensorId) ?? sensor;
    this.gaugeUnit = sensor.unit ?? '';
    this.gaugeMin  = s.gauge_min ?? 0;
    this.gaugeMax  = s.gauge_max ?? 100;

    // 404 = no readings yet → empty state, not error
    let reading: SensorReading | null = null;
    try {
      reading = await this.sensorApi.getLatest(sensorId);
    } catch (err: unknown) {
      if ((err as any)?.status !== 404) throw err;
    }
    if (version !== this.loadVersion) return;

    if (reading) {
      this.latestReading = reading;
      this.freshAt = reading.timestamp ?? null;
      this.applyGauge(reading, this.activeSensor);
    } else {
      this.setEmpty('Waiting for first reading…');
    }

    // Subscribe regardless — live readings will switch empty → gauge
    this.realtimeSub = this.realtime.subscribe(sensorId).subscribe(live => {
      this.latestReading = live;
      this.freshAt = live.timestamp ?? null;
      this.applyGauge(live, this.activeSensor);
      this.cdr.markForCheck();
    });
  }

  private async loadStatCard(s: WidgetSettings, version: number): Promise<void> {
    const sensorId = s.sensor_ids![0];
    const now      = new Date();
    const readFrom = new Date(now.getTime() - 2 * 3600_000);

    const [readings, sensor] = await Promise.all([
      this.sensorApi.getReadings(sensorId, readFrom.toISOString(), now.toISOString()),
      this.sensorApi.getSensor(sensorId),
    ]);
    if (version !== this.loadVersion) return;

    this.activeSensor = this.sensorForId(sensorId) ?? sensor;
    this.statUnit = sensor.unit ?? '';

    // 404 = no readings yet → empty state, not error
    let reading: SensorReading | null = null;
    try {
      reading = await this.sensorApi.getLatest(sensorId);
    } catch (err: unknown) {
      if ((err as any)?.status !== 404) throw err;
    }
    if (version !== this.loadVersion) return;

    if (reading) {
      this.latestReading  = reading;
      this.latestReadings = readings;
      this.freshAt = reading.timestamp ?? null;
      this.applyStatCard(reading, readings);
    } else {
      this.setEmpty('Waiting for first reading…');
    }

    // Subscribe regardless — live readings will switch empty → stat card
    this.realtimeSub = this.realtime.subscribe(sensorId).subscribe(live => {
      this.latestReading = live;
      this.freshAt = live.timestamp ?? null;
      this.statValue = live.value;
      this.statStatusTier = statusOf(live.value, this.activeSensor);
      this.statStatusLabel = this.tierLabel(this.statStatusTier);
      this.widgetStatus = this.computeStatus();
      this.cdr.markForCheck();
    });
  }

  // ── Chart builders (called again on theme change without re-fetch) ─────

  private applyLineChart(resp: AnalyticsResponse, s: WidgetSettings): void {
    const theme = this.readTheme();

    // Build series with null boundary points so the x-axis always spans the
    // full requested window even when data only covers part of it.
    const series = resp.data
      .map((d, i) => {
        const pts: (number | null)[][] = d.points.map(
          p => [new Date(p.timestamp).getTime(), p.value]
        );
        if (this.chartFrom !== null) pts.unshift([this.chartFrom!, null]);
        if (this.chartTo   !== null) pts.push([this.chartTo!,   null]);
        return { name: d.sensor_name || `Sensor ${d.sensor_id}`, data: pts, color: PALETTE[i % PALETTE.length] };
      })
      .filter(sr => sr.data.length > 2); // >2 = at least one real point beyond the two boundary nulls

    this.chartType  = 'apex';
    this.chartConfig = {
      series: series.length ? series : [{ name: '', data: [] }],
      chart: {
        type: 'line', height: '100%', toolbar: { show: false },
        zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
        animations: { easing: 'easeinout', speed: 220 },
        foreColor: theme.fgMuted,
        events: {
          dataPointSelection: (_e: unknown, _ctx: unknown, cfg: { seriesIndex: number; dataPointIndex: number }) => {
            const seriesData = this.latestAnalytics?.data[cfg.seriesIndex];
            if (!seriesData) return;
            // dataPointIndex is offset by 1 because we prepend a null boundary point
            const pointIdx = cfg.dataPointIndex - 1;
            if (pointIdx < 0 || pointIdx >= seriesData.points.length) return;
            const point = seriesData.points[pointIdx];
            if (!point) return;
            const sensorId = seriesData.sensor_id;
            this.zone.run(() => {
              void this.openDrillDown(sensorId, point.timestamp, (seriesData as any).unit ?? '');
            });
          },
        },
      },
      colors: PALETTE,
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2.5 },
      grid: { borderColor: theme.border, strokeDashArray: 4 },
      xaxis: {
        type: 'datetime',
        min: this.chartFrom ?? undefined,
        max: this.chartTo   ?? undefined,
        labels: { datetimeUTC: false },
      },
      yaxis: { labels: { formatter: (v: number) => v.toFixed(1) } },
      legend: {
        show: s.show_legend !== false && series.length > 0,
        position: 'top', horizontalAlign: 'left',
        labels: { colors: theme.fgMuted },
      },
      tooltip: { theme: theme.tooltip, x: { format: 'dd MMM yyyy HH:mm' } },
      noData: { text: 'No readings in this window' },
      annotations: {
        ...this.buildAnnotations(),
        xaxis: this.buildXaxisAnnotations(),
      },
    };
  }

  private applyBarChart(resp: AnalyticsResponse): void {
    const theme = this.readTheme();
    const sensorIds = this.widget.settings?.sensor_ids ?? [];
    const items = resp.data
      .filter(d => d.points.length > 0)
      .map((d, i) => {
        const avgValue = d.points.reduce((sum, p) => sum + p.value, 0) / d.points.length;
        const sensor = this.sensorForId(sensorIds[i] ?? d.sensor_id);
        const tier = statusOf(avgValue, sensor);
        const color = tier !== 'unknown' ? STATUS_COLOR_HEX[tier] : PALETTE[i % PALETTE.length];
        return {
          name:  d.sensor_name || `Sensor ${d.sensor_id}`,
          value: avgValue,
          unit:  d.unit ?? '',
          color,
        };
      });

    if (!items.length) { this.setEmpty('No readings in this window.'); return; }

    const unit = items[0].unit;
    this.chartType  = 'apex';
    this.chartConfig = {
      series: [{ name: 'Average', data: items.map(i => parseFloat(i.value.toFixed(2))) }],
      chart: {
        type: 'bar', height: '100%', toolbar: { show: false },
        foreColor: theme.fgMuted,
        animations: { easing: 'easeinout', speed: 220 },
      },
      plotOptions: { bar: { distributed: true, borderRadius: 6, columnWidth: '48%' } },
      colors: items.map(i => i.color),
      dataLabels: {
        enabled: true,
        formatter: (v: number) => `${v.toFixed(1)}${unit ? ' ' + unit : ''}`,
        style: { colors: [theme.fg] },
      },
      grid: { borderColor: theme.border, strokeDashArray: 4 },
      xaxis: { categories: items.map(i => i.name) },
      yaxis: { labels: { formatter: (v: number) => v.toFixed(1) } },
      legend: { show: false },
      tooltip: {
        theme: theme.tooltip,
        y: { formatter: (v: number) => `${v.toFixed(2)}${unit ? ' ' + unit : ''}` },
      },
    };
  }

  private applyGauge(reading: SensorReading, sensor?: Sensor | null): void {
    const value = reading?.value ?? null;

    // Guard: invalid or equal range — fall back to 0-100 so the dial renders
    const gMin = this.gaugeMin;
    const gMax = this.gaugeMax <= gMin ? gMin + 100 : this.gaugeMax;

    let percent = 0;
    if (value !== null) {
      percent = Math.max(0, Math.min(100,
        ((value - gMin) / (gMax - gMin)) * 100));
    }

    const tier = sensor ? statusOf(value ?? 0, sensor) : 'unknown';
    if (tier !== 'unknown') {
      // Bounds are configured — use status-driven colour and gradient background
      this.gaugeTone    = tier === 'critical' ? 'danger' : tier === 'warning' ? 'warning' : 'normal';
      this.gaugeColor   = STATUS_COLOR_HEX[tier];
    } else {
      // Fallback heuristic (no sensor bounds configured)
      if (value !== null && value > gMax) {
        // Overshoot: value exceeds the configured max — show vivid critical red immediately
        this.gaugeColor = STATUS_COLOR_HEX.critical;
        this.gaugeTone  = 'danger';
      } else {
        this.gaugeTone  = percent >= 95 ? 'danger' : percent >= 80 ? 'warning' : 'normal';
        this.gaugeColor = this.gaugeTone === 'danger'  ? STATUS_COLOR_HEX.critical
          : this.gaugeTone === 'warning' ? STATUS_COLOR_HEX.warning
          : STATUS_COLOR_HEX.normal;
      }
    }

    this.chartType      = 'gauge';
    this.gaugeValue     = value;
    this.gaugePercent   = Math.round(percent);
    this.gaugeBackground = this.buildGaugeBackground(sensor ?? null);
    this.widgetStatus   = this.computeStatus();
    this._observeGaugeSize();
  }

  private _observeGaugeSize(): void {
    if (this._gaugeResizeObs) return; // only set up once
    this._gaugeResizeObs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const wide = height > 0 && (width / height) > 1.4;
      if (wide !== this.gaugeWide) {
        this.gaugeWide = wide;
        this.cdr.markForCheck();
      }
    });
    this._gaugeResizeObs.observe(this.el.nativeElement);
  }

  private computeStatus(): WidgetStatus {
    const type = this.widget.widget_type;
    // Charts have no live reading stream — always ok
    if (type === 'line_chart' || type === 'bar_chart') return 'ok';
    // Guard null/missing timestamp (WS messages may carry null)
    if (!this.latestReading || !this.latestReading.timestamp) return 'stale';
    const age = Date.now() - new Date(this.latestReading.timestamp).getTime();
    if (age > 30_000) return 'stale';
    if (type === 'gauge') {
      if (this.gaugePercent >= 95) return 'crit';
      if (this.gaugePercent >= 80) return 'warn';
    }
    return 'ok';
  }

  private applyStatCard(reading: SensorReading, readings: SensorTimeSeriesData): void {
    const value     = reading?.value ?? null;
    const pts       = readings?.readings ?? [];
    const sparkPts  = pts.slice(-30);
    const oneHourAgo = Date.now() - 3600_000;
    const olderPts  = pts.filter(r => new Date(r.timestamp).getTime() <= oneHourAgo);
    const oldValue  = olderPts.length ? olderPts[olderPts.length - 1].value : null;

    let delta: number | null = null;
    let dir: 'up' | 'down' | 'flat' = 'flat';
    if (value !== null && oldValue !== null && oldValue !== 0) {
      delta = ((value - oldValue) / Math.abs(oldValue)) * 100;
      dir   = delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat';
    }

    this.chartType    = 'stat';
    this.statValue    = value;
    this.statDelta    = delta;
    this.statDeltaDir = dir;

    // Status tier from range bounds
    this.statStatusTier  = value !== null ? statusOf(value, this.activeSensor) : 'unknown';
    this.statStatusLabel = this.tierLabel(this.statStatusTier);

    if (sparkPts.length > 1) {
      const sparkColor = this.statStatusTier !== 'unknown'
        ? STATUS_COLOR_HEX[this.statStatusTier]
        : STATUS_COLOR_HEX.normal;
      this.statSparklineConfig = {
        series: [{ name: '', data: sparkPts.map(r => r.value) }],
        chart: {
          type: 'area', height: 64, sparkline: { enabled: true },
          animations: { easing: 'easeinout', speed: 220 },
        },
        colors: [sparkColor],
        stroke: { curve: 'smooth', width: 2 },
        fill: {
          type: 'gradient',
          gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05, stops: [0, 100] },
        },
        tooltip: { enabled: false },
      };
    } else {
      this.statSparklineConfig = null;
    }

    this.widgetStatus = this.computeStatus();
    if (value === null) this.setEmpty('No recent reading available.');
  }

  // ── Drill-down ─────────────────────────────────────────────────────────

  async openDrillDown(sensorId: number, timestamp: string, unit: string): Promise<void> {
    this.drillOpen    = true;
    this.drillLoading = true;
    this.drillTimestamp = timestamp;
    this.drillUnit    = unit;
    this.drillReadings = [];
    this.cdr.markForCheck();
    try {
      this.drillReadings = await this.sensorApi.getReadingsAround(sensorId, timestamp, 10);
    } catch {
      this.drillReadings = [];
    } finally {
      this.drillLoading = false;
      this.cdr.markForCheck();
    }
  }

  closeDrillDown(): void {
    this.drillOpen = false;
    this.cdr.markForCheck();
  }

  // ── Ranges editor ──────────────────────────────────────────────────────

  openRangesEditor(): void {
    const s = this.activeSensor;
    if (!s) return;
    this.rangesForm = {
      normal_min:    s.normal_min   ?? null,
      normal_max:    s.normal_max   ?? null,
      warning_min:   s.warning_min  ?? null,
      warning_max:   s.warning_max  ?? null,
      critical_min:  s.critical_min ?? null,
      critical_max:  s.critical_max ?? null,
      ranges_source: s.ranges_source ?? 'manual',
    };
    this.rangesSaveError = null;
    this.rangesEditorOpen = true;
    this.cdr.markForCheck();
  }

  closeRangesEditor(): void {
    this.rangesEditorOpen = false;
    this.rangesSaveError  = null;
    this.cdr.markForCheck();
  }

  async saveRanges(): Promise<void> {
    const s = this.activeSensor;
    if (!s || this.rangesSaving) return;
    this.rangesSaving    = true;
    this.rangesSaveError = null;
    this.cdr.markForCheck();
    try {
      const updated = await this.sensorApi.updateRanges(s.id, this.rangesForm);
      const idx = this.sensors.findIndex(x => x.id === s.id);
      if (idx >= 0) this.sensors[idx] = updated;
      this.activeSensor = updated;
      this.rangesEditorOpen = false;
      void this.reload();
    } catch {
      this.rangesSaveError = 'Failed to save. Check values and try again.';
    } finally {
      this.rangesSaving = false;
      this.cdr.markForCheck();
    }
  }

  // ── Annotation helpers ─────────────────────────────────────────────────

  private async loadWidgetAnnotations(
    sensorIds: number[],
    from: string,
    to: string,
  ): Promise<void> {
    if (!sensorIds.length) { this.widgetAnnotations = []; return; }
    try {
      if (sensorIds.length === 1) {
        this.widgetAnnotations = await this.annotationsApi.getAnnotations({
          scope_kind: 'sensor',
          scope_id: sensorIds[0],
          from,
          to,
          kinds: 'alert,manual,maintenance,event',
        });
      }
    } catch {
      this.widgetAnnotations = [];
    }
  }

  private buildXaxisAnnotations(): any[] {
    return this.widgetAnnotations.map(ann => {
      const color = ann.color ?? '#8898aa';
      if (ann.ended_at) {
        return {
          x:     new Date(ann.started_at).getTime(),
          x2:    new Date(ann.ended_at).getTime(),
          fillColor: color,
          opacity: 0.12,
          label: { text: ann.label, style: { color: '#fff', background: color } },
        };
      } else {
        return {
          x: new Date(ann.started_at).getTime(),
          borderColor: color,
          strokeDashArray: 0,
          label: {
            borderColor: color,
            style: { color: '#fff', background: color },
            text: ann.label,
            orientation: 'horizontal',
          },
        };
      }
    });
  }

  // ── Status coloring helpers ────────────────────────────────────────────

  /**
   * Build an ApexCharts annotations object that adds a faint green band
   * for the normal range on single-sensor line charts.
   */
  private buildAnnotations(): any {
    const s = this.activeSensor;
    if (!s || (this.widget.settings?.sensor_ids?.length ?? 0) !== 1) return {};
    if (s.normal_min === null || s.normal_max === null) return {};
    return {
      yaxis: [{
        y: s.normal_min,
        y2: s.normal_max,
        fillColor: STATUS_COLOR_HEX.normal,
        opacity: 0.08,
        borderColor: 'transparent',
        label: { text: '' },
      }],
    };
  }

  /**
   * Build a multi-stop conic-gradient string encoding warning/critical zones
   * around the normal band.  Returns '' when no bounds are configured.
   */
  private buildGaugeBackground(sensor: Sensor | null): string {
    if (!sensor) return '';
    const {
      normal_min, normal_max,
      warning_min, warning_max,
      critical_min, critical_max,
    } = sensor;

    // Need at least the normal band to draw zones
    if (normal_min === null || normal_max === null) return '';

    const rangeMin = this.gaugeMin;
    const rangeMax = this.gaugeMax;
    const span = rangeMax - rangeMin;
    if (span <= 0) return '';

    // Map a sensor value to a 0–360° sweep angle
    const toAngle = (v: number): number =>
      Math.max(0, Math.min(360, ((v - rangeMin) / span) * 360));

    // Build colour stops from left to right
    type Stop = { angle: number; color: string };
    const stops: Stop[] = [{ angle: 0, color: STATUS_COLOR_HEX.critical }];

    if (critical_min !== null) {
      stops.push({ angle: toAngle(critical_min), color: STATUS_COLOR_HEX.warning });
    }
    if (warning_min !== null) {
      stops.push({ angle: toAngle(warning_min), color: STATUS_COLOR_HEX.normal });
    }
    // Normal band end
    if (warning_max !== null) {
      stops.push({ angle: toAngle(warning_max), color: STATUS_COLOR_HEX.warning });
    } else {
      stops.push({ angle: toAngle(normal_max), color: STATUS_COLOR_HEX.warning });
    }
    if (critical_max !== null) {
      stops.push({ angle: toAngle(critical_max), color: STATUS_COLOR_HEX.critical });
    }
    stops.push({ angle: 360, color: STATUS_COLOR_HEX.critical });

    // Deduplicate adjacent identical angles
    const deduped = stops.filter((s, i) => i === 0 || s.angle !== stops[i - 1].angle);

    // Build the conic-gradient string
    const parts = deduped.map((s, i) => {
      const next = deduped[i + 1];
      if (next) return `${s.color} ${s.angle}deg ${next.angle}deg`;
      return `${s.color} ${s.angle}deg`;
    });

    return `conic-gradient(from 0deg, ${parts.join(', ')})`;
  }

  private tierLabel(tier: StatusTier): string {
    if (tier === 'unknown') return '';
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }

  // ── Color helpers ──────────────────────────────────────────────────────

  private lerpHex(a: string, b: string, t: number): string {
    const tc = Math.max(0, Math.min(1, t));  // clamp to [0,1] — prevents negative channels
    const n1 = parseInt(a.slice(1), 16);
    const n2 = parseInt(b.slice(1), 16);
    const ch = (shift: number) => {
      const v = Math.round(((n1 >> shift) & 0xff) + (((n2 >> shift) & 0xff) - ((n1 >> shift) & 0xff)) * tc);
      return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    };
    return `#${ch(16)}${ch(8)}${ch(0)}`;
  }

  // ── Theme observation ──────────────────────────────────────────────────

  private observeTheme(): void {
    this.themeObserver = new MutationObserver(() => {
      // Track theme for shell ambient tinting — update before early-return guard
      this.currentTheme = document.documentElement.classList.contains('theme-light') ? 'light' : 'dark';
      if (!this.widget || this.loading) return;
      switch (this.widget.widget_type) {
        case 'line_chart':
          if (this.latestAnalytics) this.applyLineChart(this.latestAnalytics, this.widget.settings);
          break;
        case 'bar_chart':
          if (this.latestAnalytics) this.applyBarChart(this.latestAnalytics);
          break;
        case 'stat_card':
          if (this.latestReading && this.latestReadings)
            this.applyStatCard(this.latestReading, this.latestReadings);
          break;
        // gauge: CSS custom properties pick up theme vars automatically
      }
      this.cdr.markForCheck();
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ['class'],
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private _usesInheritedRange(): boolean {
    const s = this.widget?.settings;
    if (!s) return false;
    if (s.time_range_inherit === false) return false;
    if (s.from && s.to && s.time_range_inherit === undefined) return false;
    return true;
  }

  private resolveWindow(s: WidgetSettings): { from: string; to: string } {
    if (this._usesInheritedRange()) {
      return this.timeService.resolveWindow();
    }
    if (s.time_range_hours && s.time_range_hours > 0) {
      const to   = new Date();
      const from = new Date(to.getTime() - s.time_range_hours * 3600_000);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    return { from: s.from!, to: s.to! };
  }

  private stopRealtime(): void {
    this.realtimeSub?.unsubscribe();
    this.realtimeSub = null;
  }

  private setEmpty(message: string): void {
    this.loading      = false;
    this.error        = null;
    this.chartType    = null;
    this.emptyMessage = message;
    this.widgetStatus = 'stale';
    this.cdr.markForCheck();
  }

  private maxTimestamp(resp: AnalyticsResponse | null): string | null {
    if (!resp) return null;
    const all = resp.data.flatMap(s => s.points.map((p: any) => p.timestamp as string));
    return all.length ? all.reduce((a, b) => (a > b ? a : b)) : null;
  }

  private updateExpectedInterval(): void {
    const ids = this.widget?.settings?.sensor_ids ?? [];
    const filtered = this.sensors.filter(s => ids.includes(s.id));

    // activeSensor: for single-sensor widgets, the matched sensor object
    this.activeSensor = filtered.length === 1 ? filtered[0] : null;

    const values = filtered
      .map(s => s.expected_poll_seconds)
      .filter((v): v is number => v !== null && v !== undefined);
    this.expectedIntervalSeconds = values.length ? Math.min(...values) : 300;
  }

  /** Look up a Sensor from the cached list by numeric ID. */
  private sensorForId(id: number | undefined): Sensor | null {
    if (id === undefined || id === null) return null;
    return this.sensors.find(s => s.id === id) ?? null;
  }

  private readTheme() {
    const styles = getComputedStyle(document.documentElement);
    const isDark = !document.documentElement.classList.contains('theme-light');
    return {
      fg:      styles.getPropertyValue('--color-fg').trim()       || (isDark ? '#e6edf3' : '#12202a'),
      fgMuted: styles.getPropertyValue('--color-fg-muted').trim() || (isDark ? '#9aa7b2' : '#50616d'),
      border:  styles.getPropertyValue('--color-border').trim()   || (isDark ? '#30424f' : '#d3dde3'),
      tooltip: (isDark ? 'dark' : 'light') as 'dark' | 'light',
    };
  }

  private get catalogLabel(): string {
    switch (this.widget.widget_type) {
      case 'line_chart': return 'Line Chart';
      case 'bar_chart':  return 'Bar Chart';
      case 'gauge':      return 'Gauge';
      case 'stat_card':  return 'Stat Card';
      default:           return 'Widget';
    }
  }
}
