import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const sql = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dbs: DatabaseSync[] = [];
function migrated() {
  const db = new DatabaseSync(':memory:');
  dbs.push(db);
  db.exec(sql('../migrations/0001_initial.sql'));
  db.exec(sql('../migrations/0002_state_chunks.sql'));
  db.exec(sql('../migrations/0003_account_isolation.sql'));
  db.prepare(
    'INSERT INTO account_state (id,payload,revision,updated_at,device_id,last_operation_id) VALUES (?,?,?,?,?,?)',
  ).run(
    'access:verified-subject-hash',
    'synthetic private state',
    7,
    '2026-10-18T00:00:00.000Z',
    'synthetic-device',
    'synthetic-op',
  );
  db.prepare('INSERT INTO state_chunks (account_id,chunk_index,content) VALUES (?,?,?)').run(
    'access:verified-subject-hash',
    0,
    'synthetic chunk',
  );
  db.prepare(
    'INSERT INTO sync_receipts (account_id,operation_id,revision,created_at,fingerprint) VALUES (?,?,?,?,?)',
  ).run(
    'access:verified-subject-hash',
    'synthetic-op',
    7,
    '2026-10-18T00:00:00.000Z',
    'synthetic-fingerprint',
  );
  db.prepare('INSERT INTO coach_requests (account_id,id,created_at) VALUES (?,?,?)').run(
    'access:verified-subject-hash',
    'synthetic-request',
    '2026-10-18T00:00:00.000Z',
  );
  db.exec(sql('../migrations/0004_accounts_community.sql'));
  return db;
}
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe('account and community schema migration', () => {
  it('preserves existing profiles when adding first-login setup', () => {
    const db = migrated();
    db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?,?)').run(
      'existing',
      'existing@example.test',
      'existing@example.test',
      'https://issuer.test',
      'existing-sub',
      'active',
      0,
      'created',
      'updated',
    );
    db.prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?)').run(
      'existing',
      'existing-public',
      'Existing member',
      'America/New_York',
      'created',
      'updated',
    );
    db.exec(sql('../migrations/0005_profile_setup.sql'));
    expect(
      db
        .prepare(
          'SELECT display_name,training_timezone,setup_completed_at FROM profiles WHERE account_id=?',
        )
        .get('existing'),
    ).toEqual({
      display_name: 'Existing member',
      training_timezone: 'America/New_York',
      setup_completed_at: 'updated',
    });
  });
  it('preserves legacy hashed-owner state, chunks, receipts, and request rows for verified mapping', () => {
    const db = migrated();
    expect(db.prepare('SELECT id,payload,revision FROM legacy_account_state').get()).toEqual({
      id: 'access:verified-subject-hash',
      payload: 'synthetic private state',
      revision: 7,
    });
    expect(db.prepare('SELECT content FROM legacy_state_chunks').get()).toEqual({
      content: 'synthetic chunk',
    });
    expect(db.prepare('SELECT operation_id,fingerprint FROM legacy_sync_receipts').get()).toEqual({
      operation_id: 'synthetic-op',
      fingerprint: 'synthetic-fingerprint',
    });
    expect(db.prepare('SELECT id FROM legacy_coach_requests').get()).toEqual({
      id: 'synthetic-request',
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('enforces a profile shared primary key, FK ownership, and account deletion cascade', () => {
    const db = migrated();
    db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?,?)').run(
      'account-a',
      'a@example.test',
      'a@example.test',
      'https://issuer.test',
      'sub-a',
      'active',
      0,
      'now',
      'now',
    );
    db.prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?)').run(
      'account-a',
      'public-a',
      'Alex',
      'UTC',
      'now',
      'now',
    );
    expect(() =>
      db
        .prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?)')
        .run('account-a', 'public-b', 'Alex Two', 'UTC', 'now', 'now'),
    ).toThrow();
    expect(() =>
      db
        .prepare('INSERT INTO account_state VALUES (?,?,?,?,?,?)')
        .run('missing', '{}', 0, 'now', '', ''),
    ).toThrow();
    db.prepare('INSERT INTO sharing_settings(account_id,updated_at) VALUES (?,?)').run(
      'account-a',
      'now',
    );
    db.prepare('DELETE FROM accounts WHERE id=?').run('account-a');
    expect(db.prepare('SELECT COUNT(*) count FROM profiles').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) count FROM sharing_settings').get()).toEqual({ count: 0 });
  });
  it('rejects self-blocks and cross-owner workout references', () => {
    const db = migrated();
    db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?,?)').run(
      'account-a',
      'a@example.test',
      'a@example.test',
      'https://issuer.test',
      'sub-a',
      'active',
      0,
      'now',
      'now',
    );
    expect(() =>
      db.prepare('INSERT INTO account_blocks VALUES (?,?,?)').run('account-a', 'account-a', 'now'),
    ).toThrow();
    expect(() =>
      db
        .prepare('INSERT INTO workout_publications VALUES (?,?,?,?,?,?)')
        .run('account-a', 'missing', 'pub-id', 'now', 'now', null),
    ).toThrow();
  });
});
