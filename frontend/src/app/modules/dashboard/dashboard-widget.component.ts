import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DashboardWidget } from '../../types/dashboard';

/** Placeholder — full implementation in slice 3 (Phase 10). */
@Component({
  selector: 'app-dashboard-widget',
  standalone: false,
  templateUrl: './dashboard-widget.component.html',
  styleUrl: './dashboard-widget.component.css',
})
export class DashboardWidgetComponent {
  @Input() widget!: DashboardWidget;
  @Input() editable = false;
  @Output() configure = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();
}
