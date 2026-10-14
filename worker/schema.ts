import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
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
export const syncReceipts = sqliteTable('sync_receipts', {
  operationId: text('operation_id').primaryKey(),
  revision: integer('revision').notNull(),
  createdAt: text('created_at').notNull(),
  fingerprint: text('fingerprint').notNull(),
});
export const coachRequests = sqliteTable('coach_requests', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
});
export const stateChunks = sqliteTable('state_chunks', {
  index: integer('chunk_index').primaryKey(),
  content: text('content').notNull(),
});
