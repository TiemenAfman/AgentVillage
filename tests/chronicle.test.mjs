// The chronicle house, the ladder's last rung (Plans/kroniekhuis.md).
//
// What is held here:
//   the door      E is asked at the foot of the portico, on the side the layout's rot says the
//                 house faces (DOOR_DIR, the table the settlers' doorsteps come from), from the
//                 front and not from along the sides.
//   whose         only our own chronicle house opens the chronicle: a guest's, under its
//                 `guest:<region>:` id, is offered nothing, since the chronicle replays our
//                 village and nobody else's.
//   the model     one mesh within the civic budget, on its lot, no wider, deeper or taller than
//                 the town hall, the door cell clear, the walls wound outward (the island draws
//                 buildings front-face only), and lit after dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Ray, Vector3 } from 'three';
import { CHRONICLE } from '../web/js/chronicle-mesh.js';
import { TOWNHALL } from '../web/js/townhall-mesh.js';
import { LIBRARY } from '../web/js/library-mesh.js';
import { DOOR_DIR } from '../shared/settlerwalk.mjs';
import { opensChronicle, chronicleDoor, chronicleInteractable, isChronicle, STEP_OUT, REACH } from '../web/js/chronicle-house.js';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, WALK_BODY_R } = await import('../web/js/buildings.js');
const { SQUARE_BUILDINGS } = await import('../web/js/house-placement.js');
delete globalThis.document;

const spec = { id: 'civic:chronicle', kind: 'civic', civicType: 'chronicle', style: 'unknown', tier: 'civic', ornaments: [] };
const built = buildBuilding(spec);
// A record as main.js's makeRecord leaves it: the group where the pose put it, turned by its yaw.
const record = (over = {}) => ({
  id: spec.id, spec, built,
  group: { position: { x: 10, z: 20 }, rotation: { y: 0 }, visible: true },
  ...over,
});
// Where the house's solid ends at the front, which is as close as a walker's middle gets.
const frontOfSolid = Math.max(...built.solids.map((r) => r.z + r.hz));
const sideOfSolid = Math.max(...built.solids.map((r) => r.x + r.hx));

test('the chronicle is asked for at the door, the way the layout turns the house', () => {
  // housePlacement turns a lot by exactly this unless the building is one of the square's, whose
  // frontage it loosens - and the chronicle house is not, so its door is where its rot says.
  assert.ok(!SQUARE_BUILDINGS.has('chronicle'));
  const door = built.anchors.door;
  assert.ok(Math.abs(door[0]) < 1e-9, 'the door is on the middle of the front');
  for (let rot = 0; rot < 4; rot++) {
    const yaw = Math.PI - rot * Math.PI / 2;
    const [x, z] = chronicleDoor(record({ group: { position: { x: 10, z: 20 }, rotation: { y: yaw }, visible: true } }));
    const [dx, dz] = DOOR_DIR[rot];
    const out = door[2] + STEP_OUT;
    assert.ok(Math.abs(x - (10 + dx * out)) < 1e-9 && Math.abs(z - (20 + dz * out)) < 1e-9,
      `rot ${rot}: asked at ${x.toFixed(3)}, ${z.toFixed(3)}, not ${out} out of the ${DOOR_DIR[rot]} front`);
  }
});

test('from in front of the portico, and not from along the sides', () => {
  const it = chronicleInteractable(record());
  assert.equal(it.kind, 'chronicle');
  assert.equal(it.r, REACH);
  assert.ok(it.prompt, 'it says what E does');
  const from = (x, z) => Math.hypot(it.x - (10 + x), it.z - (20 + z));
  const stand = frontOfSolid + WALK_BODY_R;
  assert.ok(from(0, stand) < REACH, 'at the foot of the portico');
  assert.ok(from(0.4, stand + 0.3) < REACH, 'a pace to the side of it');
  assert.ok(from(sideOfSolid + WALK_BODY_R, -0.035) > REACH, 'by the middle of a side wall');
  assert.ok(from(0, -frontOfSolid - WALK_BODY_R) > REACH, 'behind it');
});

test('only our own chronicle house opens the chronicle', () => {
  assert.ok(opensChronicle(record()));
  assert.ok(isChronicle(spec));
  // A neighbour's, as web/js/guest-island.js names every record of theirs.
  const guest = record({ id: 'guest:4f2a9c01d3e5b678:civic:chronicle' });
  assert.equal(opensChronicle(guest), false);
  assert.equal(chronicleInteractable(guest), null);
  // One scrubbed out of sight, or not built yet.
  assert.equal(chronicleInteractable(record({ group: { position: { x: 0, z: 0 }, rotation: { y: 0 }, visible: false } })), null);
  // And nothing else.
  assert.equal(opensChronicle({ id: 'civic:townhall', spec: { kind: 'civic', civicType: 'townhall' } }), false);
  assert.equal(opensChronicle({ id: 'house:x', spec: { kind: 'house', civicType: 'chronicle' } }), false);
  assert.equal(opensChronicle(undefined), false);
});

