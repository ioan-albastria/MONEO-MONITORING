import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GridsterComponent, GridsterItemComponent, GridsterConfig, GridsterItem } from 'angular-gridster2';
import { Dashboard } from '../../types/dashboard';
import { DashboardWidget } from '../../types/widget';
import { DashboardWidgetComponent } from './dashboard-widget.component';

interface GridItem extends GridsterItem {
  widget: DashboardWidget;
}

@Component({
  selector: 'app-dashboard-grid',
  standalone: true,
  imports: [CommonModule, GridsterComponent, GridsterItemComponent, DashboardWidgetComponent],
  template: `
    <gridster [options]="gridOptions">
      <gridster-item *ngFor="let item of items; trackBy: trackById" [item]="item">
        <app-dashboard-widget
          [widget]="item.widget"
          [editMode]="editMode"
          (edit)="editWidget.emit($event)"
          (delete)="deleteWidget.emit($event)"
        ></app-dashboard-widget>
      </gridster-item>
    </gridster>
  `,
  styles: [`
    gridster { background: transparent !important; }
    :host { display: block; height: 100%; }
  `],
})
export class DashboardGridComponent implements OnChanges {
  @Input() dashboard!: Dashboard;
  @Input() editMode = false;

  @Output() layoutChanged = new EventEmitter<GridItem[]>();
  @Output() editWidget = new EventEmitter<DashboardWidget>();
  @Output() deleteWidget = new EventEmitter<number>();

  items: GridItem[] = [];

  gridOptions: GridsterConfig = {
    gridType: 'scrollVertical',
    compactType: 'none',
    margin: 8,
    outerMargin: true,
    mobileBreakpoint: 640,
    minCols: 12,
    maxCols: 12,
    minRows: 1,
    pushItems: true,
    draggable: { enabled: false },
    resizable: { enabled: false },
    displayGrid: 'onDrag&Resize',
    itemChangeCallback: () => this.layoutChanged.emit(this.items),
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['dashboard']) {
      this.buildItems();
    }
    if (changes['editMode']) {
      this.gridOptions = {
        ...this.gridOptions,
        draggable: { enabled: this.editMode },
        resizable: { enabled: this.editMode },
        displayGrid: this.editMode ? 'always' : 'onDrag&Resize',
      };
    }
  }

  trackById(_: number, item: GridItem): number {
    return item.widget.id;
  }

  private buildItems(): void {
    this.items = (this.dashboard?.widgets ?? []).map((w) => ({
      cols: w.cols,
      rows: w.rows,
      y: w.y,
      x: w.x,
      widget: w,
    }));
  }
}
