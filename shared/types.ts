export type LoadMode = 'external' | 'per-dumbbell' | 'bodyweight' | 'assistance';
export type Unit = 'lb' | 'kg';
export interface Exercise {
  id: string;
  name: string;
  muscles: string[];
  equipment: string;
  instructions: string;
  loadMode: LoadMode;
  region: 'upper' | 'lower' | 'full';
  custom?: boolean;
}
export interface Prescription {
  id: string;
  exerciseId: string;
  sets: number;
  repRange: [number, number];
  targetWeight: number;
  restSeconds: number;
  loadMode: LoadMode;
}
export interface Routine {
  id: string;
  name: string;
  position: number;
  exercises: Prescription[];
  updatedAt: string;
}
export interface WorkoutSet {
  id: string;
  weight: number;
  reps: number;
  kind: 'working' | 'warmup';
  status: 'incomplete' | 'completed' | 'skipped';
  completedAt?: string;
  updatedAt: string;
  loadMode: LoadMode;
}
export interface WorkoutExercise extends Prescription {
  name: string;
  actualSets: WorkoutSet[];
  notes?: string;
}
export interface Workout {
  id: string;
  routineId?: string;
  name: string;
  startedAt: string;
  completedAt?: string;
  status: 'active' | 'finished';
  exercises: WorkoutExercise[];
  restEndsAt?: number;
  restSetId?: string;
  feeling?: string;
  notes?: string;
  updatedAt: string;
}
export type EditScope = 'current_workout' | 'next_workout' | 'routine';
export type TrainingEdit =
  | { op: 'replace_exercise'; exerciseId: string; replacementId: string }
  | {
      op: 'update_exercise';
      exerciseId: string;
      sets?: number;
      repRange?: [number, number];
      restSeconds?: number;
      targetWeight?: number;
    }
  | {
      op: 'add_exercise';
      exerciseId: string;
      afterExerciseId?: string;
      sets: number;
      repRange: [number, number];
      targetWeight?: number;
      restSeconds?: number;
    }
  | { op: 'remove_exercise'; exerciseId: string }
  | { op: 'reorder_exercises'; exerciseIds: string[] };
export interface Proposal {
  id: string;
  scope: EditScope;
  targetId: string;
  edits: TrainingEdit[];
  rationale: string;
  evidenceIds: string[];
  status: 'pending' | 'accepted' | 'rejected';
  acceptedIndices?: number[];
  routineDraft?: Routine;
  preference?: { field: keyof Profile; value: string };
  customExercise?: Exercise;
  createdAt: string;
  targetFingerprint?: string;
  origin?: 'coach' | 'progression';
}
export interface ScheduledEdit {
  id: string;
  routineId: string;
  edits: TrainingEdit[];
  consumedAt?: string;
}
export interface Profile {
  goals: string;
  equipment: string;
  schedule: string;
  constraints: string;
  preferences: string;
  notes: string;
}
export interface Settings {
  unit: Unit;
  provider: 'openai' | 'anthropic';
  model: string;
  profile: Profile;
  increments: Record<string, number>;
  rotationIndex: number;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  proposalId?: string;
  evidenceIds?: string[];
  createdAt: string;
}
export interface AppData {
  schemaVersion: 1;
  catalogVersion: string;
  routines: Routine[];
  workouts: Workout[];
  exercises: Exercise[];
  scheduledEdits: ScheduledEdit[];
  proposals: Proposal[];
  settings: Settings;
  messages: ChatMessage[];
  appliedProposalIds: string[];
}
export interface SyncRequest {
  operationId: string;
  deviceId: string;
  baseRevision: number;
  data: AppData;
}
export interface Evidence {
  id: string;
  topics: string[];
  claim: string;
  applicability: string;
  confidence: string;
  limitations: string;
  title: string;
  year: number;
  url: string;
}
