# Lifts Coach visual direction

The owner requested a cleaner, more minimal and aesthetic redesign inspired by the [shadcn Maia preset](https://ui.shadcn.com/create?preset=b6sUiTsN1). This subsequent instruction overrides the original specification's Electric Minimal visual palette and typography. `fitness_app_product_spec.md` remains protected and unchanged; its behavior and data invariants still apply.

The reference preset uses Maia, Olive base, Yellow theme, Olive charts, Geist for headings/body, Lucide icons, default radius, and restrained inverted/translucent selected menus.

## Foundation

- Warm olive canvas `#F5F5F2`, white surfaces, ink `#292D23`, muted olive text `#73796A`, and subtle olive dividers `#E3E6DC`.
- Yellow `#F1D653` is a restrained primary action accent with ink text. Informational charts use muted olive rather than the primary yellow.
- Real self-hosted Geist via `@fontsource-variable/geist`, with 400 body, 500 headings and 600 emphasis. No external font requests or synthetic font labels.
- Roughly 24px card corners, 12–14px fields, pill-shaped prominent actions, and 4px spacing increments. Shadows are limited to layered dialogs/navigation where needed; content surfaces use borders.
- Controls remain at least 44×44px; main actions 48–52px. Tabular numbers support logging. Focus rings are visible and neutral/olive.

## Layout

Train has a single next-session card containing its routine title and plain metadata, followed by simple saved-routine/history lists. Avoid duplicate headings, duplicate Settings actions, generic icon boxes and decorative statistics. Desktop uses intentional columns for the next session and routine list; mobile stacks them.

The active set remains the primary interface. Keep the completion action visible on common phone sizes, use compact context above the set, and reveal reorder/substitution/bulk controls progressively. Mobile navigation has three clear tabs; desktop navigation is restrained and integrated with the shell. Preserve the in-app mini-player only while a workout is active on another screen.

Progress puts exercise strength and consistency first. Coach looks like a focused conversation, with quiet contextual actions and inspectable approvals. Routine editing and proposals share the same visual controls.

## Routine editing and contextual controls

The owner's later usability request makes routine creation and editing a full-page Train sub-screen at every width. Its dedicated Back/title/Save header replaces the global navigation while editing. Manual and Coach routines use the same staged draft; exercise, custom-exercise and increment changes persist together only on Save. Leaving a changed draft requires a discard decision, including browser Back. Opening an untouched new draft does not prompt. An active workout stays intact and remains reachable through its mini-player.

Swipe an exercise row to the right to reveal its removal action; a full right swipe requests confirmation. The explicit visible Remove button and keyboard shortcuts provide alternatives. Only “Yes, remove” changes the draft; Cancel preserves it, and the stored routine changes only after Save. This owner-requested confirmation overrides the previous immediate routine-item removal behavior without adding confirmation to ordinary workout logging.

Pickers, exercise context, corrections and confirmations use full-width bottom drawers on phones and centered panels on desktop. Settings separates General, Profile and Coach, with a reachable Data & sync page for backup, restore, status and explicit conflict resolution. Coach starts with three concise optional prompts; evidence and approval details remain inspectable.

Responsive controls favor readable values over squeezing fields beside step buttons. Mobile load/repetition values occupy the full width above their 44px step controls. Dense set tables pan inside their own container rather than expanding the page. Coach reserves space for navigation and the active-session mini-player while its conversation scrolls above the composer.

## Semantics and boundaries

Green `#347A55` confirms completed sets; muted red `#B64E45` identifies destructive/reject actions. AI uses a restrained violet icon/label `#685781`, not purple surfaces. Pending Coach proposals identify their origin explicitly. Deterministic progression uses olive/yellow neutrals and never AI branding. Do not recolor every region or muscle group.

The redesign changes presentation only. Preserve local-first transactions, snapshot/history boundaries, explicit Coach approval, numerical units, durable queues, backups and authenticated Worker configuration. Never add fake user metrics, history or provider responses for visual polish.
