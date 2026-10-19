import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  foreignKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql, desc } from 'drizzle-orm';

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized').notNull().unique(),
    accessIssuer: text('access_issuer').notNull(),
    accessSubject: text('access_subject').notNull(),
    status: text('status').notNull().default('active'),
    coachEnabled: integer('coach_enabled').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('accounts_access_identity_idx').on(t.accessIssuer, t.accessSubject),
    check('accounts_status_check', sql`${t.status} IN ('active','disabled')`),
    check('accounts_coach_check', sql`${t.coachEnabled} IN (0,1)`),
  ],
);
export const profiles = sqliteTable('profiles', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  publicId: text('public_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  trainingTimezone: text('training_timezone').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const sharingSettings = sqliteTable(
  'sharing_settings',
  {
    accountId: text('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    summaryEnabled: integer('summary_enabled').notNull().default(0),
    autoPublishWorkouts: integer('auto_publish_workouts').notNull().default(0),
    workoutSharingEnabledAt: text('workout_sharing_enabled_at'),
    audienceAcknowledgedAt: text('audience_acknowledged_at'),
    policyRevision: integer('policy_revision').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('sharing_summary_check', sql`${t.summaryEnabled} IN (0,1)`),
    check('sharing_auto_check', sql`${t.autoPublishWorkouts} IN (0,1)`),
  ],
);
export const accountState = sqliteTable('account_state', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
  deviceId: text('device_id').notNull(),
  lastOperationId: text('last_operation_id').notNull().default(''),
});
export const syncReceipts = sqliteTable(
  'sync_receipts',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
    fingerprint: text('fingerprint').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.operationId] }),
    index('sync_receipts_created_at_idx').on(t.createdAt),
  ],
);
export const coachRequests = sqliteTable(
  'coach_requests',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.id] }),
    index('coach_requests_account_created_idx').on(t.accountId, t.createdAt),
  ],
);
export const stateChunks = sqliteTable(
  'state_chunks',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accountState.accountId, { onDelete: 'cascade' }),
    index: integer('chunk_index').notNull(),
    content: text('content').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.index] })],
);
export const trainingProjectionState = sqliteTable('training_projection_state', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  sourceRevision: integer('source_revision').notNull(),
  builtAt: text('built_at').notNull(),
});
export const trainingWorkouts = sqliteTable(
  'training_workouts',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => trainingProjectionState.accountId, { onDelete: 'cascade' }),
    workoutId: text('workout_id').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at').notNull(),
    trainingDate: text('training_date').notNull(),
    trainingTimezone: text('training_timezone').notNull(),
    sourceRevision: integer('source_revision').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.workoutId] }),
    index('training_workouts_date_idx').on(t.accountId, t.trainingDate),
  ],
);
export const trainingSets = sqliteTable(
  'training_sets',
  {
    accountId: text('account_id').notNull(),
    workoutId: text('workout_id').notNull(),
    setId: text('set_id').notNull(),
    exerciseInstanceId: text('exercise_instance_id').notNull(),
    exerciseId: text('exercise_id').notNull(),
    loadMode: text('load_mode').notNull(),
    weightLb: real('weight_lb').notNull(),
    reps: integer('reps').notNull(),
    kind: text('kind').notNull(),
    completedAt: text('completed_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.workoutId, t.exerciseInstanceId, t.setId] }),
    foreignKey({
      columns: [t.accountId, t.workoutId],
      foreignColumns: [trainingWorkouts.accountId, trainingWorkouts.workoutId],
      name: 'training_sets_workout_fk',
    }).onDelete('cascade'),
    index('training_sets_exercise_idx').on(t.accountId, t.exerciseId, t.loadMode, t.kind),
    check(
      'training_sets_load_mode_check',
      sql`${t.loadMode} IN ('external','per-dumbbell','bodyweight','assistance')`,
    ),
    check('training_sets_kind_check', sql`${t.kind} IN ('working','warmup')`),
    check('training_sets_weight_check', sql`${t.weightLb} >= 0`),
    check('training_sets_reps_check', sql`${t.reps} >= 0`),
  ],
);
export const accountBlocks = sqliteTable(
  'account_blocks',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    blockedAccountId: text('blocked_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.blockedAccountId] }),
    index('account_blocks_reverse_idx').on(t.blockedAccountId, t.accountId),
    check('account_blocks_no_self_check', sql`${t.accountId} <> ${t.blockedAccountId}`),
  ],
);
export const workoutVisibility = sqliteTable(
  'workout_visibility',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    workoutId: text('workout_id').notNull(),
    visibility: text('visibility').notNull(),
    decisionRevision: integer('decision_revision').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.workoutId] }),
    check('workout_visibility_check', sql`${t.visibility} IN ('private','community')`),
  ],
);
export const workoutPublications = sqliteTable(
  'workout_publications',
  {
    accountId: text('account_id').notNull(),
    workoutId: text('workout_id').notNull(),
    id: text('id').notNull().unique(),
    activityAt: text('activity_at').notNull(),
    publishedAt: text('published_at').notNull(),
    sharedTitle: text('shared_title'),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.workoutId] }),
    foreignKey({
      columns: [t.accountId, t.workoutId],
      foreignColumns: [trainingWorkouts.accountId, trainingWorkouts.workoutId],
      name: 'publication_workout_fk',
    }).onDelete('cascade'),
    index('publications_feed_idx').on(desc(t.activityAt), desc(t.id)),
    index('publications_profile_idx').on(t.accountId, desc(t.activityAt), desc(t.id)),
  ],
);
