// The ship is her own hitbox (shared/hullwalk.mjs): what a body can do on her follows from the model,
// through a map cut out of it (scripts/build-shipwalk.mjs, web/js/shipwalk-map.js). These hold the map
// to the model and the walk to the map, with no list of what is where to hold them to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurface, stepHull, nearestStand, STEP_DOWN, BODY_R } from '../shared/hullwalk.mjs';
import { SHIPWALK } from '../web/js/shipwalk-map.js';
import { PIRATESHIP } from '../web/js/pirateship-mesh.js';
import { cut, sourceOf } from '../scripts/build-shipwalk.mjs';

const surface = createSurface(SHIPWALK);
const positions = PIRATESHIP.parts['pirateship hull'].positions;
const GO = { speed: 3.4, radius: BODY_R, jumpV: 3.1, gravity: 12.5 };
const DT = 1 / 60;

const walkable = (x, z, y) => {
  const f = surface.standAt(x, z, y);
  return f !== null && f >= y - STEP_DOWN && !surface.blockedAt(x, z, f, BODY_R) ? f : null;
};

// Everywhere a body can walk to from the waist, by the same rule a step is taken by.
function reach(seed) {
  const { cell, x0, z0, nx, nz } = SHIPWALK;
  const at = new Float32Array(nx * nz).fill(NaN);
  const key = (ix, iz) => ix * nz + iz;
  const start = [Math.floor((seed[0] - x0) / cell), Math.floor((seed[1] - z0) / cell)];
  at[key(...start)] = walkable(seed[0], seed[1], seed[2]);
  const queue = [start];
  while (queue.length) {
    const [ix, iz] = queue.pop();
    const y = at[key(ix, iz)];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz || !Number.isNaN(at[key(jx, jz)])) continue;
      const f = walkable(x0 + (jx + 0.5) * cell, z0 + (jz + 0.5) * cell, y);
      if (f === null) continue;
      at[key(jx, jz)] = f;
      queue.push([jx, jz]);
    }
  }
  return { at, has: (x, z) => !Number.isNaN(at[key(Math.floor((x - x0) / cell), Math.floor((z - z0) / cell))]), height: (x, z) => at[key(Math.floor((x - x0) / cell), Math.floor((z - z0) / cell))] };
}

test('the map is cut from the model as it is now: re-bake the ship, and cut it again', () => {
  assert.equal(SHIPWALK.source, sourceOf(positions), 'web/js/shipwalk-map.js was cut from another model - run: node scripts/build-shipwalk.mjs');
  // And from the script as it is now: the same cut, byte for byte.
  const again = cut(positions);
  assert.equal(Buffer.from(again.hits).toString('base64'), SHIPWALK.hits, 'the script cuts a different map than the one committed');
  assert.equal(Buffer.from(new Uint8Array(again.ends.buffer)).toString('base64'), SHIPWALK.off);
});

test('the whole deck is one place: from the waist you reach the stairs, the quarterdeck, the poop, the wheel, the forecastle and the bow', () => {
  const r = reach([0.3, 1.0, 1.11]);
  const where = {
    'the waist': [-0.6, 1.4, 1.1], 'the foot of the stairs': [1.5, -1.0, 1.1], 'the quarterdeck': [0.8, -4.0, 1.74],
    'the poop': [-1.0, -5.5, 1.95], 'the plinth at the wheel': [0, -3.15, 1.94], 'the forecastle': [0.2, 3.8, 1.32],
    'the bow': [0, 5.3, 1.8],
  };
  for (const [name, [x, z, y]] of Object.entries(where)) {
    assert.ok(r.has(x, z), `${name} (${x}, ${z}) cannot be walked to`);
    assert.ok(Math.abs(r.height(x, z) - y) < 0.08, `${name} is at ${r.height(x, z).toFixed(2)}, not ${y}`);
  }
  // What is solid is not: the masts, the wall between the flights of stairs, the middle of a cannon.
  for (const [name, x, z] of [['the mainmast', 0, 0.02], ['the foremast', 0, 3.15], ['the bulkhead', 0, -2.4]]) {
    assert.ok(!r.has(x, z), `${name} can be walked into`);
  }
  // Enough of it to be a deck: 30 square units of the ship's 40 are somewhere to stand.
  let cells = 0;
  for (const v of r.at) if (!Number.isNaN(v)) cells++;
  assert.ok(cells * SHIPWALK.cell * SHIPWALK.cell > 28, `only ${(cells * SHIPWALK.cell * SHIPWALK.cell).toFixed(1)} square units can be walked on`);
});

