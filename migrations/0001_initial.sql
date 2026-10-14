CREATE TABLE IF NOT EXISTS account_state (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, device_id TEXT NOT NULL, last_operation_id TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sync_receipts (operation_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, created_at TEXT NOT NULL, fingerprint TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coach_requests (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS coach_requests_created_at_idx ON coach_requests(created_at);
