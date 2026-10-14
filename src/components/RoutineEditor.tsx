import { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
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
import SwipeToDeleteRow from './SwipeToDeleteRow';

export function RoutineEditor({
  data,
  draft,
  setDraft,
  name,
  setName,
  onBack,
  onSave,
  onAskCoach,
}: {
  data: AppData;
  draft: RoutineDraft;
  setDraft: (draft: RoutineDraft) => void;
  name: string;
  setName: (name: string) => void;
  onBack: () => void;
  onSave: () => void;
  onAskCoach: () => void;
}) {
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [validation, setValidation] = useState('');
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
    } catch (e) {
      setValidation((e as Error).message);
    }
  };
  const deleteRequested = (prescriptionId: string) => setPendingDelete(prescriptionId);
  const confirmDelete = () => {
    if (pendingDelete) edit([{ op: 'remove_exercise', exerciseId: pendingDelete }]);
    setPendingDelete(null);
  };
  const requestSave = () => {
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
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={17} /> Back
        </Button>
        <div className="routine-editor-heading">
          <span className="eyebrow">Train</span>
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
          />
        </div>
        <div className="routine-editor-section-head">
          <div>
            <h2>Exercises</h2>
            <p className="muted small">Adjust the plan. Changes are saved together.</p>
          </div>
          <Button variant="ai" onClick={onAskCoach}>
            <Sparkles size={16} /> Ask Coach
          </Button>
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
                key: 'sets' | 'low' | 'high' | 'weight' | 'rest',
                min: number,
                max: number,
              ) => (
                <div className="form-field" key={key}>
                  <label htmlFor={`${key}-${p.id}`}>{label}</label>
                  <input
                    id={`${key}-${p.id}`}
                    className="input input-sm"
                    type="number"
                    min={min}
                    max={max}
                    step={key === 'weight' ? (data.settings.unit === 'kg' ? '0.1' : '0.5') : '1'}
                    value={value}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      const next =
                        key === 'sets'
                          ? { sets: n }
                          : key === 'low'
                            ? { repRange: [n, Math.max(n, p.repRange[1])] as [number, number] }
                            : key === 'high'
                              ? { repRange: [Math.min(n, p.repRange[0]), n] as [number, number] }
                              : key === 'weight'
                                ? { targetWeight: fromDisplayWeight(n || 0, data.settings.unit) }
                                : { restSeconds: n };
                      edit([{ op: 'update_exercise', exerciseId: p.id, ...next }]);
                    }}
                  />
                </div>
              );
              return (
                <SwipeToDeleteRow
                  key={p.id}
                  id={p.id}
                  label={ex?.name || p.exerciseId}
                  onRequestDelete={() => deleteRequested(p.id)}
                >
                  <article className="routine-editor-item" data-prescription-id={p.id}>
                    <div className="routine-editor-item-head">
                      <span className="exercise-order">{String(i + 1).padStart(2, '0')}</span>
                      <div className="grow">
                        <b>{ex?.name || p.exerciseId}</b>
                        <div className="muted small">
                          {p.sets} × {p.repRange[0]}–{p.repRange[1]} ·{' '}
                          {p.targetWeight
                            ? `${toDisplayWeight(p.targetWeight, data.settings.unit)} ${data.settings.unit}`
                            : 'No target weight'}
                        </div>
                      </div>
                      <div className="routine-editor-actions">
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
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${ex?.name || 'exercise'}`}
                          onClick={() => deleteRequested(p.id)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </div>
                    <details className="routine-prescription-details">
                      <summary>Prescription and exercise options</summary>
                      <div className="profile-grid routine-prescription-grid">
                        {field('Sets', p.sets, 'sets', 1, 30)}
                        {field('Min reps', p.repRange[0], 'low', 1, 100)}
                        {field('Max reps', p.repRange[1], 'high', 1, 100)}
                        {field(
                          `Target weight (${data.settings.unit})`,
                          toDisplayWeight(p.targetWeight, data.settings.unit),
                          'weight',
                          0,
                          2000,
                        )}
                        {field('Rest (sec)', p.restSeconds, 'rest', 0, 3600)}
                        <div className="form-field">
                          <label htmlFor={`replace-${p.id}`}>Replace exercise</label>
                          <select
                            id={`replace-${p.id}`}
                            className="select input-sm"
                            value={p.exerciseId}
                            onChange={(e) =>
                              edit([
                                {
                                  op: 'replace_exercise',
                                  exerciseId: p.id,
                                  replacementId: e.target.value,
                                },
                              ])
                            }
                          >
                            {library.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </div>
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
                            value={toDisplayWeight(increment, data.settings.unit)}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                increments: {
                                  ...draft.increments,
                                  [p.exerciseId]: fromDisplayWeight(
                                    Number(e.target.value) || 0,
                                    data.settings.unit,
                                  ),
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    </details>
                  </article>
                </SwipeToDeleteRow>
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
      <Sheet
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setCustomOpen(false);
        }}
        title={customOpen ? 'Create custom exercise' : 'Add exercise'}
        description={
          customOpen
            ? 'Create an exercise for this routine.'
            : 'Search the library or add a custom exercise.'
        }
      >
        {customOpen ? (
          <div className="stack routine-custom-form">
            <div className="profile-grid">
              {(['name', 'equipment'] as const).map((key) => {
                const inputId = `custom-${key}`;
                return (
                  <div className="form-field" key={key}>
                    <label htmlFor={inputId}>
                      {key === 'name' ? 'Exercise name' : 'Equipment'}
                    </label>
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
              <Button onClick={() => setCustomOpen(false)}>Back to library</Button>
              <Button variant="primary" onClick={addCustom}>
                Add exercise
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="search-wrap">
              <Search size={17} />
              <input
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exercises"
                aria-label="Search exercises"
              />
            </div>
            <div className="exercise-results routine-exercise-picker">
              {library
                .filter(
                  (e) =>
                    !search ||
                    e.name.toLowerCase().includes(search.toLowerCase()) ||
                    e.muscles.some((m) => m.toLowerCase().includes(search.toLowerCase())),
                )
                .slice(0, 45)
                .map((e) => (
                  <button
                    className="exercise-result"
                    key={e.id}
                    onClick={() => {
                      edit([{ op: 'add_exercise', exerciseId: e.id, sets: 3, repRange: [8, 12] }]);
                      setPickerOpen(false);
                      setSearch('');
                    }}
                  >
                    <span className="nav-mini">
                      <Plus size={16} />
                    </span>
                    <span className="grow">
                      <b>{e.name}</b>
                      <span className="muted small" style={{ display: 'block', marginTop: 3 }}>
                        {e.muscles.slice(0, 2).join(', ')} · {e.equipment}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
            <Button variant="secondary" onClick={() => setCustomOpen(true)}>
              <Plus size={16} /> Create a custom exercise
            </Button>
          </>
        )}
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
