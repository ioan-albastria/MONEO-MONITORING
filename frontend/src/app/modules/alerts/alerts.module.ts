import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { WidgetsModule } from '../widgets/widgets.module';
import { AlertsRoutingModule } from './alerts-routing.module';
import { AlertsPageComponent } from './alerts-page.component';
import { AlertsListComponent } from './alerts-list.component';
import { AlertRulesListComponent } from './alert-rules-list.component';
import { AlertRoutesListComponent } from './alert-routes-list.component';

@NgModule({
  declarations: [AlertsPageComponent, AlertsListComponent, AlertRulesListComponent, AlertRoutesListComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    SharedModule,
    WidgetsModule,
    AlertsRoutingModule,
  ],
})
export class AlertsModule {}
