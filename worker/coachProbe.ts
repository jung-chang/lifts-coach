// Temporary preview entrypoint only. Never used by the production Worker.
// No D1/ASSETS binding, user state, arbitrary prompts, or mutation endpoints.
import { coachReply, CoachError, providers, type ProviderEnv } from './coach';
import { applyProposal, emptyData, startWorkout, validateBackup } from '../shared/domain';
import { coachDiagnostic } from './coachDiagnostics';

interface ProbeEnv extends ProviderEnv {
  DIAGNOSTIC_NONCE?: string;
}
const message =
  'Help me create a routine with three exercises pull-ups the dumbbell bench press and dumbbell shoulder press each three sets three reps pull-ups is bodyweight and the others are 50 pound dumbbells';
let running = false;

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    if (!env.DIAGNOSTIC_NONCE || request.headers.get('X-Diagnostic-Nonce') !== env.DIAGNOSTIC_NONCE)
      return new Response(null, { status: 403 });
    const path = new URL(request.url).pathname;
    if (path === '/__health' && request.method === 'GET') return Response.json({ ready: true });
    if (path !== '/__coach_verify' || request.method !== 'POST')
      return new Response(null, { status: 404 });
    const provider = providers(env)[0];
    if (!provider) return Response.json({ status: 'provider_unavailable' }, { status: 503 });
    // Capture hooks are isolate-global, so never overlap synthetic probe invocations.
    if (running) return Response.json({ status: 'probe_busy' }, { status: 429 });
    running = true;
    const data = emptyData();
    const captureKey = Symbol.for('lifts.coach.probe.failure');
    const captures = globalThis as unknown as Record<symbol, { message?: string; stack?: string }>;
    delete captures[captureKey];
    let stage = 'generation';
    let observed: ReturnType<typeof coachDiagnostic> | undefined;
    let schemaRule: string | undefined;
    try {
      // Old deployed versions do not attach diagnostics to CoachError. Capture only
      // their already-sanitized event during this one synthetic preview invocation.
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        const raw = (args[0] === 'Coach request failed' ? args[1] : args[0]) as
          | {
              message?: string;
              name?: string;
              status?: number;
              code?: string;
              schemaError?: string;
            }
          | undefined;
        if (args[0] === 'Coach request failed' || raw?.message === 'Coach request failed') {
          observed = coachDiagnostic(
            { name: raw?.name, statusCode: raw?.status, data: { error: { code: raw?.code } } },
            'provider_request',
            crypto.randomUUID(),
          );
          if (raw?.code === 'invalid_json_schema' && typeof raw.schemaError === 'string') {
            schemaRule = [
              'oneOf',
              'prefixItems',
              'minItems',
              'maxItems',
              'minimum',
              'maximum',
              'pattern',
              'format',
              'default',
            ].find(
              (keyword) =>
                raw.schemaError!.includes(`'${keyword}'`) &&
                /not (permitted|allowed|supported)/i.test(raw.schemaError!),
            );
            if (!schemaRule && /required/i.test(raw.schemaError)) schemaRule = 'required_fields';
          }
        }
        originalError(...args);
      };
      let reply: Awaited<ReturnType<typeof coachReply>>;
      try {
        reply = await coachReply(env, data, {
          message,
          provider: provider.id,
          model: provider.models[0],
        });
      } finally {
        console.error = originalError;
      }
      stage = 'persistence';
      const pending = validateBackup({ ...data, proposals: reply.proposals });
      const proposal = pending.proposals.find(
        (item) => item.scope === 'routine' && item.routineDraft,
      );
      if (!proposal || proposal.status !== 'pending') throw new Error('proposal_missing');
      if (data.routines.length || data.workouts.length) throw new Error('unapproved_mutation');
      stage = 'approval';
      const approved = validateBackup(applyProposal(pending, proposal.id, [0]));
      const routine = approved.routines.find((item) => item.id === proposal.routineDraft!.id);
      if (!routine || routine.exercises.length !== 3) throw new Error('routine_mismatch');
      stage = 'prescriptions';
      const expected = ['ex_pull-up', 'ex_dumbbell-bench', 'ex_dumbbell-shoulder-press'];
      if (
        !routine.exercises.every(
          (exercise, index) =>
            exercise.exerciseId === expected[index] &&
            exercise.sets === 3 &&
            exercise.repRange[0] === 3 &&
            exercise.repRange[1] === 3 &&
            exercise.targetWeight === (index ? 50 : 0) &&
            exercise.loadMode === (index ? 'per-dumbbell' : 'bodyweight'),
        )
      )
        throw new Error('prescription_mismatch');
      stage = 'workout_snapshot';
      const workout = startWorkout(approved, routine.id).workouts[0];
      if (
        !workout.exercises.every(
          (exercise, index) =>
            exercise.actualSets.length === 3 &&
            exercise.actualSets.every(
              (set) =>
                set.reps === 3 &&
                set.weight === (index ? 50 : 0) &&
                set.loadMode === (index ? 'per-dumbbell' : 'bodyweight'),
            ),
        )
      )
        throw new Error('snapshot_mismatch');
      return Response.json({
        status: 'passed',
        exercises: 3,
        setsPerExercise: 3,
        repsPerSet: 3,
        poundsPerDumbbell: 50,
        approvalVerified: true,
        workoutSnapshotVerified: true,
      });
    } catch (error) {
      const captured = captures[captureKey];
      delete captures[captureKey];
      const reasons: Record<string, string> = {
        'Exercise not found': 'exercise_not_found',
        'Unknown exercise': 'unknown_exercise',
        'Routine not found': 'routine_not_found',
        'Proposal target changed or is missing its review fingerprint': 'proposal_target_changed',
        'Select at least one valid change': 'invalid_change_selection',
        'Proposed routine already exists': 'routine_already_exists',
        'Exercise target not found': 'exercise_target_not_found',
        'Exercise target is ambiguous': 'exercise_target_ambiguous',
        'Invalid rep range': 'invalid_rep_range',
        'Invalid target weight': 'invalid_target_weight',
        'Invalid rest period': 'invalid_rest_period',
      };
      const rootReason = captured ? reasons[captured.message || ''] || 'unclassified' : undefined;
      const rootFrames = captured
        ? [
            'applyProposal',
            'applyEdits',
            'resolve',
            'proposalFingerprint',
            'generateCoachReply',
          ].filter((name) => captured.stack?.includes(`at ${name} (`))
        : undefined;
      if (error instanceof CoachError)
        return Response.json(
          {
            status: 'failed',
            stage,
            code: error.code,
            diagnosticId: error.diagnosticId,
            diagnostic: error.diagnostic || observed,
            schemaRule,
            rootReason,
            rootFrames,
          },
          { status: error.status },
        );
      const reason = error instanceof Error ? error.message : '';
      const code =
        reason === 'Invalid backup: routine draft target mismatch'
          ? 'routine_target_mismatch'
          : reason === 'Invalid backup: invalid routine'
            ? 'invalid_routine_metadata'
            : reason === 'Invalid backup: unknown routine exercise'
              ? 'unknown_exercise'
              : 'probe_contract_failed';
      // The fixed stage identifies the failing contract. Never echo model output.
      return Response.json({ status: 'failed', stage, code }, { status: 502 });
    } finally {
      delete captures[captureKey];
      running = false;
    }
  },
};
