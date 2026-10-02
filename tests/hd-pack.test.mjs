// The HD pack (Plans/piratenkroeg.md, "The HD pack", web/js/hd-pieces.js, shared/hdfit.mjs): textured models from
// HOME/hd that stand in for a room's baked kit pieces. What is held:
//   - the contract's arithmetic: a GLB's box read off its JSON chunk through its node transforms, a
//     quarter turn the way three turns, and the tolerance against the bake;
//   - the manifest: a bad piece is dropped and named, the rest of the pack stands;
//   - in the Salty Kraken, under Node: a piece the pack lists leaves the room's merge, its model is
//     fetched only when HD is wanted, shown in the bake's place and switched back live, and a model
//     that does not fit its bake stays the bake - said once, never retried;
//   - and, when a pack is on this machine, every piece in it against the bake that will ship.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);
import { makeGlb, boxPositions } from './support/glb.mjs';

const { parseHdManifest, boxOfParts, placeBox, fitsBake, glbInfo, HD_FIT } = await import('shared/hdfit.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// ---- the arithmetic ----------------------------------------------------------------------------

test('a GLB box is read through its node transforms, without decoding a mesh', () => {
  const q = Math.SQRT1_2;   // a quarter turn about y
  const glb = makeGlb([
    { positions: boxPositions([0, 0, 0, 1, 2, 0.5]), material: 'a', translation: [10, 0, 0] },
    { positions: boxPositions([-1, 0, 0, 0, 1, 1]), material: 'b', rotation: [0, q, 0, q], scale: [2, 2, 2] },
  ], { images: [{ w: 2048, h: 1024 }, { w: 4096, h: 2048, webp: true }] });
  const info = glbInfo(glb);
  // The second box turned +90 about y (x -> -z, z -> x) and doubled: x 0..2, z 0..2, y 0..2.
  const want = [0, 0, 0, 11, 2, 2];
  info.box.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-6, `box[${i}] ${v} != ${want[i]}`));
  assert.equal(info.tris, 24);
  assert.equal(info.materials, 2);
  assert.deepEqual(info.textures, [{ w: 2048, h: 1024 }, { w: 4096, h: 2048 }]);
});

test('a quarter turn of a box is three\'s rotation.y, and the scale and offset follow', () => {
  const box = [-0.2, 0, -0.1, 0.4, 0.5, 0.3];
  for (let turn = 0; turn < 4; turn++) {
    const o = new THREE.Object3D();
    o.scale.setScalar(1.5);
    o.rotation.y = (turn * Math.PI) / 2;
    o.position.set(1, 2, 3);
    o.updateMatrix();
    const b = new THREE.Box3(new THREE.Vector3(box[0], box[1], box[2]), new THREE.Vector3(box[3], box[4], box[5])).applyMatrix4(o.matrix);
    const got = placeBox(box, { x: 1, y: 2, z: 3, turn, s: 1.5 });
    [...b.min.toArray(), ...b.max.toArray()].forEach((v, i) => assert.ok(Math.abs(v - got[i]) < 1e-9, `turn ${turn} [${i}]`));
  }
});

test('the outline may be off by 3 cm or a tenth of the extent, not more', () => {
  const bake = [-0.25, 0, -0.25, 0.25, 0.4, 0.25];
  assert.ok(fitsBake([-0.29, 0, -0.27, 0.28, 0.37, 0.25], bake).ok, 'within a tenth');
  const off = fitsBake([-0.25, 0.1, -0.25, 0.25, 0.4, 0.25], bake);
  assert.ok(!off.ok, 'a model floating 0.1 over the floor');
  assert.equal(off.worst.face, 'minY');
  assert.equal(HD_FIT.abs, 0.03);
});

