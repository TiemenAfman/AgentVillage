// Where the island lives, and how it gets there (Plans/een-thuis-voor-het-eiland.md).
//
// HOME is decided while lib/paths.mjs is being imported, and deciding it can copy a whole
// island, so it cannot be tested by importing the module here: that would be the island of
// whoever ran the tests. Instead every case copies lib/paths.mjs into a checkout of its own
// in a scratch folder and imports it in a child process whose profile, AppData and Claude
// home are scratch folders too. paths.mjs imports nothing but node's own modules, which is
// what makes one file enough of a checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PATHS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'paths.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-home-'));
let n = 0;

function machine() {
  const m = path.join(scratch, `m${n++}`);
  const dirs = { user: path.join(m, 'user'), appdata: path.join(m, 'appdata'), claude: path.join(m, 'claude') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { ...dirs, dir: m, shared: path.join(dirs.user, '.promptholm') };
}

// A checkout with lib/paths.mjs in it - its .git a folder, or a file for a linked worktree.
function checkout(m, name, { worktree = false, release = false } = {}) {
  const root = path.join(m.dir, name);
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.copyFileSync(PATHS, path.join(root, 'lib', 'paths.mjs'));
  if (worktree) fs.writeFileSync(path.join(root, '.git'), 'gitdir: elsewhere\n');
  else if (!release) fs.mkdirSync(path.join(root, '.git'));
  if (release) fs.writeFileSync(path.join(root, 'release.json'), '{"name":"Promptholm"}\n');
  return root;
}

function island(home, name) {
  fs.mkdirSync(path.join(home, 'data', 'guests'), { recursive: true });
  fs.mkdirSync(path.join(home, 'data', 'print'), { recursive: true });
  fs.mkdirSync(path.join(home, 'data', 'codex'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ islandName: name }));
  fs.writeFileSync(path.join(home, '.env'), 'JIRA_BASE_URL=x\n');
  fs.writeFileSync(path.join(home, 'data', 'layout.json'), JSON.stringify({ island: name }));
  fs.writeFileSync(path.join(home, 'data', 'codex', 'layout.json'), '{}');
  for (const f of ['server.log', 'server.log.1', 'hook.log', 'scan.lock', 'layout.json.123.tmp', '.gitkeep']) {
    fs.writeFileSync(path.join(home, 'data', f), 'left behind');
  }
  fs.writeFileSync(path.join(home, 'data', 'guests', 'a.json'), '{}');
  fs.writeFileSync(path.join(home, 'data', 'print', 'props.stl'), 'solid');
}

function hookTo(m, root) {
  const command = `node "${path.join(root, 'hooks', 'on-session.mjs').replace(/\\/g, '/')}"`;
  fs.writeFileSync(path.join(m.claude, 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] },
  }));
}

function envFor(m, extra = {}) {
  const env = { ...process.env, USERPROFILE: m.user, HOME: m.user, LOCALAPPDATA: m.appdata, PROMPTHOLM_CLAUDE_HOME: m.claude, ...extra };
  if (!('PROMPTHOLM_HOME' in extra)) delete env.PROMPTHOLM_HOME;
  return env;
}

const probe = (root) => [
  '--input-type=module', '-e',
  `const m = await import(${JSON.stringify(pathToFileURL(path.join(root, 'lib', 'paths.mjs')).href)});`
  + 'process.stdout.write(JSON.stringify({ HOME: m.HOME, WORKTREE: m.WORKTREE }));',
];

