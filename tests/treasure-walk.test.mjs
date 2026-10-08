// The hunt on the real thing: the real walk mode, the real drawing and a real hull, with the
// island's answers faked. tests/treasure-hunt.test.mjs plays the rules against a fake walker; this
// is what only the whole assembly can answer - that E at the X turns the body and starts the
// shovel, that the walk's dig ends in the hunt's callback with a hole where the X is, that sand flies
// and a heap grows and stays, that the statue comes up out of the ground and is lifted into the
// arms, and that on a boat she is the baked figure and not the placeholder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = {
  createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop,
  pointerLockElement: null, exitPointerLock: noop,
};
const handlers = { keydown: [], keyup: [] };
globalThis.addEventListener = (type, fn) => { if (handlers[type]) handlers[type].push(fn); };
globalThis.removeEventListener = noop;
const { createWalkMode } = await import('../web/js/walk.js');
const { createBoat, cargoMesh, DRAUGHT } = await import('../web/js/boat.js');
const { createClassicAvatar, carriedGeometry } = await import('../web/js/classic-avatar.js');
const { normalizeAvatar } = await import('../web/js/avatar.js');
const T = await import('../web/js/treasure.js');
const S = await import('../web/js/treasure-site.js');
const { createQuestLog } = await import('../web/js/quest-log.js');
const U = await import('../web/js/unlocks.js');
const { isletsNear } = await import('../shared/islets.mjs');
const { cardOf, FIRST_HUNT_SEED } = await import('../shared/treasure.mjs');
const { worldTime } = await import('../shared/worldclock.mjs');

const FRAME = 1 / 60;
const ISLAND = 'a';
const HOME = [336, 0];
const FLEET = [
  { id: '0000000000000000', origin: [0, 0], gridSize: 192, reach: 96, volcano: true },
  { id: ISLAND, origin: HOME, gridSize: 64, reach: 192 },
];
const ISLETS = isletsNear(FLEET, [0, 0], { range: 1500 });
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};

function assemble() {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  U.resetUnlocks();
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const sea = { height: () => 1, bedAt: () => 1, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: () => 1 };
  const toasts = [], posts = [];
  let hunt;
  const walk = createWalkMode({
    scene, camera: new THREE.PerspectiveCamera(60, 1, 0.5, 1000), terrain, ground: sea, material,
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
    onDigDone: (x, z, info) => hunt.onDigDone(x, z, info),
    onDigCancelled: (why) => hunt.onDigCancelled(why),
  });
  const log = createQuestLog({
    storage: memory(), unlock: U.unlock,
    cardFor: (name) => (name === 'first-hunt' ? cardOf(FIRST_HUNT_SEED(ISLAND), ISLAND, { candidates: ISLETS, berth: HOME }) : null),
    onChange: () => { if (hunt) hunt.refresh(); },
  });
  const events = { dug: (k) => log.onDug(k), lifted: (k) => log.onLifted(k), boarded: (k) => log.onBoarded(k), delivered: (k) => log.onDelivered(k) };
  const view = S.createTreasureView({ scene, material });
  hunt = T.createTreasureHunt({
    quests: log, events, finds: T.createFinds(memory()),
    unlocks: { isUnlocked: U.isUnlocked, unlocked: U.unlocked, unlock: U.unlock },
    walk, view, home: () => HOME, islandId: () => ISLAND, islets: () => ISLETS,
    village: () => ({ island: { landing: null, town: null }, buildings: [], treasure: { placed: false, found: 0 } }),
    terrain: () => ({ inGrid: () => true, isBeach: () => false, cellWorld: () => [0, 0] }),
    clock: () => worldTime(0, 0), dayOf: (ms) => worldTime(ms, 0).day,
    groundAt: (x, z) => walk.groundAt(x, z), keeper: () => true,
    read: async () => ({ statue: 'buried' }), post: async (a) => { posts.push(a); return { ok: true, statue: a === 'lifted' ? 'lifted' : 'buried' }; },
    toast: (h) => toasts.push(h), onChange: () => walk.setInteractables(hunt.interactables()),
    refetchVillage: async () => {},
  });
  log.applyEvent({ type: 'talked', with: 'pirate' });   // the shovel and the first map
  hunt.refresh();
  const site = hunt.sites()[0];
  walk.enter({ at: [site.x - 1.2, site.z], facing: [site.x, site.z], blockers: [], interactables: hunt.interactables(), onExit: noop });
  // What main.js does every frame, in its order: the walker, then the hunt.
  const run = (seconds) => { let peak = 0; for (let i = 0; i < Math.round(seconds / FRAME); i++) { walk.update(FRAME); hunt.frame(FRAME, i * FRAME); peak = Math.max(peak, view.grains()); } return peak; };
  return { walk, hunt, view, scene, material, toasts, posts, log, site, run };
}

