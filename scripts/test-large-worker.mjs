import assert from 'node:assert/strict';
const origin = process.env.TEST_WORKER_ORIGIN || 'http://localhost:8788';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Local Worker only.');
const get = async () => (await fetch(`${origin}/api/state`)).json();
const put = (data, revision) =>
  fetch(`${origin}/api/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data,
      baseRevision: revision,
      deviceId: 'large-integration',
      operationId: crypto.randomUUID(),
    }),
  });
const initial = await get();
const large = structuredClone(initial.data);
large.settings.profile.notes = '🏋️'.repeat(400_000);
assert(new TextEncoder().encode(JSON.stringify(large)).byteLength > 2_000_000);
const saved = await put(large, initial.revision);
assert.equal(saved.status, 200);
const revision = (await saved.json()).revision;
const roundTrip = await get();
assert.equal(roundTrip.data.settings.profile.notes, large.settings.profile.notes);
assert.deepEqual(await (await fetch(`${origin}/api/export`)).json(), large);
const shrunk = await put(initial.data, revision);
assert.equal(shrunk.status, 200);
assert.deepEqual((await get()).data, initial.data);
let currentRevision = (await shrunk.json()).revision;
const expectedNotes = new Map([[currentRevision, initial.data.settings.profile.notes]]);
const writer = (async () => {
  for (let index = 0; index < 6; index++) {
    const data = structuredClone(initial.data);
    data.settings.profile.notes = `revision-${currentRevision + 1}:` + '🏋️'.repeat(150_000);
    expectedNotes.set(currentRevision + 1, data.settings.profile.notes);
    const result = await put(data, currentRevision);
    assert.equal(result.status, 200);
    currentRevision = (await result.json()).revision;
  }
})();
const readers = Array.from({ length: 4 }, async () => {
  for (let index = 0; index < 8; index++) {
    const snapshot = await get();
    assert.equal(snapshot.data.settings.profile.notes, expectedNotes.get(snapshot.revision));
  }
});
await Promise.all([writer, ...readers]);
assert.equal((await put(initial.data, currentRevision)).status, 200);
console.log(
  'Large-state integration passed: >2MB UTF-8 Unicode round trip, shrink removes stale chunks, and concurrent reads return payloads with coherent revisions.',
);
