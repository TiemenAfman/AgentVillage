// The islets as ground (Plans/starter-eilanden.md, "erbij", the second step): the archipelago
// answers for them between the islands, so feet, hulls and the water's depth all read the
// dome the page draws - and the camera keeps out from under the sea it is looking at.
//
// What is worth holding here rather than in a screenshot: that the bed the archipelago is
// handed is exactly isletHeight (or you stand on a different sand than you see), that it
// meets OPEN_SEA without a step deep enough to show in the shallows, that a boat which
// used to sail through an islet now grounds on it, and that the water is dense round every
// islet and only round it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// islets.js reaches world.js and buildings.js, which ask for their texture sheets on load - and
// createIslets makes the palms' materials, so the stub stays for the whole file.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const THREE = await import('three');
const { createIslets } = await import('../web/js/islets.js');
const { stepBoat, BOAT_FLOAT } = await import('../web/js/boat.js');
const { waterPatchPlan, WATER_TILE, WATER_REACH } = await import('../web/js/world.js');

const { createArchipelago, OPEN_SEA } = await import('../shared/regions.mjs');
const { isletHeight, isletBed, ISLET_FADE, ISLET_SPAN, ISLET_SHOAL_REACH, ISLET_WATER_STEP } = await import('../shared/islets.mjs');
const { cameraFloor, WATER_CAM_MIN } = await import('../web/js/camera-floor.js');

// The sea as tests/islets.test.mjs has it: the volcano and three starters, each holding its
// whole reach. Standing on the second, so its own berth is the scene's origin.
const FLEET = [
  { id: '0000000000000000', origin: [0, 0], gridSize: 192, reach: 96, volcano: true },
  { id: 'a', origin: [336, 0], gridSize: 64, reach: 192 },
  { id: 'b', origin: [0, -336], gridSize: 64, reach: 192 },
  { id: 'c', origin: [-336, -336], gridSize: 64, reach: 192 },
];
const HOME = [336, 0];

function raised() {
  const islets = createIslets({ scene: new THREE.Scene(), modest: true });
  islets.apply(FLEET, HOME);
  const sea = createArchipelago();
  sea.setSeabed(islets.seabed);
  return { islets, sea };
}

test('the sea answers with the islet between the islands, and with open water everywhere else', () => {
  const { islets, sea } = raised();
  const list = islets.list();
  assert.ok(list.length > 3, 'hardly any islets: ' + list.length);
  const squares = islets.seabed.squares();
  assert.equal(squares.length, list.length);
  list.forEach((islet, k) => {
    const [ox, oz] = squares[k].origin;
    assert.ok(sea.height(ox, oz) > 0.3, `${islet.id}: no ground in the middle`);
    assert.equal(sea.height(ox, oz), isletHeight(islet, 0, 0), `${islet.id}: not the height that is drawn`);
    // Everything up to ISLET_FADE is the ground itself - which is all the land there is.
    const at = Math.min(3, islet.r * ISLET_FADE * 0.9);
    assert.equal(sea.height(ox + at, oz - 2), isletHeight(islet, at, -2));
    assert.equal(sea.isWaterAt(ox + islet.r * ISLET_SPAN * 1.5, oz), true);
    assert.equal(sea.height(ox + islet.r * ISLET_SPAN * 1.5, oz), OPEN_SEA, `${islet.id}: open sea past its span`);
  });
});

test('an islet meets the open sea without a step in its shallows', () => {
  const { islets, sea } = raised();
  const squares = islets.seabed.squares();
  islets.list().forEach((islet, k) => {
    const [ox, oz] = squares[k].origin;
    const span = islet.r * ISLET_SPAN;
    // Round the whole rim - the box is square and the fade is round - the bed is the sea's
    // own depth where the box ends, and never lower than it anywhere.
    for (let a = 0; a < 16; a++) {
      const x = Math.cos((a * Math.PI) / 8), z = Math.sin((a * Math.PI) / 8);
      const inside = sea.height(ox + x * (span - 0.01), oz + z * (span - 0.01));
      assert.ok(Math.abs(inside - OPEN_SEA) < 0.02, `${islet.id}: ${inside.toFixed(3)} at the edge of its span (${a})`);
      for (let d = 0; d < span; d += 0.25) assert.ok(sea.height(ox + x * d, oz + z * d) >= OPEN_SEA);
    }
    // And under ISLET_FADE the bed is the drawn ground, over every point of the land.
    for (let d = 0; d <= islet.r * ISLET_FADE; d += 0.5) assert.equal(isletBed(islet, d, 0, OPEN_SEA), isletHeight(islet, d, 0));
  });
});

