import { useEffect, useRef, useState } from 'react';
import type { AccountSession } from '../../shared/community';
import { patchProfile } from '../lib/communityApi';
import { TimezonePicker } from './TimezonePicker';
import { Button } from './ui/Button';
import './profile-setup.css';

export function ProfileSetup({
  session,
  onComplete,
}: {
  session: AccountSession;
  onComplete: () => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  return (
    <main className="profile-setup">
      <form
        className="card card-pad profile-setup-card"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !name.trim()) return;
          const controller = new AbortController();
          request.current = controller;
          setBusy(true);
          setError('');
          try {
            await patchProfile(
              session.accountId,
              {
                displayName: name.trim(),
                trainingTimezone: timezone,
              },
              controller.signal,
            );
            if (!controller.signal.aborted) await onComplete();
          } catch (cause) {
            if (!controller.signal.aborted) setError((cause as Error).message);
          } finally {
            if (!controller.signal.aborted) setBusy(false);
          }
        }}
      >
        <h1>Your profile</h1>
        <p className="muted">Choose the name your friends will see.</p>
        <label className="form-field">
          <span>Display name</span>
          <input
            className="input"
            autoComplete="nickname"
            value={name}
            maxLength={60}
            required
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="form-field">
          <span>Training timezone</span>
          <TimezonePicker value={timezone} onChange={setTimezone} />
          <small className="muted">Detected from your device. Used for workout dates.</small>
        </div>
        <p className="muted small">
          Workouts and stats start private. Share a finished workout to the community feed, or turn
          on profile stats in your profile. Your email, notes and chats stay private.
        </p>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" variant="primary" size="lg" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </main>
  );
}
