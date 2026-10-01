// The follow camera's boom (web/js/walk.js placeCamera, Plans/camera-botsing.md), driven frame by
// frame through the real walk mode - outside beside the buildings, inside the rooms, on the deck of
// the ship - and judged by a raycast from the eye to the camera against the building's own geometry:
// the keeper's "camera's die clippen en draaien". Before the boom, 6 to 17% of the views beside a
// building had the building between the camera and the eye, 37% in the Salty Kraken; the camera
// jumped 2.25 in one frame through the Kraken's cellar arch and 0.24 coming over the foot of its
// stair. The pure geometry (solids.js boxEntry / segmentEntry / camBodyEntry) is held to brute force
// first. The harness is tests/diving-walk.test.mjs's and tests/room-walls-walk.test.mjs's.
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
// No network: the captain's model (captain.js) is asked for on the first enter() and refused here.
globalThis.fetch = () => Promise.reject(new Error('no network in a test'));
const realWarn = console.warn;
console.warn = () => {};
const { boxEntry, segmentEntry, camBodyOf, camBodyEntry } = await import('../web/js/solids.js');
const { createWalkMode } = await import('../web/js/walk.js');
// Every test here but the last is about the boom, which is the choice now: the default is a fixed
// distance (camera-prefs.js, Settings -> On foot).
const { cameraFixed, setCameraFixed } = await import('../web/js/camera-prefs.js');
const fixedByDefault = cameraFixed();
setCameraFixed(false);
const { buildBuilding } = await import('../web/js/buildings.js');
const { createInterior, prepareRoom } = await import('../web/js/interior.js');
const { PLAYER_EYE } = await import('../web/js/avatar.js');
const { CRAFTS } = await import('../shared/crafts.mjs');
const { createSurface } = await import('../shared/hullwalk.mjs');
const { SHIPWALK } = await import('../web/js/shipwalk-map.js');
const { DECK_Y } = await import('../web/js/boat.js');
const K = await import('../web/js/kraken-layout.js');
await prepareRoom('piratetavern');
console.warn = realWarn;

const FRAME = 1 / 60;
const fresh = () => { handlers.keydown.length = 0; handlers.keyup.length = 0; };
const ray = new THREE.Raycaster();
// The distance along the eye-to-camera line to the first face of `meshes`, or null when it is clear.
function between(meshes, eye, cam) {
  const d = cam.clone().sub(eye);
  const len = d.length();
  if (len < 1e-3) return null;
  ray.set(eye, d.divideScalar(len));
  ray.near = 0.05; ray.far = len;
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? hits[0].distance : null;
}

// ---- the geometry ------------------------------------------------------------------------------

// A seeded stream, so a failure is the same failure every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
// Brute force: the first of 4000 points along the segment inside the shape grown by r.
function marched(inside, a, d, len) {
  let wasIn = inside(a[0], a[1], a[2]);
  if (wasIn) return -1;
  for (let i = 1; i <= 4000; i++) {
    const t = (len * i) / 4000;
    if (inside(a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t)) return t;
  }
  return null;
}
function unit() {
  return (r) => { const v = [r() - 0.5, r() - 0.5, r() - 0.5]; const l = Math.hypot(...v); return v.map((x) => x / l); };
}

