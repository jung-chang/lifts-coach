/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { listenForRoutineEditorBack, pushRoutineEditorHistory } from '../src/lib/editorNavigation';

afterEach(() => {
  window.onpopstate = null;
  window.history.replaceState(null, '', '/');
});

describe('routine editor browser navigation', () => {
  it('keeps a dirty editor open when discard is rejected, then closes cleanly when confirmed', async () => {
    window.history.replaceState({ page: 'train' }, '', '/');
    let dirty = true;
    let editorOpen = true;
    let prompts = 0;
    let unlisten = () => {};
    const cleanBack = new Promise<void>((resolve) => {
      unlisten = listenForRoutineEditorBack({
        isDirty: () => dirty,
        onDiscardRequest: () => {
          prompts += 1;
        },
        onCleanBack: () => {
          editorOpen = false;
          unlisten();
          resolve();
        },
      });
    });
    pushRoutineEditorHistory();
    // A browser Back first returns to Train, then the editor listener restores
    // its guard entry while the discard sheet is open.
    window.history.replaceState({ page: 'train' }, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(prompts).toBe(1);
    expect(editorOpen).toBe(true);
    expect(window.history.state?.routineEditor).toBe(true);

    // Keeping the draft means the app leaves its editor state and history entry intact.
    expect(editorOpen).toBe(true);
    dirty = false;
    window.history.replaceState({ page: 'train' }, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await cleanBack;
    expect(editorOpen).toBe(false);
    expect(window.history.state?.page).toBe('train');
  });
});