test('E at the statue X: the body turns, the shovel goes in for 2.5 s and the statue comes up out of the sand', () => {
  const { walk, hunt, run } = assemble();
  run(0.2);
  const it = hunt.interactables().find((i) => i.kind === 'dig');
  assert.ok(it, 'the X is within reach of where the walker stands');
  hunt.interact(it);
  assert.equal(walk.digging(), true);
  assert.ok(Math.abs(walk.state.yaw - Math.PI / 2) < 1e-6, `faces the X (+x), not ${walk.state.yaw}`);
  run(1.25);
  assert.equal(walk.digging(), true, 'still going at half time');
  assert.ok(walk.digProgress() > 0.4 && walk.digProgress() < 0.6);
  assert.equal(hunt.sites()[0].stage, 'buried');
  run(1.4);
  assert.equal(walk.digging(), false, 'over');
  assert.equal(hunt.sites()[0].stage, 'unearthed', 'the hole was at the X, so the shovel found the statue');
  assert.ok(hunt.interactables().some((i) => i.kind === 'lift'));
});

test('sand flies with the strokes, the heap grows with the hole and outlives it', () => {
  const { walk, hunt, view, run } = assemble();
  run(0.1);
  hunt.interact(hunt.interactables().find((i) => i.kind === 'dig'));
  const heaps = () => view.group.children.filter((c) => c.isMesh && c.visible);   // the sites are groups
  assert.equal(heaps().length, 0);
  const peak = run(1.2);
  assert.ok(peak > 0, 'grains were in the air while the shovel worked');
  assert.equal(heaps().length, 1, 'a heap beside the hole');
  const halfway = heaps()[0].scale.y;
  run(1.5);
  assert.equal(walk.digging(), false);
  const done = heaps()[0].scale.y;
  assert.ok(done > halfway, `the heap grew: ${halfway.toFixed(2)} -> ${done.toFixed(2)}`);
  run(10);
  assert.equal(heaps().length, 1, 'and it is still there ten seconds after the last shovelful');
});

test('lifted out of the sand she is in the arms, and nothing is left on the ground to lift', () => {
  const { walk, hunt, run } = assemble();
  run(0.1);
  hunt.interact(hunt.interactables().find((i) => i.kind === 'dig'));
  run(3);
  const lift = hunt.interactables().find((i) => i.kind === 'lift');
  assert.ok(lift);
  hunt.interact(lift);
  assert.equal(walk.carrying(), 'statue');
  assert.equal(hunt.sites().length, 0, 'gone from the sand');
  assert.ok(hunt.interactables().every((i) => i.kind !== 'lift'));
});

test('the carried figure in the rig is the baked prop, centred on the hands', () => {
  const g = carriedGeometry();
  g.computeBoundingBox();
  const size = new THREE.Vector3();
  g.boundingBox.getSize(size);
  assert.ok(size.y > 0.18 && size.y < 0.26, `0.22 tall, not ${size.y}`);
  assert.ok(Math.abs(g.boundingBox.min.y + size.y / 2) < 0.02, 'centred on the origin, like the stand-in it replaced');
  assert.ok(g.attributes.aSheet, 'the material expects a sheet on everything it draws');
  const avatar = createClassicAvatar(normalizeAvatar({}), new THREE.MeshBasicMaterial());
  assert.equal(avatar.carried.name, 'carried');
  assert.ok(avatar.carried.children[0].geometry.attributes.position.count > 200, 'the baked 112 triangles, not a three-piece block');
});

test('on a boat she is the baked statue, sized for the rowing boat, and the hull gives her geometry back', () => {
  S.registerStatueCargo();
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const craft = createBoat({ scene, material });
  const mesh = cargoMesh('statue', material);
  assert.equal(mesh.userData.ownsGeometry, true);
  craft.setCargo(mesh);
  assert.equal(craft.cargo(), mesh);
  mesh.geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  mesh.geometry.boundingBox.getSize(size);
  assert.ok(size.y > 0.18 && size.y < 0.26 && size.x < 0.3, `the baked figure, ${size.x.toFixed(2)} x ${size.y.toFixed(2)}`);
  assert.ok(Math.abs(mesh.position.y - (0.085 - DRAUGHT)) < 1e-9, 'standing on the floorboards (shared/hull.mjs FLOORBOARDS)');
  assert.ok(mesh.position.z < 0, 'in the stern sheets, in front of the oarsman who faces aft');
  let disposed = 0;
  mesh.geometry.addEventListener('dispose', () => disposed++);
  craft.setCargo(null);
  assert.equal(disposed, 1, 'a geometry made for the boat is freed with the cargo');
});
