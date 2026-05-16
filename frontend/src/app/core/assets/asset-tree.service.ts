import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AssetNode } from '../../types/asset';
import { AssetApiService } from './asset-api.service';

@Injectable({ providedIn: 'root' })
export class AssetTreeService {
  private _tree$ = new BehaviorSubject<AssetNode[]>([]);
  readonly tree$ = this._tree$.asObservable();

  private _loading = false;
  private _lastFetchMs = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

  constructor(private api: AssetApiService) {}

  get snapshot(): AssetNode[] { return this._tree$.getValue(); }

  async ensureLoaded(): Promise<void> {
    const age = Date.now() - this._lastFetchMs;
    if (this._loading || age < this.CACHE_TTL_MS) return;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    try {
      const tree = await this.api.getTree();
      this._tree$.next(tree);
      this._lastFetchMs = Date.now();
    } catch {
      // Leave stale data; don't crash
    } finally {
      this._loading = false;
    }
  }
}