test('a bad piece is dropped and named; the rest of the pack stands', () => {
  const m = parseHdManifest({
    v: 1, pack: 'hd-1', extra: 'ignored',
    pieces: [
      { asset: 'civic_kraken_stool', file: 'stool.glb', at: { turn: 1 }, materials: { gold: 'gilt', odd: 'shiny' }, tone: 0xffeedd },
      { asset: 'civic_kraken_stool', file: 'again.glb' },
      { asset: 'civic_kraken_mast', file: '../escape.glb' },
      { asset: 'civic_kraken_bow', file: 'bow.glb', at: { turn: 5 } },
      { asset: 'Not An Asset', file: 'x.glb' },
    ],
  });
  assert.equal(m.pack, 'hd-1');
  assert.deepEqual(m.pieces.map((p) => p.asset), ['civic_kraken_stool']);
  assert.deepEqual(m.pieces[0].at, { x: 0, y: 0, z: 0, turn: 1, s: 1 });
  assert.deepEqual(m.pieces[0].materials, { gold: 'gilt' }, 'an unknown role is left out');
  assert.equal(m.skipped.length, 4);
  assert.equal(parseHdManifest({ v: 2, pieces: [] }), null, 'a manifest from a later format is no pack');
  assert.equal(parseHdManifest(null), null);
});

// ---- in the Salty Kraken -----------------------------------------------------------------------
// buildings.js builds a TextureLoader at import; quest-mark.js paints a canvas when it is made.
const ctx2d = new Proxy({}, { get: () => () => ({}) });
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
};
// three's FileLoader reports progress with the browser's ProgressEvent, which Node does not have.
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, o = {}) { super(type); Object.assign(this, o); }
};
const served = new Map();
const fetched = [];
globalThis.fetch = async (input) => {
  const url = String(input && input.url ? input.url : input);
  fetched.push(url);
  for (const [tail, body] of served) {
    if (url.endsWith(tail)) {
      return typeof body === 'string' ? new Response(body, { headers: { 'content-type': 'application/json' } }) : new Response(body);
    }
  }
  throw new Error(`no network in a test: ${url}`);
};
const warned = [];
const realWarn = console.warn;
console.warn = (...a) => warned.push(a.join(' '));

const models = await import('../web/js/models.js');
const { prepareRoom } = await import('../web/js/interior.js');
await prepareRoom('piratetavern');
const { buildPirateTavern } = await import('../web/js/pirate-tavern.js');
const hd = await import('../web/js/hd-pieces.js');
const rect = (x, z, hx, hz) => ({ x, z, hx, hz });
const FLOOR = 0.06;

const STOOL = 'civic_kraken_stool', MAST = 'civic_kraken_mast';
const bakeBoxOf = (asset) => boxOfParts(models.assetParts(asset).map(models.part));
const stoolBox = bakeBoxOf(STOOL), mastBox = bakeBoxOf(MAST);
// A stool of the bake's own outline, with a flame on top; a mast half again too tall.
served.set('/api/hd', JSON.stringify({
  v: 1, pack: 'hd-test',
  pieces: [
    { asset: STOOL, file: 'stool.glb', materials: { wick: 'flame' } },
    { asset: MAST, file: 'mast.glb' },
  ],
}));
served.set('/api/hd/stool.glb', makeGlb([
  { positions: boxPositions(stoolBox), material: 'body' },
  { positions: boxPositions([-0.005, stoolBox[4] - 0.03, -0.005, 0.005, stoolBox[4] - 0.01, 0.005]), material: 'wick' },
]));
served.set('/api/hd/mast.glb', makeGlb([{ positions: boxPositions([mastBox[0], 0, mastBox[2], mastBox[3], mastBox[4] * 1.5, mastBox[5]]), material: 'wood' }]));

const before = buildPirateTavern({ FLOOR, rect });

test('without a pack the room is the bake, and nothing is asked for', () => {
  assert.equal(before.pieces.length, 0);
  assert.ok(before.parts.length > 0);
  assert.equal(fetched.length, 0, 'importing and building fetched nothing');
});

