import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { SyncHealthService } from './sync-health.service';
import { SyncHealth, SyncSource } from '../../types/sync-health';

const HEALTHY_SOURCE = {
  derived_status: 'healthy',
  last_status: 'success',
  last_run_started_at: '2026-05-17T10:00:00Z',
  last_run_finished_at: '2026-05-17T10:00:05Z',
  last_success_at: '2026-05-17T10:00:05Z',
  lag_seconds: 30,
  consecutive_failures: 0,
  records_in: 100,
  records_written: 100,
  error_count: 0,
  last_error_kind: null,
  last_error_message: null,
};

const FAILED_NEVER_SOURCE = {
  derived_status: 'failed',
  last_status: null,
  last_run_started_at: null,
  last_run_finished_at: null,
  last_success_at: null,
  lag_seconds: null,
  consecutive_failures: 0,
  records_in: 0,
  records_written: 0,
  error_count: 0,
  last_error_kind: null,
  last_error_message: null,
};

const DEGRADED_SOURCE = {
  ...HEALTHY_SOURCE,
  derived_status: 'degraded',
  last_status: 'partial',
  consecutive_failures: 2,
  error_count: 3,
  last_error_kind: 'sensor_timeout',
  last_error_message: 'Sensor 42 timed out',
};

const FAILED_SOURCE = {
  ...FAILED_NEVER_SOURCE,
  derived_status: 'failed',
  last_success_at: '2026-05-17T08:00:00Z',
  last_error_kind: 'api_error',
  last_error_message: 'upstream 503',
  consecutive_failures: 5,
};

function makePayload(r: object, m: object) {
  return { 'moneo.readings': r, 'moneo.metadata': m };
}

describe('SyncHealthService', () => {
  let service: SyncHealthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [SyncHealthService],
    });
    service = TestBed.inject(SyncHealthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    // Reset the cached stream between tests
    (service as any)._stream = null;
  });

  // ── Adapter tests ─────────────────────────────────────────────────────────

  it('adapts dotted keys and snake_case fields to camelCase', (done) => {
    service.getHealth().subscribe(h => {
      expect(h).not.toBeNull();
      const r = (h as SyncHealth).readings;
      expect(r.derivedStatus).toBe('healthy');
      expect(r.lastStatus).toBe('success');
      expect(r.lagSeconds).toBe(30);
      expect(r.consecutiveFailures).toBe(0);
      expect(r.recordsIn).toBe(100);
      expect(r.recordsWritten).toBe(100);
      expect(r.lastRunStartedAt).toBe('2026-05-17T10:00:00Z');
      expect(r.lastSuccessAt).toBe('2026-05-17T10:00:05Z');
      expect(r.neverSynced).toBe(false);
      done();
    });
    httpMock.expectOne('/api/admin/sync/health').flush(
      makePayload(HEALTHY_SOURCE, HEALTHY_SOURCE),
    );
  });

  it('sets neverSynced=true when derivedStatus=failed AND lastSuccessAt=null', (done) => {
    service.getHealth().subscribe(h => {
      expect((h as SyncHealth).readings.neverSynced).toBe(true);
      done();
    });
    httpMock.expectOne('/api/admin/sync/health').flush(
      makePayload(FAILED_NEVER_SOURCE, HEALTHY_SOURCE),
    );
  });

  it('sets neverSynced=false when failed but lastSuccessAt is not null', (done) => {
    service.getHealth().subscribe(h => {
      expect((h as SyncHealth).readings.neverSynced).toBe(false);
      done();
    });
    httpMock.expectOne('/api/admin/sync/health').flush(
      makePayload(FAILED_SOURCE, HEALTHY_SOURCE),
    );
  });

  // ── Overall calculation matrix ────────────────────────────────────────────

  it('overall: healthy+healthy → healthy', (done) => {
    service.getHealth().subscribe(h => {
      expect((h as SyncHealth).overall).toBe('healthy');
      done();
    });
    httpMock.expectOne('/api/admin/sync/health').flush(
      makePayload(HEALTHY_SOURCE, HEALTHY_SOURCE),
    );
  });

  it('overall: healthy+pending(neverSynced) → healthy (pending does not downgrade)', (done) => {
    service.getHealth().subscribe(h => {
      expect((h as SyncHealth).overall).toBe('healthy');
      done();
    });
    httpMock.expectOne('/api/admin/sync/health').flush(
      makePayload(HEALTHY_SOURCE, FAILED_NEVER_SOURCE),
    );
  });

  it('overall: degraded+healthy → degraded', (done) => {
    service.getHealth().subscribe(h => {
      expect((h as SyncHealth).overall).toBe('degraded');
      done();
    });
    httpMock.expectOne('/api/admin/sync/health').flush(
      makePayload(DEGRADED_SOURCE, HEALTHY_SOURCE),
    );
  });

  it('overall: failed(real)+pending(neverSynced) → failed', (done) => {
    service.getHealth().subscribe(h => {
      expect((h as SyncHealth).overall).toBe('failed');
      done();
    });
    httpMock.expectOne('/api/admin/sync/health').flush(
      makePayload(FAILED_SOURCE, FAILED_NEVER_SOURCE),
    );
  });

  it('overall: pending+pending → pending', (done) => {
    service.getHealth().subscribe(h => {
      expect((h as SyncHealth).overall).toBe('pending');
      done();
    });
    httpMock.expectOne('/api/admin/sync/health').flush(
      makePayload(FAILED_NEVER_SOURCE, FAILED_NEVER_SOURCE),
    );
  });

  // ── HTTP error handling ───────────────────────────────────────────────────

  it('403 → emits null (non-admin signal)', (done) => {
    service.getHealth().subscribe(result => {
      expect(result).toBeNull();
      done();
    });
    httpMock
      .expectOne('/api/admin/sync/health')
      .flush('Forbidden', { status: 403, statusText: 'Forbidden' });
  });

  it('network error → emits synthetic failed health', (done) => {
    service.getHealth().subscribe(h => {
      expect(h).not.toBeNull();
      const health = h as SyncHealth;
      expect(health.overall).toBe('failed');
      expect(health.readings.derivedStatus).toBe('failed');
      expect(health.readings.lastErrorKind).toBe('transport');
      expect(health.readings.neverSynced).toBe(false);
      done();
    });
    httpMock
      .expectOne('/api/admin/sync/health')
      .flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
  });

  it('sets fetchedAt to a recent Date on success', (done) => {
    const before = new Date();
    service.getHealth().subscribe(h => {
      expect((h as SyncHealth).fetchedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      done();
    });
    httpMock.expectOne('/api/admin/sync/health').flush(
      makePayload(HEALTHY_SOURCE, HEALTHY_SOURCE),
    );
  });
});
