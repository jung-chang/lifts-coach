/** Workouts display captured instructions; editing belongs to the routine editor. */
export function PersistentExerciseNote({ snapshotNote }: { snapshotNote?: string }) {
  if (!snapshotNote?.trim()) return null;
  return (
    <section className="persistent-exercise-note" aria-label="Saved exercise instructions">
      <span className="small muted">Exercise instructions</span>
      <p className="multiline">{snapshotNote}</p>
    </section>
  );
}
