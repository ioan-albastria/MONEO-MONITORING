import { Injectable, OnDestroy } from '@angular/core';
import { Observable, EMPTY } from 'rxjs';
import { SensorReading } from '../../types/sensor';

/**
 * Stub for Phase 12. Returns empty Observables until the WebSocket
 * layer is wired up (slice 5). gauge/stat_card widgets call subscribe()
 * and fall back to getLatest() for the initial value.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  /** Subscribe to live readings for a single sensor. */
  subscribe(_sensorId: number): Observable<SensorReading> {
    return EMPTY;
  }

  ngOnDestroy(): void {}
}
