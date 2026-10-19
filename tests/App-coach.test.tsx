// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyData } from '../shared/domain';
import App from '../src/App';

const fixture = vi.hoisted(() => ({ data: null as any, update: vi.fn() }));
vi.mock('../src/lib/store', () => ({
  useAppStore: () => ({
    data: fixture.data,
    session: {
      accountId: 'synthetic-coach',
      email: 'coach@example.test',
      coachEnabled: true,
      profile: {
        publicId: 'synthetic-profile',
        displayName: 'Coach member',
        trainingTimezone: 'UTC',
      },
      sharing: {
        summaryEnabled: false,
        autoPublishWorkouts: false,
        policyRevision: 1,
        audienceAcknowledgedAt: null,
        enabledAt: null,
      },
    },
    update: fixture.update,
    syncStatus: 'synced',
    conflict: null,
  }),
}));
beforeEach(() => {
  fixture.data = emptyData();
  fixture.update.mockImplementation(async (update) => {
    fixture.data = update(fixture.data);
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('chats across turns with a provisioned default when the saved model is blank', async () => {
  const requests: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (url === '/api/providers')
        return Response.json([{ id: 'openai', models: ['gpt-5-mini'] }]);
      requests.push(JSON.parse(init.body));
      return Response.json({
        text: `Synthetic reply ${requests.length}`,
        proposals: [],
        evidence: [],
      });
    }),
  );
  render(<App />);
  fireEvent.click(screen.getAllByRole('button', { name: /^Ask Coach$/ })[0]);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Coach' }), {
    target: { value: 'I train twice a week' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Synthetic reply 1');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Coach' }), {
    target: { value: 'Help me build a routine' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Synthetic reply 2');
  expect(requests.map((request) => request.model)).toEqual(['gpt-5-mini', 'gpt-5-mini']);
  expect(fixture.data.messages.map((message: any) => message.role)).toEqual([
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
});

it('shows the server provider error instead of claiming no provider is configured', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) =>
      url === '/api/providers'
        ? Response.json([{ id: 'openai', models: ['gpt-5-mini'] }])
        : Response.json({ error: 'The Coach provider rejected its credentials.' }, { status: 503 }),
    ),
  );
  render(<App />);
  fireEvent.click(screen.getAllByRole('button', { name: /^Ask Coach$/ })[0]);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Coach' }), {
    target: { value: 'Hello' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('The Coach provider rejected its credentials.');
});
