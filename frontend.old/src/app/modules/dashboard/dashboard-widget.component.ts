import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { DashboardWidget } from '../../types/widget';
import { SensorTimeSeriesData, LatestReading } from '../../types/sensor';
import { SensorApiService } from '../../core/services/sensor-api.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { LineChartWidgetComponent } from './widget-templates/line-chart.component';
import { BarChartWidgetComponent } from './widget-templates/bar-chart.component';
import { GaugeWidgetComponent } from './widget-templates/gauge.component';
import { StatCardWidgetComponent } from './widget-templates/stat-card.component';

@Component({
  selector: 'app-dashboard-widget',
  standalone: true,
  imports: [
    CommonModule,
    LineChartWidgetComponent,
    BarChartWidgetComponent,
    GaugeWidgetComponent,
    StatCardWidgetComponent,
  ],
  template: `
    <div class="widget-container">
      <div class="widget-header">
        <span class="widget-title">{{ widget.title }}</span>
        @if (editMode) {
          <div class="widget-actions">
            <button (click)="edit.emit(widget)" title="Edit">✏️</button>
            <button (click)="delete.emit(widget.id)" title="Remove">🗑️</button>
          </div>
        }
      </div>

      <div class="widget-body">
        @switch (widget.widget_type) {
          @case ('line_chart') {
            <app-line-chart-widget
              [data]="seriesData"
              [title]="widget.title ?? ''"
            ></app-line-chart-widget>
          }
          @case ('bar_chart') {
            <app-bar-chart-widget
              [data]="seriesData"
              [title]="widget.title ?? ''"
            ></app-bar-chart-widget>
          }
          @case ('gauge') {
            <app-gauge-widget
              [value]="latestReading?.value ?? null"
              [unit]="gaugeUnit"
              [min]="gaugeMin"
              [max]="gaugeMax"
              [title]="widget.title ?? ''"
            ></app-gauge-widget>
          }
          @case ('stat_card') {
            <app-stat-card-widget
              [reading]="latestReading"
              [unit]="gaugeUnit"
              [title]="widget.title ?? ''"
            ></app-stat-card-widget>
          }
        }

        @if (loading) {
          <div class="loading-overlay">Loading…</div>
        }
      </div>
    </div>
  `,
  styles: [`
    .widget-container { display: flex; flex-direction: column; height: 100%; background: white; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); overflow: hidden; }
    .widget-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid #eee; min-height: 32px; }
    .widget-title { font-size: 0.85rem; font-weight: 600; color: #333; }
    .widget-actions { display: flex; gap: 4px; }
    .widget-actions button { background: none; border: none; cursor: pointer; font-size: 0.85rem; padding: 2px 4px; border-radius: 4px; }
    .widget-actions button:hover { background: #f0f0f0; }
    .widget-body { flex: 1; position: relative; min-height: 0; padding: 4px; }
    .loading-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.7); font-size: 0.85rem; color: #666; }
  `],
})
export class DashboardWidgetComponent implements OnInit, OnDestroy {
  @Input() widget!: DashboardWidget;
  @Input() editMode = false;

  @Output() edit = new EventEmitter<DashboardWidget>();
  @Output() delete = new EventEmitter<number>();

  seriesData: SensorTimeSeriesData[] = [];
  latestReading: LatestReading | null = null;
  gaugeUnit = '';
  loading = false;

  get gaugeMin(): number {
    return (this.widget.settings['gauge_min'] as number) ?? 0;
  }

  get gaugeMax(): number {
    return (this.widget.settings['gauge_max'] as number) ?? 100;
  }

  private subs = new Subscription();

  constructor(
    private sensorApi: SensorApiService,
    private realtime: RealtimeService,
  ) {}

  ngOnInit(): void {
    const sensorIds: number[] = this.widget.settings.sensor_ids ?? [];
    if (!sensorIds.length) return;

    if (this.widget.widget_type === 'stat_card' || this.widget.widget_type === 'gauge') {
      this.subscribeRealtime(sensorIds[0]);
    } else {
      this.loadChartData(sensorIds);
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private loadChartData(sensorIds: number[]): void {
    this.loading = true;
    const hours = (this.widget.settings['time_range_hours'] as number) ?? 24;
    const aggregated = (this.widget.settings['aggregated'] as boolean) ?? false;
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3_600_000);

    this.subs.add(
      this.sensorApi.getAnalytics(sensorIds, from, to, aggregated).subscribe({
        next: (res) => {
          this.seriesData = res.data;
          this.loading = false;
        },
        error: () => (this.loading = false),
      }),
    );
  }

  private subscribeRealtime(sensorId: number): void {
    this.subs.add(
      this.sensorApi.getSensor(sensorId).subscribe((s) => (this.gaugeUnit = s.unit)),
    );
    this.subs.add(
      this.realtime.subscribe(sensorId).subscribe((r) => (this.latestReading = r)),
    );
    this.subs.add(
      this.sensorApi.getLatestReading(sensorId).subscribe((r) => {
        if (!this.latestReading) this.latestReading = r;
      }),
    );
  }
}
