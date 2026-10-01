import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// pnpm may report the local importer named cli as the unrelated npm cli package.
// Suppress only the exact observed importer collision, never a registry node.
export function reviewAudit(raw, cliPackage, lock) {
  if (!raw || typeof raw.advisories !== 'object' || raw.advisories === null || Array.isArray(raw.advisories)) {
    throw new Error('Unsupported audit response');
  }
  const excluded = [];
  const remaining = [];
  for (const advisory of Object.values(raw.advisories)) {
    const findings = advisory.findings;
    const collision = advisory.github_advisory_id === 'GHSA-6cpc-mj5c-m9rq'
      && advisory.module_name === 'cli'
      && Array.isArray(findings) && findings.length === 1
      && findings[0].version === '0.2.2'
      && JSON.stringify(findings[0].paths) === JSON.stringify(['cli'])
      && cliPackage.name === '@sonicfield/masa-cli' && cliPackage.version === '0.2.2'
      && !/(?:^|[\s'"/])cli@/m.test(lock);
    if (collision) excluded.push(advisory.github_advisory_id);
    else remaining.push(advisory);
  }
  return { registry_advisories: remaining, local_importer_collisions: excluded };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const windows = process.platform === 'win32';
  const executable = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
  const arguments_ = windows ? ['/d', '/c', 'pnpm', 'audit', '--json'] : ['audit', '--json'];
  const result = spawnSync(executable, arguments_, { encoding: 'utf8', shell: false });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error('Dependency audit could not complete');
  }
  const review = reviewAudit(JSON.parse(result.stdout),
    JSON.parse(readFileSync(new URL('../cli/package.json', import.meta.url), 'utf8')),
    readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
  console.log(JSON.stringify(review, null, 2));
  process.exitCode = review.registry_advisories.length ? 1 : 0;
}
