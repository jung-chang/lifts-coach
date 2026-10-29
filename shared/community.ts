import type { LoadMode } from './types';
import type { ExerciseStat } from './trainingStats';

export interface PublicProfile {
  publicId: string;
  displayName: string;
  trainingTimezone: string;
}
export interface SharingSettings {
  summaryEnabled: boolean;
  autoPublishWorkouts: boolean;
  policyRevision: number;
  audienceAcknowledgedAt: string | null;
  enabledAt: string | null;
}
export interface AccountSession {
  accountId: string;
  email: string;
  coachEnabled: boolean;
  profileSetupRequired?: boolean;
  profile: PublicProfile;
  sharing: SharingSettings;
}
export interface FeedItem {
  id: string;
  profile: PublicProfile;
  /** Workout completion instant, used by the feed for the viewer-local date and time. */
  activityAt: string;
  title: string;
  durationMinutes: number | null;
  exerciseCount: number;
  setCount: number;
  exerciseNames: string[];
  hasRecord?: boolean;
}
export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}
export interface SharedWorkout {
  id: string;
  /** Present only when the viewer owns the workout, for privacy controls. */
  ownerWorkoutId?: string;
  profile: PublicProfile;
  title: string;
  startedAt: string;
  completedAt: string;
  recordSetIds?: string[];
  exercises: {
    id: string;
    exerciseId: string;
    name: string;
    loadMode: LoadMode;
    sets: {
      id: string;
      weight: number;
      reps: number;
      kind: 'working' | 'warmup';
      loadMode: LoadMode;
    }[];
  }[];
}
export interface ProfileDetail {
  profile: PublicProfile;
  scope: 'all-history' | 'shared-workouts';
  weeks: { startDate: string; sets: number }[];
  records: {
    exerciseId: string;
    name: string;
    loadMode: LoadMode;
    weight: number;
    reps: number;
    date: string;
  }[];
  workouts: FeedItem[];
  exerciseStats?: ExerciseStat[];
  statsVisible?: boolean;
  nextWorkoutCursor?: string | null;
}
export interface WorkoutVisibility {
  visibility: 'private' | 'community';
  decisionRevision: number;
}
