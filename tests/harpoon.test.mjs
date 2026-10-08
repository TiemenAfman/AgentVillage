// The harpoon's arithmetic (shared/harpoon.mjs, Plans/harpoen.md): a bolt held by its line, what it
// strikes, the hang of a slack line, reeling that pulls the light end and lets a ship go round a rock,
// and whether a taut line is walked or slid down.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BOLT_SPEED, ROPE_MAX, REEL_MIN, ROPE_SEGS, ZIP_SLOPE, MASS,
  stepBolt, boltHit, ropeShape, stepReel, ropeMode, stepBalance, stepZip, alongLine,
} from '../shared/harpoon.mjs';

const body = (x, y, z, m, vx = 0, vy = 0, vz = 0) => ({ x, y, z, vx, vy, vz, m });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const DT = 0.05;

test('shared/harpoon.mjs uses no transcendental function, clock or randomness', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../shared/harpoon.mjs', import.meta.url)), 'utf8')
    .replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|random)\s*\(/);
  assert.doesNotMatch(src, /Date\.now|performance\.now|from 'three'/);
});

test('a bolt fired level flies, falls and never gets past the end of its line', () => {
  const from = { x: 0, y: 3, z: 0 };
  const b = { x: 0, y: 3, z: 0, vx: BOLT_SPEED * 0.8, vy: BOLT_SPEED * 0.6, vz: 0 };
  let top = 0, far = 0;
  for (let i = 0; i < 200; i++) {
    stepBolt(b, from, DT);
    top = Math.max(top, b.y); far = Math.max(far, dist(from, b));
    assert.ok(dist(from, b) <= ROPE_MAX + 1e-9);
  }
  assert.ok(top > 10, `rises (${top})`);
  assert.ok(far > ROPE_MAX - 1e-6, 'reaches the end of the line');
  // Held by the line it swings down under the gun's end: well below where it would have flown.
  assert.ok(b.y < 0, `ends low on its line (${b.y})`);
});

test('the bolt strikes the nearest of a target, the land and the water along its path', () => {
  const ground = (x) => (x > 10 ? 1 : -2);       // a shore at x 10
  const a = { x: 0, y: 2, z: 0 }, b = { x: 20, y: 0.5, z: 0 };
  assert.equal(boltHit(a, b, { ground }).kind, 'land');
  const statue = { id: 'statue', kind: 'statue', x: 5, y: 1.4, z: 0.3, r: 0.6 };
  const hit = boltHit(a, b, { ground, targets: [statue] });
  assert.equal(hit.id, 'statue');
  assert.ok(Math.abs(hit.x - 5) < 0.6);
  // Into open water short of anything.
  assert.equal(boltHit({ x: 0, y: 1, z: 0 }, { x: 4, y: -1, z: 0 }, { ground }).kind, 'water');
  // Missing a target by more than its radius strikes nothing in the air.
  assert.equal(boltHit({ x: 0, y: 5, z: 0 }, { x: 3, y: 5, z: 0 }, { targets: [{ ...statue, x: 1.5, y: 7 }] }), null);
});

test('a taut line is straight, a slack one hangs by the length it has to spare', () => {
  const a = { x: 0, y: 4, z: 0 }, b = { x: 10, y: 4, z: 0 };
  const taut = ropeShape(a, b, 10);
  assert.equal(taut.length, (ROPE_SEGS + 1) * 3);
  for (let i = 0; i <= ROPE_SEGS; i++) assert.ok(Math.abs(taut[i * 3 + 1] - 4) < 1e-9);
  const slack = ropeShape(a, b, 11);
  const mid = slack[(ROPE_SEGS / 2) * 3 + 1];
  assert.ok(mid < 4 - 1, `sags (${mid})`);
  // Its drawn length is the line's, within a few percent.
  let len = 0;
  for (let i = 1; i <= ROPE_SEGS; i++) {
    len += Math.hypot(slack[i * 3] - slack[i * 3 - 3], slack[i * 3 + 1] - slack[i * 3 - 2], slack[i * 3 + 2] - slack[i * 3 - 1]);
  }
  assert.ok(Math.abs(len - 11) < 0.3, `length ${len}`);
  // The ends are where they are.
  assert.equal(slack[0], 0); assert.equal(slack[ROPE_SEGS * 3], 10);
});

