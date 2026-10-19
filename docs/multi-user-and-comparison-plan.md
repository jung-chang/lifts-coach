# Profiles, sharing and comparison

Approved design contract following the owner's October 18 request, now implemented in the app and forward migration. This extends the original personal-use scope without changing `fitness_app_product_spec.md`. Deployment and beta admission still require the gates in [production readiness](production-readiness.md).

The owner's follow-up approves an email-linked account using Cloudflare Access. Use the concrete naming, keys, constraints and migration rules in the [account schema contract](account-schema.md). That contract supersedes the initial sketch below: use `accounts` as the owner and query normalized private training projections rather than storing separate shared-summary totals.

The owner's subsequent feed request replaces the connections-only audience with one authenticated community containing all admitted active accounts. The [community feed plan](community-feed-plan.md) defines the chronological finished-workout surface and automatic future sharing after an audience choice. It takes precedence over the earlier individual-sharing default. There is no friend graph or mutual acceptance requirement.

## Product direction

Every person has their own private training space. Sharing is a controlled window into that space. Use Train, Progress and Community as the three main destinations, with Coach in the header and contextual actions and your profile behind the avatar. Progress opens on the calendar and weekly volume; exercise stats and full history are secondary clickable rows.

Community opens a chronological feed of finished workouts from active members. People is a secondary profile directory within Community. Keep the first release focused on training: no ranking, streak pressure, reactions or messaging. Membership is automatic for admitted active accounts; sharing choices control what appears.

Separate three concepts in both language and data:

| Concept              | Contains                                                              | Visibility                                                                                           |
| -------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Account              | Authentication, ownership, entitlements, deletion and recovery        | Private                                                                                              |
| Coaching preferences | Goals, equipment, constraints, schedule, preferences and notes        | Private account settings; not another profile entity                                                 |
| Profile              | Chosen display name, approved summaries and shared completed workouts | Exactly one per account; authenticated community members see only approved fields, subject to blocks |

Accounts and profiles are exactly 1:1. The profile's primary key is its `account_id`; create both in the same transaction and delete the profile only with its account. A generated stable public alias supports profile URLs without exposing authentication subjects or email addresses. That alias does not identify a second profile or have a separate lifecycle. A display name is sufficient initially; avoid requiring a photo, biography or body measurements.

## Navigation and surfaces

1. **Progress → Community.** Open the running finished-workout feed. Each compact item links to its owner's profile and read-only workout. People in the header opens a simple profile list. Display names need not be unique; retain a short public alias to disambiguate. See the feed plan for pagination, ordering and publication behavior.
2. **Person's profile.** Back, display name and Compare in the header. Show their shared weekly volume, then a compact Lift records list and up to three selected completed workouts. “All shared workouts” opens a secondary list. Do not add another dashboard of summary numbers. Show a calendar only when dated workout details are shared; summary-only access should not imply access to workout dates or attendance.
3. **Compare.** Default to You and the person just opened. A person picker changes the second participant. Use one restrained control to switch between Weekly volume and Lifts. Keep the surface to two people so labels and values remain readable on phones.
4. **Shared workout.** A read-only session showing completed exercises and completed sets, date, and any explicitly shared title. Hide warm-up and skipped rows by default; do not imply unfinished prescriptions were performed. Personal notes and workout feeling remain private. An exercise row opens its shared completed-set detail. Another person's records never expose edit, correct, restore or Coach mutation controls.
5. **Your profile and sharing.** Reachable through Settings → Profile & sharing and Community → Your profile. Separate private coaching preferences with a clear label. Show a “Preview as a community member” view using exactly the fields that the server would return.

The intended comparison fits one compact surface:

| Weekly volume · week of Oct 12 | You | Training partner |
| ------------------------------ | --: | ---------------: |
| Completed working sets         |  36 |               30 |

The numbers above are synthetic layout examples. In the interface, pair two directly labeled horizontal bars with the values. Switch to Lifts to replace the chart with rows such as “Barbell bench press — You: 135 lb × 8; Partner: 125 lb × 8.” Do not render both views as permanent stacked panels. Selecting a lift opens its comparable records and dates.

## Sharing choices

