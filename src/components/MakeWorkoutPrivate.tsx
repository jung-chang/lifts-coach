import { useEffect, useRef, useState } from 'react';
import type { AccountSession, WorkoutVisibility } from '../../shared/community';
import { Button } from './ui/Button';

// Server visibility is authoritative: a default or stale local snapshot must never
// undo an individual privacy choice.
export function MakeWorkoutPrivate({
  session,
  workoutId,
  onPrivate,
}: {
  session: AccountSession;
  workoutId: string;
  onPrivate?: () => void;
}) {
  const [choice, setChoice] = useState<WorkoutVisibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current = controller;
    setChoice(null);
    setError('');
    setBusy(false);
    void request('GET', controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setChoice(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not check sharing.');
      });
    return () => controller.abort();
  }, [session.accountId, workoutId, retry]);

  async function request(method: 'GET' | 'PUT', signal?: AbortSignal) {
    const response = await fetch(`/api/me/workouts/${encodeURIComponent(workoutId)}/visibility`, {
      method,
      cache: 'no-store',
      signal,
      headers: { 'Content-Type': 'application/json', 'X-Lifts-Account': session.accountId },
      ...(method === 'PUT'
        ? {
            body: JSON.stringify({
              visibility: 'private',
              decisionRevision: choice!.decisionRevision,
              policyRevision: session.sharing.policyRevision,
            }),
          }
        : {}),
    });
    if (!response.ok) throw new Error('Sharing could not be updated. Refresh and try again.');
    const body = (await response.json()) as WorkoutVisibility;
    if (
      !['private', 'community'].includes(body.visibility) ||
      !Number.isInteger(body.decisionRevision)
    )
      throw new Error('Unexpected visibility response.');
    return body;
  }
  return (
    <>
      {choice?.visibility === 'community' && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            const controller = activeRequest.current!;
            try {
              const next = await request('PUT', controller.signal);
              if (controller.signal.aborted) return;
              setChoice(next);
              onPrivate?.();
            } catch {
              if (!controller.signal.aborted)
                setError('Could not make private. Refresh and try again.');
            } finally {
              if (!controller.signal.aborted) setBusy(false);
            }
          }}
        >
          Make private
        </Button>
      )}
      {error && (
        <div role="alert" className="small">
          {error}{' '}
          <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </Button>
        </div>
      )}
    </>
  );
}
