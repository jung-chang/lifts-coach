# Prototype acceptance checklist

The protected product spec is the source of requirements. Check items only after observed verification, not an implementation report.

## Core workout

- [ ] First run offers Create routine and Ask Coach, with no mandatory questionnaire or fake history.
- [ ] Active Train resumes workout; mini-player appears only on other views while training.
- [ ] Manual routine CRUD, exercise editing, prescriptions, rotation and custom exercises work.
- [ ] Catalog has approximately 100–150 stable exercises with muscles, equipment and written instructions.
- [ ] Starting a workout copies a snapshot; today-only edits never alter its routine.
- [ ] Focused set flow and expandable table show recent-performance defaults with target fallback.
- [ ] Complete persists immediately; Undo restores the set and preceding timer state.
- [ ] Deadline-based rest timer survives reload/suspension and supports edit/skip.
- [ ] Warm-ups, per-dumbbell loads, bodyweight added load and assistance are distinct.
- [ ] Unit changes preserve physical load with suitable display precision.
- [ ] Reorder/switch/skip/add sets and incomplete finish preserve correct statuses.
- [ ] Completed-set corrections work during and after training and update trends/timestamps.
- [ ] Repeat history creates a fresh session from historical order and performance.
- [ ] Reload recovery, offline finish and idempotent queue replay preserve recorded sets.
- [ ] Cross-device stale writes prompt resolution rather than overwrite.
- [ ] Progress prioritizes strength trends and consistency.
- [ ] Complete JSON backup validates, previews and confirms restore with a pre-restore backup.

## Coach and intelligence

- [ ] Tracking works without AI credentials or during AI failures.
- [ ] Settings expose only configured providers/models; keys stay backend-only.
- [ ] Context includes routine/session/history and goals/equipment/schedule/constraints.
- [ ] In-workout Coach opens a bottom sheet with session context.
- [ ] Generation/chat does not mutate program data; structured proposals are validated.
- [ ] Shared editor shows before/after, rationale and individual change selection.
- [ ] Approved current/routine/next-matching edits have correct scope and retry semantics.
- [ ] Stale/invalid proposals are rejected; completed history remains unchanged by Coach.
- [ ] Custom exercises and durable preferences require approval; preferences remain editable.
- [ ] Evidence summaries include sources, year, confidence, applicability and limitations.
- [ ] Progression requires every working set at range maximum, excludes warm-ups and needs approval.
- [ ] Missed reps retain load; configurable increments handle units correctly.
- [ ] Feeling, notes and weekly review remain optional.

## Design and release

- [ ] Spec tokens match; blue starts, green completes, red rejects, purple marks pending AI.
- [ ] 4px spacing foundation, approximately 16/12px radii and 44px minimum touch targets.
- [ ] One dominant workout action; legible tabular values; no decorative gradients or noisy cards.
- [ ] Keyboard focus, accessible labels, modal behavior, contrast and phone/desktop safe areas checked.
- [ ] MIT license, setup, contribution, security reporting and rollback/backup guidance included.
- [ ] Spec SHA256 stays `4129A87C82FBC08AA6CB16E27571DD94BAF9378C1EB95EB99B66F407B63D1084`.
- [ ] No credentials, personal histories or local databases tracked; clean lockfile install/build/test works.
- [ ] Account/D1/secret/email Access setup documented; production API fails closed without valid auth.
- [ ] API paths do not fall through to SPA HTML; service worker never caches sensitive API responses.
- [ ] Access expiry does not discard offline queue; shell works after prior authenticated visit.
- [ ] Main deploy follows passing checks; PRs get no production secrets; deployments serialize.
- [ ] Preview database is isolated if enabled; real phone/provider/deployment checks are marked pending until performed.
