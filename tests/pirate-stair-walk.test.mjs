// The Salty Kraken's stair walked by the real walk mode (web/js/walk.js), frame by frame, with
// the building's own floors and solids (web/js/buildings.js pirateSurfaces / pirateSolids): up the
// lower flight, across the landing, up the upper flight to the door - and stopped by the rails,
// never dropped through the stair and never stuck beside it (the keeper, trying the first version:
// "karakter zit vast, loopt door railing heen", "valt naar beneden"). The harness is
// tests/diving-walk.test.mjs's.
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
const key = (k, down) => {
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};
const { createWalkMode } = await import('../web/js/walk.js');
const { buildBuilding } = await import('../web/js/buildings.js');

const FRAME = 1 / 60;
const made = buildBuilding({ id: 'c:piratetavern', kind: 'civic', civicType: 'piratetavern', style: 'unknown' }, {});
// Set down as the page sets it (web/js/pirate-ground.js): the foot of its stair - anchor.door, the
// landing's floor - at `at`, the rock's skirt below it. Its floors and solids lifted with it.
function standing(at) {
  const lift = at - made.anchors.door[1];
  const up = (o) => ({ ...o, ...(o.y != null ? { y: o.y + lift } : {}), ...(o.y0 != null ? { y0: o.y0 + lift } : {}), ...(o.y1 != null ? { y1: o.y1 + lift } : {}) });
  const lifted = (q) => ({ ...q, y: q.y + lift });
  return { surfaces: made.surfaces.map(up), solids: made.solids.map(up), climbs: made.climbs.map((l) => ({ ...l, lo: lifted(l.lo), hi: lifted(l.hi) })),
    anchors: { ...made.anchors, door: [made.anchors.door[0], at, made.anchors.door[2]] } };
}
// On the beach: the foot on the flat ground of `fresh` below.
const built = standing(0.1);
const S = Object.fromEntries(built.surfaces.map((s) => [s.name, s]));
const zmid = (s) => (s.z0 + s.z1) / 2;
const floorY = (name, x) => {
  const s = S[name];
  return s.y != null ? s.y : s.y0 + (s.y1 - s.y0) * (x - s.x0) / (s.x1 - s.x0);
};

// Flat dry ground round the building (a hand over 0, or walk mode reads it as the sea and places
// you on the nearest shore), the building standing where it was built (origin, unturned).
function fresh(at) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const flat = () => 0.1;
  const sea = { height: flat, bedAt: flat, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: flat };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain, ground: sea, material: new THREE.MeshBasicMaterial(), dom });
  walk.enter({ at, facing: [at[0] - 1, at[1]], blockers: built.solids, interactables: [], onExit: noop });
  walk.setSurfaces(built.surfaces);
  walk.setClimbs(built.climbs);
  return walk;
}

// Walk towards `to` (x, z) until there, or `seconds` pass; the camera turned so forward is that
// way (forward is (sin camYaw, cos camYaw)). Returns the heights it stood at on the way.
function walkTo(walk, to, seconds = 12, until = null) {
  const s = walk.state;
  const heights = [];
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) < 0.08 || (until && until(s))) break;
    s.camYaw = Math.atan2(dx, dz);
    walk.update(FRAME);
    heights.push([s.pos.x, s.pos.z, s.pos.y]);
  }
  key('w', false);
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  return heights;
}

