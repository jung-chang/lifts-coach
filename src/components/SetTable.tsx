import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import { fromDisplayWeight, toDisplayWeight } from '../../shared/domain';
import type { WorkoutExercise, WorkoutSet } from '../../shared/types';
import { loadModeLabel } from './LoadSemantics';

type Unit = 'lb' | 'kg';
type Field = 'weight' | 'reps';
type InputDraft = { value: string; unit?: Unit; submitted?: boolean };
type Drafts = Record<string, Partial<Record<Field, InputDraft>>>;
const DELETE_WIDTH = 80;
type Props = {
  exercise: WorkoutExercise;
  unit: Unit;
  onEdit: (set: WorkoutSet, patch: Partial<WorkoutSet>) => void;
  onDone: (setId: string, done: boolean, patch?: Partial<WorkoutSet>) => void;
  onAdd?: () => void;
  onRemove?: (setId: string) => void;
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

export function SetTable({ exercise, unit, onEdit, onDone, onAdd, onRemove }: Props) {
  // Persisted values come directly from props. Only actual input edits enter
  // this buffer; an acknowledged edit therefore cannot mask later Undo/sync.
  const [drafts, setDrafts] = useState<Drafts>({});
  const [deleteRow, setDeleteRow] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; offset: number } | null>(null);
  const gesture = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    dx: number;
    horizontal: boolean;
    offset: number;
  } | null>(null);
  const pointerFocus = useRef(false);
  const swiped = useRef<string | null>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      pointerFocus.current = true;
      if (!(event.target instanceof Element) || !event.target.closest('[data-swipe-open="true"]'))
        setDeleteRow(null);
    };
    const keyboardFocus = () => {
      pointerFocus.current = false;
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', keyboardFocus, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', keyboardFocus, true);
    };
  }, []);
  useEffect(() => {
    setDeleteRow(null);
    setDrag(null);
    gesture.current = null;
  }, [exercise.id]);
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
      <table
        className={`compact-set-table${onRemove ? ' swipe-set-table' : ''}`}
        aria-label={`${exercise.name} sets`}
      >
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
            const offset =
              drag?.id === set.id ? drag.offset : deleteRow === set.id ? -DELETE_WIDTH : 0;
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
                tabIndex={onRemove ? 0 : undefined}
                aria-label={onRemove ? `Set ${ordinal} actions` : undefined}
                data-swipe-open={deleteRow === set.id}
                data-dragging={drag?.id === set.id}
                style={
                  onRemove
                    ? ({ touchAction: 'pan-y', '--set-offset': `${offset}px` } as CSSProperties)
                    : undefined
                }
                onFocus={(event) => {
                  if (onRemove && !pointerFocus.current && event.target === event.currentTarget)
                    setDeleteRow(set.id);
                  else if (
                    (event.target as Element).matches('input:not([type="checkbox"]), select')
                  )
                    setDeleteRow(null);
                }}
                onKeyDown={(event) => {
                  pointerFocus.current = false;
                  if (onRemove && event.target === event.currentTarget && event.key === 'Delete') {
                    event.preventDefault();
                    onRemove(set.id);
                    setDeleteRow(null);
                  }
                  if (event.key === 'Escape') setDeleteRow(null);
                }}
                onPointerDownCapture={(event) => {
                  pointerFocus.current = true;
                  swiped.current = null;
                  gesture.current = null;
                  setDrag(null);
                  if (!onRemove || event.button !== 0 || event.isPrimary === false) return;
                  // Text editing owns its gestures; Done can initiate a deliberate swipe.
                  if (
                    (event.target as Element).closest(
                      'input:not([type="checkbox"]), button, select, textarea, a',
                    )
                  ) {
                    return;
                  }
                  gesture.current = {
                    id: set.id,
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    dx: 0,
                    horizontal: false,
                    offset: deleteRow === set.id ? -DELETE_WIDTH : 0,
                  };
                }}
                onPointerMove={(event) => {
                  const start = gesture.current;
                  if (!start || start.id !== set.id || start.pointerId !== event.pointerId) return;
                  const dx = event.clientX - start.x,
                    dy = event.clientY - start.y;
                  if (!start.horizontal && Math.abs(dy) >= 10 && Math.abs(dy) * 2 >= Math.abs(dx)) {
                    gesture.current = null;
                  } else if (Math.abs(dx) >= 16 && Math.abs(dx) > Math.abs(dy) * 2) {
                    if (!start.horizontal) event.currentTarget.setPointerCapture?.(event.pointerId);
                    start.horizontal = true;
                  }
                  if (start.horizontal) {
                    start.dx = Math.max(-DELETE_WIDTH, Math.min(0, start.offset + dx));
                    swiped.current = set.id;
                    setDrag({ id: set.id, offset: start.dx });
                    event.preventDefault();
                  }
                }}
                onPointerUp={(event) => {
                  const start = gesture.current;
                  if (start?.id === set.id && start.pointerId === event.pointerId) {
                    if (start.horizontal)
                      setDeleteRow(start.dx <= -DELETE_WIDTH / 2 ? set.id : null);
                  }
                  setDrag(null);
                  gesture.current = null;
                }}
                onPointerCancel={() => {
                  gesture.current = null;
                  swiped.current = null;
                  setDrag(null);
                }}
                onLostPointerCapture={(event) => {
                  // A child loses implicit touch capture when the row takes over the swipe.
                  if (event.target !== event.currentTarget) return;
                  gesture.current = null;
                  setDrag(null);
                }}
                onClickCapture={(event) => {
                  if (swiped.current === set.id && event.detail > 0) {
                    event.preventDefault();
                    event.stopPropagation();
                    swiped.current = null;
                  } else if (!(event.target as Element).closest('button, input, label, select')) {
                    setDeleteRow(null);
                  }
                }}
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
                  {mode !== exercise.loadMode &&
                    !['bodyweight', 'assistance'].includes(exercise.loadMode) && (
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
                  {['bodyweight', 'assistance'].includes(exercise.loadMode) && (
                    <select
                      className="select set-load-mode"
                      aria-label={`Set ${ordinal} load mode`}
                      value={mode}
                      onChange={(event) =>
                        onEdit(set, { loadMode: event.target.value as WorkoutSet['loadMode'] })
                      }
                    >
                      <option value="bodyweight">Added weight</option>
                      <option value="assistance">Assistance</option>
                    </select>
                  )}
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
                      onChange={(event) => {
                        setDeleteRow(null);
                        done(event.target.checked);
                      }}
                    />
                  </label>
                  {onRemove && (deleteRow === set.id || drag?.id === set.id) && (
                    <Button
                      variant="ghost"
                      className="set-delete-action"
                      aria-hidden={deleteRow !== set.id}
                      tabIndex={deleteRow === set.id ? 0 : -1}
                      aria-label={`Delete set ${ordinal}`}
                      title="Delete set for today"
                      onClick={() => {
                        onRemove(set.id);
                        setDeleteRow(null);
                      }}
                    >
                      <Trash2 size={18} aria-hidden="true" />
                      <span>Delete</span>
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        {onAdd && (
          <tfoot>
            <tr>
              <td colSpan={4} className="set-add-cell">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Add set"
                  title="Add set for today"
                  onClick={onAdd}
                >
                  <Plus size={18} aria-hidden="true" />
                </Button>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      {invalidCount > 0 && (
        <div className="set-table-validation" role="status">
          Check load and reps before marking Done.
        </div>
      )}
    </div>
  );
}
