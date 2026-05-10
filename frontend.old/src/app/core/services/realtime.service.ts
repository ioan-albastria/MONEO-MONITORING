import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { LatestReading } from '../../types/sensor';

@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private sockets = new Map<number, WebSocket>();
  private subjects = new Map<number, Subject<LatestReading>>();

  subscribe(sensorId: number): Observable<LatestReading> {
    if (!this.subjects.has(sensorId)) {
      this.subjects.set(sensorId, new Subject<LatestReading>());
      this.connect(sensorId);
    }
    return this.subjects.get(sensorId)!.asObservable();
  }

  unsubscribe(sensorId: number): void {
    this.sockets.get(sensorId)?.close();
    this.sockets.delete(sensorId);
    this.subjects.get(sensorId)?.complete();
    this.subjects.delete(sensorId);
  }

  ngOnDestroy(): void {
    this.sockets.forEach((ws) => ws.close());
  }

  private connect(sensorId: number): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/sensors/${sensorId}`);
    this.sockets.set(sensorId, ws);

    ws.onmessage = (event) => {
      try {
        const data: LatestReading = JSON.parse(event.data);
        this.subjects.get(sensorId)?.next(data);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      // Reconnect after 5 s if the subject is still alive
      if (this.subjects.has(sensorId)) {
        setTimeout(() => this.connect(sensorId), 5000);
      }
    };
  }
}
