import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GridsterComponent, GridsterItemComponent } from 'angular-gridster2';
import { NgApexchartsModule } from 'ng-apexcharts';
import { AssetTreePickerComponent } from './asset-tree-picker.component';
import { DashboardComponent } from './dashboard.component';
import { DashboardWidgetComponent } from './dashboard-widget.component';
import { DashboardRoutingModule } from './dashboard-routing.module';
import { WidgetsModule } from '../widgets/widgets.module';

@NgModule({
  declarations: [DashboardComponent, DashboardWidgetComponent, AssetTreePickerComponent],
  imports: [
    CommonModule,
    FormsModule,
    GridsterComponent,
    GridsterItemComponent,
    NgApexchartsModule,
    WidgetsModule,
    DashboardRoutingModule,
  ],
})
export class DashboardModule {}