test('up the stair to the door: lower flight, landing, upper flight, stoop', () => {
  const [fx, , fz] = built.anchors.door;
  const walk = fresh([fx, fz]);
  const s = walk.state;
  // the lower flight, west to the landing
  walkTo(walk, [S.land.x1 - 0.3, zmid(S.down)]);
  assert.ok(s.pos.x < S.land.x1, `reached the landing (x ${s.pos.x.toFixed(2)}, landing from ${S.land.x1.toFixed(2)})`);
  assert.ok(Math.abs(s.pos.y - S.land.y) < 0.12, `on the landing's floor: ${s.pos.y.toFixed(2)} for ${S.land.y.toFixed(2)}`);
  // across the landing to the upper flight's side, at its east end: the rope ladder up the hull hangs
  // onto its west end (issue #86), and walking into that is climbing it
  walkTo(walk, [S.land.x1 - 0.3, zmid(S.up)]);
  assert.ok(Math.abs(s.pos.z - zmid(S.up)) < 0.12, `crossed the landing (z ${s.pos.z.toFixed(2)})`);
  // up the upper flight to the stoop
  const path = walkTo(walk, [(S.stoop.x0 + S.stoop.x1) / 2, zmid(S.up)]);
  for (const [x, z, y] of path) {
    if (x > S.up.x0 + 0.2 && x < S.up.x1 - 0.2) assert.ok(y > floorY('up', x) - 0.15, `never dropped off the upper flight: ${y.toFixed(2)} at x ${x.toFixed(2)}`);
  }
  assert.ok(s.pos.x > S.stoop.x0, `reached the stoop (x ${s.pos.x.toFixed(2)})`);
  assert.ok(Math.abs(s.pos.y - S.stoop.y) < 0.12, `at the door's height: ${s.pos.y.toFixed(2)} for ${S.stoop.y.toFixed(2)}`);
});

test('the rail stops you on the flight; you do not walk through it or fall off', () => {
  const x = (S.down.x0 + S.down.x1) / 2;
  const walk = fresh([built.anchors.door[0], built.anchors.door[2]]);
  const s = walk.state;
  walkTo(walk, [x, zmid(S.down)]);
  const y = s.pos.y;
  assert.ok(Math.abs(y - floorY('down', s.pos.x)) < 0.12, `on the lower flight: ${y.toFixed(2)}`);
  walkTo(walk, [x, S.down.z1 + 1.5], 3);        // straight at the rail, towards the water
  assert.ok(s.pos.z < S.down.z1 + 0.05, `held by the rail (z ${s.pos.z.toFixed(2)}, edge ${S.down.z1.toFixed(2)})`);
  assert.ok(Math.abs(s.pos.y - floorY('down', s.pos.x)) < 0.15, `still on the flight: ${s.pos.y.toFixed(2)}`);
  // and from the upper flight, towards the lower one below it: held too
  const w2 = fresh([built.anchors.door[0], built.anchors.door[2]]);
  walkTo(w2, [S.land.x1 - 0.3, zmid(S.down)]);
  walkTo(w2, [S.land.x1 - 0.3, zmid(S.up)]);
  const ux = (S.up.x0 + S.up.x1) / 2;
  walkTo(w2, [ux, zmid(S.up)]);
  walkTo(w2, [ux, S.up.z1 + 1.0], 3);
  assert.ok(w2.state.pos.z < S.up.z1 + 0.05, `held by the upper rail (z ${w2.state.pos.z.toFixed(2)})`);
  assert.ok(w2.state.pos.y > floorY('up', w2.state.pos.x) - 0.15, `not fallen: ${w2.state.pos.y.toFixed(2)}`);
});

test('on the beach beside the stair you are never stuck', () => {
  // Just outside the lower flight's rail, at its high end: the place the first version trapped you.
  const x = S.land.x1 + 0.4;
  const walk = fresh([x, S.down.z1 + 0.3]);
  const s = walk.state;
  const start = [s.pos.x, s.pos.z];
  walkTo(walk, [x, S.down.z1 + 1.2], 2);        // away from the stair, towards the water
  assert.ok(s.pos.z > start[1] + 0.3, `walked away (z ${start[1].toFixed(2)} -> ${s.pos.z.toFixed(2)})`);
  walkTo(walk, [x + 1.2, s.pos.z], 2);          // and along it
  assert.ok(s.pos.x > x + 0.3, `walked along (x ${s.pos.x.toFixed(2)})`);
});

