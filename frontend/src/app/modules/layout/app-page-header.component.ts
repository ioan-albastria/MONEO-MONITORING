import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';

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
  @Output() logout        = new EventEmitter<void>();

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
