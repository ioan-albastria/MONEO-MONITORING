import { Injectable, OnDestroy } from '@angular/core';
import { Observable, share } from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { SensorReading } from '../../types/sensor';

interface WsMessage {
  id?: number;
  sensor_id: number;
  value: number | null;
  timestamp: string | null;
}

@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private readonly streams = new Map<number, Observable<SensorReading>>();

  subscribe(sensorId: number): Observable<SensorReading> {
    if (!this.streams.has(sensorId)) {
      this.streams.set(sensorId, this.buildStream(sensorId).pipe(share()));
    }
    return this.streams.get(sensorId)!;
  }

  ngOnDestroy(): void {
    this.streams.clear();
  }

  private buildStream(sensorId: number): Observable<SensorReading> {
    return new Observable<SensorReading>(subscriber => {
      let closed = false;
      let delay = 1_000;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let ws: WebSocketSubject<WsMessage> | null = null;

      const schedule = () => {
        if (closed) return;
        const wait = delay;
        delay = Math.min(delay * 2, 30_000);
        timer = setTimeout(connect, wait);
      };

      const connect = () => {
        if (closed) return;
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = webSocket<WsMessage>({
          url: `${proto}//${window.location.host}/ws/sensors/${sensorId}`,
          openObserver: { next: () => { delay = 1_000; } },
        });
        ws.subscribe({
          next: (msg) => {
            if (msg.value !== null && msg.timestamp !== null) {
              subscriber.next({
                id: msg.id ?? 0,
                sensor_id: msg.sensor_id,
                value: msg.value,
                timestamp: msg.timestamp,
              });
            }
          },
          error: schedule,
          complete: schedule,
        });
      };

      connect();

      return () => {
        closed = true;
        if (timer !== null) clearTimeout(timer);
        ws?.complete();
        ws = null;
      };
    });
  }
}
