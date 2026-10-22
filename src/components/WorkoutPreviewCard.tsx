import type { ReactNode } from 'react';
import { RecordStar } from './PersonalRecords';

/** The same workout preview in personal history and Community. Times use the viewer's locale. */
export function WorkoutPreviewCard({
  title,
  completedAt,
  exerciseCount,
  durationMinutes,
  hasRecord,
  onOpen,
  accessibleName,
  owner,
  action,
}: {
  title: string;
  completedAt: string;
  exerciseCount?: number;
  durationMinutes: number | null;
  hasRecord?: boolean;
  onOpen: () => void;
  accessibleName?: string;
  owner?: ReactNode;
  action?: ReactNode;
}) {
  const date = new Date(completedAt);
  return (
    <article className="card card-pad workout-preview-card">
      {owner && <div className="workout-preview-owner">{owner}</div>}
      <div className="workout-preview-row">
        <button
          className="workout-preview-open"
          onClick={onOpen}
          aria-label={
            accessibleName ??
            `${title}${hasRecord ? ' Personal record achieved in this workout' : ''}`
          }
        >
          <h2>
            {title} {hasRecord && <RecordStar />}
          </h2>
          <time dateTime={completedAt} className="workout-preview-date">
            <span>
              {date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            <span aria-hidden="true"> · </span>
            <span>
              {date.toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short',
              })}
            </span>
          </time>
          <p className="workout-preview-metrics">
            {exerciseCount !== undefined && (
              <span>
                {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
              </span>
            )}
            {durationMinutes !== null && <span>{durationMinutes} min</span>}
          </p>
        </button>
        {action && <div className="workout-preview-action">{action}</div>}
      </div>
    </article>
  );
}