test('the manifest is asked for once, and a listed piece leaves the merge', async () => {
  await hd.loadHdManifest();
  await hd.loadHdManifest();
  assert.equal(fetched.filter((u) => u.endsWith('/api/hd')).length, 1);
  assert.ok(hd.hdInstalled());
  assert.deepEqual(hd.hdStatus(), { pack: 'hd-test', pieces: 2 });
  const def = buildPirateTavern({ FLOOR, rect });
  const stools = def.pieces.filter((p) => p.asset === STOOL);
  assert.equal(stools.length, 6, 'five at the bar and the navigator\'s');
  assert.equal(def.pieces.filter((p) => p.asset === MAST).length, 1);
  // Every geometry is drawn exactly once: in the merge or in a piece.
  const count = (list) => list.reduce((n, g) => n + g.attributes.position.count, 0);
  const inPieces = def.pieces.reduce((n, p) => n + count(p.geoms), 0);
  assert.equal(count(def.parts) + inPieces, count(before.parts));
  assert.equal(fetched.filter((u) => u.endsWith('.glb')).length, 0, 'no model before one is wanted');
});

test('the room\'s stand-ins are kit pieces standing on their foot, so the pack can replace them', async () => {
  // Plans/piratenkroeg.md, "The HD pack" 9: the pack replaces a kit piece and nothing else, so a stand-in
  // drawn into the hall's bake could never be swapped for its Pixal3D model.
  const { KIT_KINDS, PROPS } = await import('../web/js/kraken-dressing.js');
  const src = fs.readFileSync(path.join(ROOT, 'web/js/pirate-tavern.js'), 'utf8');
  const fixed = ['charttable', 'captainchair', 'rowboat', 'hammock', 'helm', 'anchor', 'jollyroger'];
  for (const object of [...fixed, ...Object.values(KIT_KINDS).map((k) => k.object)]) {
    const asset = `civic_kraken_${object}`;
    assert.ok(models.assetParts(asset).length > 0, `${asset} is not baked into the kit`);
    assert.ok(Math.abs(bakeBoxOf(asset)[1]) < 0.002, `${asset}'s foot is not on y = 0`);
  }
  for (const object of fixed) assert.match(src, new RegExp(`kit\\('civic_kraken_${object}'`), `${object} is not placed through kit()`);
  for (const kind of Object.keys(KIT_KINDS)) assert.ok(PROPS.some((p) => p.kind === kind), `no prop of kind ${kind}`);
});

const settle = () => new Promise((r) => setTimeout(r, 50));

test('wanted, the model takes the bake\'s place; switched off, the bake comes back', async () => {
  const def = buildPirateTavern({ FLOOR, rect });
  const scene = new THREE.Scene();
  const roof = new THREE.Group();
  const pieces = hd.createHdPieces({ scene, roof, pieces: def.pieces, material: new THREE.MeshStandardMaterial(), hd: false });
  assert.equal(fetched.filter((u) => u.endsWith('.glb')).length, 0, 'SD fetches no model');
  const sd = scene.children.filter((o) => o.name === `sd:${STOOL}`);
  assert.equal(sd.length, 6);
  assert.ok(sd.every((o) => o.visible));

  pieces.setDetail(true);
  for (let i = 0; i < 40 && !scene.children.some((o) => o.name === `hd:${STOOL}`); i++) await settle();
  await settle();
  const models3 = scene.children.filter((o) => o.name === `hd:${STOOL}`);
  assert.equal(models3.length, 6, 'one copy per stool');
  assert.ok(models3.every((o) => o.visible) && sd.every((o) => !o.visible), 'HD shown, the bake hidden');
  // Each copy stands where its bake stood.
  const spot = def.pieces.filter((p) => p.asset === STOOL).map((p) => [p.at.x, p.at.y, p.at.z].join());
  assert.deepEqual(models3.map((o) => o.position.toArray().join()).sort(), spot.sort());
  // The wick is a flame: a halo per stool, beside the model.
  assert.ok(scene.children.filter((o) => o.isPoints).length >= 6);
  // Shared, not copied: one geometry for all six.
  const geoms = new Set();
  for (const m of models3) m.traverse((o) => { if (o.isMesh) geoms.add(o.geometry); });
  assert.equal(geoms.size, 2);

  // The mast does not fit its bake: it stays the bake, said once, and is not fetched again.
  const mastSd = scene.children.find((o) => o.name === `sd:${MAST}`);
  assert.ok(mastSd.visible);
  assert.ok(!scene.children.some((o) => o.name === `hd:${MAST}`));
  assert.equal(warned.filter((w) => w.includes('mast.glb')).length, 1);
  assert.match(warned.find((w) => w.includes('mast.glb')), /maxY/);

  pieces.setDetail(false);
  assert.ok(sd.every((o) => o.visible) && models3.every((o) => !o.visible), 'back to the bake, live');
  const glbs = fetched.filter((u) => u.endsWith('.glb')).length;
  pieces.setDetail(true);
  await settle();
  assert.ok(models3.every((o) => o.visible));
  assert.equal(fetched.filter((u) => u.endsWith('.glb')).length, glbs, 'loaded once for the page');
  pieces.update(1);
  pieces.dispose();
});

