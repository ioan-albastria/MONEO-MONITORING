import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Toast {
  id: number;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  duration: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _counter = 0;
  private _toasts$ = new BehaviorSubject<Toast[]>([]);
  readonly toasts$ = this._toasts$.asObservable();

  push(
    message: string,
    severity: Toast['severity'] = 'info',
    duration = 5000
  ): number {
    const id = ++this._counter;
    this._toasts$.next([...this._toasts$.getValue(), { id, message, severity, duration }]);
    return id;
  }

  dismiss(id: number): void {
    this._toasts$.next(this._toasts$.getValue().filter((t) => t.id !== id));
  }
}
