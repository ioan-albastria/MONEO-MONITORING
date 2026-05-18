import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { UiPreferencesService } from '../../core/ui/ui-preferences.service';

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

  @Output() logout = new EventEmitter<void>();

  constructor(readonly ui: UiPreferencesService) {}

  isMenuOpen = false;

  get userInitial(): string {
    const t = (this.userName || '').trim();
    return t ? t[0].toUpperCase() : 'U';
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  onLogout() {
    this.logout.emit();
    this.isMenuOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.user-menu')) {
      this.isMenuOpen = false;
    }
  }
}
