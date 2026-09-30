// A region raised and lowered gives back everything it took.
//
// The page raises and lowers whole islands while it runs: a neighbour drifting into the
// nearest few (`pickDetailed` in main.js) and out again, a republish that changes their
// coast, and a rehome, which takes every guest region down to be raised again at the new
// berth. None of that ever reloads the page, so whatever one raise leaves behind is left
// behind again on the next, and on a page somebody keeps open all day it adds up. There are
// a couple of hundred `.dispose()` calls in web/js already; what they could not say is
// whether a raise/lower cycle gives *all* of it back, and adding more of them by eye is
// how the gaps below were left in the first place (see Plans/DONE/sneller-tekenen.md, step 4).
//
// So this measures instead of sweeping. It raises a guest region the way main.js's
// raiseGuestIslands does - createGuestIsland, the extras attachExtras hangs on each record,
// the crowd, the props, the beds, the story animals and the ambient ones - lowers it the way
// dropRegion does, and watches every geometry, material and InstancedMesh the raise put into
// the scene, and every texture it touched (see `touched` below), for its 'dispose' event.
// That event is exactly what three.js's renderer listens for to free the buffers, the
// program and the texture on the GPU, so "every per-raise resource was disposed" is
// renderer.info.memory returning to its baseline, asserted without a WebGL context. (An
// InstancedMesh's instance buffers are not in renderer.info at all, which is how 35 of them
// a region went unnoticed.)
//
// Per-raise and shared are told apart by raising three times - once to fill the caches, then
// twice to measure: whatever both measured raises hold (the building material, a module's
// cached geometry) is the page's and must NOT be disposed - disposing that is a re-upload on
// the next raise at best - and whatever belongs to one raise only must be.
//
// The same cycle in the browser (the fleet emptied and restored through syncFleet, eight
// times, the volcano and three starters, counting live GL objects): before the fixes this
// file came with, every cycle left 5 textures (~7 MB, the volcano's ground masks and sheets)
// and ~92 buffers behind; after them the counts come back.
//
// The one thing this cannot do from Node is load the imps (web/js/imp.js is a GLB loaded in
// the browser); their bargain - geometry and program kept for the page's life - is
// deliberate and written down in that file's header.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader at import time and the landscape asks for its grass
// sheet while it is built, so, as in tests/guest-landscape.test.mjs, the stub stays. Unlike
// that one, this image *arrives*: ImageLoader's load listener is called as soon as `src` is
// set, so every sheet a raise asks for turns into a texture this test can see - and a sheet
// per landscape is exactly the kind of thing that is easy to leave behind.
globalThis.document = {
  // The treasure statue's plaque paints a canvas (web/js/treasure-plaque.js); nothing here reads it.
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {}, measureText: () => ({ width: 0 }) }) }),
  createElementNS: () => {
    const on = {};
    const img = {
      width: 1, height: 1,
      addEventListener(type, fn) { on[type] = fn; },
      removeEventListener() {},
      set src(_) { if (on.load) on.load.call(img); },
    };
    return img;
  },
};
const THREE = await import('three');

