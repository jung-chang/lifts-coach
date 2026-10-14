import { describe, expect, it } from 'vitest';
import { catalog } from '../shared/catalog';
import {
  addRoutine,
  applyEdits,
  applyProposal,
  completeSet,
  createPrescription,
  createRoutine,
  editWorkout,
  emptyData,
  finishWorkout,
  progressionProposals,
  proposalFingerprint,
  repeatWorkout,
  replaceWorkoutExercise,
  scheduleEdit,
  startWorkout,
  updateSet,
  validateBackup,
} from '../shared/domain';
import type { Proposal } from '../shared/types';
import { createMutationQueue, reserveBaseRevision } from '../src/lib/store';

const base = () => {
  const ex = catalog.find((x) => x.id === 'ex_barbell-bench-press')!;
  let data = emptyData();
  data = { ...data, routines: [{ ...createRoutine('A'), exercises: [createPrescription(ex.id)] }] };
  return data;
};

describe('core domain invariants', () => {
  it('ships a stable populated catalog in the requested range', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(100);
    expect(catalog.length).toBeLessThanOrEqual(150);
    expect(new Set(catalog.map((x) => x.id)).size).toBe(catalog.length);
    expect(new Set(catalog.map((x) => x.name.trim().toLowerCase())).size).toBe(catalog.length);
    expect(catalog.every((x) => x.name && x.muscles.length && x.equipment && x.instructions)).toBe(
      true,
    );
  });
  it('starts an independent routine snapshot and consumes a scheduled edit once', () => {
    const original = base();
    const rid = original.routines[0].id;
    let data = scheduleEdit(original, rid, [
      {
        op: 'update_exercise',
        exerciseId: original.routines[0].exercises[0].id,
        targetWeight: 135,
      },
    ]);
    data = startWorkout(data, rid);
    expect(data.workouts[0].exercises[0].targetWeight).toBe(135);
    expect(data.routines[0].exercises[0].targetWeight).toBe(0);
    expect(data.scheduledEdits[0].consumedAt).toBeTruthy();
  });
  it('retains incomplete status and creates a new session when repeating history', () => {
    const original = base();
    let data = startWorkout(original, original.routines[0].id);
    const old = data.workouts[0];
    data = completeSet(data, old.id, old.exercises[0].id, old.exercises[0].actualSets[0].id);
    data = finishWorkout(data, old.id);
    expect(data.workouts[0].exercises[0].actualSets[0].status).toBe('completed');
    expect(data.workouts[0].exercises[0].actualSets[1].status).toBe('incomplete');
    const finished = JSON.stringify(data.workouts[0]);
    data = repeatWorkout(data, old.id);
    expect(data.workouts).toHaveLength(2);
    expect(JSON.stringify(data.workouts[0])).toBe(finished);
    expect(data.workouts[1].id).not.toBe(old.id);
    expect(data.workouts[1].exercises[0].actualSets[0].reps).toBe(
      old.exercises[0].actualSets[0].reps,
    );
    expect(data.workouts[1].exercises[0].actualSets.every((s) => s.status === 'incomplete')).toBe(
      true,
    );
  });
  it('does not write a proposal until selected changes are applied, and applies it idempotently', () => {
    const data = base();
    const routine = data.routines[0];
    const proposal: Proposal = {
      id: 'p1',
      scope: 'routine',
      targetId: routine.id,
      edits: [
        { op: 'update_exercise', exerciseId: routine.exercises[0].id, targetWeight: 100 },
        { op: 'update_exercise', exerciseId: routine.exercises[0].id, sets: 5 },
      ],
      rationale: 'test',
      evidenceIds: [],
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    proposal.targetFingerprint = proposalFingerprint(data, proposal);
    const staged = { ...data, proposals: [proposal] };
    expect(staged.routines[0].exercises[0].targetWeight).toBe(0);
    const applied = applyProposal(staged, 'p1', [0]);
    expect(applied.routines[0].exercises[0].targetWeight).toBe(100);
    expect(applied.routines[0].exercises[0].sets).toBe(3);
    expect(applyProposal(applied, 'p1', [1])).toEqual(applied);
  });
  it('rejects a pending edit when the target changed but still allows backup restore', () => {
    const data = base(),
      proposal: Proposal = {
        id: 'stale',
        scope: 'routine',
        targetId: data.routines[0].id,
        edits: [{ op: 'update_exercise', exerciseId: data.routines[0].exercises[0].id, sets: 4 }],
        rationale: 'test',
        evidenceIds: [],
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
    proposal.targetFingerprint = proposalFingerprint(data, proposal);
    const changed = {
      ...data,
      routines: data.routines.map((r) => ({
        ...r,
        exercises: r.exercises.map((p) => ({ ...p, targetWeight: 20 })),
      })),
      proposals: [proposal],
    };
    expect(() => applyProposal(changed, 'stale', [0])).toThrow(/target changed/);
    expect(validateBackup(changed).proposals[0].status).toBe('pending');
  });
  it('rejects invalid numerical prescription changes and invalid backup versions', () => {
    const p = createPrescription(catalog[0].id);
    expect(() =>
      applyEdits([p], [{ op: 'update_exercise', exerciseId: p.id, sets: 0 }], catalog),
    ).toThrow();
    expect(() => validateBackup({ ...emptyData(), schemaVersion: 999 })).toThrow(/schema version/);
  });
  it('reserves consecutive server revisions for queued offline snapshots', () => {
    const serverRevision = 7;
    const reserved = [7, 8, 9].map((next) => reserveBaseRevision(serverRevision, next));
    expect(reserved).toEqual([7, 8, 9]);
    expect(() => reserveBaseRevision(7, -1)).toThrow();
  });
  it('serializes concurrent local mutations so neither update is lost', async () => {
    const mutate = createMutationQueue();
    let state = 0;
    await Promise.all([
      mutate(async () => {
        const seen = state;
        await Promise.resolve();
        state = seen + 1;
      }),
      mutate(async () => {
        const seen = state;
        await Promise.resolve();
        state = seen + 2;
      }),
    ]);
    expect(state).toBe(3);
    await expect(
      mutate(() => {
        throw new Error('expected');
      }),
    ).rejects.toThrow('expected');
    await mutate(() => {
      state += 4;
    });
    expect(state).toBe(7);
  });
  it('keeps workout snapshots separate from subsequent routine edits', () => {
    let data = base();
    const rid = data.routines[0].id;
    data = startWorkout(data, rid);
    data = addRoutine(data, 'Other');
    const started = data.workouts[0].exercises[0].exerciseId;
    expect(data.routines[0].exercises[0].exerciseId).toBe(started);
    expect(data.workouts[0].routineId).toBe(rid);
  });
  it('proposes configured double progression only after every working set reaches the range top', () => {
    let data = base();
    const prescription = data.routines[0].exercises[0];
    prescription.sets = 2;
    prescription.repRange = [8, 10];
    data = startWorkout(data, data.routines[0].id);
    const w = data.workouts[0];
    data = completeSet(data, w.id, w.exercises[0].id, w.exercises[0].actualSets[0].id);
    data = updateSet(data, w.id, w.exercises[0].id, w.exercises[0].actualSets[0].id, (s) => ({
      ...s,
      reps: 10,
    }));
    expect(progressionProposals(data, w.id)).toHaveLength(0);
    data = completeSet(data, w.id, w.exercises[0].id, w.exercises[0].actualSets[1].id);
    data = updateSet(data, w.id, w.exercises[0].id, w.exercises[0].actualSets[1].id, (s) => ({
      ...s,
      reps: 10,
    }));
    const [proposal] = progressionProposals(data, w.id);
    expect(proposal.edits[0]).toMatchObject({ op: 'update_exercise', targetWeight: 5 });
    expect(proposal.origin).toBe('progression');
  });
  it('preserves completed-set attribution when replacing an exercise mid-session', () => {
    let data = base();
    data = startWorkout(data, data.routines[0].id);
    const w = data.workouts[0],
      old = w.exercises[0],
      replacement = catalog.find((e) => e.id === 'ex_incline-dumbbell-press')!;
    data = completeSet(data, w.id, old.id, old.actualSets[0].id);
    data = replaceWorkoutExercise(data, w.id, old.id, replacement.id);
    const edited = data.workouts[0].exercises;
    expect(edited).toHaveLength(2);
    expect(edited[0].exerciseId).toBe(old.exerciseId);
    expect(edited[0].actualSets[0].status).toBe('completed');
    expect(edited[0].actualSets.slice(1).every((s) => s.status === 'skipped')).toBe(true);
    expect(edited[1].exerciseId).toBe(replacement.id);
    expect(edited[1].actualSets.every((s) => s.status === 'incomplete')).toBe(true);
  });
  it('preserves completed sets through an approved AI replacement', () => {
    let data = base();
    data = startWorkout(data, data.routines[0].id);
    const w = data.workouts[0],
      old = w.exercises[0],
      replacement = catalog.find((e) => e.id === 'ex_incline-dumbbell-press')!;
    data = completeSet(data, w.id, old.id, old.actualSets[0].id);
    const proposal: Proposal = {
      id: 'replace-ai',
      scope: 'current_workout',
      targetId: w.id,
      edits: [{ op: 'replace_exercise', exerciseId: old.id, replacementId: replacement.id }],
      rationale: 'user-approved test',
      evidenceIds: [],
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    proposal.targetFingerprint = proposalFingerprint(data, proposal);
    data = { ...data, proposals: [proposal] };
    data = applyProposal(data, proposal.id, [0]);
    expect(data.workouts[0].exercises[0].exerciseId).toBe(old.exerciseId);
    expect(data.workouts[0].exercises[0].loadMode).toBe(old.loadMode);
    expect(data.workouts[0].exercises[0].actualSets[0].status).toBe('completed');
    expect(data.workouts[0].exercises[1].exerciseId).toBe(replacement.id);
  });
  it('keeps completed work when removing a movement and updates only incomplete sets', () => {
    let data = base();
    const original = data.routines[0].exercises[0],
      extra = createPrescription(catalog.find((e) => e.id === 'ex_barbell-row')!.id);
    data = {
      ...data,
      routines: data.routines.map((r) => ({ ...r, exercises: [...r.exercises, extra] })),
    };
    data = startWorkout(data, data.routines[0].id);
    const w = data.workouts[0],
      e = w.exercises[0];
    data = completeSet(data, w.id, e.id, e.actualSets[0].id);
    data = editWorkout(data, w.id, [
      { op: 'update_exercise', exerciseId: e.id, sets: 2, repRange: [6, 8], targetWeight: 120 },
    ]);
    const sets = data.workouts[0].exercises[0].actualSets;
    expect(sets[0]).toMatchObject({ status: 'completed', weight: 0, reps: 8 });
    expect(sets.filter((s) => s.status === 'incomplete')).toHaveLength(1);
    expect(sets.find((s) => s.status === 'incomplete')).toMatchObject({ weight: 120, reps: 6 });
    data = editWorkout(data, w.id, [{ op: 'remove_exercise', exerciseId: original.id }]);
    expect(data.workouts[0].exercises[0].exerciseId).toBe(original.exerciseId);
    expect(data.workouts[0].exercises[0].actualSets[0].status).toBe('completed');
  });
  it('accepts an approved remove proposal and preserves the completed proposal in backups', () => {
    let data = base();
    const extra = createPrescription(catalog.find((e) => e.id === 'ex_barbell-row')!.id);
    data = {
      ...data,
      routines: data.routines.map((r) => ({ ...r, exercises: [...r.exercises, extra] })),
    };
    const proposal: Proposal = {
      id: 'remove-approved',
      scope: 'routine',
      targetId: data.routines[0].id,
      edits: [{ op: 'remove_exercise', exerciseId: extra.id }],
      rationale: 'remove',
      evidenceIds: [],
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    proposal.targetFingerprint = proposalFingerprint(data, proposal);
    data = { ...data, proposals: [proposal] };
    const applied = applyProposal(data, proposal.id, [0]);
    expect(applied.routines[0].exercises).toHaveLength(1);
    expect(validateBackup(applied).proposals[0].status).toBe('accepted');
  });
  it('reduces assistance after progression success', () => {
    const assisted = catalog.find((e) => e.id === 'ex_assisted-pull-up')!,
      rx = {
        ...createPrescription(assisted.id),
        sets: 1,
        repRange: [8, 8] as [number, number],
        targetWeight: 40,
      };
    let data = { ...emptyData(), routines: [{ ...createRoutine('Assist'), exercises: [rx] }] };
    data = startWorkout(data, data.routines[0].id);
    const w = data.workouts[0];
    data = completeSet(data, w.id, w.exercises[0].id, w.exercises[0].actualSets[0].id);
    const [proposal] = progressionProposals(data, w.id);
    expect(proposal.edits[0]).toMatchObject({ op: 'update_exercise', targetWeight: 35 });
  });
  it('prefills each working set from the matching most recent set', () => {
    let data = base();
    const routine = data.routines[0];
    routine.exercises[0].sets = 2;
    data = startWorkout(data, routine.id);
    let w = data.workouts[0];
    for (let i = 0; i < 2; i++) {
      const ex = w.exercises[0],
        set = ex.actualSets[i];
      data = updateSet(data, w.id, ex.id, set.id, (s) => ({
        ...s,
        weight: 80 + i * 10,
        reps: 8 + i,
      }));
      data = completeSet(data, w.id, ex.id, set.id);
    }
    data = finishWorkout(data, w.id);
    data = startWorkout(data, routine.id);
    const sets = data.workouts[1].exercises[0].actualSets;
    expect(sets.map((s) => [s.weight, s.reps])).toEqual([
      [80, 8],
      [90, 9],
    ]);
  });
  it('uses an approved progression target as the next workout baseline', () => {
    let data = base();
    const routine = data.routines[0];
    routine.exercises[0].sets = 1;
    routine.exercises[0].repRange = [8, 8];
    data = startWorkout(data, routine.id);
    const w = data.workouts[0],
      e = w.exercises[0],
      s = e.actualSets[0];
    data = updateSet(data, w.id, e.id, s.id, (x) => ({ ...x, weight: 40, reps: 8 }));
    data = completeSet(data, w.id, e.id, s.id);
    const [proposal] = progressionProposals(data, w.id);
    data = { ...data, proposals: [proposal] };
    data = applyProposal(data, proposal.id, [0]);
    data = finishWorkout(data, w.id);
    data = startWorkout(data, routine.id);
    expect(data.workouts[1].exercises[0].targetWeight).toBe(45);
    expect(data.workouts[1].exercises[0].actualSets[0].weight).toBe(45);
  });
  it('does not reuse performance recorded in a different load mode', () => {
    let data = base();
    data = startWorkout(data, data.routines[0].id);
    const w = data.workouts[0],
      e = w.exercises[0],
      s = e.actualSets[0];
    data = updateSet(data, w.id, e.id, s.id, (x) => ({
      ...x,
      weight: 40,
      reps: 8,
      loadMode: 'assistance',
    }));
    data = completeSet(data, w.id, e.id, s.id);
    data = finishWorkout(data, w.id);
    data = startWorkout(data, data.routines[0].id);
    expect(data.workouts[1].exercises[0].actualSets[0].weight).toBe(0);
    expect(data.workouts[1].exercises[0].actualSets[0].loadMode).toBe('external');
  });
  it('prefills from earlier completed performance when the latest session was finished empty', () => {
    let data = base();
    const routineId = data.routines[0].id;
    data = startWorkout(data, routineId);
    const earlier = data.workouts[0],
      exercise = earlier.exercises[0],
      set = exercise.actualSets[0];
    data = updateSet(data, earlier.id, exercise.id, set.id, (s) => ({
      ...s,
      weight: 45,
      reps: 10,
    }));
    data = completeSet(data, earlier.id, exercise.id, set.id);
    data = finishWorkout(data, earlier.id);
    data.workouts[0].startedAt = '2026-10-10T12:00:00.000Z';
    data = startWorkout(data, routineId);
    data = finishWorkout(data, data.workouts[1].id);
    data.workouts[1].startedAt = '2026-10-11T12:00:00.000Z';
    const history = JSON.stringify(data.workouts);
    data = startWorkout(data, routineId);
    expect(data.workouts[2].exercises[0].actualSets[0]).toMatchObject({ weight: 45, reps: 10 });
    expect(JSON.stringify(data.workouts.slice(0, 2))).toBe(history);
  });

  it('ignores newer warmups and mismatched load modes when selecting working-set history', () => {
    let data = base();
    const routineId = data.routines[0].id;
    data = startWorkout(data, routineId);
    const earlier = data.workouts[0],
      exercise = earlier.exercises[0],
      set = exercise.actualSets[0];
    data = updateSet(data, earlier.id, exercise.id, set.id, (s) => ({
      ...s,
      weight: 45,
      reps: 10,
    }));
    data = completeSet(data, earlier.id, exercise.id, set.id);
    data = finishWorkout(data, earlier.id);
    data.workouts[0].startedAt = '2026-10-10T12:00:00.000Z';
    data = startWorkout(data, routineId);
    const later = data.workouts[1],
      newerExercise = later.exercises[0];
    data = updateSet(data, later.id, newerExercise.id, newerExercise.actualSets[0].id, (s) => ({
      ...s,
      kind: 'warmup',
      weight: 120,
    }));
    data = completeSet(data, later.id, newerExercise.id, newerExercise.actualSets[0].id);
    data = updateSet(data, later.id, newerExercise.id, newerExercise.actualSets[1].id, (s) => ({
      ...s,
      loadMode: 'assistance',
      weight: 80,
    }));
    data = completeSet(data, later.id, newerExercise.id, newerExercise.actualSets[1].id);
    data = finishWorkout(data, later.id);
    data.workouts[1].startedAt = '2026-10-11T12:00:00.000Z';
    data = startWorkout(data, routineId);
    expect(data.workouts[2].exercises[0].actualSets[0]).toMatchObject({
      weight: 45,
      reps: 10,
      loadMode: 'external',
    });
  });
});
