# Lifts Coach contributor and agent instructions

## Protected specification

Read `fitness_app_product_spec.md` before product work. Never edit, reformat, rename or replace that file without the owner's explicit approval for the spec change. General permission to implement, format or publish the application is not permission to change the spec.

The owner chose **Lifts Coach**, the repository **jung-chang/lifts-coach**, and the planned **lifts.coach** domain after the spec was written. Apply these approved branding choices in implementation and documentation while leaving the spec unchanged.

## Public repository: never publish private material

This repository is intended to be public. **Never commit, stage or push secrets or anything unsuitable for public disclosure.**

- Never commit provider keys, Cloudflare tokens, GitHub tokens, authentication cookies, JWTs, private keys, passwords, connection strings with credentials, or credential files.
- Never commit real workout history, personal profiles, private chats, user JSON exports/backups, local IndexedDB/SQLite/D1 databases, private logs, account metadata, or screenshots containing private information.
- Never place secrets in client code, Vite variables, example values, tracked configuration, fixtures, documentation, issue bodies or tool output. Examples must contain obvious placeholders or synthetic data.
- Configure AI keys as Cloudflare Worker secrets. Configure deployment credentials through GitHub secrets. Settings may select provisioned providers/models but must never accept API keys.
- Review the exact staged file list and diff before every commit. Check for private material and credential patterns before every push. Do not use blanket staging until the candidate paths have been inspected.
- If a file's publication suitability is uncertain, leave it unstaged and ask the owner a focused question. A successful pattern scan is not proof that material is public-safe.
- If a secret was accidentally staged, remove it from the index before committing. If it was committed or exposed, stop publication and tell the owner; removal from the latest file alone does not remove it from Git history. Rotate exposed credentials through the owner's normal secret-management flow.
- Keep local secrets, private files, logs, dependencies and runtime databases ignored. Do not bypass ignore rules with force-add.

## Agent workflow

The owner requested a **gpt-6.1-sol / high** orchestrator and **gpt-6-luna / medium** implementation subagents. Give subagents bounded tasks, explicit file ownership and acceptance criteria. Define shared contracts before parallel implementation. The orchestrator resolves conflicts, reviews the integrated diff, runs meaningful checks, and validates the combined user flow. Do not accept an implementation agent's report as verification by itself.

## Design system and product invariants

The owner's subsequent visual redesign request overrides the spec's original Electric Minimal aesthetic; never modify the protected spec to record this override. Follow the Maia preset direction recorded in `docs/design-system.md`: warm olive off-white canvas, white surfaces, olive/ink neutrals, restrained yellow primary actions, self-hosted Geist heading/body typography, Lucide icons, generous rounded cards and minimal divider-based lists. Avoid colored washes, decorative shadows, excessive pills and heavy bold typography. Keep interactive targets at least 44px. Completion, error and genuinely model-generated actions retain restrained semantic cues. Deterministic defaults, timers, rotation and progression must not be branded as AI.

Prioritize the focused current-set workout and a visible primary completion action at phone sizes. Hide secondary controls progressively. Train resumes an active session; show its mini-player only on other views while training.

Preserve separate routine and workout snapshots. AI cannot silently mutate programs or preferences. Review individual proposals and apply selected operations through the shared editing engine. Keep completed history unchanged by routine/Coach changes while allowing explicit user corrections. Consume next-matching overrides once. Keep logging local-first, durable and independent of AI. Sync retries must be idempotent; conflicts require explicit resolution rather than silent overwrite.

## Verification and deployment

Run the pinned Node/pnpm toolchain, `pnpm test` and `pnpm build` before publishing changes. Test important scope, timer, backup and offline-sync behaviors. Verify meaningful UI changes at phone and desktop sizes. Never reformat the protected spec while formatting other files.

Deploy from successful pushes to `main` through GitHub Actions only when account, D1 and Access configuration and deployment secrets are provisioned. Keep preview resources isolated from production. Protect personal deployments with an owner-restricted Cloudflare Access policy, and keep backend authentication fail-closed. Do not claim real deployment, phone installation or live-provider validation unless actually observed.

Use original exercise instructions and manually curated evidence summaries. Verify primary sources, record applicability and limitations, and avoid copied papers or unlicensed assets.
