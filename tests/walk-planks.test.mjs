// Planks you can see are planks you can stand on. A walker used to drop off three of them
// ("je flikkert soms van kaders af"): a pier's ramp, whose shore cell is the beach, so the feet
// stood in the ramp and the step off the pier onto it went the whole 0.4 down at once; the wide
// head's wings, which reach 0.3 into the water cells either side, where the feet went through
// the boards into the sea; and the quay's finger jetties, drawn and never floored at all
// (Hoogezand: all five). They are walk mode's `surfaces` now (buildings.js pierSurfaces,
// quay-basin.js kadeSurfaces, handed over by main.js handOutDecks); held here both ways:
//   - over every point the drawn planks cover, what the walker stands on is those planks, not
//     the water under them (off the triangles the island really builds, as tests/docks.test.mjs
//     measures them);
//   - a real walk mode walked up a ramp, along a pier, out onto a wing and down a finger never
//     leaves the planks or drops more than a tread in a frame, and a swimmer under a finger
//     meets it as a lid;
//   - the quay's coping is stood on, not in, and the wall is a wall to a swimmer at its face
//     (walk.js blocked), who used to be put on the quay half a metre up in one frame.
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
const { buildPierGeometry, pierSurfaces, QUAY_DECK } = await import('../web/js/buildings.js');
const { buildQuayKade, kadeSurfaces } = await import('../web/js/quay-basin.js');
const { createQuayKade } = await import('../shared/quay-basin.mjs');
const { createWalkMode } = await import('../web/js/walk.js');

const FRAME = 1 / 60;
const SWIM_Y = -0.07;

// The drawn height over a point, off the triangles (tests/docks.test.mjs's deckAt).
const trianglesOf = (geometry, [ox, oz] = [0, 0]) => {
  const a = geometry.attributes.position.array;
  const out = [];
  for (let i = 0; i < a.length; i += 9) {
    out.push([[a[i] + ox, a[i + 1], a[i + 2] + oz], [a[i + 3] + ox, a[i + 4], a[i + 5] + oz], [a[i + 6] + ox, a[i + 7], a[i + 8] + oz]]);
  }
  return out;
};
function drawnAt(tris, x, z) {
  let y = -Infinity;
  for (const [a, b, c] of tris) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    y = Math.max(y, u * a[1] + v * b[1] + w * c[1]);
  }
  return y;
}
const surfaceY = (s, x, z) => {
  if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return null;
  if (s.y != null) return s.y;
  const t = s.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
  return s.y0 + (s.y1 - s.y0) * t;
};

// ---- a pier: a beach along z <= 5, water past it, a pier of five cells out along +z -----------
// The same coast tests/docks.test.mjs builds its piers on, given a height: the beach shelves from
// 0.2 down to just under the water at its seaward edge, and the sea is a metre deep.
const size = 32, mid = 16, shore = 5;
const coast = {
  size, half: size / 2,
  cellWorld: (gx, gz) => [gx - mid, gz - shore],
  isLand: (gx, gz) => gz <= shore,
  isWater: (gx, gz) => gz > shore,
  // In the walker's frame: cell (gx, gz) spans z from gz - shore - 0.5 to + 0.5.
  worldHeight: (x, z) => (z <= 0.5 ? Math.min(0.2, 0.02 - (z - 0.5) * 0.05) : -1),
};
const run = Array.from({ length: 5 }, (_, i) => [mid, shore + 1 + i]);
const from = [0, -3];
const pier = buildPierGeometry(run, coast, from);
const pierTris = trianglesOf(pier, from);
const pierPlanks = pierSurfaces(run, coast, from);
const pierCell = (x, z) => {
  const gx = Math.floor(x + mid + 0.5), gz = Math.floor(z + shore + 0.5);
  return run.some(([a, b]) => a === gx && b === gz);
};

