# Cloudflare debugging and verification

Use this loop for Cloudflare issues. Try existing supported diagnostic paths before asking the owner for setup work. Run commands in the repository's WSL/Linux environment with Node 24 and pnpm 10.33.0. Keep the protected product specification unchanged.

## Independent Coach verification

```sh
pnpm cloudflare:verify:remote --deployed-baseline
# After a focused fix:
pnpm cloudflare:verify:remote
```

These commands start a temporary `wrangler dev --remote` preview with the existing Wrangler login. The preview retains the server-held model secrets, so a local model key and an interactive Cloudflare Access session are unnecessary. This was checked against the installed pinned Wrangler implementation and exercised against a real provisioned model on October 25, 2026. It does not run `wrangler deploy`, upload a production version, alter routes, or attach any D1/asset binding. Production deployments still go exclusively through the main-branch GitHub Actions workflow.

The separate `worker/coachProbe.ts` entrypoint accepts one fixed synthetic prompt: pull-ups, dumbbell bench press and dumbbell shoulder press, each 3 sets of 3 reps, bodyweight pull-ups and 50 lb per dumbbell for both presses. It accepts no arbitrary prompt, account ID, workout, backup or training context. A fresh per-run guard protects the preview; missing/wrong guards fail closed. The preview uses `emptyData()`, requires pending proposals, validates persistence, applies approval to an in-memory copy and checks the resulting workout snapshot. It never calls the production app entrypoint or any database. Each run submits one fixed Coach request; the app's bounded provider retries and normal usage charges apply.

The script reads the active production deployment before and after the probe and requires its ID/traffic versions to remain unchanged. Account/deployment identifiers and credentials stay in memory. Raw Wrangler output is drained, not printed. Temporary guard files are removed on normal exit; generated code and reports remain under ignored `output/`. The CLI process is stopped after the request. Do not leave a preview running as a public service.

`--deployed-baseline` downloads static deployed code into ignored output and reuses its actual Coach functions in the isolated probe. A preview-only capture hook preserves the underlying exception for projection into fixed reason codes and known function names; it never returns raw messages, stacks or provider bodies. It fails closed if those functions cannot be identified. `--baseline` instead tests `HEAD:worker/coach.ts`; that is useful for source regressions but does not establish that HEAD matches production. Neither baseline imports personal state. A passing synthetic baseline does not rule out context-dependent or transient production failures.

Reports are `output/cloudflare-remote-deployed.json`, `output/cloudflare-remote-baseline.json`, and `output/cloudflare-remote-current.json`. They contain closed outcomes/diagnostics, never provider reply text. A pass requires successful generation, correct prescriptions, valid approval/workout snapshots and an unchanged active production deployment. Missing previews, credentials or model secrets are failures, not passes. Do not repeatedly run model calls without a new hypothesis.

Observed October 25, 2026: the deployed-code baseline reproduced HTTP 502 with `exercise_not_found` in `applyEdits` / `applyProposal`. The fixed working tree passed the real-model generation, persistence, approval and workout-snapshot checks. New exercise references are constrained to supplied canonical/approved custom IDs in the response schema for ordinary catalog sizes; unusually large custom libraries retain SDK schema and domain validation to stay within provider enum limits. Shared schema references avoid repeating catalog enums throughout the provider schema. The active production deployment fingerprint remained unchanged. The audited local loop passed 291 tests, build, public checks and isolated HTTP/D1 integration. These are preview/local results; the fix has not been deployed to production.

## Preflight and historical logs

```sh
pnpm cloudflare:doctor
pnpm cloudflare:logs
```

Preflight reports local-provider availability and whether historical Coach logs can actually be queried. Authentication uses a provisioned `CLOUDFLARE_API_TOKEN` or captures supported `wrangler auth token --json` output in memory, including Wrangler's normal token refresh. Never read token files directly or print the token command's output. Account selection must be explicit or unambiguous. Ignored `.env.deploy.local` can provide account/deployment configuration; never copy its values into tracked files.