// In the sea (Plans/kraken-op-zee.md): water all round, the landing at a dock's deck height, and the
// gangway a floor from the shore to the lot's front edge, where the landing takes over. From the
// beach along the gangway, onto the landing, and up the stair to the door, never in the water.
test('from the beach along the gangway, onto the landing and up the stair', () => {
  const DECK = 0.44;
  const sea = standing(DECK);
  const T = Object.fromEntries(sea.surfaces.map((s) => [s.name, s]));
  const [fx, , fz] = sea.anchors.door;
  const gx = 2.0;                     // the gangway's middle: the cell under PUB_GATE's step
  const SHORE = 3.0 + 5;              // five cells of planks, then the beach
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const height = (x, z) => (z > SHORE ? 0.1 : -0.8);
  const ground = { height, bedAt: height, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: height };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain, ground, material: new THREE.MeshBasicMaterial(), dom });
  walk.enter({ at: [gx, SHORE + 1], facing: [gx, 0], blockers: sea.solids, interactables: [], onExit: noop });
  const plank = { name: 'gangway', x0: gx - 0.45, x1: gx + 0.45, z0: 2.7, z1: SHORE + 0.2, y: DECK };
  walk.setSurfaces([...sea.surfaces, plank]);
  walk.setClimbs(sea.climbs);
  const s = walk.state;
  const path = [
    ...walkTo(walk, [gx, 2.85]),
    // straight on from the planks onto the foot of the lower flight, where the gangway points
    ...walkTo(walk, [gx, zmid(T.down)]),
    ...walkTo(walk, [fx, fz]),
    ...walkTo(walk, [T.land.x1 - 0.3, zmid(T.down)]),
    ...walkTo(walk, [T.land.x1 - 0.3, zmid(T.up)]),
    ...walkTo(walk, [(T.stoop.x0 + T.stoop.x1) / 2, zmid(T.up)]),
  ];
  for (const [x, z, y] of path) if (z < SHORE) assert.ok(y > DECK - 0.1, `in the water at ${x.toFixed(2)},${z.toFixed(2)}: ${y.toFixed(2)}`);
  assert.ok(s.pos.x > T.stoop.x0, `reached the stoop (x ${s.pos.x.toFixed(2)})`);
  assert.ok(Math.abs(s.pos.y - T.stoop.y) < 0.12, `at the door's height: ${s.pos.y.toFixed(2)} for ${T.stoop.y.toFixed(2)}`);
});

// The deck (Plans/kraken-dek.md): from the zigzag's landing up the rope ladder on the hull (climbed, issue #86), over the plank
// onto the waist, round the hatch, the mast and the capstan to the step before the castle's door, up
// the ladder onto the castle's roof - and from the waist up the other onto the forecastle. In the sea,
// as the page stands it, and never dropped into the water or held short of a floor.
function seaWalk(at, y) {
  const DECK = 0.44;
  const sea = standing(DECK);
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const height = () => -0.8;
  const ground = { height, bedAt: height, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: height };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain, ground, material: new THREE.MeshBasicMaterial(), dom });
  const T = Object.fromEntries(sea.surfaces.map((f) => [f.name, f]));
  walk.setSurfaces(sea.surfaces);
  walk.setClimbs(sea.climbs);
  walk.enter({ at: at(T), y: y(T), facing: [0, 0], blockers: sea.solids, interactables: [], onExit: noop });
  return { walk, T, C: Object.fromEntries(sea.climbs.map((l) => [l.name, l])) };
}
const mid = (f, k) => (f[k + '0'] + f[k + '1']) / 2;
const topOf = (f) => (f.y != null ? f.y : Math.max(f.y0, f.y1));

