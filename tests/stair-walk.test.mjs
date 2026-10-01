// Stairs walked by the real walk mode (web/js/walk.js), frame by frame, with the keys: the Salty
// Kraken's stairs inside (web/js/kraken-layout.js STAIRS, stood on tread by tread as
// scripts/krakenroom/shell.py draws them) and the flights down the harbour's stone quay
// (shared/quay-basin.mjs). The feet on the treads as drawn, never half a riser into one; up a flight
// out of the water without being dropped back into it; and the camera up a flight at an even pace
// while the feet take it a riser at a time. The harness is tests/diving-walk.test.mjs's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
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
const { createWalkMode } = await import('../web/js/walk.js');
const K = await import('../web/js/kraken-layout.js');
const { treadsOf, buildPirateTavern } = await import('../web/js/pirate-tavern.js');
const { prepareRoom } = await import('../web/js/interior.js');
globalThis.fetch = () => Promise.reject(new Error('no network in a test'));
await prepareRoom('piratetavern');
const { quayKade, STAIR_LEN } = await import('../shared/quay-basin.mjs');

const FRAME = 1 / 60;

function fresh({ height, at, surfaces = [], region = null }) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const sea = { height, bedAt: height, regionAt: () => region, levelKey: () => null };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera, terrain: { half: 16, size: 32, worldHeight: height }, ground: sea,
    material: new THREE.MeshBasicMaterial(), dom,
  });
  walk.setSurfaces(surfaces);
  walk.enter({ at, facing: [at[0] + 1, at[1]], blockers: [], interactables: [], onExit: noop });
  for (let i = 0; i < 20; i++) walk.update(FRAME);
  return { walk, camera };
}

// Walk towards `to` until there or `seconds` pass; [x, z, y, cameraY] every frame.
function walkTo({ walk, camera }, to, seconds = 30) {
  const s = walk.state;
  const out = [];
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) < 0.04) break;
    s.camYaw = Math.atan2(dx, dz);
    walk.update(FRAME);
    out.push([s.pos.x, s.pos.z, s.pos.y, camera.position.y, camera.position.x, camera.position.z]);
  }
  key('w', false);
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  return out;
}

// The tread top the bake draws under (x, z) of stair `s`: n treads from its low end, each with its
// top on the slope at its own middle (scripts/krakenroom/shell.py stair()).
function treadTop(s, x, z) {
  const t = s.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
  const lo = Math.min(s.y0, s.y1), hi = Math.max(s.y0, s.y1), n = treadsOf(s);
  const u = s.y1 >= s.y0 ? t : 1 - t;
  return lo + (hi - lo) * (Math.min(n - 1, Math.max(0, Math.floor(u * n))) + 0.5) / n;
}

test('the tread count is the bake\'s own sum, and no rise is a tie the two roundings split', () => {
  const shell = readFileSync(new URL('../scripts/krakenroom/shell.py', import.meta.url), 'utf8');
  assert.match(shell, /n = max\(3, round\(rise \/ \.1\)\)/, 'shell.py stair() counts its treads another way now');
  assert.match(shell, /ytop = lo_y \+ k \* \(ra \+ rb\) \/ 2/, 'shell.py stair() puts its tread tops elsewhere now');
  for (const s of K.STAIRS) {
    const q = Math.abs(s.y1 - s.y0) / 0.1;
    assert.ok(Math.abs(q - Math.floor(q) - 0.5) > 1e-6, `${s.id}: ${q} rounds one way in Python and another in JS`);
  }
});

