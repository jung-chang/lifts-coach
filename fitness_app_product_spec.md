# AI-Native Fitness Tracker — Product & Technical Specification

**Status:** Confirmed product plan (decisions ratified October 13, 2026)  
**Working name:** **TBD** for public branding; use a temporary internal development name (not a final brand). Naming explorations include *Fitient*, *Kinient*, *Aptient*, and others; none is selected or domain-cleared.  
**Product type:** Personal-use, mobile-first fitness tracker with a context-aware AI coach.  
**Guiding principle:** **Remember everything, ask almost nothing, and interrupt only when a decision matters.**

> **Decision status:** The product choices summarized in §11 are confirmed. Remaining questions are implementation details, not decisions to revisit by default. This is a product plan, not a claim that features have already been implemented.

## 1. Product vision

Build a **minimal, practical workout tracker** that makes logging resistance training effortless and uses AI to help maintain, adapt, and improve a training program. AI should be integrated into relevant workflows, not positioned as a constant feed of suggestions or an unnecessarily complex autonomous-agent product.

The product supports three core jobs:

1. **Plan:** Create, edit, and adapt routines.
2. **Train:** Execute and log workouts quickly.
3. **Understand:** Review performance and make evidence-informed improvements.

The AI coach serves all three jobs. It is not a replacement for the essential non-AI logging flow. **Minimize interactions rather than removing useful capabilities:** everyday tracking stays quiet, while advanced actions appear only in context.

### Product constraints

- **Personal use**, not a multi-tenant SaaS product.
- **Mobile-first** Progressive Web App (PWA), with a polished installed-app experience.
- **Minimal UI** and progressive disclosure; no feature-packed dashboard.
- **Low maintenance and essentially zero fixed hosting cost** at personal usage levels, subject to provider limits and charges.
- **Bring your own AI provider API key**, provisioned during deployment as a Cloudflare Worker secret (not entered through the PWA); usage costs are separate from hosting.
- All critical workout logging works without model calls and tolerates temporary network loss.
- The user remains in control of program changes.

## 2. Navigation and core screens

**Bottom navigation:** `Train` · `Progress` · `Coach`. Prioritize installation on iPhone and Android as a PWA; support responsive desktop as a secondary use case.

**State-aware navigation:** When no workout is active, Train presents the next routine and saved routines. When a session is active, Train opens or resumes that workout directly—never force a detour through the home screen. The app has two behavioral modes (not training / training), not extra tabs.

An active workout has a focused interface. If the user navigates elsewhere in the app, a compact persistent workout mini-player provides a route back to the session. Show the mini-player **only while a workout is active and the user navigates away from its full-screen view**; do not show it when there is no active session. This mini-player is **inside the app**, not a native system Live Activity.

### 2.1 Train (home)

Intentionally sparse:

- **Up next:** Routine name, short summary (exercise count, sets, estimated duration), and prominent **Start Workout** action.
- **Saved routines:** Simple list; open to inspect or edit; support starting any routine out of order.
- Optional compact supporting context only where genuinely useful.
- No mandatory charts, permanent AI suggestion cards, routine carousels, or noisy summaries on the main screen.

### 2.2 Routine editing

- Create, rename, duplicate as appropriate, and edit routines manually.
- Add, remove, replace, and reorder exercises.
- Select from **approximately 100–150 common built-in canonical exercises** or add **custom exercises**; retain stable exercise identities so history and Coach edits remain reliable. Catalog entries include **name, primary muscles, equipment, and concise written instructions**, with **no demonstration images or videos in V1**.
- Prescribe sets, rep targets/ranges, **target weights**, and rest periods. During workouts, prefill from **recent performance** with the stored target as a fallback/guide; keep values editable.
- Use progressive disclosure for exercise detail and secondary controls.
- **Use one shared exercise/routine editor** for manual changes and AI-proposed changes. Coach populates an inspectable draft using the same editing operations and components; it does not require a separate parallel editor.
- Offer a contextual Coach action to help create or edit a routine.
- Changes proposed by AI are previewed and require user approval before application.

### 2.3 Active workout

**Primary design and implementation priority.** Optimize for **open → start → complete sets → finish**, with minimal typing.

