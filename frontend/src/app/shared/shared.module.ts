import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AlertBannerComponent } from './alert-banner.component';
import { ToastHostComponent } from './toast-host.component';

@NgModule({
  declarations: [AlertBannerComponent, ToastHostComponent],
  imports: [CommonModule, RouterModule],
  exports: [AlertBannerComponent, ToastHostComponent],
})
export class SharedModule {}