function homeOf(m, root, extra) {
  const r = spawnSync(process.execPath, probe(root), { env: envFor(m, extra), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).HOME;
}

const read = (f) => fs.readFileSync(f, 'utf8');

test('a checkout moves the island the session hook points at into ~/.promptholm', () => {
  const m = machine();
  const real = checkout(m, 'real');
  island(real, 'Hoogezand');
  hookTo(m, real);
  const other = checkout(m, 'other');
  island(other, 'Somewhere else');

  assert.equal(homeOf(m, other), m.shared);
  assert.deepEqual(JSON.parse(read(path.join(m.shared, 'config.json'))), { islandName: 'Hoogezand' });
  assert.equal(read(path.join(m.shared, '.env')), 'JIRA_BASE_URL=x\n');
  assert.deepEqual(JSON.parse(read(path.join(m.shared, 'data', 'layout.json'))), { island: 'Hoogezand' });
  assert.ok(fs.existsSync(path.join(m.shared, 'data', 'codex', 'layout.json')));
  for (const f of ['server.log', 'server.log.1', 'hook.log', 'scan.lock', 'layout.json.123.tmp', '.gitkeep', 'guests', 'print']) {
    assert.ok(!fs.existsSync(path.join(m.shared, 'data', f)), `${f} should have stayed behind`);
  }
  assert.ok(!fs.existsSync(path.join(m.shared, 'moving.lock')));
  // Copied, not moved: the old island is the backup, and says where it went.
  assert.deepEqual(JSON.parse(read(path.join(real, 'data', 'layout.json'))), { island: 'Hoogezand' });
  assert.match(read(path.join(real, 'data', 'MOVED.txt')), /moved to/);
});

test('once the island lives there it is never copied over again', () => {
  const m = machine();
  const real = checkout(m, 'real');
  island(real, 'Hoogezand');
  hookTo(m, real);
  homeOf(m, real);
  fs.writeFileSync(path.join(m.shared, 'data', 'layout.json'), '{"island":"grown since"}');
  fs.writeFileSync(path.join(real, 'data', 'layout.json'), '{"island":"stale"}');
  assert.equal(homeOf(m, real), m.shared);
  assert.equal(read(path.join(m.shared, 'data', 'layout.json')), '{"island":"grown since"}');
});

test('without a hook a checkout brings its own island, and a release the one in AppData', () => {
  const a = machine();
  const own = checkout(a, 'own');
  island(own, 'Mine');
  assert.equal(homeOf(a, own), a.shared);
  assert.deepEqual(JSON.parse(read(path.join(a.shared, 'config.json'))), { islandName: 'Mine' });

  const b = machine();
  const release = checkout(b, 'release', { release: true });
  island(path.join(b.appdata, 'Promptholm'), 'From a release');
  assert.equal(homeOf(b, release), b.shared);
  assert.deepEqual(JSON.parse(read(path.join(b.shared, 'config.json'))), { islandName: 'From a release' });
});

test('with no island anywhere nothing is moved and the new one is founded in ~/.promptholm', () => {
  const m = machine();
  const root = checkout(m, 'fresh');
  assert.equal(homeOf(m, root), m.shared);
  assert.ok(!fs.existsSync(path.join(m.shared, 'config.json')));
});

test('a linked worktree keeps its island in itself, and PROMPTHOLM_HOME wins over everything', () => {
  const m = machine();
  const real = checkout(m, 'real');
  island(real, 'Hoogezand');
  hookTo(m, real);
  const tree = checkout(m, 'tree', { worktree: true });
  assert.equal(homeOf(m, tree), tree);
  assert.ok(!fs.existsSync(m.shared), 'a worktree must not move anybody in');

  const elsewhere = path.join(m.dir, 'elsewhere');
  assert.equal(homeOf(m, real, { PROMPTHOLM_HOME: elsewhere }), elsewhere);
  assert.ok(!fs.existsSync(m.shared));
});

test('a dozen processes starting at once move the island in once and agree where it is', async () => {
  const m = machine();
  const real = checkout(m, 'real');
  island(real, 'Hoogezand');
  hookTo(m, real);
  const runs = await Promise.all(Array.from({ length: 12 }, () => new Promise((resolve) => {
    const c = spawn(process.execPath, probe(real), { env: envFor(m) });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, out, err }));
  })));
  for (const r of runs) {
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).HOME, m.shared);
  }
  assert.equal(runs.filter((r) => /the island moved/.test(r.err)).length, 1);
  assert.deepEqual(JSON.parse(read(path.join(m.shared, 'data', 'layout.json'))), { island: 'Hoogezand' });
  assert.ok(!fs.existsSync(path.join(m.shared, 'moving.lock')));
});
