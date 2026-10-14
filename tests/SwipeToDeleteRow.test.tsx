// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SwipeToDeleteRow from '../src/components/SwipeToDeleteRow';

const pointer = (
  type: string,
  target: Element,
  x: number,
  y: number,
  pointerId = 1,
  extra: Record<string, unknown> = {},
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId, isPrimary: true, button: 0, clientX: x, clientY: y, ...extra });
  fireEvent(target, event);
};

describe('SwipeToDeleteRow', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
  });
  afterEach(() => cleanup());

  const setup = () => {
    const onRequestDelete = vi.fn();
    const view = render(
      <SwipeToDeleteRow id="prescription-1" label="Front squat" onRequestDelete={onRequestDelete}>
        <div>Front squat details</div>
      </SwipeToDeleteRow>,
    );
    const row = view.container.querySelector('.swipe-delete-foreground')!;
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 320 });
    return { ...view, row, onRequestDelete };
  };

  it('keeps vertical movement native and exposes Remove after a right swipe', () => {
    const { row, onRequestDelete } = setup();
    pointer('pointerdown', row, 0, 0);
    pointer('pointermove', row, 12, 30);
    pointer('pointerup', row, 12, 30);
    expect(onRequestDelete).not.toHaveBeenCalled();
    pointer('pointerdown', row, 0, 0);
    pointer('pointermove', row, 80, 2);
    pointer('pointerup', row, 80, 2);
    expect(screen.getByRole('button', { name: 'Delete Front squat' })).toBeTruthy();
    expect(onRequestDelete).not.toHaveBeenCalled();
  });

  it('requests confirmation once on a full right swipe and through the explicit button', () => {
    const { row, onRequestDelete } = setup();
    pointer('pointerdown', row, 0, 0);
    pointer('pointermove', row, 190, 2);
    pointer('pointerup', row, 190, 2);
    expect(onRequestDelete).toHaveBeenCalledTimes(1);

    pointer('pointerdown', row, 0, 0);
    pointer('pointermove', row, 80, 2);
    pointer('pointerup', row, 80, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Front squat' }));
    expect(onRequestDelete).toHaveBeenCalledTimes(2);
  });

  it('resets canceled pointers and ignores gestures started on controls', () => {
    const { row, onRequestDelete } = renderRowWithControl();
    const nestedButton = screen.getByRole('button', { name: 'Nested action' });
    pointer('pointerdown', nestedButton, 0, 0);
    pointer('pointermove', nestedButton, 220, 1);
    pointer('pointerup', nestedButton, 220, 1);
    expect(onRequestDelete).not.toHaveBeenCalled();

    pointer('pointerdown', row, 0, 0);
    pointer('pointermove', row, 90, 1);
    pointer('pointercancel', row, 90, 1);
    expect(onRequestDelete).not.toHaveBeenCalled();
    pointer('pointerdown', row, 0, 0);
    pointer('pointermove', row, 90, 1);
    pointer('pointerup', row, 90, 1);
    expect(screen.getByRole('button', { name: 'Delete Front squat' })).toBeTruthy();
  });

  it('supports keyboard reveal, dismissal, and confirmation request', () => {
    const { row, onRequestDelete } = setup();
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Delete Front squat' })).toBeTruthy();
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Delete Front squat' })).toBeNull();
    fireEvent.keyDown(row, { key: 'Delete' });
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
  });

  it('does not treat Backspace or Delete in nested inputs as row commands', () => {
    const onRequestDelete = vi.fn();
    render(
      <SwipeToDeleteRow
        id="prescription-input"
        label="Front squat"
        onRequestDelete={onRequestDelete}
      >
        <input aria-label="Exercise name" defaultValue="Front squat" />
        <textarea aria-label="Notes" defaultValue="Keep the torso upright" />
      </SwipeToDeleteRow>,
    );
    const input = screen.getByRole('textbox', { name: 'Exercise name' }) as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.keyDown(input, { key: 'Delete' });
    fireEvent.change(input, { target: { value: 'Front squats' } });
    expect(onRequestDelete).not.toHaveBeenCalled();
    expect(input.value).toBe('Front squats');
  });

  it('cancels an active swipe when a second pointer begins', () => {
    const { row, onRequestDelete } = setup();
    pointer('pointerdown', row, 0, 0, 1);
    pointer('pointermove', row, 220, 1, 1);
    pointer('pointerdown', row, 220, 1, 2, { isPrimary: false });
    pointer('pointerup', row, 220, 1, 1);
    expect(onRequestDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Delete Front squat' })).toBeNull();
  });
});

function renderRowWithControl() {
  const onRequestDelete = vi.fn();
  const view = render(
    <SwipeToDeleteRow id="prescription-2" label="Front squat" onRequestDelete={onRequestDelete}>
      <button type="button">Nested action</button>
    </SwipeToDeleteRow>,
  );
  const row = view.container.querySelector('.swipe-delete-foreground')!;
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: 320 });
  return { row, onRequestDelete };
}
