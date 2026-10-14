import { describe, expect, it } from 'vitest';
import { catalog } from '../shared/catalog';
import {
  completeSet,
  createPrescription,
  createRoutine,
  emptyData,
  finishWorkout,
  id,
  proposalFingerprint,
  startWorkout,
} from '../shared/domain';
import type { Exercise, Proposal } from '../shared/types';
import {
  addCustomExerciseToDraft,
  applyInspectedRoutineProposal,
  applyDraftEdits,
  commitRoutineDraft,
  createRoutineDraft,
  hasRoutineDraftChanges,
  validateRoutineDraft,
} from '../src/lib/routineDraft';

const exercise = catalog.find((item) => item.id === 'ex_barbell-bench-press')!;

describe('routine editor drafts', () => {
  it('treats a pristine blank create screen as clean until the user makes a change', () => {
    const draft = createRoutineDraft();
    expect(hasRoutineDraftChanges(draft, '')).toBe(false);
    expect(hasRoutineDraftChanges(draft, 'Leg day')).toBe(true);
  });

  it('keeps edits isolated until save and preserves duplicate exercise prescription IDs', () => {
    const first = createPrescription(exercise.id);
    const second = { ...createPrescription(exercise.id), sets: 5 };
    const source = { ...createRoutine('Push'), exercises: [first, second] };
    const data = { ...emptyData(), routines: [source] };
    const draft = createRoutineDraft(source);
    const changed = applyDraftEdits(
      draft,
      [{ op: 'remove_exercise', exerciseId: second.id }],
      catalog,
    );

    expect(changed.routine.exercises.map((item) => item.id)).toEqual([first.id]);
    expect(data.routines[0].exercises.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(hasRoutineDraftChanges(changed, 'Push')).toBe(true);
  });

  it('allows an empty draft but blocks saving it until an exercise is added', () => {
    const source = { ...createRoutine('Pull'), exercises: [createPrescription(exercise.id)] };
    const draft = applyDraftEdits(
      createRoutineDraft(source),
      [{ op: 'remove_exercise', exerciseId: source.exercises[0].id }],
      catalog,
    );
    expect(draft.routine.exercises).toHaveLength(0);
    expect(validateRoutineDraft(draft, 'Pull')).toContain('at least one exercise');
  });

  it('commits custom exercises and increments atomically without mutating its input', () => {
    const data = emptyData();
    const draft = createRoutineDraft();
    const custom: Exercise = {
      id: id('custom-test'),
      name: 'Cable Y raise',
      muscles: ['Shoulders'],
      equipment: 'Cable',
      instructions: 'Raise the handles diagonally.',
      loadMode: 'external',
      region: 'upper',
      custom: true,
    };
    const staged = addCustomExerciseToDraft(draft, custom, catalog);
    staged.increments[custom.id] = 2.5;
    const saved = commitRoutineDraft(data, staged, 'Shoulder day');

    expect(data.routines).toHaveLength(0);
    expect(data.exercises).toHaveLength(0);
    expect(saved.routines[0].name).toBe('Shoulder day');
    expect(saved.routines[0].exercises[0].exerciseId).toBe(custom.id);
    expect(saved.exercises).toContainEqual(custom);
    expect(saved.settings.increments[custom.id]).toBe(2.5);
  });

  it('rejects saving over a routine changed since the draft was opened', () => {
    const source = { ...createRoutine('Legs'), exercises: [createPrescription(exercise.id)] };
    const data = { ...emptyData(), routines: [source] };
    const draft = createRoutineDraft(source);
    const changedSource = { ...source, name: 'Legs updated' };
    expect(() => commitRoutineDraft({ ...data, routines: [changedSource] }, draft, 'Legs')).toThrow(
      'changed while you were editing',
    );
  });

  it('saves only the inspected routine draft when a proposal also contains edits, preserving history', () => {
    const source = { ...createRoutine('Source'), exercises: [createPrescription(exercise.id)] };
    let data = { ...emptyData(), routines: [source] };
    data = startWorkout(data, source.id);
    const workout = data.workouts[0];
    data = completeSet(
      data,
      workout.id,
      workout.exercises[0].id,
      workout.exercises[0].actualSets[0].id,
    );
    data = finishWorkout(data, workout.id);
    const historyBefore = JSON.stringify(data.workouts);
    const candidate = {
      ...createRoutine('Coach plan'),
      id: 'proposal-routine',
      exercises: [createPrescription(exercise.id)],
    };
    const proposal: Proposal = {
      id: 'proposal-mixed',
      scope: 'routine',
      targetId: source.id,
      edits: [{ op: 'update_exercise', exerciseId: source.exercises[0].id, sets: 9 }],
      rationale: 'Build a new plan',
      evidenceIds: [],
      status: 'pending',
      routineDraft: candidate,
      createdAt: new Date().toISOString(),
    };
    proposal.targetFingerprint = proposalFingerprint(data, proposal);
    data = { ...data, proposals: [proposal] };
    const reviewed = {
      ...candidate,
      name: 'Reviewed plan',
      exercises: [{ ...candidate.exercises[0], sets: 4 }],
    };

    const saved = applyInspectedRoutineProposal(data, proposal.id, reviewed, [], {});

    expect(saved.routines.map((r) => r.id)).toEqual([source.id, candidate.id]);
    expect(saved.routines[0].exercises[0].sets).toBe(source.exercises[0].sets);
    expect(saved.routines[1].name).toBe('Reviewed plan');
    expect(saved.routines[1].exercises[0].sets).toBe(4);
    expect(saved.proposals[0].edits).toEqual([]);
    expect(saved.proposals[0].status).toBe('accepted');
    expect(JSON.stringify(saved.workouts)).toBe(historyBefore);
  });
});
