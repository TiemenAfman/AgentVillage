// The Salty Kraken inside (web/js/pirate-tavern.js, Plans/piratenkroeg.md): the room as data, and
// the crew show driven frame by frame under Node. What is held: every seat and every pirate is
// somewhere you can stand up from and walk to, the room has exactly the tavern's seven lamps (the
// count is in the building material's program key), the deck is whole cells, the crew sit on their
// seats and not in anything, the quest mark hangs over whoever the story is waiting on, and the
// nod keeps the shanty's time.
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
const { WALK_BODY_R } = await import('../web/js/buildings.js');
const { CREW } = await import('shared/quests.mjs');
const { SHANTY_SONG } = await import('../web/js/sound.js');
const { ROOM_KINDS } = await import('../web/js/interior.js');
delete globalThis.document;

const FLOOR = 0.06;
const rect = (x, z, hx, hz) => ({ x, z, hx, hz });
const inside = (b, x, z, pad) => (b.r
  ? Math.hypot(x - b.x, z - b.z) < b.r + pad
  : Math.abs(x - b.x) < b.hx + pad && Math.abs(z - b.z) < b.hz + pad);
const inAreas = (def, x, z) => def.areas.some((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1);
const material = () => { const m = new THREE.MeshBasicMaterial(); m.userData.uniforms = { uNight: { value: 0 } }; return m; };

test('it is the third room', () => {
  assert.deepEqual(ROOM_KINDS, ['tavern', 'rave', 'piratetavern']);
});

test('every seat is somewhere to sit down and stand up from', () => {
  stub();
  const def = buildPirateTavern({ FLOOR, rect });
  delete globalThis.document;
  const ids = def.seats.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'seat ids are unique');
  assert.ok(def.seats.length >= 15, `${def.seats.length} seats`);
  const show = createCrewShow({ scene: new THREE.Scene(), material: material(), layout: { FLOOR, DECK: FLOOR + 0.08, crew: [] } });
  for (const s of def.seats) {
    assert.ok(inAreas(def, s.x, s.z), `${s.id} is in the room`);
    for (const b of def.blockers) assert.ok(!inside(b, s.x, s.z, WALK_BODY_R), `${s.id} is inside a blocker at ${b.x},${b.z}`);
    for (const k of ['beer', 'snack']) assert.equal(s[k].length, 3, `${s.id} has somewhere to put the ${k}`);
  }
  show.dispose();
});

test('every pirate can be spoken to, and none sits in a wall', () => {
  stub();
  const def = buildPirateTavern({ FLOOR, rect });
  delete globalThis.document;
  assert.deepEqual(def.talkers.map((t) => t.who).sort(), CREW.map((c) => c.id).sort());
  for (const t of def.talkers) {
    assert.equal(t.kind, 'crew');
    assert.equal(t.id, `crew:${t.who}`);
    assert.ok(t.name && t.idle.length, `${t.who} has a name and something to say`);
    assert.ok(inAreas(def, t.x, t.z), `${t.who} is in the room`);
    for (const b of def.blockers) assert.ok(!inside(b, t.x, t.z, 0.1), `${t.who} is inside a blocker at ${b.x},${b.z}`);
  }
});

test('seven lamps, a deck of whole cells and a door wider than the gap', () => {
  stub();
  const def = buildPirateTavern({ FLOOR, rect });
  delete globalThis.document;
  assert.equal(def.lights.length, 7, 'the tavern\'s seven, so its program is reused');
  for (const k of ['x0', 'x1', 'z0', 'z1']) assert.ok(Number.isInteger(def.stage[k]), `stage.${k} is a cell edge`);
  assert.ok(def.doorway.hx > 0.42);
  assert.equal(def.music, 'shanty');
  assert.ok(!def.fog || def.fog[1] > def.fog[0]);
  // No glow broader than a hand but the niches' panels, at under INDOOR_GLOW's full mask.
  let broad = 0;
  for (const g of def.parts) {
    const e = g.attributes.aEmissive;
    if (!e || !e.array.some((v) => v > 0)) continue;
    g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    const face = Math.max(s.x * s.y, s.y * s.z, s.x * s.z);
    if (face > 0.05) { broad++; assert.ok(Math.max(...e.array) <= 0.65, `a glowing face of ${face.toFixed(3)} at ${Math.max(...e.array)}`); }
  }
  assert.ok(broad >= 3, 'the three niches glow');
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
  const torso = scene.children.find((m) => m.isInstancedMesh);
  assert.equal(torso.count, CREW.length, 'one body per pirate');
  const m4 = new THREE.Matrix4(), at = new THREE.Vector3();
  const blockers = def.blockers;
  for (let i = 0; i < torso.count; i++) {
    torso.getMatrixAt(i, m4);
    at.setFromMatrixPosition(m4);
    assert.ok(at.y < FLOOR + 0.12, `a body stands at ${at.y.toFixed(3)}`);
    for (const b of blockers) assert.ok(!inside(b, at.x, at.z, 0), `a body in a blocker at ${b.x},${b.z}`);
  }
  const mark = show.mark();
  assert.ok(mark && mark.sprite.visible, 'the mark is up');
  const cap = def.talkers.find((t) => t.who === 'captain');
  assert.ok(Math.hypot(mark.sprite.position.x - cap.x, mark.sprite.position.z - cap.z) < 1e-6, 'over the captain');
  assert.ok(mark.sprite.position.y < FLOOR + 1.9, 'under the ceiling');
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
  // The stand-in is drawn meanwhile.
  assert.ok(show.figures().find((f) => f.id === 'piratetavern:captain').visible);
  show.dispose();
});

test.after(() => { globalThis.fetch = realFetch; console.warn = realWarn; });