Use one authenticated community audience, with blocks overriding access. New members see the actual audience and shared fields before enabling automatic future-workout sharing, with a private choice available. Existing accounts and old history stay private until reviewed. Community membership does not itself grant full private history or summary access. See the feed plan for the visibility policy and one-time audience notice.

**Training summary:** a separate opt-in grants weekly working-set totals and lift records calculated from completed history. The preview must explicitly say that totals and records include workouts whose individual details remain private. Show the historical range before enabling it; do not silently limit or expand the range. A concise initial policy is “All completed history and future completed workouts.” Someone uncomfortable with this scope can leave summaries private and share individual workouts instead.

**Workouts:** after the automatic-sharing choice, future finished workouts publish on successful sync. Options can override a workout to Only me. Old workouts can be shared individually through history. Do not add a mandatory sharing decision to Finish workout. Turning off future automatic sharing and hiding previously shared workouts are distinct, clearly labeled actions.

Sharing a workout publishes its date and completed sets; those details naturally reveal that session's volume and performance. It does not grant the person's full summary or all-time records. Label any limited view “Shared workouts only” so absence of a workout is never presented as a rest day, zero volume or no personal record. If summary sharing is off, comparison can offer shared-workout totals only with that scope clearly shown for each participant; do not silently compare one person's full history with another person's partial history.

Revocation takes precedence over derived data. Unsharing a workout removes its feed item/detail, but an enabled all-history summary still includes that workout; explain this in the unshare view and offer the summary setting. Turning off summaries removes the aggregate/record views, while separately shared workouts remain visible. Blocking prevents access in both directions on subsequent authorized reads. Account disablement/deletion removes community access. Beta admission invitations are distinct from social sharing.

Do not persist other people's training data for offline browsing in the first release. Show “Connect to view shared training” offline. Recheck authorization when returning to a shared surface and invalidate visible data after blocking/revocation. Already viewed or copied information cannot be recalled; avoid promising otherwise. Keep API responses out of service-worker caches.

## Comparison rules

Weekly volume means **completed working-set count**. Count each qualifying set once, including bodyweight and assisted exercises. Exclude warm-ups, incomplete/skipped sets and active sessions. Avoid cross-person tonnage totals: equipment, assistance and bodyweight make those values difficult to interpret.

Use the same eight Monday–Sunday date ranges for both participants, with the current week labeled “In progress.” Preserve each account's chosen training timezone and disclose it when the participants differ; the comparison is between local training weeks, not identical UTC intervals. Keep historical session dates stable when a person travels. Store the training date/timezone needed for grouping instead of guessing it from the viewer's browser. Changing the account's timezone does not silently move old workouts into different weeks.

Distinguish a genuine zero in a complete summary from missing access, a narrower sharing range, or unavailable data. Show a dash and short scope label for unavailable values. Totals describe logged training, not whether someone trained outside the app. No winner colors, trophy icons or implied universal volume target.

Lift comparison requires the same canonical exercise, equipment/variant and load mode. Convert canonical stored loads to the viewer's preferred unit for display; never compare rounded display values internally. Preserve per-dumbbell labeling and never combine assistance with added external weight. Custom exercises remain owner-scoped and are not matched by name; require an explicit reviewed canonical mapping before including them in cross-person comparisons.

Start with actual completed working-set records: heaviest load with reps/date, and best reps at a selected load. A general heaviest-set view shows each person's reps alongside load; it must not call 200 lb × 1 better than 190 lb × 10. For direct load comparison, select the same rep count. Bodyweight records show reps, with added load or assistance separately qualified. Do not introduce estimated one-rep-max rankings or bodyweight normalization in the first version. Corrected history recomputes affected records and volume; Coach/routine edits do not.

## Ownership and synchronization

The current Worker derives an account key from the verified identity and partitions state, chunks, sync receipts and Coach request rows by that key. The current client still uses a single `training-lab` IndexedDB database with an unowned `app-data` record/outbox. These are different levels of isolation; server partitioning alone is insufficient for account switching. See `worker/auth.ts`, `worker/schema.ts` and `src/lib/store.ts`.

