# Community workout feed

Approved design and implementation contract for one community containing everyone admitted to Lifts Coach. This replaces the earlier connections-only social proposal. Accounts remain private owners with exactly one profile each. Implementation does not expand the production Access policy. The protected specification remains unchanged.

## The experience

Use Train, Progress and Community as the three primary destinations. Coach is available in the header and contextual actions; the avatar opens your profile. Progress opens on the calendar and weekly volume, with secondary Exercise stats and Workout history entries. Opening Community shows the running feed immediately; People is a secondary header action leading to a simple profile list. An active workout keeps its mini-player and direct route back to Train.

Use one chronological list, newest workout completion first, grouped quietly by day. Give each item generous space and a subtle divider. No nested statistics cards, tinted regions, ranking, engagement counts or duplicate desktop panels. Follow the Maia/olive/Geist design system with restrained typography and 44px targets. The first release contains completed workouts only, without likes, comments, posts, follows, daily digests or push notifications.

A synthetic example of one item:

> Alex · 24 min ago
>
> Upper body
>
> 5 exercises · 16 working sets · 42 min
>
> Bench press, cable row +3

The avatar and display name open that person's profile. The workout summary area opens its read-only detail. Do not nest profile links inside a whole-card button. No three-dot menu or link-out arrows appear in cards or workout summaries. Use one plain metadata line instead of pills; exercise previews are supporting text limited to two names. Show absolute completion date/time on detail and an accessible full timestamp on the feed item. Omit unavailable duration rather than inventing it. Do not label an ordinary completed workout as a personal record or AI achievement.

Feed summaries use completed working sets and exercises containing those sets. Do not count planned, skipped or incomplete sets as performed. Warm-ups remain distinguishable in detail and do not inflate the feed's working-set total. An unfinished workout never appears; a finished workout with no completed working sets does not create an activity item.

On a phone, everything fits one readable column. Desktop uses the same list at a comfortable reading width. Open profile/workout detail as a full secondary page, with Back restoring feed position, loaded items and date grouping. Preserve this context after comparison as well. Deep links resolve through the same authorization as feed navigation.

## Profiles and workout detail

Each community profile shows its display name and the same Exercise stats and Workout history components used in Progress, scoped to that person. Shared workout history supports pagination. Compare retains the two-person volume/lift view when profile stats are shared. Private stats use a short explanation; do not fill them with zeroes. People searches display names only and does not expose sign-in emails or authentication identifiers.

Shared workout detail shows owner, approved or neutral title, completion date, duration where available, and exercises with actual completed sets/load/reps. All exercise set tables are fully expanded; there are no accordions. Distinguish per-dumbbell, bodyweight and assistance modes. It is read-only for other people. The owner's private history summary provides explicit set corrections. Personal notes, feeling, coaching preferences, chats, measurements and meals remain private.

## Community and visibility

All active admitted accounts belong to the same authenticated community. There is no separate join/follow/connection step between members, and nothing is internet-public. Account admission through Access is distinct from an in-app social invitation. Keep the existing invite-only beta admission direction unless the owner expands it separately.

The approved default for a new member is automatic sharing of future finished workouts. Profile setup explains the community audience and shared fields in one short note. Saving setup enables future workout sharing once, with no change to profile-stat sharing. Existing account settings provide the opt-out; do not add setup controls or another dialog. Retries and later profile edits preserve existing sharing choices. There is no mandatory sharing dialog after every Finish. Settings has “Share finished workouts with the community”; workout Options has “Community / Only me,” inheriting that setting unless explicitly overridden.

Existing accounts and old workouts remain private until the owner of that account reviews/enables sharing. Enabling automatic sharing applies from that moment onward, not retroactively to all history. Old workouts can be shared individually from history. Disabling automatic sharing affects future workouts; provide a separate explicit “Hide all shared workouts” action for existing publications. A workout remains locally saved even if publication fails.

Keep profile stats sharing separate from workout sharing. The profile has one switch: off hides aggregate stats, lift records and comparisons from other members; individually shared workouts remain readable. On shares all-history exercise trends and records, including contributions from private workouts, with that scope stated beside the switch. Hiding an individual workout does not remove its contribution from enabled all-history stats. Name editing uses a pencil action; timezone, automatic workout sharing and account controls live behind Settings.

