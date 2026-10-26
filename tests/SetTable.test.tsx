// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../shared/catalog';
import { createPrescription, createRoutine, emptyData, startWorkout } from '../shared/domain';
import { SetTable } from '../src/components/SetTable';

function getExercise() {
  const routine = createRoutine('Synthetic table routine');
  routine.exercises = [{ ...createPrescription(catalog[0].id), targetWeight: 100 }];
  return startWorkout({ ...emptyData(), routines: [routine] }, routine.id).workouts[0].exercises[0];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SetTable input drafts', () => {
  it('reveals deletion for the swiped row, ignores vertical movement and keeps edits separate', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const exercise = getExercise(),
      onRemove = vi.fn(),
      onDone = vi.fn();
    render(
      <SetTable
        exercise={exercise}
        unit="lb"
        onEdit={vi.fn()}
        onDone={onDone}
        onRemove={onRemove}
      />,
    );
    const row = screen.getByRole('row', { name: 'Set 2 actions' });
    fireEvent.pointerDown(row, { button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(row, { clientX: 190, clientY: 170 });
    fireEvent.pointerUp(row);
    expect(screen.queryByRole('button', { name: 'Delete set 2' })).toBeNull();
    fireEvent.pointerDown(row, { button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(row, { clientX: 120, clientY: 103 });
    fireEvent.pointerUp(row);
    expect(onRemove).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    const action = screen.getByRole('button', { name: 'Delete set 2' });
    fireEvent.pointerDown(action, { button: 0, clientX: 250, clientY: 100 });
    fireEvent.click(action);
    expect(onRemove).toHaveBeenCalledWith(exercise.actualSets[1].id);
  });

  it('supports keyboard deletion without treating Delete inside a load input as a row action', () => {
    const exercise = getExercise(),
      onRemove = vi.fn();
    render(
      <SetTable
        exercise={exercise}
        unit="lb"
        onEdit={vi.fn()}
        onDone={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Set 1 load' }), { key: 'Delete' });
    expect(onRemove).not.toHaveBeenCalled();
    const row = screen.getByRole('row', { name: 'Set 1 actions' });
    fireEvent.focus(row);
    expect(screen.getByRole('button', { name: 'Delete set 1' })).toBeTruthy();
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Delete set 1' })).toBeNull();
    fireEvent.keyDown(row, { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledWith(exercise.actualSets[0].id);
  });

  it('keeps added-weight and assistance selection available directly in bodyweight rows', () => {
    const source = getExercise();
    const exercise = {
      ...source,
      loadMode: 'bodyweight' as const,
      actualSets: source.actualSets.map((set) => ({ ...set, loadMode: 'bodyweight' as const })),
    };
    const onEdit = vi.fn();
    render(<SetTable exercise={exercise} unit="lb" onEdit={onEdit} onDone={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Set 1 load mode' }), {
      target: { value: 'assistance' },
    });
    expect(onEdit).toHaveBeenCalledWith(exercise.actualSets[0], { loadMode: 'assistance' });
  });

  it('shows persisted Undo values after an edited load has been acknowledged', async () => {
    const exercise = getExercise();
    const onEdit = vi.fn(),
      onDone = vi.fn();
    const view = render(<SetTable exercise={exercise} unit="lb" onEdit={onEdit} onDone={onDone} />);
    const load = screen.getByRole('textbox', { name: 'Set 1 load' });
    fireEvent.change(load, { target: { value: '120' } });
    fireEvent.blur(load);
    const saved = {
      ...exercise,
      actualSets: exercise.actualSets.map((set, index) =>
        index === 0 ? { ...set, weight: 120 } : set,
      ),
    };
    view.rerender(<SetTable exercise={saved} unit="lb" onEdit={onEdit} onDone={onDone} />);
    await waitFor(() => expect(load).toHaveProperty('value', '120'));
    view.rerender(<SetTable exercise={exercise} unit="lb" onEdit={onEdit} onDone={onDone} />);
    await waitFor(() => expect(load).toHaveProperty('value', '100'));
  });

  it('does not interpret a pending pounds buffer as kilograms after a unit switch', () => {
    const exercise = getExercise();
    const onEdit = vi.fn(),
      onDone = vi.fn();
    const view = render(<SetTable exercise={exercise} unit="lb" onEdit={onEdit} onDone={onDone} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Set 1 load' }), {
      target: { value: '120' },
    });
    view.rerender(<SetTable exercise={exercise} unit="kg" onEdit={onEdit} onDone={onDone} />);
    expect(screen.getByRole('textbox', { name: 'Set 1 load' })).toHaveProperty('value', '45.4');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 1 done' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(exercise.actualSets[0].id, true);
  });

  it('preserves a focused partial decimal when another row changes', () => {
    const exercise = getExercise();
    const onEdit = vi.fn(),
      onDone = vi.fn();
    const view = render(<SetTable exercise={exercise} unit="lb" onEdit={onEdit} onDone={onDone} />);
    const load = screen.getByRole('textbox', { name: 'Set 1 load' });
    load.focus();
    fireEvent.change(load, { target: { value: '100.' } });
    const changed = {
      ...exercise,
      actualSets: exercise.actualSets.map((set, index) =>
        index === 1 ? { ...set, reps: 9 } : set,
      ),
    };
    view.rerender(<SetTable exercise={changed} unit="lb" onEdit={onEdit} onDone={onDone} />);
    expect(load).toHaveProperty('value', '100.');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('converts pristine load text when display units change', async () => {
    const exercise = getExercise();
    const onEdit = vi.fn();
    const onDone = vi.fn();
    const view = render(<SetTable exercise={exercise} unit="lb" onEdit={onEdit} onDone={onDone} />);
    expect(screen.getByRole('textbox', { name: 'Set 1 load' })).toHaveProperty('value', '100');
    view.rerender(<SetTable exercise={exercise} unit="kg" onEdit={onEdit} onDone={onDone} />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Set 1 load' })).toHaveProperty('value', '45.4'),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 1 done' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(exercise.actualSets[0].id, true);
  });

  it('keeps an invalid draft through row updates and blocks completion without throwing', () => {
    const exercise = getExercise();
    const onEdit = vi.fn();
    const onDone = vi.fn();
    const view = render(<SetTable exercise={exercise} unit="lb" onEdit={onEdit} onDone={onDone} />);
    const load = screen.getByRole('textbox', { name: 'Set 1 load' });
    fireEvent.change(load, { target: { value: '-1' } });
    fireEvent.blur(load);
    const changedExercise = {
      ...exercise,
      actualSets: exercise.actualSets.map((set, index) =>
        index === 1
          ? { ...set, status: 'completed' as const, completedAt: new Date().toISOString() }
          : set,
      ),
    };
    view.rerender(
      <SetTable exercise={changedExercise} unit="lb" onEdit={onEdit} onDone={onDone} />,
    );
    expect(screen.getByRole('textbox', { name: 'Set 1 load' })).toHaveProperty('value', '-1');
    expect(screen.getByRole('textbox', { name: 'Set 1 load' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'Set 1 done' })).toHaveProperty('disabled', true);
    expect(onDone).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });
});
