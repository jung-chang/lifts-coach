import { Activity, Check, Sparkles, X } from 'lucide-react';
import type { AppData, Proposal, TrainingEdit, Prescription } from '../../shared/types';
import { catalog } from '../../shared/catalog';
import { Button } from './ui/Button';
import { toDisplayWeight } from '../../shared/domain';

type Props = {
  proposal: Proposal;
  data: AppData;
  selected: number[];
  setSelected: (value: number[]) => void;
  apply: () => void;
  reject: () => void;
};
const scopeLabel = (scope: string) =>
  scope === 'current_workout'
    ? 'Today only'
    : scope === 'next_workout'
      ? 'Next workout'
      : 'Routine going forward';
export function ProposalCard({ proposal, data, selected, setSelected, apply, reject }: Props) {
  const prescriptions: Prescription[] =
    proposal.scope === 'routine' || proposal.scope === 'next_workout'
      ? data.routines.find((r) => r.id === proposal.targetId)?.exercises || []
      : data.workouts.find((w) => w.id === proposal.targetId)?.exercises || [];
  const exerciseName = (id: string) => {
    const prescription = prescriptions.find((p) => p.id === id);
    const exerciseId = prescription?.exerciseId || id;
    return [...catalog, ...data.exercises].find((e) => e.id === exerciseId)?.name || exerciseId;
  };
  const target = (id: string) => prescriptions.find((p) => p.id === id);
  const value = (p: Prescription | undefined) =>
    p
      ? `${p.sets} sets · ${p.repRange[0]}–${p.repRange[1]} reps · ${toDisplayWeight(p.targetWeight, data.settings.unit)} ${data.settings.unit} · ${p.restSeconds}s rest`
      : 'Not in the current plan';
  const describe = (edit: TrainingEdit) => {
    if (edit.op === 'update_exercise') {
      const before = target(edit.exerciseId);
      const after = {
        ...(before || {}),
        ...edit,
        repRange: edit.repRange || before?.repRange,
        targetWeight: edit.targetWeight ?? before?.targetWeight,
        sets: edit.sets ?? before?.sets,
        restSeconds: edit.restSeconds ?? before?.restSeconds,
      } as Prescription;
      return (
        <>
          <b>{exerciseName(edit.exerciseId)}</b>
          <div className="proposal-diff">
            <span>
              <small>Before</small>
              {value(before)}
            </span>
            <span>
              <small>After</small>
              {value(after)}
            </span>
          </div>
        </>
      );
    }
    if (edit.op === 'replace_exercise') {
      return (
        <>
          <b>Replace {exerciseName(edit.exerciseId)}</b>
          <div className="proposal-diff">
            <span>
              <small>Before</small>
              {exerciseName(edit.exerciseId)}
            </span>
            <span>
              <small>After</small>
              {exerciseName(edit.replacementId)}
            </span>
          </div>
        </>
      );
    }
    if (edit.op === 'add_exercise')
      return (
        <>
          <b>Add {exerciseName(edit.exerciseId)}</b>
          <div className="small muted">
            {edit.sets} × {edit.repRange[0]}–{edit.repRange[1]} reps
            {edit.targetWeight !== undefined
              ? ` · ${toDisplayWeight(edit.targetWeight, data.settings.unit)} ${data.settings.unit}`
              : ''}
          </div>
        </>
      );
    if (edit.op === 'remove_exercise')
      return (
        <>
          <b>Remove {exerciseName(edit.exerciseId)}</b>
          <div className="small muted">{value(target(edit.exerciseId))}</div>
        </>
      );
    return (
      <>
        <b>Reorder exercises</b>
        <div className="small muted">{edit.exerciseIds.map(exerciseName).join(' → ')}</div>
      </>
    );
  };
  const toggle = (i: number) =>
    setSelected(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i]);
  const durableIndex = proposal.edits.length;
  return (
    <div
      className={`proposal-card ${proposal.origin === 'progression' ? 'proposal-card-progression' : ''}`}
    >
      {proposal.routineDraft && (
        <div className="notice" style={{ marginBottom: 12 }}>
          Proposed routine: <b>{proposal.routineDraft.name}</b> ·{' '}
          {proposal.routineDraft.exercises.length} exercises. Inspect and edit it in the shared
          routine editor before saving.
        </div>
      )}
      <div className="row space-between">
        <div>
          <span
            className={proposal.origin === 'progression' ? 'pill pill-blue' : 'pill pill-purple'}
          >
            {proposal.origin === 'progression' ? <Activity size={12} /> : <Sparkles size={12} />}{' '}
            {proposal.origin === 'progression' ? 'Progression suggestion' : 'Coach proposal'}
          </span>
          <span className="pill" style={{ marginLeft: 6 }}>
            {scopeLabel(proposal.scope)}
          </span>
        </div>
        <span className="small muted">Review each change</span>
      </div>
      <p className="small" style={{ margin: '11px 0' }}>
        {proposal.rationale}
      </p>
      {proposal.edits.map((edit, i) => (
        <label className="proposal-change check-row proposal-review" key={i}>
          <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} />
          <span>{describe(edit)}</span>
        </label>
      ))}
      {proposal.preference && (
        <label className="proposal-change check-row">
          <input
            type="checkbox"
            checked={selected.includes(durableIndex)}
            onChange={() => toggle(durableIndex)}
          />
          <span>
            <b>Save preference</b>
            <div className="small muted">
              {proposal.preference.field}: {proposal.preference.value}
            </div>
          </span>
        </label>
      )}
      {proposal.customExercise && (
        <label className="proposal-change check-row">
          <input
            type="checkbox"
            checked={selected.includes(durableIndex)}
            onChange={() => toggle(durableIndex)}
          />
          <span>
            <b>Create exercise</b>
            <div className="small muted">
              {proposal.customExercise.name} · {proposal.customExercise.equipment} ·{' '}
              {proposal.customExercise.muscles.join(', ')} · {proposal.customExercise.loadMode}
            </div>
            <div className="small muted">{proposal.customExercise.instructions}</div>
          </span>
        </label>
      )}
      {proposal.routineDraft && (
        <label className="proposal-change check-row">
          <input type="checkbox" checked={selected.includes(0)} onChange={() => toggle(0)} />
          <span>
            <b>Review and save this routine</b>
            <div className="small muted">
              {proposal.routineDraft.exercises
                .map((p) => `${exerciseName(p.exerciseId)} · ${value(p)}`)
                .join('  |  ') || 'No exercises added yet'}
            </div>
          </span>
        </label>
      )}
      <div className="row space-between" style={{ marginTop: 12 }}>
        <Button variant="danger" size="sm" onClick={reject}>
          <X size={14} />
          Dismiss
        </Button>
        <Button
          variant={proposal.origin === 'progression' ? 'secondary' : 'ai'}
          disabled={!selected.length}
          onClick={apply}
        >
          <Check size={15} />
          {proposal.routineDraft
            ? 'Open routine editor'
            : proposal.preference || proposal.customExercise
              ? 'Approve selected'
              : 'Apply selected'}
        </Button>
      </div>
    </div>
  );
}
