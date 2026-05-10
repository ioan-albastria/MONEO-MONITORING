import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GridsterComponent, GridsterItemComponent } from 'angular-gridster2';
import { DashboardComponent } from './dashboard.component';
import { DashboardWidgetComponent } from './dashboard-widget.component';
import { DashboardRoutingModule } from './dashboard-routing.module';
import { WidgetsModule } from '../widgets/widgets.module';

@NgModule({
  declarations: [DashboardComponent, DashboardWidgetComponent],
  imports: [
    CommonModule,
    FormsModule,
    GridsterComponent,
    GridsterItemComponent,
    WidgetsModule,
    DashboardRoutingModule,
  ],
})
export class DashboardModule {}