const stairs = K.STAIRS.filter((s) => s.kind === 'stair');
// The room's own floors and stairs, as interior.js hands them to walk mode.
const room = buildPirateTavern({ FLOOR: K.F, rect: (x, z, hx, hz) => ({ x, z, hx, hz }) });
const surfaces = room.surfaces;
for (const s of stairs) {
  test(`the Kraken's ${s.id}: up and down it on the treads as they are drawn`, () => {
    const low = Math.min(s.y0, s.y1), high = Math.max(s.y0, s.y1);
    const lowFirst = s.y0 <= s.y1;             // does it rise from the x0 / z0 end?
    const mid = s.axis === 'x' ? (s.z0 + s.z1) / 2 : (s.x0 + s.x1) / 2;
    const [a0, a1] = s.axis === 'x' ? [s.x0, s.x1] : [s.z0, s.z1];
    const pt = (a) => (s.axis === 'x' ? [a, mid] : [mid, a]);
    // Start a little way off its foot - or on its first tread, where something else (the west
    // gangplank, over pit-west's foot) is overhead there and would be stood on instead.
    const over = (m) => { const [x, z] = pt(lowFirst ? a0 - m : a1 + m); return K.STAIRS.some((o) => o !== s && x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1); };
    const m = [0.3, -0.05].find((v) => !over(v));
    const [from, to] = lowFirst ? [a0 - m, a1 + 0.3] : [a1 + m, a0 - 0.3];
    // A floor the width of the hall at the stair's foot, so the start stands on something.
    const floor = { x0: -9, x1: 9, z0: -9, z1: 9, y: low };
    const h = () => K.F;
    const w = fresh({ height: h, at: pt(from), surfaces: [floor, ...surfaces] });
    const up = walkTo(w, pt(to));
    let worst = 0, on = 0, camJump = 0;
    for (let i = 0; i < up.length; i++) {
      const [x, z, y, cy] = up[i];
      const a = s.axis === 'x' ? x : z;
      if (a > a0 + 0.05 && a < a1 - 0.05) {
        worst = Math.max(worst, Math.abs(y - treadTop(s, x, z)));
        on++;
      }
      // Only while the camera is over the hall's floor: over a gallery or the gangplank behind you
      // it is held a hand over that, which is the camera's floor and not the stair's riser.
      const [, , , , cx, cz] = up[i];
      const clear = !surfaces.some((o) => o !== s && cx >= o.x0 && cx <= o.x1 && cz >= o.z0 && cz <= o.z1);
      if (i && clear) camJump = Math.max(camJump, Math.abs(cy - up[i - 1][3]));
    }
    assert.ok(on > 10, `walked the stair (${on} frames on it)`);
    assert.ok(worst < 1e-6, `feet ${worst.toFixed(3)} off the drawn treads`);
    assert.ok(Math.abs(w.walk.state.pos.y - high) < 0.02, `at the top: ${w.walk.state.pos.y.toFixed(2)} for ${high.toFixed(2)}`);
    const riser = (high - low) / treadsOf(s);
    assert.ok(camJump < riser * 0.4, `the camera jumped ${camJump.toFixed(3)} in a frame, a riser is ${riser.toFixed(3)}`);
    // And back down: followed, not fallen - never in the air under the tread.
    const down = walkTo(w, pt(from));
    for (const [x, z, y] of down) {
      const a = s.axis === 'x' ? x : z;
      if (a > a0 + 0.05 && a < a1 - 0.05) assert.ok(y > treadTop(s, x, z) - 0.02, `dropped through a tread: ${y.toFixed(2)}`);
    }
    assert.ok(Math.abs(w.walk.state.pos.y - low) < riser * 0.6, `at the foot (or its first tread): ${w.walk.state.pos.y.toFixed(2)} for ${low.toFixed(2)}`);
  });
}

// The harbour's quay (tests/quay-basin.test.mjs's): three wide along grid x 10..12, the water to the
// west, the wall's foot the column x 9, a flight down its face every so often.
const terrain = { size: 32, half: 16 };
const kadeCells = [];
for (let z = 2; z <= 29; z++) for (let x = 10; x <= 12; x++) kadeCells.push([x, z]);
const village = { works: { v: 1, kade: { cells: kadeCells, level: 113, back: [1, 0], hold: [] } }, districts: [], buildings: [], paths: [] };
const kade = quayKade(village, terrain);
const region = { village, terrain, toLocal: (x, z) => [x, z] };
const LEVEL = 113 / 256;
// Grid x 9 is local -7..-6: west of it the harbour, from x 10 (local -6) the quay.
const harbour = (x) => (x < -7 ? -0.6 : LEVEL);

test('out of the harbour by the quay\'s stairs: up a riser at a time, onto the quay, never back in', () => {
  const s = kade.stairs[0];
  const zTop = s.a0 - terrain.half + 0.1, zFoot = s.a0 + STAIR_LEN - terrain.half - 0.1;
  const xStair = s.face - terrain.half - 0.3;          // in front of the face, on the flight
  const w = fresh({ height: harbour, at: [-9, zFoot], region });
  assert.ok(w.walk.state.swimming, 'starts in the water');
  walkTo(w, [xStair, zFoot]);
  assert.ok(!w.walk.state.swimming, `out of the water on the flight's foot: y ${w.walk.state.pos.y.toFixed(2)}`);
  const up = walkTo(w, [xStair, zTop]);
  let last = -Infinity, camJump = 0;
  for (let i = 0; i < up.length; i++) {
    const [x, z, y, cy] = up[i];
    const tread = kade.height(x, z);
    assert.ok(tread != null && Math.abs(y - tread) < 1e-6, `off the tread at z ${z.toFixed(2)}: ${y.toFixed(3)} for ${tread}`);
    assert.ok(y >= last - 1e-9, 'went down on the way up');
    last = y;
    if (i) camJump = Math.max(camJump, Math.abs(cy - up[i - 1][3]));
  }
  assert.ok(camJump < 0.03, `the camera jumped ${camJump.toFixed(3)} in a frame going up`);
  walkTo(w, [-4.5, zTop]);                              // over the foot of the wall onto the quay
  assert.ok(Math.abs(w.walk.state.pos.y - LEVEL) < 0.02, `on the quay: ${w.walk.state.pos.y.toFixed(2)}`);
});