// A texture that is handed to a shader through onBeforeCompile, or waits in a closure for a
// sheet, is not reachable from the scene graph, so walking the scene cannot find it. What
// every texture the renderer will ever upload does have in common is `needsUpdate = true` -
// a DataTexture is filled that way, a CanvasTexture's constructor says it, a loaded sheet
// gets it on arrival. So the setter is watched, and every texture it sees while a raise is
// under way counts as that raise's.
const touched = new Set();
let recording = false;
{
  const d = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate');
  Object.defineProperty(THREE.Texture.prototype, 'needsUpdate', {
    ...d,
    set(v) { if (recording && v) touched.add(this); d.set.call(this, v); },
  });
}
const { createGuestIsland } = await import('../web/js/guest-island.js');
const { createCrowdView } = await import('../web/js/crowd-view.js');
const { createProps } = await import('../web/js/props.js');
const { createCrops } = await import('../web/js/crops.js');
const { createAnimalBatch, createAnimalView } = await import('../web/js/animal-view.js');
const { createHerds } = await import('../web/js/herds.js');
const { createHorizon } = await import('../web/js/horizon.js');
const { createIslets } = await import('../web/js/islets.js');
const { attachClock, attachResetClock } = await import('../web/js/clock.js');
const { attachFountain } = await import('../web/js/fountain.js');
const { attachSawmill } = await import('../web/js/sawmill.js');
const { attachBatavia } = await import('../web/js/batavia.js');
const { attachSmithy } = await import('../web/js/smithy.js');
const { attachStable } = await import('../web/js/stable.js');
const { attachBakery } = await import('../web/js/countryside.js');
const { attachBaker } = await import('../web/js/bakery-keeper.js');
const { attachButcher } = await import('../web/js/butcher.js');
const { attachQuarry } = await import('../web/js/quarry.js');
const { attachBeacon } = await import('../web/js/beacon.js');
const { attachGoldPile } = await import('../web/js/goldpit.js');
const { attachOrePile } = await import('../web/js/goldmine.js');
const { attachPlaque } = await import('../web/js/treasure-plaque.js');
const { attachFurnace } = await import('../web/js/goldsmith.js');
const { makeTerrain } = await import('../shared/terrain.mjs');
const { placeIsland } = await import('../shared/regions.mjs');
const { starterBundle } = await import('../lib/islandbundle.mjs');

const MAIN = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
// The body of one top-level function in main.js, up to the next one.
function body(name) {
  const at = MAIN.indexOf(`\nfunction ${name}(`);
  assert.ok(at >= 0, `main.js has no function ${name} any more - this test mirrors it`);
  const end = MAIN.indexOf('\nfunction ', at + 1);
  return MAIN.slice(at, end < 0 ? undefined : end);
}

// Every civic whose record carries something that moves (built.animated) and a few that do
// not, a street of houses - every third one at work, so it has a scaffold - a shed, a camp
// with its fire, and a harbour house. Put anywhere on the starter island: where a building
// stands is not what this is about, and a trade in the sea still builds its trade.
const CIVICS = ['clocktower', 'fountain', 'sawmill', 'smithy', 'stable', 'bakery', 'butcher', 'brewery', 'quarry',
  'windmill', 'lighthouse', 'goldmine', 'goldsmith', 'goldpit', 'ship', 'castle', 'market', 'chapel', 'school',
  'grocer', 'fishery', 'shipyard', 'treasure'];
function bundle() {
  const b = JSON.parse(JSON.stringify(starterBundle(0)));
  CIVICS.forEach((t, k) => {
    const plot = { gx: 4 + (k % 8) * 7, gz: 4 + Math.floor(k / 8) * 7, w: 3, d: 3, rot: 0 };
    b.buildings.push({ id: `civic:${t}`, kind: 'civic', civicType: t, name: t, label: t, tier: 'civic', plot });
  });
  for (let i = 0; i < 12; i++) {
    b.buildings.push({
      id: `house:s${i}`, kind: 'house', style: ['opus', 'sonnet', 'haiku'][i % 3], tier: ['tent', 'hut', 'cottage', 'house'][i % 4],
      name: `house ${i}`, active: i % 3 === 0, plot: { gx: 6 + (i % 6) * 8, gz: 40 + Math.floor(i / 6) * 8, w: 3, d: 3, rot: i % 4 },
    });
  }
  b.buildings.push({ id: 'shed:s0:x1', kind: 'shed', master: 'house:s0', tool: 'Bash', style: 'opus', plot: { gx: 9, gz: 40, w: 1, d: 1, rot: 0 } });
  b.buildings.push({ id: 'house:camp', kind: 'camp', style: 'opus', name: 'camp', plot: { gx: 50, gz: 56, w: 3, d: 3, rot: 0 } });
  b.buildings.push({ id: 'house:quay', kind: 'house', style: 'opus', tier: 'cottage', harbour: true, name: 'quay', plot: { gx: 1, gz: 58, w: 3, d: 3, rot: 0 } });
  b.props = [
    { id: 'prop:1', kind: 'tree', x: 2, z: 3, rot: 0, scale: 1 },
    { id: 'prop:2', kind: 'fence', x: -4, z: 5, rot: 0.5, scale: 1, length: 4 },
    { id: 'prop:3', kind: 'bench', x: 6, z: -2, rot: 1, scale: 1 },
  ];
  const now = Date.now();
  b.crops = [
    { id: 'bed:1', kind: 'turnip', x: 1, z: -6, rot: 0, plantedAt: now - 1000, ripeAt: now + 60000 },
    { id: 'bed:2', kind: 'carrot', x: 3, z: -6, rot: 0, plantedAt: now - 60000, ripeAt: now - 1 },
  ];
  return b;
}

