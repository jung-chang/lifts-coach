# Routine editor implementation contract

This user-approved UX update keeps the protected product specification unchanged. Routine creation/editing is a full-page Train sub-screen at all widths. Contextual controls use mobile sheets.

## Ownership for this implementation

- Editor agent: `src/App.tsx`, `src/components/RoutineEditor.tsx`, `src/lib/routineDraft.ts`, editor/navigation helpers and corresponding tests.
- Interaction agent: `src/components/SwipeToDeleteRow.tsx`, `src/lib/swipeDelete.ts`, `src/components/ui/Sheet.tsx`, swipe/sheet tests.
- Orchestrator: `src/index.css`, integration review, documentation and configuration/dependencies.

Implementation agents do not change domain, store, Worker, protected specification or private deployment files. The orchestrator exposed a small Retry sync wrapper around the existing connection/queue code and verified its lost-acknowledgement behavior. No sync or merge algorithm changed. Coordinate exports before adapting another agent's component.

## Shared components

`SwipeToDeleteRow` accepts `{ id: string; label: string; children: ReactNode; onRequestDelete: () => void }`. `id` is the prescription ID, never the catalog exercise ID. A right swipe of about 72px reveals a Delete action; a larger swipe (approximately 180px or 55% of width, capped appropriately) requests confirmation. Neither gesture directly removes anything. Vertical scrolling remains native through `touch-action: pan-y`, and controls inside the row do not start a gesture. An explicit accessible Remove button/keyboard route remains available.

`Sheet` accepts the existing Dialog props `{ open, onOpenChange, title, description?, children }`. Use Radix Dialog for focus management/escape semantics; mobile is a bottom drawer, desktop is centered. Provide safe wrapping, scrolling, safe-area padding and 44px controls. Explicit destructive confirmation has Cancel and **Yes, remove**.

## Draft and navigation invariants

Manual and Coach routine drafts use one full-page editor. Copy the routine into a draft before editing; stage prescription changes, custom exercises and progression increments. No store transaction occurs until Save. Cancel/confirmed discard preserves saved routines, history and active workout. Removing the last item may leave an empty draft; show a clear validation state before Save. Add exercises before the first Save without forcing an empty routine into storage.

Save commits all staged data in one ordinary local transaction. Coach drafts still require explicit review/approval and the existing proposal application/fingerprint protections. Existing-routine drafts detect if their source changed while editing. Preserve prescription IDs so duplicate exercises can be removed/reordered independently.

Back and browser Back both leave clean drafts immediately and request confirmation for changed drafts. Rejecting discard keeps the editor usable; confirming discard restores the prior view without history loops. Keep unsaved routines out of backend Coach target IDs: either request Save first or compose a contextual request without losing the draft. Active sessions continue untouched; show the mini-player when the full-page editor replaces the active workout view, even though the selected tab remains Train.

The mobile audit covers 320px and 390px plus desktop. Inputs and interactive targets must remain at least 44px, numerical values must be legible, and text must wrap instead of clipping. Coach starts with a short heading and no more than three quiet prompts; evidence and proposal reviews remain inspectable.