Block is available through profile Options. It prevents both people from reading one another's feed items, profiles, workout details and comparisons. Blocking is an access rule on every relevant endpoint, not just a feed filter. It does not make either person's records private to everyone else. Do not publish block lists or provide block-specific lookup errors. Membership does not authorize sending another person's training to Coach.

## Publication lifecycle

Finish saves the private local workout first. Once that exact account's finished state has been accepted by the server, publication uses its effective workout visibility. A publication contains a server-resolved owner and source workout ID; clients cannot create posts for another person. Persist an explicit per-workout visibility intent even when private so later settings changes or retries cannot accidentally publish it. New server visibility policy and private overrides must win over stale offline publish requests. A restored backup never restores publication grants automatically.

Publish at most once per workout. Retries, repeated Finish actions and duplicate sync requests reuse the owner/workout key. Corrections refresh the existing summary/detail without bumping the workout to the top or creating another post. Deleting or hiding a workout removes its feed/detail access and profile entry. Account disablement/deletion and blocking take effect on all new reads immediately. If projection rebuilding fails, omit the affected item until its source revision is current; never expose deleted or stale private fields as fallback.

Sort by the workout's original completion timestamp and a stable publication ID as tie-breaker. Retain that activity timestamp across ordinary corrections and hide/re-share. A workout completed offline appears only after sync and is placed at its original completion time; the relative label reflects completion, not upload. Show “Synced later” in detail when useful. Reject invalid/future timestamps using a documented server validation rule rather than allowing a client to pin itself to the top.

Fetch bounded pages, for example 20 items, using a cursor over `(activity_at, id)`. Apply active-account, block and visibility checks before returning items. Use Load more rather than an endless scroll trap. New activity appears behind a quiet “New workouts” action or refresh gesture; never shift items under someone's finger. The header People action does not become a row of avatars above the list.

Empty: “Finished workouts from the community will appear here.” Loading: a few quiet placeholders. Fetch failure: Retry without losing loaded position. Offline: “Connect to view community workouts.” Keep other people's data in memory only for this first version, outside IndexedDB and service-worker caches. Clear it on sign-out/account switch and recheck authorization when returning to the feed. Data already viewed or copied cannot be recalled; do not promise that it can.

## Schema impact

One community needs no `communities`, `community_members`, `connections` or social-invitation tables. Active `accounts` determine membership; `profiles` remains exactly 1:1. Keep any beta-admission invitation mechanism separate from this feature.

Use explicit `workout_visibility` rows and one `workout_publications` row per published workout. The first records the owner's community/private decision; the second supplies stable feed identity and ordering. This distinction prevents hiding/deleting a feed item from forgetting that its workout must remain private. Both use account/workout compound ownership keys. The publication refers to the same current private training projections used for authorized profile/workout queries. Do not copy full workouts or maintain a separate profile-history feed.

`workout_publications` contains a unique publication ID, owner/workout compound key, original `activity_at`, first `published_at`, and optional explicitly shared title. The summary is calculated from current authorized `training_workouts` / `training_sets`; no generic JSON post payload, editable social post body, separate feed-event log or independently maintained set-count totals. An ordered index on `(activity_at DESC, id DESC)` serves the community feed; the account/workout key deduplicates publication. Add `(account_id, activity_at DESC, id DESC)` for profile history.

The account schema contract defines columns and constraints. Sharing, account status and blocks must be joined/checked for every page and deep link. Feed queries return allowlisted DTOs with the profile public alias, display name, approved workout label, timestamps and completed-set summary. They never return a private state document. Use versioned source revisions to keep published detail and summaries consistent. Avoid adding reactions/notifications infrastructure before it is needed.

## Acceptance

Use synthetic accounts and workouts to verify: one profile per account; automatic publication only after the audience choice and successful sync; private workout overrides; historical workouts staying private; offline finish/retry; duplicate Finish; delayed uploads and stable cursor ordering; correction without bump; zero-workout empty states; actual completed-set counts; revoked/hidden/deleted items; both block directions; disabled/deleted accounts; guessed-ID/deep-link access; no leaked notes/email/private body or meal data; restore without republishing; account switching with in-flight feed requests; loading/errors/pagination and restored scroll position. Verify phone and desktop, keyboard links and 44px targets. Implementation still requires the repository's complete tests/build/public-safety and deployment checks.