// The page's own, made once like main.js's module-level ones: the building material, the
// windmill's sails and the camp's fire. They are shared by every record on every island, so
// they are exactly what a lowering must leave alone.
const material = new THREE.MeshStandardMaterial();
const bladesGeo = new THREE.BoxGeometry(1, 1, 0.1);
const campfireGeo = new THREE.BoxGeometry(0.3, 0.1, 0.3);
const flameGeo = new THREE.ConeGeometry(0.1, 0.3, 5);
const flameMat = new THREE.MeshBasicMaterial();

// attachExtras(rec, { mail: false, signs: false }) from main.js, which is how a guest's
// records get their moving parts. A mirror, because main.js boots a page when it is
// imported - and a mirror kept honest by the first test below, which fails the moment
// attachExtras hangs something on a record that this list does not know about.
const MIRRORED = new Set(['blades', 'beacon', 'clock', 'fountain', 'sawmill', 'smithy', 'ship', 'stable', 'bakery', 'baker',
  'butcher', 'quarry', 'steamAnchor', 'goldPile', 'orePile', 'furnace', 'resetClock', 'flame', 'fire', 'flagAnchor', 'smokeAnchor', 'plaque']);
// What attachExtras hangs only on our own island: the postbox flag and the fisherman are behind
// `mail`, a yard sign behind `signs`, and both are off for a guest.
const OURS_ONLY = new Set(['mailFlag', 'fisher', 'sign']);
function extras(rec) {
  const { spec, built, group } = rec;
  const a = built.animated || {};
  if (a.blades) { const m = new THREE.Mesh(bladesGeo, material); m.position.set(...a.blades.at); group.add(m); rec.blades = m; }
  if (a.beacon) rec.beacon = attachBeacon(group, a.beacon.at);
  if (a.clock) rec.clock = attachClock(group, a.clock.at, material);
  if (a.fountain) rec.fountain = attachFountain(group, a.fountain.at, material);
  if (a.sawmill) rec.sawmill = attachSawmill(group, a.sawmill.at, material);
  if (a.smithy) rec.smithy = attachSmithy(group, a.smithy.at, material);
  if (a.ship) rec.ship = attachBatavia(rec.mesh, spec.id, material);
  if (a.stable) rec.stable = attachStable(group, a.stable.at, material);
  if (a.bakery) { rec.bakery = attachBakery(group, a.bakery.at, material); rec.baker = attachBaker(group, a.bakery.at, material); }
  if (a.butcher) rec.butcher = attachButcher(group, a.butcher.at, material);
  if (a.quarry) rec.quarry = attachQuarry(group, a.quarry.at, material);
  if (a.steam) rec.steamAnchor = a.steam.at;
  if (a.goldpile) { rec.goldPile = attachGoldPile(group, a.goldpile.at, material); rec.goldPile.foreign = true; }
  if (a.orepile && a.orepile.at) { rec.orePile = attachOrePile(group, a.orepile.at); rec.orePile.foreign = true; }
  if (a.goldsmith) rec.furnace = attachFurnace(group, a.goldsmith.at, material);
  if (spec.civicType === 'treasure' && built.anchors && built.anchors.sign) rec.plaque = attachPlaque(group, built.anchors.sign, 3);
  if (a.resetclock) { rec.resetClock = attachResetClock(group, a.resetclock.at, material, a.resetclock.r); rec.resetClock.foreign = true; }
  if (spec.kind === 'camp') {
    const fire = new THREE.Mesh(campfireGeo, material);
    group.add(fire);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    group.add(flame);
    rec.flame = flame;
    const l = new THREE.PointLight(0xff9a40, 2.4, 5, 2);
    group.add(l);
    rec.fire = l;
  }
  if (built.anchors && built.anchors.flag) rec.flagAnchor = built.anchors.flag;
  if (built.anchors && built.anchors.smoke) rec.smokeAnchor = built.anchors.smoke;
}

