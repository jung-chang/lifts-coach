# Prototype verification

The original **Lifts Coach** prototype was verified on October 13, 2026 with the specification's Electric Minimal design. The owner subsequently requested a Maia/Olive/Yellow redesign; this visual override is recorded in [the design system](design-system.md), while the protected specification remains unchanged.

## Automated checks observed

- 70 tests passed: workout/edit invariants, real IndexedDB queue behavior, signed Access-token authorization, UTF-8 chunk boundaries, private deployment configuration/diagnostics, and the full-page editor, drawer and swipe regressions described below.
- Production TypeScript/Vite build passed and generated an asset precache for the PWA.
- Wrangler deployment dry-run passed. This verifies packaging, not a live deployment.
- Local Worker/D1 integration passed: persistence, duplicate retries, operation/content binding, concurrent revision conflicts, validation, export and secret-free provider metadata.
- Large local D1 integration passed: a payload above the 2 MB row limit round-tripped through chunk storage, shrinking removed stale chunks, and concurrent readers observed coherent payloads/revisions.
- Public-source credential-pattern check passed. Candidate paths and source were also reviewed manually; pattern matching cannot establish that arbitrary content is safe to publish.

## Browser checks observed

Using synthetic QA data, verified manual routine creation and exercise selection, workout start, completion and Undo with timer restoration, mini-player visibility on Progress, reload recovery, incomplete finishing, post-workout load corrections, repeat-from-history and lb/kg display conversion.

The final workout layout was checked at 390 × 844: the Complete Set action was above fixed navigation without horizontal overflow. At 320px, load/repetition fields measured approximately 118 × 53px with no horizontal overflow. At 1280px, the app used its 1120px content width without overflow. Icon-only actions and profile fields have accessible names. These checks do not replace device or assistive-technology testing.

## Maia redesign checks

The redesign uses self-hosted Geist, warm olive neutrals, restrained yellow primary actions, simpler routine/history rows, plain Progress empty states and neutral Coach messages. The underlying workout, storage and Worker behavior is unchanged.

Using synthetic QA data, the revised workout was checked with an active rest timer at 390 × 844 and 320px widths. At 390px, the completion action ended around 696px above navigation at 777px, and the decimal load `20.4` remained fully visible. At 320px, the action ended around 752px above navigation at 762px; load/repetition fields measured approximately 123 × 49px, the timer remained legible, and there was no horizontal overflow. Desktop navigation now sits in the header rather than covering the workout action. Complete/Undo preserved both the set count and the prior timer deadline; incomplete finishing still saved performed sets. Routine editing keeps full-width exercise names with mobile action controls on a separate row.

## Full-page routine editor checks

The owner-requested editor update stages manual and Coach routine changes in one full-page editor. Automated coverage verifies new-draft cleanliness, custom exercise/increment staging, duplicate prescription identities, empty-draft validation, changed-source rejection, and inspected Coach draft approval without applying parallel unreviewed edits or modifying finished history. DOM tests exercise removal confirmation/Cancel, nested input keyboard behavior, pointer cancellation, multi-touch cancellation, drawer focus/Escape, contextual Coach draft retention, and the programmatic Save/browser-Back timing regression. The manual Retry sync control is covered by the real IndexedDB lost-acknowledgement test, which retries the same operation ID without duplicating data.

In browser testing with synthetic data, a partial right drag revealed removal; a full right drag opened confirmation. Cancel preserved duplicate exercise entries, and confirmation removed only the targeted prescription from the draft. The dedicated editor header and full-page creation layout were inspected on mobile.

The responsive audit at 320px kept the document width at 320px across Train, Coach and the active workout with All sets expanded. The load `1000.5` remained legible in a 125px field; set/correction tables retained readable 480px columns inside a 250px scrolling container. The eight-week chart fit its 250px container. The Coach composer ended around 540px, above the active mini-player at approximately 573px. All three Settings tabs, the workout summary drawer and history corrections were inspected; desktop presentation was also reviewed at 1440px.

With populated synthetic history, both charts had matching 250px content/scroll widths at 320px. The strength chart shows first/last value labels on phones so large decimals do not overlap, while preserving all bars and dates. Populated Coach messages and proposal reviews share one scroll region above the composer: the thread measured 273px with no horizontal overflow and the proposal 271px. Full before/after details, Apply/Dismiss actions and expandable evidence remained inspectable. The full-page editor was reviewed at phone and desktop sizes; the revealed Delete action matches its 72px swipe offset and uses a separate accessible name from the visible Remove control.

## Cloudflare preparation observed

The owner's `lifts-coach` D1 database was created and schema migrations were applied. The [successful main-push workflow](https://github.com/jung-chang/lifts-coach/actions/runs/38592792278) at commit `a2855efa` subsequently migrated and deployed the production Worker. The owner also reached the Access-protected application through login. Account-specific values stay in deployment settings and ignored local files, not public source. This observation does not establish live-provider behavior, authenticated synchronization or device installation.

## Still to verify with deployment credentials and devices

- An actual OpenAI/alternative-provider call and structured proposal generation.
- Expired-session recovery and authenticated production synchronization.
- Installation and offline service-worker behavior on real iPhone and Android devices.
- Complete accessibility review and longer-term gym use.

The prototype synchronizes full documents with an explicit 20 MB request cap. Larger data stays local and requires a storage/sync upgrade; it is not silently truncated. The exercise catalog contains 150 versioned entries. The 20 research records are conservative original summaries, mostly reviewed at abstract level, with that limitation recorded in the corpus.

The protected spec's SHA256 remains `4129A87C82FBC08AA6CB16E27571DD94BAF9378C1EB95EB99B66F407B63D1084`.
