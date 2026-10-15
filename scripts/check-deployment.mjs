import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { deploymentInputs } from './configure-cloudflare.mjs';

const SECRET_FIELDS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
const VARIABLE_FIELDS = ['D1_DATABASE_ID', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'];
const VALID_BASELINE = {
  D1_DATABASE_ID: '12345678-1234-1234-1234-123456789abc',
  ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
  ACCESS_AUD: 'synthetic-audience',
};

function safeSingleLine(value) {
  return typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value);
}

export function diagnoseDeployment(env) {
  const issues = [];
  for (const name of SECRET_FIELDS) {
    const value = env[name];
    if (!safeSingleLine(value)) {
      issues.push({
        name,
        kind: value == null || (typeof value === 'string' && !value.trim()) ? 'missing' : 'invalid',
        location: 'Secrets',
      });
    }
  }
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (safeSingleLine(accountId) && !/^[0-9a-f]{32}$/i.test(accountId.trim())) {
    issues.push({ name: 'CLOUDFLARE_ACCOUNT_ID', kind: 'invalid', location: 'Secrets' });
  }

  for (const name of VARIABLE_FIELDS) {
    const value = env[name];
    const missing = value == null || (typeof value === 'string' && !value.trim());
    const candidate = { ...VALID_BASELINE, [name]: value };
    let valid = false;
    try {
      deploymentInputs(candidate);
      valid = true;
    } catch {
      // The validator's errors may include untrusted input; diagnostics use only fixed names.
    }
    if (missing || !valid)
      issues.push({
        name,
        kind: missing ? 'missing' : 'invalid',
        location: 'Secrets or Variables',
      });
  }

  return { ready: issues.length === 0, issues };
}

export function formatDeploymentDiagnostics(report) {
  if (report.ready) return '::notice::Cloudflare deployment configuration is ready.';
  const warnings = report.issues.map(({ name, kind, location }) => {
    const placement = location === 'Secrets' ? 'Secrets' : 'Secrets (preferred) or Variables';
    return `::warning title=Deployment configuration::${name} is ${kind}. Add it under Settings > Secrets and variables > Actions > ${placement}, or the production environment.`;
  });
  return [
    ...warnings,
    '::notice::Deployment skipped. Correct the listed settings and rerun the workflow.',
  ].join('\n');
}

function main() {
  const report = diagnoseDeployment(process.env);
  const output = formatDeploymentDiagnostics(report);
  (report.ready ? console.log : console.warn)(output);
  if (process.env.GITHUB_OUTPUT) {
    try {
      appendFileSync(process.env.GITHUB_OUTPUT, `ready=${report.ready}\n`, { encoding: 'utf8' });
    } catch {
      console.error('Unable to write deployment diagnostic output.');
      process.exitCode = 1;
      return;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
