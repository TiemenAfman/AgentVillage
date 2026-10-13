// The ship is her own hitbox (shared/hullwalk.mjs): what a body can do on her follows from the model,
// through a map cut out of it (scripts/build-shipwalk.mjs, web/js/shipwalk-map.js). These hold the map
// to the model and the walk to the map, with no list of what is where to hold them to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurface, stepHull, nearestStand, STEP_DOWN, BODY_R } from '../shared/hullwalk.mjs';
import { SHIPWALK } from '../web/js/shipwalk-map.js';
import { PIRATESHIP } from '../web/js/pirateship-mesh.js';
import { cut, sourceOf, layer, ALOFT } from '../scripts/build-shipwalk.mjs';

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
  // And the crow's nest's layer (Plans/DONE/kraaiennest.md), cut by the same script.
  assert.deepEqual(SHIPWALK.aloft, layer(positions, ALOFT), "the nest's layer is not what the script cuts");
});

// Where the sloop's decks are (scripts/build-sloop.py; heights above DECK_Y): the main deck, the cabin's
// floor sunk under it with the stern well, the quarterdeck over the cabin.
const MAIN = 1.148, FLOOR = 0.469, QUARTER = 1.719;

test('the whole deck is one place: from the waist you reach the walkway, the companion, the cabin to the transom, the quarterdeck, the wheel and the bow', () => {
  const r = reach([0.3, 1.0, MAIN]);
  const where = {
    'the waist': [-0.6, 1.4, MAIN], 'the break': [1.0, 0.0, MAIN], 'the walkway': [0.9, -0.8, MAIN],
    'the foot of the companion': [0, -1.2, FLOOR], 'the cabin': [0.5, -2.2, FLOOR], 'the cabin by the transom': [0, -3.6, FLOOR],
    'the quarterdeck': [0.5, -2.2, QUARTER], 'the head of its stair': [-0.96, -1.1, QUARTER], 'the wheel': [0, -2.8, QUARTER],
    'the fore deck': [0.6, 2.9, MAIN], 'the bow': [0.3, 3.65, MAIN],
  };
  for (const [name, [x, z, y]] of Object.entries(where)) {
    // two floors over one spot (the cabin under the quarterdeck): the one at this height
    const near = (h) => Math.abs(h - y) < 0.08;
    const seen = r.has(x, z) && near(r.height(x, z)) || reach([x, z, y]).has(0.3, 1.0);
    assert.ok(seen, `${name} (${x}, ${z}) cannot be walked to`);
  }
  // What is solid is not: the mast, the capstan.
  for (const [name, x, z] of [['the mast', 0, 0.545], ['the capstan', 0, 2.15]]) {
    assert.ok(!r.has(x, z) || !Number.isFinite(r.height(x, z)) || surface.blockedAt(x, z, r.height(x, z)), `${name} can be walked into`);
  }
  // Enough of it to be a deck: a body's footprint held up and clear, one floor a cell (the cabin under the
  // quarterdeck counts once), some 13 square units of her.
  let cells = 0;
  for (const v of r.at) if (!Number.isNaN(v)) cells++;
  assert.ok(cells * SHIPWALK.cell * SHIPWALK.cell > 11, `only ${(cells * SHIPWALK.cell * SHIPWALK.cell).toFixed(1)} square units can be walked on`);
});

test('the pilot stands on the quarterdeck behind the wheel, and a pace before it is somewhere free', () => {
  const [hx, hz] = [0, -2.795];
  const at = surface.standAt(hx, hz, QUARTER + 0.05);
  assert.ok(at !== null && Math.abs(at - QUARTER) < 0.03 && !surface.blockedAt(hx, hz, at), `the helm stands at ${at}, the quarterdeck at ${QUARTER}`);
  const ahead = nearestStand(surface, 0.5, -2.2, QUARTER);
  assert.ok(ahead, 'nowhere to step to a pace from the wheel');
  assert.ok(!surface.blockedAt(ahead.x, ahead.z, ahead.y), 'and it is free');
});