test('over every board the pier draws, the feet stand on the boards', () => {
  assert.equal(pierPlanks.length, 2, 'the ramp and the head');
  let seen = 0, wings = 0, ramp = 0;
  // Off the cell edges, where a rectangle and a triangle may disagree about a hair's width.
  for (let z = -0.975; z <= 6; z += 0.05) {
    for (let x = -0.975; x <= 1; x += 0.05) {
      const top = drawnAt(pierTris, x, z);
      // Only the planks: a mooring post stands proud of them, and past the deck it is water.
      if (top === -Infinity || top > QUAY_DECK + 0.02) continue;
      seen++;
      let walked = pierCell(x, z) ? QUAY_DECK : coast.worldHeight(x, z);
      for (const s of pierPlanks) {
        const y = surfaceY(s, x, z);
        if (y != null && y > walked) walked = y;
      }
      assert.ok(walked >= top - 0.06, `at ${x.toFixed(2)}, ${z.toFixed(2)} the planks are at ${top.toFixed(2)} and the feet at ${walked.toFixed(2)}`);
      if (!pierCell(x, z) && z > 0.5) wings++;
      if (z < 0.5) ramp++;
    }
  }
  assert.ok(seen > 500 && wings > 50 && ramp > 50, `measured ${seen} points, ${wings} on the wings, ${ramp} on the ramp`);
});

// A real walk mode on that coast, with the floors main.js hands it: the pier's cells as levels,
// the ramp and the head as surfaces.
function walkOn({ height, levels = new Map(), levelKey, regionAt = () => null, surfaces, at, facing }) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const sea = { height, bedAt: height, regionAt, levelKey };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1, 0.5, 1000),
    terrain: { half: size / 2, size, worldHeight: height }, ground: sea,
    material: new THREE.MeshBasicMaterial(),
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
  });
  walk.setLevels(levels);
  walk.setSurfaces(surfaces);
  walk.enter({ at, facing, blockers: [], interactables: [], onExit: noop });
  return walk;
}
// Walk with `k` held for `seconds`, and say what the feet did: the largest drop in one frame,
// whether they were ever in the air, and the lowest they stood.
function stride(walk, k, seconds, until = () => false) {
  key(k, true);
  let drop = 0, airborne = false, lowest = Infinity, last = walk.state.pos.y;
  for (let i = 0; i < Math.round(seconds / FRAME) && !until(walk.state.pos); i++) {
    walk.update(FRAME);
    const y = walk.state.pos.y;
    drop = Math.max(drop, last - y);
    if (!walk.state.grounded) airborne = true;
    lowest = Math.min(lowest, y);
    last = y;
  }
  key(k, false);
  return { drop, airborne, lowest };
}

const pierKey = (x, z) => {
  const gx = Math.floor(x + mid + 0.5), gz = Math.floor(z + shore + 0.5);
  return gx >= 0 && gz >= 0 && gx < size && gz < size ? gx + gz * size : null;
};
const pierLevels = new Map(run.map(([gx, gz]) => [gx + gz * size, [QUAY_DECK]]));

test('a walker goes up the ramp, along the pier and out onto the head\'s wing without dropping off', () => {
  const walk = walkOn({
    height: coast.worldHeight, levels: pierLevels, levelKey: pierKey, surfaces: pierPlanks,
    at: [0, -1.5], facing: [0, 10],
  });
  // Up the beach and the ramp and out to the head.
  const out = stride(walk, 'w', 15, (p) => p.z >= 5);
  assert.ok(walk.state.pos.z >= 5, `stopped at z ${walk.state.pos.z.toFixed(2)}`);
  assert.equal(out.airborne, false, 'fell somewhere between the beach and the head');
  assert.ok(out.drop < 0.05, `dropped ${out.drop.toFixed(2)} in one frame`);
  assert.ok(Math.abs(walk.state.pos.y - QUAY_DECK) < 1e-9, `on the head at ${walk.state.pos.y}`);
  // Sideways onto the wing, which is over the water cell beside the head.
  const wing = stride(walk, 'a', 3, (p) => Math.abs(p.x) >= 0.7);
  assert.ok(Math.abs(walk.state.pos.x) >= 0.7, `only got to x ${walk.state.pos.x.toFixed(2)}`);
  assert.equal(walk.state.swimming, false, 'in the sea off the end of the wing');
  assert.equal(wing.airborne, false);
  assert.ok(Math.abs(walk.state.pos.y - QUAY_DECK) < 1e-9, `on the wing at ${walk.state.pos.y}`);
  // Back to the middle of the head - off the wing straight up the run is beside the pier, in the
  // sea - and along the pier and down the ramp onto the beach: followed, never a fall.
  stride(walk, 'd', 3, (p) => Math.abs(p.x) < 0.05);
  walk.state.camYaw = Math.PI;
  const back = stride(walk, 'w', 15, (p) => p.z <= -1);
  assert.ok(walk.state.pos.z <= -1, `stopped at z ${walk.state.pos.z.toFixed(2)}`);
  assert.equal(back.airborne, false, 'fell off the pier on the way back');
  assert.ok(back.drop < 0.05, `dropped ${back.drop.toFixed(2)} in one frame on the way down`);
});