// raiseGuestIslands and dropRegion, minus the fleet, the pickables and the boards.
function world() {
  const scene = new THREE.Scene();
  const page = { scene };
  page.raise = (origin = [300, 0]) => {
    recording = true;
    try { return raise(origin); } finally { recording = false; }
  };
  const raise = (origin) => {
    const b = bundle();
    const terrain = makeTerrain(b.island.seed, { size: b.grid.size });
    const region = placeIsland(terrain, { id: b.island.id, origin });
    region.village = b;
    const g = createGuestIsland({ scene, region, buildings: b.buildings, material, month: 8 });
    for (const rec of g.records) extras(rec);
    g.crowd = createCrowdView({ scene, material, region, buildings: b.buildings });
    g.crowd.roster(b.buildings.filter((x) => x.kind === 'house' || x.kind === 'camp').map((x) => x.id));
    // Everybody placed, one of them out in a dinghy - the hull is the crowd's own mesh - and a
    // frame drawn, so what a frame builds is in the measurement too.
    const now = 1000;
    const rows = new Map();
    for (const idx of g.crowd.figures().keys()) rows.set(idx, { x: idx, z: idx, anim: idx % 2 ? 'walk' : 'hammer' });
    g.crowd.apply(rows, now);
    g.crowd.applyRides(new Map([[0, { x: -30, z: -30, yaw: 0 }]]), now);
    g.crowd.draw(0.016, () => 0, now);
    g.props = createProps({ scene: g.group, terrain: region.terrain, material });
    g.props.apply(b.props, { animate: false });
    g.crops = createCrops({ scene: g.group, terrain: region.terrain, material });
    g.crops.apply(b.crops, { animate: false });
    // One batch for every island's story animals and one for the ambient ones, made on the
    // first raise and kept for the page's life - animalBatch() and ambientFor() in main.js.
    if (!page.animals) page.animals = createAnimalBatch(scene, material);
    g.herd = createAnimalView({ batch: page.animals, region });
    if (!page.herds) page.herds = createHerds({ scene, material });
    g.ambient = page.herds.forIsland({ region, groundAt: (x, z) => Math.max(0, region.worldHeight(x, z)) });
    return g;
  };
  page.lower = (g) => {
    g.crowd.dispose();
    g.herd.dispose();
    g.ambient.dispose();
    g.props.dispose();
    g.crops.dispose();
    g.dispose();
  };
  return page;
}

