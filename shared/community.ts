import type { LoadMode } from './types';

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
  profile: PublicProfile;
  sharing: SharingSettings;
}
export interface FeedItem {
  id: string;
  profile: PublicProfile;
  activityAt: string;
  title: string;
  durationMinutes: number | null;
  exerciseCount: number;
  setCount: number;
  exerciseNames: string[];
}
export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}
export interface SharedWorkout {
  id: string;
  profile: PublicProfile;
  title: string;
  startedAt: string;
  completedAt: string;
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
}
export interface WorkoutVisibility {
  visibility: 'private' | 'community';
  decisionRevision: number;
}
