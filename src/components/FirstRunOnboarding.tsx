import { Download, Dumbbell, Plus, Upload } from 'lucide-react';
import { Button } from './ui/Button';

export type FirstRunOnboardingProps = {
  onCreateRoutine: () => void;
  onImportBackup: () => void;
  onTrySampleRoutine: () => void;
};

/** A short starting point for a new, empty local library. */
export function FirstRunOnboarding({
  onCreateRoutine,
  onImportBackup,
  onTrySampleRoutine,
}: FirstRunOnboardingProps) {
  return (
    <section className="card card-pad first-run-card" aria-labelledby="first-run-title">
      <h1 id="first-run-title">Start with a routine</h1>
      <div className="row first-run-actions" aria-label="Get started">
        <Button type="button" variant="primary" size="lg" onClick={onTrySampleRoutine}>
          <Dumbbell size={17} aria-hidden="true" /> Use starter routine
        </Button>
        <Button type="button" size="lg" onClick={onCreateRoutine}>
          <Plus size={17} aria-hidden="true" /> Create routine
        </Button>
      </div>
      <Button type="button" variant="ghost" onClick={onImportBackup}>
        <Upload size={17} aria-hidden="true" /> Import backup
      </Button>
      <p className="muted small" style={{ margin: '18px 0 0' }}>
        Install anytime from your browser menu: choose <strong>Add to Home Screen</strong> on iPhone
        or <strong>Install app</strong> on Android.
        <Download size={14} aria-hidden="true" style={{ marginLeft: 6, verticalAlign: '-2px' }} />
      </p>
    </section>
  );
}
