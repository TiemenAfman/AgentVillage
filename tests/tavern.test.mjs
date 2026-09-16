import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, mesh, WALK_BODY_R } = await import('../web/js/buildings.js');
delete globalThis.document;
const spec = { id: 'c:tavern', kind: 'civic', civicType: 'tavern', style: 'unknown' };

test('Blender tavern uses one material geometry with sheets and night glow', () => {
  const b = buildBuilding(spec, { keepParts: true });
  const g = b.geometry, count = g.attributes.position.count;
  assert.equal(g.groups.length, 0);
  assert.ok(count / 3 < 4000, 'bounded geometry for modest GPUs');
  for (const name of ['normal', 'color', 'aSheet', 'aEmissive']) {
    assert.equal(g.attributes[name].count, count);
    assert.ok(g.attributes[name].array.every(Number.isFinite));
  }
  for (const sheet of [0,1,2,3,4]) assert.ok(g.attributes.aSheet.array.includes(sheet));
  assert.ok(g.attributes.aEmissive.array.includes(1));
  assert.ok(b.bbox.max.y <= b.height);
  for (const axis of ['x','z']) assert.ok(Math.max(Math.abs(b.bbox.min[axis]), Math.abs(b.bbox.max[axis])) <= 1.35);
  assert.ok(b.anchors.smoke[1] >= b.bbox.max.y);
  assert.ok(b.anchors.flag[1] > 1);
  const door = b.parts.find((p) => p.userData.part?.args[0] === 'Door recess');
  door.computeBoundingBox();
  assert.ok(door.boundingBox.min.z > .49, 'door remains on the street-facing +z side');
  assert.ok(Math.abs(door.boundingBox.min.y - .18) < 1e-5, 'door meets the porch');
  for (const r of b.solids) {
    assert.ok(Math.abs(r.x) > r.hx + WALK_BODY_R || Math.abs(1.12-r.z) > r.hz + WALK_BODY_R,
      'the approach in front of the door stays clear');
  }
  g.dispose(); b.parts.forEach((p) => p.dispose());
});

test('baked pieces retain workbench provenance and can be rebuilt after porch placement', () => {
  const b = buildBuilding(spec, { keepParts: true });
  for (const part of b.parts) {
    const rec = part.userData.part;
    if (rec?.fn !== 'mesh') continue;
    const rebuilt = mesh(...rec.args, rec.hex, rec.o);
    const a = part.attributes.position.array, c = rebuilt.attributes.position.array;
    assert.equal(a.length, c.length);
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i]-c[i]) < 1e-5);
    rebuilt.dispose();
  }
  console.log(`Tavern: ${b.geometry.attributes.position.count/3} tris (baseline 716), one building material`);
  b.geometry.dispose(); b.parts.forEach((p) => p.dispose());
});