test('a bed may raise the open sea and never sink it, and an island keeps its own ground', () => {
  const sea = createArchipelago();
  assert.equal(sea.height(10, 10), OPEN_SEA);
  sea.setSeabed({ height: (x) => (x > 0 ? -9 : x < -50 ? null : 0.4), squares: () => [] });
  assert.equal(sea.height(10, 0), OPEN_SEA, 'a bed below OPEN_SEA sank the sea');
  assert.equal(sea.height(-10, 0), 0.4);
  assert.equal(sea.height(-100, 0), OPEN_SEA);
  assert.equal(sea.isWaterAt(-10, 0), false);
  sea.setSeabed(null);
  assert.equal(sea.height(-10, 0), OPEN_SEA);
  assert.deepEqual(sea.waterSquares(), []);
});

test('a boat that used to sail through an islet grounds on it', () => {
  const { islets, sea } = raised();
  // A round one, so the run at its middle is the run at its highest sand.
  const k = islets.list().findIndex((i) => i.kind !== 'sandbank');
  const islet = islets.list()[k];
  const [ox, oz] = islets.seabed.squares()[k].origin;
  const sail = (heightAt) => {
    // yaw pi/2 heads along +x. Started two spans out, in deep water, at full throttle.
    const b = { x: ox - islet.r * 2.5, z: oz, yaw: Math.PI / 2, v: 0 };
    for (let i = 0; i < 60 * 30; i++) stepBoat(b, { throttle: 1, turn: 0 }, 1 / 60, heightAt);
    return b;
  };
  const bare = sail(() => OPEN_SEA);
  assert.ok(bare.x > ox + islet.r, 'the control run should sail straight through: ' + bare.x);
  const b = sail((x, z) => sea.height(x, z));
  assert.ok(b.x < ox - islet.r * 0.2, `${islet.id}: the hull came to ${(b.x - ox).toFixed(1)} from the middle`);
  assert.ok(sea.height(b.x, b.z) < BOAT_FLOAT, 'the hull itself came aground');
});

test('the water is dense round every islet, and only round it', () => {
  const { islets, sea } = raised();
  const squares = sea.waterSquares();
  assert.equal(squares.length, islets.list().length);
  const regions = [{ origin: [0, 0], half: 32 }];
  const without = waterPatchPlan(32, regions, false);
  const withIslets = waterPatchPlan(32, [...regions, ...squares], false);
  assert.notEqual(withIslets.key, without.key, 'the plan does not know the islets are there');
  for (const s of squares) {
    const [x, z] = s.origin;
    assert.ok(withIslets.dense(x - 1, x + 1, z - 1, z + 1), 'no dense water at an islet');
    assert.equal(withIslets.waveAt(x, z), 1, 'no swell over the islet itself');
    const far = s.half + s.reach;
    assert.equal(withIslets.waveAt(x + far + 1, z), 0, 'the swell reaches past the dense tiles');
    assert.equal(s.reach, ISLET_SHOAL_REACH);
    assert.equal(s.step, ISLET_WATER_STEP);
  }
  // What they cost: a tile more on each side where the lattice does not line up, at most.
  let dense = 0;
  for (const q of withIslets.quads) if (q.dense) dense += 2 * q.segX * q.segZ;
  let bound = 0;
  for (const s of squares) { const side = 2 * (s.half + s.reach + WATER_TILE); bound += 2 * side * side; }
  let base = 0;
  for (const q of without.quads) if (q.dense) base += 2 * q.segX * q.segZ;
  const extra = withIslets.triangles - without.triangles;
  console.log(`islets: ${squares.length}, +${extra} triangles (${((100 * extra) / 2750000).toFixed(1)}% of a full page's 2.75M)`);
  assert.ok(dense - base <= bound, `${dense - base} dense triangles for the islets, more than ${bound}`);
  // At a vertex per unit they cost a tenth of a page (274k for these 59); on every second one
  // it is a quarter of that. The ceiling is what a page is asked to pay for its islets.
  assert.ok(extra <= 0.035 * 2750000, `the islets' water costs ${extra} triangles, over 3.5% of a page`);
  assert.ok(WATER_REACH > ISLET_SHOAL_REACH, 'an islet holds no more dense water than an island');
});

test('the camera keeps above the surface over open water, and only there', () => {
  // Over the sea bed: the surface plus the margin, never the bed plus a hand.
  assert.equal(cameraFloor({ ground: OPEN_SEA }), WATER_CAM_MIN);
  assert.equal(cameraFloor({ ground: -0.4 }), WATER_CAM_MIN);
  // Diving is the one place the camera belongs under the sea.
  assert.equal(cameraFloor({ ground: OPEN_SEA, diving: true }), OPEN_SEA + 0.55);
  // Over land, or over a deck (never below the water line), it is the ground's own.
  assert.equal(cameraFloor({ ground: 3 }), 3.55);
  assert.equal(cameraFloor({ ground: 0 }), 0.55);
  // The swell is a tenth, the near plane half a unit: the margin covers both.
  assert.ok(WATER_CAM_MIN >= 0.09 + 0.3 && WATER_CAM_MIN >= 0.5);
});
