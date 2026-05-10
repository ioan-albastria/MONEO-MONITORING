import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { DashboardWidget } from '../../types/dashboard';
import { WidgetSettings } from '../../types/widget';
import { WidgetTone } from '../widgets/app-widgets-shell.component';
import { SensorApiService } from '../../core/sensors/sensor-api.service';
import { AnalyticsResponse } from '../../types/analytics';
import { SensorReading, SensorTimeSeriesData } from '../../types/sensor';

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
  @Output() configure = new EventEmitter<void>();
  @Output() remove    = new EventEmitter<void>();

  // ── Display state ──────────────────────────────────────────────────────
  loading  = false;
  error: string | null = null;
  emptyMessage = '';
  chartType: 'apex' | 'gauge' | 'stat' | null = null;
  chartConfig: any = null;

  // ── Gauge ──────────────────────────────────────────────────────────────
  gaugeValue: number | null = null;
  gaugeUnit  = '';
  gaugePercent = 0;
  gaugeTone: 'normal' | 'warning' | 'danger' = 'normal';
  gaugeMin = 0;
  gaugeMax = 100;

  // ── Stat card ──────────────────────────────────────────────────────────
  statValue: number | null = null;
  statUnit  = '';
  statDelta: number | null = null;
  statDeltaDir: 'up' | 'down' | 'flat' = 'flat';
  statSparklineConfig: any = null;

  // ── Private ────────────────────────────────────────────────────────────
  private loadVersion  = 0;
  private lastSettingsKey = '';
  private latestAnalytics: AnalyticsResponse | null = null;
  private latestReading: SensorReading | null = null;
  private latestReadings: SensorTimeSeriesData | null = null;
  private themeObserver: MutationObserver | null = null;

  constructor(
    private readonly sensorApi: SensorApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.observeTheme();
    void this.reload();
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
  }

  // ── Public getters ─────────────────────────────────────────────────────

  get title(): string {
    return this.widget.title?.trim() || this.catalogLabel;
  }

  get subtitle(): string {
    const ids = this.widget.settings?.sensor_ids ?? [];
    if (ids.length === 1) return '1 sensor';
    return ids.length > 1 ? `${ids.length} sensors` : '';
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

  get gaugeColor(): string {
    if (this.gaugeTone === 'danger')  return 'var(--color-danger)';
    if (this.gaugeTone === 'warning') return 'var(--color-warning)';
    return 'var(--color-brand)';
  }

  // ── Reload ─────────────────────────────────────────────────────────────

  async reload(): Promise<void> {
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
    const resp = await this.sensorApi.getAnalytics(s.sensor_ids!, from, to, {
      aggregated: s.aggregated, bucket_minutes: s.bucket_minutes,
    });
    if (version !== this.loadVersion) return;
    this.latestAnalytics = resp;
    this.applyLineChart(resp, s);
  }

  private async loadBarChart(s: WidgetSettings, version: number): Promise<void> {
    const { from, to } = this.resolveWindow(s);
    const resp = await this.sensorApi.getAnalytics(s.sensor_ids!, from, to, {
      aggregated: s.aggregated, bucket_minutes: s.bucket_minutes,
    });
    if (version !== this.loadVersion) return;
    this.latestAnalytics = resp;
    this.applyBarChart(resp);
  }

  private async loadGauge(s: WidgetSettings, version: number): Promise<void> {
    const sensorId = s.sensor_ids![0];
    const [reading, sensor] = await Promise.all([
      this.sensorApi.getLatest(sensorId),
      this.sensorApi.getSensor(sensorId),
    ]);
    if (version !== this.loadVersion) return;
    this.latestReading = reading;
    this.gaugeUnit = sensor.unit ?? '';
    this.gaugeMin  = s.gauge_min ?? 0;
    this.gaugeMax  = s.gauge_max ?? 100;
    this.applyGauge(reading);
  }

  private async loadStatCard(s: WidgetSettings, version: number): Promise<void> {
    const sensorId = s.sensor_ids![0];
    const now      = new Date();
    const readFrom = new Date(now.getTime() - 2 * 3600_000);

    const [reading, readings, sensor] = await Promise.all([
      this.sensorApi.getLatest(sensorId),
      this.sensorApi.getReadings(sensorId, readFrom.toISOString(), now.toISOString()),
      this.sensorApi.getSensor(sensorId),
    ]);
    if (version !== this.loadVersion) return;
    this.latestReading  = reading;
    this.latestReadings = readings;
    this.statUnit = sensor.unit ?? '';
    this.applyStatCard(reading, readings);
  }

  // ── Chart builders (called again on theme change without re-fetch) ─────

  private applyLineChart(resp: AnalyticsResponse, s: WidgetSettings): void {
    const theme  = this.readTheme();
    const series = resp.data
      .map((d, i) => ({
        name:  d.sensor_name || `Sensor ${d.sensor_id}`,
        data:  d.points.map(p => [new Date(p.timestamp).getTime(), p.value] as [number, number]),
        color: PALETTE[i % PALETTE.length],
      }))
      .filter(sr => sr.data.length > 0);

    if (!series.length) { this.setEmpty('No readings in this window.'); return; }

    this.chartType  = 'apex';
    this.chartConfig = {
      series,
      chart: {
        type: 'line', height: '100%', toolbar: { show: false },
        zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
        animations: { easing: 'easeinout', speed: 220 },
        foreColor: theme.fgMuted,
      },
      colors: PALETTE,
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2.5 },
      grid: { borderColor: theme.border, strokeDashArray: 4 },
      xaxis: { type: 'datetime', labels: { datetimeUTC: false } },
      yaxis: { labels: { formatter: (v: number) => v.toFixed(1) } },
      legend: {
        show: s.show_legend !== false,
        position: 'top', horizontalAlign: 'left',
        labels: { colors: theme.fgMuted },
      },
      tooltip: { theme: theme.tooltip, x: { format: 'dd MMM yyyy HH:mm' } },
      noData: { text: 'No readings in this window' },
    };
  }

  private applyBarChart(resp: AnalyticsResponse): void {
    const theme = this.readTheme();
    const items = resp.data
      .filter(d => d.points.length > 0)
      .map((d, i) => ({
        name:  d.sensor_name || `Sensor ${d.sensor_id}`,
        value: d.points.reduce((sum, p) => sum + p.value, 0) / d.points.length,
        unit:  d.unit ?? '',
        color: PALETTE[i % PALETTE.length],
      }));

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

  private applyGauge(reading: SensorReading): void {
    const value = reading?.value ?? null;
    let percent = 0;
    if (value !== null) {
      percent = Math.max(0, Math.min(100,
        ((value - this.gaugeMin) / (this.gaugeMax - this.gaugeMin)) * 100));
    }
    this.chartType   = 'gauge';
    this.gaugeValue  = value;
    this.gaugePercent = Math.round(percent);
    this.gaugeTone   = percent >= 95 ? 'danger' : percent >= 80 ? 'warning' : 'normal';
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

    if (sparkPts.length > 1) {
      this.statSparklineConfig = {
        series: [{ name: '', data: sparkPts.map(r => r.value) }],
        chart: {
          type: 'area', height: 64, sparkline: { enabled: true },
          animations: { easing: 'easeinout', speed: 220 },
        },
        colors: ['#37c79a'],
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

    if (value === null) this.setEmpty('No recent reading available.');
  }

  // ── Theme observation ──────────────────────────────────────────────────

  private observeTheme(): void {
    this.themeObserver = new MutationObserver(() => {
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

  private resolveWindow(s: WidgetSettings): { from: string; to: string } {
    if (s.time_range_hours && s.time_range_hours > 0) {
      const to   = new Date();
      const from = new Date(to.getTime() - s.time_range_hours * 3600_000);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    return { from: s.from!, to: s.to! };
  }

  private setEmpty(message: string): void {
    this.loading   = false;
    this.error     = null;
    this.chartType = null;
    this.emptyMessage = message;
    this.cdr.markForCheck();
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
