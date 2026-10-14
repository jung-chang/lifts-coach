import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authorize } from '../worker/auth';

const issuer = 'https://prototype-test.cloudflareaccess.com';
const env = { ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'personal-app' };
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwks: { keys: object[] };

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  jwks = {
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }],
  };
});
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`);
      return Response.json(jwks);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function request(overrides: { issuer?: string; audience?: string; expiry?: string } = {}) {
  const token = await new SignJWT({ email: 'owner@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? env.ACCESS_AUD)
    .setIssuedAt()
    .setExpirationTime(overrides.expiry ?? '5m')
    .sign(signingKey);
  return new Request('https://training-lab.example.workers.dev/api/state', {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  });
}

describe('Cloudflare Access authorization', () => {
  it('accepts a signed token for the configured issuer and audience', async () => {
    expect(await authorize(await request(), env)).toBe(true);
  });
  it('rejects a valid signature with the wrong audience', async () => {
    expect(await authorize(await request({ audience: 'different-app' }), env)).toBe(false);
  });
  it('rejects a valid signature from the wrong issuer', async () => {
    expect(
      await authorize(await request({ issuer: 'https://another.cloudflareaccess.com' }), env),
    ).toBe(false);
  });
  it('rejects expired credentials', async () => {
    expect(await authorize(await request({ expiry: '-1m' }), env)).toBe(false);
  });
  it('rejects missing configuration, missing token, and malformed tokens', async () => {
    const plain = new Request('https://training-lab.example.workers.dev/api/state');
    expect(await authorize(plain, {})).toBe(false);
    expect(await authorize(plain, env)).toBe(false);
    expect(
      await authorize(
        new Request(plain, { headers: { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' } }),
        env,
      ),
    ).toBe(false);
  });
  it('does not fetch keys from an arbitrary configured hostname', async () => {
    expect(
      await authorize(await request(), { ...env, ACCESS_TEAM_DOMAIN: 'https://untrusted.example' }),
    ).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('limits the explicit development bypass to loopback', async () => {
    expect(
      await authorize(new Request('http://localhost:8787/api/state'), { LOCAL_DEV: 'true' }),
    ).toBe(true);
    expect(
      await authorize(new Request('http://127.0.0.1:8787/api/state'), { LOCAL_DEV: 'true' }),
    ).toBe(true);
    expect(await authorize(new Request('http://localhost:8787/api/state'), {})).toBe(false);
    expect(
      await authorize(new Request('https://training-lab.example.workers.dev/api/state'), {
        LOCAL_DEV: 'true',
      }),
    ).toBe(false);
  });
});
