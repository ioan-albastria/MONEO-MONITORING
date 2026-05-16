import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Annotation } from '../../types/annotation';

@Injectable({ providedIn: 'root' })
export class AnnotationsApiService {
  constructor(private http: HttpClient) {}

  getAnnotations(params: {
    scope_kind?: string;
    scope_id?: number;
    from?: string;
    to?: string;
    kinds?: string;
    limit?: number;
  }): Promise<Annotation[]> {
    let p = new HttpParams();
    if (params.scope_kind) p = p.set('scope_kind', params.scope_kind);
    if (params.scope_id != null) p = p.set('scope_id', String(params.scope_id));
    if (params.from) p = p.set('from', params.from);
    if (params.to) p = p.set('to', params.to);
    if (params.kinds) p = p.set('kinds', params.kinds);
    if (params.limit != null) p = p.set('limit', String(params.limit));
    return firstValueFrom(this.http.get<Annotation[]>('/api/annotations', { params: p }));
  }

  createAnnotation(body: Partial<Annotation>): Promise<Annotation> {
    return firstValueFrom(this.http.post<Annotation>('/api/annotations', body));
  }

  deleteAnnotation(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/annotations/${id}`));
  }
}