test('up the ladder on the hull, onto the deck, to the castle door and up onto the roof', () => {
  const { walk, T, C } = seaWalk((T) => [T.land.x1 - 0.3, T.land.z1 - 0.2], (T) => T.land.y);
  const s = walk.state;
  const L = C.side, B = T.boarding, D = T['door-step'], R = T['roof-ladder'];
  // across the landing to in front of the rope ladder, then into it: a climb, never a ramp
  walkTo(walk, [L.lo.x, L.lo.z + 0.2]);
  const climbed = walkTo(walk, [L.hi.x, L.hi.z]);
  const mids = climbed.filter(([x, z, y]) => y > L.lo.y + 0.5 && y < L.hi.y - 0.5);
  assert.ok(mids.length > 10, 'went up the ropes');
  for (const [x, z] of mids) assert.ok(Math.abs(x - L.lo.x) < 0.01 && Math.abs(z - L.lo.z) < 0.01, `straight up the ropes, not along a slope: ${x.toFixed(2)},${z.toFixed(2)}`);
  assert.ok(Math.abs(s.pos.y - B.y) < 0.05, `up the ladder onto the plank: ${s.pos.y.toFixed(2)} for ${B.y.toFixed(2)}`);
  walkTo(walk, [mid(B, 'x'), B.z0 + 0.15]);
  assert.ok(s.pos.y > B.y - 0.45, `over onto the deck: ${s.pos.y.toFixed(2)} for ${B.y.toFixed(2)}`);
  const deckY = topOf(T['waist-b-c']);
  const path = [
    ...walkTo(walk, [mid(B, 'x'), 0.0]),
    ...walkTo(walk, [-1.2, 0.0]),
    ...walkTo(walk, [-0.6, 0.6]),
    ...walkTo(walk, [0.75, 0.6]),
    ...walkTo(walk, [0.75, -0.95]),
    ...walkTo(walk, [mid(D, 'x'), mid(D, 'z')]),
  ];
  for (const [x, z, y] of path) assert.ok(y > deckY - 0.3, `off the deck at ${x.toFixed(2)},${z.toFixed(2)}: ${y.toFixed(2)}`);
  assert.ok(Math.hypot(s.pos.x - mid(D, 'x'), s.pos.z - mid(D, 'z')) < 0.15, `at the castle door (${s.pos.x.toFixed(2)},${s.pos.z.toFixed(2)})`);
  walkTo(walk, [0.9, -0.95]);
  walkTo(walk, [0.9, mid(R, 'z')]);
  walkTo(walk, [R.x0 + 0.05, mid(R, 'z')]);
  walkTo(walk, [R.x1 - 0.05, mid(R, 'z')]);
  walkTo(walk, [R.x1 + 0.5, mid(R, 'z')]);
  const roof = topOf(T['roof-a-e']);
  assert.ok(Math.abs(s.pos.y - roof) < 0.1, `on the castle's roof: ${s.pos.y.toFixed(2)} for ${roof.toFixed(2)}`);
});

test('down the rope ladder from the plank, and letting go of it halfway, onto the landing', () => {
  const { walk, T, C } = seaWalk((T) => [mid(T.boarding, 'x') - 0.3, T.boarding.z0 + 0.2], (T) => T.boarding.y);
  const s = walk.state;
  const L = C.side;
  // out along the plank to its end, over the ropes: down them, not off the end
  const down = walkTo(walk, [L.lo.x, L.lo.z + 0.6], 10);
  const between = down.filter(([, , y]) => y > T.land.y + 0.3 && y < T.boarding.y - 0.3);
  assert.ok(between.length > 20, `climbed down, not dropped (${between.length} frames on the way)`);
  for (const [x, z] of between) assert.ok(Math.abs(x - L.lo.x) < 0.01 && Math.abs(z - L.lo.z) < 0.01, `on the ropes: ${x.toFixed(2)},${z.toFixed(2)}`);
  assert.ok(down.every(([, , y]) => y > T.land.y - 0.05), 'never fell');
  assert.ok(Math.abs(s.pos.y - T.land.y) < 0.05, `down on the landing: ${s.pos.y.toFixed(2)} for ${T.land.y.toFixed(2)}`);
  // up again a while, and jump: let go, and down onto the landing, not into the sea
  walkTo(walk, [L.hi.x, L.hi.z], 2.5);
  assert.ok(s.pos.y > T.land.y + 0.6, `half way up: ${s.pos.y.toFixed(2)}`);
  key(' ', true);
  walk.update(FRAME);
  key(' ', false);
  for (let i = 0; i < 120; i++) walk.update(FRAME);
  assert.ok(!s.swimming && Math.abs(s.pos.y - T.land.y) < 0.05, `let go onto the landing: ${s.pos.y.toFixed(2)} for ${T.land.y.toFixed(2)}`);
});

