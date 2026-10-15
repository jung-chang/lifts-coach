import type { AppData } from '../../shared/types';
import { Button } from './ui/Button';

export type SyncDetailsProps = {
  syncStatus: 'local' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';
  pendingCount: number;
  lastSyncedAt: string | null;
  localData: AppData;
  conflict: { revision: number; data: AppData } | null;
  onRetry: () => void;
  onResolveConflict: (choice: 'local' | 'remote') => void;
};

function latestWorkoutUpdate(data: AppData): string | null {
  return data.workouts.reduce<string | null>(
    (latest, workout) =>
      !latest || Date.parse(workout.updatedAt) > Date.parse(latest) ? workout.updatedAt : latest,
    null,
  );
}

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function CopySummary({ label, data }: { label: string; data: AppData }) {
  return (
    <div className="sync-copy-summary" aria-label={`${label} data summary`}>
      <h4>{label}</h4>
      <div className="muted small">
        {data.routines.length} routines · {data.workouts.length} workouts
      </div>
      <div className="muted small">
        Most recent workout update: {formatDate(latestWorkoutUpdate(data))}
      </div>
    </div>
  );
}

/** Compact sync status and explicit local/remote conflict resolution controls. */
export function SyncDetails({
  syncStatus,
  pendingCount,
  lastSyncedAt,
  localData,
  conflict,
  onRetry,
  onResolveConflict,
}: SyncDetailsProps) {
  return (
    <section className="stack" aria-label="Sync details">
      <div className="row sync-status-row">
        <div>
          <div>
            <strong>Last successful sync</strong>{' '}
            <span className="muted">{formatDate(lastSyncedAt)}</span>
          </div>
          <div className="muted small">
            {pendingCount} pending {pendingCount === 1 ? 'change' : 'changes'}
          </div>
        </div>
        {syncStatus !== 'synced' && syncStatus !== 'conflict' && (
          <Button onClick={onRetry} disabled={syncStatus === 'syncing'}>
            Retry sync
          </Button>
        )}
      </div>
      {conflict && (
        <div className="stack" aria-live="polite">
          <p>
            Another device has a different copy. Compare the summaries and choose which copy to
            keep.
          </p>
          <div className="sync-copy-grid">
            <CopySummary label="This device" data={localData} />
            <CopySummary label="Other device" data={conflict.data} />
          </div>
          <div className="row">
            <Button onClick={() => onResolveConflict('local')}>Keep this device</Button>
            <Button variant="primary" onClick={() => onResolveConflict('remote')}>
              Use other copy
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export default SyncDetails;