test('boxEntry and segmentEntry find where a segment goes in, as stepping along it does', () => {
  const r = rng(7), dir = unit();
  const shapes = [
    { x: 0.3, z: -0.2, hx: 0.6, hz: 0.25, y0: 0, y1: 1.2 },
    { x: -0.1, z: 0.4, hx: 0.5, hz: 0.2, yaw: 0.7, y0: 0.3, y1: 0.9 },
    { x: 0.2, z: 0.1, r: 0.35, y0: -0.2, y1: 0.6 },
  ];
  const pad = 0.15;
  const insideOf = (b) => (x, y, z) => {
    if (y < b.y0 - pad || y > b.y1 + pad) return false;
    if (b.r) return Math.hypot(x - b.x, z - b.z) < b.r + pad;
    const c = Math.cos(b.yaw || 0), s = Math.sin(b.yaw || 0), dx = x - b.x, dz = z - b.z;
    return Math.abs(dx * c - dz * s) < b.hx + pad && Math.abs(dx * s + dz * c) < b.hz + pad;
  };
  for (const b of shapes) {
    for (let i = 0; i < 300; i++) {
      const a = [(r() - 0.5) * 4, (r() - 0.5) * 3, (r() - 0.5) * 4], d = dir(r), len = 4 * r();
      const want = marched(insideOf(b), a, d, len);
      const got = segmentEntry(b, a[0], a[1], a[2], d[0], d[1], d[2], len, pad);
      if (want === null || want === -1) {
        // A circle's box corners are not the circle: only a cylinder's own answers are compared.
        assert.equal(got, want, `${JSON.stringify(b)} from ${a} along ${d}`);
      } else {
        assert.ok(got != null && Math.abs(got - want) < len / 2000 + 1e-6, `${JSON.stringify(b)}: ${got} against ${want}`);
      }
    }
  }
  // and a box straight on: in at 1 - r, from a start outside; -1 from a start inside.
  assert.ok(Math.abs(boxEntry(1, 0, -1, 2, 1, 1, 0, 0.5, 0, 1, 0, 0, 5, 0.1) - 0.9) < 1e-9);
  assert.equal(boxEntry(1, 0, -1, 2, 1, 1, 1.5, 0.5, 0, 1, 0, 0, 5, 0.1), -1);
  assert.equal(boxEntry(1, 0, -1, 2, 1, 1, 0, 0.5, 0, -1, 0, 0, 5, 0.1), null);
});

test('a camera body is its boxes turned with it, and passes over a box its start is in', () => {
  // Two boxes in the body's own frame, the body turned a quarter: the box along its x lies along z.
  const boxes = new Float32Array([1, 0, -0.2, 2, 1, 0.2, -0.5, 0, -0.5, 0.5, 2, 0.5]);
  const body = camBodyOf(boxes, { x: 10, z: 5, y: 0.5, yaw: Math.PI / 2 });
  // Its x (sin yaw = 1) runs to world -z: the first box is at z 3..4 round x 10.
  const t = camBodyEntry(body, 10, 1, 8, 0, 0, -1, 10, 0);
  assert.ok(Math.abs(t - 2.5) < 1e-6, `into the middle box at ${t}`);
  // From inside the middle box, on to the far one.
  const u = camBodyEntry(body, 10, 1, 5, 0, 0, -1, 10, 0);
  assert.ok(Math.abs(u - 1) < 1e-6, `from inside the middle, the next box at ${u}`);
  // Lifted by its y: a segment under the boxes misses.
  assert.equal(camBodyEntry(body, 10, 0.3, 8, 0, 0, -1, 10, 0), null);
});

// ---- outside -------------------------------------------------------------------------------------

function island(built, at = [30, 30]) {
  fresh();
  const flat = () => 0.1;
  const sea = { height: flat, bedAt: flat, regionAt: () => null, levelKey: () => null };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera, terrain: { half: 64, size: 128, worldHeight: flat }, ground: sea,
    material: new THREE.MeshBasicMaterial(), dom, cameraBodies: () => [camBodyOf(built.camBoxes, { x: 0, z: 0 })],
  });
  walk.enter({ at, facing: [at[0], at[1] + 1], blockers: built.solids, interactables: [], onExit: noop });
  if (built.surfaces) walk.setSurfaces(built.surfaces);
  return { walk, camera };
}
function stand(walk, x, z, y) {
  const s = walk.state;
  s.pos.set(x, y, z); s.floor = y; s.grounded = true; s.vy = 0; s.swimming = false;
}