test('the loader is a dynamic import and the addresses go through the islander', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web', 'js', 'hd-pieces.js'), 'utf8');
  assert.doesNotMatch(src, /^import .*GLTFLoader/m);
  assert.match(src, /mine\('\/api\/hd'\)/);
  assert.match(src, /mineUrl\(`\/api\/hd\//);
  const access = fs.readFileSync(path.join(ROOT, 'lib', 'access.mjs'), 'utf8');
  assert.doesNotMatch(access.match(/PUBLIC_API = new Set\(\[[^\]]*\]\)/)[0], /\/api\/hd/, 'keeper-only, like the local models');
});

// ---- the pack on this machine ------------------------------------------------------------------
// Where a pack would be, worked out without importing lib/paths.mjs - importing it outside a
// worktree moves an island (CLAUDE.md, the desktop window): PROMPTHOLM_HD_DIR, else HOME's rule -
// PROMPTHOLM_HOME, a linked worktree's own checkout, the folder ~/.promptholm/home.txt names,
// else ~/.promptholm - and in that home the config's `hd.dir` when it is set (hdDirOf).
function packDir() {
  if (process.env.PROMPTHOLM_HD_DIR) return process.env.PROMPTHOLM_HD_DIR;
  const git = path.join(ROOT, '.git');
  const shared = path.join(os.homedir(), '.promptholm');
  let pointed = null;
  try {
    const line = fs.readFileSync(path.join(shared, 'home.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim();
    if (path.isAbsolute(line)) pointed = line;
  } catch { /* no pointer */ }
  const home = process.env.PROMPTHOLM_HOME
    || (fs.existsSync(git) && fs.statSync(git).isFile() ? ROOT : pointed || shared);
  let dir = null;
  try { dir = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).hd.dir; } catch { /* the default */ }
  return typeof dir === 'string' && path.isAbsolute(dir) ? dir : path.join(home, 'hd');
}

test('every piece in the pack on this machine fits the bake that will ship', async (t) => {
  const dir = packDir();
  const file = path.join(dir, 'hd-manifest.json');
  if (!fs.existsSync(file)) { t.skip(`no HD pack at ${dir}`); return; }
  const m = parseHdManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.ok(m, `${file} is not an HD manifest`);
  assert.deepEqual(m.skipped, [], 'every piece in the manifest is well formed');
  for (const p of m.pieces) {
    assert.ok(models.hasAsset(p.asset), `${p.asset}: no such baked asset`);
    const info = glbInfo(fs.readFileSync(path.join(dir, p.file)));
    const fit = fitsBake(placeBox(info.box, p.at), bakeBoxOf(p.asset));
    t.diagnostic(`${p.asset}: ${info.tris} triangles, ${info.materials} materials, textures ${info.textures.map((x) => (x ? `${x.w}x${x.h}` : '?')).join(' ')}`);
    assert.ok(fit.ok, `${p.file} against ${p.asset}: ${fit.worst.face} off by ${fit.worst.off.toFixed(3)} (allowed ${fit.worst.allowed.toFixed(3)})`);
  }
});

test.after(() => { console.warn = realWarn; delete globalThis.document; });
