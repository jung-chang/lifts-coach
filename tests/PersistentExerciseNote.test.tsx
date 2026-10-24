// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersistentExerciseNote } from '../src/components/PersistentExerciseNote';

afterEach(cleanup);

describe('persistent exercise instructions', () => {
  it('keeps workout instructions visible and edits the latest personal note explicitly', async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(
      <PersistentExerciseNote
        name="Synthetic RDL"
        snapshotNote="Captured instructions"
        personalNote="Latest personal instructions"
        onSave={save}
      />,
    );
    expect(screen.getByText('Captured instructions')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit exercise instructions' }));
    const input = screen.getByRole('textbox', { name: /Exercise instructions for/ });
    expect((input as HTMLTextAreaElement).value).toBe('Latest personal instructions');
    fireEvent.change(input, { target: { value: 'Pause 3 seconds.' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('Pause 3 seconds.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('retains the edited note after a failed durable save', async () => {
    render(
      <PersistentExerciseNote name="Synthetic press" onSave={vi.fn().mockResolvedValue(false)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit exercise instructions' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save instructions' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep this draft.');
  });
});
