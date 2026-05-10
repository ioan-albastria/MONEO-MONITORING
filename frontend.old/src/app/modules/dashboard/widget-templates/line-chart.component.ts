import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgApexchartsModule } from 'ng-apexcharts';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexDataLabels,
  ApexStroke,
  ApexTitleSubtitle,
  ApexTooltip,
} from 'ng-apexcharts';
import { SensorTimeSeriesData } from '../../../types/sensor';

@Component({
  selector: 'app-line-chart-widget',
  standalone: true,
  imports: [CommonModule, NgApexchartsModule],
  template: `
    <apx-chart
      [series]="series"
      [chart]="chart"
      [xaxis]="xaxis"
      [dataLabels]="dataLabels"
      [stroke]="stroke"
      [tooltip]="tooltip"
      [title]="titleConfig"
    ></apx-chart>
  `,
})
export class LineChartWidgetComponent implements OnChanges {
  @Input() data: SensorTimeSeriesData[] = [];
  @Input() title = '';

  series: ApexAxisChartSeries = [];
  chart: ApexChart = { type: 'area', height: '100%', toolbar: { show: true }, zoom: { enabled: true } };
  xaxis: ApexXAxis = { type: 'datetime' };
  dataLabels: ApexDataLabels = { enabled: false };
  stroke: ApexStroke = { curve: 'smooth', width: 2 };
  tooltip: ApexTooltip = { x: { format: 'dd MMM HH:mm' } };
  titleConfig: ApexTitleSubtitle = { text: '' };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] || changes['title']) {
      this.buildSeries();
    }
  }

  private buildSeries(): void {
    this.titleConfig = { text: this.title };
    this.series = (this.data ?? []).map((d) => ({
      name: `${d.sensor_name} (${d.unit})`,
      data: d.points.map((p) => ({ x: new Date(p.timestamp).getTime(), y: p.value })),
    }));
  }
}
