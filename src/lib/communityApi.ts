import type {
  AccountSession,
  FeedPage,
  ProfileDetail,
  PublicProfile,
  SharedWorkout,
} from '../../shared/community';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isProfile = (value: unknown) => {
  if (
    !isRecord(value) ||
    typeof value.publicId !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.trainingTimezone !== 'string'
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trainingTimezone });
    return true;
  } catch {
    return false;
  }
};
const modes = ['external', 'per-dumbbell', 'bodyweight', 'assistance'];
const isMode = (value: unknown) => typeof value === 'string' && modes.includes(value);
const isFeedItem = (value: unknown) =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  isProfile(value.profile) &&
  typeof value.activityAt === 'string' &&
  Number.isFinite(Date.parse(value.activityAt)) &&
  typeof value.title === 'string' &&
  Number.isFinite(value.exerciseCount) &&
  Number.isFinite(value.setCount) &&
  (value.durationMinutes === null || Number.isFinite(value.durationMinutes)) &&
  Array.isArray(value.exerciseNames) &&
  value.exerciseNames.every((name) => typeof name === 'string');
const validResponse = (path: string, value: unknown) => {
  if (path.includes('/community/profiles/') && path.includes('/block')) return isRecord(value);
  if (
    path.includes('/community/feed') ||
    /\/community\/profiles\/[^/]+\/workouts(?:\?|$)/.test(path)
  )
    return (
      isRecord(value) &&
      Array.isArray(value.items) &&
      value.items.every(isFeedItem) &&
      (value.nextCursor === null || typeof value.nextCursor === 'string')
    );
  if (path.includes('/community/people'))
    return isRecord(value) && Array.isArray(value.items) && value.items.every(isProfile);
  if (path.includes('/community/profiles/'))
    return (
      isRecord(value) &&
      isProfile(value.profile) &&
      (value.scope === 'all-history' || value.scope === 'shared-workouts') &&
      Array.isArray(value.weeks) &&
      value.weeks.every(
        (w) =>
          isRecord(w) &&
          typeof w.startDate === 'string' &&
          Number.isFinite(Date.parse(w.startDate)) &&
          Number.isFinite(w.sets),
      ) &&
      Array.isArray(value.records) &&
      value.records.every(
        (r) =>
          isRecord(r) &&
          typeof r.exerciseId === 'string' &&
          typeof r.name === 'string' &&
          isMode(r.loadMode) &&
          Number.isFinite(r.weight) &&
          Number.isFinite(r.reps) &&
          typeof r.date === 'string' &&
          Number.isFinite(Date.parse(r.date)),
      ) &&
      Array.isArray(value.workouts) &&
      value.workouts.every(isFeedItem) &&
      (value.statsVisible === undefined || typeof value.statsVisible === 'boolean') &&
      (value.nextWorkoutCursor === undefined ||
        value.nextWorkoutCursor === null ||
        typeof value.nextWorkoutCursor === 'string') &&
      (value.exerciseStats === undefined ||
        (Array.isArray(value.exerciseStats) &&
          value.exerciseStats.every(
            (s) =>
              isRecord(s) &&
              typeof s.exerciseId === 'string' &&
              typeof s.name === 'string' &&
              isMode(s.loadMode) &&
              Array.isArray(s.points) &&
              s.points.every(
                (p) =>
                  isRecord(p) &&
                  typeof p.date === 'string' &&
                  Number.isFinite(Date.parse(p.date)) &&
                  Number.isFinite(p.weight) &&
                  Number.isFinite(p.reps),
              ),
          )))
    );
  if (path.includes('/community/workouts/'))
    return (
      isRecord(value) &&
      typeof value.id === 'string' &&
      isProfile(value.profile) &&
      typeof value.title === 'string' &&
      Number.isFinite(Date.parse(String(value.startedAt))) &&
      Number.isFinite(Date.parse(String(value.completedAt))) &&
      Array.isArray(value.exercises) &&
      value.exercises.every(
        (e) =>
          isRecord(e) &&
          typeof e.id === 'string' &&
          typeof e.exerciseId === 'string' &&
          typeof e.name === 'string' &&
          isMode(e.loadMode) &&
          Array.isArray(e.sets) &&
          e.sets.every(
            (s) =>
              isRecord(s) &&
              typeof s.id === 'string' &&
              Number.isFinite(s.weight) &&
              Number.isFinite(s.reps) &&
              (s.kind === 'working' || s.kind === 'warmup') &&
              (s.loadMode === undefined || isMode(s.loadMode)),
          ),
      )
    );
  if (path === '/api/session' || path.includes('/api/me/'))
    return (
      isRecord(value) &&
      typeof value.accountId === 'string' &&
      typeof value.email === 'string' &&
      typeof value.coachEnabled === 'boolean' &&
      (value.profileSetupRequired === undefined ||
        typeof value.profileSetupRequired === 'boolean') &&
      isProfile(value.profile) &&
      isRecord(value.sharing) &&
      typeof value.sharing.summaryEnabled === 'boolean' &&
      typeof value.sharing.autoPublishWorkouts === 'boolean' &&
      Number.isFinite(value.sharing.policyRevision) &&
      (value.sharing.audienceAcknowledgedAt === null ||
        typeof value.sharing.audienceAcknowledgedAt === 'string') &&
      (value.sharing.enabledAt === null || typeof value.sharing.enabledAt === 'string')
    );
  return isRecord(value);
};

