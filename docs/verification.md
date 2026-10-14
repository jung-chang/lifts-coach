# Prototype verification

Verified during the prototype implementation on October 13, 2026. The repository is **Lifts Coach**, using the Electric Minimal design from the protected product specification.

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
