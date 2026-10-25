# Cloudflare resource audit

Audited October 24, 2026. Measurements below use local SQLite and synthetic
accounts, not production telemetry. The protected product specification is
unchanged. Changes require a normal main-branch Actions deployment to take effect.

## Free-tier budget

| Resource        | Current Free allowance                | Relevant app behavior                                                                 |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| D1 writes       | 100,000 rows/day                      | Inserts, updates, deletes and index maintenance count.                                |
| D1 reads        | 5 million rows/day                    | Rows scanned count, not just returned rows.                                           |
| D1 storage      | 500 MB per database; 5 GB per account | State snapshots, projections, receipts and indexes share the database.                |
| D1 statements   | 50 per Worker invocation              | Batching does not make individual SQL statements free.                                |
| Worker requests | 100,000/day                           | API requests invoke the Worker; ordinary static requests bypass it.                   |
| Worker CPU      | 10 ms per invocation                  | Network waiting is separate from CPU; parsing large histories can still be expensive. |
| Static assets   | Free, unlimited requests              | Keep `run_worker_first` scoped to `/api/*`.                                           |
| Workers Logs    | 200,000 events/day; 3-day retention   | Retain diagnostic logging; avoid payload or per-set logs.                             |

These allowances are shared with other uses of the account where applicable.
Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[Worker limits](https://developers.cloudflare.com/workers/platform/limits/),
[static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
and [Workers Logs pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing).
Cloudflare documents an upcoming Logs pricing change on December 1, 2026, so
recheck that allowance before then.

## Changes made

- Training sync compares saved and incoming finished workouts before touching
  training tables. Unchanged training advances one revision marker; changed
  workouts/sets are reconciled incrementally. See [the D1 write audit](d1-write-audit.md).
- Snapshot chunks use conditional upserts. Unchanged chunks remain untouched;
  only surplus chunks are deleted when a document shrinks. A 2.2 MB synthetic
  snapshot used three chunks; changing its last character changed only one chunk.
- Sync reads the saved snapshot once for both the version guard and comparison.
  Ordinary state reads no longer issue an initialization insert unless missing.
- A no-op local edit reserves no revision and uploads nothing. An identical
  explicit restore still runs its required privacy reset.
- The client validates account identity once immediately before each queued send,
  removing an extra session request before the first item. Authentication still
  runs on every API request; account status and identity are not cached across requests.
- Existing-account authentication uses one D1 identity lookup instead of two.
- A full Community feed uses bulk author-state and workout-set reads. Twenty
  different authors now take five D1 statements total, including authentication,
  instead of over 100. Empty feeds take two. Feed reads perform zero writes.
- Content-hashed `/assets/*` files have a one-year immutable **private browser**
  cache. HTML, service worker and manifest keep normal update/revalidation behavior.
  API responses remain `no-store`; the service worker excludes API and Access
  endpoints and rejects login redirects from its offline cache.
- Actions builds frontend assets once, uploads only `dist/` with one-day retention,
  and deploys that exact tested artifact in the dependent production job. Worker
  bundling and pending D1 migrations remain part of deployment. Tests never use
  production D1. Version preview URLs are explicitly disabled; previews needing
  production bindings must not be created casually.

## Practices retained

One Worker, one D1 database and static assets are sufficient. No KV, R2, queues,
Durable Objects, scheduled jobs, remote test databases or background AI calls were
added. The one-second rest display timer is local UI state and sends no requests.
Community reads are on demand; search is debounced. Provider metadata loads on
identity/Coach availability changes, not on timer ticks. AI calls are explicitly requested,
with an eight-per-minute account limit, bounded output, one SDK retry and timeout;
provider billing is separate from Cloudflare.

Keep current authorization, account isolation, fail-closed projection checks,
full snapshot recovery, idempotency receipts and explicit conflict handling.
Never cache authenticated API data in a shared CDN cache to save queries. Existing
indexes serve account/workout, exercise and time-range access paths; additional
indexes would also add writes and storage, so add them only for a measured query.

## Remaining costs and limits

- Small, single-chunk unrelated edits now change **four table rows**: account
  metadata, one snapshot chunk, a retry receipt and the projection marker. D1's
  index work is additional. An acknowledged retry changes zero rows. Actual usage
  must be checked in D1's native Metrics > Row Metrics dashboard.
- Every real edit still uploads a full snapshot. Changed training still reads
  existing projection rows to calculate its delta. Do not compact queued
  operations without preserving operation/content binding, revision reservations,
  restore boundaries and lost-acknowledgement recovery.
- Feed record badges still require authors' full training snapshots and CPU to
  evaluate records. Bulk queries bound statement count, not bytes or CPU. Very
  large histories or a much larger community need measured profiling before a
  cache or persisted record projection is introduced.
- The 20 MB sync request cap is a validation ceiling, not a guarantee that every
  such payload fits Free CPU, memory or statement limits. Large imports can need
  many incremental statements. Keep exported backups and inspect actual Worker
  CPU/error metrics if history grows substantially.
- Sync receipts intentionally remain durable for old offline retries. They do
  not contain workout payloads but grow with operation count. Do not purge them
  on a timer without a defined retry expiry/compaction protocol. Coach limiter
  records already have bounded, request-driven cleanup.
- This source audit does not establish the deployed account plan, Access policy,
  production traffic, CPU time, or whether Cloudflare Builds is also enabled.
  GitHub Actions should remain the single production deployment path; disable
  duplicate dashboard Git builds if configured. Keep Access owner-restricted on
  every live hostname. No production configuration was changed by this audit.

For personal use, the revised operation counts are modest relative to daily
allowances. This is an engineering estimate, not a guarantee based on observed
production usage. Use Cloudflare's existing request/CPU and D1 row/storage metrics
instead of adding database writes or polling solely to measure these budgets.
