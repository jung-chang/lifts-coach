import { useEffect, useRef, useState } from 'react';
import type { AccountSession, WorkoutVisibility } from '../../shared/community';
import type { Workout } from '../../shared/types';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';

type Props = {
  session: AccountSession | null;
  workout: Workout;
  synced: boolean;
  onLocalChange: (visibility: 'private' | 'community') => void | Promise<boolean>;
};

export function WorkoutVisibilityControl({ session, workout, synced, onLocalChange }: Props) {
  const [choice, setChoice] = useState<WorkoutVisibility>({
    visibility: 'private',
    decisionRevision: 0,
  });
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(workout.status === 'active');
  const generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current;
    setChoice({ visibility: 'private', decisionRevision: 0 });
    setError('');
    setBusy(false);
    setReview(false);
    setLoaded(workout.status === 'active');
    if (!session || workout.status !== 'finished' || !synced || !navigator.onLine) return;
    const controller = new AbortController();
    void fetch(`/api/me/workouts/${encodeURIComponent(workout.id)}/visibility`, {
      headers: { 'X-Lifts-Account': session.accountId },
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load workout visibility. Retry when synced.');
        const body = (await r.json()) as WorkoutVisibility;
        if (!controller.signal.aborted && ticket === generation.current) {
          setChoice(body);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [session?.accountId, workout.id, workout.status, synced]);
  const current =
    workout.status === 'active'
      ? (workout.communityVisibility?.visibility ?? 'private')
      : choice.visibility;
  const apply = async (visibility: 'private' | 'community') => {
    if (!session) return;
    const ticket = generation.current;
    setBusy(true);
    setError('');
    try {
      if (workout.status === 'active') {
        if ((await onLocalChange(visibility)) === false)
          throw new Error('Visibility could not be saved. Please retry.');
      } else {
        const response = await fetch(
          `/api/me/workouts/${encodeURIComponent(workout.id)}/visibility`,
          {
            method: 'PUT',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'X-Lifts-Account': session.accountId },
            body: JSON.stringify({
              visibility,
              decisionRevision: choice.decisionRevision,
              policyRevision: session.sharing.policyRevision,
              audienceAcknowledged: visibility === 'community',
            }),
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 409
              ? 'Sharing changed on another device. Reopen this workout before trying again.'
              : 'Sharing could not be updated. Your previous visibility still applies.',
          );
        const next = (await response.json()) as WorkoutVisibility;
        if (ticket !== generation.current) return;
        setChoice(next);
      }
      setReview(false);
    } catch (e) {
      if (ticket === generation.current) setError((e as Error).message);
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  };
  return (
    <div className="workout-visibility">
      <div className="row space-between">
        <div>
          <b>Workout visibility</b>
          <p className="muted small">
            {current === 'community' ? 'Community · completed exercises and sets' : 'Only me'}
          </p>
        </div>
        <Button
          size="sm"
          disabled={
            !session ||
            busy ||
            !loaded ||
            (workout.status === 'finished' && (!synced || !navigator.onLine))
          }
          onClick={() => (current === 'community' ? void apply('private') : setReview(true))}
        >
          {current === 'community' ? 'Make private' : 'Share workout'}
        </Button>
      </div>
      {!session && <p className="muted small">Sign in to choose community sharing.</p>}
      {workout.status === 'finished' && !synced && (
        <p className="muted small">Sync this workout before changing its community visibility.</p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <Sheet
        open={review}
        onOpenChange={setReview}
        title="Share with the community?"
        description="All active Lifts Coach members can see your name, workout date, exercise names and completed sets, including loads and reps. Notes and Coach conversations stay private."
      >
        <h3>{workout.name}</h3>
        <ul className="sharing-exercise-preview">
          {workout.exercises.map((e) => (
            <li key={e.id}>{e.name}</li>
          ))}
        </ul>
        <p className="muted small">
          {workout.status === 'active'
            ? 'This workout will appear only after finishing and syncing.'
            : 'This includes the historical date and performance of this workout.'}{' '}
          If full-history summaries are enabled, making this workout private later does not remove
          its contribution from those summaries.
        </p>
        <div className="sheet-actions">
          <Button onClick={() => setReview(false)}>Keep private</Button>
          <Button variant="primary" disabled={busy} onClick={() => void apply('community')}>
            Share workout
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
