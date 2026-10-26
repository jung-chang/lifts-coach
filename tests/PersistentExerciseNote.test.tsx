// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PersistentExerciseNote } from '../src/components/PersistentExerciseNote';

afterEach(cleanup);

describe('workout exercise instructions', () => {
  it('displays captured instructions without editing controls', () => {
    render(<PersistentExerciseNote snapshotNote="Captured instructions" />);
    expect(screen.getByText('Captured instructions')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders nothing when instructions are absent, empty or whitespace only', () => {
    const view = render(<PersistentExerciseNote />);
    expect(view.container.innerHTML).toBe('');
    for (const snapshotNote of ['', '  \n ']) {
      view.rerender(<PersistentExerciseNote snapshotNote={snapshotNote} />);
      expect(view.container.innerHTML).toBe('');
    }
  });
});
