import { createRemoteJWKSet, jwtVerify } from 'jose';
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function authorize(
  request: Request,
  env: { LOCAL_DEV?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string },
): Promise<string | null> {
  const identity = await verifiedIdentity(request, env);
  if (!identity) return null;
  if (identity.local) return 'local-dev';
  return legacySubjectKey(identity.subject);
}

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string;
  local?: boolean;
}

export async function verifiedIdentity(
  request: Request,
  env: { LOCAL_DEV?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string },
): Promise<VerifiedIdentity | null> {
  const hostname = new URL(request.url).hostname;
  if (env.LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname))
    return { issuer: 'local-dev', subject: 'local-dev', email: 'local@example.test', local: true };
  const domain = env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !env.ACCESS_AUD)
    return null;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  try {
    const issuer = `https://${domain}`;
    let keys = keySets.get(domain);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      keySets.set(domain, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256'],
    });
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub.trim() ||
      typeof payload.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())
    )
      return null;
    return { issuer, subject: payload.sub, email: payload.email.trim() };
  } catch {
    return null;
  }
}

export async function legacySubjectKey(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject));
  return `access:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
