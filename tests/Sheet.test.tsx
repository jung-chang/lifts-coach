// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sheet from '../src/components/ui/Sheet';

describe('Sheet', () => {
  afterEach(() => cleanup());

  it('labels the dialog, moves focus inside, and closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet
        open
        onOpenChange={onOpenChange}
        title="Routine options"
        description="Edit this routine"
      >
        <button type="button">Save</button>
      </Sheet>,
    );

    expect(
      screen.getByRole('dialog', { name: 'Routine options', description: 'Edit this routine' }),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
