# Persistent exercise notes

The owner selected a notes-only implementation after reviewing feedback. Structured percentages, reference maxima, rounding controls and set-group editing are removed.

- Add an optional **Exercise note** beneath each exercise's existing routine prescription controls.
- Store the personal note by stable exercise identity so it follows the exercise across routines, including custom exercises.
- Keep existing session feedback separate. Do not automatically convert prior feedback into persistent instructions.
- Save routine-editor notes atomically with **Save routine**, preserving discard behavior and detecting concurrent changes to shared exercise notes.
- Display saved instructions above the active exercise's set table. The pencil-only inline editor updates the personal note and matching active occurrences while preserving finished workouts.
- Snapshot instructions when starting a workout. Repeat preserves captured instructions and clears session feedback.
- Keep notes private in Community/profile responses and out of automatic Coach context. Include them in private backups and durable local synchronization.
- Keep the existing Sets / Reps / Target weight controls and manual workout logging. Text can describe special cases such as “7×3 — last two at 85%; pause 3 seconds” without calculating loads.
- Leave the protected specification unchanged. Preserve unrelated workspace changes.

Verification covers staged saves, edits/clearing, duplicate exercise occurrences, historical snapshots, replacement exercises, backup migration, idempotent sync retries, privacy and phone/desktop layout.
