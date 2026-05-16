import { ChangeDetectionStrategy, Component } from '@angular/core';

type AdminTab = 'kiosk-tokens' | 'users' | 'assets';

@Component({
  selector: 'app-admin-page',
  standalone: false,
  templateUrl: './admin-page.component.html',
  styleUrl: './admin-page.component.css',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminPageComponent {
  activeTab: AdminTab = 'kiosk-tokens';

  setTab(tab: AdminTab): void {
    this.activeTab = tab;
  }
}
