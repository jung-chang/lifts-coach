import { describe, expect, it } from 'vitest';
import { createDeploymentConfig, deploymentInputs } from '../scripts/configure-cloudflare.mjs';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Synthetic account metadata only. Never use a personal deployment fixture here.
const env = {
  D1_DATABASE_ID: '00000000-0000-4000-8000-000000000000',
  ACCESS_TEAM_DOMAIN: 'synthetic-test.cloudflareaccess.com',
  ACCESS_AUD: 'synthetic-audience',
  CLOUDFLARE_API_TOKEN: 'synthetic',
  OPENAI_API_KEY: 'synthetic',
};
const template = {
  name: 'lifts-coach',
  d1_databases: [{ binding: 'DB', database_id: 'REPLACE_WITH_D1_DATABASE_ID' }],
  vars: { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' },
};
describe('private deployment configuration', () => {
  it('keeps the repository template free of owner-specific deployment metadata', () => {
    const source = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    expect(source.d1_databases.find((binding) => binding.binding === 'DB').database_id).toBe(
      'REPLACE_WITH_D1_DATABASE_ID',
    );
    expect(source.vars.ACCESS_TEAM_DOMAIN).toBe('');
    expect(source.vars.ACCESS_AUD).toBe('');
    expect(source.assets.run_worker_first).toEqual(['/api/*']);
    expect(source.preview_urls).toBe(false);
  });
  it('creates the private metadata overlay without changing the public template or copying keys', () => {
    const before = structuredClone(template);
    const config = createDeploymentConfig(template, env);
    expect(template).toEqual(before);
    expect(config.d1_databases[0].database_id).toBe(env.D1_DATABASE_ID);
    expect(config.vars.ACCESS_TEAM_DOMAIN).toBe(env.ACCESS_TEAM_DOMAIN);
    expect(config.vars.ACCESS_AUD).toBe(env.ACCESS_AUD);
    expect(JSON.stringify(config)).not.toContain('OPENAI_API_KEY');
    expect(JSON.stringify(config)).not.toContain('CLOUDFLARE_API_TOKEN');
  });
  it('fails closed on absent or malformed deployment metadata', () => {
    for (const field of ['D1_DATABASE_ID', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD']) {
      expect(() => deploymentInputs({ ...env, [field]: '' })).toThrow(field);
    }
    expect(() =>
      deploymentInputs({ ...env, D1_DATABASE_ID: 'REPLACE_WITH_D1_DATABASE_ID' }),
    ).toThrow('D1_DATABASE_ID');
    expect(() =>
      deploymentInputs({ ...env, ACCESS_TEAM_DOMAIN: 'https://invalid.example' }),
    ).toThrow('ACCESS_TEAM_DOMAIN');
    expect(() => deploymentInputs({ ...env, ACCESS_AUD: 'invalid audience with spaces' })).toThrow(
      'ACCESS_AUD',
    );
  });
  it('allows database-only migration setup while strict deployment still requires Access', () => {
    const databaseEnv = { D1_DATABASE_ID: env.D1_DATABASE_ID };
    const config = createDeploymentConfig(template, databaseEnv, { databaseOnly: true });
    expect(config.d1_databases[0].database_id).toBe(env.D1_DATABASE_ID);
    expect(config.vars.ACCESS_TEAM_DOMAIN).toBe('');
    expect(config.vars.ACCESS_AUD).toBe('');
    expect(() => deploymentInputs(databaseEnv)).toThrow('ACCESS_TEAM_DOMAIN');
  });
  it('writes only a private overlay through the CLI and does not disclose metadata in output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lifts-config-fixture-'));
    try {
      const original = JSON.stringify(template);
      writeFileSync(join(directory, 'wrangler.jsonc'), original);
      const output = execFileSync(
        process.execPath,
        [fileURLToPath(new URL('../scripts/configure-cloudflare.mjs', import.meta.url))],
        { cwd: directory, env: { ...env }, encoding: 'utf8' },
      );
      const generated = JSON.parse(readFileSync(join(directory, 'wrangler.deploy.json'), 'utf8'));
      expect(generated).toEqual(createDeploymentConfig(template, env));
      expect(readFileSync(join(directory, 'wrangler.jsonc'), 'utf8')).toBe(original);
      for (const value of Object.values(env)) expect(output).not.toContain(value);
      if (process.platform !== 'win32')
        expect(statSync(join(directory, 'wrangler.deploy.json')).mode & 0o077).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
