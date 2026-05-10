import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type WidgetTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type WidgetChromeMode = 'hover' | 'off';

@Component({
  selector: 'app-widget-shell',
  standalone: false,
  templateUrl: './app-widgets-shell.component.html',
  styleUrl: './app-widgets-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppWidgetsShellComponent {
  @Input() title = 'Widget';
  @Input() subtitle?: string;
  @Input() loading = false;
  @Input() tone: WidgetTone = 'neutral';
  @Input() chromeMode: WidgetChromeMode = 'hover';

  cycleChromeMode(): void {
    this.chromeMode = this.chromeMode === 'hover' ? 'off' : 'hover';
  }
}
