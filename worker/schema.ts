import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
// A personal account is one atomic document. Snapshots remain separate in the
// versioned payload; this avoids partial sync of a finished workout.
export const accountState = sqliteTable('account_state', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
  deviceId: text('device_id').notNull(),
  lastOperationId: text('last_operation_id').notNull().default(''),
});
export const syncReceipts = sqliteTable(
  'sync_receipts',
  {
    accountId: text('account_id').notNull(),
    operationId: text('operation_id').notNull(),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
    fingerprint: text('fingerprint').notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.operationId] })],
);
export const coachRequests = sqliteTable(
  'coach_requests',
  {
    accountId: text('account_id').notNull(),
    id: text('id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.id] })],
);
export const stateChunks = sqliteTable(
  'state_chunks',
  {
    accountId: text('account_id').notNull(),
    index: integer('chunk_index').notNull(),
    content: text('content').notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.index] })],
);