- **Focused current-set interface**: one current exercise and actionable set prominent at a time, with an **expandable full set table** for review and bulk editing.
- Previous performance and target sets/reps visible in context.
- Weight and reps **prefilled** from recent performance, using routine targets when history is unavailable, editable inline. Store target weights in routine prescriptions.
- Large **Complete Set** action; completed state is green. Log completion immediately without confirmation and expose a brief **Undo** action to reverse an accidental tap (including timer effects). Ordinary set edits, skips, and today-only reordering likewise apply immediately and remain reversible; destructive routine deletion still requires confirmation. **Completed sets remain editable both during and after a workout**, with corrections reflected in history and trends while keeping appropriate audit/update timestamps.
- Compact overview of completed/current/upcoming sets; the full set table expands on demand rather than dominating the screen.
- Rest countdown **automatically starts after completing a set**, is **editable and skippable**, and derives from timestamps so the displayed time recovers correctly after app suspension.
- Support **optional warm-up sets**, clearly distinct from working sets and excluded from working-set progression rules.
- **Freely reorder, switch, or skip exercises during an active workout** without modifying its saved routine. For **dumbbell exercises, log weight per dumbbell** (e.g., 50 lb means a pair of 50 lb dumbbells), with a clear contextual label. Support **bodyweight exercises** with repetitions plus optional **added weight or assistance**; represent assistance distinctly rather than as ordinary positive external load.
- Allow **finishing an incomplete workout**: save completed sets, preserve skipped/incomplete status for the rest, and do not pretend uncompleted sets were performed.
- **Repeat previous workout:** From workout history, start a new independent session based on a historical session’s exercise order and logged loads/reps. Do not overwrite history or require saving a new routine.
- Add sets, replace exercises where necessary, and finish workout. Finishing requires no multi-step dialog: save and display a concise summary.
- Easy exercise detail access for history, substitutions, notes, and Coach.
- Current active session remains available through the in-app mini-player **only when navigating away** to another part of the app.
- Active state is saved locally and can recover from app reload/network interruption.

### 2.4 Progress

Focus on answers rather than dashboards:

- Exercise-specific progression over time: weight/reps and useful strength trends.
- Workout history and individual session details.
- Training consistency and volume as secondary views; **consistency and exercise strength trends are the two primary user-facing questions**. Keep detailed volume behind a secondary view or available to Coach; avoid broad scoreboards.
- Personal records where meaningful.
- Contextual **Ask Coach / Analyze progress** action; no mandatory AI-generated daily feed.
- Historical charts and informational selection states primarily use the accent color.

### 2.5 Coach

Context-aware conversational assistant with the ability to **propose actual training edits**, not just chat or give suggestions.