Historical queries use the [Workers Observability API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/) with `dry: true`, a bounded timeframe and selected Worker/event filters. This API requires the permission named **Workers Observability Write**, even for this query. The current OAuth login returned `log_permission_required` (403) on October 25, 2026; valid Wrangler login alone did not establish log-query access. Use the independent preview path above when historical access is unavailable. Do not expand permissions or create credentials silently.

An empty successful query is `no_events`; it does not verify a reproduction. Permission, login, transport and response-shape failures have distinct nonzero outcomes. Log projection discards prompts, profiles, notes, headers, provider bodies and arbitrary fields. New Coach failures carry a random `diagnosticId` and fixed stage (`provider_request`, `provider_output`, `proposal_validation`, `proposal_simulation`); the API returns the same ID. [Structured JSON logging](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) makes these fields searchable after deployment. The synthetic preview can capture allowlisted diagnostics from older deployed versions without historical-log access.

## Local and CI verification

To open the app without deploying, run this from WSL/Linux:

```sh
pnpm dev:local
```

Open the printed localhost URL. This builds the current frontend, migrates a local D1 database and starts a local Worker. It does not require Cloudflare login or insert verification fixtures. App data persists under ignored `output/local-app/state`; automated verification uses a separate fresh database. Ctrl+C stops the owned server. Restart this command after frontend changes; Worker source reloads automatically. The per-run readiness guard verifies the correct runtime before automated fixture writes.

Real Coach replies on this local server require a provider key in ignored `.dev.vars` or `output/coach-local/.dev.vars` before startup. Use `.dev.vars.example` for the variable names and keep keys out of chat. Without a key, the rest of the app works locally. The remote probe above is a separate option for real-model verification with existing server-held secrets; it runs in a temporary Cloudflare preview, not entirely locally.

For the automated local loop:

```sh
pnpm cloudflare:verify
```

This runs the full tests, build and public-source check, then starts a fresh local Worker on unused loopback ports with a fresh synthetic D1 database under ignored output. It applies migrations and exercises HTTP persistence, export, numerical validation, idempotent retries and conflicting writes. It shuts down only processes it created. It does not use an existing server/database or real backups. CI runs the isolated Worker check after tests/build and before any deployment.

Local model testing remains available with `pnpm cloudflare:verify:coach` after building. It reads a provisioned local key from `.dev.vars` or `output/coach-local/.dev.vars` (or `LOCAL_COACH_VARS_FILE`), copies only provider settings to the isolated runtime, and removes that copy afterward. Missing keys fail explicitly as `local_provider_required`. Prefer the remote synthetic probe when no local key exists; deployed model secrets cannot be downloaded. [Local secrets](https://developers.cloudflare.com/workers/configuration/secrets/) stay ignored and server-side.

## Required loop for every issue

1. Establish the environment, revision, failing action and safe synthetic reproduction. Run preflight once and choose a working supported path rather than repeatedly requesting screenshots, logs, login or keys.
2. Observe a baseline. For Coach, use the actual deployed-code probe first. For other Cloudflare behavior, use the isolated Worker/API harness and add a focused regression for the failing route or data invariant. Keep previews isolated from production. Real-data reproduction needs explicit authorization and must never become a public fixture.
3. Identify the failing layer and make a narrow change. Preserve approval, history/snapshot, idempotency, offline, secrets and Access boundaries. Label mocked-provider tests separately from real network/model checks.
4. Rerun the failing case, freeze implementation and run `pnpm cloudflare:verify`. Verify meaningful UI changes at phone/desktop sizes through the browser. Run the live preview again when changing Coach/provider behavior.
5. Review the exact diff and public-safety results. Report observed baseline/after results and unresolved gaps. If the baseline passes, say the original failure remains unreproduced; do not infer a root cause from a speculative patch.
6. After an authorized main push, inspect GitHub Actions and the active Cloudflare deployment, then repeat the live check. Local/preview success does not prove production deployment or a phone-app update. Do not mark an issue resolved while its relevant live check remains unverified.
