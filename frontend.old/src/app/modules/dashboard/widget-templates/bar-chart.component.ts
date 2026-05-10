import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgApexchartsModule } from 'ng-apexcharts';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexDataLabels,
  ApexTitleSubtitle,
} from 'ng-apexcharts';
import { SensorTimeSeriesData } from '../../../types/sensor';

@Component({
  selector: 'app-bar-chart-widget',
  standalone: true,
  imports: [CommonModule, NgApexchartsModule],
  template: `
    <apx-chart
      [series]="series"
      [chart]="chart"
      [xaxis]="xaxis"
      [dataLabels]="dataLabels"
      [title]="titleConfig"
    ></apx-chart>
  `,
})
export class BarChartWidgetComponent implements OnChanges {
  @Input() data: SensorTimeSeriesData[] = [];
  @Input() title = '';

  series: ApexAxisChartSeries = [];
  chart: ApexChart = { type: 'bar', height: '100%', toolbar: { show: true } };
  xaxis: ApexXAxis = { type: 'datetime' };
  dataLabels: ApexDataLabels = { enabled: false };
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
