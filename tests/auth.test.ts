import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authorize, verifiedIdentity } from '../worker/auth';

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

async function request(
  overrides: {
    issuer?: string;
    audience?: string;
    expiry?: string;
    sub?: string | null;
    email?: string | null;
  } = {},
) {
  const claims: Record<string, unknown> = {};
  if (overrides.email !== null) claims.email = overrides.email ?? 'owner@example.test';
  let jwt = new SignJWT(claims).setProtectedHeader({
    alg: 'RS256',
    kid: 'test-key',
  });
  if (overrides.sub !== null) jwt = jwt.setSubject(overrides.sub ?? 'owner-sub');
  const token = await jwt
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
    expect(await authorize(await request(), env)).toMatch(/^access:[a-f0-9]{64}$/);
    expect(await verifiedIdentity(await request(), env)).toEqual({
      issuer,
      subject: 'owner-sub',
      email: 'owner@example.test',
    });
  });
  it('derives stable, distinct account identities from verified subjects', async () => {
    const first = await authorize(await request(), env);
    expect(await authorize(await request(), env)).toBe(first);
    expect(await authorize(await request({ sub: 'other-sub' }), env)).not.toBe(first);
  });
  it('rejects a valid signature with the wrong audience', async () => {
    expect(await authorize(await request({ audience: 'different-app' }), env)).toBeNull();
  });
  it('rejects a valid signature from the wrong issuer', async () => {
    expect(
      await authorize(await request({ issuer: 'https://another.cloudflareaccess.com' }), env),
    ).toBeNull();
  });
  it('rejects expired credentials', async () => {
    expect(await authorize(await request({ expiry: '-1m' }), env)).toBeNull();
  });
  it('rejects a verified token without a subject claim', async () => {
    expect(await authorize(await request({ sub: null }), env)).toBeNull();
  });
  it('rejects a verified token without a valid authenticated email claim', async () => {
    expect(await verifiedIdentity(await request({ email: null }), env)).toBeNull();
    expect(await verifiedIdentity(await request({ email: 'not-an-email' }), env)).toBeNull();
  });
  it('rejects missing configuration, missing token, and malformed tokens', async () => {
    const plain = new Request('https://training-lab.example.workers.dev/api/state');
    expect(await authorize(plain, {})).toBeNull();
    expect(await authorize(plain, env)).toBeNull();
    expect(
      await authorize(
        new Request(plain, { headers: { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' } }),
        env,
      ),
    ).toBeNull();
  });
  it('does not fetch keys from an arbitrary configured hostname', async () => {
    expect(
      await authorize(await request(), { ...env, ACCESS_TEAM_DOMAIN: 'https://untrusted.example' }),
    ).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('limits the explicit development bypass to loopback', async () => {
    expect(
      await authorize(new Request('http://localhost:8787/api/state'), { LOCAL_DEV: 'true' }),
    ).toBe('local-dev');
    expect(
      await authorize(new Request('http://127.0.0.1:8787/api/state'), { LOCAL_DEV: 'true' }),
    ).toBe('local-dev');
    expect(await authorize(new Request('http://localhost:8787/api/state'), {})).toBeNull();
    expect(
      await authorize(new Request('https://training-lab.example.workers.dev/api/state'), {
        LOCAL_DEV: 'true',
      }),
    ).toBeNull();
  });
});
