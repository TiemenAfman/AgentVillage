// The Salty Kraken's outside: the bake in assets/piratetavern (scripts/build-piratetavern.py,
// Plans/piratenkroeg.md) as web/js/buildings.js draws it - a galleon aground on a rock, on an
// 11 x 6 lot, with a stair up the rock that is walked. The same checks tests/tavern.test.mjs holds
// the tavern to, plus the one thing this building must never have: an anchor.flag, which main.js
// would hang the district's flag on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, WALK_BODY_R } = await import('../web/js/buildings.js');
const models = await import('../web/js/models.js');
const { HERO_BUDGETS } = await import('../scripts/model-rules.mjs');
delete globalThis.document;
const spec = { id: 'c:piratetavern', kind: 'civic', civicType: 'piratetavern', style: 'unknown' };

// walk.js's own two rules, restated: how far up a foot takes a surface, and when a solid with a
// height is in a body's way.
const STEP_UP = 0.45, BODY_H = 0.45;
const atHeight = (b, feet) => b.y0 == null || (feet < b.y1 && feet + BODY_H > b.y0);
const blocks = (b, x, z, feet) => Math.abs(x - b.x) < b.hx + WALK_BODY_R && Math.abs(z - b.z) < b.hz + WALK_BODY_R && atHeight(b, feet);
function surfaceY(s, x, z) {
  if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return null;
  if (s.y != null) return s.y;
  return s.y0 + (s.y1 - s.y0) * (x - s.x0) / (s.x1 - s.x0);
}
function floorAt(surfaces, x, z, from) {
  let best = 0;                                  // the lot's ground
  for (const s of surfaces) {
    const y = surfaceY(s, x, z);
    if (y != null && y <= from + STEP_UP && y > best) best = y;
  }
  return best;
}

test('the Salty Kraken is one bounded geometry with every sheet and a night glow', () => {
  const b = buildBuilding(spec, { keepParts: true });
  const g = b.geometry, count = g.attributes.position.count;
  assert.equal(g.groups.length, 0);
  assert.ok(count / 3 <= HERO_BUDGETS.piratetavern, `its own hero budget (${count / 3} triangles)`);
  for (const name of ['normal', 'color', 'aSheet', 'aEmissive']) {
    assert.equal(g.attributes[name].count, count);
    assert.ok(g.attributes[name].array.every(Number.isFinite));
  }
  for (const sheet of [0, 1, 2, 3, 4]) assert.ok(g.attributes.aSheet.array.includes(sheet), `sheet ${sheet}`);
  assert.ok(g.attributes.aEmissive.array.includes(1), 'the windows glow at night');
  assert.ok(b.bbox.max.y <= b.height);
  // Its lot is 11 along the water and 6 deep: inside it, less a hand at every edge.
  for (const [axis, half] of [['x', 5.45], ['z', 2.9]]) {
    assert.ok(Math.max(Math.abs(b.bbox.min[axis]), Math.abs(b.bbox.max[axis])) <= half, `${axis} within its lot`);
  }
  g.dispose(); b.parts.forEach((p) => p.dispose());
});

test('it smokes from its chimney, has a door on the water side and flies no district flag', () => {
  const b = buildBuilding(spec, { keepParts: true });
  assert.ok(b.anchors.smoke, 'a chimney anchor');
  assert.ok(b.anchors.smoke[1] >= 1.9, 'the smoke leaves the chimney top');
  assert.ok(b.anchors.door, 'a door anchor');
  assert.ok(b.anchors.door[2] > 0.5, 'the stair comes down on the +z face');
  assert.equal(b.anchors.flag, undefined, 'no anchor.flag: the Jolly Roger is baked');
  assert.equal(models.anchorsOf('piratetavern').flag, undefined);
  // The swinging sign is a set of its own (piratesign) hung on this: on its own post at the foot
  // of the stair, its arm above a settler's head (0.45) with the board under.
  assert.ok(b.anchors.sign, 'a sign anchor');
  assert.ok(b.anchors.sign[1] > 0.9 && b.anchors.sign[2] > 0, 'high enough, on the water side');
  const [dx, , dz] = b.anchors.door;
  assert.ok(Math.hypot(b.anchors.sign[0] - dx, b.anchors.sign[2] - dz) < 0.6, 'by the foot of the stair');
  const door = b.parts.find((p) => /door recess/.test(p.userData.part?.args[0] || ''));
  assert.ok(door, 'the door recess is a part');
  door.computeBoundingBox();
  assert.ok(door.boundingBox.min.z > 0.45, 'the door stays on the water-facing +z side');
  b.geometry.dispose(); b.parts.forEach((p) => p.dispose());
});

