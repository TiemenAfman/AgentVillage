// The harbour's buildings (Plans/DONE/havengebouwen.md, scripts/build-harbourhouses.py): the warehouse,
// the weigh house and the fisherman's hut, three civic assets out of one set.
//
// Where they stand is lib/layout.mjs's business; what is asserted here is what that placement
// takes on trust from the bakes. Each gets a three by three lot, 1.5 from its middle to its edge,
// turned by quarters so that its front, +z, faces the water - so each has to fit inside that with
// the tavern's step it is stood on, keep its door on +z with a way up to it from the lot's front
// edge between the crates and the boat, glow after dark, and say its own height rather than the
// set's, which is the warehouse's gable for all three.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { HARBOURHOUSES } from '../web/js/harbourhouses-mesh.js';

register('./support/shared-loader.mjs', import.meta.url);
// buildings.js builds a TextureLoader as it loads.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, WALK_BODY_R, HARBOUR_HOUSES } = await import('../web/js/buildings.js');
delete globalThis.document;

const TYPES = ['warehouse', 'weighhouse', 'fishery'];
const HALF_LOT = 1.5;
const PORCH_RISE = 0.18;      // the step every civic stands on (buildings.js), which lifts it
const spec = (type) => ({ id: `civic:${type}`, kind: 'civic', civicType: type, style: 'unknown', plot: { w: 3, d: 3 } });

// The box one asset of the set fills, straight off the baked arrays.
function bakedBox(asset) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const name of HARBOURHOUSES.assets[asset].parts) {
    const part = HARBOURHOUSES.parts[name];
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = part.positions[i + k] + part.at[k];
        lo[k] = Math.min(lo[k], v);
        hi[k] = Math.max(hi[k], v);
      }
    }
  }
  return { lo, hi };
}

test('the three are drawn from the set, one asset each', () => {
  assert.deepEqual([...HARBOUR_HOUSES].sort(), [...TYPES].sort());
  assert.deepEqual(Object.keys(HARBOURHOUSES.assets).sort(), TYPES.map((t) => `civic_${t}`).sort());
});

for (const type of TYPES) {
  test(`the ${type} stands inside its three by three lot, step and all`, () => {
    const { lo, hi } = bakedBox(`civic_${type}`);
    for (const k of [0, 2]) assert.ok(Math.max(-lo[k], hi[k]) <= HALF_LOT, `the ${type}'s bake reaches ${Math.max(-lo[k], hi[k]).toFixed(3)}`);
    const b = buildBuilding(spec(type));
    for (const axis of ['x', 'z']) {
      const reach = Math.max(-b.bbox.min[axis], b.bbox.max[axis]);
      assert.ok(reach <= HALF_LOT, `on its step the ${type} reaches ${reach.toFixed(3)} along ${axis}`);
    }
    b.geometry.dispose();
  });

  test(`the ${type} is one geometry with its sheets, and glows after dark`, () => {
    const b = buildBuilding(spec(type));
    const g = b.geometry;
    assert.equal(g.groups.length, 0, 'one material, one draw call');
    for (const name of ['color', 'aSheet', 'aEmissive']) assert.equal(g.attributes[name].count, g.attributes.position.count);
    assert.ok(g.attributes.aEmissive.array.includes(1), `the ${type} has nothing lit`);
    for (const sheet of [0, 2, 3, 4]) assert.ok(g.attributes.aSheet.array.includes(sheet), `the ${type} has nothing on sheet ${sheet}`);
    g.dispose();
  });

  test(`the ${type} says its own height, not the set's`, () => {
    const b = buildBuilding(spec(type));
    const rise = bakedBox(`civic_${type}`).hi[1];
    assert.ok(Math.abs(b.height - (rise + PORCH_RISE)) < 1e-6, `the ${type} says ${b.height} for a rise of ${rise}`);
    assert.ok(b.bbox.max.y <= b.height + 1e-6);
    b.geometry.dispose();
  });

  test(`the ${type}'s door is on its front, and the way up to it is clear`, () => {
    const b = buildBuilding(spec(type));
    const door = b.anchors.door;
    assert.ok(door && door[2] > -0.5, `the ${type}'s door is not towards its front`);
    assert.ok(Math.abs(door[0]) < 0.05, `the ${type}'s door is not in the middle, where the path arrives`);
    // A walker comes up the middle of the lot from its front edge. Whatever it meets on the way
    // has to be the building itself - its front, a step, a stoop - within a hand of the door,
    // and never a crate, a barrel, a rack or the boat standing out in front of it.
    const inTheWay = b.solids.filter((r) => Math.abs(r.x) < r.hx + WALK_BODY_R && r.z - r.hz - WALK_BODY_R < HALF_LOT);
    assert.ok(inTheWay.length, `nothing of the ${type} stands in its own doorway`);
    for (const r of inTheWay) {
      assert.ok(r.z + r.hz <= door[2] + 0.15,
        `the ${type} has something ${(r.z + r.hz - door[2]).toFixed(2)} in front of its door, ${JSON.stringify(r)}`);
    }
    b.geometry.dispose();
  });
}

test('the warehouse is tall and narrow, the hut low, the weigh house between', () => {
  const rise = (t) => bakedBox(`civic_${t}`).hi[1];
  const width = (t) => { const { lo, hi } = bakedBox(`civic_${t}`); return hi[0] - lo[0]; };
  // Four storeys of a little over 0.6 and a spout gable: Plans/DONE/mijlpalen-tot-tweehonderd.md
  // asks for 3.5 to 4.
  assert.ok(rise('warehouse') >= 3.5 && rise('warehouse') <= 4, `the warehouse rises ${rise('warehouse')}`);
  assert.ok(rise('warehouse') > 2.4 * width('warehouse'), 'the warehouse is not narrow');
  assert.ok(rise('fishery') < 1.5, `the fisherman's hut rises ${rise('fishery')}`);
  assert.ok(rise('fishery') < rise('weighhouse') && rise('weighhouse') < rise('warehouse'));
});

test("the fisherman's smokehouse smokes above its own roof", () => {
  const b = buildBuilding(spec('fishery'));
  assert.ok(b.anchors.smoke, 'no anchor.smoke');
  assert.ok(Math.abs(b.anchors.smoke[1] - b.height) < 0.1, 'the smoke is not at the chimney pot');
  b.geometry.dispose();
});
