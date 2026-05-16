import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit,
} from '@angular/core';
import { AssetApiService } from '../../core/assets/asset-api.service';
import { Asset, AssetKind } from '../../types/asset';

interface AssetRow extends Asset {
  editName: string;
  editKind: AssetKind;
  editParentId: number | null;
  saving: boolean;
  dirty: boolean;
}

@Component({
  selector: 'app-admin-assets',
  standalone: false,
  templateUrl: './admin-assets.component.html',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminAssetsComponent implements OnInit {
  assets: AssetRow[] = [];
  loading = true;
  error: string | null = null;

  showCreateForm = false;
  createName = '';
  createKind: AssetKind = 'machine';
  createParentId: number | null = null;
  creating = false;

  readonly kinds: AssetKind[] = ['factory','area','line','cell','machine','equipment'];

  constructor(
    private readonly api: AssetApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> { await this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();
    try {
      const flat = await this.api.getFlat();
      this.assets = flat.map(a => ({
        ...a,
        editName: a.name,
        editKind: (a.kind ?? 'machine') as AssetKind,
        editParentId: a.parent_id ?? null,
        saving: false,
        dirty: false,
      }));
    } catch { this.error = 'Failed to load assets.'; }
    finally { this.loading = false; this.cdr.detectChanges(); }
  }

  markDirty(row: AssetRow): void {
    row.dirty = row.editName !== row.name
      || row.editKind !== row.kind
      || row.editParentId !== (row.parent_id ?? null);
  }

  async saveRow(row: AssetRow): Promise<void> {
    if (!row.dirty) return;
    row.saving = true; this.cdr.detectChanges();
    try {
      await this.api.update(row.id, {
        name: row.editName,
        kind: row.editKind,
        parent_id: row.editParentId,
      });
      await this.load();
    } catch { row.saving = false; this.cdr.detectChanges(); }
  }

  async deleteRow(row: AssetRow): Promise<void> {
    if (!confirm(`Delete "${row.name}"?`)) return;
    try {
      await this.api.delete(row.id);
      await this.load();
    } catch (e: any) {
      this.error = e?.error?.detail ?? 'Delete failed (asset may have children).';
      this.cdr.detectChanges();
    }
  }

  async createAsset(): Promise<void> {
    if (!this.createName.trim()) return;
    this.creating = true; this.cdr.detectChanges();
    try {
      await this.api.create({
        name: this.createName.trim(),
        kind: this.createKind,
        parent_id: this.createParentId,
      });
      this.createName = ''; this.showCreateForm = false;
      await this.load();
    } catch { this.creating = false; this.cdr.detectChanges(); }
    finally { this.creating = false; }
  }

  parentName(parentId: number | null): string {
    if (parentId == null) return '—';
    return this.assets.find(a => a.id === parentId)?.name ?? String(parentId);
  }

  trackAsset(_: number, a: AssetRow): number { return a.id; }
}
