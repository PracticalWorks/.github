// Pins the workflow and action inputs callers depend on (FACT-1910). The files
// are YAML read as text: this repository has no dependencies to parse them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const deploy = read('.github/workflows/coolify-deploy.yml');
const guard = read('.github/workflows/pr-guard.yml');
const setup = read('.github/actions/setup/action.yml');
const readme = read('README.md');

/** The block of `key:` under an inputs map, up to the next key at the same indent. */
function input(text, key, indent) {
  const pad = ' '.repeat(indent);
  const start = text.indexOf(`\n${pad}${key}:\n`);
  assert.ok(start >= 0, `input ${key} is declared`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(new RegExp(`\\n${pad}[A-Za-z]`));
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test('coolify-deploy takes an optional environment and runs the deploy job in it', () => {
  const block = input(deploy, 'environment', 6);
  assert.match(block, /required: false/);
  assert.match(block, /default: ""/);
  const job = deploy.slice(deploy.indexOf('\n  deploy:\n'));
  assert.match(job, /\n {4}environment:\n {6}name: \$\{\{ inputs\.environment \}\}\n {6}deployment: \$\{\{ inputs\.deployment \}\}\n/);
  const deployment = input(deploy, 'deployment', 6);
  assert.match(deployment, /type: boolean/);
  assert.match(deployment, /default: true/);
});

test('coolify-deploy pins the Infisical action by commit', () => {
  assert.match(deploy, /uses: Infisical\/secrets-action@[0-9a-f]{40}\n/);
});

test('the setup action caches the pnpm store unless cache is false', () => {
  assert.match(input(setup, 'cache', 2), /default: "true"/);
  assert.match(setup, /cache: \$\{\{ inputs\.cache == 'true' && 'pnpm' \|\| '' \}\}/);
});

test('each script fallback ref is the newest release in the README', () => {
  const tags = [...readme.matchAll(/^\| `(v[\d.]+)` \|/gm)].map((m) => m[1]);
  const newest = tags.at(-1);
  for (const [name, text] of [['coolify-deploy.yml', deploy], ['pr-guard.yml', guard]]) {
    const refs = [...text.matchAll(/job\.workflow_sha \|\| '([^']+)'/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, `${name} has a fallback ref`);
    for (const ref of refs) assert.equal(ref, newest, `${name} falls back to ${newest}`);
  }
});

test('coolify-deploy can skip the wait and run a pre-deploy step in the caller checkout (FACT-2001)', () => {
  const wait = input(deploy, 'wait', 6);
  assert.match(wait, /type: boolean/);
  assert.match(wait, /default: true/);
  assert.match(input(deploy, 'pre-deploy-run', 6), /default: ""/);
  assert.match(deploy, /WAIT: \$\{\{ inputs\.wait \}\}/);
  // The caller checkout comes before the shared one, which it would otherwise clean away.
  const caller = deploy.indexOf("- if: inputs.pre-deploy-run != ''\n        uses: actions/checkout@v4");
  const shared = deploy.indexOf('path: .pw-shared');
  assert.ok(caller >= 0 && caller < shared, 'caller checkout precedes the shared checkout');
  // The pre-deploy step runs after the secrets and node, before the webhook.
  const pre = deploy.indexOf('name: Pre-deploy');
  assert.ok(pre > deploy.indexOf('Infisical/secrets-action') && pre > deploy.indexOf('actions/setup-node') && pre < deploy.indexOf('id: webhook'));
});
