import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Sensor } from '../../types/sensor';
import { SensorApiService } from '../../core/services/sensor-api.service';

@Component({
  selector: 'app-sensor-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sensor-page">
      <h2>Sensors</h2>
      <table *ngIf="sensors.length; else empty">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Unit</th>
            <th>MONEO ID</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let s of sensors">
            <td>{{ s.name }}</td>
            <td>{{ s.sensor_type }}</td>
            <td>{{ s.unit }}</td>
            <td class="mono">{{ s.moneo_sensor_id }}</td>
            <td>
              <span class="badge" [class.active]="s.is_active" [class.inactive]="!s.is_active">
                {{ s.is_active ? 'Active' : 'Inactive' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <ng-template #empty><p class="empty">No sensors discovered yet. Ensure MONEO API is reachable.</p></ng-template>
    </div>
  `,
  styles: [`
    .sensor-page { padding: 1.5rem; }
    h2 { margin: 0 0 1rem; font-size: 1.1rem; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); overflow: hidden; }
    th { background: #f5f5f5; padding: 0.6rem 0.75rem; text-align: left; font-size: 0.8rem; text-transform: uppercase; color: #666; }
    td { padding: 0.6rem 0.75rem; font-size: 0.875rem; border-top: 1px solid #f0f0f0; }
    .mono { font-family: monospace; font-size: 0.8rem; color: #555; }
    .badge { padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; }
    .active { background: #e8f5e9; color: #388e3c; }
    .inactive { background: #fce4ec; color: #c62828; }
    .empty { color: #999; font-size: 0.9rem; }
  `],
})
export class SensorListComponent implements OnInit {
  sensors: Sensor[] = [];

  constructor(private sensorApi: SensorApiService) {}

  ngOnInit(): void {
    this.sensorApi.getSensors().subscribe((list) => (this.sensors = list));
  }
}
