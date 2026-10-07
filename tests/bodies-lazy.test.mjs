// The Wanderer's bodies are loaded only when somebody wears one (player-bodies.js loadWanderers):
// bodies-mesh.js is 19.5 MB of object literal that every page - the phone's and the web's included -
// parsed at boot whether or not a Wanderer was anywhere near. Held here: that nothing the boot
// imports reaches it (the same goes for the Salty Kraken's room sets, models.js LAZY), that the
// small half the boot does import (bodies-meta.js) is the same bake, that a Wanderer is drawn as the
// Adventurer until its body is in and swapped onto it after, that nothing is fetched before the boot
// allows it, and that the worker hands the arrays back as typed arrays the avatar builds from.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web', 'js');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Every module a page reaches through static imports (`import ... from`, `export ... from`, a bare
// `import '...'`), from the given entry; a dynamic import() is not followed - that is the point.
function staticGraph(entry) {
  const seen = new Set();
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const specs = [...src.matchAll(/^\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/gm), ...src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const s of specs) {
      if (s.startsWith('.')) todo.push(path.resolve(path.dirname(file), s));
      else if (s.startsWith('shared/')) todo.push(path.join(ROOT, s));
    }
  }
  return new Set([...seen].map((f) => path.relative(ROOT, f).split(path.sep).join('/')));
}

