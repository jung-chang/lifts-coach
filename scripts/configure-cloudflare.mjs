import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function deploymentInputs(env, { databaseOnly = false } = {}) {
  const databaseId = env.D1_DATABASE_ID?.trim();
  const accessDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const accessAudience = env.ACCESS_AUD?.trim();
  if (!databaseId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(databaseId)) {
    throw new Error('Set D1_DATABASE_ID to a valid D1 database identifier.');
  }
  if (databaseOnly) return { databaseId, accessDomain: '', accessAudience: '' };
  if (!accessDomain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(accessDomain)) {
    throw new Error('Set ACCESS_TEAM_DOMAIN to the bare Cloudflare Access team domain.');
  }
  if (
    !accessAudience ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(accessAudience) ||
    accessAudience.startsWith('REPLACE_')
  ) {
    throw new Error('Set ACCESS_AUD to the Access application audience.');
  }
  return { databaseId, accessDomain, accessAudience };
}

export function createDeploymentConfig(template, env, options = {}) {
  const { databaseId, accessDomain, accessAudience } = deploymentInputs(env, options);
  const config = structuredClone(template);
  const database = config.d1_databases?.find((binding) => binding.binding === 'DB');
  if (!database) throw new Error('The public Wrangler template must define the DB binding.');
  database.database_id = databaseId;
  config.vars = { ...config.vars, ACCESS_TEAM_DOMAIN: accessDomain, ACCESS_AUD: accessAudience };
  // Deployment credentials and provider keys are deliberately never copied.
  return config;
}

function main() {
  try {
    const options = { databaseOnly: process.argv.includes('--database-only') };
    deploymentInputs(process.env, options);
    if (process.argv.includes('--check')) {
      console.log('Cloudflare deployment metadata is configured.');
      return;
    }
    const template = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    const config = createDeploymentConfig(template, process.env, options);
    writeFileSync('wrangler.deploy.json', `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    console.log(
      options.databaseOnly
        ? 'Generated ignored database-only configuration for migrations. Deployment still requires Access configuration.'
        : 'Generated ignored wrangler.deploy.json; keep this account-specific file private.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
