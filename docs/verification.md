# Prototype verification

The original **Lifts Coach** prototype was verified on October 13, 2026 with the specification's Electric Minimal design. The owner subsequently requested a Maia/Olive/Yellow redesign; this visual override is recorded in [the design system](design-system.md), while the protected specification remains unchanged.

## Automated checks observed

- 42 tests passed: workout/edit invariants, real IndexedDB queue behavior, signed Access-token authorization, UTF-8 chunk boundaries and private deployment configuration.
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

## Cloudflare preparation observed

The owner's new `lifts-coach` D1 database was created and both schema migrations were applied. Account-specific values are held in ignored local deployment files, not public source. No production Worker has been deployed by this verification.

## Still to verify with deployment credentials and devices

- An actual OpenAI/alternative-provider call and structured proposal generation.
- Production Cloudflare Access policy, login, expired-session recovery and authenticated synchronization.
- A successful deployed main-push workflow after repository secrets/variables are configured.
- Installation and offline service-worker behavior on real iPhone and Android devices.
- Complete accessibility review and longer-term gym use.

The prototype synchronizes full documents with an explicit 20 MB request cap. Larger data stays local and requires a storage/sync upgrade; it is not silently truncated. The exercise catalog contains 150 versioned entries. The 20 research records are conservative original summaries, mostly reviewed at abstract level, with that limitation recorded in the corpus.

The protected spec's SHA256 remains `4129A87C82FBC08AA6CB16E27571DD94BAF9378C1EB95EB99B66F407B63D1084`.
