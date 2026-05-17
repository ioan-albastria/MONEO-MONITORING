export type DerivedStatus = 'healthy' | 'degraded' | 'failed';
export type LastStatus = 'success' | 'partial' | 'failed' | null;

export interface SyncSource {
  derivedStatus: DerivedStatus;
  lastStatus: LastStatus;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastSuccessAt: string | null;
  lagSeconds: number | null;
  consecutiveFailures: number;
  recordsIn: number;
  recordsWritten: number;
  errorCount: number;
  lastErrorKind: string | null;
  lastErrorMessage: string | null;
  /** True when derived_status='failed' AND last_success_at=null — first-boot, not a real failure. */
  neverSynced: boolean;
}

export interface SyncHealth {
  readings: SyncSource;
  metadata: SyncSource;
  /**
   * Worst of {readings, metadata} effective statuses.
   * A neverSynced source contributes 'pending' (not 'failed') to this calculation.
   */
  overall: DerivedStatus | 'pending';
  fetchedAt: Date;
}
