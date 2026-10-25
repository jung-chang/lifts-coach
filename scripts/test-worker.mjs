import assert from 'node:assert/strict';
const origin = process.env.TEST_WORKER_ORIGIN || 'http://localhost:8787';
assert(
  ['localhost', '127.0.0.1'].includes(new URL(origin).hostname),
  'Integration test only operates on a local Worker.',
);
const session = await (await fetch(`${origin}/api/session`)).json();
const request = (path, body) =>
  fetch(
    `${origin}${path}`,
    body
      ? {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'X-Lifts-Account': session.accountId },
          body: JSON.stringify(body),
        }
      : undefined,
  );
const initial = await (await request('/api/state')).json();
assert.equal(initial.data.schemaVersion, 2);
const first = {
  operationId: crypto.randomUUID(),
  accountId: session.accountId,
  deviceId: 'integration-device',
  baseRevision: initial.revision,
  data: structuredClone(initial.data),
};
first.data.settings.profile.notes = 'Local Worker integration fixture';
const response = await request('/api/state', first);
assert.equal(response.status, 200);
const { revision } = await response.json();
assert.equal(revision, initial.revision + 1);
const retry = await request('/api/state', first);
assert.equal(retry.status, 200);
assert.equal((await retry.json()).revision, revision);
const changed = structuredClone(first);
changed.data.settings.profile.notes = 'Reused ID with different content';
assert.equal((await request('/api/state', changed)).status, 400);
const candidates = ['a', 'b'].map((name) => ({
  ...first,
  operationId: crypto.randomUUID(),
  deviceId: name,
  baseRevision: revision,
  data: {
    ...structuredClone(first.data),
    settings: { ...first.data.settings, profile: { ...first.data.settings.profile, notes: name } },
  },
}));
const competing = await Promise.all(candidates.map((body) => request('/api/state', body)));
assert.deepEqual(competing.map((result) => result.status).sort(), [200, 409]);
const conflict = await competing.find((result) => result.status === 409).json();
assert.equal(conflict.revision, revision + 1);
assert(['a', 'b'].includes(conflict.data.settings.profile.notes));
const malformed = structuredClone(first);
malformed.operationId = crypto.randomUUID();
malformed.baseRevision = conflict.revision;
malformed.data.settings.unit = 'invalid-unit';
assert.equal((await request('/api/state', malformed)).status, 400);
const providers = await (await request('/api/providers')).json();
assert(Array.isArray(providers));
assert(!JSON.stringify(providers).includes('API_KEY'));
const exported = await (await request('/api/export')).json();
assert.deepEqual(exported, conflict.data);
console.log(
  'Worker integration passed: D1 persistence, idempotent retry, ID-content binding, concurrent revision conflict, validated writes, export, secret-free provider metadata.',
);
