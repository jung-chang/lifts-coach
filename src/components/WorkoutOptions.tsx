import { useState } from 'react';
import { ArrowLeft, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import type { Exercise, WorkoutExercise, WorkoutSet } from '../../shared/types';
import type { ReactNode } from 'react';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';
import './workout-options.css';

export function WorkoutOptions({
  exercise,
  library,
  onAddSet,
  onReplace,
  onEditSet,
  visibility,
}: {
  exercise: WorkoutExercise;
  library: Exercise[];
  onAddSet: (kind: 'working' | 'warmup') => void;
  onReplace: (id: string) => void;
  onEditSet: (set: WorkoutSet, mode: WorkoutSet['loadMode']) => void;
  visibility: ReactNode;
}) {
  const [view, setView] = useState<'options' | 'replace' | null>(null);
  const [search, setSearch] = useState('');
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = library.filter(
    (item) =>
      item.id !== exercise.exerciseId &&
      terms.every((term) =>
        `${item.name} ${item.muscles.join(' ')} ${item.equipment}`.toLowerCase().includes(term),
      ),
  );
  const add = (kind: 'working' | 'warmup') => {
    onAddSet(kind);
    setView(null);
  };
  return (
    <>
      <Button
        variant="ghost"
        className="workout-options-trigger"
        onClick={() => setView('options')}
      >
        <SlidersHorizontal size={16} /> Options
      </Button>
      <Sheet
        open={view !== null}
        onOpenChange={(open) => {
          if (!open) setView(null);
        }}
        title={view === 'replace' ? 'Replace exercise' : 'Exercise options'}
        description={
          view === 'replace'
            ? `Replacing ${exercise.name} for today only. Your saved routine stays the same.`
            : exercise.name
        }
      >
        {view === 'replace' ? (
          <div className="workout-replacement">
            <Button variant="ghost" onClick={() => setView('options')}>
              <ArrowLeft size={16} /> Back to options
            </Button>
            <div className="search-wrap">
              <Search size={17} />
              <input
                autoFocus
                className="input"
                aria-label="Search replacement exercises"
                placeholder="Name, muscle, or equipment"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {exercise.actualSets.some((set) => set.status === 'completed') && (
              <p className="muted small">
                Completed sets stay with {exercise.name}. The replacement is added next.
              </p>
            )}
            <p className="muted small" role="status">
              {results.length} {results.length === 1 ? 'exercise' : 'exercises'}
            </p>
            <div className="workout-replacement-results">
              {results.map((item) => (
                <button
                  type="button"
                  className="exercise-result"
                  key={item.id}
                  onClick={() => {
                    onReplace(item.id);
                    setView(null);
                  }}
                >
                  <span className="grow">
                    <span>{item.name}</span>
                    <span className="muted small workout-replacement-meta">
                      {item.muscles.join(', ')} · {item.equipment}
                    </span>
                  </span>
                </button>
              ))}
              {results.length === 0 && (
                <div className="empty-state">
                  <p>No exercises found.</p>
                  <Button variant="secondary" onClick={() => setSearch('')}>
                    Clear search
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="workout-options-content">
            <div className="workout-option-actions">
              <Button variant="ghost" onClick={() => add('working')}>
                <Plus size={17} /> Add working set
              </Button>
              <Button variant="ghost" onClick={() => add('warmup')}>
                <Plus size={17} /> Add warm-up set
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setView('replace');
                }}
              >
                <RefreshCw size={17} /> Replace exercise
              </Button>
            </div>
            {exercise.loadMode === 'bodyweight' && exercise.actualSets.length > 0 && (
              <section className="workout-option-section">
                <h3>Load modes</h3>
                {exercise.actualSets.map((set, index) => (
                  <label className="workout-load-mode" key={set.id}>
                    <span>
                      {set.kind === 'warmup' ? 'Warm-up' : 'Set'} {index + 1}
                    </span>
                    <select
                      className="select"
                      aria-label={`Set ${index + 1} load mode`}
                      value={set.loadMode || exercise.loadMode}
                      onChange={(event) =>
                        onEditSet(set, event.target.value as WorkoutSet['loadMode'])
                      }
                    >
                      <option value="bodyweight">Added weight</option>
                      <option value="assistance">Assistance</option>
                    </select>
                  </label>
                ))}
              </section>
            )}
            <section className="workout-option-section">
              <h3>Workout sharing</h3>
              {visibility}
            </section>
          </div>
        )}
      </Sheet>
    </>
  );
}
