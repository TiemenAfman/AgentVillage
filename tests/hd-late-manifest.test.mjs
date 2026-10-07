// A room built before the HD pack's list arrived (main.js warmRooms builds the Salty Kraken behind the
// boot screen) put every kit piece into its one merged mesh, where setDetail can never reach it: in
// a test page the Kraken had 0 HD pieces. What is held:
//   - such a room says so (`hdMissed`), and a room built after the list does not;
//   - built again, the same room shows the pack's models when HD is wanted;
//   - main.js asks for the list at the top of boot(), waits for it in warmRooms and builds a room
//     that missed it again (roomFor / rewarmRooms), never one somebody is in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);
import { makeGlb, boxPositions } from './support/glb.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const noop = () => {};
// A 2D context that takes every call and answers with itself (a gradient's addColorStop included:
// the contact patch under an HD piece is painted, hd-pieces.js blobTexture).
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ctx)), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = {
  createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop,
  pointerLockElement: null, exitPointerLock: noop,
};
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, o = {}) { super(type); Object.assign(this, o); }
};
const served = new Map();
globalThis.fetch = async (input) => {
  const url = String(input && input.url ? input.url : input);
  for (const [tail, body] of served) {
    if (url.endsWith(tail)) {
      return typeof body === 'string' ? new Response(body, { headers: { 'content-type': 'application/json' } }) : new Response(body);
    }
  }
  throw new Error(`no network in a test: ${url}`);
};
const realWarn = console.warn;
console.warn = noop;

const models = await import('../web/js/models.js');
const { createInterior, prepareRoom } = await import('../web/js/interior.js');
await prepareRoom('piratetavern');
const hd = await import('../web/js/hd-pieces.js');
const { boxOfParts } = await import('shared/hdfit.mjs');

const STOOL = 'civic_kraken_stool';
const stoolBox = boxOfParts(models.assetParts(STOOL).map(models.part));
served.set('/api/hd', JSON.stringify({ v: 1, pack: 'hd-late', pieces: [{ asset: STOOL, file: 'stool.glb' }] }));
served.set('/api/hd/stool.glb', makeGlb([{ positions: boxPositions(stoolBox), material: 'body' }]));

function kraken() {
  const material = new THREE.MeshBasicMaterial();
  material.userData.uniforms = { uNight: { value: 0 } };
  return createInterior({
    room: 'piratetavern', camera: new THREE.PerspectiveCamera(60, 1, 0.05, 100), material, hd: true,
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
    onLeave: noop,
  });
}
const named = (scene, name) => {
  const out = [];
  scene.traverse((o) => { if (o.name === name) out.push(o); });
  return out;
};
const settle = () => new Promise((r) => setTimeout(r, 50));

test('a room built before the list says it missed the pack, and built again it shows HD', async () => {
  const blind = kraken();
  assert.equal(blind.hdMissed(), false, 'with no list there is nothing to miss');
  assert.equal(named(blind.scene, `sd:${STOOL}`).length, 0, 'every stool is in the merge');

  await hd.loadHdManifest();
  assert.ok(hd.hdInstalled());
  assert.equal(blind.hdMissed(), true, 'the list names a piece this room merged');
  blind.setDetail(true);
  await settle();
  assert.equal(named(blind.scene, `hd:${STOOL}`).length, 0, 'setDetail cannot reach a merged piece');
  blind.dispose();

  // What main.js roomFor does with it: build it again.
  const again = kraken();
  assert.equal(again.hdMissed(), false);
  assert.equal(named(again.scene, `sd:${STOOL}`).length, 6, 'five at the bar and the navigator\'s');
  for (let i = 0; i < 40 && named(again.scene, `hd:${STOOL}`).length < 6; i++) await settle();
  const shown = named(again.scene, `hd:${STOOL}`);
  assert.equal(shown.length, 6, 'one model per stool');
  assert.ok(shown.every((o) => o.visible));
  assert.ok(named(again.scene, `sd:${STOOL}`).every((o) => !o.visible), 'the bake steps aside');
  again.dispose();
});

test('main.js asks for the list with the rooms\' sets, waits for it, and rebuilds a room that missed it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web/js/main.js'), 'utf8');
  const boot = src.slice(src.indexOf('async function boot()'));
  const ask = boot.indexOf('hdAsking = loadHdManifest()');
  assert.ok(ask > 0 && ask < boot.indexOf('await warmRooms('), 'the list is asked for before the rooms are warmed');
  const warm = src.slice(src.indexOf('async function warmRooms('), src.indexOf('async function boot()'));
  assert.match(warm, /await within\(hdAsking\)/, 'warmRooms waits for it, within its deadline');
  const roomFor = src.slice(src.indexOf('function roomFor(room)'), src.indexOf('function enterInterior('));
  assert.match(roomFor, /hdMissed\?\.\(\) && state\.inside !== inside && !inside\.peeking\(\)/, 'never a room somebody is in');
  assert.match(boot, /loadHdManifest\(\)\.then\(\(\) => \{ rewarmRooms\(\);/, 'a late list builds the room again');
});

test.after(() => { console.warn = realWarn; delete globalThis.document; });