// ---- the quay's finger jetties ------------------------------------------------------------------
// tests/quay-basin.test.mjs's quay: three wide along x 10..12, rows 2..29, land to the east, on a
// grid of 32 - and water to the west of it, so the fingers have somewhere to go.
const kt = { size: 32, half: 16, isWater: (gx) => gx < 9 };
const kadeCells = [];
for (let z = 2; z <= 29; z++) for (let x = 10; x <= 12; x++) kadeCells.push([x, z]);
const village = { works: { v: 1, kade: { cells: kadeCells, level: 113, back: [1, 0], hold: [] } }, districts: [], buildings: [], paths: [] };
const kade = createQuayKade(village, kt);
const level = 113 / 256;
const kadePlanks = kadeSurfaces(kade, kt);
// The coping's strips run along a foot cell (one cell long in z here); a finger's reaches out in x.
const fingerPlanks = kadePlanks.filter((p) => p.x1 - p.x0 > 1);
const copingPlanks = kadePlanks.filter((p) => p.x1 - p.x0 <= 1);
const kadeTris = trianglesOf(buildQuayKade(kade, kt).children[0].geometry);

test('over every plank of every finger jetty, the feet stand on the plank', () => {
  assert.ok(kade.fingers.length >= 2, `only ${kade.fingers.length} fingers`);
  assert.equal(fingerPlanks.length, kade.fingers.length, 'one floor a finger');
  assert.equal(copingPlanks.length, kade.foot.length, 'and the coping over every foot cell');
  let seen = 0;
  for (const fg of kade.fingers) {
    const xs = fg.cells.map(([gx]) => gx - kt.half);
    for (let x = Math.min(...xs) + 0.02; x < Math.max(...xs) + 1; x += 0.05) {
      for (let z = fg.along - kt.half; z < fg.along - kt.half + 1; z += 0.05) {
        const top = drawnAt(kadeTris, x, z);
        // The planks only: a pile ends under them and a mooring post stands over them.
        if (top < level || top > level + 0.02) continue;
        seen++;
        const walked = Math.max(...fingerPlanks.map((s) => surfaceY(s, x, z) ?? -Infinity));
        assert.ok(walked >= top - 0.02, `at ${x.toFixed(2)}, ${z.toFixed(2)} the plank is at ${top.toFixed(2)} and the feet at ${walked}`);
      }
    }
  }
  assert.ok(seen > 200, `measured only ${seen} points`);
});

const kadeGround = (x) => (x >= -7 ? level : -1);          // the quay from x 10 (local -6) back
const kadeRegion = { village, terrain: kt, toLocal: (x, z) => [x, z] };

test('a walker goes from the quay out along a finger to its end, and off it into the sea', () => {
  const fg = kade.fingers[0];
  const z = fg.along - kt.half + 0.5;
  const end = Math.min(...fg.cells.map(([gx]) => gx)) - kt.half;       // the finger's seaward edge
  const walk = walkOn({
    height: kadeGround, levelKey: () => null, regionAt: () => kadeRegion, surfaces: kadePlanks.map((s) => ({ ...s, lid: true })),
    at: [-4.5, z], facing: [-20, z],
  });
  const out = stride(walk, 'w', 15, (p) => p.x <= end + 0.2);
  assert.ok(walk.state.pos.x <= end + 0.2, `stopped at x ${walk.state.pos.x.toFixed(2)}`);
  assert.equal(out.airborne, false, 'fell off the quay or the finger');
  assert.equal(walk.state.swimming, false, 'swimming beside a finger drawn under the feet');
  assert.ok(out.lowest >= level - 1e-9, `stood as low as ${out.lowest}`);
  // And past its end is the harbour.
  stride(walk, 'w', 3);
  assert.equal(walk.state.swimming, true, 'walked on over open water');
});