test('the stair is walked from its foot to the door, over the rock and never through it', () => {
  const b = buildBuilding(spec, {});
  const S = Object.fromEntries(b.surfaces.map((s) => [s.name, s]));
  for (const name of ['down', 'land', 'up', 'stoop']) assert.ok(S[name], `a ${name} surface`);
  // The foot: on the ground, nothing solid on it, and the lower flight starts there at 0.
  const [fx, , fz] = b.anchors.door;
  for (const r of b.solids) assert.ok(!blocks(r, fx, fz, 0), `solid at ${r.x.toFixed(2)},${r.z.toFixed(2)} stands on the stair's foot`);
  // Walk it as walk.js would, in small steps: up the lower flight to the landing, across it, up
  // the upper flight to the stoop. Every step takes the floor within reach of the last one, and no
  // solid is in the way at that height.
  const zmid = (s) => (s.z0 + s.z1) / 2;
  const legs = [
    [[S.down.x1 - 0.05, zmid(S.down)], [S.down.x0 + 0.05, zmid(S.down)]],
    [[S.land.x0 + 0.3, zmid(S.down)], [S.land.x0 + 0.3, zmid(S.up)]],
    [[S.up.x0 + 0.05, zmid(S.up)], [S.up.x1 + 0.2, zmid(S.up)]],
  ];
  let feet = 0, x = fx, z = fz;
  for (const [[ax, az], [bx, bz]] of legs) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.05);
    for (let i = 0; i <= n; i++) {
      x = ax + (bx - ax) * i / n; z = az + (bz - az) * i / n;
      const y = floorAt(b.surfaces, x, z, feet);
      assert.ok(Math.abs(y - feet) < 0.1, `a step at ${x.toFixed(2)},${z.toFixed(2)} from ${feet.toFixed(2)} to ${y.toFixed(2)}`);
      feet = y;
      for (const r of b.solids) assert.ok(!blocks(r, x, z, feet), `solid at ${r.x.toFixed(2)},${r.z.toFixed(2)} blocks the stair at ${feet.toFixed(2)}`);
    }
  }
  assert.ok(Math.abs(feet - S.stoop.y) < 0.01, 'the walk ends on the stoop, at the door');
  // And nobody walks in under it: at the ground, the space under the landing is solid.
  const under = [(S.land.x0 + S.land.x1) / 2, (S.land.z0 + S.land.z1) / 2];
  assert.ok(b.solids.some((r) => blocks(r, under[0], under[1], 0)), 'under the landing is solid at the ground');
  b.geometry.dispose();
});

test('the treads are drawn where the stair is walked', () => {
  const b = buildBuilding(spec, { keepParts: true });
  const treads = b.parts.filter((p) => /stair (lower|upper) tread/.test(p.userData.part?.args[0] || ''));
  assert.ok(treads.length > 20, 'the flights have their treads');
  for (const t of treads) {
    t.computeBoundingBox();
    const bb = t.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const y = Math.max(...b.surfaces.map((s) => surfaceY(s, cx, cz) ?? -1));
    assert.ok(Math.abs(bb.max.y - y) < 0.06, `a tread at ${cx.toFixed(2)},${cz.toFixed(2)} tops at ${bb.max.y.toFixed(2)}, the floor there is ${y.toFixed(2)}`);
  }
  b.geometry.dispose(); b.parts.forEach((p) => p.dispose());
});
