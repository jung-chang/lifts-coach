import { useEffect, useState } from 'react';
import { fromDisplayWeight, toDisplayWeight } from '../../shared/domain';
import type { WorkoutExercise, WorkoutSet } from '../../shared/types';
import { loadModeLabel } from './LoadSemantics';

type Unit = 'lb' | 'kg';
type Field = 'weight' | 'reps';
type InputDraft = { value: string; unit?: Unit; submitted?: boolean };
type Drafts = Record<string, Partial<Record<Field, InputDraft>>>;
type Props = {
  exercise: WorkoutExercise;
  unit: Unit;
  onEdit: (set: WorkoutSet, patch: Partial<WorkoutSet>) => void;
  onDone: (setId: string, done: boolean, patch?: Partial<WorkoutSet>) => void;
};

function parseInput(field: Field, value: string, unit: Unit): number | null {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number < 0) return null;
  if (field === 'reps') return Number.isInteger(number) && number <= 1000 ? number : null;
  try {
    const pounds = fromDisplayWeight(number, unit);
    return pounds <= 2000 ? pounds : null;
  } catch {
    return null;
  }
}

export function SetTable({ exercise, unit, onEdit, onDone }: Props) {
  // Persisted values come directly from props. Only actual input edits enter
  // this buffer; an acknowledged edit therefore cannot mask later Undo/sync.
  const [drafts, setDrafts] = useState<Drafts>({});
  useEffect(() => {
    const focusedKey = document.activeElement?.getAttribute('data-set-input');
    setDrafts((old) => {
      const next: Drafts = {};
      let changed = false;
      for (const [setId, fields] of Object.entries(old)) {
        const set = exercise.actualSets.find((item) => item.id === setId);
        if (!set) {
          changed = true;
          continue;
        }
        for (const field of ['weight', 'reps'] as const) {
          const input = fields[field];
          if (!input) continue;
          // A load entered in pounds must never be interpreted as kilograms.
          // Changing display units explicitly returns load inputs to stored data.
          if (field === 'weight' && input.unit !== unit) {
            changed = true;
            continue;
          }
          const parsed = parseInput(field, input.value, unit);
          if (
            parsed !== null &&
            parsed === set[field] &&
            (input.submitted || focusedKey !== `${setId}-${field}`)
          ) {
            changed = true;
            continue;
          }
          next[setId] = { ...next[setId], [field]: input };
        }
      }
      return changed ? next : old;
    });
  }, [exercise.actualSets, unit]);

  const inputFor = (set: WorkoutSet, field: Field) => {
    const input = drafts[set.id]?.[field];
    return field === 'weight' && input?.unit !== unit ? undefined : input;
  };
  const valueFor = (set: WorkoutSet, field: Field) =>
    inputFor(set, field)?.value ??
    String(field === 'weight' ? toDisplayWeight(set.weight, unit) : set.reps);
  const parsedFor = (set: WorkoutSet, field: Field) => {
    const input = inputFor(set, field);
    // Pristine kg display is rounded, so never convert it back into a new load.
    if (input) return parseInput(field, input.value, unit);
    const value = set[field];
    return Number.isFinite(value) &&
      value >= 0 &&
      (field === 'weight' ? value <= 2000 : Number.isInteger(value) && value <= 1000)
      ? value
      : null;
  };
  const changeInput = (set: WorkoutSet, field: Field, value: string) => {
    setDrafts((old) => ({
      ...old,
      [set.id]: {
        ...old[set.id],
        [field]: { value, ...(field === 'weight' ? { unit } : {}) },
      },
    }));
  };
  const commit = (set: WorkoutSet, field: Field) => {
    const input = inputFor(set, field);
    if (!input) return;
    const parsed = parseInput(field, input.value, unit);
    if (parsed === null) return;
    setDrafts((old) => {
      const current = old[set.id]?.[field];
      if (!current || current.value !== input.value || current.unit !== input.unit) return old;
      const fields = { ...old[set.id] };
      if (parsed === set[field]) delete fields[field];
      else fields[field] = { ...input, submitted: true };
      return { ...old, [set.id]: fields };
    });
    if (parsed !== set[field]) onEdit(set, { [field]: parsed });
  };

  const invalidCount = exercise.actualSets.filter(
    (set) => parsedFor(set, 'weight') === null || parsedFor(set, 'reps') === null,
  ).length;
  const count = { working: 0, warmup: 0 };
  return (
    <div className="workout-table-card">
      <table className="compact-set-table" aria-label={`${exercise.name} sets`}>
        <thead>
          <tr>
            <th className="tablecolset">Set</th>
            <th className="tablecolload">
              {loadModeLabel(exercise.loadMode)} ({unit})
            </th>
            <th className="tablecolreps">Reps</th>
            <th className="tablecoldone">Done</th>
          </tr>
        </thead>
        <tbody>
          {exercise.actualSets.map((set) => {
            const ordinal = set.kind === 'warmup' ? `W${++count.warmup}` : `${++count.working}`;
            const weightValid = parsedFor(set, 'weight') !== null;
            const repsValid = parsedFor(set, 'reps') !== null;
            const invalid = !weightValid || !repsValid;
            const mode = set.loadMode || exercise.loadMode;
            const done = (checked: boolean) => {
              if (checked && invalid) return;
              const patch: Partial<WorkoutSet> = {};
              if (checked) {
                for (const field of ['weight', 'reps'] as const) {
                  const parsed = parsedFor(set, field);
                  if (inputFor(set, field) && parsed !== null && parsed !== set[field])
                    patch[field] = parsed;
                }
              }
              if (Object.keys(patch).length) onDone(set.id, checked, patch);
              else onDone(set.id, checked);
            };
            return (
              <tr
                key={set.id}
                className={
                  set.status === 'completed'
                    ? 'set-row-completed'
                    : set.status === 'skipped'
                      ? 'set-row-skipped'
                      : ''
                }
              >
                <th scope="row" className="tablecolset">
                  {ordinal}
                </th>
                <td className="tablecolload">
                  {mode !== exercise.loadMode && (
                    <span className="set-table-mode-hint">{loadModeLabel(mode)}</span>
                  )}
                  <input
                    data-set-input={`${set.id}-weight`}
                    className="input"
                    aria-label={`Set ${ordinal} load`}
                    aria-invalid={!weightValid}
                    inputMode="decimal"
                    type="text"
                    value={valueFor(set, 'weight')}
                    onChange={(event) => changeInput(set, 'weight', event.target.value)}
                    onBlur={() => commit(set, 'weight')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </td>
                <td className="tablecolreps">
                  <input
                    data-set-input={`${set.id}-reps`}
                    className="input"
                    aria-label={`Set ${ordinal} reps`}
                    aria-invalid={!repsValid}
                    inputMode="numeric"
                    type="text"
                    value={valueFor(set, 'reps')}
                    onChange={(event) => changeInput(set, 'reps', event.target.value)}
                    onBlur={() => commit(set, 'reps')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </td>
                <td className="tablecoldone">
                  <label className="set-done-control" aria-label={`Set ${ordinal} done`}>
                    <input
                      aria-label={`Set ${ordinal} done`}
                      type="checkbox"
                      disabled={invalid && set.status !== 'completed'}
                      checked={set.status === 'completed'}
                      onChange={(event) => done(event.target.checked)}
                    />
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {invalidCount > 0 && (
        <div className="set-table-validation" role="status">
          Check load and reps before marking Done.
        </div>
      )}
    </div>
  );
}
