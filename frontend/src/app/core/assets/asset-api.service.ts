import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Asset, AssetNode } from '../../types/asset';

@Injectable({ providedIn: 'root' })
export class AssetApiService {
  constructor(private http: HttpClient) {}

  getTree(): Promise<AssetNode[]> {
    return firstValueFrom(this.http.get<AssetNode[]>('/api/assets/tree'));
  }

  getFlat(params: { kind?: string; parent_id?: number; search?: string } = {}): Promise<Asset[]> {
    let p = new HttpParams();
    if (params.kind)      p = p.set('kind', params.kind);
    if (params.parent_id != null) p = p.set('parent_id', String(params.parent_id));
    if (params.search)    p = p.set('search', params.search);
    return firstValueFrom(this.http.get<Asset[]>('/api/assets', { params: p }));
  }

  getAncestors(id: number): Promise<Asset[]> {
    return firstValueFrom(this.http.get<Asset[]>(`/api/assets/${id}/ancestors`));
  }

  create(body: { name: string; kind?: string; parent_id?: number | null; description?: string | null }): Promise<Asset> {
    return firstValueFrom(this.http.post<Asset>('/api/assets', body));
  }

  update(id: number, body: Partial<Pick<Asset, 'name' | 'kind' | 'parent_id' | 'description'>>): Promise<Asset> {
    return firstValueFrom(this.http.put<Asset>(`/api/assets/${id}`, body));
  }

  delete(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/assets/${id}`));
  }
}
