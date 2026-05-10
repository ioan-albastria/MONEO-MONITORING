import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Dashboard, DashboardCreate } from '../../types/dashboard';

@Component({
  selector: 'app-dashboard-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="sidebar-header">
      <span>Dashboards</span>
      <button class="btn-icon" (click)="showForm = !showForm" title="New dashboard">+</button>
    </div>

    <div *ngIf="showForm" class="new-dashboard-form">
      <input [(ngModel)]="newName" placeholder="Dashboard name" (keyup.enter)="onCreate()" />
      <button (click)="onCreate()" [disabled]="!newName.trim()">Create</button>
      <button class="btn-cancel" (click)="showForm = false; newName = ''">✕</button>
    </div>

    <div class="dashboard-items">
      <div
        *ngFor="let d of dashboards"
        class="dashboard-item"
        [class.active]="selected?.id === d.id"
        (click)="select.emit(d)"
      >
        <span class="dash-name">{{ d.name }}</span>
        <span class="dash-public" *ngIf="d.is_public" title="Public">🌐</span>
        <button
          class="btn-icon btn-delete"
          (click)="$event.stopPropagation(); delete.emit(d.id)"
          title="Delete"
        >🗑️</button>
      </div>

      <div *ngIf="!dashboards.length" class="empty">No dashboards yet</div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }
    .sidebar-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; font-weight: 600; font-size: 0.9rem; border-bottom: 1px solid #eee; }
    .btn-icon { background: none; border: none; cursor: pointer; font-size: 1.1rem; padding: 2px 6px; border-radius: 4px; }
    .btn-icon:hover { background: #f0f0f0; }
    .new-dashboard-form { display: flex; gap: 4px; padding: 0.5rem; border-bottom: 1px solid #eee; }
    .new-dashboard-form input { flex: 1; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.85rem; }
    .new-dashboard-form button { padding: 4px 8px; border-radius: 4px; border: none; background: #1a73e8; color: white; cursor: pointer; font-size: 0.8rem; }
    .btn-cancel { background: transparent !important; color: #666 !important; border: 1px solid #ccc !important; }
    .dashboard-items { flex: 1; overflow-y: auto; }
    .dashboard-item { display: flex; align-items: center; gap: 4px; padding: 0.6rem 1rem; cursor: pointer; border-bottom: 1px solid #f5f5f5; }
    .dashboard-item:hover { background: #f5f5f5; }
    .dashboard-item.active { background: #e8f0fe; }
    .dash-name { flex: 1; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dash-public { font-size: 0.7rem; }
    .btn-delete { opacity: 0; font-size: 0.8rem; }
    .dashboard-item:hover .btn-delete { opacity: 1; }
    .empty { padding: 1rem; text-align: center; color: #999; font-size: 0.85rem; }
  `],
})
export class DashboardListComponent {
  @Input() dashboards: Dashboard[] = [];
  @Input() selected: Dashboard | null = null;

  @Output() select = new EventEmitter<Dashboard>();
  @Output() create = new EventEmitter<DashboardCreate>();
  @Output() delete = new EventEmitter<number>();

  showForm = false;
  newName = '';

  onCreate(): void {
    if (!this.newName.trim()) return;
    this.create.emit({ name: this.newName.trim() });
    this.newName = '';
    this.showForm = false;
  }
}