// Every spot within `out` of the building one can stand on, every `step`, each looked at from the
// turns and pitches given: how many have the building between the camera and the eye.
function views(built, { step = 0.4, out = 1.2, yaws = 12, pitches = [0.28, -0.4, 0.8] } = {}) {
  const mesh = new THREE.Mesh(built.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const { walk, camera } = island(built);
  const bb = built.bbox;
  let n = 0, hidden = 0;
  const worst = [];
  for (let x = bb.min.x - out; x <= bb.max.x + out; x += step) {
    for (let z = bb.min.z - out; z <= bb.max.z + out; z += step) {
      if (walk.blockedAt(x, z)) continue;
      for (let i = 0; i < yaws; i++) for (const pitch of pitches) {
        stand(walk, x, z, 0.1);
        walk.state.camYaw = (i * 2 * Math.PI) / yaws; walk.state.camPitch = pitch;
        walk.update(FRAME); walk.update(FRAME);
        n++;
        const eye = new THREE.Vector3(walk.state.pos.x, walk.state.pos.y + PLAYER_EYE, walk.state.pos.z);
        if (between([mesh], eye, camera.position) != null) { hidden++; if (worst.length < 3) worst.push([x.toFixed(1), z.toFixed(1), i, pitch]); }
      }
    }
  }
  return { n, hidden, worst };
}

for (const [name, spec, most] of [
  ['a house', { id: 'house:boom-1', kind: 'house', tier: 'house', style: 'claude', sheds: [] }, 0.005],
  ['a manor', { id: 'house:boom-2', kind: 'house', tier: 'manor', style: 'claude', sheds: [] }, 0.005],
  ['the town hall', { id: 'civic:townhall', kind: 'civic', civicType: 'townhall', style: 'unknown', tier: 'civic' }, 0.005],
  ['the tavern', { id: 'civic:tavern', kind: 'civic', civicType: 'tavern', style: 'unknown', tier: 'civic' }, 0.005],
]) {
  test(`beside ${name} the building is not between the camera and the eye`, () => {
    const { n, hidden, worst } = views(buildBuilding(spec, {}));
    assert.ok(n > 1000, `only ${n} views`);
    assert.ok(hidden / n <= most, `${hidden} of ${n} views look through ${name}, e.g. ${JSON.stringify(worst)}`);
  });
}

test('beside the Salty Kraken - its rock, its hull and its stair - neither', () => {
  const built = buildBuilding({ id: 'c:piratetavern', kind: 'civic', civicType: 'piratetavern', style: 'unknown' }, {});
  const { n, hidden, worst } = views(built, { step: 0.8, yaws: 8 });
  assert.ok(n > 800, `only ${n} views`);
  // 17% before the boom
  assert.ok(hidden / n <= 0.01, `${hidden} of ${n} views look through the Kraken, e.g. ${JSON.stringify(worst)}`);
});

// Turning the camera a degree a frame, the camera moves no more than the turn itself moves it, give
// or take `slack`: no floor to jump onto, and no boom that snaps in round a corner.
function sweep(walk, camera, slack) {
  const s = walk.state;
  // Settled where the sweep starts: from the yaw walk mode entered with, the first step was a
  // quarter turn measured as a degree.
  s.camYaw = 0;
  for (let i = 0; i < 5; i++) walk.update(FRAME);
  const prev = camera.position.clone();
  let worst = 0, at = null;
  for (let i = 0; i < 360; i++) {
    s.camYaw = (i * Math.PI) / 180;
    walk.update(FRAME);
    const turn = (Math.PI / 180) * Math.hypot(camera.position.x - s.pos.x, camera.position.z - s.pos.z);
    const jolt = camera.position.distanceTo(prev) - turn;
    if (jolt > worst) { worst = jolt; at = i; }
    prev.copy(camera.position);
  }
  assert.ok(worst <= slack, `the camera jumped ${worst.toFixed(2)} beyond the turn at ${at} degrees`);
}

test('looking round at the foot of the Kraken\'s stair, the camera does not jump onto the flight', () => {
  const built = buildBuilding({ id: 'c:piratetavern', kind: 'civic', civicType: 'piratetavern', style: 'unknown' }, {});
  for (const [x, z, y, pitch] of [[2.6, 3.0, 0.1, 0.28], [2.6, 3.0, 0.1, -0.4], [-0.9, 2.2, 1.6, -0.4], [2.45, 1.9, 3.21, -0.4]]) {
    const { walk, camera } = island(built, [x, z]);
    stand(walk, x, z, y);
    walk.state.camPitch = pitch;
    // 0.24 onto the flight and 0.78 round a corner before (2.16 beside a post a hand from the body,
    // once the buildings' boxes came in). What is left is the last step round a corner a few tenths
    // from the eye, where the boom is that short and the body already out of the way of the lens.
    // 0.50 since the boom looks past rails (solids.js camSeesPast): the flight's rails used to hold
    // it short before that corner (a post 0.23 from the eye, at -0.9, 2.2 up the stair, 229 degrees).
    sweep(walk, camera, 0.5);
  }
});

test('the boom lets out again gently once nothing is in its way', () => {
  const built = buildBuilding({ id: 'house:boom-1', kind: 'house', tier: 'house', style: 'claude', sheds: [] }, {});
  const { walk, camera } = island(built);
  // Beside the house with the camera on its far side: pulled in.
  const bb = built.bbox;
  stand(walk, bb.max.x + 0.3, 0, 0.1);
  walk.state.camYaw = Math.PI / 2;           // forward +x, so the camera trails at -x: in the house
  walk.state.camPitch = 0.1;
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  const eye = new THREE.Vector3(walk.state.pos.x, walk.state.pos.y + PLAYER_EYE, walk.state.pos.z);
  const short = camera.position.distanceTo(eye);
  assert.ok(short < 1.2, `the camera stayed ${short.toFixed(2)} back, in the house`);
  // Turned away from it, it comes back out over a fraction of a second, not in one frame.
  walk.state.camYaw = -Math.PI / 2;
  const steps = [];
  let last = short;
  for (let i = 0; i < 90; i++) {
    walk.update(FRAME);
    const d = camera.position.distanceTo(new THREE.Vector3(walk.state.pos.x, walk.state.pos.y + PLAYER_EYE, walk.state.pos.z));
    steps.push(d - last); last = d;
  }
  assert.ok(Math.max(...steps) < 0.2, `it let out ${Math.max(...steps).toFixed(2)} in one frame`);
  assert.ok(last > 2.5, `and got only ${last.toFixed(2)} back`);
});

// The keeper: "zodra er een klein voorwerp voor de karakter langskomt zoals een railing zoomt ie in" -
// and World of Warcraft's camera as the way it should be: a rail, a post or a crate between the camera
// and the body is looked past, and the body may be behind it for a moment. A wall still stops it.
test('a rail, a post or a crate behind the body leaves the camera where it is; a wall does not', () => {
  const camAt = (blockers, boxes) => {
    fresh();
    const flat = () => 0.1;
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 1000);
    const walk = createWalkMode({
      scene: new THREE.Scene(), camera, terrain: { half: 64, size: 128, worldHeight: flat },
      ground: { height: flat, bedAt: flat, regionAt: () => null, levelKey: () => null },
      material: new THREE.MeshBasicMaterial(),
      dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
      cameraBodies: () => (boxes ? [camBodyOf(new Float32Array(boxes), { x: 30, z: 29 })].filter(Boolean) : []),
    });
    walk.enter({ at: [30, 30], facing: [30, 31], blockers, interactables: [], onExit: noop });
    stand(walk, 30, 30, 0.1);
    walk.state.camYaw = 0; walk.state.camPitch = 0.1;          // the camera trails at -z, over z 29
    for (let i = 0; i < 10; i++) walk.update(FRAME);
    return Math.hypot(camera.position.x - 30, camera.position.z - 30);
  };
  const free = camAt([]);
  assert.ok(free > 2, `with nothing about the camera is only ${free.toFixed(2)} back`);
  // All of them across the boom at the eye's height, as the wall below is.
  const rail = { x: 30, z: 29, hx: 1, hz: 0.02, y0: 0.3, y1: 0.7 };
  for (const [what, blockers, boxes] of [
    ['a rail', [rail], null],
    ['a rail said to be one', [{ ...rail, y1: 2, rail: true }], null],
    ['a hamlet boundary', [{ x: 30, z: 29, hx: 1, hz: 0.05, hop: true }], null],
    ['a lamp post', [{ x: 30, z: 29, r: 0.05, y0: 0.1, y1: 1.2 }], null],
    ['a crate', [{ x: 30, z: 29, hx: 0.15, hz: 0.15, y0: 0.3, y1: 0.7, top: true }], null],
    ['a building\'s rail', [], [-1, 0.3, -0.02, 1, 0.7, 0.02]],
  ]) {
    const d = camAt(blockers, boxes);
    assert.ok(Math.abs(d - free) < 1e-6, `${what} pulled the camera in from ${free.toFixed(2)} to ${d.toFixed(2)}`);
  }
  const wall = camAt([], [-1, 0, -0.05, 1, 1.2, 0.05]);
  assert.ok(wall < 1.2, `a wall left the camera ${wall.toFixed(2)} back, behind it`);
  // and the rail's own band is across the boom: grown to a wall's height, it stops it
  const tall = camAt([{ ...rail, y0: 0, y1: 1.2 }]);
  assert.ok(tall < 1.2, `the rail's band is not across the boom (${tall.toFixed(2)} back)`);
});

