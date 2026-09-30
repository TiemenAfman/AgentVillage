// The Salty Kraken's outside: the bake in assets/piratetavern (scripts/build-piratetavern.py,
// Plans/piratenkroeg.md) as web/js/buildings.js draws it. The same checks tests/tavern.test.mjs
// holds the tavern to, plus the one thing this building must never have: an anchor.flag, which
// main.js would hang the district's flag on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, WALK_BODY_R } = await import('../web/js/buildings.js');
const models = await import('../web/js/models.js');
delete globalThis.document;
const spec = { id: 'c:piratetavern', kind: 'civic', civicType: 'piratetavern', style: 'unknown' };

test('the Salty Kraken is one bounded geometry with every sheet and a night glow', () => {
  const b = buildBuilding(spec, { keepParts: true });
  const g = b.geometry, count = g.attributes.position.count;
  assert.equal(g.groups.length, 0);
  assert.ok(count / 3 < 4000, `a hero's budget (${count / 3} triangles)`);
  for (const name of ['normal', 'color', 'aSheet', 'aEmissive']) {
    assert.equal(g.attributes[name].count, count);
    assert.ok(g.attributes[name].array.every(Number.isFinite));
  }
  for (const sheet of [0, 1, 2, 3, 4]) assert.ok(g.attributes.aSheet.array.includes(sheet), `sheet ${sheet}`);
  assert.ok(g.attributes.aEmissive.array.includes(1), 'the windows glow at night');
  assert.ok(b.bbox.max.y <= b.height);
  for (const axis of ['x', 'z']) {
    assert.ok(Math.max(Math.abs(b.bbox.min[axis]), Math.abs(b.bbox.max[axis])) <= 1.35, `${axis} within the tavern's reach`);
  }
  g.dispose(); b.parts.forEach((p) => p.dispose());
});

test('it smokes from its chimney, has a door on the water side and flies no district flag', () => {
  const b = buildBuilding(spec, { keepParts: true });
  assert.ok(b.anchors.smoke, 'a chimney anchor');
  assert.ok(b.anchors.smoke[1] >= 1.9, 'the smoke leaves the chimney top');
  assert.ok(b.anchors.door, 'a door anchor');
  assert.ok(b.anchors.door[2] > 0.5, 'the door is on the +z face');
  assert.equal(b.anchors.flag, undefined, 'no anchor.flag: the Jolly Roger is baked');
  assert.equal(models.anchorsOf('piratetavern').flag, undefined);
  const door = b.parts.find((p) => /door recess/.test(p.userData.part?.args[0] || ''));
  assert.ok(door, 'the door recess is a part');
  door.computeBoundingBox();
  assert.ok(door.boundingBox.min.z > 0.45, 'the door stays on the water-facing +z side');
  b.geometry.dispose(); b.parts.forEach((p) => p.dispose());
});

test('the walk up to the door is clear of everything on the quay', () => {
  const b = buildBuilding(spec, {});
  for (const r of b.solids) {
    assert.ok(Math.abs(r.x) > r.hx + WALK_BODY_R || Math.abs(1.12 - r.z) > r.hz + WALK_BODY_R,
      `solid at ${r.x.toFixed(2)},${r.z.toFixed(2)} does not block the approach`);
  }
  // The barrels, crate and bollard are their own solids (APART), not one block with the walls.
  assert.ok(b.solids.length > 1);
  b.geometry.dispose();
});
