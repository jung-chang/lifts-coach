import { expect, it } from 'vitest';
import localDev from '../worker/localDev';

it('identifies only this local runtime before the harness is allowed to write test fixtures', async () => {
  const env = {
    LOCAL_DEV: 'true',
    LOCAL_VERIFY_ID: 'synthetic-run-guard',
  } as unknown as Parameters<typeof localDev.fetch>[1];
  const context = {} as Parameters<typeof localDev.fetch>[2];
  const check = (origin: string, guard?: string) =>
    localDev.fetch(
      new Request(`${origin}/__local_ready`, { headers: guard ? { 'X-Local-Verify': guard } : {} }),
      env,
      context,
    );
  expect((await check('http://127.0.0.1:8877', 'synthetic-run-guard')).status).toBe(200);
  expect((await check('http://127.0.0.1:8877')).status).toBe(403);
  expect((await check('http://127.0.0.1:8877', 'different-run')).status).toBe(403);
  expect((await check('https://lifts.coach', 'synthetic-run-guard')).status).toBe(403);
  expect(
    (
      await localDev.fetch(
        new Request('http://localhost/__local_ready', {
          headers: { 'X-Local-Verify': 'synthetic-run-guard' },
        }),
        { ...env, LOCAL_DEV: 'false' },
        context,
      )
    ).status,
  ).toBe(403);
});