- Uses current routine, current workout, exercise, history, **training goals, available equipment, schedule, constraints**, preferences, and applicable research summaries as context; does not require a lengthy onboarding questionnaire.
- Can answer training questions, explain recommendations, create routines, analyze plateaus, and suggest progression or exercise substitutions.
- Can propose changes to exercise choice, ordering, **prescribed weights**, sets, rep targets, and rest periods.
- Can respond to real-world constraints (e.g., shorten today's workout, accommodate other sports, modify exercise choice for available equipment).
- Contextual entry points from Train, workout, routine editor, exercise details, and Progress; **during an active workout, a small Coach affordance opens a bottom sheet**, preserving session context. A dedicated Coach tab supports free-form chat.
- Coach keeps a **lightweight, editable profile** of training goals, preferences, constraints, and relevant notes, used as context alongside workout history. **Preference memory:** When a conversation reveals a durable preference (e.g. preferred equipment or exercise variant), Coach may propose saving it; require explicit approval before persisting, and allow editing/removal from Settings.
- Coach may propose a **new custom exercise** if the desired substitution is absent from the library, but must present it for user review before creation.
- Compact citations with **expandable study summaries, limitations, and source links** for evidence-informed claims when applicable.
- **No mandatory onboarding wizard:** Open directly to a usable Train screen with two first-run actions, **Create routine** or **Ask Coach to create one**. Gather goals/equipment/scheduling information later, progressively, or conversationally; keep profile fields editable.
- No unrequested pop-up stream of AI tips or unsolicited program rewrites.

## 3. Coach edits: required behavior

**Confirmed requirement:** Coach must be able to **make changes after approval**, with clear distinction between temporary and ongoing effects.

| Scope | Example request | Data effect |
|---|---|---|
| **Current session only** | “Replace squats with leg press today.” | Edit the active workout snapshot; saved routine unchanged. |
| **Next matching workout only** | “Next leg day, swap squats for leg press.” | Save a one-time scheduled override; consume it when the next matching session is created. |
| **Permanent / going forward** | “Switch incline dumbbell press to machine press from now on.” | Edit the saved routine; future session snapshots inherit the edit. |

### Edit-and-approval flow

1. User makes a natural-language request in Coach or in context.
2. API loads relevant routines, session data, training history, and research summaries.
3. Model produces **structured, typed edit proposals**, not direct database mutations.
4. Application validates targets, operation semantics, numerical ranges, and target scope.
5. UI displays before/after changes, rationale, and affected scope.
6. User **accepts/rejects** proposed changes (including individual changes for multi-change proposals).
7. App applies accepted operations through normal transactional application code, **reusing the manual routine/workout editing engine**.
8. Historical completed workouts remain unchanged.

For a **going-forward exercise replacement, edit only the selected routine**; if the request could refer to multiple routines, ask which routine instead of applying it globally. For a multi-edit proposal, present **each change individually for selection**, then **Apply selected** (rather than all-or-nothing approval). Coach must **never silently update the program**. For ambiguous scope, ask a focused question or present a scope selector before applying. Accepted AI edits become ordinary program data; purple denotes their *AI origin while pending*, not a permanent visual property of the resulting exercise.

### Initial supported editing operations

- Replace exercise.
- Add exercise.
- Remove exercise.
- Update **prescribed weight**, sets, rep range/target, and rest period.
- Reorder exercises.
- Create a routine / propose an edited routine.

An illustrative structured proposal:

```ts
type EditScope = "current_workout" | "next_workout" | "routine";

type TrainingEdit =
  | { op: "replace_exercise"; exerciseId: string; replacementId: string }
  | { op: "update_exercise"; exerciseId: string; sets?: number; repRange?: [number, number]; restSeconds?: number; targetWeight?: number }
  | { op: "add_exercise"; exerciseId: string; afterExerciseId?: string; sets: number; repRange: [number, number] }
  | { op: "remove_exercise"; exerciseId: string }
  | { op: "reorder_exercises"; exerciseIds: string[] };

type ProposedChange = {
  scope: EditScope;
  targetId: string;
  edits: TrainingEdit[];
  rationale: string;
  evidenceIds?: string[];
};
```

This is an **illustrative API contract**; exact validation schema is an implementation detail.

### Snapshot invariant

**Routine definitions and logged workout sessions are separate.** Starting a workout copies the routine's prescribed exercises/order/sets/reps/rest into a session-specific snapshot. Temporary modifications touch that snapshot; permanent modifications touch the source routine. This is foundational to supporting temporary versus future changes safely.

## 4. Practical intelligence without extra UI

The ten previously discussed improvements are retained as capabilities but consolidated into four practical systems. **Do not expose each capability as its own feature card, dashboard, or navigation destination.**

| Consolidated capability | Included improvements |
|---|---|
| **Intelligent logging defaults** | Smart set prefill, deterministic progression suggestions |
| **Workout continuity** | Persistent in-app mini-player, flexible routine rotation |
| **Contextual coaching** | Quick actions, temporary/permanent changes, adaptive workout modifications |
| **Useful progress insights** | Exercise-specific analytics, optional session feedback, optional weekly review |

### Further behavior

- **Confirmed progression style: rep-range double progression.** When **all working sets** reach the **top of the prescribed rep range**, propose an incremental weight increase for the next matching workout; **approval is required** before changing the prescription. Default increases: **+5 lb for upper-body exercises and +10 lb for lower-body exercises**, configurable **per exercise**. Warm-up sets do not count. If targets are missed or performance drops, **retain the current weight and suggest building reps back up**; Coach is available for further advice. Form/effort may inform advice but must not create a required per-set questionnaire. Do not invoke AI on every set.
- **Quiet intelligence rule:** Previous-performance prefill, rest timing, rotation, and deterministic progression are ordinary product behaviors, **not purple AI features** and not model calls. Reserve purple and AI labels for genuinely model-generated responses, actions, and pending proposals.
- **Flexible routine scheduling:** An ordered routine rotation, not a rigid Monday–Sunday calendar. Any routine can still be launched manually.
- **Session feedback:** Optional **workout-level feeling** and **free-form notes**; no required per-set RPE or lengthy questionnaire.
- **Adaptive planning:** Coach can propose changes in response to time constraints, sports, equipment, and training goals. It edits existing plans instead of continually regenerating entire programs.
- **Weekly review:** Optional/on-demand summary in Progress or Coach. No mandatory recurring AI background jobs.

## 5. Evidence-based Coach knowledge corpus

**Confirmed approach:** Use **manually curated, citation-backed evidence summaries** of lifting best practices and scientific studies that the Coach can consult for training advice and edit proposals. Do not add live literature search or automated paper ingestion in V1.

### Simple starting implementation

- Maintain **approximately 20–40 manually curated, version-controlled Markdown research summaries** in the repository, bundled/deployed with the Worker; update manually when useful. No research CMS or live literature search in V1.
- Prioritize **ACSM and NSCA guidance**, systematic reviews, meta-analyses, and selected high-quality original studies; avoid relying on isolated studies or influencer advice.
- Cover hypertrophy, strength, programming, training volume, frequency, intensity/proximity to failure, progression, rest/recovery, exercise selection/substitutions, and athletic performance/plyometrics.
- Every summary records: **claim/findings, applicability, evidence strength or confidence (with explicit limitations), citation URL/identifier, year, and topic tags**.
- For a Coach request, retrieve a few relevant summaries by simple topic/keyword mapping, combine them with the user's D1 training context, then generate an answer or edit proposal.
- Expose **short citations** in responses, with optional **expandable study summaries, limitations, and links**; do not overwhelm routine answers with full papers.
- **Prefer stronger scientific evidence**, state meaningful uncertainty and limitations, and adapt recommendations to the user’s goals, preferences, constraints, and observed individual performance. Avoid implying certainty from a single study or treating population averages as universal rules.

Illustrative evidence record:

```yaml
id: training-frequency-001
topics: [hypertrophy, programming, frequency]
claim: >
  When total weekly training volume is equated, different
  training splits may produce similar hypertrophy outcomes.
confidence: moderate
applies_to: [adult resistance training]
limitations:
  - Evidence may not generalize to every individual or training context.
source:
  title: "Split versus full-body resistance training: systematic review/meta-analysis"
  year: 2024
  pmid: "38595233"
```

**Source candidates to review and curate** (not automatically preloaded or individually validated as part of this document):

- ACSM resistance-training position stands, including current editions.
- Systematic reviews on load, sets, and frequency (e.g., PubMed PMID `37414459`).
- Split vs. full-body systematic review/meta-analysis (e.g., PubMed PMID `38595233`).
- Further systematic reviews relevant to volume, recovery, proximity to failure, and power training.

**No vector database or fine-tuning in V1.** If the corpus grows beyond what topic tags can retrieve well, consider SQLite full-text search; embeddings are a later option, not a current dependency. Do not simply dump large PDFs into prompts; curate structured summaries with traceable source references.

## 6. Design language: Electric Minimal

**Chosen palette (confirmed):**

| Semantic token | Value | Role |
|---|---|---|
| `accent` | `#3768D4` | Navigation, primary actions, selected controls, informational charts |
| `success` | `#1F9671` | Set completion, acceptance, positive confirmation |
| `danger` | `#D45D68` | Reject, remove, delete, destructive action |
| `ai` | `#9255D3` | Coach affordances and AI-originated proposals |
| `background` | `#F7F8FB` | Main light canvas |

**Supporting neutral design tokens (proposed implementation values within the selected direction):**

```css
:root {
  --background: #F7F8FB;
  --surface: #FFFFFF;
  --surface-muted: #F1F3F8;
  --border: #E5E8F0;
  --text-primary: #171E2B;
  --text-secondary: #6C7586;
  --accent: #3768D4;
  --accent-soft: #EAF0FF;
  --success: #1F9671;
  --success-soft: #E7F6EF;
  --danger: #D45D68;
  --danger-soft: #FCECEF;
  --ai: #9255D3;
  --ai-soft: #F3ECFC;
  --radius-card: 16px;
  --radius-control: 12px;
  --screen-padding: 20px;
}
```

### Component and layout principles

- System font (SF Pro on iOS) or Inter.
- 4px spacing foundation; most gaps 8/12/16/24px.
- White cards on off-white canvas, subtle dividers, restrained shadows.
- Approximately 16px card radius, 12px control radius, 48–52px prominent action height.
- Touch targets at least 44×44px; tabular numerals for logged values.
- Screen headings approximately 28px; main content around 16px; supporting labels around 12–14px.
- Fast, restrained transitions (roughly 150–200ms).
- One dominant action per screen; secondary detail through drill-down and bottom sheets. Reuse editing controls across manual and Coach workflows.
- **Confirmation hierarchy:** Ordinary training interactions (complete, edit, skip, reorder) take effect immediately with reversal where appropriate; AI modifications to the prescribed program require explicit before/after review and approval; destructive actions require confirmation.
- Use semantic colors sparingly. **Blue starts; green completes; red rejects; purple signals AI.**
- **Light mode first (confirmed).** A charcoal-based gym-friendly dark mode is deferred to a later iteration; dark tokens are not a V1 blocker.
- No decorative gradients or arbitrary muscle-group colors.

## 7. Technical stack and hosting

| Layer | Agreed choice | Notes |
|---|---|---|
| Client | **React + TypeScript + Vite** | Mobile-first PWA |
| Styling/components | **Tailwind CSS + shadcn/ui** | Customize to Electric Minimal |
| API | **Cloudflare Workers + Hono** | Small typed HTTP API; Hono is a convenience, not a major framework requirement |
| Database | **Cloudflare D1** | Managed SQLite-compatible database |
| ORM/migrations | **Drizzle** | Schema and database access |
| AI integration | **Vercel AI SDK** | Provider abstraction and validated structured outputs |
| LLM provider | **Provider-agnostic; OpenAI default, BYOK** | **Provider/model selector in Settings**; compatible models via AI SDK (e.g., Anthropic alternative), enabled only when a matching Worker secret has been provisioned |
| Server-side AI credential | **Cloudflare Worker secret set during deployment** | Configure BYOK with Wrangler/Cloudflare deployment tools; **do not accept or store API keys in the PWA Settings UI**. Settings may select only providers/models with configured server secrets |
| Auth | **Cloudflare Access** | Restrict deployed app to personal email, avoiding custom user accounts |
| Offline active state | **IndexedDB + Dexie** | **Local-first** active workout, durable queued writes, and simple conflict handling; no multi-device merge engine |
| PWA/assets hosting | **Cloudflare Workers Static Assets** | One managed deployment for frontend + API |
| Deployment | **Wrangler + GitHub Actions** | Automated deployment from repository |
| URL | **Free `workers.dev` HTTPS** | Custom domain optional, not required |
| Research corpus | **Repository Markdown/JSON** | Bundled with backend, simple topic retrieval |

### Expected endpoints (illustrative)

- `GET/POST/PATCH /api/routines`
- `POST /api/workouts` (start from a routine snapshot)
- `PATCH /api/workouts/:id` and set-logging endpoints
- `GET /api/history` and exercise trend endpoints (including repeat-a-session initialization)
- `POST /api/coach/chat` for contextual answers / structured proposals
- `POST /api/coach/proposals/:id/apply` for validated, approved edits
- `GET /api/export` and `POST /api/import` for **complete JSON data export/restore**, with schema/version validation and safe duplicate handling

Keep the endpoint count small; exact route structure is not locked.

### Operating constraints

- No separate VPS, Docker deployment, Supabase, Firebase, LangChain, agent orchestration framework, or dedicated vector DB.
- Personal usage should generally fit within Cloudflare free tiers, but **free operation is not guaranteed**; verify current limits, and model API calls incur charges.
- Offline means reliable local workout logging and later synchronization, **not offline AI inference**.
- Use timestamp-based rest timers, not assumptions about background JavaScript execution.
- Ensure proposal application and session sync are idempotent to reduce accidental duplicate entries. For offline sync, treat local active-session writes as durable, replay queued operations on reconnect, and assume **a single active device**. **Detect conflicting cross-device edits and prompt the user to resolve them** rather than silently overwriting or building multi-device merging; exact mechanics will be tested.
- Cloudflare Access and a server-held AI key are the intended security boundaries; **API keys are provisioned as Worker secrets at deployment**, never uploaded through Settings. Implement **full-data JSON export/import** for personal backup and restore, with data validation and an explicit import confirmation.

## 8. Data model (minimal conceptual design)

- **Exercise:** Approximately **100–150 curated canonical exercises** plus user-created custom exercises, with stable identities, name, muscles/movement pattern, equipment, written instructions, and substitution metadata. **No exercise image/video asset fields are required for V1.** Include a load-tracking mode for barbell, per-dumbbell, bodyweight with added load, and assisted bodyweight.
- **Routine:** Name, position/rotation, high-level configuration.
- **RoutineExercise:** Ordered prescription: exercise, sets, reps/range, **target weight**, and rest.
- **Workout:** Started/completed timestamps, routine association, status (including incomplete finish), optional **workout-level feeling** and free-form notes.
- **WorkoutExercise:** Snapshot of exercises and planned parameters for that session.
- **WorkoutSet:** Prescribed versus actual load/reps, completion timestamp/status (completed, skipped, incomplete), warm-up vs. working-set classification, and ordering; supports post-workout corrections. Preserve whether load is per dumbbell, added bodyweight load, or assistance.
- **ScheduledEdit:** A one-time future-session override.
- **CoachProposal:** Pending/accepted/rejected structured changes, selected target scope, rationale and evidence references.
- **Settings:** **Pounds by default with kilograms supported**, lightweight editable training goals/constraints/preferences (including equipment and schedule), provider and **model** selection, and per-exercise progression increments. Coach-suggested durable preferences become part of the profile **only after approval**. **Provider API keys are configured during deployment as Cloudflare Worker secrets, not through Settings.**

Keep schema simple and change it only as real behavior requires. `WorkoutExercise` (snapshot) and `ScheduledEdit` are important additions for reliable edit scopes; `CoachProposal` is needed for review/approval.

## 9. Implementation order

### Phase 1 — Reliable core tracker

- Electric Minimal **light-mode-first** app shell and three tabs.
- **Approximately 100–150 curated built-in exercises + custom exercise creation**, routine CRUD, target weights and routine rotation.
- **State-aware Train screen**, no mandatory onboarding: create routine manually or ask Coach to draft one.
- Active workout execution: **focused current-set flow with expandable full set table**, recent-performance prefill, optional warm-up sets, free reordering/skipping of exercises, incomplete-session finishing, **automatically starting editable/skippable rest timer**, per-dumbbell and bodyweight/assistance logging, and post-completion set editing, **immediate reversible set logging/Undo**, and a **Repeat workout** action from history.
- **Local-first active session**, persistent IndexedDB state, durable offline write queue, replay on reconnect; **assume one active device, detect cross-device write conflicts and ask for resolution**, without automatic merging.
- Save history and display simple exercise trends; provide **complete JSON export/import for backup and restoration**.
- In-app mini-player visible only for an active workout when navigating elsewhere; **installable iOS/Android PWA first**, responsive desktop second.

### Phase 2 — Coach that can act

- Context-aware Coach chat and contextual entry points (during workouts: **small button → bottom sheet**), with a persistent editable goals/constraints/**equipment/schedule** profile, **OpenAI as default**, provider/model selection in Settings, and **BYOK secrets provisioned during Cloudflare deployment**.
- **Shared manual/AI editing UI**, plus Coach-proposed durable training preferences that save only upon approval.
- Structured edit proposals including **weight edits** and reviewed custom-exercise creation, validator, before/after preview, **per-change selection / Apply selected**.
- Apply edits to **current workout**, **permanent routine**, or **next matching workout**.
- Tests for scope semantics, no unapproved writes, history immutability, and idempotency.

### Phase 3 — Evidence and quiet intelligence

- Curated scientific evidence summaries and simple retrieval.
- Citations and uncertainty-aware Coach responses.
- **Deterministic rep-range double-progression** with **upper +5 lb/lower +10 lb adjustable per exercise**, all working sets at top of range as trigger, and proposed load increases requiring approval; keep weight on missed reps.
- Optional **workout-level feeling, free-form notes**, and exercise insights.
- On-demand weekly summary and broader adaptive planning when useful.

These phases describe implementation sequencing, not a commitment to additional screens or a rigid release calendar.

## 10. Explicitly out of scope / deferred

- **iOS Lock Screen Live Activities / Dynamic Island / Android native ongoing activities:** deferred. PWA and in-app mini-player only for now.
- Native iOS/Android wrappers (such as Capacitor) and Apple Watch integration.
- Multi-user SaaS architecture, subscriptions, billing, organizations, social feeds.
- Gamification, streak pressure, badges, leaderboards, or social competitions.
- Dense analytics dashboards, mandatory recovery scores, lengthy questionnaires or onboarding wizards, automatic RPE entry for every set.
- AI-generated daily feed, intrusive proactive recommendations, always-on AI monitoring.
- Complex training version graphs or autonomous agent orchestration.
- Fine-tuning, vector database, large automated paper-ingestion pipeline.
- Elaborate offline/conflict-resolution infrastructure beyond what is needed to preserve a personal workout session.

## 11. Confirmed decisions and remaining implementation details

The eight previously open product decisions were **explicitly confirmed on October 13, 2026**:

| Decision | Confirmed choice |
|---|---|
| App name | **TBD**; defer naming/domain selection |
| Theme | **Light mode first**; dark mode later |
| Exercise library | **Curated built-in catalog + custom exercises** |
| Research corpus | **Manually curated evidence summaries, cited in Coach**; no live search in V1 |
| AI provider | **Provider-agnostic, OpenAI default, bring your own key (BYOK)** |
| Workout UX | **Focused current set + expandable set table**, with an in-app mini-player on other screens |
| Offline synchronization | **Local-first active workout, queued writes, simple conflict handling** |
| Progression | **Rep-range double progression**, with proposed load increases requiring approval |

### Additional implementation decisions confirmed

The following **24 decisions** were subsequently confirmed by the user and extend the eight prior decisions without replacing them.

| # | Area | Confirmed decision |
|---|---|---|
| 1 | Development name | Public name stays TBD; use a temporary internal name |
| 2 | Exercise catalog size | Approximately 100–150 built-in common exercises, plus custom exercises |
| 3 | Template loads | Store prescribed target weights; prefill workouts from recent performance |
| 4 | Active session flexibility | Reorder or skip exercises freely without changing the saved routine |
| 5 | Incomplete sessions | Allow finishing; retain completed, skipped, and incomplete set states |
| 6 | Mini-player | Show only for an active workout when navigating away |
| 7 | Units | Pounds by default; kilograms supported |
| 8 | Load increments | Upper body +5 lb; lower body +10 lb; adjustable per exercise |
| 9 | Progression trigger | All working sets reach top of rep range; user must approve increase |
| 10 | Missed targets | Keep weight and rebuild reps; Coach can advise |
| 11 | Warm-up sets | Optional; excluded from working-set progression |
| 12 | Feedback | Optional workout-level feeling and free-form notes |
| 13 | Permanent Coach edits | Apply to selected routine only; clarify if multiple match |
| 14 | Coach load edits | May propose changes to prescribed weights with the same approval preview |
| 15 | Multi-edit approval | Review each change and Apply selected |
| 16 | In-workout Coach | Small contextual entry point opening a bottom sheet |
| 17 | Unknown exercise | Coach may propose a new custom exercise after user review |
| 18 | Coaching profile | Persistent lightweight, editable training goals/preferences/constraints/notes |
| 19 | Evidence priority | ACSM/NSCA guidance, systematic reviews, meta-analyses, selected strong studies |
| 20 | Evidence display | Short citations with expandable summaries, limitations, and links |
| 21 | Corpus maintenance | Manually maintained, version-controlled Markdown summaries |
| 22 | AI configuration | OpenAI default; provider/model selector in Settings; key server-side |
| 23 | Cross-device conflicts | Single active device assumed; detect conflicts and request resolution |
| 24 | Device priority | Installable iPhone/Android PWA first; responsive desktop also supported |

### Remaining engineering choices (not product questions)

- **Naming/domain:** Public brand remains TBD intentionally; temporary repository/app identifier may be chosen during scaffolding.
- **Exact catalog data:** Final 100–150 exercise entries, aliases, substitution metadata, and loading strategy.
- **Exact evidence sources and grading:** Curate and verify source texts, confidence labels, and summaries before referencing them in Coach.
- **Default model and secret provisioning details:** Select a current OpenAI model during implementation; configure provider credentials as Cloudflare Worker secrets during deployment. Model/provider selection is available in Settings only for configured providers. No browser-based key entry.
- **Fine UI behavior:** Exercise table expansion, optional rest notifications (if any), and approval-sheet polish. Rest countdown automatically starts on set completion and remains editable/skippable.
- **Weight handling:** kg display/conversion precision, per-exercise classification for upper/lower increments, and appropriate increments for special equipment/custom exercises.
- **Synchronization mechanics:** Revision/version fields, conflict prompt UI, and idempotency tests under the confirmed single-active-device model.
- **Dark mode tokens:** Deferred until after light-mode V1.

### Final nine product decisions confirmed (October 13, 2026)

These decisions extend all previous confirmations; where an earlier description was more general, the specific rule below takes precedence.

| # | Area | Confirmed decision |
|---|---|---|
| 25 | Exercise demonstrations | **Text only**: names, muscles, equipment, and written instructions; no images or videos in V1 |
| 26 | Dumbbell loads | Log **weight per dumbbell**, not combined pair weight |
| 27 | Bodyweight exercises | Record reps with optional **added weight or assistance** |
| 28 | Rest timer | **Auto-start after completed sets**, with edit and skip controls |
| 29 | Set corrections | Allow editing completed sets **during and after** workouts |
| 30 | Coach routine context | Consider **goals, equipment, schedule, workout history, and constraints** |
| 31 | Evidence use | **Prefer strong evidence; acknowledge uncertainty; adapt to individual performance** |
| 32 | BYOK secret setup | Configure API keys **as Cloudflare Worker secrets during deployment**; Settings only selects provisioned providers/models |
| 33 | Backup and portability | **Complete personal-data JSON export/import**, with validation and safe restore behavior |

### Additional minimalism and usability refinements confirmed (October 13, 2026)

These nine refinements are additive and **do not override** the confirmed Coach approval, snapshot/history, offline, and scope rules above.

| # | Refinement | Confirmed behavior |
|---|---|---|
| 34 | State-aware Train | Not training → next routine; active session → resume workout directly. Mini-player remains available on other tabs only while active. |
| 35 | Shared manual/AI editor | One set of exercise editing controls and operations; AI provides a proposed draft requiring review before permanent changes. |
| 36 | Quiet intelligence | Deterministic prefill, progression, rotation and timers work without AI branding or model calls. |
| 37 | Fewer confirmations | Instant/reversible ordinary workout actions; confirm destructive actions; explicit review/approval for Coach-generated program edits. |
| 38 | Simpler Progress | Strength trends and training consistency are primary; volume/extra metrics stay secondary and accessible. |
| 39 | No onboarding wizard | Start with Create routine or Ask Coach to create one; capture optional profile information progressively. |
| 40 | Undo last set action | Reverse accidental completion quickly, including associated rest-timer transition. |
| 41 | Repeat historical workout | Start a new session from prior exercise order and performance without altering history or creating a mandatory new routine. |
| 42 | Coach preference memory | Coach may propose saving useful durable preferences; save only after approval and allow later edit/removal. |

## 12. Product acceptance principles

A successful build should allow the user to:

- Create and edit a routine manually without AI.
- Open an active workout directly from Train, undo an accidental set completion, and repeat any previous workout as a fresh session.
- Start a workout and log most sets with one tap using recent-performance defaults, optional warm-up sets, per-dumbbell or bodyweight/assistance support, and lb/kg support; auto-start and adjust/skip rest timers; edit sets even after finishing.
- Leave and return to an active session without losing progress.
- Finish workouts offline and synchronize afterward.
- Ask Coach to swap an exercise **today**, **next time only**, or **going forward** (selected routine only), and to adjust prescribed loads after review.
- Preview, **select individual changes, and Apply selected** Coach edits, with completed history untouched.
- Save or discard Coach-proposed lasting training preferences, and see manual and AI changes through one consistent editor.
- Ask why a training change is recommended and inspect relevant cited evidence.
- Review exercise progression without digging through a complex dashboard.
- Export all personal training data as JSON and import a backup safely.
- Select an available AI provider/model in Settings while secrets remain configured only on the Cloudflare backend.

**North star:** A highly usable exercise tracker whose Coach makes managing a program significantly easier—without making everyday workouts more complicated.
