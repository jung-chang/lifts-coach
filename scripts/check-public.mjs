import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Print only locations and rule names, never a matched credential value.
const files = [
  ...new Set(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean),
  ),
];
const rules = [
  ['provider credential', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/g],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['private key', /-{5}BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-{5}/g],
  ['embedded JWT', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
  [
    'literal secret assignment',
    /(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)\s*[:=]\s*['"][A-Za-z0-9_+/=-]{24,}['"]/gi,
  ],
];
const privateValues = [
  'D1_DATABASE_ID',
  'CLOUDFLARE_ACCOUNT_ID',
  'ACCESS_TEAM_DOMAIN',
  'ACCESS_AUD',
  'CLOUDFLARE_API_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
]
  .map((name) => process.env[name])
  .filter((value) => value && value.length >= 12 && !value.startsWith('REPLACE_'));
let failures = 0;
for (const file of files) {
  const isExample = /(?:\.dev\.vars|\.env)\.example$/.test(file);
  if (
    !isExample &&
    /(?:^|\/)(?:\.dev\.vars(?:\.|$)|\.env(?:\.|$)|wrangler\.deploy\.json$|private\/|backups\/|exports\/|\.ssh\/|\.aws\/)|\.(?:db|sqlite3?|pem|key|p12|pfx|har|log)$|backup[^/]*\.json$/i.test(
      file,
    )
  ) {
    console.error(`${file}: private file type must not be published`);
    failures++;
    continue;
  }
  if (/\.(?:png|jpg|jpeg|webp|ico)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (privateValues.some((value) => text.includes(value))) {
    console.error(`${file}: private deployment value found in public source`);
    failures++;
  }
  for (const [name, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      console.error(`${file}:${line}: possible ${name}`);
      failures++;
    }
  }
}
if (failures) {
  console.error(
    'Public-source check failed. Review the indicated locations locally before publishing.',
  );
  process.exitCode = 1;
} else {
  console.log(
    `Public-source pattern check passed for ${files.length} candidate files. Manual disclosure review is still required.`,
  );
}
