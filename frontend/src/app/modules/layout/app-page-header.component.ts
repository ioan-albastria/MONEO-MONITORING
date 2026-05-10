import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-page-header',
  standalone: false,
  templateUrl: './app-page-header.component.html',
  styleUrl: './app-page-header.component.css',
})
export class AppPageHeaderComponent {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() stats: string[] = [];
  @Input() tenantName = 'Albastria Logistics';
  @Input() userName = '';

  @Output() toggleTheme   = new EventEmitter<void>();
  @Output() toggleDensity = new EventEmitter<void>();

  get userInitial(): string {
    const t = (this.userName || '').trim();
    return t ? t[0].toUpperCase() : 'U';
  }
}
