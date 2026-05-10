import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LatestReading } from '../../../types/sensor';

@Component({
  selector: 'app-stat-card-widget',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="stat-card">
      <div class="stat-title">{{ title }}</div>
      <div class="stat-value">
        <span *ngIf="reading?.value !== null; else noData">
          {{ reading?.value | number: '1.2-2' }} <span class="unit">{{ unit }}</span>
        </span>
        <ng-template #noData><span class="no-data">—</span></ng-template>
      </div>
      <div class="stat-ts" *ngIf="reading?.timestamp">
        {{ reading?.timestamp | date: 'HH:mm:ss' }}
      </div>
      <div class="stat-status" [class]="'status-' + (reading?.status ?? 'unknown')">
        {{ reading?.status ?? 'unknown' }}
      </div>
    </div>
  `,
  styles: [`
    .stat-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 1rem;
    }
    .stat-title { font-size: 0.9rem; color: #666; margin-bottom: 0.5rem; text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #1a73e8; }
    .unit { font-size: 1rem; font-weight: 400; color: #555; }
    .stat-ts { font-size: 0.75rem; color: #999; margin-top: 0.25rem; }
    .no-data { color: #bbb; }
    .stat-status { font-size: 0.7rem; margin-top: 0.25rem; padding: 2px 8px; border-radius: 12px; }
    .status-ok { background: #e8f5e9; color: #388e3c; }
    .status-error { background: #ffebee; color: #d32f2f; }
    .status-unknown { background: #f5f5f5; color: #999; }
  `],
})
export class StatCardWidgetComponent implements OnChanges {
  @Input() reading: LatestReading | null = null;
  @Input() unit = '';
  @Input() title = '';

  ngOnChanges(_: SimpleChanges): void {}
}
