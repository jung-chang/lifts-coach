/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../shared/catalog';
import { createPrescription, createRoutine, emptyData } from '../shared/domain';
import { RoutineEditor } from '../src/components/RoutineEditor';
import { createRoutineDraft } from '../src/lib/routineDraft';
import type { AppData } from '../shared/types';
import type { RoutineDraft } from '../src/lib/routineDraft';

const bench = catalog.find((e) => e.id === 'ex_barbell-bench-press')!;

function setup(
  unit: 'lb' | 'kg' = 'lb',
  sourceOverride?: ReturnType<typeof createRoutine>,
  initialExerciseSettings?: AppData['exerciseSettings'],
) {
  const source = sourceOverride ?? {
    ...createRoutine('Push'),
    exercises: [createPrescription(bench.id)],
  };
  const data: AppData = {
    ...emptyData(),
    routines: [source],
    exerciseSettings: initialExerciseSettings,
  };
  data.settings.unit = unit;
  const draft = createRoutineDraft(source);
  const onSave = vi.fn();
  const onBack = vi.fn();
  let latestDraft = draft;
  function Harness() {
    const [current, setCurrent] = React.useState<RoutineDraft>(draft);
    return (
      <RoutineEditor
        data={data}
        draft={current}
        setDraft={(next) => {
          latestDraft = next;
          setCurrent(next);
        }}
        name="Push"
        setName={() => {}}
        onBack={onBack}
        onSave={onSave}
        onAskCoach={() => {}}
      />
    );
  }
  render(<Harness />);
  return { data, draft, onSave, onBack, getDraft: () => latestDraft };
}

