import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AdminRoutingModule } from './admin-routing.module';
import { AdminPageComponent } from './admin-page.component';
import { AdminKioskTokensComponent } from './admin-kiosk-tokens.component';
import { AdminUsersComponent } from './admin-users.component';
import { AdminAssetsComponent } from './admin-assets.component';

@NgModule({
  declarations: [
    AdminPageComponent,
    AdminKioskTokensComponent,
    AdminUsersComponent,
    AdminAssetsComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    AdminRoutingModule,
  ],
})
export class AdminModule {}
