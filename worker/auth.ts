import { createRemoteJWKSet, jwtVerify } from 'jose';
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function authorize(
  request: Request,
  env: { LOCAL_DEV?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string },
): Promise<boolean> {
  const hostname = new URL(request.url).hostname;
  if (env.LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname))
    return true;
  const domain = env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !env.ACCESS_AUD)
    return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  try {
    const issuer = `https://${domain}`;
    let keys = keySets.get(domain);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      keySets.set(domain, keys);
    }
    await jwtVerify(token, keys, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'] });
    return true;
  } catch {
    return false;
  }
}
