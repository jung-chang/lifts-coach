# Lifts Coach

A personal, mobile-first workout tracker with a context-aware Coach. The user approved **Lifts Coach**, with `lifts.coach` as the planned domain, after the original specification was written. The original [fitness_app_product_spec.md](fitness_app_product_spec.md) stays unchanged; this subsequent branding decision overrides its temporary-name guidance for implementation. Domain registration and DNS configuration remain deployment steps.

The client uses React, TypeScript, Vite, Tailwind and local shadcn-style Radix components. Active workouts and the durable synchronization queue live in IndexedDB through Dexie. The Hono Worker stores a revisioned document per verified Cloudflare Access identity in D1 using Drizzle; Vercel AI SDK connects only to provisioned server-side providers. This is a personal-first application with explicit conflict handling when the same account changes data on multiple devices.

The current interface follows the owner's Maia/Olive/Yellow redesign request, with self-hosted Geist typography. This visual override is recorded in [the design system](docs/design-system.md); the protected original specification remains unchanged.

## Development

Use Node 24+ and pnpm 10.33.0:

```sh
pnpm install
pnpm test
pnpm build
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm worker:dev
# In a second terminal, Vite proxies /api to localhost:8787:
pnpm dev
```

`LOCAL_DEV=true` bypasses authentication only for loopback URLs. The backend fails closed without a valid Access JWT on deployed hosts. The plain Vite UI can log workouts without a running API; it displays a local sync status and Coach remains unavailable until synchronization succeeds.

## Cloudflare and GitHub deployment

No deployment is performed by installing this repository. Create your Cloudflare account, choose a Worker identifier, and provision D1:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create lifts-coach
```

Keep `wrangler.jsonc` as the public placeholder template. Never commit your database identifier, Access team domain/audience, account metadata, or credentials. Keep the D1 database name aligned with the scripts/workflow if renamed. Configure a Cloudflare Access application and an allow policy restricted to your own email **before putting personal training data or AI credentials on the public endpoint**. Protect the entire Worker/`workers.dev` hostname, not just one API path. The Worker independently validates JWT signature, issuer, audience, and expiry for every API request.

For local deployment setup, enter the returned database ID and Access metadata through prompts so values are not saved in shell history:

```sh
read -r -p 'D1 database ID: ' D1_DATABASE_ID
read -r -p 'Access team domain: ' ACCESS_TEAM_DOMAIN
read -r -p 'Access application audience: ' ACCESS_AUD
export D1_DATABASE_ID ACCESS_TEAM_DOMAIN ACCESS_AUD
pnpm cloudflare:configure
```

This generates the ignored `wrangler.deploy.json` with only the deployment metadata overlay. Provider keys and deployment credentials are never copied into that file. Keep it private, and do not force-add ignored files. The source template stays unchanged.

Alternatively, keep these metadata fields in the ignored `.env.deploy.local` and run `pnpm cloudflare:configure:local` (Node's `--env-file` loads them without putting values in command arguments). Missing Access fields fail closed without printing their values. To initialize D1 before Access setup, generate a database-only migration configuration:

```sh
node --env-file=.env.deploy.local scripts/configure-cloudflare.mjs --database-only
pnpm exec wrangler d1 migrations apply lifts-coach --remote --config wrangler.deploy.json
```

Database-only output leaves Access fields empty and is for migrations only. `pnpm deploy` and CI always regenerate a strict configuration requiring Access metadata before deployment.

Provision BYOK credentials with Wrangler, never with the browser:

```sh
pnpm exec wrangler secret put OPENAI_API_KEY --config wrangler.deploy.json
# Optional alternative:
pnpm exec wrangler secret put ANTHROPIC_API_KEY --config wrangler.deploy.json
```

Settings lists providers only when their Worker secret exists. Models default to `gpt-5-mini,gpt-4.1-mini` and `claude-sonnet-4-5`; override allowed lists using `OPENAI_MODELS` / `ANTHROPIC_MODELS` Worker variables when your provider account supports other models. The UI never requests, stores, or exports an API key.

Coach uses the first provisioned model when no model has been selected. Settings shows that effective selection and preserves a valid saved choice. Conversation replies can include routine drafts, exercise edits and preference proposals; these require review and approval before changing training data. Provider credential, quota and generation errors are reported separately from malformed app requests. Worker diagnostics omit prompts, provider bodies and credentials.

Add all five deployment settings as GitHub repository/production environment **Secrets**: `CLOUDFLARE_API_TOKEN` (least privilege Worker deployment and D1 access), `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `ACCESS_TEAM_DOMAIN`, and `ACCESS_AUD`. The last three also accept GitHub Variables for compatibility, with Secrets taking precedence. Prefer Secrets so GitHub masks account-specific values even in step environment headers; the workflow additionally registers metadata masks before Wrangler runs. These values belong in GitHub configuration, not source files. Provider keys remain Worker secrets and are not needed in GitHub Actions.

The workflow tests and builds pull requests and main pushes without Cloudflare configuration; only a successful **main push** with all deployment inputs configured generates the private config, migrates, and deploys. Missing configuration produces a clear skipped-deployment notice. A GitHub production environment can enforce deployment review if desired. The frontend is a Worker Static Assets binding with `/api/*` Worker-first routing. No separate frontend host is required.

If the deployment job skips, open its **Check deployment configuration** step. It reports each missing or invalid setting by name and where to add it, without displaying its value. Set these in GitHub **Settings → Secrets and variables → Actions → Secrets**, or in the selected `production` environment:

