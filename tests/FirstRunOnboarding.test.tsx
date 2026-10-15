// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstRunOnboarding } from '../src/components/FirstRunOnboarding';

afterEach(cleanup);

describe('FirstRunOnboarding', () => {
  it('offers the three starting actions and install guidance', () => {
    const actions = {
      onCreateRoutine: vi.fn(),
      onImportBackup: vi.fn(),
      onTrySampleRoutine: vi.fn(),
    };
    render(<FirstRunOnboarding {...actions} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try sample routine' }));

    expect(actions.onCreateRoutine).toHaveBeenCalledOnce();
    expect(actions.onImportBackup).toHaveBeenCalledOnce();
    expect(actions.onTrySampleRoutine).toHaveBeenCalledOnce();
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    expect(screen.getByText(/Install app/)).toBeTruthy();
  });
});
