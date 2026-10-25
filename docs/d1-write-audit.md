# D1 write audit

The application previously rebuilt every finished training set on every accepted
state revision: an account-wide `training_sets` delete followed by inserts for
the full history. It also updated every workout and existing publication title.
Client updates persist full snapshots and drain each queued snapshot separately,
so active set logging, preferences and both sides of a Coach exchange all invoked
this path. The profile statistics endpoint can also repair an outdated projection.
There is no scheduled Worker job that rebuilds training history.

The audit reproduced 4,101 table-row changes for a new revision containing 100
unchanged workouts and 2,000 completed sets, even with sharing disabled. This
excludes snapshot chunks, receipts and index maintenance. D1 counts deletes and
index writes toward its daily write allowance; these are operations, not a limit
on the number of stored workout records. See [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Development and deployment paths

- Backend unit tests invoke the Worker with an in-memory SQLite D1 adapter.
- Browser store tests mock fetch and use synthetic IndexedDB data.
- `scripts/test-worker.mjs` and `scripts/test-large-worker.mjs` accept only loopback
  hostnames. Their documented Wrangler commands use local persistence.
- Vite proxies API calls to `127.0.0.1:8787`; the public Wrangler template contains
  a placeholder database ID and no remote D1 binding opt-in.
- CI tests run before the separate production deployment job. That job applies
  ordered schema migrations, then deploys the Worker; it does not run workout
  generators or integration scripts against the production application.
- Testing an authenticated live application manually would still exercise its
  ordinary sync writes. Source inspection alone cannot attribute historical
  production requests to a person, browser or process.

## Correction

Sync first compares the incoming finished workouts with the saved account
snapshot. When identical, and the existing projection matches that saved account
revision, it skips training-table reads and reconciliation and only advances the
account projection marker. Restore always runs reconciliation for its privacy
effects. A missing or stale marker falls back to repair, even for identical data.
Already acknowledged retries return after checking the marker, with no writes.
Receipt existence is also checked inside the snapshot transaction, so overlapping
requests cannot mutate chunks or advance the revision for an operation that has
already committed, even if they both initially saw no receipt.

When finished training changes, projection updates compare a transactionally read baseline with the incoming
finished workouts. Only new or changed sets and workout metadata are upserted;
only removed set identities and deleted workouts are deleted. Existing publication
titles are updated only when different. Unchanged history incurs no training-set,
workout or publication row writes, while the account projection marker advances.

Per-workout source revisions identify the last metadata change. Readers require
that the account projection marker exactly matches current account state and that
each workout revision is no newer than that marker. Feed/detail record evaluation
uses the account marker, so unchanged workout names and achievements remain valid.
All deltas and marker advancement commit in one D1 batch. A guard on both the
source revision and the read projection baseline prevents stale deltas from
applying after a competing rebuild; bounded retry recalculates them if needed.

Snapshot storage and idempotency receipts remain intact. This fix does not combine
queued operations, discard local edits, purge receipts or alter conflict handling.
Changed training still reads the finished set projection to calculate deltas, so
those reads remain proportional to history size. Unrelated account changes skip
that read. No schema migration or history deletion is
needed. Deploying the corrected Worker is necessary to change production behavior.

All measurements use synthetic local data. The audit did not query production
training records or production analytics.

The regression fixture with 100 workouts and 2,000 sets now changes only the
projection marker (one row), plus three snapshot/receipt rows for an unrelated
edit: four table-row changes total, with sharing both enabled and disabled.
Active workout edits, routine creation and Coach messages likewise leave
historical training and publication rows untouched. Index costs are not included
in these SQLite measurements.
