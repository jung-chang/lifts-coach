-- D1's 2 MB row/STRING limit requires large personal backups to span rows.
CREATE TABLE IF NOT EXISTS state_chunks (chunk_index INTEGER PRIMARY KEY, content TEXT NOT NULL);
