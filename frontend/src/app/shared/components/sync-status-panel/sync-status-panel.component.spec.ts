import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { SyncStatusPanelComponent } from './sync-status-panel.component';
import { SyncHealthService } from '../../../core/services/sync-health.service';
import { SyncHealth } from '../../../types/sync-health';

const BASE_SOURCE = {
  derivedStatus: 'healthy' as const,
  lastStatus: 'success' as const,
  lastRunStartedAt: '2026-05-17T10:00:00Z',
  lastRunFinishedAt: '2026-05-17T10:00:05Z',
  lastSuccessAt: '2026-05-17T10:00:05Z',
  lagSeconds: 272,
  consecutiveFailures: 3,
  recordsIn: 200,
  recordsWritten: 195,
  errorCount: 5,
  lastErrorKind: null,
  lastErrorMessage: null,
  neverSynced: false,
};

const NEVER_SYNCED_SOURCE = {
  ...BASE_SOURCE,
  derivedStatus: 'failed' as const,
  lastStatus: null,
  lastSuccessAt: null,
  lagSeconds: null,
  lastRunStartedAt: null,
  lastRunFinishedAt: null,
  lastErrorKind: null,
  lastErrorMessage: null,
  neverSynced: true,
};

function makeHealth(overrides: Partial<SyncHealth> = {}): SyncHealth {
  return {
    readings: { ...BASE_SOURCE },
    metadata: { ...BASE_SOURCE },
    overall: 'healthy',
    fetchedAt: new Date('2026-05-17T10:05:00Z'),
    ...overrides,
  };
}

describe('SyncStatusPanelComponent', () => {
  let fixture: ComponentFixture<SyncStatusPanelComponent>;
  let component: SyncStatusPanelComponent;
  let syncHealthSpy: jasmine.SpyObj<SyncHealthService>;

  beforeEach(() => {
    syncHealthSpy = jasmine.createSpyObj<SyncHealthService>('SyncHealthService', [
      'forceRefresh', 'getHealth', 'watchHealth',
    ]);
    TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [SyncStatusPanelComponent],
      providers: [{ provide: SyncHealthService, useValue: syncHealthSpy }],
    }).compileComponents();
    fixture = TestBed.createComponent(SyncStatusPanelComponent);
    component = fixture.componentInstance;
  });

  function render(health: SyncHealth) {
    component.health = health;
    fixture.detectChanges();
  }

  // ── Last success ──────────────────────────────────────────────────────────

  it('renders "Never" when lastSuccessAt is null (not neverSynced source)', () => {
    render(makeHealth({
      readings: { ...BASE_SOURCE, lastSuccessAt: null },
    }));
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Never');
  });

  it('does NOT render "Never" when lastSuccessAt is present', () => {
    render(makeHealth());
    // The italic "Never" text should not appear for the readings source
    const neverEls = (fixture.nativeElement as HTMLElement).querySelectorAll('em');
    const neverTexts = Array.from(neverEls).map(el => el.textContent?.trim());
    expect(neverTexts).not.toContain('Never');
  });

  // ── Lag humanization ──────────────────────────────────────────────────────

  it('renders "—" for lag_seconds=null (NOT "0 seconds")', () => {
    render(makeHealth({
      readings: { ...BASE_SOURCE, lagSeconds: null },
      metadata: { ...BASE_SOURCE, lagSeconds: null },
    }));
    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.sync-panel__row-value'),
    ) as HTMLElement[];
    const texts = rows.map(el => el.textContent?.trim());
    expect(texts.some(t => t === '—')).toBe(true);
    expect(texts.some(t => t === '0 s' || t?.includes('0 seconds'))).toBe(false);
  });

  it('humanizes lag_seconds=272 as "4 m 32 s"', () => {
    expect(component.humanizeLag(272)).toBe('4 m 32 s');
  });

  it('humanizes lag_seconds=7860 as "2 h 11 m"', () => {
    expect(component.humanizeLag(7860)).toBe('2 h 11 m');
  });

  it('humanizes lag_seconds=45 as "45 s"', () => {
    expect(component.humanizeLag(45)).toBe('45 s');
  });

  it('humanizes lag_seconds=null as "—"', () => {
    expect(component.humanizeLag(null)).toBe('—');
  });

  // ── neverSynced block ─────────────────────────────────────────────────────

  it('neverSynced source shows "Awaiting first sync", not the detail rows', () => {
    render(makeHealth({ metadata: { ...NEVER_SYNCED_SOURCE } }));
    const neverSyncedEls = (fixture.nativeElement as HTMLElement)
      .querySelectorAll('.sync-panel__never-synced');
    expect(neverSyncedEls.length).toBeGreaterThan(0);
    const text = neverSyncedEls[0].textContent?.trim();
    expect(text).toContain('Awaiting first sync');
  });

  it('neverSynced source does NOT show a Last error block', () => {
    render(makeHealth({
      metadata: {
        ...NEVER_SYNCED_SOURCE,
        lastErrorKind: null,
        lastErrorMessage: null,
      },
    }));
    // The last error row is hidden when lastErrorKind is null
    // Within the neverSynced branch, the detail rows are entirely hidden
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('.sync-panel__error-text');
    // only readings (non-neverSynced) might show errors; metadata (neverSynced) must not
    expect(rows.length).toBe(0);
  });

  // ── Consecutive failures tooltip ──────────────────────────────────────────

  it('consecutive_failures row has the partial-run tooltip', () => {
    render(makeHealth());
    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[title]'),
    ) as HTMLElement[];
    const tooltipRow = rows.find(el =>
      el.getAttribute('title')?.includes("'partial' runs"),
    );
    expect(tooltipRow).toBeTruthy();
  });

  // ── Error message expand ──────────────────────────────────────────────────

  it('shows "show more" button when error message exceeds 120 chars', () => {
    const longMsg = 'x'.repeat(150);
    render(makeHealth({
      readings: { ...BASE_SOURCE, lastErrorKind: 'api_error', lastErrorMessage: longMsg },
    }));
    const expandBtn = fixture.nativeElement.querySelector('.sync-panel__expand-btn');
    expect(expandBtn).toBeTruthy();
  });

  it('does not show "show more" when error message is ≤ 120 chars', () => {
    render(makeHealth({
      readings: { ...BASE_SOURCE, lastErrorKind: 'api_error', lastErrorMessage: 'short error' },
    }));
    const expandBtn = fixture.nativeElement.querySelector('.sync-panel__expand-btn');
    expect(expandBtn).toBeNull();
  });

  // ── Refresh ───────────────────────────────────────────────────────────────

  it('refresh button calls SyncHealthService.forceRefresh()', () => {
    render(makeHealth());
    const btn = fixture.nativeElement.querySelector('.sync-panel__refresh-btn') as HTMLButtonElement;
    btn.click();
    expect(syncHealthSpy.forceRefresh).toHaveBeenCalled();
  });

  // ── Close ─────────────────────────────────────────────────────────────────

  it('close button emits closePanel event', () => {
    render(makeHealth());
    spyOn(component.closePanel, 'emit');
    const closeBtn = fixture.nativeElement.querySelector('.sync-panel__close-btn') as HTMLButtonElement;
    closeBtn.click();
    expect(component.closePanel.emit).toHaveBeenCalled();
  });
});
