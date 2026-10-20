import { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import { catalog } from '../../shared/catalog';
import { fromDisplayWeight, toDisplayWeight, id } from '../../shared/domain';
import type { AppData, Exercise, TrainingEdit } from '../../shared/types';
import {
  applyDraftEdits,
  hasRoutineDraftChanges,
  validateRoutineDraft,
  type RoutineDraft,
} from '../lib/routineDraft';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';
import { parseRepRange } from '../lib/repRange';
import { loadModeLabel } from './LoadSemantics';
import { SearchPicker } from './SearchPicker';

export function RoutineEditor({
  data,
  draft,
  setDraft,
  name,
  setName,
  onBack,
  onSave,
  onAskCoach,
  canCoach = true,
}: {
  data: AppData;
  draft: RoutineDraft;
  setDraft: (draft: RoutineDraft) => void;
  name: string;
  setName: (name: string) => void;
  onBack: () => void;
  onSave: () => void;
  onAskCoach: () => void;
  canCoach?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [validation, setValidation] = useState('');
  const [repDrafts, setRepDrafts] = useState<Record<string, string>>({});
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Partial<Exercise>>({
    name: '',
    muscles: [],
    equipment: '',
    instructions: '',
    loadMode: 'external',
    region: 'upper',
  });
  const library = useMemo(
    () => [...catalog, ...data.exercises, ...draft.customExercises],
    [data.exercises, draft.customExercises],
  );
  const dirty = hasRoutineDraftChanges(draft, name);
  const exerciseName = (exerciseId: string) =>
    library.find((e) => e.id === exerciseId)?.name || exerciseId;
  const edit = (edits: TrainingEdit[]) => {
    try {
      setDraft(applyDraftEdits(draft, edits, library));
      setValidation('');
      return true;
    } catch (e) {
      setValidation((e as Error).message);
      return false;
    }
  };
  const deleteRequested = (prescriptionId: string) => setPendingDelete(prescriptionId);
  const confirmDelete = () => {
    if (pendingDelete) {
      edit([{ op: 'remove_exercise', exerciseId: pendingDelete }]);
      setRepDrafts((prev) => {
        const next = { ...prev };
        delete next[pendingDelete];
        return next;
      });
      setNumberDrafts((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next))
          if (key.endsWith(`-${pendingDelete}`)) delete next[key];
        return next;
      });
    }
    setPendingDelete(null);
  };
  const requestSave = () => {
    const currentPrescriptionIds = new Set(draft.routine.exercises.map((exercise) => exercise.id));
    if (
      Object.entries(repDrafts).some(
        ([prescriptionId, value]) =>
          currentPrescriptionIds.has(prescriptionId) && !parseRepRange(value),
      )
    ) {
      setValidation(
        'Enter reps as a whole number or range from 1 to 100, with the high value at least the low value.',
      );
      return;
    }
    const hasInvalidNumber = Object.keys(numberDrafts).some((key) => {
      const prescriptionId = key.slice(key.indexOf('-') + 1);
      return currentPrescriptionIds.has(prescriptionId);
    });
    if (hasInvalidNumber) {
      setValidation('Use a valid value within the field limits before saving.');
      return;
    }
    const issue = validateRoutineDraft(draft, name);
    if (issue) {
      setValidation(issue);
      return;
    }
    onSave();
  };
  const addCustom = () => {
    if (
      !custom.name?.trim() ||
      !custom.equipment?.trim() ||
      !custom.instructions?.trim() ||
      !custom.muscles?.length
    ) {
      setValidation('Complete the custom exercise details first.');
      return;
    }
    const exercise: Exercise = {
      id: id('custom'),
      name: custom.name.trim(),
      muscles: custom.muscles,
      equipment: custom.equipment,
      instructions: custom.instructions,
      loadMode: custom.loadMode || 'external',
      region: custom.region || 'upper',
      custom: true,
    };
    try {
      const next = applyDraftEdits(
        draft,
        [{ op: 'add_exercise', exerciseId: exercise.id, sets: 3, repRange: [8, 12] }],
        [...library, exercise],
      );
      setDraft({ ...next, customExercises: [...draft.customExercises, exercise] });
      setCustom({
        name: '',
        muscles: [],
        equipment: '',
        instructions: '',
        loadMode: 'external',
        region: 'upper',
      });
      setCustomOpen(false);
      setPickerOpen(false);
      setValidation('');
    } catch (e) {
      setValidation((e as Error).message);
    }
  };
  return (
    <main className="page routine-editor-page">
      <header className="routine-editor-header">
        <Button variant="ghost" className="back-button" onClick={onBack}>
          <ArrowLeft size={17} /> Back
        </Button>
        <div className="routine-editor-heading">
          <h1>
            {draft.proposalId
              ? 'Review routine draft'
              : draft.source
                ? 'Edit routine'
                : 'Create routine'}
          </h1>
        </div>
        <div className="routine-editor-header-actions">
          <span className="muted small">{dirty ? 'Unsaved changes' : 'Up to date'}</span>
          {canCoach && (
            <Button
              variant="ai"
              size="icon"
              aria-label="Ask Coach"
              title="Ask Coach"
              onClick={onAskCoach}
            >
              <Sparkles size={17} />
            </Button>
          )}
          <Button variant="primary" onClick={requestSave}>
            {draft.proposalId ? 'Approve and save' : 'Save routine'}
          </Button>
        </div>
      </header>
      <div className="routine-editor-content">
        <div className="routine-editor-name form-field">
          <label htmlFor="routine-name">Routine name</label>
          <input
            id="routine-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Full body A"
            autoFocus={!draft.source && !draft.proposalId}
          />
        </div>
        <div className="routine-editor-section-head">
          <div>
            <h2>Exercises</h2>
          </div>
        </div>
        {draft.routine.exercises.length === 0 ? (
          <div className="card card-pad routine-empty-draft">
            <b>Your draft has no exercises yet.</b>
            <p className="muted small">Add an exercise below before saving.</p>
          </div>
        ) : (
          <div className="routine-list routine-editor-list">
            {draft.routine.exercises.map((p, i) => {
              const ex = library.find((e) => e.id === p.exerciseId);
              const increment =
                draft.increments[p.exerciseId] ??
                data.settings.increments[p.exerciseId] ??
                (ex?.region === 'lower' ? 10 : 5);
              const field = (
                label: string,
                value: number,
                key: 'sets' | 'weight' | 'rest',
                min: number,
                max: number,
              ) => (
                <div className="form-field compact-field" key={key}>
                  <label htmlFor={`${key}-${p.id}`}>{label}</label>
                  <input
                    id={`${key}-${p.id}`}
                    className="input input-sm"
                    type="number"
                    min={min}
                    max={max}
                    step={key === 'weight' ? (data.settings.unit === 'kg' ? '0.1' : '0.5') : '1'}
                    value={numberDrafts[`${key}-${p.id}`] ?? value}
                    aria-invalid={numberDrafts[`${key}-${p.id}`] !== undefined}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = Number(raw);
                      const valid =
                        raw.trim() !== '' &&
                        Number.isFinite(n) &&
                        n >= min &&
                        n <= max &&
                        (key === 'weight' || Number.isInteger(n));
                      if (!valid) {
                        setNumberDrafts((prev) => ({ ...prev, [`${key}-${p.id}`]: raw }));
                        setValidation(
                          `Enter a valid ${label.toLowerCase()} within the shown limits.`,
                        );
                        return;
                      }
                      try {
                        const next =
                          key === 'sets'
                            ? { sets: n }
                            : key === 'weight'
                              ? { targetWeight: fromDisplayWeight(n, data.settings.unit) }
                              : { restSeconds: n };
                        if (
                          'targetWeight' in next &&
                          typeof next.targetWeight === 'number' &&
                          next.targetWeight > 2000
                        )
                          throw new Error('Load exceeds the maximum supported weight.');
                        if (!edit([{ op: 'update_exercise', exerciseId: p.id, ...next }])) {
                          setNumberDrafts((prev) => ({ ...prev, [`${key}-${p.id}`]: raw }));
                          return;
                        }
                        setNumberDrafts((prev) => {
                          const next = { ...prev };
                          delete next[`${key}-${p.id}`];
                          return next;
                        });
                      } catch (error) {
                        setNumberDrafts((prev) => ({ ...prev, [`${key}-${p.id}`]: raw }));
                        setValidation((error as Error).message);
                      }
                    }}
                  />
                </div>
              );
              const repValue =
                repDrafts[p.id] ??
                `${p.repRange[0]}${p.repRange[0] === p.repRange[1] ? '' : `–${p.repRange[1]}`}`;
              return (
                <article className="routine-editor-item" data-prescription-id={p.id} key={p.id}>
                  <div className="routine-editor-item-head">
                    <div className="grow">
                      <b>{ex?.name || p.exerciseId}</b>
                      <div className="muted small">{loadModeLabel(p.loadMode)}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="routine-explicit-remove"
                      aria-label={`Remove ${ex?.name || 'exercise'}`}
                      onClick={() => deleteRequested(p.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                  <div className="routine-primary-fields">
                    {field('Sets', p.sets, 'sets', 1, 30)}
                    <div className="form-field compact-field">
                      <label htmlFor={`reps-${p.id}`}>Reps</label>
                      <input
                        id={`reps-${p.id}`}
                        className="input input-sm"
                        value={repValue}
                        inputMode="text"
                        placeholder="8-12"
                        aria-invalid={
                          repDrafts[p.id] !== undefined && !parseRepRange(repDrafts[p.id])
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        }}
                        onChange={(e) => {
                          const value = e.target.value;
                          setRepDrafts({ ...repDrafts, [p.id]: value });
                          const parsed = parseRepRange(value);
                          if (parsed) {
                            edit([{ op: 'update_exercise', exerciseId: p.id, repRange: parsed }]);
                            setRepDrafts((prev) => {
                              const next = { ...prev };
                              delete next[p.id];
                              return next;
                            });
                            if (validation.startsWith('Enter reps')) setValidation('');
                          } else {
                            setValidation(
                              'Enter reps as a whole number or range from 1 to 100, with the high value at least the low value.',
                            );
                          }
                        }}
                        onBlur={() => {
                          if (repDrafts[p.id] !== undefined && !parseRepRange(repDrafts[p.id]))
                            setValidation(
                              'Enter reps as a whole number or range from 1 to 100, with the high value at least the low value.',
                            );
                        }}
                      />
                    </div>
                    {field(
                      `${loadModeLabel(p.loadMode)} (${data.settings.unit})`,
                      toDisplayWeight(p.targetWeight, data.settings.unit),
                      'weight',
                      0,
                      2000,
                    )}
                  </div>
                  <details className="routine-options">
                    <summary>Options</summary>
                    <div className="routine-options-actions">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${ex?.name || 'exercise'} up`}
                        disabled={i === 0}
                        onClick={() => {
                          const ids = draft.routine.exercises.map((x) => x.id);
                          [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                          edit([{ op: 'reorder_exercises', exerciseIds: ids }]);
                        }}
                      >
                        <ArrowUp size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${ex?.name || 'exercise'} down`}
                        disabled={i === draft.routine.exercises.length - 1}
                        onClick={() => {
                          const ids = draft.routine.exercises.map((x) => x.id);
                          [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                          edit([{ op: 'reorder_exercises', exerciseIds: ids }]);
                        }}
                      >
                        <ArrowDown size={16} />
                      </Button>
                      {field('Rest (sec)', p.restSeconds, 'rest', 0, 3600)}
                      <SearchPicker
                        label="Replace exercise"
                        triggerLabel="Replace exercise"
                        value={p.exerciseId}
                        options={library.map((item) => ({
                          value: item.id,
                          label: item.name,
                          description: `${item.muscles.slice(0, 2).join(', ')} · ${item.equipment}`,
                          searchText: `${item.name} ${item.muscles.join(' ')} ${item.equipment}`,
                        }))}
                        onChange={(replacementId) =>
                          edit([{ op: 'replace_exercise', exerciseId: p.id, replacementId }])
                        }
                        placeholder="Search exercises"
                        emptyMessage="No matching exercises."
                      />
                      <div className="form-field">
                        <label htmlFor={`increment-${p.id}`}>
                          Progress increment ({data.settings.unit})
                        </label>
                        <input
                          id={`increment-${p.id}`}
                          className="input input-sm"
                          type="number"
                          min="0"
                          step={data.settings.unit === 'kg' ? '0.1' : '0.5'}
                          value={
                            numberDrafts[`increment-${p.id}`] ??
                            toDisplayWeight(increment, data.settings.unit)
                          }
                          aria-invalid={numberDrafts[`increment-${p.id}`] !== undefined}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const n = Number(raw);
                            if (!raw.trim() || !Number.isFinite(n) || n < 0 || n > 2000) {
                              setNumberDrafts((prev) => ({ ...prev, [`increment-${p.id}`]: raw }));
                              setValidation('Progress increment must be between 0 and 2000.');
                              return;
                            }
                            try {
                              const increment = fromDisplayWeight(n, data.settings.unit);
                              if (increment <= 0 || increment > 100)
                                throw new Error('Invalid progression increment');
                              setDraft({
                                ...draft,
                                increments: { ...draft.increments, [p.exerciseId]: increment },
                              });
                              setNumberDrafts((prev) => {
                                const next = { ...prev };
                                delete next[`increment-${p.id}`];
                                return next;
                              });
                              setValidation('');
                            } catch {
                              setNumberDrafts((prev) => ({ ...prev, [`increment-${p.id}`]: raw }));
                              setValidation(
                                'Use a positive progress increment up to 100 lb (45.3 kg).',
                              );
                            }
                          }}
                        />
                      </div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        )}
        <Button
          variant="secondary"
          className="routine-add-exercise"
          onClick={() => setPickerOpen(true)}
        >
          <Plus size={16} /> Add exercise
        </Button>
        {validation && (
          <p className="routine-validation" role="alert">
            {validation}
          </p>
        )}
      </div>
      <SearchPicker
        label="Add exercise"
        value=""
        options={library.map((e) => ({
          value: e.id,
          label: e.name,
          description: `${e.muscles.slice(0, 2).join(', ')} · ${e.equipment}`,
          searchText: `${e.muscles.join(' ')} ${e.equipment}`,
        }))}
        onChange={(exerciseId) => {
          edit([{ op: 'add_exercise', exerciseId, sets: 3, repRange: [8, 12] }]);
          setPickerOpen(false);
        }}
        placeholder="Search exercises"
        searchLabel="Search exercises"
        emptyMessage="No matching exercises."
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        hideTrigger
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              setPickerOpen(false);
              setCustomOpen(true);
            }}
          >
            <Plus size={16} /> Create a custom exercise
          </Button>
        }
      />
      <Sheet open={customOpen} onOpenChange={setCustomOpen} title="Create custom exercise">
        <div className="stack routine-custom-form">
          <div className="profile-grid">
            {(['name', 'equipment'] as const).map((key) => {
              const inputId = `custom-${key}`;
              return (
                <div className="form-field" key={key}>
                  <label htmlFor={inputId}>{key === 'name' ? 'Exercise name' : 'Equipment'}</label>
                  <input
                    id={inputId}
                    className="input"
                    value={custom[key] || ''}
                    onChange={(e) => setCustom({ ...custom, [key]: e.target.value })}
                  />
                </div>
              );
            })}
            <div className="form-field">
              <label htmlFor="custom-muscles">Primary muscles</label>
              <input
                id="custom-muscles"
                className="input"
                value={(custom.muscles || []).join(', ')}
                onChange={(e) =>
                  setCustom({
                    ...custom,
                    muscles: e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Chest, triceps"
              />
            </div>
            <div className="form-field">
              <label htmlFor="custom-load-mode">Load type</label>
              <select
                id="custom-load-mode"
                className="select"
                value={custom.loadMode}
                onChange={(e) =>
                  setCustom({ ...custom, loadMode: e.target.value as Exercise['loadMode'] })
                }
              >
                <option value="external">External load</option>
                <option value="per-dumbbell">Per dumbbell</option>
                <option value="bodyweight">Bodyweight</option>
                <option value="assistance">Assistance</option>
              </select>
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="custom-instructions">Instructions</label>
            <textarea
              id="custom-instructions"
              className="textarea"
              value={custom.instructions}
              onChange={(e) => setCustom({ ...custom, instructions: e.target.value })}
            />
          </div>
          <div className="row">
            <Button
              onClick={() => {
                setCustomOpen(false);
                setPickerOpen(true);
              }}
            >
              Back to library
            </Button>
            <Button variant="primary" onClick={addCustom}>
              Add exercise
            </Button>
          </div>
        </div>
        {validation && (
          <p className="routine-validation" role="alert">
            {validation}
          </p>
        )}
      </Sheet>
      <Sheet
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Remove exercise?"
        description={
          pendingDelete
            ? `Remove ${exerciseName(draft.routine.exercises.find((p) => p.id === pendingDelete)?.exerciseId || '')} from this draft?`
            : undefined
        }
      >
        <div className="sheet-actions">
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmDelete}>
            Yes, remove
          </Button>
        </div>
      </Sheet>
    </main>
  );
}