// The keeper: "als de camera niet verder omlaag kan moet hij niet naar voren springen maar gewoon
// omhoog kunnen draaien". Mouse further and further down onto open ground: the camera, held up by
// the grass, stays where it is (on its sphere, at the ground's height) and never comes in towards the
// body, and the view keeps turning up with the mouse.
test('held up by the ground, the camera slides back rather than in, and the view turns up', () => {
  setCameraFixed(true);
  try {
    // One box far off: the harness wants a building, and this one is nowhere near the boom.
    const { walk, camera } = island({ solids: [], camBoxes: new Float32Array([100, 0, 100, 101, 1, 101]) });
    stand(walk, 30, 30, 0.1);
    walk.state.camYaw = 0;
    let lastH = 0, lastUp = 0, floored = 0;
    const look = new THREE.Vector3();
    for (let pitch = 0.4; pitch >= -1.1; pitch -= 0.02) {
      walk.state.camPitch = pitch;
      walk.update(FRAME);
      const h = Math.hypot(camera.position.x - 30, camera.position.z - 30);
      camera.getWorldDirection(look);
      // Until it reaches the ground it swings round its own circle, which comes in a little.
      const onGround = camera.position.y < 0.1 + 0.55 + 1e-4;    // camera-floor.js HAND over the grass
      if (onGround && floored > 0) {
        assert.ok(h >= lastH - 1e-6, `at pitch ${pitch.toFixed(2)} the camera came in from ${lastH.toFixed(2)} to ${h.toFixed(2)}`);
        assert.ok(look.y >= lastUp - 1e-6, `at pitch ${pitch.toFixed(2)} the view turned down`);
      }
      if (onGround) floored++;
      lastH = h; lastUp = look.y;
    }
    assert.ok(floored > 10, 'the camera never reached the ground: nothing measured');
    assert.ok(lastUp > 0.3, `looking all the way up the view is only ${lastUp.toFixed(2)} up`);
  } finally { setCameraFixed(false); }
});

