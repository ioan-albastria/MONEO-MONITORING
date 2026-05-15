import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AppShellComponent } from './app-shell.component';
import { AppPageHeaderComponent } from './app-page-header.component';
import { AppNavRailComponent } from './app-nav-rail.component';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  declarations: [
    AppShellComponent,
    AppPageHeaderComponent,
    AppNavRailComponent,
  ],
  imports: [CommonModule, RouterModule, SharedModule],
  exports: [AppShellComponent],
})
export class LayoutModule {}
