import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { of } from 'rxjs';
import { SyncStatusBannerComponent } from './sync-status-banner.component';
import { SyncStatusPanelComponent } from '../sync-status-panel/sync-status-panel.component';
import { SyncHealthService } from '../../../core/services/sync-health.service';
import { SyncHealth } from '../../../types/sync-health';

const BASE_SOURCE = {
  derivedStatus: 'healthy' as const,
  lastStatus: 'success' as const,
  lastRunStartedAt: '2026-05-17T10:00:00Z',
  lastRunFinishedAt: '2026-05-17T10:00:05Z',
  lastSuccessAt: '2026-05-17T10:00:05Z',
  lagSeconds: 30,
  consecutiveFailures: 0,
  recordsIn: 100,
  recordsWritten: 100,
  errorCount: 0,
  lastErrorKind: null,
  lastErrorMessage: null,
  neverSynced: false,
};

function makeHealth(overall: SyncHealth['overall'], errorKind: string | null = null): SyncHealth {
  const src = {
    ...BASE_SOURCE,
    derivedStatus: (overall === 'failed' ? 'failed' : overall === 'degraded' ? 'degraded' : 'healthy') as any,
    lastErrorKind: errorKind,
    neverSynced: overall === 'pending',
    lastSuccessAt: overall === 'pending' ? null : BASE_SOURCE.lastSuccessAt,
  };
  return {
    readings: { ...src },
    metadata: { ...src },
    overall,
    fetchedAt: new Date(),
  };
}

function makeSpy(health: SyncHealth | null) {
  const spy = jasmine.createSpyObj<SyncHealthService>('SyncHealthService', [
    'watchHealth', 'getHealth', 'forceRefresh',
  ]);
  spy.watchHealth.and.returnValue(of(health));
  return spy;
}

describe('SyncStatusBannerComponent', () => {
  let fixture: ComponentFixture<SyncStatusBannerComponent>;
  let component: SyncStatusBannerComponent;

  beforeEach(() => sessionStorage.clear());

  function setup(health: SyncHealth | null) {
    const spy = makeSpy(health);
    TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [SyncStatusBannerComponent, SyncStatusPanelComponent],
      providers: [{ provide: SyncHealthService, useValue: spy }],
    }).compileComponents();
    fixture = TestBed.createComponent(SyncStatusBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => sessionStorage.clear());

  it('is hidden when overall=healthy', () => {
    setup(makeHealth('healthy'));
    expect(fixture.nativeElement.querySelector('.sync-error-banner')).toBeNull();
  });

  it('is hidden when overall=degraded', () => {
    setup(makeHealth('degraded'));
    expect(fixture.nativeElement.querySelector('.sync-error-banner')).toBeNull();
  });

  it('is hidden when overall=pending (neverSynced)', () => {
    setup(makeHealth('pending'));
    expect(fixture.nativeElement.querySelector('.sync-error-banner')).toBeNull();
  });

  it('is hidden when health is null (non-admin)', () => {
    setup(null);
    expect(fixture.nativeElement.querySelector('.sync-error-banner')).toBeNull();
  });

  it('is visible when overall=failed', () => {
    setup(makeHealth('failed', 'api_error'));
    expect(fixture.nativeElement.querySelector('.sync-error-banner')).toBeTruthy();
  });

  it('dismiss hides the banner and stores sessionStorage keys', () => {
    setup(makeHealth('failed', 'api_error'));
    expect(fixture.nativeElement.querySelector('.sync-error-banner')).toBeTruthy();

    component.dismiss();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.sync-error-banner')).toBeNull();
    expect(sessionStorage.getItem('sync-banner-dismissed')).toBe('true');
    expect(sessionStorage.getItem('sync-banner-error-sig')).toBeTruthy();
  });

  it('dismissed banner stays hidden when the error signature is unchanged', () => {
    const h = makeHealth('failed', 'api_error');
    sessionStorage.setItem('sync-banner-dismissed', 'true');
    sessionStorage.setItem('sync-banner-error-sig', 'api_error|api_error');
    setup(h);
    expect(fixture.nativeElement.querySelector('.sync-error-banner')).toBeNull();
  });

  it('reappears when the error signature changes', () => {
    // Previously dismissed with a different error kind
    sessionStorage.setItem('sync-banner-dismissed', 'true');
    sessionStorage.setItem('sync-banner-error-sig', 'old_error|old_error');
    setup(makeHealth('failed', 'api_error'));
    // Signature 'api_error|api_error' != 'old_error|old_error' → banner shows
    expect(fixture.nativeElement.querySelector('.sync-error-banner')).toBeTruthy();
  });

  it('"View details" button opens the inline panel', () => {
    setup(makeHealth('failed', 'api_error'));
    const detailsBtn = fixture.nativeElement.querySelector(
      '.sync-error-banner__details-btn',
    ) as HTMLButtonElement;
    detailsBtn.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-sync-status-panel')).toBeTruthy();
  });
});
