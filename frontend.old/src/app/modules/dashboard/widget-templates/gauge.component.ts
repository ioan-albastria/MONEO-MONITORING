import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ApexChart, ApexPlotOptions, ApexTitleSubtitle } from 'ng-apexcharts';

@Component({
  selector: 'app-gauge-widget',
  standalone: true,
  imports: [CommonModule, NgApexchartsModule],
  template: `
    <apx-chart
      [series]="series"
      [chart]="chart"
      [plotOptions]="plotOptions"
      [title]="titleConfig"
      [labels]="labels"
    ></apx-chart>
  `,
})
export class GaugeWidgetComponent implements OnChanges {
  @Input() value: number | null = null;
  @Input() min = 0;
  @Input() max = 100;
  @Input() unit = '';
  @Input() title = '';

  series: number[] = [0];
  chart: ApexChart = { type: 'radialBar', height: '100%' };
  plotOptions: ApexPlotOptions = {
    radialBar: {
      startAngle: -135,
      endAngle: 135,
      dataLabels: {
        name: { show: true, fontSize: '14px' },
        value: { show: true, fontSize: '22px', formatter: (val) => `${val} ${this.unit}` },
      },
    },
  };
  titleConfig: ApexTitleSubtitle = { text: '' };
  labels: string[] = [''];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] || changes['min'] || changes['max'] || changes['title']) {
      this.titleConfig = { text: this.title };
      this.labels = [this.title];
      const range = this.max - this.min;
      const pct = range > 0 && this.value !== null
        ? Math.min(100, Math.max(0, ((this.value - this.min) / range) * 100))
        : 0;
      this.series = [Math.round(pct)];
    }
  }
}
