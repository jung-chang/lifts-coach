# Prototype verification

## Incremental sync and resource audit (October 25, 2026)

Passed 272 tests in 40 files with Node 24.13.1 and pnpm 10.33.0, the production
build, public-source pattern scan and whitespace checks. Backend regression tests
cover unchanged-history write budgets, incremental corrections and deletions,
privacy on restore, stale projection repair, transaction rollback, lost
acknowledgements, overlapping projection revisions and concurrent reuse of an
operation ID with different content. Committed receipts now guard snapshot writes
inside the transaction as well as at the request's initial lookup.

An isolated local Wrangler Worker and D1 database passed the integration scripts:
persistence, retry/content binding, competing revision conflicts, validation,
export, UTF-8 snapshots above 2 MB, stale chunk removal when shrinking and coherent
payload/revision reads during concurrent writes. No production workout records
were used or modified for these checks. Resource and caching details are recorded
in [the resource audit](cloudflare-resource-audit.md) and [D1 write audit](d1-write-audit.md).
The protected specification retains SHA256
`4129a87c82fbc08aa6cb16e27571dd94baf9378c1eb95eb99b66f407b63d1084`.

## Persistent exercise instructions (October 23, 2026)

The owner selected a simpler notes-only feature. Percentage calculations, reference maxima, rounding controls and grouped prescriptions were removed. The existing routine prescription and workout logging controls remain in place. The protected specification stays unchanged.

Notes coverage includes staged saves and concurrent changes, private instruction snapshots, repeat/replacement behavior, backup migration, retained queued operation identities and legacy receipt replay, old-writer rejection and private-note filtering from public responses and automatic Coach context.

The notes-only revision passed all 256 tests in 40 files, the production build and public-source pattern checks with Node 24.13.1 and pnpm 10.33.0. Synthetic browser checks at 320 × 720 and 1440 × 1000 verified the original prescription controls, visible note field, saving, clearing/reopening, and instructions above the workout table; no horizontal document overflow was observed. Notes survived reopening and workout reload. The protected specification retained SHA256 `4129a87c82fbc08aa6cb16e27571dd94baf9378c1eb95eb99b66f407b63d1084`. Local synthetic checks do not establish a production deployment, live model call or real-device installation.

The original **Lifts Coach** prototype was verified on October 13, 2026 with the specification's Electric Minimal design. The owner subsequently requested a Maia/Olive/Yellow redesign; this visual override is recorded in [the design system](design-system.md), while the protected specification remains unchanged.

## Automated checks observed

- 99 tests passed: workout/edit invariants, real IndexedDB queue behavior, signed Access-token authorization, UTF-8 chunk boundaries, private deployment configuration/diagnostics, and the editor, deletion and set-table regressions described below.
- Production TypeScript/Vite build passed and generated an asset precache for the PWA.
- Wrangler deployment dry-run passed. This verifies packaging, not a live deployment.
- Local Worker/D1 integration passed: persistence, duplicate retries, operation/content binding, concurrent revision conflicts, validation, export and secret-free provider metadata.
- Large local D1 integration passed: a payload above the 2 MB row limit round-tripped through chunk storage, shrinking removed stale chunks, and concurrent readers observed coherent payloads/revisions.
- Public-source credential-pattern check passed. Candidate paths and source were also reviewed manually; pattern matching cannot establish that arbitrary content is safe to publish.

## Always-visible set table checks

The newest owner instruction replaces the focused current-set layout with an always-visible current-exercise table: Set, Load, Reps and Done. Active and corrected history rows share editable load/repetition fields and checkboxes; there is no status dropdown or Complete Set action. Finish workout appears at the top only. The protected specification remains unchanged.

Automated checks verify that two rapid Done taps preserve the latest Undo snapshot and restore the earlier timer owner, redundant completion does not restart rest, unchecking clears only the related timer, and history corrections never start rest. Done immediately followed by Finish produces the correct saved summary; a stale active Done event after Finish cannot alter completed history. Input tests cover decimal edits before Done, negative/over-limit validation, focused partial decimals during another row's update, acknowledged edits followed by Undo, and unit changes without interpreting a pounds draft as kilograms. A failed history write preserves the edited load for a successful retry instead of acknowledging unsaved data. Checkbox inputs have native accessible names.

The browser observations below describe earlier iterations; their focused-set completion buttons and horizontally panned set tables have been superseded by this table refinement.

## Earlier browser checks observed

Using synthetic QA data, verified manual routine creation and exercise selection, workout start, completion and Undo with timer restoration, mini-player visibility on Progress, reload recovery, incomplete finishing, post-workout load corrections, repeat-from-history and lb/kg display conversion.

The final workout layout was checked at 390 × 844: the Complete Set action was above fixed navigation without horizontal overflow. At 320px, load/repetition fields measured approximately 118 × 53px with no horizontal overflow. At 1280px, the app used its 1120px content width without overflow. Icon-only actions and profile fields have accessible names. These checks do not replace device or assistive-technology testing.

## Maia redesign checks

The redesign uses self-hosted Geist, warm olive neutrals, restrained yellow primary actions, simpler routine/history rows, plain Progress empty states and neutral Coach messages. The underlying workout, storage and Worker behavior is unchanged.