// Everything in a subtree that holds something on the GPU once it is drawn.
function holdings(root) {
  const out = new Map();
  const add = (kind, o, where) => { if (o && !out.has(o)) out.set(o, `${kind} of ${where}`); };
  root.traverse((o) => {
    // Named after the record it hangs on, so a failure says which building leaked.
    let where = o.name || o.type;
    for (let q = o; q; q = q.parent) {
      if (q.userData && q.userData.id) { where = `${q.userData.id} ${where}`; break; }
      const beside = q.children && q.children.find((x) => x !== o && x.userData && x.userData.id);
      if (beside) { where = `${beside.userData.id} ${where}`; break; }
    }
    if (o.geometry) add('geometry', o.geometry, where);
    // An InstancedMesh owns its instanceMatrix and instanceColor buffers; the renderer frees
    // them on the mesh's own dispose(), not the geometry's.
    if (o.isInstancedMesh) add('InstancedMesh', o, where);
    for (const m of [].concat(o.material || [])) {
      add('material', m, where);
      for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) add(`texture ${k}`, m[k], where);
      if (m.uniforms) for (const k of Object.keys(m.uniforms)) {
        const v = m.uniforms[k] && m.uniforms[k].value;
        if (v && v.isTexture) add(`texture ${k}`, v, where);
      }
    }
  });
  return out;
}
// What a raise holds: everything in the scene, and every texture it touched on the way.
function heldBy(scene) {
  const held = holdings(scene);
  for (const t of touched) if (!held.has(t)) held.set(t, `texture ${t.constructor.name} ${t.image && t.image.width}x${t.image && t.image.height}`);
  touched.clear();
  return held;
}
const count = (root) => { let n = 0; root.traverse(() => n++); return n; };
const disposed = new WeakSet();
function watch(held) {
  for (const o of held.keys()) {
    if (o.__leakWatch) continue;
    o.__leakWatch = true;
    o.addEventListener('dispose', () => disposed.add(o));
  }
}
function tally(list) {
  const n = new Map();
  for (const what of list) n.set(what, (n.get(what) || 0) + 1);
  return [...n].map(([what, k]) => `${k} x ${what}`).join('\n  ');
}

test('the mirror of attachExtras knows everything main.js hangs on a record', () => {
  const hung = new Set([...body('attachExtras').matchAll(/\brec\.(\w+)\s*=[^=]/g)].map((m) => m[1]));
  const unknown = [...hung].filter((k) => !MIRRORED.has(k) && !OURS_ONLY.has(k));
  assert.deepEqual(unknown, [], 'attachExtras hangs something new on a record - mirror it in extras() here, so its lowering is measured');
});

test('a guest region is lowered by the same list it was raised with, in both places main.js lowers one', () => {
  // raiseGuestIslands hangs these on a guest; dropRegion (and the loop at the end of
  // raiseGuestIslands, for a region the sea no longer has) must dispose every one of them.
  const raised = new Set([...body('raiseGuestIslands').matchAll(/\bg\.(\w+)\s*=\s*create|\bg\.(\w+)\s*=\s*ambientFor/g)].map((m) => m[1] || m[2]));
  assert.ok(raised.size >= 5, `expected the crowd, props, crops and both herds, found ${[...raised]}`);
  for (const where of ['dropRegion', 'raiseGuestIslands']) {
    const src = body(where);
    for (const k of raised) assert.match(src, new RegExp(`g\\.${k}\\.dispose\\(\\)`), `${where} never disposes g.${k}`);
    assert.match(src, /\bg\.dispose\(\)/, `${where} never disposes the guest island itself`);
  }
});

test('raising and lowering a guest region gives back everything it took, and nothing it shared', () => {
  const page = world();
  // A first cycle to fill every module-level cache - a baked asset's geometry built on first
  // use, the beacon's beam, the two animal batches - the way the first raise on a page does.
  page.lower(page.raise());
  const baseline = count(page.scene);

  touched.clear();
  const a = page.raise();
  const heldA = heldBy(page.scene);
  watch(heldA);
  page.lower(a);
  assert.equal(count(page.scene), baseline, 'the scene graph grew by a raise and a lowering');

  const b = page.raise();
  const heldB = heldBy(page.scene);
  watch(heldB);
  page.lower(b);
  assert.equal(count(page.scene), baseline, 'the scene graph grew by a second raise and a lowering');

  const own = [...heldA].filter(([o]) => !heldB.has(o));
  const shared = [...heldA].filter(([o]) => heldB.has(o));
  assert.ok(own.length > 150, `only ${own.length} per-raise resources - is the region being raised at all?`);
  assert.ok(shared.some(([o]) => o === material), 'the building material is not in the scene - the harness is broken');

  const kept = own.filter(([o]) => !disposed.has(o)).map(([, what]) => what);
  assert.equal(kept.length, 0, `a lowered region left ${kept.length} resources on the GPU:\n  ${tally(kept)}`);
  const spent = shared.filter(([o]) => disposed.has(o)).map(([, what]) => what);
  assert.equal(spent.length, 0, `a lowering disposed ${spent.length} resources every island shares:\n  ${tally(spent)}`);
});

