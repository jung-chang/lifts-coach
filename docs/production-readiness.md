# Production readiness

The owner now wants to plan for other users and support both iPhone/Safari and
Android/Chrome. This expands the original personal-use plan without changing the
protected product specification. The current application is not yet verified for
a public launch. Icons and a manifest alone do not establish production readiness.

## Included PWA foundation

- One barbell mark in the approved olive/ink and yellow palette across SVG favicon,
  16/32/48px ICO, 192/512px install icons, opaque 180px Apple touch icon and a
  dedicated opaque 512px Android maskable icon. Its artwork fits the central 80%
  safe circle. Regenerate with `python3 scripts/generate-icons.py` (Pillow required
  only for asset authoring, not builds).
- Stable manifest ID, root scope/start URL, standalone display, theme/background
  colors, and credentialed manifest fetching for the Access-protected origin.
- Build-generated static precache; API and Access endpoints bypass the service
  worker. Release cache versions include all assets and service-worker source.
- Runtime caching is restricted to release-listed static URLs without query
  strings. Redirects and `no-store` responses are not cached, and offline reads
  use only this app's current cache. The shell cache is not a private-data store.
- New workers wait for existing app windows to close; reopen to activate an
  update. Only this app's old cache names are removed. IndexedDB is separate.
- Static hosting headers revalidate the worker and manifest. Cloudflare control
  files are excluded from the precache because they are not downloadable assets.

## Confirmed beta direction

- Invite-only beta for a small group; no public signup for the first release.
- The owner's later instruction enables Coach for every active admitted member,
  using provisioned server-side providers. Disabled and unauthenticated accounts remain denied.
- Support both iPhone/Safari and Android/Chrome.

## Remaining setup decisions

- The owner chose email-linked accounts with Cloudflare Access. Follow the
  [account schema contract](account-schema.md) for stable IDs, validated identity
  mapping and safe migration. Finalize beta admission, recovery and revocation.
- Domain ownership/DNS and the intended production hostname. Keep one canonical
  origin: installed app identity and local data are tied to that origin.

Do not simply widen the current owner-only Access allow policy and call it a
multi-user release. Existing server state is partitioned by verified identity,
but the complete account lifecycle and device-sharing behavior need an audit.
Keep current authentication fail-closed until a replacement is implemented and
verified. Use synthetic accounts and isolated preview data for all checks.

## Release blockers for a multi-user beta

- Implemented: IndexedDB records, revision metadata and outbox operations carry
  verified account ownership. Legacy unowned history stays separate until an
  explicit claim; account switching and sign-out invalidate delayed requests.
  Rehearse the migration and shared-device experience before invitations.
- Implemented: every active account admitted by Access receives Coach access on
  its next authenticated request, including existing accounts. Provider keys remain
  Worker secrets; the old owner-email restriction is no longer used. Legacy history
  never grants account access. The basic request throttle is not a spending budget.
- Verify two accounts cannot read, write, restore, sync, or send Coach context
  belonging to each other. Exercise account switching on a shared browser and
  installed app, logout/revocation, offline local data ownership, and deletion.
- Add server-enforced per-user Coach rate limits, request/concurrency limits,
  usage budgets and useful limit errors before enabling owner-funded AI. Model
  allowlists alone do not bound spending. Do not log prompts, backups or tokens.
- Publish accurate privacy/data-handling terms: workout/profile/chat storage,
  what is sent to AI providers, retention, export/deletion and a support contact.
  Determine any age restrictions and launch jurisdictions before public signup.
- Establish D1 backup/restore and migration rollback procedures; rehearse with
  synthetic data. Keep per-user JSON backup/restore available as well.
- Provision separate preview/production resources, HTTPS/domain, authenticated
  API, server-side provider secrets, CI deployment secrets, error monitoring that
  excludes private payloads, and spend alerts. Test auth expiry during sync.
- Complete the existing acceptance checklist: durable offline writes, idempotent
  retries, explicit conflicts, timer recovery, backup round trip, proposal scope
  and immutable historical snapshots. Test browser storage loss/quota failures.
- Review static/API security headers and CSP against the actual authentication
  flow; verify sensitive responses remain `no-store` and never enter caches.

## Device and deployed-site release gate

These require observation; a successful local build is not proof of installation.

1. On iPhone/Safari and Android/Chrome, sign in on the canonical HTTPS host,
   inspect the manifest and icons, install, and reopen in standalone mode. Check
   masked icon crops, status bar, keyboard, safe areas and 44px tap targets.
2. Start a synthetic workout, log sets, background/terminate/reopen the app,
   enable airplane mode, reload, finish offline, then reconnect and verify one
   synchronized result. Validate rest timing after suspension.
3. Deploy a new version while a workout is open. Confirm it continues working;
   close all app tabs/windows and reopen, then confirm the new version and data.
   Also verify recovery after an Access session expires and reauthentication.
4. At phone and desktop widths, complete routine editing, workout logging,
   progress/history corrections, backup/restore and Coach approval flows.
5. Run pinned Node 24 / pnpm 10.33.0 tests, build and public-source checks; review
   the exact publication diff. Deploy through a successful main-push workflow.

References: [web app manifest](https://web.dev/articles/add-manifest),
[app icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons),
[service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