Using synthetic QA data, the revised workout was checked with an active rest timer at 390 × 844 and 320px widths. At 390px, the completion action ended around 696px above navigation at 777px, and the decimal load `20.4` remained fully visible. At 320px, the action ended around 752px above navigation at 762px; load/repetition fields measured approximately 123 × 49px, the timer remained legible, and there was no horizontal overflow. Desktop navigation now sits in the header rather than covering the workout action. Complete/Undo preserved both the set count and the prior timer deadline; incomplete finishing still saved performed sets. Routine editing keeps full-width exercise names with mobile action controls on a separate row.

## Full-page routine editor checks

The owner-requested editor update stages manual and Coach routine changes in one full-page editor. Automated coverage verifies new-draft cleanliness, custom exercise/increment staging, duplicate prescription identities, empty-draft validation, changed-source rejection, and inspected Coach draft approval without applying parallel unreviewed edits or modifying finished history. DOM tests exercise explicit removal confirmation/Cancel, drawer focus/Escape, contextual Coach draft retention, and the programmatic Save/browser-Back timing regression. The manual Retry sync control is covered by the real IndexedDB lost-acknowledgement test, which retries the same operation ID without duplicating data.

The owner's later refinement removed exercise swipe gestures and their modules/tests. Explicit confirmed Remove remains the exercise-editing route, while saved routines have a visible trash button and a separate deletion confirmation. The dedicated editor header and full-page creation layout were inspected on mobile.

The responsive audit at 320px kept the document width at 320px across Train, Coach and the active workout with All sets expanded. The load `1000.5` remained legible in a 125px field; set/correction tables retained readable 480px columns inside a 250px scrolling container. The eight-week chart fit its 250px container. The Coach composer ended around 540px, above the active mini-player at approximately 573px. All three Settings tabs, the workout summary drawer and history corrections were inspected; desktop presentation was also reviewed at 1440px.

With populated synthetic history, both charts had matching 250px content/scroll widths at 320px. The strength chart shows first/last value labels on phones so large decimals do not overlap, while preserving all bars and dates. Populated Coach messages and proposal reviews share one scroll region above the composer: the thread measured 273px with no horizontal overflow and the proposal 271px. Full before/after details, Apply/Dismiss actions and expandable evidence remained inspectable. The full-page editor was reviewed at phone and desktop sizes.

The compact prescription controls use Sets, a single Reps range and Load, with secondary controls under Options. Tests verify valid ranges, invalid partial input, Enter without implicit Save, removal of an invalid row, negative/over-limit load, converted kg limits and positive progression increments. Routine deletion tests preserve active/finished snapshots, remove overrides, reject affected pending proposals, keep the next surviving routine stable, choose its successor when deleted, and normalize an empty rotation. At 320px the three primary fields fit one row with 44px height and the value `1000.5` remained readable. Editor entry scrolls to the top once, independently of subsequent draft changes.

The latest synthetic browser pass at 320 × 720 kept document/scroll width at 320px. Complete Set ended around 613px, above navigation at 638px; active load/reps fields measured 127 × 49px and the three prescription fields approximately 52/81/113 × 44px. No swipe nodes remained. Entering `10-15` and pressing Enter normalized the range to `10–15` while keeping the editor open. Cancel preserved exercise and routine rows; a confirmed routine deletion remained absent after reload while eight history entries remained intact. Completing a set changed the count from 0/9 to 1/9 and started Rest; Undo restored 0/9 and removed that timer. Exercise switching and the optional assistance mode/label were also checked.

## Cloudflare preparation observed

The owner's `lifts-coach` D1 database was created and schema migrations were applied. The [successful main-push workflow](https://github.com/jung-chang/lifts-coach/actions/runs/38592792278) at commit `a2855efa` subsequently migrated and deployed the production Worker. The owner also reached the Access-protected application through login. Account-specific values stay in deployment settings and ignored local files, not public source. This observation does not establish live-provider behavior, authenticated synchronization or device installation.

## Still to verify with deployment credentials and devices

- An actual OpenAI/alternative-provider call and structured proposal generation.
- Expired-session recovery and authenticated production synchronization.
- Installation and offline service-worker behavior on real iPhone and Android devices.
- Complete accessibility review and longer-term gym use.

The prototype synchronizes full documents with an explicit 20 MB request cap. Larger data stays local and requires a storage/sync upgrade; it is not silently truncated. The exercise catalog contains 150 versioned entries. The 20 research records are conservative original summaries, mostly reviewed at abstract level, with that limitation recorded in the corpus.

The protected spec's SHA256 remains `4129A87C82FBC08AA6CB16E27571DD94BAF9378C1EB95EB99B66F407B63D1084`.

## Approved notes layout (October 24, 2026)

The real app now matches the approved study: routine feedback above accessible exercise tabs, instructions editable inline with a pencil-only control, and prior exercise feedback in a separate accordion collapsed by default. Synthetic browser checks covered desktop, 390px and 320px layouts, tab keyboard navigation, saved instructions after reload, matching-routine context, completion feedback and repeat snapshots. At 320px document width remained 320px; the tab strip scrolls independently.

With Node 24.13.1 and pnpm 10.33.0, all 257 tests in 40 files passed, as did the production build and public-source scan. Added compatibility coverage verifies non-empty v1 state stored across chunks, receipt replay without state changes, a v2 transition and rejection of stale v1 writes. These local checks do not establish production synchronization or live-provider behavior.