// The box a baked set stands in, over the named parts (a part's triangles are around its `at`).
function boxOf(data, names = Object.keys(data.parts)) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const n of names) {
    const p = data.parts[n];
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i + k] + p.at[k];
        lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
      }
    }
  }
  return hi.map((v, k) => v - lo[k]);
}

test('the chronicle house is grand, but not bigger than the town hall', () => {
  const names = CHRONICLE.assets.civic_chronicle.parts;
  const tris = names.reduce((n, name) => n + CHRONICLE.parts[name].positions.length / 9, 0);
  assert.ok(tris <= 1500, `${tris} triangles is over the civic budget`);
  const [w, h, d] = boxOf(CHRONICLE, names);
  const [tw, th, td] = boxOf(TOWNHALL);
  assert.ok(w <= tw, `${w.toFixed(3)} across against the town hall's ${tw.toFixed(3)}`);
  assert.ok(d <= td, `${d.toFixed(3)} deep against the town hall's ${td.toFixed(3)}`);
  assert.ok(h <= th, `${h.toFixed(3)} tall against the town hall's ${th.toFixed(3)}`);
  // And more than a shop: taller than the library, the tallest of the street's.
  const [, lh] = boxOf(LIBRARY, LIBRARY.assets.civic_library.parts);
  assert.ok(h > lh, `${h.toFixed(3)} tall against the library's ${lh.toFixed(3)}`);
  console.log(`Chronicle house: ${tris} triangles, ${w.toFixed(2)} x ${d.toFixed(2)} x ${h.toFixed(2)}; town hall ${tw.toFixed(2)} x ${td.toFixed(2)} x ${th.toFixed(2)}`);
});

test('the chronicle house stands on its lot as one mesh and keeps its door cell clear', () => {
  assert.equal(built.geometry.groups.length, 0);
  assert.ok(built.bbox.max.x < 1.35 && built.bbox.min.x > -1.35, 'within the lot, porch and all');
  assert.ok(built.bbox.max.z < 1.35 && built.bbox.min.z > -1.35, 'within the lot, porch and all');
  assert.ok(built.bbox.max.y <= built.height + 1e-5, 'nameplates float above the sphere');
  // Where the path arrives and a settler stands: nothing solid there.
  for (const r of built.solids) assert.ok(Math.abs(r.x) > r.hx + WALK_BODY_R || Math.abs(1.12 - r.z) > r.hz + WALK_BODY_R);
  assert.ok(built.anchors.door[2] >= frontOfSolid - 1e-6, 'the door anchor is outside the house, not in it');
  assert.equal(built.anchors.smoke, undefined, 'an archive keeps its fire away from its paper');
  for (const key of ['normal', 'color', 'aEmissive', 'aSheet']) {
    assert.equal(built.geometry.attributes[key].count, built.geometry.attributes.position.count);
    assert.ok(built.geometry.attributes[key].array.every(Number.isFinite));
  }
  assert.ok(built.geometry.attributes.aEmissive.array.includes(1), 'its windows and its lantern are lit after dark');
});

test('the brick faces outward on every side', () => {
  // With back faces culled - which is how the island draws a building - a wall wound inside out
  // lets this ray straight through to nothing. Above the windows and between the columns, so
  // the first thing each one meets is the brick itself.
  const faces = [
    [new Vector3(0, 0.93, 3), new Vector3(0, 0, -1), (p) => p.z, 0.5],
    [new Vector3(0, 0.93, -3), new Vector3(0, 0, 1), (p) => p.z, -0.57],
    [new Vector3(3, 0.93, -0.035), new Vector3(-1, 0, 0), (p) => p.x, 0.86],
    [new Vector3(-3, 0.93, -0.035), new Vector3(1, 0, 0), (p) => p.x, -0.86],
  ];
  for (const [origin, dir, coord, wall] of faces) {
    const ray = new Ray(origin, dir);
    let best = null;
    for (const part of Object.values(CHRONICLE.parts)) {
      const at = new Vector3(...part.at);
      for (let i = 0; i < part.positions.length; i += 9) {
        const v = [0, 3, 6].map((j) => new Vector3().fromArray(part.positions, i + j).add(at));
        const hit = ray.intersectTriangle(v[0], v[1], v[2], true, new Vector3());
        if (hit && (!best || hit.distanceTo(origin) < best.distanceTo(origin))) best = hit;
      }
    }
    assert.ok(best, `nothing faces a ray from ${origin.toArray()}`);
    assert.ok(Math.abs(coord(best) - wall) < 1e-4, `from ${origin.toArray()} the first face out is at ${coord(best).toFixed(3)}, not the wall at ${wall}`);
  }
});