test('a swimmer under a finger meets it as a lid, and does not climb out onto it', () => {
  const fg = kade.fingers[0];
  const z = fg.along - kt.half + 0.5;
  const x = fg.cells[1][0] - kt.half + 0.5;
  const walk = walkOn({
    // a cell past the finger's tip: two back is under its last plank, and walk mode puts a body
    // that starts there on the topmost floor it is under (enter, judged from groundAt)
    height: kadeGround, levelKey: () => null, regionAt: () => kadeRegion, surfaces: kadePlanks.map((s) => ({ ...s, lid: true })),
    at: [x - 3, z], facing: [x + 10, z],
  });
  for (let i = 0; i < 30; i++) walk.update(FRAME);
  assert.equal(walk.state.swimming, true, 'not in the water beside the finger');
  // Swim in under it: still swimming, still at the surface.
  stride(walk, 'w', 6, (p) => p.x >= x);
  assert.ok(walk.state.pos.x >= x - 0.05, `stopped at x ${walk.state.pos.x.toFixed(2)}`);
  assert.equal(walk.state.swimming, true, 'climbed onto the finger from under it');
  assert.ok(Math.abs(walk.state.pos.y - SWIM_Y) < 1e-9, `at ${walk.state.pos.y}`);
  // A jump there puts the head against the planks, not through them.
  key(' ', true);
  let highest = -Infinity;
  for (let i = 0; i < 60; i++) { walk.update(FRAME); highest = Math.max(highest, walk.state.pos.y); }
  key(' ', false);
  assert.ok(highest < level, `the head went up through the finger: feet at ${highest.toFixed(2)}`);
});

test('the coping along the top of the wall is stood on, not in', () => {
  let seen = 0;
  for (const f of kade.foot) {
    for (let x = f.gx - kt.half + 0.0125; x < f.gx - kt.half + 1; x += 0.025) {
      const z = f.gz - kt.half + 0.5;
      const top = drawnAt(kadeTris, x, z);
      if (top < level + 0.03) continue;                 // the coping, not the block's own top
      seen++;
      const walked = Math.max(level, ...copingPlanks.map((s) => surfaceY(s, x, z) ?? -Infinity));
      assert.ok(Math.abs(walked - top) < 0.005, `at ${x.toFixed(3)}, ${z} the coping is at ${top.toFixed(3)} and the feet at ${walked.toFixed(3)}`);
    }
  }
  assert.ok(seen >= kade.foot.length * 10, `measured only ${seen} points`);
});

test('a swimmer at the face of the wall stays in the water, and a walker on the quay walks off it', () => {
  // A row of the wall with no stair and no finger in front of it.
  const busy = new Set([...kade.stairs.flatMap((st) => st.cells.map((c) => c.gz)), ...kade.fingers.map((fg) => fg.along)]);
  const row = kade.foot.find((f) => f.gz > 3 && ![-1, 0, 1].some((d) => busy.has(f.gz + d)));
  const z = row.gz - kt.half + 0.5;
  const face = row.face - kt.half;                     // local x of the face: the water is west of it
  const swim = walkOn({
    height: kadeGround, levelKey: () => null, regionAt: () => kadeRegion, surfaces: kadePlanks.map((s) => ({ ...s, lid: true })),
    at: [face - 1.5, z], facing: [face + 10, z],
  });
  for (let i = 0; i < 20; i++) swim.update(FRAME);
  assert.equal(swim.state.swimming, true);
  stride(swim, 'w', 4);
  assert.ok(swim.state.pos.x < face, `swam into the wall to x ${swim.state.pos.x.toFixed(2)}`);
  assert.equal(swim.state.swimming, true, 'climbed the face without a stair');
  assert.ok(Math.abs(swim.state.pos.y - SWIM_Y) < 1e-9, `at ${swim.state.pos.y}`);
  // And the other way: a walker on the quay walks over the edge and comes down in the harbour.
  const walker = walkOn({
    height: kadeGround, levelKey: () => null, regionAt: () => kadeRegion, surfaces: kadePlanks.map((s) => ({ ...s, lid: true })),
    at: [face + 2, z], facing: [face - 10, z],
  });
  stride(walker, 'w', 8, (p) => p.x < face - 1);
  for (let i = 0; i < 60; i++) walker.update(FRAME);
  assert.ok(walker.state.pos.x < face, `did not get off the quay: x ${walker.state.pos.x.toFixed(2)}`);
  assert.equal(walker.state.swimming, true, 'not in the harbour after walking off the wall');
});
