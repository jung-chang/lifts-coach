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

function setup() {
  const source = { ...createRoutine('Push'), exercises: [createPrescription(bench.id)] };
  const data: AppData = { ...emptyData(), routines: [source] };
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

  it('exposes a keyboard-visible remove button and leaves the draft unchanged when confirmation is canceled', () => {
    const { data, draft, onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Barbell bench press' }));
    expect(screen.getByRole('dialog', { name: 'Remove exercise?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Remove exercise?' })).toBeNull();
    expect(
      screen.getByRole('group', { name: 'Barbell bench press, swipe right to reveal remove' }),
    ).toBeTruthy();
    expect(draft.routine.exercises).toHaveLength(1);
    expect(data.routines[0].exercises).toHaveLength(1);
    expect(onSave).not.toHaveBeenCalled();
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
