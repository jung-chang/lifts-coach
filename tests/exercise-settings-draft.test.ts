import { describe, expect, it } from 'vitest';
import { catalog } from '../shared/catalog';
import {
  createPrescription,
  createRoutine,
  emptyData,
  proposalFingerprint,
} from '../shared/domain';
import type { Proposal } from '../shared/types';
import {
  applyInspectedRoutineProposal,
  commitRoutineDraft,
  createRoutineDraft,
  hasRoutineDraftChanges,
  stageExerciseSettings,
} from '../src/lib/routineDraft';

const exercise = catalog.find((item) => item.id === 'ex_barbell-bench-press')!;
const note = (persistentNote: string) => ({ persistentNote, updatedAt: new Date().toISOString() });

describe('exercise note draft', () => {
  it('stages a note until the routine is saved', () => {
    const routine = { ...createRoutine('Push'), exercises: [createPrescription(exercise.id)] };
    const data = { ...emptyData(), routines: [routine] };
    const draft = stageExerciseSettings(
      createRoutineDraft(routine, undefined, data),
      exercise.id,
      note('Pause at chest'),
      data,
    );

    expect(data.exerciseSettings?.[exercise.id]).toBeUndefined();
    expect(hasRoutineDraftChanges(draft, 'Push')).toBe(true);
    expect(
      commitRoutineDraft(data, draft, 'Push').exerciseSettings?.[exercise.id].persistentNote,
    ).toBe('Pause at chest');
  });

  it('saves a cleared note as an unset shared exercise note', () => {
    const routine = { ...createRoutine('Push'), exercises: [createPrescription(exercise.id)] };
    const data = {
      ...emptyData(),
      routines: [routine],
      exerciseSettings: { [exercise.id]: note('Old note') },
    };
    const draft = stageExerciseSettings(
      createRoutineDraft(routine, undefined, data),
      exercise.id,
      { updatedAt: new Date().toISOString() },
      data,
    );

    expect(
      commitRoutineDraft(data, draft, 'Push').exerciseSettings?.[exercise.id].persistentNote,
    ).toBeUndefined();
  });

  it('detects concurrent note changes, including a value that was absent when editing began', () => {
    const routine = { ...createRoutine('Push'), exercises: [createPrescription(exercise.id)] };
    const data = { ...emptyData(), routines: [routine] };
    const draft = stageExerciseSettings(
      createRoutineDraft(routine, undefined, data),
      exercise.id,
      note('My note'),
      data,
    );
    const concurrent = { ...data, exerciseSettings: { [exercise.id]: note('Other tab') } };

    expect(draft.sourceExerciseSettings[exercise.id]).toBeNull();
    expect(() => commitRoutineDraft(concurrent, draft, 'Push')).toThrow(
      'Exercise settings changed',
    );
  });

  it('shares one saved note across duplicate routine prescriptions', () => {
    const routine = {
      ...createRoutine('Push'),
      exercises: [createPrescription(exercise.id), createPrescription(exercise.id)],
    };
    const data = { ...emptyData(), routines: [routine] };
    const draft = stageExerciseSettings(
      createRoutineDraft(routine, undefined, data),
      exercise.id,
      note('Same exercise note'),
      data,
    );
    const saved = commitRoutineDraft(data, draft, 'Push');

    expect(saved.routines[0].exercises.map((prescription) => prescription.exerciseId)).toEqual([
      exercise.id,
      exercise.id,
    ]);
    expect(saved.exerciseSettings?.[exercise.id].persistentNote).toBe('Same exercise note');
  });

  it('applies a reviewed Coach routine draft and its note in one approval', () => {
    const data = emptyData();
    const routine = {
      ...createRoutine('Coach routine'),
      exercises: [createPrescription(exercise.id)],
    };
    const proposal: Proposal = {
      id: 'synthetic-note-proposal',
      scope: 'routine',
      targetId: routine.id,
      edits: [],
      rationale: 'Synthetic routine proposal',
      evidenceIds: [],
      status: 'pending',
      routineDraft: routine,
      createdAt: new Date().toISOString(),
    };
    proposal.targetFingerprint = proposalFingerprint(data, proposal);
    data.proposals.push(proposal);

    const approved = applyInspectedRoutineProposal(
      data,
      proposal.id,
      routine,
      [],
      {},
      { [exercise.id]: note('Coach reviewed note') },
      { [exercise.id]: null },
    );

    expect(approved.proposals[0].status).toBe('accepted');
    expect(approved.exerciseSettings?.[exercise.id].persistentNote).toBe('Coach reviewed note');
    expect(approved.routines.map((item) => item.id)).toContain(routine.id);
  });
});
