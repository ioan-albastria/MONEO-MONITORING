import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppWidgetsShellComponent } from './app-widgets-shell.component';
import { RelativeTimePipe } from './relative-time.pipe';

@NgModule({
  declarations: [AppWidgetsShellComponent, RelativeTimePipe],
  imports: [CommonModule],
  exports: [AppWidgetsShellComponent, RelativeTimePipe],
})
export class WidgetsModule {}