test('by default the camera keeps its distance whatever is in the way', () => {
  assert.equal(fixedByDefault, true, 'a fixed distance is the default');
  const built = buildBuilding({ id: 'house:boom-1', kind: 'house', tier: 'house', style: 'claude', sheds: [] }, {});
  const at = (fixed) => {
    setCameraFixed(fixed);
    const { walk, camera } = island(built);
    stand(walk, built.bbox.max.x + 0.3, 0, 0.1);
    walk.state.camYaw = Math.PI / 2;           // forward +x, so the camera trails at -x: in the house
    walk.state.camPitch = 0.1;
    for (let i = 0; i < 10; i++) walk.update(FRAME);
    return { d: camera.position.distanceTo(new THREE.Vector3(walk.state.pos.x, walk.state.pos.y + PLAYER_EYE, walk.state.pos.z)), walk, camera };
  };
  try {
    const boomed = at(false).d;
    const { d, walk, camera } = at(true);
    assert.ok(boomed < 1.2 && d > 2.5, `with the boom ${boomed.toFixed(2)}, fixed ${d.toFixed(2)} back`);
    assert.equal(walk.avatar.children[0].visible, true, 'a fixed camera hid the body');
    assert.equal(camera.near, 0.5, 'a fixed camera moved the near plane');
  } finally { setCameraFixed(false); }
});

