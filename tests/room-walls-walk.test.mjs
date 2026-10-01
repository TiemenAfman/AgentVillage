// The rooms' walls, rails and furniture walked by the real walk mode (web/js/walk.js), each room as
// interior.js makes it - its own createWalkMode with the room's surfaces and blockers - frame by frame:
// nobody walks out of a room but by its door, and in the Salty Kraken (web/js/pirate-tavern.js,
// web/js/kraken-layout.js) nobody walks off a storey where something is drawn to stop them, into a
// drawn wall, or jumps into a barrel and comes down inside it (the keeper: "of door muren/trappen
// heen indoor"). The stairs themselves are tests/pirate-stair-walk.test.mjs's and the stair work's;
// the harness is tests/diving-walk.test.mjs's.
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
const { createInterior, prepareRoom } = await import('../web/js/interior.js');
const K = await import('../web/js/kraken-layout.js');
const { PROPS, FOOT } = await import('../web/js/kraken-dressing.js');
await prepareRoom('piratetavern');

const FRAME = 1 / 60;
const { LEVEL } = K;

function room(name) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const material = new THREE.MeshBasicMaterial();
  material.userData.uniforms = { uNight: { value: 0 } };
  let left = false;
  const it = createInterior({
    room: name, camera: new THREE.PerspectiveCamera(60, 1, 0.05, 100), material,
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
    onLeave: () => { left = true; },
  });
  it.enter({});
  return { it, walk: it.walk, left: () => left };
}

// Stand somebody on a storey, feet down, as walk mode's own enter does on the ground.
function standAt(walk, x, z, y) {
  const s = walk.state;
  s.pos.set(x, y, z);
  s.floor = y;
  s.grounded = true;
  s.vy = 0;
}

// Walk `seconds` along `dir` (x, z; forward is (sin camYaw, cos camYaw)), jumping every half second
// when asked; the room's own update, so its door is a door. Returns every [x, z, y] stood at.
function walkFor(r, dir, seconds, { jump = false } = {}) {
  const s = r.walk.state;
  const out = [];
  key('w', true);
  for (let i = 0; i < seconds / FRAME && !r.left(); i++) {
    s.camYaw = Math.atan2(dir[0], dir[1]);
    if (jump && i % 30 === 0) { key(' ', true); }
    if (jump && i % 30 === 2) { key(' ', false); }
    r.it.update(FRAME);
    out.push([s.pos.x, s.pos.z, s.pos.y]);
  }
  key('w', false);
  key(' ', false);
  for (let i = 0; i < 20 && !r.left(); i++) { r.it.update(FRAME); out.push([s.pos.x, s.pos.z, s.pos.y]); }
  return out;
}

const DIRS = Array.from({ length: 24 }, (_, i) => [Math.sin(i * Math.PI / 12), Math.cos(i * Math.PI / 12)]);

test('out of the tavern and the castle only by the door, whichever way you walk', () => {
  for (const [name, half] of [['tavern', { x: 5.72, z: 2.62 }], ['rave', { x: 5.16, z: 4.16 }]]) {
    for (const dir of DIRS) {
      const r = room(name);
      const path = walkFor(r, dir, 14, { jump: true });
      for (const [x, z] of path) {
        const out = Math.abs(x) > half.x || z < -half.z - 0.01 || (z > half.z && !r.left());
        assert.ok(!out, `${name}: walking (${dir.map((v) => v.toFixed(2))}) got to ${x.toFixed(2)}, ${z.toFixed(2)}, through a wall`);
      }
    }
  }
});

test('the Kraken: nobody walks out through a wall, on any storey', () => {
  const starts = [
    [0, 6.1, LEVEL.ground, 'the door'], [0, 3.5, LEVEL.pit, 'the pit'], [0, -4.6, LEVEL.bar, 'the bar'],
    [7.8, -3.0, LEVEL.captain, "the captain's deck"], [-8.0, -3.0, LEVEL.captain, 'the west gallery'],
    [-8.2, 0, LEVEL.top, 'the west upper gallery'], [8.2, -1.0, LEVEL.top, 'the east upper gallery'],
    [-7.0, -8.0, LEVEL.ground, 'the cellar'], [7.5, -5.0, LEVEL.ground, 'the hold'],
  ];
  const { HALL, CELLAR } = K;
  const inRoom = (x, z) => [HALL, CELLAR].some((a) => x >= a.x0 - 0.01 && x <= a.x1 + 0.01 && z >= a.z0 - 0.01 && z <= a.z1 + 0.01);
  for (const [x0, z0, y0, where] of starts) {
    for (const dir of DIRS.filter((_, i) => i % 2 === 0)) {
      const r = room('piratetavern');
      standAt(r.walk, x0, z0, y0);
      for (const [x, z] of walkFor(r, dir, 10, { jump: true })) {
        if (r.left()) break;
        assert.ok(inRoom(x, z), `from ${where} walking (${dir.map((v) => v.toFixed(2))}) got to ${x.toFixed(2)}, ${z.toFixed(2)}, through a wall`);
      }
    }
  }
});

