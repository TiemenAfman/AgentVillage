// The Salty Kraken inside (web/js/pirate-tavern.js, web/js/kraken-layout.js, Plans/piratenkroeg.md):
// the room as data, and the crew show driven frame by frame under Node. What is held: every seat and
// every pirate can be walked to from the door - up the stairs, over the storeys - and stood up from,
// the room has exactly the tavern's seven lamps (the count is in the building material's program
// key), the crew sit on their seats and not in anything, the quest mark hangs over whoever the story
// is waiting on, and the nod keeps the shanty's time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader at import; quest-mark.js paints a canvas when it is made.
const ctx2d = new Proxy({}, { get: () => () => ({}) });
const stub = () => {
  globalThis.document = {
    createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
  };
};
stub();
// No network: the captain's model (captain.js) is asked for on the first enter() and refused here.
const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error('no network in a test'));
const realWarn = console.warn;
console.warn = () => {};
const { buildPirateTavern, createCrewShow } = await import('../web/js/pirate-tavern.js');
// The hall and its ship's parts are loaded on demand (models.js LAZY), as a visitor's page does at the door.
const { prepareRoom } = await import('../web/js/interior.js');
await prepareRoom('piratetavern');
const { WALK_BODY_R } = await import('../web/js/buildings.js');
const { CREW } = await import('shared/quests.mjs');
const { SHANTY_SONG } = await import('../web/js/sound.js');
const { ROOM_KINDS } = await import('../web/js/interior.js');
delete globalThis.document;

const FLOOR = 0.06;
const STEP_UP = 0.45;        // walk.js
const BODY_H = 0.45;         // walk.js atHeight
const rect = (x, z, hx, hz) => ({ x, z, hx, hz });
const inside = (b, x, z, pad) => (b.r
  ? Math.hypot(x - b.x, z - b.z) < b.r + pad
  : Math.abs(x - b.x) < b.hx + pad && Math.abs(z - b.z) < b.hz + pad);
const atHeight = (b, feet) => b.y0 == null || (feet < b.y1 && feet + BODY_H > b.y0);
const inAreas = (def, x, z) => def.areas.some((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1);
const material = () => { const m = new THREE.MeshBasicMaterial(); m.userData.uniforms = { uNight: { value: 0 } }; return m; };
const build = () => { stub(); const def = buildPirateTavern({ FLOOR, rect }); delete globalThis.document; return def; };

// The ground under x, z for feet at `from`: walk.js groundAt over a room's surfaces.
function groundAt(def, x, z, from) {
  let best = FLOOR;
  for (const s of def.surfaces) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    const y = s.y != null ? s.y : s.y0 + (s.y1 - s.y0) * (s.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0));
    if (y <= from + STEP_UP && y > best) best = y;
  }
  return best;
}
const blockedAt = (def, x, z, feet) => def.blockers.some((b) => inside(b, x, z, WALK_BODY_R) && atHeight(b, feet));

// Everywhere a body can get to from the door, by the rules walk mode walks by: a step of 5 cm at a
// time, onto whatever is within STEP_UP of the feet, down off any edge, never into a blocker that
// stands at the height of the feet. Each place is a [x, z, feet].
function walkable(def) {
  const STEP = 0.05;
  const seen = new Set(), out = [], queue = [[def.spawn.x, def.spawn.z, groundAt(def, def.spawn.x, def.spawn.z, Infinity)]];
  const key = (x, z, y) => `${Math.round(x / STEP)},${Math.round(z / STEP)},${Math.round(y * 50)}`;
  seen.add(key(...queue[0]));
  while (queue.length) {
    const [x, z, y] = queue.pop();
    out.push([x, z, y]);
    for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const nx = x + dx, nz = z + dz;
      if (!inAreas(def, nx, nz)) continue;
      const ny = groundAt(def, nx, nz, y);
      if (blockedAt(def, nx, nz, ny)) continue;
      const k = key(nx, nz, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([nx, nz, ny]);
    }
  }
  return out;
}

test('it is the third room', () => {
  assert.deepEqual(ROOM_KINDS.slice(0, 3), ['tavern', 'rave', 'piratetavern']);
});

test('every seat is somewhere to sit down and stand up from', () => {
  const def = build();
  const ids = def.seats.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'seat ids are unique');
  assert.ok(def.seats.length >= 15, `${def.seats.length} seats`);
  for (const s of def.seats) {
    assert.ok(inAreas(def, s.x, s.z), `${s.id} is in the room`);
    assert.ok(s.floor != null, `${s.id} says which storey it is on`);
    for (const b of def.blockers) assert.ok(!(inside(b, s.x, s.z, WALK_BODY_R) && atHeight(b, s.floor)), `${s.id} is inside a blocker at ${b.x},${b.z}`);
    for (const k of ['beer', 'snack']) assert.equal(s[k].length, 3, `${s.id} has somewhere to put the ${k}`);
  }
});

test('every pirate can be spoken to, and none sits in a wall', () => {
  const def = build();
  assert.deepEqual(def.talkers.map((t) => t.who).sort(), CREW.map((c) => c.id).sort());
  for (const t of def.talkers) {
    assert.equal(t.kind, 'crew');
    assert.equal(t.id, `crew:${t.who}`);
    assert.ok(t.name && t.idle.length, `${t.who} has a name and something to say`);
    assert.ok(inAreas(def, t.x, t.z), `${t.who} is in the room`);
    for (const b of def.blockers) assert.ok(!(inside(b, t.x, t.z, 0.1) && atHeight(b, t.floor)), `${t.who} is inside a blocker at ${b.x},${b.z}`);
  }
});

