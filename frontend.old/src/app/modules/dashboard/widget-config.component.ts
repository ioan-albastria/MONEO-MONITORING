import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Sensor } from '../../types/sensor';
import { DashboardWidget, DashboardWidgetCreate } from '../../types/widget';

@Component({
  selector: 'app-widget-config',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="modal-backdrop" (click)="cancel.emit()">
      <div class="modal-panel" (click)="$event.stopPropagation()">
        <h3>{{ widget ? 'Edit Widget' : 'Add Widget' }}</h3>

        <div class="form-group">
          <label>Title</label>
          <input [(ngModel)]="form.title" placeholder="Widget title" />
        </div>

        <div class="form-group">
          <label>Type</label>
          <select [(ngModel)]="form.widget_type">
            <option value="line_chart">Line Chart</option>
            <option value="bar_chart">Bar Chart</option>
            <option value="gauge">Gauge</option>
            <option value="stat_card">Stat Card</option>
          </select>
        </div>

        <div class="form-group">
          <label>Sensors</label>
          <input
            class="sensor-filter"
            [(ngModel)]="sensorFilter"
            placeholder="Filter sensors..."
          />
          <div class="sensor-list">
            @for (s of filteredSensors; track s.id) {
              <label class="sensor-option">
                <input
                  type="checkbox"
                  [value]="s.id"
                  [checked]="isSensorSelected(s.id)"
                  (change)="toggleSensor(s.id, $event)"
                />
                {{ s.name }} ({{ s.sensor_type }}, {{ s.unit }})
              </label>
            }
            @if (filteredSensors.length === 0) {
              <span class="no-results">No sensors match your filter.</span>
            }
          </div>
        </div>

        @if (form.widget_type !== 'stat_card') {
          <div class="form-group">
            <label>Time range (hours)</label>
            <input type="number" [(ngModel)]="form.settings.time_range_hours" min="1" max="168" />
          </div>
        }

        @if (form.widget_type === 'gauge') {
          <div class="form-group">
            <label>Min value</label>
            <input
              type="number"
              [ngModel]="form.settings['gauge_min']"
              (ngModelChange)="form.settings['gauge_min'] = $event"
            />
            <label>Max value</label>
            <input
              type="number"
              [ngModel]="form.settings['gauge_max']"
              (ngModelChange)="form.settings['gauge_max'] = $event"
            />
          </div>
        }

        <div class="actions">
          <button class="btn-secondary" (click)="cancel.emit()">Cancel</button>
          <button class="btn-primary" (click)="onSave()">Save</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .modal-panel {
      background: white; border-radius: 8px; padding: 1.5rem;
      width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 24px rgba(0,0,0,0.2);
    }
    h3 { margin: 0 0 1rem; }
    .form-group { display: flex; flex-direction: column; margin-bottom: 1rem; gap: 4px; }
    label { font-size: 0.85rem; color: #333; }
    input, select { padding: 0.4rem 0.6rem; border: 1px solid #ccc; border-radius: 4px; font-size: 0.95rem; }
    .sensor-filter { margin-bottom: 4px; }
    .sensor-list { display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px; padding: 0.5rem; }
    .sensor-option { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; }
    .no-results { font-size: 0.85rem; color: #999; padding: 0.25rem 0; }
    .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem; }
    .btn-primary { background: #1a73e8; color: white; border: none; border-radius: 4px; padding: 0.5rem 1.2rem; cursor: pointer; }
    .btn-secondary { background: transparent; border: 1px solid #ccc; border-radius: 4px; padding: 0.5rem 1.2rem; cursor: pointer; }
  `],
})
export class WidgetConfigComponent implements OnInit {
  @Input() sensors: Sensor[] = [];
  @Input() widget: DashboardWidget | null = null;

  @Output() save = new EventEmitter<DashboardWidgetCreate>();
  @Output() cancel = new EventEmitter<void>();

  sensorFilter = '';

  get filteredSensors(): Sensor[] {
    const q = this.sensorFilter.trim().toLowerCase();
    if (!q) return this.sensors;
    return this.sensors.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.sensor_type.toLowerCase().includes(q) ||
      s.unit.toLowerCase().includes(q)
    );
  }

  form: DashboardWidgetCreate = {
    widget_type: 'line_chart',
    title: '',
    x: 0,
    y: 0,
    cols: 6,
    rows: 4,
    settings: { sensor_ids: [], time_range_hours: 24 },
  };

  ngOnInit(): void {
    if (this.widget) {
      this.form = {
        widget_type: this.widget.widget_type,
        title: this.widget.title ?? '',
        x: this.widget.x,
        y: this.widget.y,
        cols: this.widget.cols,
        rows: this.widget.rows,
        settings: { ...this.widget.settings },
      };
    }
  }

  isSensorSelected(id: number): boolean {
    return (this.form.settings.sensor_ids ?? []).includes(id);
  }

  toggleSensor(id: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const ids = [...(this.form.settings.sensor_ids ?? [])];
    if (checked) {
      if (!ids.includes(id)) ids.push(id);
    } else {
      const idx = ids.indexOf(id);
      if (idx > -1) ids.splice(idx, 1);
    }
    this.form.settings = { ...this.form.settings, sensor_ids: ids };
  }

  onSave(): void {
    this.save.emit(this.form);
  }
}
