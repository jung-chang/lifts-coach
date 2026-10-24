import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from './ui/Button';

/** Personal instructions are saved explicitly and never replace session feedback. */
export function PersistentExerciseNote({
  name,
  snapshotNote,
  personalNote,
  onSave,
}: {
  name: string;
  snapshotNote?: string;
  personalNote?: string;
  onSave: (note: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="persistent-exercise-note" aria-label="Saved exercise instructions">
      <div className="row space-between">
        <span className="small muted">Exercise instructions</span>
        {!open && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit exercise instructions"
            title="Edit exercise instructions"
            onClick={() => {
              setValue(personalNote ?? '');
              setError('');
              setOpen(true);
            }}
          >
            <Pencil size={16} aria-hidden="true" />
          </Button>
        )}
      </div>
      {open ? (
        <div className="stack">
          <label className="form-field">
            Exercise instructions for {name}
            <textarea
              className="textarea"
              rows={3}
              maxLength={2000}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={saving}
              autoFocus
            />
          </label>
          <p className="muted small">
            Saved across routines and in this workout. Previous workouts stay unchanged.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="row">
            <Button
              variant="primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setError('');
                try {
                  if (await onSave(value)) setOpen(false);
                  else setError('Could not save instructions. Please try again.');
                } catch {
                  setError('Could not save instructions. Please try again.');
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Saving…' : 'Save instructions'}
            </Button>
            <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : snapshotNote?.trim() ? (
        <p className="multiline">{snapshotNote}</p>
      ) : (
        <p className="muted small">Add cues, pauses or set instructions.</p>
      )}
    </section>
  );
}
