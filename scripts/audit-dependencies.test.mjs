import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewAudit } from './audit-dependencies.mjs';

const owner = { name: '@sonicfield/masa-cli', version: '0.2.2' };
const advisory = { github_advisory_id: 'GHSA-6cpc-mj5c-m9rq', module_name: 'cli',
  findings: [{ version: '0.2.2', paths: ['cli'] }] };
const raw = (entry) => ({ advisories: { one: entry } });

test('excludes the exact local importer collision', () => {
  assert.equal(reviewAudit(raw(advisory), owner, 'importers:\n  cli:\n').registry_advisories.length, 0);
});

test('retains real registry packages and changed finding identities', () => {
  for (const [entry, pkg, lock] of [
    [advisory, owner, 'packages:\n  cli@0.2.2:\n'],
    [advisory, { ...owner, name: 'cli' }, ''],
    [{ ...advisory, findings: [{ version: '0.2.2', paths: ['cli', 'dependency>cli'] }] }, owner, ''],
    [{ ...advisory, findings: [{ version: '0.2.3', paths: ['cli'] }] }, owner, ''],
    [{ ...advisory, github_advisory_id: 'GHSA-example' }, owner, ''],
  ]) assert.equal(reviewAudit(raw(entry), pkg, lock).registry_advisories.length, 1);
});

test('refuses missing or malformed audit results', () => {
  for (const response of [{}, { advisories: null }, { advisories: [] }, { advisories: 'invalid' }]) {
    assert.throws(() => reviewAudit(response, owner, ''), /Unsupported/);
  }
});
