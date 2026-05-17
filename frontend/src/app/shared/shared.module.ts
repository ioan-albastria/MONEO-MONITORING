import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AlertBannerComponent } from './alert-banner.component';
import { ToastHostComponent } from './toast-host.component';
import { SyncStatusIndicatorComponent } from './components/sync-status-indicator/sync-status-indicator.component';
import { SyncStatusPanelComponent } from './components/sync-status-panel/sync-status-panel.component';
import { SyncStatusBannerComponent } from './components/sync-status-banner/sync-status-banner.component';

@NgModule({
  declarations: [
    AlertBannerComponent,
    ToastHostComponent,
    SyncStatusIndicatorComponent,
    SyncStatusPanelComponent,
    SyncStatusBannerComponent,
  ],
  imports: [CommonModule, RouterModule],
  exports: [
    AlertBannerComponent,
    ToastHostComponent,
    SyncStatusIndicatorComponent,
    SyncStatusPanelComponent,
    SyncStatusBannerComponent,
  ],
})
export class SharedModule {}
