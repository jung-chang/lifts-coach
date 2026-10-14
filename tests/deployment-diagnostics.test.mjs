import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diagnoseDeployment, formatDeploymentDiagnostics } from '../scripts/check-deployment.mjs';

const script = fileURLToPath(new URL('../scripts/check-deployment.mjs', import.meta.url));
const valid = {
  CLOUDFLARE_API_TOKEN: 'synthetic-token',
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  D1_DATABASE_ID: '12345678-1234-1234-1234-123456789abc',
  ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
  ACCESS_AUD: 'synthetic-audience',
};

describe('deployment diagnostics', () => {
  it('accepts complete synthetic configuration', () => {
    const report = diagnoseDeployment(valid);
    expect(report).toEqual({ ready: true, issues: [] });
    expect(formatDeploymentDiagnostics(report)).toContain('ready');
  });

  it('reports missing secrets and malformed account ID with correct placement', () => {
    const report = diagnoseDeployment({ ...valid, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: 'wrong' });
    expect(report.ready).toBe(false);
    expect(report.issues).toContainEqual({ name: 'CLOUDFLARE_API_TOKEN', kind: 'missing', location: 'Secrets' });
    expect(report.issues).toContainEqual({ name: 'CLOUDFLARE_ACCOUNT_ID', kind: 'invalid', location: 'Secrets' });
  });

  it('reports each malformed variable independently', () => {
    const report = diagnoseDeployment({ ...valid, D1_DATABASE_ID: 'bad', ACCESS_TEAM_DOMAIN: 'not-a-domain', ACCESS_AUD: 'REPLACE_ME' });
    expect(report.issues).toEqual([
      { name: 'D1_DATABASE_ID', kind: 'invalid', location: 'Secrets or Variables' },
      { name: 'ACCESS_TEAM_DOMAIN', kind: 'invalid', location: 'Secrets or Variables' },
      { name: 'ACCESS_AUD', kind: 'invalid', location: 'Secrets or Variables' },
    ]);
  });

  it('does not leak malicious values or permit annotation injection', () => {
    const attack = 'sensitive-value\n::error::injected';
    const output = formatDeploymentDiagnostics(diagnoseDeployment({ ...valid, D1_DATABASE_ID: attack, CLOUDFLARE_API_TOKEN: attack }));
    expect(output).not.toContain('sensitive-value');
    expect(output).not.toContain('injected');
    expect(output.match(/::warning/g)).toHaveLength(2);
  });

  it('appends ready=true and exits successfully for ready configuration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'deployment-diagnostics-'));
    try {
      const outputPath = join(directory, 'github-output');
      const result = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: outputPath, ...valid },
      });
      expect(result.status).toBe(0);
      expect(readFileSync(outputPath, 'utf8')).toBe('ready=true\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes ready=false and exits successfully when configuration is intentionally skipped', () => {
    const directory = mkdtempSync(join(tmpdir(), 'deployment-diagnostics-'));
    try {
      const outputPath = join(directory, 'github-output');
      const result = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputPath },
      });
      expect(result.status).toBe(0);
      expect(readFileSync(outputPath, 'utf8')).toBe('ready=false\n');
      expect(result.stdout + result.stderr).not.toContain('undefined');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