test("the bar's east edge is a wall where the captain's deck stands beside it, not a drop into the hold", () => {
  for (const z of [-6.2, -5.0, -3.35]) {
    const r = room('piratetavern');
    standAt(r.walk, 4.6, z, LEVEL.bar);
    const path = walkFor(r, [1, 0], 5);
    const low = Math.min(...path.map((p) => p[2]));
    const far = Math.max(...path.map((p) => p[0]));
    assert.ok(low > LEVEL.bar - 0.05, `walking east off the bar at z ${z} came down to ${low.toFixed(2)}`);
    assert.ok(far < K.FLOORS.find((f) => f.id === 'bar').x1, `and got to x ${far.toFixed(2)}, under the deck`);
  }
});

test('the west gallery ends at the north wall over the cellar arch, and the cellar is still through the arch', () => {
  const r = room('piratetavern');
  // Between the upper gallery's post at z -6.0 and the north wall, in the gap the arch left in its blocker.
  standAt(r.walk, -7.3, -6.4, LEVEL.captain);
  const path = walkFor(r, [0, -1], 6);
  assert.ok(Math.min(...path.map((p) => p[2])) > LEVEL.captain - 0.05, 'walked off the gallery into the cellar\'s mouth');
  assert.ok(Math.min(...path.map((p) => p[1])) > K.HALL.z0, 'and through the wall over the arch');
  // Down on the ground, the arch is the way into the cellar.
  const g = room('piratetavern');
  standAt(g.walk, (K.ARCH[0] + K.ARCH[1]) / 2, -6.55, LEVEL.ground);
  const into = walkFor(g, [0, -1], 5);
  assert.ok(Math.min(...into.map((p) => p[1])) < K.HALL.z0 - 0.8, 'no way into the cellar through its arch');
  // And nobody stands with a shoulder in the arch's jambs (shell.py cellar_arch(): their faces on ARCH).
  for (const [x, z] of into) {
    if (z < K.HALL.z0 + 0.1 && z > K.HALL.z0 - K.WALL - 0.1) assert.ok(x > K.ARCH[0] + 0.15 && x < K.ARCH[1] - 0.15, `in the arch at x ${x.toFixed(2)}`);
  }
});

test("round the crow's nest nobody stands on its round rail", () => {
  const { mast } = K.KIT;
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const r = room('piratetavern');
    standAt(r.walk, mast.x + dx * 0.3, mast.z + dz * 0.3, LEVEL.top);
    const path = walkFor(r, [dx, dz], 4);
    for (const [x, z, y] of path) {
      assert.ok(Math.abs(y - LEVEL.top) < 0.05, `fell out of the nest to ${y.toFixed(2)}`);
      assert.ok(Math.hypot(x - mast.x, z - mast.z) < mast.nestR - 0.14, `stood ${Math.hypot(x - mast.x, z - mast.z).toFixed(2)} from the mast, on the rail`);
    }
  }
});

test('the hearth is as wide as its jambs are drawn', () => {
  const { HEARTH } = K;
  // Up to the ends of its jambs from either side, past the woodpile and the shot (the only way in to
  // them): stopped a body's width off the stone.
  for (const side of [-1, 1]) {
    const r = room('piratetavern');
    standAt(r.walk, -8.42, HEARTH.z + side * 1.2, LEVEL.ground);
    const path = walkFor(r, [0, -side], 4);
    const nearest = Math.min(...path.map((p) => Math.abs(p[1] - HEARTH.z)));
    assert.ok(nearest > HEARTH.half + 0.12, `got to ${nearest.toFixed(2)} of the hearth's middle, its jambs reach ${HEARTH.half}`);
  }
});

test('a jump over a barrel or a table never comes down inside it', () => {
  // A table in the pit, and the barrels standing about the pit and the ground, jumped at from 0.6 off.
  const targets = [
    ...K.TABLES.slice(0, 2).map((t) => ({ cx: t.x, cz: t.z, x: t.x, z: t.z + 0.75, y: LEVEL.pit, dir: [0, -1], hx: 0.75, hz: 0.14 })),
    ...PROPS.filter((p) => p.kind === 'barrel' && (p.y === LEVEL.pit || p.y === LEVEL.ground)).slice(0, 4)
      .map((p) => ({ cx: p.x, cz: p.z, x: p.x + 0.6, z: p.z, y: p.y, dir: [-1, 0], r: FOOT.barrel.r * p.s })),
  ];
  for (const t of targets) {
    const r = room('piratetavern');
    standAt(r.walk, t.x, t.z, t.y);
    const { cx, cz } = t;
    for (const [x, z, y] of walkFor(r, t.dir, 3, { jump: true })) {
      if (y > t.y + 0.01) continue;
      const inside = t.r != null ? Math.hypot(x - cx, z - cz) < t.r : Math.abs(x - cx) < t.hx && Math.abs(z - cz) < t.hz;
      assert.ok(!inside, `came down inside what stands at ${cx.toFixed(2)}, ${cz.toFixed(2)}: at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  }
});

test.after(() => { console.warn = realWarn; });
