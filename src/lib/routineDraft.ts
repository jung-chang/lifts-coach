import {
  addCustomExercise,
  applyEdits,
  applyProposal,
  id,
  proposalFingerprint,
} from '../../shared/domain';
import type { AppData, Exercise, Routine, TrainingEdit } from '../../shared/types';

export interface RoutineDraft {
  routine: Routine;
  source: Routine | null;
  increments: Record<string, number>;
  sourceFingerprint: string;
  initialDraftFingerprint: string;
  proposalId?: string;
  customExercises: Exercise[];
}

export function routineFingerprint(routine: Routine | null): string {
  return JSON.stringify(routine);
}

export function createRoutineDraft(routine?: Routine, proposalId?: string): RoutineDraft {
  const source = routine ? structuredClone(routine) : null;
  const created = source ?? {
    id: id('routine'),
    name: '',
    position: 0,
    exercises: [],
    updatedAt: new Date().toISOString(),
  };
  return {
    routine: created,
    source,
    increments: {},
    sourceFingerprint: routineFingerprint(source),
    initialDraftFingerprint: routineFingerprint(created),
    proposalId,
    customExercises: [],
  };
}

export function applyDraftEdits(
  draft: RoutineDraft,
  edits: TrainingEdit[],
  exercises: Exercise[],
): RoutineDraft {
  const routine = structuredClone(draft.routine);
  for (const edit of edits) {
    if (edit.op === 'remove_exercise' && routine.exercises.length === 1) {
      const index = routine.exercises.findIndex((p) => p.id === edit.exerciseId);
      if (index < 0) throw new Error('Exercise target not found');
      routine.exercises.splice(index, 1);
    } else {
      routine.exercises = applyEdits(routine.exercises, [edit], exercises);
    }
  }
  return { ...draft, routine };
}

export function addCustomExerciseToDraft(
  draft: RoutineDraft,
  exercise: Exercise,
  exercises: Exercise[],
): RoutineDraft {
  const next = applyDraftEdits(
    draft,
    [{ op: 'add_exercise', exerciseId: exercise.id, sets: 3, repRange: [8, 12] }],
    [...exercises, exercise],
  );
  return { ...next, customExercises: [...draft.customExercises, exercise] };
}

export function hasRoutineDraftChanges(draft: RoutineDraft, name: string): boolean {
  const normalized = name.trim();
  return (
    normalized !== (draft.source?.name || draft.routine.name || '') ||
    routineFingerprint(draft.routine) !== draft.initialDraftFingerprint ||
    Object.keys(draft.increments).length > 0 ||
    draft.customExercises.length > 0
  );
}

export function validateRoutineDraft(draft: RoutineDraft, name: string): string | null {
  if (!name.trim()) return 'Give this routine a name.';
  if (draft.routine.exercises.length === 0) return 'Add at least one exercise before saving.';
  return null;
}

export function commitRoutineDraft(data: AppData, draft: RoutineDraft, name: string): AppData {
  const normalized = name.trim();
  if (!normalized) throw new Error('Give this routine a name.');
  if (!draft.routine.exercises.length) throw new Error('Add at least one exercise before saving.');
  const next = structuredClone(data);
  const current = draft.source && next.routines.find((r) => r.id === draft.source!.id);
  if (draft.source && (!current || routineFingerprint(current) !== draft.sourceFingerprint)) {
    throw new Error(
      'This routine changed while you were editing. Reopen it to review the latest version.',
    );
  }
  for (const exercise of draft.customExercises) {
    if (next.exercises.some((e) => e.id === exercise.id))
      throw new Error('A custom exercise already uses this ID.');
    next.exercises.push(structuredClone(exercise));
  }
  const saved = { ...draft.routine, name: normalized, updatedAt: new Date().toISOString() };
  if (draft.source) next.routines = next.routines.map((r) => (r.id === saved.id ? saved : r));
  else {
    saved.position = next.routines.length;
    next.routines.push(saved);
  }
  next.settings.increments = { ...next.settings.increments, ...draft.increments };
  return next;
}

export function applyInspectedRoutineProposal(
  data: AppData,
  proposalId: string,
  routine: Routine,
  customExercises: Exercise[],
  increments: Record<string, number>,
): AppData {
  const proposal = data.proposals.find((p) => p.id === proposalId && p.status === 'pending');
  if (!proposal?.routineDraft) throw new Error('This proposal is no longer available');
  if (proposal.targetFingerprint !== proposalFingerprint(data, proposal)) {
    throw new Error(
      'This proposal changed while you were editing. Reopen it to review the latest version.',
    );
  }
  let next = structuredClone(data);
  for (const exercise of customExercises) next = addCustomExercise(next, exercise);
  next.settings.increments = { ...next.settings.increments, ...increments };
  // Editing the routine draft in the shared editor is the explicit reviewed
  // operation. Discard the proposal's parallel edit list so index zero cannot
  // accidentally apply an unrelated, uninspected operation.
  const updated = { ...proposal, routineDraft: structuredClone(routine), edits: [] };
  next.proposals = next.proposals.map((p) => (p.id === proposalId ? updated : p));
  return applyProposal(next, proposalId, [0]);
}
