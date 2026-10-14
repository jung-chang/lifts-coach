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

function setup(unit: 'lb' | 'kg' = 'lb') {
  const source = { ...createRoutine('Push'), exercises: [createPrescription(bench.id)] };
  const data: AppData = { ...emptyData(), routines: [source] };
  data.settings.unit = unit;
  const draft = createRoutineDraft(source);
  const onSave = vi.fn();
  const onBack = vi.fn();
  function Harness() {
    const [current, setCurrent] = React.useState<RoutineDraft>(draft);
    return (
      <RoutineEditor
        data={data}
        draft={current}
        setDraft={setCurrent}
        name="Push"
        setName={() => {}}
        onBack={onBack}
        onSave={onSave}
        onAskCoach={() => {}}
      />
    );
  }
  render(<Harness />);
  return { data, draft, onSave, onBack };
}

describe('RoutineEditor removal review', () => {
  afterEach(() => cleanup());

  it('blocks a displayed kg value that exceeds the stored load limit until corrected', () => {
    const { onSave } = setup('kg');
    const target = screen.getByLabelText('Target (kg)');
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

  it('keeps a negative target weight local, blocks save, and accepts zero', () => {
    const { onSave } = setup();
    const target = screen.getByLabelText('Target (lb)');
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
