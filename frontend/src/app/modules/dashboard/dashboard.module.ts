import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DashboardComponent } from './dashboard.component';
import { DashboardWidgetComponent } from './dashboard-widget.component';
import { DashboardRoutingModule } from './dashboard-routing.module';

@NgModule({
  declarations: [DashboardComponent, DashboardWidgetComponent],
  imports: [CommonModule, FormsModule, DashboardRoutingModule],
})
export class DashboardModule {}