- **Secrets:** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the account identifier is 32 hexadecimal characters).
- **Secrets preferred; Variables also accepted:** `D1_DATABASE_ID` (D1 UUID), `ACCESS_TEAM_DOMAIN` (bare `team.cloudflareaccess.com`, without a URL scheme/path), and `ACCESS_AUD` (the Access application's audience).

After correcting the settings, rerun the workflow. A skipped deployment leaves checks successful and makes no Cloudflare changes. The preflight checks configuration format, not whether the token has the required permissions or whether Access/D1 resources exist; those failures are reported by Wrangler during deployment. The workflow pins Ubuntu 24.04 and uses Node 24 action runtimes plus the project's Node 24/pnpm toolchain.

For an explicitly requested manual deployment, keep the metadata environment variables set and use the generated config:

```sh
pnpm db:migrate:remote
pnpm deploy
```

Cloudflare free quotas can cover modest personal usage, but free operation is not guaranteed. Model calls have separate provider charges. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Data and approval boundaries

Starting a routine copies prescriptions into a session snapshot. Today-only actions change the active snapshot; going-forward changes affect one selected routine; next-workout edits are consumed once on the next matching session. Finished sessions remain separate, with explicit set corrections updating audit timestamps. AI outputs are pending proposals: each edit is selected and approved before application. Coach proposals carry a target fingerprint so changed targets require a fresh review.

Every local update and its outbox operation commit in one IndexedDB transaction. Reconnect replays revision-checked requests; D1 stores operation receipts bound to request content for idempotent retry. State is stored in chunks below 1 MB so accumulated history does not exceed D1's 2 MB row limit; chunk replacement, revision changes and receipts commit atomically. This prototype uses complete-document synchronization with a 20 MB request cap: a larger document remains safe locally but requires a storage upgrade to synchronize. No history is silently removed. A cross-device revision conflict stops automatic replay and asks which complete document to retain. **Export both devices before resolving a conflict** if both have important edits; there is intentionally no automatic merge engine.

Settings exports a complete schema-versioned JSON backup of routines, custom exercises, workouts, scheduled changes, Coach proposals/chat, profile, progression increments and preferences. Restore validates nested data and requires explicit confirmation. Backups include `catalogVersion`; built-in exercise definitions are versioned in source rather than duplicated in backups. An incompatible catalog version is rejected rather than guessing at historical exercise identities. Browser storage can be cleared by the OS/user; keep independent backups.

## PWA and privacy

### Inviting community members

Add each approved email to the **lifts.coach Cloudflare Access application's Allow policy**. Keep admission restricted to those emails; a rule allowing the one-time-PIN login method by itself allows any email. Keep the invite list in Cloudflare, never in this public repository. Members visit the app and verify the email code; they do not need a Cloudflare account or an AI provider key.

The first verified request provisions one account and one profile. New members choose a display name and confirm their device-detected timezone before training. Routines, workouts, chats and local sync queues belong to that account. Workouts and profile stats start private and are shared independently. All active admitted members can use Coach with the server's provisioned providers; no member supplies an API key. Existing accounts gain Coach access on their next authenticated request.

Before a broader rollout, verify a real second email through Access: finish profile setup, start and finish a starter workout, reload on the same account, and confirm the other account's private data stays unavailable. Local multi-account tests cover application isolation, but do not validate the deployed Access policy or email delivery.

See [production readiness](docs/production-readiness.md) for the matching favicon,
Apple/Android install assets, update behavior, and the release gates for the
owner's expanded plan to support other users on both phone platforms.

The manifest includes standalone display and raster install icons. Static assets are cached by the service worker; API responses are excluded. On iPhone, use Safari **Share → Add to Home Screen**. On Android, use the browser's install action. Logging can recover after reload and works without a model or network connection. Rest timers use expiry timestamps and recover after suspension; they are in-app timers, not native background notifications.

Personal data is stored locally and in your Cloudflare account, partitioned by the verified Access identity. The Data & privacy screen exports a backup and can permanently delete that identity's local and cloud copies after confirmation. Coach requests send relevant routines, a bounded recent history, profile and conversation to the chosen model provider. Exercise and workout notes are excluded from automatic Coach context and all shared responses. The research corpus consists of manually curated, cited Markdown summaries bundled with the Worker. No live literature search or automatic ingestion runs. Review the corpus's [maintenance notes](evidence/README.md) before extending it.

See [acceptance checklist](docs/acceptance-checklist.md) for scope and verification. This prototype should be verified on real iOS/Android devices and with an actual Access/D1 deployment before relying on it as your sole training record.

For an isolated local Worker integration check (this writes synthetic fixtures, so use its separate persistence directory):

```sh
pnpm exec wrangler d1 migrations apply lifts-coach --local --persist-to .wrangler/integration
pnpm exec wrangler dev --local --port 8787 --persist-to .wrangler/integration --var LOCAL_DEV:true
# In a second terminal:
node scripts/test-worker.mjs
```

`pnpm exec wrangler deploy --dry-run` checks deployment bundling from the placeholder template without publishing. To validate your private overlay, first run `pnpm cloudflare:configure`, then `pnpm exec wrangler deploy --dry-run --config wrangler.deploy.json`.

## License

MIT. Exercise descriptions and evidence summaries are original concise text with traceable references; linked publications retain their own copyright. Geist fonts are distributed under the SIL Open Font License, included in [the font license](public/geist-font-license.txt).
