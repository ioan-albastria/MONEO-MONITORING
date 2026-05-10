import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AppShellComponent } from './app-shell.component';
import { AppPageHeaderComponent } from './app-page-header.component';
import { AppNavRailComponent } from './app-nav-rail.component';

@NgModule({
  declarations: [
    AppShellComponent,
    AppPageHeaderComponent,
    AppNavRailComponent,
  ],
  imports: [CommonModule, RouterModule],
  exports: [AppShellComponent],
})
export class LayoutModule {}