test('from the waist up onto the forecastle', () => {
  const { walk, T } = seaWalk((T) => [mid(T['waist-b-c'], 'x'), mid(T['waist-b-c'], 'z')], (T) => topOf(T['waist-b-c']));
  const s = walk.state;
  const F = T['fore-ladder'];
  walkTo(walk, [F.x1 + 0.05, mid(F, 'z')]);
  walkTo(walk, [F.x0 + 0.05, mid(F, 'z')]);
  walkTo(walk, [F.x0 - 0.5, mid(F, 'z')]);
  const top = topOf(T['fore-a-c']);
  assert.ok(Math.abs(s.pos.y - top) < 0.1, `on the forecastle: ${s.pos.y.toFixed(2)} for ${top.toFixed(2)}`);
});

// Off the boarding plank into shallow water (the keeper, issue #89: "val je van de bovenste steiger af,
// kom je vast te zitten in het water, kan niet wegzwemmen"): west off the plank where it crosses the
// bulwark, down into the rocks' and a kraken arm's boxes where they overlap, every step deeper into one
// of them. A swimmer gets out past the rock by swimming, at most turning round a few times. (The other
// trap, off the steep side ladder into the pocket between the rock and the low blocks under it, went
// with it: the rope ladder that replaced it hangs over the landing, issue #86.)
test('fallen off the boarding plank, you swim away from the rock', () => {
  const falls = [
    [(T) => [T.boarding.x0 + 0.25, 1.39], (T) => T.boarding.y, -Math.PI / 2],
  ];
  for (const bed of [-0.6, -0.9]) {
    for (const [at, y, dir] of falls) {
      const sea = standing(0.44);
      handlers.keydown.length = 0;
      handlers.keyup.length = 0;
      const height = () => bed;
      const ground = { height, bedAt: height, regionAt: () => null, levelKey: () => null };
      const terrain = { half: 64, size: 128, worldHeight: height };
      const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
      const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
      const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain, ground, material: new THREE.MeshBasicMaterial(), dom });
      const T = Object.fromEntries(sea.surfaces.map((f) => [f.name, f]));
      walk.setSurfaces(sea.surfaces);
      walk.enter({ at: at(T), y: y(T), facing: [0, 0], blockers: sea.solids, interactables: [], onExit: noop });
      const s = walk.state;
      const head = (a, seconds) => {
        key('w', true);
        for (let i = 0; i < seconds / FRAME; i++) { s.camYaw = a; walk.update(FRAME); }
        key('w', false);
        for (let i = 0; i < 30; i++) walk.update(FRAME);
      };
      head(dir, 1.5);
      for (let i = 0; i < 120; i++) walk.update(FRAME);
      assert.ok(s.swimming, `in the water (bed ${bed}, ${s.pos.x.toFixed(2)},${s.pos.z.toFixed(2)})`);
      const fell = [s.pos.x, s.pos.z];
      const out = () => Math.abs(s.pos.x) > 5.7 || Math.abs(s.pos.z) > 2.9;
      for (let e = 0; e < 16 && !out(); e++) head(e * Math.PI / 8, 3);
      assert.ok(out(), `swam away from ${fell.map((v) => v.toFixed(2))} (bed ${bed}): still at ${s.pos.x.toFixed(2)},${s.pos.z.toFixed(2)}`);
    }
  }
});