test('the shared animal batches give their places back, so the thirtieth raise still has animals', () => {
  const page = world();
  const first = page.raise();
  first.ambient.update(0.016);
  const want = first.ambient.animals().length;
  page.lower(first);
  assert.ok(want > 0, 'no ambient animals on the test island - the check below would prove nothing');
  let last = null;
  for (let i = 0; i < 30; i++) { if (last) page.lower(last); last = page.raise(); }
  last.ambient.update(0.016);
  const drawn = last.ambient.animals().filter((x) => x.drawn).length;
  assert.equal(drawn, want, 'raises used up the ambient batch - a lowered herd kept its slots');
  page.lower(last);
});

test('the Codex houses coming and going give back what went', () => {
  // The volcano's buildings change while it stands (main.js's `codex` message ->
  // applyBuildings), and a house that goes is taken down without the region being lowered.
  const page = world();
  const g = page.raise();
  const all = g.region.village.buildings;
  const held = holdings(g.group);
  watch(held);
  const gone = new Set(['civic:clocktower', 'civic:fountain', 'civic:goldmine', 'civic:goldsmith', 'civic:goldpit', 'house:s3']);
  const leaving = g.records.filter((r) => gone.has(r.id));
  assert.equal(leaving.length, gone.size);
  const theirs = new Set();
  for (const r of leaving) for (const o of holdings(r.group).keys()) if (o !== material) theirs.add(o);
  // Anything also held by a building that stays is shared, not theirs.
  for (const r of g.records) if (!gone.has(r.id)) for (const o of holdings(r.group).keys()) theirs.delete(o);
  const { removed } = g.applyBuildings(all.filter((x) => !gone.has(x.id)));
  assert.equal(removed.length, gone.size);
  const kept = [...theirs].filter((o) => !disposed.has(o)).map((o) => held.get(o));
  assert.equal(kept.length, 0, `buildings taken down left ${kept.length} resources on the GPU:\n  ${tally(kept)}`);
  page.lower(g);
});

test('the horizon and the islets give back what an island leaving took', () => {
  const scene = new THREE.Scene();
  const horizon = createHorizon({ scene, pickables: [] });
  const rows = [
    { id: 'aaaa0001', seed: 11, gridSize: 64, beacons: [[3, 4]] },
    { id: 'aaaa0002', seed: 12, gridSize: 64 },
  ];
  horizon.apply([]);
  const baseline = count(scene);
  const round = () => {
    horizon.apply(rows);
    const held = holdings(scene);
    watch(held);
    horizon.apply([]);
    assert.equal(count(scene), baseline, 'islands leaving the horizon left something standing');
    return held;
  };
  const heldA = round(), heldB = round();
  const kept = [...heldA].filter(([o]) => !heldB.has(o) && !disposed.has(o)).map(([, what]) => what);
  assert.equal(kept.length, 0, `the horizon kept ${kept.length} resources of islands that left:\n  ${tally(kept)}`);
  horizon.dispose();

  const islets = createIslets({ scene });
  const fleet = [{ id: 'bbbb0001', origin: [0, 0], half: 32, reach: 32 }];
  islets.apply(fleet, [0, 0]);
  const before = holdings(scene);
  assert.ok([...before.values()].some((w) => w.startsWith('geometry of islet ground')), 'no islet near the berth - the check below would prove nothing');
  watch(before);
  islets.apply(fleet, [900, 0]);
  const after = holdings(scene);
  const left = [...before].filter(([o]) => !after.has(o) && !disposed.has(o)).map(([, what]) => what);
  assert.equal(left.length, 0, `moving berth left ${left.length} islet resources behind:\n  ${tally(left)}`);
  islets.dispose();
});
