import { useId, useState } from 'react';
import { id } from '../../shared/domain';
import type { Exercise } from '../../shared/types';
import { Button } from './ui/Button';

export function CreateExercise({
  initialName,
  onSave,
  onCancel,
}: {
  initialName: string;
  onSave: (exercise: Exercise) => Promise<boolean>;
  onCancel: () => void;
}) {
  const prefix = useId();
  const [name, setName] = useState(initialName);
  const [equipment, setEquipment] = useState('');
  const [muscles, setMuscles] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loadMode, setLoadMode] = useState<Exercise['loadMode']>('external');
  const [region, setRegion] = useState<Exercise['region']>('upper');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="stack routine-custom-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const primaryMuscles = muscles
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (!name.trim() || !equipment.trim() || !primaryMuscles.length || !instructions.trim()) {
          setError('Complete all exercise details.');
          return;
        }
        setBusy(true);
        setError('');
        try {
          const saved = await onSave({
            id: id('custom'),
            name: name.trim(),
            equipment: equipment.trim(),
            muscles: primaryMuscles,
            instructions: instructions.trim(),
            loadMode,
            region,
            custom: true,
          });
          if (!saved) setError('Could not save the exercise. Please try again.');
        } catch {
          setError('Could not save the exercise. Please try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted small">
        Save to your exercise library and use for today. Your saved routine stays unchanged.
      </p>
      <div className="profile-grid">
        {(
          [
            ['name', 'Exercise name', name, setName],
            ['equipment', 'Equipment', equipment, setEquipment],
            ['muscles', 'Primary muscles', muscles, setMuscles],
          ] as const
        ).map(([key, label, value, setValue]) => (
          <div className="form-field" key={key}>
            <label htmlFor={`${prefix}-${key}`}>{label}</label>
            <input
              id={`${prefix}-${key}`}
              className="input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus={key === 'name'}
              disabled={busy}
              placeholder={key === 'muscles' ? 'Chest, triceps' : undefined}
            />
          </div>
        ))}
        <div className="form-field">
          <label htmlFor={`${prefix}-load`}>Load type</label>
          <select
            id={`${prefix}-load`}
            className="select"
            value={loadMode}
            onChange={(event) => setLoadMode(event.target.value as Exercise['loadMode'])}
            disabled={busy}
          >
            <option value="external">External load</option>
            <option value="per-dumbbell">Per dumbbell</option>
            <option value="bodyweight">Bodyweight</option>
            <option value="assistance">Assistance</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${prefix}-region`}>Body region</label>
          <select
            id={`${prefix}-region`}
            className="select"
            value={region}
            onChange={(event) => setRegion(event.target.value as Exercise['region'])}
            disabled={busy}
          >
            <option value="upper">Upper body</option>
            <option value="lower">Lower body</option>
            <option value="full">Full body</option>
          </select>
        </div>
      </div>
      <div className="form-field">
        <label htmlFor={`${prefix}-instructions`}>Instructions</label>
        <textarea
          id={`${prefix}-instructions`}
          className="textarea"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          disabled={busy}
        />
      </div>
      {error && (
        <p role="alert" className="routine-validation">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        <Button type="button" onClick={onCancel} disabled={busy}>
          Back to library
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Create and switch'}
        </Button>
      </div>
    </form>
  );
}
