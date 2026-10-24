import type {
  AppData,
  Exercise,
  LoadMode,
  Prescription,
  Proposal,
  Routine,
  TrainingEdit,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from './types';
import { catalog, catalogVersion } from './catalog';
import { trainingDateAt } from './trainingDates';
import { validateExerciseSettings } from './exerciseNotes';

export { catalog, catalogVersion } from './catalog';
export const id = (prefix = 'id') =>
  `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;
const now = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);
const modes: LoadMode[] = ['external', 'per-dumbbell', 'bodyweight', 'assistance'];
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

export function emptyData(): AppData {
  return {
    schemaVersion: 2,
    catalogVersion,
    routines: [],
    workouts: [],
    exercises: [],
    scheduledEdits: [],
    proposals: [],
    settings: {
      unit: 'lb',
      provider: 'openai',
      model: '',
      profile: {
        goals: '',
        equipment: '',
        schedule: '',
        constraints: '',
        preferences: '',
        notes: '',
      },
      increments: {},
      rotationIndex: 0,
    },
    messages: [],
    appliedProposalIds: [],
    exerciseSettings: {},
  };
}
export function createRoutine(name = 'New routine', position = 0): Routine {
  return {
    id: id('routine'),
    name: name.trim() || 'New routine',
    position,
    exercises: [],
    updatedAt: now(),
  };
}
export function createPrescription(
  exerciseId: string,
  customExercises: Exercise[] = [],
): Prescription {
  const e = [...catalog, ...customExercises].find((x) => x.id === exerciseId);
  assert(e, 'Unknown exercise');
  return {
    id: id('rx'),
    exerciseId,
    sets: 3,
    repRange: [8, 12],
    targetWeight: 0,
    restSeconds: 90,
    loadMode: e.loadMode,
  };
}
export function addCustomExercise(data: AppData, exercise: Exercise): AppData {
  assert(
    exercise.name.trim() &&
      exercise.muscles.length &&
      exercise.equipment.trim() &&
      exercise.instructions.trim(),
    'Complete all exercise details',
  );
  assert(
    modes.includes(exercise.loadMode) && ['upper', 'lower', 'full'].includes(exercise.region),
    'Invalid exercise',
  );
  assert(
    ![...catalog, ...data.exercises].some((e) => e.id === exercise.id),
    'Exercise id already exists',
  );
  return {
    ...data,
    exercises: [...data.exercises, { ...exercise, name: exercise.name.trim(), custom: true }],
  };
}
const exerciseFor = (data: AppData, id: string) =>
  data.exercises.find((e) => e.id === id) || catalog.find((e) => e.id === id);
const resolve = (ps: Prescription[], key: string) => {
  const exact = ps.findIndex((p) => p.id === key);
  if (exact >= 0) return exact;
  const found = ps.map((p, i) => (p.exerciseId === key ? i : -1)).filter((i) => i >= 0);
  assert(
    found.length === 1,
    found.length ? 'Exercise target is ambiguous' : 'Exercise target not found',
  );
  return found[0];
};
function validatePrescription(p: Partial<Prescription>): void {
  assert(Number.isInteger(p.sets) && p.sets! >= 1 && p.sets! <= 30, 'Sets must be 1–30');
  const r = p.repRange;
  assert(
    Array.isArray(r) &&
      r.length === 2 &&
      Number.isInteger(r[0]) &&
      Number.isInteger(r[1]) &&
      r[0] >= 1 &&
      r[1] >= r[0] &&
      r[1] <= 100,
    'Invalid rep range',
  );
  assert(
    Number.isFinite(p.targetWeight) && p.targetWeight! >= 0 && p.targetWeight! <= 2000,
    'Invalid target weight',
  );
  assert(
    Number.isInteger(p.restSeconds) && p.restSeconds! >= 0 && p.restSeconds! <= 3600,
    'Invalid rest period',
  );
}
export function applyEdits(
  prescriptions: Prescription[],
  edits: TrainingEdit[],
  exercises: Exercise[],
): Prescription[] {
  let ps = clone(prescriptions);
  for (const edit of edits) {
    if (edit.op === 'replace_exercise') {
      const i = resolve(ps, edit.exerciseId),
        e =
          exercises.find((x) => x.id === edit.replacementId) ||
          catalog.find((x) => x.id === edit.replacementId);
      assert(e, 'Replacement exercise not found');
      ps[i] = { ...ps[i], exerciseId: e.id, loadMode: e.loadMode };
    } else if (edit.op === 'update_exercise') {
      const i = resolve(ps, edit.exerciseId),
        p = { ...ps[i] };
      if (edit.sets !== undefined) p.sets = edit.sets;
      if (edit.repRange !== undefined) p.repRange = [...edit.repRange];
      if (edit.restSeconds !== undefined) p.restSeconds = edit.restSeconds;
      if (edit.targetWeight !== undefined) p.targetWeight = edit.targetWeight;
      validatePrescription(p);
      ps[i] = p;
    } else if (edit.op === 'add_exercise') {
      const e =
        exercises.find((x) => x.id === edit.exerciseId) ||
        catalog.find((x) => x.id === edit.exerciseId);
      assert(e, 'Exercise not found');
      const p: Prescription = {
        id: id('rx'),
        exerciseId: e.id,
        sets: edit.sets,
        repRange: [...edit.repRange],
        targetWeight: edit.targetWeight ?? 0,
        restSeconds: edit.restSeconds ?? 90,
        loadMode: e.loadMode,
      };
      validatePrescription(p);
      const i = edit.afterExerciseId ? resolve(ps, edit.afterExerciseId) + 1 : ps.length;
      ps.splice(i, 0, p);
    } else if (edit.op === 'remove_exercise') {
      ps.splice(resolve(ps, edit.exerciseId), 1);
      assert(ps.length, 'A routine must retain one exercise');
    } else {
      assert(edit.exerciseIds.length === ps.length, 'Reorder must include every exercise');
      const ordered = edit.exerciseIds.map((k) => ps[resolve(ps, k)]);
      assert(new Set(ordered.map((x) => x.id)).size === ps.length, 'Reorder contains duplicates');
      ps = ordered;
    }
  }
  return ps;
}
function recentPerformance(
  data: AppData,
  exerciseId: string,
  loadMode: LoadMode,
): { snapshot?: WorkoutExercise; sets: WorkoutSet[] } {
  const snapshot = [...data.workouts]
    .filter((w) => w.status === 'finished')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .flatMap((w) => w.exercises)
    .find(
      (e) =>
        e.exerciseId === exerciseId &&
        e.loadMode === loadMode &&
        e.actualSets.some(
          (s) => s.status === 'completed' && s.kind === 'working' && s.loadMode === loadMode,
        ),
    );
  return {
    snapshot,
    sets:
      snapshot?.actualSets.filter(
        (s) => s.status === 'completed' && s.kind === 'working' && s.loadMode === loadMode,
      ) ?? [],
  };
}
function makeWorkout(
  data: AppData,
  name: string,
  routineId: string | undefined,
  prescriptions: Prescription[],
  names: Map<string, string>,
): Workout {
  const stamp = now();
  const trainingTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    id: id('workout'),
    routineId,
    name,
    startedAt: stamp,
    trainingDate: trainingDateAt(stamp, trainingTimezone),
    trainingTimezone,
    status: 'active',
    updatedAt: stamp,
    exercises: prescriptions.map((p) => {
      const { snapshot, sets } = recentPerformance(data, p.exerciseId, p.loadMode);
      // An approved/scheduled target change is an explicit new load baseline. Keep prior reps, but honor the newly reviewed weight.
      const targetChanged =
        !!snapshot &&
        (snapshot.loadMode !== p.loadMode || snapshot.targetWeight !== p.targetWeight);
      return {
        ...clone(p),
        persistentNote: data.exerciseSettings?.[p.exerciseId]?.persistentNote,
        name: names.get(p.exerciseId) || exerciseFor(data, p.exerciseId)?.name || p.exerciseId,
        actualSets: Array.from({ length: p.sets }, (_, i) => ({
          id: id('set'),
          weight: targetChanged
            ? p.targetWeight
            : (sets[i]?.weight ?? sets.at(-1)?.weight ?? p.targetWeight),
          reps: sets[i]?.reps ?? sets.at(-1)?.reps ?? p.repRange[0],
          kind: 'working',
          status: 'incomplete',
          updatedAt: stamp,
          loadMode: p.loadMode,
        })),
      };
    }),
  };
}
export function startWorkout(data: AppData, routineId: string): AppData {
  assert(!data.workouts.some((w) => w.status === 'active'), 'Finish the active workout first');
  const routine = data.routines.find((r) => r.id === routineId);
  assert(routine, 'Routine not found');
  let ps = clone(routine.exercises);
  const scheduled = data.scheduledEdits.filter((s) => s.routineId === routine.id && !s.consumedAt);
  for (const edit of scheduled) ps = applyEdits(ps, edit.edits, [...catalog, ...data.exercises]);
  let next = {
    ...data,
    scheduledEdits: data.scheduledEdits.map((s) =>
      scheduled.some((x) => x.id === s.id) ? { ...s, consumedAt: now() } : s,
    ),
  };
  const w = makeWorkout(next, routine.name, routine.id, ps, new Map());
  return {
    ...next,
    workouts: [...next.workouts, w],
    settings: {
      ...next.settings,
      rotationIndex: (next.settings.rotationIndex + 1) % Math.max(next.routines.length, 1),
    },
  };
}
export function repeatWorkout(data: AppData, workoutId: string): AppData {
  assert(!data.workouts.some((w) => w.status === 'active'), 'Finish the active workout first');
  const old = data.workouts.find((w) => w.id === workoutId && w.status === 'finished');
  assert(old, 'Finished workout not found');
  const stamp = now();
  const workout: Workout = {
    id: id('workout'),
    name: old.name,
    routineId: undefined,
    startedAt: stamp,
    status: 'active',
    updatedAt: stamp,
    exercises: old.exercises.map((e) => ({
      ...clone(e),
      id: id('rx'),
      notes: undefined,
      feeling: undefined,
      repsInReserve: undefined,
      actualSets: e.actualSets.map((s) => ({
        id: id('set'),
        weight: s.weight,
        reps: s.reps,
        kind: s.kind,
        status: 'incomplete',
        updatedAt: stamp,
        loadMode: s.loadMode,
      })),
    })),
  };
  return { ...data, workouts: [...data.workouts, workout] };
}
export function completeSet(
  data: AppData,
  workoutId: string,
  exerciseId: string,
  setId: string,
): AppData {
  const workout = data.workouts.find((x) => x.id === workoutId);
  assert(workout?.status === 'active', 'Only an active workout can complete sets');
  const exact = workout.exercises.find((e) => e.id === exerciseId);
  const matches = exact ? [exact] : workout.exercises.filter((e) => e.exerciseId === exerciseId);
  assert(matches.length === 1, 'Workout exercise target is missing or ambiguous');
  const set = matches[0].actualSets.find((s) => s.id === setId);
  assert(set, 'Set not found');
  if (set.status === 'completed') return data;
  const updated = updateSet(data, workoutId, exerciseId, setId, (s) => ({
      ...s,
      status: 'completed',
      completedAt: now(),
    })),
    w = updated.workouts.find((x) => x.id === workoutId)!;
  const ex = w.exercises.find((x) => x.id === exerciseId || x.exerciseId === exerciseId)!;
  return {
    ...updated,
    workouts: updated.workouts.map((x) =>
      x.id === workoutId
        ? { ...x, restEndsAt: Date.now() + ex.restSeconds * 1000, restSetId: setId }
        : x,
    ),
  };
}
/** Checkbox logging is idempotent and historical corrections never start a timer. */
export function setDone(
  data: AppData,
  workoutId: string,
  exerciseId: string,
  setId: string,
  done: boolean,
): AppData {
  const workout = data.workouts.find((w) => w.id === workoutId);
  assert(workout, 'Workout not found');
  const exact = workout.exercises.find((e) => e.id === exerciseId);
  const matches = exact ? [exact] : workout.exercises.filter((e) => e.exerciseId === exerciseId);
  assert(matches.length === 1, 'Workout exercise target is missing or ambiguous');
  const set = matches[0].actualSets.find((s) => s.id === setId);
  assert(set, 'Set not found');
  if ((set.status === 'completed') === done) return data;
  if (done && workout.status === 'active') return completeSet(data, workoutId, exerciseId, setId);
  return updateSet(data, workoutId, exerciseId, setId, (s) => ({
    ...s,
    status: done ? 'completed' : 'incomplete',
    completedAt: done ? now() : undefined,
  }));
}
export function updateSet(
  data: AppData,
  workoutId: string,
  exerciseId: string,
  setId: string,
  change: (set: WorkoutSet) => WorkoutSet,
): AppData {
  const w = data.workouts.find((x) => x.id === workoutId);
  assert(w, 'Workout not found');
  const exact = w.exercises.find((x) => x.id === exerciseId),
    matches = exact ? [exact] : w.exercises.filter((x) => x.exerciseId === exerciseId);
  assert(
    matches.length === 1,
    matches.length ? 'Workout exercise target is ambiguous' : 'Workout exercise not found',
  );
  const ex = matches[0];
  const setIndex = ex.actualSets.findIndex((x) => x.id === setId),
    set = ex.actualSets[setIndex];
  assert(set, 'Set not found');
  const changed = change(set);
  assert(
    Number.isFinite(changed.weight) &&
      changed.weight >= 0 &&
      changed.weight <= 2000 &&
      Number.isInteger(changed.reps) &&
      changed.reps >= 0 &&
      changed.reps <= 1000 &&
      modes.includes(changed.loadMode) &&
      ['working', 'warmup'].includes(changed.kind) &&
      ['incomplete', 'completed', 'skipped'].includes(changed.status),
    'Invalid set values',
  );
  const stamp = now(),
    propagate =
      w.status === 'active' &&
      set.status === 'incomplete' &&
      set.kind === 'working' &&
      changed.status === 'incomplete' &&
      changed.weight !== set.weight;
  const latestCompleted = w.exercises
    .flatMap((e) => e.actualSets)
    .filter((s) => s.status === 'completed' && s.completedAt)
    .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))[0];
  const clearsRest =
    w.status === 'active' &&
    set.status === 'completed' &&
    changed.status !== 'completed' &&
    (w.restSetId === setId || (!w.restSetId && latestCompleted?.id === setId));
  return {
    ...data,
    workouts: data.workouts.map((x) =>
      x.id !== workoutId
        ? x
        : {
            ...x,
            restEndsAt: clearsRest ? undefined : x.restEndsAt,
            restSetId: clearsRest ? undefined : x.restSetId,
            updatedAt: stamp,
            exercises: x.exercises.map((y) =>
              y !== ex
                ? y
                : {
                    ...y,
                    actualSets: y.actualSets.map((z, i) =>
                      z.id === setId
                        ? { ...changed, updatedAt: stamp }
                        : propagate &&
                            i > setIndex &&
                            z.kind === 'working' &&
                            z.status === 'incomplete' &&
                            z.weight === set.weight
                          ? { ...z, weight: changed.weight, updatedAt: stamp }
                          : z,
                    ),
                  },
            ),
          },
    ),
  };
}
export function addWorkoutSet(
  data: AppData,
  workoutId: string,
  exerciseId: string,
  kind: 'working' | 'warmup' = 'working',
): AppData {
  const w = data.workouts.find((x) => x.id === workoutId);
  assert(w?.status === 'active', 'Workout is not active');
  const exact = w.exercises.find((e) => e.id === exerciseId),
    matches = exact ? [exact] : w.exercises.filter((e) => e.exerciseId === exerciseId);
  assert(matches.length === 1, 'Workout exercise target is missing or ambiguous');
  const e = matches[0],
    stamp = now(),
    prior = e.actualSets.filter((s) => s.kind === kind);
  return {
    ...data,
    workouts: data.workouts.map((x) =>
      x.id !== workoutId
        ? x
        : {
            ...x,
            updatedAt: stamp,
            exercises: x.exercises.map((y) =>
              y !== e
                ? y
                : {
                    ...y,
                    actualSets: [
                      ...y.actualSets,
                      {
                        id: id('set'),
                        weight: prior.at(-1)?.weight ?? e.targetWeight,
                        reps: e.repRange[0],
                        kind,
                        status: 'incomplete',
                        updatedAt: stamp,
                        loadMode: e.loadMode,
                      },
                    ],
                  },
            ),
          },
    ),
  };
}
export function skipSet(
  data: AppData,
  workoutId: string,
  exerciseId: string,
  setId: string,
): AppData {
  return updateSet(data, workoutId, exerciseId, setId, (s) => ({
    ...s,
    status: 'skipped',
    completedAt: undefined,
  }));
}
/** Feedback belongs to this session snapshot and uses the normal durable transaction. */
export function updateWorkoutFeedback(
  data: AppData,
  workoutId: string,
  feedback: { notes?: string; feeling?: string; repsInReserve?: WorkoutExercise['repsInReserve'] },
  exerciseId?: string,
): AppData {
  const workout = data.workouts.find((w) => w.id === workoutId);
  assert(workout, 'Workout not found');
  assert(feedback.notes === undefined || typeof feedback.notes === 'string', 'Invalid notes');
  assert(feedback.feeling === undefined || typeof feedback.feeling === 'string', 'Invalid feeling');
  const updated = clone(workout);
  const exercise =
    exerciseId === undefined ? undefined : updated.exercises.find((e) => e.id === exerciseId);
  if (exerciseId !== undefined) {
    assert(exercise, 'Workout exercise not found');
    assert(
      feedback.feeling === undefined || ['easy', 'good', 'hard'].includes(feedback.feeling),
      'Invalid exercise feeling',
    );
  }
  if ('repsInReserve' in feedback) {
    assert(exercise, 'Effort belongs to an exercise');
    assert(
      feedback.repsInReserve === undefined || ['3+', '1-2', '0'].includes(feedback.repsInReserve),
      'Invalid reps in reserve',
    );
    exercise.repsInReserve = feedback.repsInReserve;
  }
  if ('notes' in feedback) (exercise ?? updated).notes = feedback.notes;
  if ('feeling' in feedback) {
    if (exercise) exercise.feeling = feedback.feeling as WorkoutExercise['feeling'];
    else updated.feeling = feedback.feeling;
  }
  updated.updatedAt = now();
  return {
    ...data,
    workouts: data.workouts.map((w) => (w.id === workoutId ? updated : w)),
  };
}

export function previousExerciseNote(data: AppData, workoutId: string, exerciseId: string) {
  const current = data.workouts.find((w) => w.id === workoutId);
  const exercise = current?.exercises.find((e) => e.id === exerciseId);
  if (!current || !exercise) return undefined;
  for (const w of priorWorkouts(data, current)) {
    const match = w.exercises.find(
      (e) =>
        e.exerciseId === exercise.exerciseId && e.actualSets.some((s) => s.status === 'completed'),
    );
    if (match)
      return match.notes?.trim() ? { notes: match.notes, startedAt: w.startedAt } : undefined;
  }
  return undefined;
}

export function previousWorkoutNote(data: AppData, workoutId: string) {
  const current = data.workouts.find((w) => w.id === workoutId);
  if (!current) return undefined;
  const match = priorWorkouts(data, current).find((w) =>
    current.routineId ? w.routineId === current.routineId : w.name === current.name,
  );
  return match?.notes?.trim() ? { notes: match.notes, startedAt: match.startedAt } : undefined;
}

function priorWorkouts(data: AppData, current: Workout) {
  return data.workouts
    .filter(
      (w) =>
        w.id !== current.id &&
        w.status === 'finished' &&
        Date.parse(w.startedAt) <= Date.parse(current.startedAt),
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function finishWorkout(
  data: AppData,
  workoutId: string,
  feeling?: string,
  notes?: string,
): AppData {
  assert(
    data.workouts.some((w) => w.id === workoutId && w.status === 'active'),
    'Active workout not found',
  );
  const stamp = now();
  return {
    ...data,
    workouts: data.workouts.map((w) =>
      w.id !== workoutId
        ? w
        : {
            ...w,
            status: 'finished',
            completedAt: stamp,
            updatedAt: stamp,
            restEndsAt: undefined,
            restSetId: undefined,
            feeling: feeling ?? w.feeling,
            notes: notes ?? w.notes,
            exercises: w.exercises.map((e) => ({
              ...e,
              actualSets: e.actualSets.map((s) =>
                s.status === 'incomplete' ? { ...s, status: 'incomplete' } : s,
              ),
            })),
          },
    ),
  };
}

export function discardWorkout(data: AppData, workoutId: string): AppData {
  const workout = data.workouts.find((w) => w.id === workoutId && w.status === 'active');
  if (!workout) return data;
  return {
    ...data,
    workouts: data.workouts.filter((w) => w.id !== workoutId),
    proposals: data.proposals.map((proposal) =>
      proposal.scope === 'current_workout' &&
      proposal.targetId === workoutId &&
      proposal.status === 'pending'
        ? { ...proposal, status: 'rejected' }
        : proposal,
    ),
  };
}
export function proposalFingerprint(data: AppData, proposal: Proposal): string {
  if (proposal.preference)
    return JSON.stringify({
      field: proposal.preference.field,
      value: data.settings.profile[proposal.preference.field],
    });
  if (proposal.customExercise)
    return JSON.stringify({
      id: proposal.customExercise.id,
      existing: data.exercises.find((e) => e.id === proposal.customExercise!.id) || null,
    });
  if (proposal.routineDraft) {
    const found = data.routines.find((r) => r.id === proposal.routineDraft!.id);
    return JSON.stringify({ draftId: proposal.routineDraft.id, existing: found || null });
  }
  if (proposal.scope === 'routine' || proposal.scope === 'next_workout') {
    const r = data.routines.find((x) => x.id === proposal.targetId);
    return JSON.stringify(r ? { id: r.id, exercises: r.exercises } : null);
  }
  const w = data.workouts.find((x) => x.id === proposal.targetId && x.status === 'active');
  return JSON.stringify(w ? { id: w.id, exercises: w.exercises } : null);
}
export function progressionProposals(data: AppData, workoutId: string): Proposal[] {
  const w = data.workouts.find((x) => x.id === workoutId);
  if (!w?.routineId) return [];
  const routineId = w.routineId,
    routine = data.routines.find((r) => r.id === routineId);
  if (!routine) return [];
  return w.exercises.flatMap((e) => {
    const working = e.actualSets.filter((s) => s.kind === 'working');
    if (!working.length || working.some((s) => s.status !== 'completed' || s.reps < e.repRange[1]))
      return [];
    const exact = routine.exercises.find((p) => p.id === e.id),
      matches = routine.exercises.filter((p) => p.exerciseId === e.exerciseId),
      prescription = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (!prescription) return [];
    const inc =
      data.settings.increments[e.exerciseId] ??
      (exerciseFor(data, e.exerciseId)?.region === 'lower' ? 10 : 5);
    const base = prescription.targetWeight > 0 ? prescription.targetWeight : working[0].weight,
      proposedWeight = e.loadMode === 'assistance' ? Math.max(0, base - inc) : base + inc;
    if (
      data.proposals.some(
        (p) =>
          p.status === 'pending' &&
          p.scope === 'routine' &&
          p.targetId === routineId &&
          p.edits.some(
            (edit) =>
              edit.op === 'update_exercise' &&
              edit.exerciseId === prescription.id &&
              edit.targetWeight === proposedWeight,
          ),
      )
    )
      return [];
    const p: Proposal = {
      id: id('proposal'),
      scope: 'routine',
      targetId: routineId,
      edits: [{ op: 'update_exercise', exerciseId: prescription.id, targetWeight: proposedWeight }],
      rationale:
        e.loadMode === 'assistance'
          ? `All working sets reached ${e.repRange[1]} reps. Reduce assistance to ${proposedWeight} lb.`
          : `All working sets reached ${e.repRange[1]} reps.`,
      evidenceIds: [],
      status: 'pending',
      createdAt: now(),
      origin: 'progression',
    };
    p.targetFingerprint = proposalFingerprint(data, p);
    return [p];
  });
}
export function applyProposal(
  data: AppData,
  proposalId: string,
  selectedIndices: number[],
): AppData {
  if (data.appliedProposalIds.includes(proposalId)) return data;
  const prop = data.proposals.find((p) => p.id === proposalId);
  assert(prop && prop.status === 'pending', 'Proposal is not pending');
  assert(
    prop.targetFingerprint && prop.targetFingerprint === proposalFingerprint(data, prop),
    'Proposal target changed or is missing its review fingerprint',
  );
  const unique = [...new Set(selectedIndices)];
  const draftOnly =
    Boolean(prop.routineDraft) && prop.edits.length === 0 && unique.length === 1 && unique[0] === 0;
  const durableOnly =
    Boolean(prop.preference || prop.customExercise) &&
    prop.edits.length === 0 &&
    unique.length === 1 &&
    unique[0] === 0;
  assert(
    draftOnly ||
      durableOnly ||
      (unique.length > 0 &&
        unique.every((i) => Number.isInteger(i) && i >= 0 && i < prop.edits.length)),
    'Select at least one valid change',
  );
  let result = clone(data);
  const chosen = draftOnly || durableOnly ? [] : unique.map((i) => prop.edits[i]);
  if (prop.routineDraft) {
    assert(
      !result.routines.some((r) => r.id === prop.routineDraft!.id),
      'Proposed routine already exists',
    );
    const draft = clone(prop.routineDraft);
    draft.exercises = applyEdits(draft.exercises, chosen, [...catalog, ...result.exercises]);
    draft.position =
      Number.isInteger(draft.position) && draft.position >= 0
        ? draft.position
        : result.routines.length;
    draft.updatedAt = now();
    result.routines.push(draft);
  } else if (prop.preference || prop.customExercise) {
    assert(unique.length === 1 && unique[0] === 0, 'Select the proposed preference or exercise');
    result = approveDurableProposal(data, proposalId);
  } else if (prop.scope === 'routine') {
    const routine = result.routines.find((r) => r.id === prop.targetId);
    assert(routine, 'Routine not found');
    routine.exercises = applyEdits(routine.exercises, chosen, [...catalog, ...result.exercises]);
    routine.updatedAt = now();
  } else if (prop.scope === 'next_workout') {
    const routine = result.routines.find((r) => r.id === prop.targetId);
    assert(routine, 'Routine not found');
    result.scheduledEdits.push({ id: id('scheduled'), routineId: prop.targetId, edits: chosen });
  } else {
    result = editWorkout(result, prop.targetId, chosen);
  }
  const current = result.proposals.find((p) => p.id === proposalId)!;
  current.status = 'accepted';
  current.acceptedIndices = unique;
  if (!result.appliedProposalIds.includes(proposalId)) result.appliedProposalIds.push(proposalId);
  return result;
}
export function rejectProposal(data: AppData, proposalId: string): AppData {
  return {
    ...data,
    proposals: data.proposals.map((p) => (p.id === proposalId ? { ...p, status: 'rejected' } : p)),
  };
}
export function approveDurableProposal(data: AppData, proposalId: string): AppData {
  const p = data.proposals.find((x) => x.id === proposalId);
  assert(p?.status === 'pending', 'Proposal is not pending');
  assert(
    p.targetFingerprint && p.targetFingerprint === proposalFingerprint(data, p),
    'Proposal target changed or is missing its review fingerprint',
  );
  if (p.routineDraft)
    return applyProposal(data, proposalId, p.edits.length ? p.edits.map((_, i) => i) : [0]);
  if (p.preference) {
    assert(
      ['goals', 'equipment', 'schedule', 'constraints', 'preferences', 'notes'].includes(
        p.preference.field,
      ),
      'Invalid preference field',
    );
    return {
      ...data,
      settings: {
        ...data.settings,
        profile: { ...data.settings.profile, [p.preference.field]: p.preference.value },
      },
      proposals: data.proposals.map((x) =>
        x.id === proposalId ? { ...x, status: 'accepted' } : x,
      ),
      appliedProposalIds: [...data.appliedProposalIds, proposalId],
    };
  }
  if (p.customExercise) {
    const d = addCustomExercise(data, p.customExercise);
    return {
      ...d,
      proposals: d.proposals.map((x) => (x.id === proposalId ? { ...x, status: 'accepted' } : x)),
      appliedProposalIds: [...d.appliedProposalIds, proposalId],
    };
  }
  return applyProposal(
    data,
    proposalId,
    p.edits.map((_, i) => i),
  );
}
export function toDisplayWeight(lb: number, unit: 'lb' | 'kg'): number {
  return unit === 'kg' ? Math.round((lb / 2.2046226218) * 10) / 10 : lb;
}
export function fromDisplayWeight(value: number, unit: 'lb' | 'kg'): number {
  assert(Number.isFinite(value) && value >= 0, 'Invalid weight');
  return unit === 'kg' ? Math.round(value * 2.2046226218 * 100) / 100 : value;
}
export function addRoutine(data: AppData, name: string): AppData {
  return { ...data, routines: [...data.routines, createRoutine(name, data.routines.length)] };
}
export function deleteRoutine(data: AppData, routineId: string): AppData {
  assert(
    data.routines.some((r) => r.id === routineId),
    'Routine not found',
  );
  const currentIndex = data.settings.rotationIndex % data.routines.length;
  const nextRoutine = data.routines[currentIndex];
  const routines = data.routines
    .filter((r) => r.id !== routineId)
    .map((r, position) => ({ ...r, position }));
  const survivingIndex = routines.findIndex((r) => r.id === nextRoutine.id);
  const rotationIndex = routines.length
    ? survivingIndex >= 0
      ? survivingIndex
      : currentIndex % routines.length
    : 0;
  return {
    ...data,
    routines,
    settings: { ...data.settings, rotationIndex },
    scheduledEdits: data.scheduledEdits.filter((s) => s.routineId !== routineId),
    proposals: data.proposals.map((p) =>
      p.status === 'pending' && p.targetId === routineId ? { ...p, status: 'rejected' } : p,
    ),
  };
}
export function editRoutine(
  data: AppData,
  routineId: string,
  edits: TrainingEdit[],
  name?: string,
): AppData {
  const r = data.routines.find((x) => x.id === routineId);
  assert(r, 'Routine not found');
  return {
    ...data,
    routines: data.routines.map((x) =>
      x.id !== routineId
        ? x
        : {
            ...x,
            name: name?.trim() || x.name,
            exercises: applyEdits(x.exercises, edits, [...catalog, ...data.exercises]),
            updatedAt: now(),
          },
    ),
  };
}
export function editWorkout(data: AppData, workoutId: string, edits: TrainingEdit[]): AppData {
  const source = data.workouts.find((w) => w.id === workoutId && w.status === 'active');
  assert(source, 'Active workout not found');
  const workout = clone(source),
    library = [...catalog, ...data.exercises];
  const findIndex = (key: string) => resolve(workout.exercises, key);
  for (const edit of edits) {
    if (edit.op === 'replace_exercise') {
      const index = findIndex(edit.exerciseId),
        old = workout.exercises[index],
        replacement = library.find((e) => e.id === edit.replacementId);
      assert(replacement, 'Replacement exercise not found');
      const alreadyLogged = old.actualSets.some((s) => s.status === 'completed');
      if (alreadyLogged) {
        old.actualSets = old.actualSets.map((s) =>
          s.status === 'incomplete' ? { ...s, status: 'skipped', updatedAt: now() } : s,
        );
        const count = old.actualSets.filter((s) => s.kind === 'working').length || old.sets,
          rx = createPrescription(replacement.id, data.exercises);
        const fresh: WorkoutExercise = {
          ...rx,
          id: id('rx'),
          sets: count,
          repRange: [...old.repRange],
          targetWeight: 0,
          restSeconds: old.restSeconds,
          name: replacement.name,
          persistentNote: data.exerciseSettings?.[replacement.id]?.persistentNote,
          actualSets: Array.from({ length: count }, () => ({
            id: id('set'),
            weight: 0,
            reps: old.repRange[0],
            kind: 'working',
            status: 'incomplete',
            updatedAt: now(),
            loadMode: replacement.loadMode,
          })),
        };
        workout.exercises.splice(index + 1, 0, fresh);
      } else {
        const count = old.actualSets.filter((s) => s.kind === 'working').length || old.sets;
        const rx = createPrescription(replacement.id, data.exercises);
        workout.exercises[index] = {
          ...rx,
          id: old.id,
          sets: count,
          repRange: [...old.repRange],
          targetWeight: 0,
          restSeconds: old.restSeconds,
          name: replacement.name,
          persistentNote: data.exerciseSettings?.[replacement.id]?.persistentNote,
          actualSets: Array.from({ length: count }, () => ({
            id: id('set'),
            weight: 0,
            reps: old.repRange[0],
            kind: 'working',
            status: 'incomplete',
            updatedAt: now(),
            loadMode: replacement.loadMode,
          })),
        };
      }
    } else if (edit.op === 'remove_exercise') {
      const index = findIndex(edit.exerciseId),
        exercise = workout.exercises[index];
      if (exercise.actualSets.some((s) => s.status === 'completed'))
        exercise.actualSets = exercise.actualSets.map((s) =>
          s.status === 'incomplete' ? { ...s, status: 'skipped', updatedAt: now() } : s,
        );
      else workout.exercises.splice(index, 1);
    } else if (edit.op === 'add_exercise') {
      const index = edit.afterExerciseId
          ? findIndex(edit.afterExerciseId) + 1
          : workout.exercises.length,
        added = applyEdits([], [{ ...edit, afterExerciseId: undefined }], library)[0],
        exercise = library.find((e) => e.id === added.exerciseId)!;
      const fresh: WorkoutExercise = {
        ...added,
        name: exercise.name,
        persistentNote: data.exerciseSettings?.[exercise.id]?.persistentNote,
        actualSets: Array.from({ length: added.sets }, () => ({
          id: id('set'),
          weight: added.targetWeight,
          reps: added.repRange[0],
          kind: 'working',
          status: 'incomplete',
          updatedAt: now(),
          loadMode: added.loadMode,
        })),
      };
      workout.exercises.splice(index, 0, fresh);
    } else if (edit.op === 'update_exercise') {
      const index = findIndex(edit.exerciseId),
        previous = workout.exercises[index],
        prescription = applyEdits([previous], [edit], library)[0],
        sets = previous.actualSets.map((s) =>
          s.status !== 'incomplete' || s.kind !== 'working'
            ? s
            : {
                ...s,
                weight: edit.targetWeight === undefined ? s.weight : prescription.targetWeight,
                reps: edit.repRange === undefined ? s.reps : prescription.repRange[0],
                updatedAt: now(),
              },
        );
      let remaining =
        prescription.sets -
        sets.filter((s) => s.kind === 'working' && s.status === 'completed').length;
      if (edit.sets !== undefined)
        for (let i = 0; i < sets.length; i++)
          if (sets[i].kind === 'working' && sets[i].status === 'incomplete') {
            if (remaining <= 0) sets[i] = { ...sets[i], status: 'skipped', updatedAt: now() };
            else remaining--;
          }
      while (
        edit.sets !== undefined &&
        sets.filter((s) => s.kind === 'working' && s.status !== 'skipped').length <
          prescription.sets
      )
        sets.push({
          id: id('set'),
          weight: prescription.targetWeight,
          reps: prescription.repRange[0],
          kind: 'working',
          status: 'incomplete',
          updatedAt: now(),
          loadMode: prescription.loadMode,
        });
      workout.exercises[index] = { ...previous, ...prescription, actualSets: sets };
    } else {
      const ordered = applyEdits(workout.exercises, [edit], library),
        byId = new Map(workout.exercises.map((e) => [e.id, e]));
      workout.exercises = ordered.map((p) => ({ ...byId.get(p.id)!, ...p }));
    }
  }
  workout.updatedAt = now();
  return { ...data, workouts: data.workouts.map((w) => (w.id === workoutId ? workout : w)) };
}
export function replaceWorkoutExercise(
  data: AppData,
  workoutId: string,
  prescriptionId: string,
  replacementId: string,
): AppData {
  return editWorkout(data, workoutId, [
    { op: 'replace_exercise', exerciseId: prescriptionId, replacementId },
  ]);
}
export function reorderExercises(data: AppData, workoutId: string, ids: string[]): AppData {
  const w = data.workouts.find((x) => x.id === workoutId);
  assert(w, 'Workout not found');
  const ordered = applyEdits(
    w.exercises,
    [{ op: 'reorder_exercises', exerciseIds: ids }],
    [...catalog, ...data.exercises],
  );
  const byId = new Map(w.exercises.map((e) => [e.id, e]));
  return {
    ...data,
    workouts: data.workouts.map((x) =>
      x.id !== workoutId
        ? x
        : { ...x, exercises: ordered.map((p) => ({ ...byId.get(p.id)!, ...p })), updatedAt: now() },
    ),
  };
}
export function scheduleEdit(data: AppData, routineId: string, edits: TrainingEdit[]): AppData {
  assert(
    data.routines.some((r) => r.id === routineId),
    'Routine not found',
  );
  applyEdits(data.routines.find((r) => r.id === routineId)!.exercises, edits, [
    ...catalog,
    ...data.exercises,
  ]);
  return {
    ...data,
    scheduledEdits: [
      ...data.scheduledEdits,
      { id: id('scheduled'), routineId, edits: clone(edits) },
    ],
  };
}
export function validateBackup(input: unknown): AppData {
  const fail = (m: string): never => {
    throw new Error(`Invalid backup: ${m}`);
  };
  const record = (v: unknown): v is Record<string, any> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const isExercise = (v: unknown): v is Exercise =>
    record(v) &&
    typeof v.id === 'string' &&
    !!v.id &&
    typeof v.name === 'string' &&
    !!v.name &&
    Array.isArray(v.muscles) &&
    v.muscles.length > 0 &&
    v.muscles.every((m: unknown) => typeof m === 'string' && !!m) &&
    typeof v.equipment === 'string' &&
    !!v.equipment &&
    typeof v.instructions === 'string' &&
    !!v.instructions &&
    modes.includes(v.loadMode) &&
    ['upper', 'lower', 'full'].includes(v.region);
  const validEdit = (v: unknown): v is TrainingEdit => {
    if (!record(v) || typeof v.op !== 'string') return false;
    const key = (k: unknown) => typeof k === 'string' && !!k;
    const validRange = (r: unknown) =>
      Array.isArray(r) &&
      r.length === 2 &&
      Number.isInteger(r[0]) &&
      r[0] >= 1 &&
      Number.isInteger(r[1]) &&
      r[1] >= r[0] &&
      r[1] <= 100;
    switch (v.op) {
      case 'replace_exercise':
        return key(v.exerciseId) && key(v.replacementId);
      case 'update_exercise':
        return (
          key(v.exerciseId) &&
          (v.sets === undefined || (Number.isInteger(v.sets) && v.sets >= 1 && v.sets <= 30)) &&
          (v.repRange === undefined || validRange(v.repRange)) &&
          (v.restSeconds === undefined ||
            (Number.isInteger(v.restSeconds) && v.restSeconds >= 0 && v.restSeconds <= 3600)) &&
          (v.targetWeight === undefined ||
            (Number.isFinite(v.targetWeight) && v.targetWeight >= 0 && v.targetWeight <= 2000)) &&
          (v.sets !== undefined ||
            v.repRange !== undefined ||
            v.restSeconds !== undefined ||
            v.targetWeight !== undefined)
        );
      case 'add_exercise':
        return (
          key(v.exerciseId) &&
          (v.afterExerciseId === undefined || key(v.afterExerciseId)) &&
          Number.isInteger(v.sets) &&
          v.sets >= 1 &&
          v.sets <= 30 &&
          validRange(v.repRange) &&
          (v.targetWeight === undefined ||
            (Number.isFinite(v.targetWeight) && v.targetWeight >= 0 && v.targetWeight <= 2000)) &&
          (v.restSeconds === undefined ||
            (Number.isInteger(v.restSeconds) && v.restSeconds >= 0 && v.restSeconds <= 3600))
        );
      case 'remove_exercise':
        return key(v.exerciseId);
      case 'reorder_exercises':
        return Array.isArray(v.exerciseIds) && v.exerciseIds.every(key);
      default:
        return false;
    }
  };
  if (!record(input)) return fail('expected object');
  const d = input as unknown as AppData;
  if (d.schemaVersion !== 1 && d.schemaVersion !== 2) return fail('unsupported schema version');
  if (d.catalogVersion !== catalogVersion) return fail('unsupported exercise catalog version');
  for (const k of [
    'routines',
    'workouts',
    'exercises',
    'scheduledEdits',
    'proposals',
    'messages',
    'appliedProposalIds',
  ] as const)
    if (!Array.isArray(d[k])) fail(`${k} must be an array`);
  const text = (v: unknown) => typeof v === 'string';
  if (
    !record(d.settings) ||
    !['lb', 'kg'].includes(d.settings.unit) ||
    !['openai', 'anthropic'].includes(d.settings.provider) ||
    !text(d.settings.model) ||
    !record(d.settings.profile) ||
    !Number.isInteger(d.settings.rotationIndex) ||
    d.settings.rotationIndex < 0 ||
    !record(d.settings.increments)
  )
    fail('invalid settings');
  for (const field of [
    'goals',
    'equipment',
    'schedule',
    'constraints',
    'preferences',
    'notes',
  ] as const)
    if (!text(d.settings.profile[field])) fail(`invalid profile ${field}`);
  for (const value of Object.values(d.settings.increments))
    if (!Number.isFinite(value) || value <= 0 || value > 100) fail('invalid progression increment');
  if (!d.exercises.every(isExercise)) fail('invalid exercise');
  const all = [...catalog, ...d.exercises],
    exIds = new Set<string>();
  for (const e of all) {
    if (exIds.has(e.id)) fail(`duplicate exercise id ${e.id}`);
    exIds.add(e.id);
  }
  const unique = (values: unknown[], label: string) => {
    const seen = new Set<string>();
    for (const v of values) {
      if (typeof v !== 'string' || !v || seen.has(v)) fail(`duplicate or empty ${label} id`);
      seen.add(v as string);
    }
  };
  for (const [key, list] of [
    ['routines', d.routines],
    ['workouts', d.workouts],
    ['exercises', d.exercises],
    ['scheduled edits', d.scheduledEdits],
    ['proposals', d.proposals],
    ['messages', d.messages],
  ] as const)
    if (!list.every(record)) fail(`${key} must contain objects`);
  unique(
    d.routines.map((x) => x.id),
    'routine',
  );
  unique(
    d.workouts.map((x) => x.id),
    'workout',
  );
  unique(
    d.exercises.map((x) => x.id),
    'exercise',
  );
  unique(
    d.scheduledEdits.map((x) => x.id),
    'scheduled edit',
  );
  unique(
    d.proposals.map((x) => x.id),
    'proposal',
  );
  unique(
    d.messages.map((x) => x.id),
    'message',
  );
  unique(d.appliedProposalIds, 'applied proposal');
  const routineIds = new Set(d.routines.map((r) => r.id)),
    workoutIds = new Set(d.workouts.map((w) => w.id));
  const validateRoutine = (r: unknown) => {
    if (!record(r)) return fail('invalid routine');
    const routine = r as Record<string, any>;
    if (
      typeof routine.id !== 'string' ||
      !routine.id ||
      typeof routine.name !== 'string' ||
      !routine.name.trim() ||
      !Number.isInteger(routine.position) ||
      routine.position < 0 ||
      !Array.isArray(routine.exercises) ||
      typeof routine.updatedAt !== 'string' ||
      Number.isNaN(Date.parse(routine.updatedAt))
    )
      fail('invalid routine');
    unique(
      routine.exercises.map((x: unknown) => (record(x) ? x.id : undefined)),
      `prescription in ${routine.id}`,
    );
    for (const p of routine.exercises) {
      if (!record(p) || typeof p.exerciseId !== 'string' || !exIds.has(p.exerciseId))
        fail('unknown routine exercise');
      try {
        validatePrescription(p);
      } catch (e) {
        return fail((e as Error).message);
      }
      if (!modes.includes(p.loadMode)) fail('invalid prescription load mode');
    }
    return routine as unknown as Routine;
  };
  for (const r of d.routines) validateRoutine(r);
  let activeCount = 0;
  for (const w of d.workouts) {
    if (
      w.trainingDate !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(w.trainingDate) ||
        Number.isNaN(Date.parse(`${w.trainingDate}T12:00:00Z`)) ||
        new Date(`${w.trainingDate}T12:00:00Z`).toISOString().slice(0, 10) !== w.trainingDate)
    )
      fail('invalid training date');
    if (w.trainingTimezone !== undefined) {
      try {
        if (typeof w.trainingTimezone !== 'string' || !w.trainingTimezone)
          fail('invalid training timezone');
        new Intl.DateTimeFormat('en-US', { timeZone: w.trainingTimezone });
      } catch {
        fail('invalid training timezone');
      }
    }
    if (
      w.communityVisibility !== undefined &&
      (!record(w.communityVisibility) ||
        !['private', 'community'].includes(w.communityVisibility.visibility) ||
        !Number.isInteger(w.communityVisibility.policyRevision) ||
        w.communityVisibility.policyRevision < 0)
    )
      fail('invalid workout visibility');
    if (
      typeof w.id !== 'string' ||
      !w.id ||
      !text(w.name) ||
      !w.name ||
      !text(w.startedAt) ||
      (w.notes !== undefined && !text(w.notes)) ||
      (w.feeling !== undefined && !text(w.feeling)) ||
      Number.isNaN(Date.parse(w.startedAt)) ||
      !['active', 'finished'].includes(w.status) ||
      !Array.isArray(w.exercises) ||
      !text(w.updatedAt) ||
      Number.isNaN(Date.parse(w.updatedAt))
    )
      fail('invalid workout');
    if (w.status === 'active') activeCount++;
    if (w.status === 'finished' && (!w.completedAt || Number.isNaN(Date.parse(w.completedAt))))
      fail('finished workout missing completion time');
    if (w.status === 'active' && w.completedAt) fail('active workout cannot have completion time');
    unique(
      w.exercises.map((e) => (record(e) ? e.id : undefined)),
      `exercise snapshot in ${w.id}`,
    );
    for (const e of w.exercises) {
      if (
        !record(e) ||
        !e.exerciseId ||
        !e.name ||
        (e.notes !== undefined && !text(e.notes)) ||
        (e.feeling !== undefined && !['easy', 'good', 'hard'].includes(e.feeling)) ||
        (e.repsInReserve !== undefined && !['3+', '1-2', '0'].includes(e.repsInReserve)) ||
        !Array.isArray(e.actualSets) ||
        !modes.includes(e.loadMode)
      )
        fail('invalid workout exercise');
      if (
        e.persistentNote !== undefined &&
        (typeof e.persistentNote !== 'string' || e.persistentNote.length > 2000)
      )
        fail('invalid persistent exercise note');
      try {
        validatePrescription(e);
      } catch (err) {
        return fail((err as Error).message);
      }
      unique(
        e.actualSets.map((s) => (record(s) ? s.id : undefined)),
        `set in ${e.id}`,
      );
      for (const s of e.actualSets)
        if (
          !record(s) ||
          !Number.isFinite(s.weight) ||
          s.weight < 0 ||
          s.weight > 2000 ||
          !Number.isInteger(s.reps) ||
          s.reps < 0 ||
          s.reps > 1000 ||
          !['working', 'warmup'].includes(s.kind) ||
          !['completed', 'skipped', 'incomplete'].includes(s.status) ||
          !modes.includes(s.loadMode) ||
          !text(s.updatedAt) ||
          Number.isNaN(Date.parse(s.updatedAt)) ||
          (s.status === 'completed' &&
            (!s.completedAt || Number.isNaN(Date.parse(s.completedAt)))) ||
          (s.completedAt && Number.isNaN(Date.parse(s.completedAt)))
        )
          fail('invalid set');
    }
    if (
      w.restSetId !== undefined &&
      (typeof w.restSetId !== 'string' ||
        !w.restSetId ||
        w.status !== 'active' ||
        !Number.isFinite(w.restEndsAt) ||
        !w.exercises.some((e) =>
          e.actualSets.some((s) => s.id === w.restSetId && s.status === 'completed'),
        ))
    )
      fail('invalid rest timer owner');
  }
  if (activeCount > 1) fail('more than one active workout');
  for (const s of d.scheduledEdits) {
    if (
      typeof s.id !== 'string' ||
      !s.id ||
      typeof s.routineId !== 'string' ||
      !Array.isArray(s.edits) ||
      !s.edits.length ||
      !s.edits.every(validEdit) ||
      (s.consumedAt && Number.isNaN(Date.parse(s.consumedAt)))
    )
      fail('invalid scheduled edit');
    if (!s.consumedAt && !routineIds.has(s.routineId)) fail('scheduled routine missing');
  }
  for (const p of d.proposals) {
    if (
      typeof p.id !== 'string' ||
      !p.id ||
      typeof p.targetId !== 'string' ||
      !['current_workout', 'next_workout', 'routine'].includes(p.scope) ||
      !['pending', 'accepted', 'rejected'].includes(p.status) ||
      !Array.isArray(p.edits) ||
      !p.edits.every(validEdit) ||
      !text(p.rationale) ||
      !text(p.createdAt) ||
      Number.isNaN(Date.parse(p.createdAt)) ||
      (p.targetFingerprint !== undefined && !text(p.targetFingerprint)) ||
      (p.origin !== undefined && !['coach', 'progression'].includes(p.origin))
    )
      fail('invalid proposal');
    if (
      p.preference &&
      (!record(p.preference) ||
        !['goals', 'equipment', 'schedule', 'constraints', 'preferences', 'notes'].includes(
          p.preference.field,
        ) ||
        !text(p.preference.value))
    )
      fail('invalid preference proposal');
    if (p.customExercise && !isExercise(p.customExercise)) fail('invalid custom exercise proposal');
    if (p.routineDraft) {
      const draft = validateRoutine(p.routineDraft);
      if (draft.id !== p.targetId && p.scope === 'routine') fail('routine draft target mismatch');
    }
  }
  for (const m of d.messages)
    if (
      !m.id ||
      !['user', 'assistant'].includes(m.role) ||
      !text(m.text) ||
      !text(m.createdAt) ||
      Number.isNaN(Date.parse(m.createdAt))
    )
      fail('invalid message');
  if (d.exerciseSettings !== undefined && !record(d.exerciseSettings))
    fail('invalid exercise settings');
  for (const [exerciseId, settings] of Object.entries(d.exerciseSettings ?? {})) {
    if (!exIds.has(exerciseId)) fail('exercise settings reference an unknown exercise');
    try {
      validateExerciseSettings(settings as any);
    } catch (error) {
      return fail((error as Error).message);
    }
  }
  const migrated = clone(d);
  migrated.schemaVersion = 2;
  migrated.exerciseSettings ??= {};
  return migrated;
}

export function updatePersistentExerciseNote(
  data: AppData,
  exerciseId: string,
  note: string,
  workoutId?: string,
): AppData {
  assert(
    typeof note === 'string' && note.length <= 2000,
    'Exercise note must be 2000 characters or fewer',
  );
  assert(!!exerciseFor(data, exerciseId), 'Unknown exercise');
  const stamp = now();
  const existing = data.exerciseSettings?.[exerciseId] ?? { updatedAt: stamp };
  const next: AppData = {
    ...data,
    exerciseSettings: {
      ...(data.exerciseSettings ?? {}),
      [exerciseId]: { ...existing, persistentNote: note, updatedAt: stamp },
    },
  };
  if (workoutId) {
    assert(
      next.workouts.some((item) => item.id === workoutId && item.status === 'active'),
      'Active workout not found',
    );
    next.workouts = next.workouts.map((item) =>
      item.id !== workoutId
        ? item
        : {
            ...item,
            updatedAt: stamp,
            exercises: item.exercises.map((entry) =>
              entry.exerciseId === exerciseId ? { ...entry, persistentNote: note } : entry,
            ),
          },
    );
  }
  return next;
}
