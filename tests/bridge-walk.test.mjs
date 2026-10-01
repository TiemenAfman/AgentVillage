// Bridges walked by the real walk mode (web/js/walk.js), frame by frame, with the keys, and held
// against the planks as they are DRAWN - a ray down onto the very geometry the island builds: the
// hand-built arch bridge and plank bridge (web/js/props.js deckShapesOf) and a crossing the layout
// laid (web/js/buildings.js bridgeDeckOf). Per cell an arch was a staircase whose treads stood up to
// 0.2 over the boards or under them (the keeper: "trappen waar je doorheen en in valt of in
// staat"); now the feet are on the boards, the rails hold, a swimmer goes under the arch and the
// stone either side of its opening is a wall to whoever is below the deck.
// The harness is tests/diving-walk.test.mjs's.
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
const { propGeometry, propLift, deckShapesOf, deckCellsOf, archDeckY } = await import('../web/js/props.js');
const { bridgeDeckOf, buildBridgeGeometry } = await import('../web/js/buildings.js');

const FRAME = 1 / 60;
const BANK = 0.1;
// A river along z, `half` wide either side of x = 0, its bed under the sea; dry bank beyond.
const river = (half) => (x) => (Math.abs(x) < half ? -0.6 : Math.abs(x) < half + 0.4 ? -0.6 + (Math.abs(x) - half) / 0.4 * (BANK + 0.6) : BANK);

// A grid of 32 whose cells are unit squares, for the layout's crossings (bridgeStops asks where a
// cell is, whether it is land, and how high the ground is).
function gridTerrain(h) {
  const size = 32, half = 16;
  const worldHeight = (x, z) => h(x, z);
  const cellWorld = (gx, gz) => [gx - half + 0.5, gz - half + 0.5];
  return { size, half, worldHeight, cellWorld, isLand: (gx, gz) => worldHeight(...cellWorld(gx, gz)) >= 0.06 };
}

function fresh(height, at, decks) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const h = (x, z) => height(x, z);
  const sea = { height: h, bedAt: h, regionAt: () => null, levelKey: () => null };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera, terrain: { half: 16, size: 32, worldHeight: h }, ground: sea,
    material: new THREE.MeshBasicMaterial(), dom,
  });
  walk.setDecks(decks);
  walk.enter({ at, facing: [at[0] + 1, at[1]], blockers: [], interactables: [], onExit: noop });
  for (let i = 0; i < 20; i++) walk.update(FRAME);
  return walk;
}

// Walk towards `to` until there or `seconds` pass, forward turned that way each frame; returns
// [x, z, y] for every frame.
function walkTo(walk, to, seconds = 40) {
  const s = walk.state;
  const out = [];
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) < 0.05) break;
    s.camYaw = Math.atan2(dx, dz);
    walk.update(FRAME);
    out.push([s.pos.x, s.pos.z, s.pos.y]);
  }
  key('w', false);
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  return out;
}