test('the wheel stands on its plinth and a pace ahead of it is somewhere free', () => {
  const top = surface.floorIn(0, -3.2, 1.9);
  assert.ok(top > 1.9 && top < 2.0, `the plinth is at ${top} and the quarterdeck at 1.74: the pilot stands on it`);
  const ahead = nearestStand(surface, 0, -2.6, 1.9);
  assert.ok(ahead, 'nowhere to step off to a pace ahead of the wheel');
  assert.ok(!surface.blockedAt(ahead.x, ahead.z, ahead.y), 'and it is free');
});

function walk(x, z, dir, steps, jumpAt = null) {
  const s = { x, z, y: surface.standAt(x, z, 1.1) ?? surface.standAt(x, z, 1.74) ?? surface.standAt(x, z, 1.95), vy: 0, grounded: true };
  const ys = [];
  for (let i = 0; i < steps && !s.off; i++) {
    stepHull(s, { ...dir, jump: jumpAt !== null && i === jumpAt }, surface, DT, GO);
    ys.push(s.y);
  }
  return { s, ys };
}

test('the stairs are climbed by walking, and come down the same way', () => {
  for (const side of [1, -1]) {
    const up = walk(side * 1.5, -0.9, { x: 0, z: -1 }, 45);
    assert.ok(!up.s.off, 'fell off the stairs');
    assert.ok(up.s.z < -2.4 && Math.abs(up.s.y - 1.74) < 0.05, `ended at z ${up.s.z.toFixed(2)}, y ${up.s.y.toFixed(2)}`);
    for (let i = 1; i < up.ys.length; i++) assert.ok(Math.abs(up.ys[i] - up.ys[i - 1]) < 0.1, `a step of ${(up.ys[i] - up.ys[i - 1]).toFixed(2)} on the way up`);
    const down = walk(side * 1.5, -3.0, { x: 0, z: 1 }, 90);
    assert.ok(!down.s.off && down.s.z > -1.2 && down.s.y < 1.3, `came down to z ${down.s.z.toFixed(2)}, y ${down.s.y.toFixed(2)}`);
  }
});

test('a wall is a wall: the bulkhead, a mast and a cannon stop a body that walks at them', () => {
  const bulkhead = walk(0.3, -1.0, { x: 0, z: -1 }, 120);
  assert.ok(!bulkhead.s.off && bulkhead.s.z > -2.3 && bulkhead.s.y < 1.3, `walked into the bulkhead to z ${bulkhead.s.z.toFixed(2)}, y ${bulkhead.s.y.toFixed(2)}`);
  const mast = walk(0.9, 0.02, { x: -1, z: 0 }, 120);
  assert.ok(!mast.s.off && mast.s.x > 0.1, `walked into the mainmast to x ${mast.s.x.toFixed(2)}`);
  // The four guns on the starboard side, at the waist: walked at from the middle, none is got through.
  for (let z = -0.8; z <= 2.0; z += 0.1) {
    const gun = walk(0.6, z, { x: 1, z: 0 }, 200);
    assert.ok(!gun.s.off, `walked off the ship at z ${z.toFixed(2)}`);
  }
});

test('a body that only walks never leaves the ship, and one that jumps can', () => {
  // A hundred and fifty places to start, spread over every deck, in eight directions each, for five
  // seconds, without a jump: nobody is ever off the ship. The rails of the model are what holds them.
  const r = reach([0.3, 1.0, 1.11]);
  const { cell, x0, z0, nx, nz } = SHIPWALK;
  const starts = [];
  for (let ix = 0; ix < nx; ix += 5) for (let iz = 0; iz < nz; iz += 9) {
    const x = x0 + (ix + 0.5) * cell, z = z0 + (iz + 0.5) * cell;
    if (r.has(x, z) && !surface.blockedAt(x, z, r.height(x, z))) starts.push([x, z, r.height(x, z)]);
  }
  assert.ok(starts.length > 100, `only ${starts.length} places to start`);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]];
  let off = 0, jumped = 0;
  for (const [x, z, y] of starts) {
    for (const [dx, dz] of dirs) {
      const s = { x, z, y, vy: 0, grounded: true };
      for (let i = 0; i < 300 && !s.off; i++) stepHull(s, { x: dx, z: dz, jump: false }, surface, DT, GO);
      if (s.off) { off++; assert.fail(`walked off the ship from (${x.toFixed(2)}, ${z.toFixed(2)}) towards (${dx}, ${dz})`); }
      // And with a jump into the same direction, from a run-up of a few steps.
      const j = { x, z, y, vy: 0, grounded: true };
      for (let i = 0; i < 90 && !j.off; i++) stepHull(j, { x: dx, z: dz, jump: i % 20 === 5 }, surface, DT, GO);
      if (j.off) jumped++;
    }
  }
  assert.equal(off, 0);
  assert.ok(jumped > 0, 'nobody could jump off the ship from anywhere');
});
