// Moving the island to a folder of the keeper's choosing (lib/home-move.mjs,
// Plans/eiland-op-eigen-schijf.md), on scratch folders: the module takes every folder as an
// argument and imports nothing of ours, so nothing here can touch the island of whoever runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkTarget, copyHome, verifyCopy, moveHome } from '../lib/home-move.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-move-'));
let n = 0;

function world() {
  const w = path.join(scratch, `w${n++}`);
  const shared = path.join(w, 'user', '.promptholm');
  const from = path.join(w, 'island');
  const appdata = path.join(w, 'appdata');
  for (const d of [shared, from, appdata, path.join(from, 'data'), path.join(from, 'hd'), path.join(from, 'models')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path.join(from, 'config.json'), '{"islandName":"Hoogezand"}');
  fs.writeFileSync(path.join(from, 'data', 'layout.json'), '{"plots":[1,2,3]}');
  fs.writeFileSync(path.join(from, 'data', 'animal-events.jsonl'), '{"n":1}\n');
  fs.writeFileSync(path.join(from, 'hd', 'chest.glb'), Buffer.alloc(4096, 7));
  fs.writeFileSync(path.join(from, 'models', 'local-models.json'), '[]');
  for (const f of ['server.log', 'hook.log.1', 'animal-store.lock', 'layout.json.12.tmp']) {
    fs.writeFileSync(path.join(from, 'data', f), 'left behind');
  }
  fs.writeFileSync(path.join(from, 'checkout.txt'), 'D:\\git\\Martijn\\AgentVillage\n');
  return { w, shared, from, appdata, to: path.join(w, 'elsewhere', 'Promptholm') };
}

test('a move copies the whole island, checks it, and only then points home.txt at it', () => {
  const { shared, from, appdata, to } = world();
  const moved = moveHome({ from, to, shared, appdata: [appdata] });
  assert.equal(moved.to, path.resolve(to));
  for (const f of ['config.json', 'data/layout.json', 'data/animal-events.jsonl', 'hd/chest.glb', 'models/local-models.json']) {
    assert.deepEqual(fs.readFileSync(path.join(to, f)), fs.readFileSync(path.join(from, f)), f);
  }
  // A log being written to, a lock naming this process, a half-written file and the stub's own
  // checkout.txt stay where they were.
  for (const f of ['data/server.log', 'data/hook.log.1', 'data/animal-store.lock', 'data/layout.json.12.tmp', 'checkout.txt']) {
    assert.equal(fs.existsSync(path.join(to, f)), false, f);
  }
  assert.equal(fs.readFileSync(path.join(shared, 'home.txt'), 'utf8').trim(), path.resolve(to));
  assert.match(fs.readFileSync(path.join(from, 'MOVED.txt'), 'utf8'), /moved to/);
  assert.ok(fs.existsSync(path.join(from, 'config.json')), 'the old folder is left as it was');
});

test('the target has to be empty, outside the island, the stub, AppData and any repository', () => {
  const { w, shared, from, appdata } = world();
  const opts = { from, shared, appdata: [appdata] };
  assert.throws(() => checkTarget('relative\\path', opts), /whole path/);
  assert.throws(() => checkTarget(path.join(from, 'sub'), opts), /inside the island/);
  assert.throws(() => checkTarget(path.join(shared, 'island'), opts), /pointer to the island/);
  assert.throws(() => checkTarget(path.join(appdata, 'Promptholm'), opts), /AppData/);
  const repo = path.join(w, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  assert.throws(() => checkTarget(path.join(repo, 'island'), opts), /git checkout/);
  const full = path.join(w, 'full');
  fs.mkdirSync(full);
  fs.writeFileSync(path.join(full, 'x.txt'), 'x');
  assert.throws(() => checkTarget(full, opts), /not empty/);
  const empty = path.join(w, 'empty');
  fs.mkdirSync(empty);
  assert.equal(checkTarget(empty, opts), path.resolve(empty));
});

test('a copy that differs from the island calls the move off, and nothing is pointed anywhere', () => {
  const { shared, from, appdata, to } = world();
  const { copied } = copyHome(from, to);
  assert.deepEqual(verifyCopy(from, to, copied), []);
  // A scan that wrote while the copy was being made.
  fs.writeFileSync(path.join(from, 'data', 'layout.json'), '{"plots":[1,2,3,4]}');
  assert.deepEqual(verifyCopy(from, to, copied), [path.join('data', 'layout.json')]);
  // And the whole move refuses a target that already holds that copy, rather than mixing.
  assert.throws(() => moveHome({ from, to, shared, appdata: [appdata] }), /not empty/);
  assert.equal(fs.existsSync(path.join(shared, 'home.txt')), false);
});

test('a junction in the island is made again as a junction, not copied through', () => {
  const { w, shared, from, appdata, to } = world();
  const pack = path.join(w, 'pack');
  fs.mkdirSync(pack);
  fs.writeFileSync(path.join(pack, 'hd-manifest.json'), '{"v":1,"pieces":[]}');
  fs.rmSync(path.join(from, 'hd'), { recursive: true });
  fs.symlinkSync(pack, path.join(from, 'hd'), 'junction');
  moveHome({ from, to, shared, appdata: [appdata] });
  assert.ok(fs.lstatSync(path.join(to, 'hd')).isSymbolicLink(), 'still a link');
  assert.equal(fs.realpathSync(path.join(to, 'hd')), fs.realpathSync(pack));
  assert.ok(fs.existsSync(path.join(pack, 'hd-manifest.json')), 'and what it points at is untouched');
});

test('there is nothing to move from a folder with no island in it', () => {
  const { w, shared, appdata } = world();
  const nothing = path.join(w, 'nothing');
  fs.mkdirSync(nothing);
  assert.throws(() => moveHome({ from: nothing, to: path.join(w, 'to'), shared, appdata: [appdata] }), /no island/);
});
