import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Toast, ToastService } from './toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: false,
  templateUrl: './toast-host.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHostComponent implements OnInit, OnDestroy {
  toasts: Toast[] = [];
  private _sub: Subscription | null = null;
  private _timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly toastService: ToastService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this._sub = this.toastService.toasts$.subscribe((toasts) => {
      this.toasts = toasts;
      this.cdr.markForCheck();
      toasts.forEach((t) => {
        if (!this._timers.has(t.id) && t.duration > 0) {
          this._timers.set(
            t.id,
            setTimeout(() => {
              this.toastService.dismiss(t.id);
              this._timers.delete(t.id);
            }, t.duration)
          );
        }
      });
    });
  }

  ngOnDestroy(): void {
    this._sub?.unsubscribe();
    this._timers.forEach((timer) => clearTimeout(timer));
  }

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }
}