Before invitations, add a verified session/bootstrap response with the internal account ID and entitlements. Bind local records, revision metadata, device metadata, queued operations, conflicts and in-memory state to that account. A separate IndexedDB database per opaque account ID is a straightforward starting point. Capture the account/generation on every asynchronous operation, cancel in-flight work on switching, and discard late results from a previous identity. Server writes must verify the authenticated account matches the queued operation's intended account before accepting it.

An expired session can keep the last verified account's logging available offline on a trusted device. A different or unknown identity must never inherit that account's local data. Switching requires online identity verification; offline switching is unavailable. Provide a trusted-device offline setting and a shared-device sign-out that removes local readable copies after unsynced work has been resolved or exported. Never silently discard an outbox or upload it to the next account. Logging and private sync remain independent of sharing availability.

Legacy unowned local data needs an explicit claim/migration flow after sign-in, with a preview and backup option. Never automatically claim it for whoever signs in first. Backup restore targets only the authenticated owner's private space and cannot restore someone else's identity or sharing permissions. Restoring old history must not accidentally republish it; pause publication and require review of the sharing preview after restore.

Keep the existing private revisioned document initially. Add relational ownership and sharing records rather than making another person's private document readable:

| Proposed record                                                     | Purpose                                                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `accounts`                                                          | Stable internal account ID, verified Access email/identity, status and entitlements                                  |
| `profiles`                                                          | Shared account primary key, stable public alias, display name and timezone; exactly one per account                  |
| `account_blocks`                                                    | Directed blocks with access denied in both directions                                                                |
| `sharing_settings` / `workout_visibility` / `workout_publications`  | Summary/automatic-sharing choices, durable private overrides and one publication identity per workout                |
| `training_projection_state` / `training_workouts` / `training_sets` | Rebuildable private projections for authorized shared workout details, weekly sets and qualified lift-record queries |

Use internal account IDs as ownership keys; never trust an `ownerId` supplied by the client. Protect all shared reads with active-community-account, block and sharing-policy checks. Enumeration, guessed workout IDs, summaries, nested set endpoints and comparison endpoints need the same authorization. Return allowlisted projections, never arbitrary pieces of AppData. Private Coach context, preferences, measurements, food records, email and notes have no place in these responses.

Generate shared projections from the owner's accepted server state, with idempotent owner/workout keys and source revisions. Recompute or invalidate them after sync, correction, unshare, deletion and restore. A comparison response should use one consistent projection revision per person and include its scope and last-update time. Never serve a stale projection once its source is deleted or its permission revoked; hide it while recomputation is pending. Other people's updates do not create conflicts in the owner's private document. Sharing failures do not roll back or block a locally finished workout.

Keep Coach unavailable to tracking-only beta accounts through server entitlements. Reading a friend's profile does not authorize sending that friend's data to a model provider. Any later social Coach analysis needs its own clearly defined scope and consent design.

## Implementation order and acceptance

1. **Private multi-user foundation:** verified account bootstrap, account-bound persistence/outbox, safe legacy migration, switching/logout, recovery, deletion and server Coach entitlements. Verify account A/B isolation including late network responses, browser reload, auth expiry and offline work.
2. **Community and sharing:** active-account audience, blocks, 1:1 profile, summary/automatic-sharing choices, durable per-workout privacy and exact preview. Use synthetic accounts in isolated preview resources. No live access-policy widening is authorized by this plan.
3. **Feed and comparison:** secondary Community entry, idempotent chronological publications, read-only profiles/workouts, weekly sets and qualified lift comparisons, scope-aware missing states, accessible phone/desktop layouts. Preserve active-session mini-player and direct return to Train.

Test unauthorized/guessed-ID reads and writes, identity switching with an unsynced workout, stale responses after logout, block races, cached/in-flight shared responses, hidden notes, summary-only versus workout-only grants, partial scopes versus zero, canonical exercise mismatches, dumbbell/bodyweight/assistance semantics, unit conversion, local-week/DST boundaries, corrected/deleted records, restore without republishing, idempotent projection/publication retries and account deletion removing grants/projections. Follow the feed plan's audience, ordering and pagination checks as well. Provide keyboard-accessible selectors, 44px targets, text labels for both comparison series and 320px layouts without horizontal panning. Follow the existing pinned tests/build/public-safety and deployment workflow when implementation is authorized.