test('from the door, every seat and every pirate can be walked to - the captain upstairs too', () => {
  const def = build();
  const places = walkable(def);
  const reach = (x, z, floor, r) => places.some(([px, pz, py]) => Math.abs(py - floor) <= 0.5 && Math.hypot(px - x, pz - z) < r);
  for (const s of def.seats) assert.ok(reach(s.x, s.z, s.floor, s.r), `no way to ${s.id} (${s.x}, ${s.z}, floor ${s.floor})`);
  for (const t of def.talkers) assert.ok(reach(t.x, t.z, t.floor, t.r), `no way to ${t.who} (${t.x}, ${t.z}, floor ${t.floor})`);
  // And every storey is stood on somewhere.
  for (const f of def.surfaces.filter((s) => s.y != null)) {
    assert.ok(places.some(([x, z, y]) => Math.abs(y - f.y) < 1e-9 && x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1), `nobody gets onto ${f.id}`);
  }
});

test('seven lamps, and a door wider than the gap', () => {
  const def = build();
  assert.equal(def.lights.length, 7, 'the tavern\'s seven, so its program is reused');
  assert.ok(def.doorway.hx > 0.42);
  assert.equal(def.music, 'shanty');
  assert.ok(!def.fog || def.fog[1] > def.fog[0]);
  // No glow broader than a hand at more than INDOOR_GLOW's 0.65 of the mask.
  for (const g of [...def.parts, ...def.roof]) {
    const e = g.attributes.aEmissive;
    if (!e || !e.array.some((v) => v > 0)) continue;
    g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    const face = Math.max(s.x * s.y, s.y * s.z, s.x * s.z);
    if (face > 0.05) assert.ok(Math.max(...e.array) <= 0.65, `a glowing face of ${face.toFixed(3)} at ${Math.max(...e.array)}`);
  }
});

test('the crew sit on their seats, the mark hangs over whoever has business, and they keep time', () => {
  stub();
  const def = buildPirateTavern({ FLOOR, rect });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1, 2);
  const show = def.show({ scene, material: material(), camera });
  show.enter();
  show.update(1 / 60, { business: 'captain' }, { x: 0, y: FLOOR, z: 1.6 });
  // The bodies: the skinned crowd's skin per sex (the default since 0.11.0), or the old torso.
  const skins = scene.children.filter((m) => m.isInstancedMesh && /-skin$/.test(m.name));
  const bodies = skins.length ? skins : [scene.children.find((m) => m.isInstancedMesh)];
  assert.equal(bodies.reduce((n, m) => n + m.count, 0), CREW.length, 'one body per pirate');
  const m4 = new THREE.Matrix4(), at = new THREE.Vector3();
  const floors = def.talkers.map((t) => t.floor);
  // Where a body is placed is its feet, or for a sitter the feet the legs would have standing: the
  // skinned body's hips are higher than the old one's, so it is placed lower to put them on the seat.
  const below = skins.length ? 0.15 : 0.05;
  for (const body of bodies) {
    for (let i = 0; i < body.count; i++) {
      body.getMatrixAt(i, m4);
      at.setFromMatrixPosition(m4);
      assert.ok(floors.some((f) => at.y > f - below && at.y < f + 0.12), `a body stands at ${at.y.toFixed(3)}, on no pirate's floor`);
      for (const b of def.blockers) assert.ok(!(inside(b, at.x, at.z, 0) && atHeight(b, at.y)), `a body in a blocker at ${b.x},${b.z}`);
    }
  }
  const mark = show.mark();
  assert.ok(mark && mark.sprite.visible, 'the mark is up');
  const cap = def.talkers.find((t) => t.who === 'captain');
  assert.ok(Math.hypot(mark.sprite.position.x - cap.x, mark.sprite.position.z - cap.z) < 1e-6, 'over the captain');
  assert.ok(mark.sprite.position.y < FLOOR + def.ceiling, 'under the ceiling');
  show.update(1 / 60, { business: 'pirate' }, null);
  assert.equal(mark.sprite.visible, false, 'nobody in here has business when the pirate outside has');
  // The count runs with the frames without music, and follows the song's clock with it.
  const b0 = show.beat();
  for (let i = 0; i < 60; i++) show.update(1 / 60, {}, null);
  assert.ok(Math.abs(show.beat() - b0 - 1 / (60 / SHANTY_SONG.bpm)) < 0.05, 'a second is 100/60 counts');
  show.update(1 / 60, { clock: 1.2 }, null);
  assert.ok(Math.abs(show.beat() - 2) < 1e-9, 'the clock is the count');
  assert.equal(show.blockers().length, CREW.length);
  show.dispose();
  delete globalThis.document;
});

// The load itself - once, through modelUrl, said once when it fails - is tests/captain.test.mjs's.
test("the captain's stand-in is drawn until his model has arrived", () => {
  stub();
  const def = buildPirateTavern({ FLOOR, rect });
  const show = def.show({ scene: new THREE.Scene(), material: material(), camera: new THREE.PerspectiveCamera() });
  show.enter();
  delete globalThis.document;
  assert.ok(show.figures().find((f) => f.id === 'piratetavern:captain').visible);
  show.dispose();
});

test.after(() => { globalThis.fetch = realFetch; console.warn = realWarn; });