test('with the boom pulled in to the head the body goes, and the near plane comes in with it', () => {
  const built = buildBuilding({ id: 'house:boom-1', kind: 'house', tier: 'house', style: 'claude', sheds: [] }, {});
  const { walk, camera } = island(built);
  const bb = built.bbox;
  stand(walk, bb.max.x + 0.2, 0, 0.1);
  walk.state.camYaw = Math.PI / 2;
  walk.state.camPitch = -0.3;
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  assert.equal(walk.avatar.children[0].visible, false, 'the body is still drawn round the lens');
  assert.ok(camera.near < 0.5, `the near plane stayed at ${camera.near}`);
  walk.state.camYaw = -Math.PI / 2;
  for (let i = 0; i < 120; i++) walk.update(FRAME);
  assert.equal(walk.avatar.children[0].visible, true, 'the body did not come back');
  assert.equal(camera.near, 0.5, 'the near plane did not go back');
});

// ---- inside --------------------------------------------------------------------------------------

function room(name) {
  fresh();
  const material = new THREE.MeshBasicMaterial();
  material.userData.uniforms = { uNight: { value: 0 } };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
  let gone = false;
  const it = createInterior({
    room: name, camera, material,
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
    onLeave: () => { gone = true; },
  });
  it.enter({});
  const solid = [];
  const under = (o, root) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  it.scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || under(o, it.walk.avatar)) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m.transparent && m.blending === THREE.NormalBlending) solid.push(o);
  });
  return { it, walk: it.walk, camera, solid, gone: () => gone, again: () => { gone = false; it.enter({}); } };
}

test('in the Salty Kraken the galleries, posts and stairs are not between the camera and the eye', () => {
  const r = room('piratetavern');
  const { LEVEL } = K;
  const starts = [
    [0, 6.1, LEVEL.ground], [7.8, -3.0, LEVEL.captain], [-8.0, -3.0, LEVEL.captain],
    [-8.2, 0, LEVEL.top], [8.2, -1.0, LEVEL.top], [-7.0, -8.0, LEVEL.ground], [7.5, -5.0, LEVEL.ground],
  ];
  let n = 0, hidden = 0;
  for (const [x0, z0, y0] of starts) {
    for (let dx = -1.2; dx <= 1.2; dx += 0.8) for (let dz = -1.2; dz <= 1.2; dz += 0.8) {
      if (r.walk.blockedAt(x0 + dx, z0 + dz)) continue;
      for (let i = 0; i < 8; i++) for (const pitch of [0.28, -0.4]) {
        if (r.gone()) r.again();
        stand(r.walk, x0 + dx, z0 + dz, y0);
        r.walk.state.camYaw = (i * Math.PI) / 4; r.walk.state.camPitch = pitch;
        r.it.update(FRAME); r.it.update(FRAME);
        if (r.gone() || Math.abs(r.walk.state.pos.y - y0) > 0.3) continue;
        r.it.scene.updateMatrixWorld(true);
        n++;
        const eye = new THREE.Vector3(r.walk.state.pos.x, r.walk.state.pos.y + 0.3, r.walk.state.pos.z);
        if (between(r.solid.filter((o) => o.visible), eye, r.camera.position) != null) hidden++;
      }
    }
  }
  assert.ok(n > 300, `only ${n} views`);
  // 37% before the boom
  assert.ok(hidden / n <= 0.05, `${hidden} of ${n} views look through the room`);
});

