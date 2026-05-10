import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppWidgetsShellComponent } from './app-widgets-shell.component';

@NgModule({
  declarations: [AppWidgetsShellComponent],
  imports: [CommonModule],
  exports: [AppWidgetsShellComponent],
})
export class WidgetsModule {}
