import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-alerts-page',
  standalone: false,
  templateUrl: './alerts-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertsPageComponent {
  activeTab: 'events' | 'rules' | 'routes' = 'events';
}