function walk(x, z, dir, steps, y = MAIN, jumpAt = null) {
  const s = { x, z, y: surface.standAt(x, z, y), vy: 0, grounded: true };
  const ys = [];
  for (let i = 0; i < steps && !s.off; i++) {
    stepHull(s, { ...dir, jump: jumpAt !== null && i === jumpAt }, surface, DT, GO);
    ys.push(s.y);
  }
  return { s, ys };
}

test('the stairs are climbed by walking, and come down the same way', () => {
  const steady = (ys, what) => { for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1]) < 0.13, `a step of ${(ys[i] - ys[i - 1]).toFixed(2)} ${what}`); };
  // the companion, down to the cabin's floor and up again
  const down = walk(0, -0.1, { x: 0, z: -1 }, 40);
  assert.ok(!down.s.off && down.s.z < -1.1 && Math.abs(down.s.y - FLOOR) < 0.05, `went down to z ${down.s.z.toFixed(2)}, y ${down.s.y.toFixed(2)}`);
  steady(down.ys, 'down the companion');
  const up = walk(0, -1.25, { x: 0, z: 1 }, 40, FLOOR);
  assert.ok(!up.s.off && up.s.z > -0.3 && Math.abs(up.s.y - MAIN) < 0.05, `came up to z ${up.s.z.toFixed(2)}, y ${up.s.y.toFixed(2)}`);
  steady(up.ys, 'up the companion');
  // the stair to the quarterdeck, up the port walkway, and down again
  const climb = walk(-0.96, 0.45, { x: 0, z: -1 }, 45);
  assert.ok(!climb.s.off && climb.s.z < -0.95 && Math.abs(climb.s.y - QUARTER) < 0.05, `climbed to z ${climb.s.z.toFixed(2)}, y ${climb.s.y.toFixed(2)}`);
  steady(climb.ys, 'up to the quarterdeck');
  const back = walk(-0.96, -1.2, { x: 0, z: 1 }, 45, QUARTER);
  assert.ok(!back.s.off && back.s.z > 0.3 && Math.abs(back.s.y - MAIN) < 0.05, `came down to z ${back.s.z.toFixed(2)}, y ${back.s.y.toFixed(2)}`);
});

test("a wall is a wall: the cabin's back wall, the mast and the bulwark stop a body that walks at them, the entry ports included", () => {
  const wall = walk(0.6, -2.0, { x: 0, z: -1 }, 120, FLOOR);
  assert.ok(!wall.s.off && wall.s.z > -3.02, `walked through the cabin's back wall to z ${wall.s.z.toFixed(2)}`);
  const door = walk(0, -2.0, { x: 0, z: -1 }, 120, FLOOR);
  assert.ok(!door.s.off && door.s.z < -3.2, `the door to the stern well is shut: stopped at z ${door.s.z.toFixed(2)}`);
  const mast = walk(0.6, 0.545, { x: -1, z: 0 }, 120);
  assert.ok(!mast.s.off && mast.s.x > 0.1, `walked into the mast to x ${mast.s.x.toFixed(2)}`);
  // Walked at her side from beside the middle line (clear of the mast and the capstan), either way, all along the waist - past the entry ports, where the
  // bulwark is cut down to the deck, and the gun ports - nobody walks off her: going over is a jump.
  for (const sx of [1, -1]) {
    for (let z = -0.2; z <= 3.3; z += 0.1) {
      const side = walk(0.5 * sx, z, { x: sx, z: 0 }, 200);
      assert.ok(!side.s.off, `walked off her side at z ${z.toFixed(2)}`);
    }
  }
});

test('a body that only walks never leaves the ship, and one that jumps can', () => {
  // A hundred and fifty places to start, spread over every deck, in eight directions each, for five
  // seconds, without a jump: nobody is ever off the ship. The rails of the model are what holds them.
  const r = reach([0.3, 1.0, MAIN]);
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
