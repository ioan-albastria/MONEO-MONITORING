import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  EMPTY,
  Observable,
  Subject,
  fromEvent,
  merge,
  of,
  timer,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';
import { DerivedStatus, SyncHealth, SyncSource } from '../../types/sync-health';

interface RawSource {
  derived_status: string;
  last_status: string | null;
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_success_at: string | null;
  lag_seconds: number | null;
  consecutive_failures: number;
  records_in: number;
  records_written: number;
  error_count: number;
  last_error_kind: string | null;
  last_error_message: string | null;
}

interface RawPayload {
  'moneo.readings': RawSource;
  'moneo.metadata': RawSource;
}

@Injectable({ providedIn: 'root' })
export class SyncHealthService {
  private _stream: Observable<SyncHealth | null> | null = null;
  private readonly _manualRefresh$ = new Subject<void>();

  constructor(private readonly http: HttpClient) {}

  getHealth(): Observable<SyncHealth | null> {
    return this.http.get<RawPayload>('/api/admin/sync/health').pipe(
      map(raw => this._adapt(raw)),
      catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse) {
          if (err.status === 403) return of(null);
          if (err.status === 401) return EMPTY;
          return of(this._syntheticFailed(`HTTP ${err.status}: ${err.statusText}`));
        }
        const msg = err instanceof Error ? err.message : 'Network error';
        return of(this._syntheticFailed(msg));
      }),
    );
  }

  watchHealth(intervalMs = 30_000): Observable<SyncHealth | null> {
    if (!this._stream) {
      const visibility$ = fromEvent(document, 'visibilitychange').pipe(
        startWith(null as Event | null),
        map(() => !document.hidden),
        distinctUntilChanged(),
      );

      this._stream = visibility$.pipe(
        switchMap(visible =>
          visible
            ? merge(timer(0, intervalMs), this._manualRefresh$).pipe(
                switchMap(() => this.getHealth()),
              )
            : EMPTY,
        ),
        shareReplay(1),
      );
    }
    return this._stream;
  }

  forceRefresh(): void {
    this._manualRefresh$.next();
  }

  private _adapt(raw: RawPayload): SyncHealth {
    const readings = this._adaptSource(raw['moneo.readings']);
    const metadata = this._adaptSource(raw['moneo.metadata']);
    return {
      readings,
      metadata,
      overall: this._computeOverall(readings, metadata),
      fetchedAt: new Date(),
    };
  }

  private _adaptSource(raw: RawSource): SyncSource {
    const neverSynced =
      raw.derived_status === 'failed' && raw.last_success_at === null;
    return {
      derivedStatus: raw.derived_status as DerivedStatus,
      lastStatus: raw.last_status as SyncSource['lastStatus'],
      lastRunStartedAt: raw.last_run_started_at,
      lastRunFinishedAt: raw.last_run_finished_at,
      lastSuccessAt: raw.last_success_at,
      lagSeconds: raw.lag_seconds,
      consecutiveFailures: raw.consecutive_failures,
      recordsIn: raw.records_in,
      recordsWritten: raw.records_written,
      errorCount: raw.error_count,
      lastErrorKind: raw.last_error_kind,
      lastErrorMessage: raw.last_error_message,
      neverSynced,
    };
  }

  private _computeOverall(
    a: SyncSource,
    b: SyncSource,
  ): SyncHealth['overall'] {
    const rank = (s: SyncSource): number => {
      if (s.neverSynced) return 0;
      if (s.derivedStatus === 'healthy') return 1;
      if (s.derivedStatus === 'degraded') return 2;
      return 3;
    };
    const max = Math.max(rank(a), rank(b));
    if (max === 0) return 'pending';
    if (max === 1) return 'healthy';
    if (max === 2) return 'degraded';
    return 'failed';
  }

  private _syntheticFailed(errorMessage: string): SyncHealth {
    const src: SyncSource = {
      derivedStatus: 'failed',
      lastStatus: null,
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastSuccessAt: null,
      lagSeconds: null,
      consecutiveFailures: 0,
      recordsIn: 0,
      recordsWritten: 0,
      errorCount: 1,
      lastErrorKind: 'transport',
      lastErrorMessage: errorMessage,
      neverSynced: false,
    };
    return {
      readings: src,
      metadata: { ...src },
      overall: 'failed',
      fetchedAt: new Date(),
    };
  }
}
