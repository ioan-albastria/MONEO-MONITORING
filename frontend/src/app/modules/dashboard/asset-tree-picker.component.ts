import {
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges,
} from '@angular/core';
import { AssetNode } from '../../types/asset';
import { Sensor } from '../../types/sensor';
import { AssetTreeService } from '../../core/assets/asset-tree.service';
import { SensorApiService } from '../../core/sensors/sensor-api.service';

interface TreeNode {
  asset: AssetNode;
  sensors: Sensor[];
  expanded: boolean;
  visible: boolean;
  children: TreeNode[];
}

interface FlatDisplayNode {
  kind: 'asset' | 'sensor';
  treeNode?: TreeNode;   // defined when kind === 'asset'
  sensor?: Sensor;       // defined when kind === 'sensor'
  depth: number;
}

@Component({
  selector: 'app-asset-tree-picker',
  standalone: false,
  templateUrl: './asset-tree-picker.component.html',
  styleUrl: './asset-tree-picker.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetTreePickerComponent implements OnInit, OnChanges {
  @Input()  selectedIds: number[] = [];
  @Output() selectedIdsChange = new EventEmitter<number[]>();

  @Input() timeFrom = '';
  @Input() timeTo = '';

  filterText = '';
  filterWithDataOnly = true;
  filterInTimeWindow = false;

  roots: TreeNode[] = [];
  flatDisplayNodes: FlatDisplayNode[] = [];
  unassignedSensors: Sensor[] = [];
  loading = true;
  error = false;
  sparklines = new Map<number, number[]>();

  private allSensors: Sensor[] = [];

  constructor(
    private readonly treeService: AssetTreeService,
    private readonly sensorApi: SensorApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['timeFrom'] || changes['timeTo']) && !this.loading) {
      this._applyFilter();
      this.cdr.markForCheck();
    }
  }

  async ngOnInit(): Promise<void> {
    try {
      await Promise.all([
        this.treeService.ensureLoaded(),
        this.sensorApi.listSensors().then(s => { this.allSensors = s; }),
      ]);
      this.roots = this._buildNodes(this.treeService.snapshot);
      this.unassignedSensors = this.allSensors.filter(s => s.asset_id == null);
      this._applyFilter();
      this._rebuildFlat();
      void this._loadSparklines();
    } catch {
      this.error = true;
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private async _loadSparklines(): Promise<void> {
    if (!this.allSensors.length) return;
    const ids = this.allSensors.map(s => s.id);
    try {
      const data = await this.sensorApi.getSparklines(ids, 60);
      for (const item of data) {
        if (item.points.length > 1) {
          this.sparklines.set(item.sensor_id, item.points);
        }
      }
      this.cdr.markForCheck();
    } catch {
      // sparklines are optional — fail silently
    }
  }

  sparklinePath(sensorId: number): string {
    const pts = this.sparklines.get(sensorId);
    if (!pts || pts.length < 2) return '';
    const W = 64, H = 18;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    return pts.map((v, i) => {
      const x = (i / (pts.length - 1)) * W;
      const y = H - ((v - min) / range) * H * 0.85 - H * 0.075;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  onFilterChange(): void {
    this._applyFilter();
    this.cdr.markForCheck();
  }

  onFilterToggle(): void {
    this._applyFilter();
    this.cdr.markForCheck();
  }

  private _sensorPassesDataFilter(s: Sensor): boolean {
    if (this.filterWithDataOnly && !s.has_readings) return false;
    if (this.filterInTimeWindow && this.timeFrom) {
      if (s.last_seen_at === null) return false;
      if (s.last_seen_at < this.timeFrom) return false;
    }
    return true;
  }

  toggleNode(node: TreeNode): void {
    node.expanded = !node.expanded;
    this._rebuildFlat();
    this.cdr.markForCheck();
  }

  isSensorSelected(id: number): boolean {
    return this.selectedIds.includes(id);
  }

  toggleSensor(id: number): void {
    const next = this.selectedIds.includes(id)
      ? this.selectedIds.filter(x => x !== id)
      : [...this.selectedIds, id];
    this.selectedIds = next;
    this.selectedIdsChange.emit(next);
    this.cdr.markForCheck();
  }

  clearAll(): void {
    this.selectedIds = [];
    this.selectedIdsChange.emit([]);
    this.cdr.markForCheck();
  }

  trackFlatNode(_: number, flat: FlatDisplayNode): string {
    return flat.kind === 'asset'
      ? `a-${flat.treeNode!.asset.id}`
      : `s-${flat.sensor!.id}`;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private _rebuildFlat(): void {
    const result: FlatDisplayNode[] = [];
    this._collectFlat(this.roots, 0, result);
    this.flatDisplayNodes = result;
  }

  private _collectFlat(nodes: TreeNode[], depth: number, result: FlatDisplayNode[]): void {
    for (const n of nodes) {
      if (!n.visible) continue;
      result.push({ kind: 'asset', treeNode: n, depth });
      if (n.expanded) {
        for (const s of this.visibleSensors(n)) {
          result.push({ kind: 'sensor', sensor: s, depth: depth + 1 });
        }
        this._collectFlat(n.children, depth + 1, result);
      }
    }
  }

  private _buildNodes(assets: AssetNode[]): TreeNode[] {
    return assets.map(a => ({
      asset: a,
      sensors: this.allSensors.filter(s => s.asset_id === a.id),
      expanded: false,
      visible: true,
      children: this._buildNodes(a.children),
    }));
  }

  private _applyFilter(): void {
    const q = this.filterText.trim().toLowerCase();
    if (!q) {
      this._setAllVisible(this.roots, true);
    } else {
      this._filterNodes(this.roots, q);
    }
    // Second pass: hide asset nodes where no sensor survives the data filter
    this._applyDataVisibility(this.roots);
    this._rebuildFlat();
  }

  private _setAllVisible(nodes: TreeNode[], visible: boolean): void {
    for (const n of nodes) {
      n.visible = visible;
      n.expanded = false;
      this._setAllVisible(n.children, visible);
    }
  }

  private _filterNodes(nodes: TreeNode[], q: string): boolean {
    let anyVisible = false;
    for (const n of nodes) {
      const nameMatch = n.asset.name.toLowerCase().includes(q)
        || (n.asset.path ?? '').toLowerCase().includes(q);
      const sensorMatch = n.sensors.some(
        s => this._sensorPassesDataFilter(s) && s.name.toLowerCase().includes(q)
      );
      const childVisible = this._filterNodes(n.children, q);
      n.visible = nameMatch || sensorMatch || childVisible;
      n.expanded = n.visible;
      if (n.visible) anyVisible = true;
    }
    return anyVisible;
  }

  // Hide nodes (and propagate up) where no sensor passes the data filter.
  // Returns true if this subtree has at least one visible node after the pass.
  private _applyDataVisibility(nodes: TreeNode[]): boolean {
    let anyVisible = false;
    for (const n of nodes) {
      if (!n.visible) continue;
      const childHasVisible = this._applyDataVisibility(n.children);
      const ownSensorVisible = n.sensors.some(s => this._sensorPassesDataFilter(s));
      if (!ownSensorVisible && !childHasVisible) {
        n.visible = false;
      } else {
        anyVisible = true;
      }
    }
    return anyVisible;
  }

  visibleSensors(node: TreeNode): Sensor[] {
    const q = this.filterText.trim().toLowerCase();
    return node.sensors.filter(s => {
      if (!this._sensorPassesDataFilter(s)) return false;
      return !q || s.name.toLowerCase().includes(q);
    });
  }

  visibleUnassigned(): Sensor[] {
    const q = this.filterText.trim().toLowerCase();
    return this.unassignedSensors.filter(s => {
      if (!this._sensorPassesDataFilter(s)) return false;
      return !q || s.name.toLowerCase().includes(q);
    });
  }

  trackById(_i: number, item: { id: number }): number { return item.id; }
  trackByAssetId(_i: number, n: TreeNode): number { return n.asset.id; }
}
