import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { DashboardWidget } from '../../types/dashboard';
import { WidgetTone } from '../widgets/app-widgets-shell.component';

@Component({
  selector: 'app-dashboard-widget',
  standalone: false,
  templateUrl: './dashboard-widget.component.html',
  styleUrl: './dashboard-widget.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardWidgetComponent {
  @Input({ required: true }) widget!: DashboardWidget;
  @Input() editable = false;
  @Output() configure = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();

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
    const sensorLabel = ids.length === 1 ? '1 sensor' : `${ids.length} sensors`;
    const hours = this.widget.settings?.time_range_hours;
    return hours ? `${sensorLabel} • last ${hours}h` : sensorLabel;
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

  get placeholderIcon(): string {
    switch (this.widget.widget_type) {
      case 'line_chart': return 'show_chart';
      case 'bar_chart':  return 'bar_chart';
      case 'gauge':      return 'speed';
      case 'stat_card':  return 'tag';
      default:           return 'widgets';
    }
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
