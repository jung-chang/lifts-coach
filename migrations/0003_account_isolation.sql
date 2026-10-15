-- The owner confirmed the existing single-user production tables contain no data.
-- Replace their global keys with account-scoped keys before enabling account access.
DROP TABLE account_state;
DROP TABLE state_chunks;
DROP TABLE sync_receipts;
DROP TABLE coach_requests;

CREATE TABLE account_state (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  last_operation_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE sync_receipts (
  account_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (account_id, operation_id)
);
CREATE TABLE coach_requests (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);
CREATE TABLE state_chunks (
  account_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (account_id, chunk_index)
);