const json = async <T>(path: string, accountId: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Lifts-Account': accountId,
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Your session has changed. Sign in again to continue.'
        : `Request failed (${response.status}).`,
    );
  if (response.status === 204) return undefined as T;
  const value: unknown = await response.json();
  if (!validResponse(path, value))
    throw new Error(
      'The server returned community data in an unexpected format. Retry in a moment.',
    );
  return value as T;
};

export const getFeed = (accountId: string, cursor: string | null, signal?: AbortSignal) =>
  json<FeedPage>(
    `/api/community/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    accountId,
    { signal },
  );
export const searchPeople = (accountId: string, q: string, signal?: AbortSignal) =>
  json<{ items: PublicProfile[] }>(`/api/community/people?q=${encodeURIComponent(q)}`, accountId, {
    signal,
  });
export const getProfile = (accountId: string, publicId: string, signal?: AbortSignal) =>
  json<ProfileDetail>(`/api/community/profiles/${encodeURIComponent(publicId)}`, accountId, {
    signal,
  });
export const getWorkout = (accountId: string, publicationId: string, signal?: AbortSignal) =>
  json<SharedWorkout>(`/api/community/workouts/${encodeURIComponent(publicationId)}`, accountId, {
    signal,
  });
export const getSession = (accountId: string, signal?: AbortSignal) =>
  json<AccountSession>('/api/session', accountId, { signal });
export const getProfileWorkouts = (
  accountId: string,
  publicId: string,
  cursor: string,
  signal?: AbortSignal,
) =>
  json<FeedPage>(
    `/api/community/profiles/${encodeURIComponent(publicId)}/workouts?cursor=${encodeURIComponent(cursor)}`,
    accountId,
    { signal },
  );
export const patchProfile = (
  accountId: string,
  body: { displayName: string; trainingTimezone: string },
  signal?: AbortSignal,
) =>
  json<AccountSession>('/api/me/profile', accountId, {
    method: 'PATCH',
    body: JSON.stringify(body),
    signal,
  });
export const patchSharing = (
  accountId: string,
  body: {
    summaryEnabled: boolean;
    autoPublishWorkouts: boolean;
    policyRevision: number;
    audienceAcknowledged: boolean;
  },
  signal?: AbortSignal,
) =>
  json<AccountSession>('/api/me/sharing', accountId, {
    method: 'PATCH',
    body: JSON.stringify(body),
    signal,
  });
export const hideWorkouts = (accountId: string, signal?: AbortSignal) =>
  json<void>('/api/me/hide-workouts', accountId, { method: 'POST', signal });
export const blockProfile = (
  accountId: string,
  publicId: string,
  block: boolean,
  signal?: AbortSignal,
) =>
  json<{ ok: true }>(`/api/community/profiles/${encodeURIComponent(publicId)}/block`, accountId, {
    method: block ? 'POST' : 'DELETE',
    signal,
  });