test('the boot never imports the Wanderer\'s bodies, nor the rooms\' sets', async () => {
  for (const entry of ['main.js', 'studio.js', 'peers.js', 'walk.js', 'demo.js']) {
    const graph = staticGraph(path.join(WEB, entry));
    assert.ok(graph.has('web/js/player-bodies.js'), `${entry} reaches the bodies at all`);
    assert.ok(graph.has('web/js/bodies-meta.js'), `${entry} has what the inventory reads of a Wanderer`);
    for (const lazy of ['web/js/bodies-mesh.js', 'web/js/krakenkit-mesh.js', 'web/js/piratetavern_room-mesh.js']) {
      assert.ok(!graph.has(lazy), `${entry} imports ${lazy} statically: it is parsed by every page at boot`);
    }
  }
  // Loaded through the worker, by URL, as the rooms are.
  assert.match(read('web/js/player-bodies.js'), /offThread\(new URL\('\.\/bodies-mesh\.js', import\.meta\.url\)\.href, 'BODIES'/);
  // The phone and the web carry it, lazily: a player there may choose a Wanderer.
  const { ROOM_ONLY } = await import('../scripts/pack-page.mjs');
  assert.ok(!ROOM_ONLY.has('bodies-mesh.js'));
});

test('bodies-meta.js is bodies-mesh.js without its triangles, part for part', async () => {
  const { BODIES } = await import('../web/js/bodies-mesh.js');
  const { BODIES_META } = await import('../web/js/bodies-meta.js');
  const HEAVY = new Set(['positions', 'normals', 'colors', 'skin', 'skinIndices', 'skinWeights']);
  assert.deepEqual(Object.keys(BODIES_META), Object.keys(BODIES));
  for (const sex of Object.keys(BODIES)) {
    const { parts, ...rest } = BODIES[sex];
    const { parts: meta, ...metaRest } = BODIES_META[sex];
    assert.deepEqual(metaRest, rest, `${sex}: the rig, joints and hair are one bake`);
    assert.equal(meta.length, parts.length);
    parts.forEach((p, i) => {
      assert.deepEqual(meta[i], Object.fromEntries(Object.entries(p).filter(([k]) => !HEAVY.has(k))), p.name);
      for (const k of Object.keys(meta[i])) assert.ok(!HEAVY.has(k));
    });
  }
  assert.ok(fs.statSync(path.join(WEB, 'bodies-meta.js')).size < 100_000, 'the half the boot imports stays small');
  // One writer for both: the bake.
  assert.match(read('scripts/build-bodies.py'), /web\/js\/bodies-meta\.js/);
});

test('a Wanderer is the Adventurer until its body is in, nothing is fetched before the boot allows it, and then it is swapped', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
  const { MeshBasicMaterial } = await import('three');
  const bodies = await import('../web/js/player-bodies.js');
  const { normalizeAvatar, DEFAULT_AVATAR, eyeOf } = await import('../web/js/avatar.js');
  const { createClassicAvatar } = await import('../web/js/classic-avatar.js');
  const { characterIcon, iconGeometry } = await import('../web/js/inventory.js');
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;

  const WOMAN = normalizeAvatar({ ...DEFAULT_AVATAR, character: 'adventurer', body: 'female' });
  assert.equal(bodies.wanderersReady(), false, 'importing the bodies loads none of them');
  assert.deepEqual(bodies.wanderersState(), { ready: false, allowed: false, asked: false, loading: false });
  // What the inventory reads of a Wanderer is there without the triangles.
  const meta = bodies.characterOf(WOMAN);
  assert.equal(meta.id, 'wanderer-female');
  assert.ok(meta.parts.length > 50 && meta.parts.every((p) => p.positions === undefined));
  assert.equal(bodies.drawnLook(WOMAN).body, null);
  assert.equal(bodies.drawnLook(WOMAN).character, 'adventurer');
  const plain = normalizeAvatar({});
  assert.equal(bodies.drawnLook(plain), plain, 'any other look passes untouched');

  // A peer arriving in one before the boot screen lifts: drawn as the Adventurer, nothing fetched.
  const mat = new MeshBasicMaterial();
  const rig = createClassicAvatar(WOMAN, mat);
  assert.equal(rig.character, 'adventurer');
  assert.equal(eyeOf(WOMAN), eyeOf({ character: 'adventurer' }));
  const icon = iconGeometry(characterIcon('wanderer-female'), WOMAN);
  assert.equal(icon.attributes.position, undefined, 'a portrait of a Wanderer is empty until her body is in (the alcove says ...)');
  assert.deepEqual(bodies.wanderersState(), { ready: false, allowed: false, asked: true, loading: false });
  assert.equal(bodies.loadWanderers(), null, 'not before allowWanderers()');

  // The boot lifts: the request already made is answered, and the rig swaps onto the real body.
  const swapped = new Promise((resolve) => bodies.onWanderers(resolve));
  bodies.allowWanderers();
  assert.equal(bodies.wanderersState().loading, true);
  await swapped;
  assert.equal(bodies.wanderersReady(), true);
  assert.equal(rig.character, 'wanderer-female', 'the rig wearing a Wanderer is swapped when her body lands');
  assert.ok(meta.parts.some((p) => p.positions?.length > 0), 'the triangles are merged into the parts the inventory holds');
  assert.equal(bodies.drawnLook(WOMAN), WOMAN);
  assert.ok(iconGeometry(characterIcon('wanderer-female'), WOMAN).attributes.position.count > 0, 'and then is her face');
  const later = createClassicAvatar(WOMAN, mat);
  assert.equal(later.character, 'wanderer-female', 'once in, a Wanderer is drawn as one at once');
  rig.dispose(); later.dispose();
});

test('the worker hands a body set back with its arrays as transferred Float32Arrays', async () => {
  const previousSelf = globalThis.self;
  let posted = null;
  globalThis.self = { postMessage: (data, transfer) => { posted = { data, transfer }; } };
  try {
    await import(`../web/js/lazy-set-worker.js?t=${Date.now()}`);
    const url = new URL('../web/js/bodies-mesh.js', import.meta.url).href;
    await globalThis.self.onmessage({ data: { url, name: 'BODIES', keys: ['positions', 'normals', 'colors', 'skin', 'skinIndices', 'skinWeights'] } });
  } finally {
    if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
  }
  assert.ok(posted && !posted.data.error, posted?.data.error);
  const part = posted.data.set.female.parts.find((p) => p.skinIndices);
  for (const key of ['positions', 'normals', 'colors', 'skinIndices', 'skinWeights']) assert.ok(part[key] instanceof Float32Array, key);
  assert.ok(posted.transfer.length > 100 && posted.transfer.every((b) => b instanceof ArrayBuffer));
  // A model set (models.js LAZY) still takes only positions and colours, as before.
  assert.match(read('web/js/lazy-module.js'), /keys = \['positions', 'colors'\]/);
});
