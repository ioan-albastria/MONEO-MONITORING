import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface PageHeaderState {
  title: string;
  subtitle?: string;
  stats?: string[];
}

@Injectable({ providedIn: 'root' })
export class PageHeaderStateService {
  private readonly _state$ = new BehaviorSubject<PageHeaderState | null>(null);
  readonly state$ = this._state$.asObservable();

  set(state: PageHeaderState): void { this._state$.next(state); }
  clear(): void { this._state$.next(null); }
}