test('through the Kraken\'s cellar arch the camera follows you through it, never jumps', () => {
  const r = room('piratetavern');
  const mid = (K.ARCH[0] + K.ARCH[1]) / 2;
  stand(r.walk, mid, -6.5, K.LEVEL.ground);
  r.walk.state.camPitch = 0.28;
  for (let i = 0; i < 10; i++) r.it.update(FRAME);
  const prev = r.camera.position.clone(), prevBody = r.walk.state.pos.clone();
  let worst = 0;
  key('w', true);
  for (let i = 0; i < 150; i++) {
    r.walk.state.camYaw = Math.PI;
    r.it.update(FRAME);
    worst = Math.max(worst, r.camera.position.distanceTo(prev) - r.walk.state.pos.distanceTo(prevBody));
    prev.copy(r.camera.position); prevBody.copy(r.walk.state.pos);
  }
  key('w', false);
  assert.ok(r.walk.state.pos.z < -7.3, `never got into the cellar: z ${r.walk.state.pos.z.toFixed(2)}`);
  assert.ok(worst < 0.3, `the camera jumped ${worst.toFixed(2)} more than the body moved`);
});

test('in first person in a room the eye is the eye, standing and crouching', () => {
  const r = room('tavern');
  stand(r.walk, 0, 1.5, 0.06);
  key('v', true); key('v', false);
  assert.equal(r.walk.state.firstPerson, true);
  r.walk.state.camPitch = 0;
  for (let i = 0; i < 5; i++) r.it.update(FRAME);
  const standing = r.camera.position.y;
  assert.ok(Math.abs(standing - (0.06 + PLAYER_EYE)) < 0.03, `standing, the eye is at ${standing.toFixed(3)}`);
  key('c', true);
  for (let i = 0; i < 30; i++) r.it.update(FRAME);
  const crouched = r.camera.position.y;
  key('c', false);
  assert.ok(crouched < standing - 0.05, `crouching the eye stayed at ${crouched.toFixed(3)}`);
});

test('looking round on the Kraken\'s upper gallery the lid comes off and stays off, it does not flicker', () => {
  const r = room('piratetavern');
  stand(r.walk, -8.2, 0, K.LEVEL.top);
  let toggles = 0, last = null;
  for (let i = 0; i < 720; i++) {
    r.walk.state.camYaw = (i * Math.PI) / 360;
    r.walk.state.camPitch = 0.3 + 0.5 * Math.sin(i / 40);
    r.it.update(FRAME);
    const lid = r.it.scene.children.filter((o) => o.isMesh).map((o) => o.visible).join();
    if (last != null && lid !== last) toggles++;
    last = lid;
  }
  // six before, on the one height both ways and against the ridge everywhere
  assert.ok(toggles <= 3, `the lid came off or on ${toggles} times in twelve seconds`);
});

// ---- on a ship -----------------------------------------------------------------------------------

test('on the ship\'s deck, looking up, the camera stays over her deck and out of her hull', () => {
  fresh();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 1000);
  const sea = () => -2.5;
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera, terrain: { worldHeight: sea, half: 32, size: 64 }, material: new THREE.MeshBasicMaterial(), dom,
    following: () => false, poseHull: null,
  });
  walk.enter({ at: [0, -40], blockers: [], interactables: [], onExit: noop, onBoarded: noop, onLeftDeck: noop });
  const surface = createSurface(SHIPWALK);
  const ship = { id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec: CRAFTS.galleon, object: null, walk: surface } };
  walk.board(ship);
  assert.ok(walk.leaveHelm(), 'could not step off the helm');
  let lowest = Infinity;
  for (let i = 0; i < 360; i += 10) {
    walk.state.camYaw = (i * Math.PI) / 180;
    walk.state.camPitch = -1.1;              // the mouse all the way up
    for (let k = 0; k < 20; k++) walk.update(FRAME);
    const deck = surface.floorIn(camera.position.x, camera.position.z, walk.state.deck.y + 0.8, 0);
    if (deck == null) continue;
    lowest = Math.min(lowest, camera.position.y - (DECK_Y + deck));
  }
  assert.ok(Number.isFinite(lowest), 'the camera was never over her deck');
  assert.ok(lowest > 0.1, `the camera went ${(-lowest).toFixed(2)} into her deck`);
});
