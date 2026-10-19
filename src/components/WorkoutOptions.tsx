import { useState } from 'react';
import { ArrowLeft, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { Exercise, WorkoutExercise, WorkoutSet } from '../../shared/types';
import type { ReactNode } from 'react';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';
import './workout-options.css';
import { SearchPicker } from './SearchPicker';

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
        open={view === 'options'}
        onOpenChange={(open) => {
          if (!open) setView(null);
        }}
        title="Exercise options"
        description={exercise.name}
      >
        {' '}
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
      </Sheet>
      <SearchPicker
        hideTrigger
        open={view === 'replace'}
        onOpenChange={(open) => {
          if (!open) setView(null);
        }}
        label="Replace exercise"
        searchLabel="Search replacement exercises"
        value={exercise.exerciseId}
        description={`For today only.${exercise.actualSets.some((set) => set.status === 'completed') ? ' Completed sets stay with the original exercise; the replacement is added next.' : ''}`}
        options={library
          .filter((item) => item.id !== exercise.exerciseId)
          .map((item) => ({
            value: item.id,
            label: item.name,
            description: `${item.muscles.join(', ')} · ${item.equipment}`,
          }))}
        onChange={onReplace}
        placeholder="Name, muscle, or equipment"
        emptyMessage="No exercises found."
        footer={
          <Button className="back-button" variant="ghost" onClick={() => setView('options')}>
            <ArrowLeft size={16} /> Back to options
          </Button>
        }
      />
    </>
  );
}