// The sides of every way up in the Kraken, each on its own on a flat floor at its foot: a railed side
// holds whoever is on the treads, and a flight built solid is a wall to whoever is beside it on the
// floor, where its treads are more than a step up - you neither go off the side of a flight to the
// floor nor walk in under it and stand in its treads (the rooms' flood-fill found both, every stair).
for (const s of room.surfaces.filter((f) => f.axis)) {
  test(`the Kraken's ${s.id}: held on it by its rails, and walled beside it on the floor`, () => {
    const low = Math.min(s.y0, s.y1), high = Math.max(s.y0, s.y1);
    const floor = { x0: -9, x1: 9, z0: -9, z1: 9, y: low };
    const along = s.axis === 'x' ? [s.x0, s.x1] : [s.z0, s.z1];
    const [c0, c1] = s.axis === 'x' ? ['z0', 'z1'] : ['x0', 'x1'];
    const mid = (s[c0] + s[c1]) / 2;
    const pt = (a, c) => (s.axis === 'x' ? [a, c] : [c, a]);
    // Two thirds of the way up, where every flight is well over a step above its foot.
    const hiEnd = s.y1 >= s.y0 ? along[1] : along[0], loEnd = s.y1 >= s.y0 ? along[0] : along[1];
    const a = loEnd + (hiEnd - loEnd) * 0.7;
    for (const side of s.rails || []) {
      const out = side === c0 ? s[c0] - 1 : s[c1] + 1;
      const w = fresh({ height: () => low, at: pt(a, mid), surfaces: [floor, s] });
      // Set down on the treads (enter puts a body on the floor, and finds the floor under a solid
      // flight taken, so it stands it somewhere beside).
      w.walk.state.pos.set(...(([x, z]) => [x, high, z])(pt(a, mid)));
      for (let i = 0; i < 10; i++) w.walk.update(FRAME);
      const on = w.walk.state.pos.y;
      assert.ok(on > low + 0.2, `${side}: started on the flight (${on.toFixed(2)})`);
      walkTo(w, pt(a, out), 3);
      const c = s.axis === 'x' ? w.walk.state.pos.z : w.walk.state.pos.x;
      assert.ok(c > s[c0] - 0.02 && c < s[c1] + 0.02, `${side}: went off the side through its rail (${c.toFixed(2)})`);
      assert.ok(w.walk.state.pos.y > low + 0.2, `${side}: fell to the floor (${w.walk.state.pos.y.toFixed(2)})`);
    }
    if (!s.solid) return;
    for (const side of [c0, c1]) {
      const from = side === c0 ? s[c0] - 0.8 : s[c1] + 0.8;
      const w = fresh({ height: () => low, at: pt(a, from), surfaces: [floor, s] });
      assert.ok(Math.abs(w.walk.state.pos.y - low) < 1e-6, `${side}: started on the floor`);
      walkTo(w, pt(a, mid), 4);
      const c = s.axis === 'x' ? w.walk.state.pos.z : w.walk.state.pos.x;
      assert.ok(c < s[c0] + 0.01 || c > s[c1] - 0.01, `${side}: walked in under the treads (${c.toFixed(2)})`);
      assert.ok(Math.abs(w.walk.state.pos.y - low) < 1e-6, `${side}: lifted onto the treads from beside (${w.walk.state.pos.y.toFixed(2)})`);
    }
  });
}

test('coming in at the door you are set down on the steps where the room says, not beside them', () => {
  const { x, z } = room.spawn;
  const w = fresh({ height: () => K.F, at: [x, z], surfaces: room.surfaces });
  const p = w.walk.state.pos;
  assert.ok(Math.hypot(p.x - x, p.z - z) < 1e-6, `moved off the spawn to ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
  const steps = room.surfaces.find((s) => s.id === 'door-steps');
  assert.ok(Math.abs(p.y - treadTop(steps, x, z)) < 1e-6, `not on the tread: ${p.y.toFixed(3)}`);
});