// The drawn top at (x, z): a ray straight down onto the mesh.
function drawnTop(mesh) {
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  return (x, z) => {
    ray.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(mesh)[0];
    return hit ? hit.point.y : null;
  };
}
function propMesh(spec, terrain) {
  const m = new THREE.Mesh(propGeometry(spec), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  m.position.set(spec.x, propLift(spec, terrain), spec.z);
  m.rotation.y = spec.rot || 0;
  m.scale.setScalar(spec.scale || 1);
  return m;
}

// The arch bridge over a river two and a half wide, turned onto x the way the live island's is,
// and once on the slant.
for (const rot of [Math.PI / 2, 0.45]) {
  test(`over the arch bridge (rot ${rot.toFixed(2)}): the feet are on the drawn planks all the way`, () => {
    const h = river(1.25);
    const s = Math.sin(rot), c = Math.cos(rot);
    const along = (t) => [s * t, c * t];               // the deck runs along the prop's turned z
    const height = (x, z) => h(x * s + z * c);          // the river runs across the deck
    const spec = { kind: 'archbridge', x: 0, z: 0, rot, length: 10 };
    const terrain = { worldHeight: height };
    const top = drawnTop(propMesh(spec, terrain));
    const walk = fresh(height, along(-6.5), deckShapesOf([spec], terrain));
    const path = walkTo(walk, along(6.5));
    let worst = 0, onDeck = 0;
    for (const [x, z, y] of path) {
      const t = x * s + z * c;
      if (Math.abs(t) > 4.8) continue;                // the ends, where the deck meets the bank
      const drawn = top(x, z);
      assert.ok(drawn != null, `no plank drawn at t ${t.toFixed(2)}`);
      worst = Math.max(worst, Math.abs(y - drawn));
      onDeck++;
      assert.ok(y > 0.1, `in the river at t ${t.toFixed(2)}: y ${y.toFixed(2)}`);
    }
    assert.ok(onDeck > 100, `crossed the deck (${onDeck} frames on it)`);
    assert.ok(worst < 0.02, `feet ${worst.toFixed(3)} off the drawn planks`);
    const end = walk.state.pos;
    assert.ok(end.x * s + end.z * c > 6, `reached the far bank: t ${(end.x * s + end.z * c).toFixed(2)}`);
  });
}

test('the old way, per cell, was a staircase through the planks (why the deck is a shape)', () => {
  // Held as the measurement behind the change: what deckCellsOf hands the settlers is up to a fifth
  // of a unit off the drawn arch within one cell - fine for a figure on a grid, not for feet.
  const spec = { kind: 'archbridge', x: 0.5, z: 0.5, rot: Math.PI / 2, length: 10 };
  const terrain = { half: 16, size: 32, worldHeight: () => BANK };
  const cells = deckCellsOf([spec], terrain);
  const lift = propLift(spec, terrain);
  let worst = 0;
  for (let x = -4.5; x <= 4.5; x += 0.05) {
    const gx = Math.round(x + 0.5 + 16 - 0.5), gz = 16;
    const y = cells.get(gx + gz * 32);
    if (y == null) continue;
    worst = Math.max(worst, Math.abs(y - (lift + archDeckY(spec, x))));
  }
  assert.ok(worst > 0.1, `per cell was only ${worst.toFixed(3)} off`);
});

test('the rails hold you on the crown, and you cannot step off the side into the river', () => {
  const height = (x) => river(1.25)(x);
  const spec = { kind: 'archbridge', x: 0, z: 0, rot: Math.PI / 2, length: 10 };
  const terrain = { worldHeight: height };
  const walk = fresh(height, [-6.5, 0], deckShapesOf([spec], terrain));
  walkTo(walk, [0, 0]);
  const crown = walk.state.pos.y;
  assert.ok(crown > 1.3, `on the crown: ${crown.toFixed(2)}`);
  walkTo(walk, [0, 3], 4);                             // straight at the rail, over the water
  assert.ok(walk.state.pos.z < 0.65, `held by the rail: z ${walk.state.pos.z.toFixed(2)}`);
  assert.ok(Math.abs(walk.state.pos.y - crown) < 0.05, `still on the deck: ${walk.state.pos.y.toFixed(2)}`);
  // And along it again, never stuck against the rail.
  const before = walk.state.pos.x;
  walkTo(walk, [3, walk.state.pos.z], 3);
  assert.ok(walk.state.pos.x > before + 0.5, `walked on along the rail: x ${walk.state.pos.x.toFixed(2)}`);
});

test('a swimmer goes under the arch, and the stone past its opening is a wall below the deck', () => {
  const height = (x) => river(1.25)(x);
  const spec = { kind: 'archbridge', x: 0, z: 0, rot: Math.PI / 2, length: 10 };
  const terrain = { worldHeight: height };
  // Down the river from one side of the bridge to the other, under the crown.
  const swim = fresh(height, [0, -3], deckShapesOf([spec], terrain));
  const path = walkTo(swim, [0, 3], 20);
  assert.ok(swim.state.pos.z > 2.5, `swam under: z ${swim.state.pos.z.toFixed(2)}`);
  for (const [, , y] of path) assert.ok(y < 0.1, `lifted onto the deck from the water: y ${y.toFixed(2)}`);
  // On the bank beside the bridge, where the abutment carries the deck a storey up: stopped at its side.
  const bank = fresh(height, [3, -2.5], deckShapesOf([spec], terrain));
  walkTo(bank, [3, 2.5], 10);
  assert.ok(bank.state.pos.z < -0.65, `walked into the abutment: z ${bank.state.pos.z.toFixed(2)}`);
  assert.ok(bank.state.pos.y < 0.2, `lifted onto the deck: y ${bank.state.pos.y.toFixed(2)}`);
});

test('over the plank bridge: on the drawn boards, and held by its handrails', () => {
  const height = (x) => river(1.25)(x);
  const spec = { kind: 'bridge', x: 0, z: 0, rot: Math.PI / 2, length: 6 };
  const terrain = { worldHeight: height };
  const top = drawnTop(propMesh(spec, terrain));
  const walk = fresh(height, [-4.5, 0], deckShapesOf([spec], terrain));
  const path = walkTo(walk, [4.5, 0]);
  let worst = 0;
  // The boards stand on the deck board with gaps between them: the highest within a board's width.
  const board = (x, z) => Math.max(...[-0.17, -0.08, 0, 0.08, 0.17].map((d) => top(x + d, z) ?? -Infinity));
  for (const [x, z, y] of path) if (Math.abs(x) < 2.8) worst = Math.max(worst, Math.abs(y - board(x, z)));
  assert.ok(worst < 0.02, `feet ${worst.toFixed(3)} off the drawn boards`);
  assert.ok(walk.state.pos.x > 4, 'crossed');
  const w2 = fresh(height, [-4.5, 0], deckShapesOf([spec], terrain));
  walkTo(w2, [0, 0]);
  walkTo(w2, [0, -3], 4);
  assert.ok(w2.state.pos.z > -0.72, `held by the handrail: z ${w2.state.pos.z.toFixed(2)}`);
  assert.ok(w2.state.pos.y > 0.3, `not in the river: ${w2.state.pos.y.toFixed(2)}`);
});

test('over a crossing the layout laid: on the drawn arch, not a staircase of cell heights', () => {
  // A river four cells wide along z at x 14..17, banks at BANK, the crossing along x.
  const h = (x) => (x > -2 && x < 2 ? -0.6 : BANK);
  const terrain = gridTerrain(h);
  const cells = [[14, 16], [15, 16], [16, 16], [17, 16]];
  const shape = bridgeDeckOf(cells, terrain, 'x');
  const [fx, fz] = terrain.cellWorld(...cells[0]);
  const mesh = new THREE.Mesh(buildBridgeGeometry(cells, terrain, [fx, fz], 'x'), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.set(fx, 0, fz);
  const top = drawnTop(mesh);
  const z = terrain.cellWorld(0, 16)[1];
  const walk = fresh(h, [-4.5, z], [shape]);
  const path = walkTo(walk, [4.5, z]);
  let worst = 0, over = 0;
  for (const [x, zz, y] of path) {
    if (Math.abs(x) > 2.0) continue;
    worst = Math.max(worst, Math.abs(y - top(x, zz)));
    over++;
  }
  assert.ok(over > 100, `crossed (${over} frames)`);
  assert.ok(worst < 0.02, `feet ${worst.toFixed(3)} off the drawn planks`);
  assert.ok(walk.state.pos.x > 4, 'reached the far bank');
});
