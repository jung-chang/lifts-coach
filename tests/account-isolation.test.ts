import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';

describe('account data deletion', () => {
  it('deletes only the authenticated account rows', async () => {
    const statements: { sql: string; bindings: unknown[] }[] = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => ({ sql, bindings }),
      }),
      batch: vi.fn(async (queries: { sql: string; bindings: unknown[] }[]) => {
        statements.push(...queries);
        return [];
      }),
    };
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/state', { method: 'DELETE' }),
      { DB, LOCAL_DEV: 'true', ASSETS: {} } as never,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(204);
    expect(DB.batch).toHaveBeenCalledOnce();
    expect(statements).toHaveLength(4);
    expect(statements.map(({ sql }) => sql)).toEqual([
      'DELETE FROM state_chunks WHERE account_id = ?',
      'DELETE FROM sync_receipts WHERE account_id = ?',
      'DELETE FROM coach_requests WHERE account_id = ?',
      'DELETE FROM account_state WHERE id = ?',
    ]);
    expect(statements.every(({ bindings }) => bindings[0] === 'local-dev')).toBe(true);
  });
});
