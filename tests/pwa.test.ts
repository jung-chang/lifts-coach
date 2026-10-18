import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));

describe('PWA release assets', () => {
  const worker = (fetch = vi.fn(), caches = {}) => {
    const handlers: Record<string, (event: unknown) => void> = {};
    runInNewContext(read('public/sw.js').toString(), {
      self: {
        location: { origin: 'https://app.example' },
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          handlers[name] = handler;
        },
      },
      URL,
      Response,
      fetch,
      caches,
    });
    return handlers;
  };

  it('bypasses private endpoints, query strings, other origins and writes', () => {
    const fetch = vi.fn();
    const handlers = worker(fetch);
    for (const [url, method] of [
      ['/api/state', 'GET'],
      ['/api/export', 'GET'],
      ['/cdn-cgi/access/login', 'GET'],
      ['/account', 'GET'],
      ['/?token=synthetic', 'GET'],
      ['/icon-192.png', 'POST'],
      ['https://other.example/icon-192.png', 'GET'],
    ]) {
      const respondWith = vi.fn();
      handlers.fetch({
        request: { url: new URL(url, 'https://app.example').href, method, mode: 'cors' },
        respondWith,
      });
      expect(respondWith).not.toHaveBeenCalled();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [false, false, ''],
    [true, true, ''],
    [true, false, 'no-store'],
  ])(
    'never caches rejected, redirected or no-store runtime responses (%s, %s, %s)',
    async (ok, redirected, control) => {
      const open = vi.fn();
      const fetch = vi.fn().mockResolvedValue({
        ok,
        redirected,
        type: 'basic',
        headers: new Headers({ 'cache-control': control }),
      });
      const handlers = worker(fetch, { open });
      let response: Promise<unknown> | undefined;
      handlers.fetch({
        request: { url: 'https://app.example/icon-192.png', method: 'GET', mode: 'cors' },
        respondWith: (value: Promise<unknown>) => {
          response = value;
        },
      });
      await response;
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('reads offline assets only from its own current cache', async () => {
    const match = vi.fn().mockResolvedValue(new Response('synthetic icon'));
    const open = vi.fn().mockResolvedValue({ match });
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const handlers = worker(fetch, { open });
    const request = { url: 'https://app.example/icon-192.png', method: 'GET', mode: 'cors' };
    let response: Promise<Response> | undefined;
    handlers.fetch({
      request,
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });
    expect(await (await response)?.text()).toBe('synthetic icon');
    expect(open).toHaveBeenCalledWith('lifts-coach-v1');
    expect(match).toHaveBeenCalledWith(request);
  });

  it('ships valid raster sizes with a separate maskable icon and Apple touch icon', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest').toString());
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
    expect(
      manifest.icons.find((icon: { purpose: string }) => icon.purpose === 'maskable').src,
    ).toBe('/icon-maskable-512.png');
    for (const icon of [...manifest.icons, { src: '/apple-touch-icon.png', sizes: '180x180' }]) {
      const png = read(`public${icon.src}`);
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
    expect(read('public/favicon.ico').readUInt16LE(4)).toBe(3);
    const html = read('index.html').toString();
    expect(html).toContain('href="/apple-touch-icon.png"');
    expect(html).toContain('crossorigin="use-credentials"');
  });

  it('waits for existing app windows to close and deletes only its own old caches', async () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    const skipWaiting = vi.fn();
    const remove = vi.fn();
    runInNewContext(read('public/sw.js').toString(), {
      self: {
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          handlers[name] = handler;
        },
        skipWaiting,
        clients: { claim: vi.fn() },
      },
      caches: {
        keys: async () => ['other-app', 'lifts-coach-old', 'lifts-coach-v1'],
        delete: remove,
      },
    });
    await new Promise<void>((resolve, reject) => {
      handlers.activate({ waitUntil: (work: Promise<void>) => work.then(resolve, reject) });
    });
    expect(remove.mock.calls).toEqual([['lifts-coach-old']]);
    expect(skipWaiting).not.toHaveBeenCalled();
    expect(read('public/sw.js').toString()).not.toContain('self.skipWaiting()');
  });
});
