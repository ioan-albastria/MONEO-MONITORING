import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { of } from 'rxjs';
import { SyncStatusIndicatorComponent } from './sync-status-indicator.component';
import { SyncStatusPanelComponent } from '../sync-status-panel/sync-status-panel.component';
import { SyncHealthService } from '../../../core/services/sync-health.service';
import { SyncHealth } from '../../../types/sync-health';

const HEALTHY_HEALTH: SyncHealth = {
  readings: {
    derivedStatus: 'healthy', lastStatus: 'success',
    lastRunStartedAt: '2026-05-17T10:00:00Z', lastRunFinishedAt: '2026-05-17T10:00:05Z',
    lastSuccessAt: '2026-05-17T10:00:05Z', lagSeconds: 30,
    consecutiveFailures: 0, recordsIn: 100, recordsWritten: 100,
    errorCount: 0, lastErrorKind: null, lastErrorMessage: null, neverSynced: false,
  },
  metadata: {
    derivedStatus: 'healthy', lastStatus: 'success',
    lastRunStartedAt: '2026-05-17T10:00:00Z', lastRunFinishedAt: '2026-05-17T10:00:05Z',
    lastSuccessAt: '2026-05-17T10:00:05Z', lagSeconds: 30,
    consecutiveFailures: 0, recordsIn: 50, recordsWritten: 50,
    errorCount: 0, lastErrorKind: null, lastErrorMessage: null, neverSynced: false,
  },
  overall: 'healthy',
  fetchedAt: new Date(),
};

const PENDING_HEALTH: SyncHealth = {
  ...HEALTHY_HEALTH,
  readings: { ...HEALTHY_HEALTH.readings, derivedStatus: 'failed', lastSuccessAt: null, neverSynced: true },
  metadata: { ...HEALTHY_HEALTH.metadata, derivedStatus: 'failed', lastSuccessAt: null, neverSynced: true },
  overall: 'pending',
};

const FAILED_HEALTH: SyncHealth = {
  ...HEALTHY_HEALTH,
  readings: { ...HEALTHY_HEALTH.readings, derivedStatus: 'failed', lastErrorKind: 'api_error', neverSynced: false },
  metadata: { ...HEALTHY_HEALTH.metadata, derivedStatus: 'failed', lastErrorKind: 'api_error', neverSynced: false },
  overall: 'failed',
};

function makeSpy(health: SyncHealth | null) {
  const spy = jasmine.createSpyObj<SyncHealthService>('SyncHealthService', [
    'watchHealth', 'getHealth', 'forceRefresh',
  ]);
  spy.watchHealth.and.returnValue(of(health));
  return spy;
}

describe('SyncStatusIndicatorComponent', () => {
  let fixture: ComponentFixture<SyncStatusIndicatorComponent>;
  let component: SyncStatusIndicatorComponent;

  function setup(health: SyncHealth | null) {
    const spy = makeSpy(health);
    TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [SyncStatusIndicatorComponent, SyncStatusPanelComponent],
      providers: [{ provide: SyncHealthService, useValue: spy }],
    }).compileComponents();
    fixture = TestBed.createComponent(SyncStatusIndicatorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('renders nothing when health is null (non-admin)', () => {
    setup(null);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.sync-indicator-wrapper')).toBeNull();
    expect(el.querySelector('button')).toBeNull();
  });

  it('shows green dot for overall=healthy', () => {
    setup(HEALTHY_HEALTH);
    const dot = fixture.nativeElement.querySelector('.sync-dot') as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.classList).toContain('sync-dot--ok');
  });

  it('shows amber dot for overall=degraded', () => {
    const degraded: SyncHealth = { ...HEALTHY_HEALTH, overall: 'degraded' };
    setup(degraded);
    const dot = fixture.nativeElement.querySelector('.sync-dot') as HTMLElement;
    expect(dot.classList).toContain('sync-dot--warn');
  });

  it('shows red dot for overall=failed', () => {
    setup(FAILED_HEALTH);
    const dot = fixture.nativeElement.querySelector('.sync-dot') as HTMLElement;
    expect(dot.classList).toContain('sync-dot--error');
  });

  it('shows muted dot and "Awaiting first sync" label for overall=pending', () => {
    setup(PENDING_HEALTH);
    const dot = fixture.nativeElement.querySelector('.sync-dot') as HTMLElement;
    expect(dot.classList).toContain('sync-dot--pending');
    const label = fixture.nativeElement.querySelector('.sync-label') as HTMLElement;
    expect(label.textContent?.trim()).toBe('Awaiting first sync');
  });

  it('panel is hidden initially', () => {
    setup(HEALTHY_HEALTH);
    expect(fixture.nativeElement.querySelector('app-sync-status-panel')).toBeNull();
  });

  it('clicking the pill opens the panel', () => {
    setup(HEALTHY_HEALTH);
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    // Non-bubbling click: fires Angular's (click) binding without triggering
    // the document:click HostListener that would otherwise immediately close the panel.
    btn.dispatchEvent(new MouseEvent('click', { bubbles: false }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-sync-status-panel')).toBeTruthy();
  });

  it('pressing Enter on the pill opens the panel', () => {
    setup(HEALTHY_HEALTH);
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-sync-status-panel')).toBeTruthy();
  });

  it('pressing Escape closes an open panel', () => {
    setup(HEALTHY_HEALTH);
    component.isPanelOpen = true;
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(component.isPanelOpen).toBe(false);
  });

  it('button has aria-haspopup="dialog"', () => {
    setup(HEALTHY_HEALTH);
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
  });
});