describe('RoutineEditor removal review', () => {
  afterEach(() => cleanup());

  it('searches exercise replacements by equipment and muscle, then updates only the draft', () => {
    const { data } = setup();
    fireEvent.click(screen.getByText('Options'));
    fireEvent.click(screen.getByRole('button', { name: /Replace exercise/ }));
    const search = screen.getByRole('searchbox', { name: 'Search replace exercise' });
    fireEvent.change(search, { target: { value: 'dumbbells' } });
    fireEvent.change(search, { target: { value: 'triceps dumbbells' } });
    const replacement = screen.getByRole('button', { name: /Dumbbell bench press/i });
    fireEvent.click(replacement);

    expect(screen.getByText('Dumbbell bench press')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(data.routines[0].exercises[0].exerciseId).toBe(bench.id);
  });

  it('blocks a displayed kg value that exceeds the stored load limit until corrected', () => {
    const { onSave } = setup('kg');
    const target = screen.getByLabelText('Total load (kg)');
    fireEvent.change(target, { target: { value: '1000' } });
    expect(target).toHaveProperty('value', '1000');
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(target, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('keeps an invalid progression increment local and blocks saving until corrected', () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByText('Options'));
    const increment = screen.getByLabelText('Progress increment (lb)');
    fireEvent.change(increment, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(increment, { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('exposes a keyboard-visible remove button and leaves the draft unchanged when confirmation is canceled', () => {
    const { data, draft, onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Barbell bench press' }));
    expect(screen.getByRole('dialog', { name: 'Remove exercise?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Remove exercise?' })).toBeNull();
    expect(document.querySelector('.routine-editor-item')).toBeTruthy();
    expect(screen.getByLabelText('Reps')).toHaveProperty('value', '8–12');
    expect(screen.queryByText('Prescription and exercise options')).toBeNull();
    expect(draft.routine.exercises).toHaveLength(1);
    expect(data.routines[0].exercises).toHaveLength(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepts a valid rep range and blocks invalid or partial values at save', () => {
    const { onSave } = setup();
    const reps = screen.getByLabelText('Reps');
    fireEvent.focus(reps);
    fireEvent.change(reps, { target: { value: '10-' } });
    fireEvent.keyDown(reps, { key: 'Enter', code: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Enter reps');
    fireEvent.change(reps, { target: { value: '8-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('does not save the routine when Enter commits a valid rep value', () => {
    const { onSave } = setup();
    const reps = screen.getByLabelText('Reps');
    fireEvent.focus(reps);
    fireEvent.change(reps, { target: { value: '8-12' } });
    fireEvent.keyDown(reps, { key: 'Enter', code: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('stages a persistent exercise note in the routine draft for the save action', () => {
    const { getDraft } = setup();
    fireEvent.change(screen.getByLabelText('Exercise note'), {
      target: { value: 'Pause at chest' },
    });
    expect(getDraft().exerciseSettings[bench.id].persistentNote).toBe('Pause at chest');
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(screen.getByLabelText('Exercise note')).toHaveProperty('value', 'Pause at chest');
  });

  it('clears a staged exercise note by clearing the field and saving', () => {
    const oldSettings = {
      [bench.id]: { persistentNote: 'Old note', updatedAt: new Date().toISOString() },
    };
    const { getDraft, onSave } = setup('lb', undefined, oldSettings);
    const field = screen.getByLabelText('Exercise note');
    expect(field).toHaveProperty('value', 'Old note');
    fireEvent.change(field, { target: { value: '' } });
    expect(getDraft().exerciseSettings[bench.id].persistentNote).toBeUndefined();
    expect(field).toHaveProperty('value', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('leaves a note draft uncommitted when the user backs out', () => {
    const { data, onBack } = setup();
    fireEvent.change(screen.getByLabelText('Exercise note'), {
      target: { value: 'Pause at chest' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(data.exerciseSettings?.[bench.id]).toBeUndefined();
  });

  it('shares the staged note across duplicate prescriptions of one exercise', () => {
    const source = {
      ...createRoutine('Push'),
      exercises: [createPrescription(bench.id), createPrescription(bench.id)],
    };
    const { getDraft } = setup('lb', source);
    const notes = screen.getAllByLabelText('Exercise note');
    fireEvent.change(notes[0], { target: { value: 'Keep shoulders set' } });
    expect(getDraft().exerciseSettings[bench.id].persistentNote).toBe('Keep shoulders set');
    expect(
      screen.getAllByLabelText('Exercise note').map((node) => (node as HTMLTextAreaElement).value),
    ).toEqual(['Keep shoulders set', 'Keep shoulders set']);
  });

  it('keeps a negative target weight local, blocks save, and accepts zero', () => {
    const { onSave } = setup();
    const target = screen.getByLabelText('Total load (lb)');
    fireEvent.change(target, { target: { value: '-1' } });
    expect(target).toHaveProperty('value', '-1');
    expect(target.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('valid value');
    fireEvent.change(target, { target: { value: '0' } });
    expect(target).toHaveProperty('value', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('does not let an invalid range on a removed exercise block saving remaining rows', () => {
    const source = {
      ...createRoutine('Push'),
      exercises: [createPrescription(bench.id), createPrescription(bench.id)],
    };
    const data: AppData = { ...emptyData(), routines: [source] };
    const draft = createRoutineDraft(source);
    const onSave = vi.fn();
    function Harness() {
      const [current, setCurrent] = React.useState<RoutineDraft>(draft);
      return (
        <RoutineEditor
          data={data}
          draft={current}
          setDraft={setCurrent}
          name="Push"
          setName={() => {}}
          onBack={() => {}}
          onSave={onSave}
          onAskCoach={() => {}}
        />
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '10-' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Barbell bench press' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('confirms removal into the draft only and blocks saving an empty routine', () => {
    const { data, draft, onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Barbell bench press' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect(screen.getByText('Your draft has no exercises yet.')).toBeTruthy();
    expect(draft.routine.exercises).toHaveLength(1); // The supplied source object remains untouched.
    expect(data.routines[0].exercises).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));
    expect(screen.getByRole('alert').textContent).toContain('at least one exercise');
    expect(data.routines[0].exercises).toHaveLength(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