test('reeling brings a statue to a ship and leaves the ship where it is', () => {
  const ship = body(0, 2, 0, MASS.galleon);
  const statue = body(20, 0, 0, MASS.statue);
  const r = { L: 20, reeling: true };
  for (let i = 0; i < 400; i++) {
    stepReel(r, ship, statue, DT);
    for (const o of [ship, statue]) { o.x += o.vx * DT; o.y += o.vy * DT; o.z += o.vz * DT; o.vx *= 0.9; o.vy *= 0.9; o.vz *= 0.9; }
  }
  assert.equal(r.L, REEL_MIN);
  assert.ok(dist(ship, statue) < REEL_MIN + 0.3, `drawn in (${dist(ship, statue)})`);
  assert.ok(Math.hypot(ship.x, ship.z) < 0.6, `ship barely moved (${ship.x})`);
});

test('a line never pushes, and pulls nothing that is land at both ends', () => {
  const a = body(0, 0, 0, MASS.galleon), b = body(5, 0, 0, MASS.statue, -3);
  assert.equal(stepReel({ L: 10, reeling: false }, a, b, DT), 0);
  assert.equal(b.vx, -3);
  const rock = body(30, 0, 0, MASS.land), shore = body(0, 0, 0, MASS.land);
  assert.equal(stepReel({ L: 10 }, shore, rock, DT), 0);
});

test('a ship making way on a line to a rock goes round it instead of stopping', () => {
  const rock = body(0, 0, 0, MASS.land);
  const ship = body(10, 0, 0, MASS.galleon, 0, 0, 6);    // abeam of the rock, sailing on
  const r = { L: 10, reeling: false };
  let angle = 0, px = ship.x, pz = ship.z;
  for (let i = 0; i < 200; i++) {
    stepReel(r, rock, ship, DT);
    ship.x += ship.vx * DT; ship.z += ship.vz * DT;
    angle += Math.abs(Math.atan2(px * ship.z - pz * ship.x, px * ship.x + pz * ship.z));
    px = ship.x; pz = ship.z;
  }
  assert.ok(Math.abs(Math.hypot(ship.x, ship.z) - 10) < 0.3, 'kept on its circle');
  assert.ok(angle > Math.PI, `swung round (${angle})`);
  assert.ok(Math.hypot(ship.vx, ship.vz) > 5, 'kept most of its way');
});

test('a gentle line is walked, a steep one slid down towards its low end', () => {
  assert.equal(ropeMode({ x: 0, y: 3, z: 0 }, { x: 20, y: 5, z: 0 }).mode, 'balance');
  const steep = ropeMode({ x: 0, y: 9, z: 0 }, { x: 10, y: 3, z: 10 });
  assert.equal(steep.mode, 'zip');
  assert.equal(steep.low, 1);
  assert.ok(steep.slope > ZIP_SLOPE);
  assert.equal(ropeMode({ x: 0, y: 9, z: 0 }, { x: 0.1, y: 1, z: 0 }).mode, 'none');
});

test('a lean left alone falls; held against, it stays up', () => {
  const alone = { lean: 0.05, rate: 0 };
  let up = true;
  for (let i = 0; i < 100 && up; i++) up = stepBalance(alone, 0, 0, DT);
  assert.equal(up, false);
  const held = { lean: 0.05, rate: 0 };
  up = true;
  for (let i = 0; i < 400 && up; i++) up = stepBalance(held, Math.max(-1, Math.min(1, held.lean * 3 + held.rate)), 0.1 * ((i % 40) < 20 ? 1 : -1), DT);
  assert.equal(up, true);
});

test('sliding down a line speeds up to its top and comes off at the low end', () => {
  const high = { x: 0, y: 10, z: 0 }, low = { x: 20, y: 2, z: 0 };
  const s = { at: 0, v: 0 };
  let n = 0;
  while (stepZip(s, high, low, DT) && n < 1000) n++;
  assert.ok(n > 10 && n < 1000, `took ${n} ticks`);
  assert.ok(s.v > 4, `got going (${s.v})`);
  const p = alongLine(high, low, s.at);
  assert.deepEqual([p.x, p.y], [20, 2]);
});
