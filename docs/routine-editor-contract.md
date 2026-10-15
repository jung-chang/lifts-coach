# Routine editor implementation contract

This user-approved UX update keeps the protected product specification unchanged. Routine creation/editing is a full-page Train sub-screen at all widths. Contextual controls use mobile sheets.

## Current refinement contract

The owner's newest workout instruction replaces the focused-set overview with an always-visible table for the current exercise. Its four primary columns are Set, Load, Reps and Done, and fit 320px without horizontal panning. Load/reps remain editable per row; Done is a single-click checkbox with a 44px hit area. There is no set-status dropdown, hide/show table control, Complete Set action or fixed completion bar. Finish workout is clearly labeled at the top only. Exercise navigation remains available; warm-up/add/skip/load-mode capabilities move into Options.

Done changes use the root-owned `setDone(data, workoutId, exerciseId, setId, done)` helper. Checked active sets complete, timestamp and start rest; duplicate completion is a no-op. Unchecked completed sets become incomplete, clear their completion timestamp and clear only the related rest timer. Unchecked skipped rows remain skipped. Finished-history corrections use the same helper without starting rest. Active changes offer Undo using the before state captured inside the serialized store updater, not a stale rendered snapshot. This instruction explicitly supersedes the original focused-set design; the protected specification is unchanged.

For this table refinement, the Luna agent implemented App, a reusable SetTable component and relevant DOM tests. The orchestrator owns the integrated App/table review, CSS, documentation and checks; the root owns AGENTS guidance and shared domain/types/core tests for timer attribution, idempotence and completed-history correction semantics. No store, Worker, spec, secrets or private deployment changes.

The owner's latest instruction removes exercise swipe gestures entirely and retains the explicit 44px Remove button with confirmation. Whole saved routines use a visible 44px trash button on Train; Cancel leaves data untouched and “Yes, delete” calls the shared `deleteRoutine` engine through the existing local transaction. Deletion keeps active and finished workout snapshots intact, removes scheduled overrides and rejects affected pending proposals, and preserves rotation continuity.

Exercise prescriptions show three primary controls in one compact row: Sets, one Reps range field (for example `8–12`, with a single count supported), and Target weight. Rest, progression increment, replacement and reorder controls live behind Options. Parse ranges locally, stage only valid integer ranges from 1–100 with maximum at least minimum, and prevent saving invalid input. Keep 44px targets and readable decimal weights at 320px. Create routine opens the full-page editor directly, with the title input immediately available and focused for new drafts; no title modal. The current table contract above supersedes the earlier two-field focused workout layout.

For this refinement, the Luna implementation agent owns `src/App.tsx`, `src/components/RoutineEditor.tsx` and their DOM tests, plus a bounded rep-range parser/test if needed. The orchestrator owns CSS, documentation, integration review and removal of unused swipe files. The root agent exclusively owns `shared/domain.ts` and `tests/core.test.ts` for routine deletion/rotation semantics. No Worker, store, protected spec or private configuration changes.

## Ownership for this implementation

- Editor agent: `src/App.tsx`, `src/components/RoutineEditor.tsx`, the bounded rep-range parser and corresponding DOM/parser tests.
- Root agent: `shared/domain.ts` and `tests/core.test.ts` for deletion, cleanup and rotation invariants.
- Orchestrator: `src/index.css`, removal of unused gesture modules/tests, integration review and documentation.

Implementation agents do not change domain, store, Worker, protected specification or private deployment files. The orchestrator exposed a small Retry sync wrapper around the existing connection/queue code and verified its lost-acknowledgement behavior. No sync or merge algorithm changed. Coordinate exports before adapting another agent's component.

## Shared components

Routine and exercise removal use explicit accessible buttons. Exercise removal targets the prescription ID so duplicate exercise entries remain independent. No gesture handler or row keyboard shortcut requests deletion. Confirmation changes only the draft; Save remains the persistence boundary.

`Sheet` accepts the existing Dialog props `{ open, onOpenChange, title, description?, children }`. Use Radix Dialog for focus management/escape semantics; mobile is a bottom drawer, desktop is centered. Provide safe wrapping, scrolling, safe-area padding and 44px controls. Explicit destructive confirmation has Cancel and **Yes, remove**.

## Draft and navigation invariants

Manual and Coach routine drafts use one full-page editor. Copy the routine into a draft before editing; stage prescription changes, custom exercises and progression increments. No store transaction occurs until Save. Cancel/confirmed discard preserves saved routines, history and active workout. Removing the last item may leave an empty draft; show a clear validation state before Save. Add exercises before the first Save without forcing an empty routine into storage.

Save commits all staged data in one ordinary local transaction. Coach drafts still require explicit review/approval and the existing proposal application/fingerprint protections. Existing-routine drafts detect if their source changed while editing. Preserve prescription IDs so duplicate exercises can be removed/reordered independently.

Back and browser Back both leave clean drafts immediately and request confirmation for changed drafts. Rejecting discard keeps the editor usable; confirming discard restores the prior view without history loops. Keep unsaved routines out of backend Coach target IDs: either request Save first or compose a contextual request without losing the draft. Active sessions continue untouched; show the mini-player when the full-page editor replaces the active workout view, even though the selected tab remains Train.

The mobile audit covers 320px and 390px plus desktop. Inputs and interactive targets must remain at least 44px, numerical values must be legible, and text must wrap instead of clipping. Coach starts with a short heading and no more than three quiet prompts; evidence and proposal reviews remain inspectable.
