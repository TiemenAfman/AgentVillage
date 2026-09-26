// The story animals' walk, on its own, in Node (shared/animalwalk.mjs).
//
// Like tests/settler-walk.test.mjs this registers no loader and stubs no `document`: it
// imports shared/ directly and it loads. The moment it needs either, something in the walk
// has reached back into the browser and the sea can no longer step a hen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAnimalWalk, animalRow, decodeAnimalRows, AF_STRIDE, DT, FLY_H } from '../shared/animalwalk.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { MOTION, motionOf, ACTS } from '../shared/animals.mjs';
import { dist } from '../shared/settlerwalk.mjs';

const SIZE = 64;
const SEED = 1337;
const terrain = makeTerrain(SEED, { size: SIZE });

// A dry spot with dry ground all round it for `r` cells - a patch no disc can reach the sea
// from, so "stayed in the disc" is not quietly "stood still at the shore".
function dryAt(r = 4, skip = 0) {
  let n = 0;
  for (let gz = r; gz < SIZE - r; gz++) {
    for (let gx = r; gx < SIZE - r; gx++) {
      let ok = true;
      for (let dz = -r; dz <= r && ok; dz++) for (let dx = -r; dx <= r && ok; dx++) if (!terrain.isLand(gx + dx, gz + dz)) ok = false;
      if (ok && n++ >= skip) return [gx, gz];
    }
  }
  throw new Error('no dry ground on the test island');
}
const [HX, HZ] = dryAt(4);
const HOME = terrain.cellWorld(HX, HZ);

const herd = () => [
  { id: 'animal:1', species: 'chicken', traits: ['bold', 'curious'], home: HOME, r: 0.9 },
  { id: 'animal:2', species: 'goat', traits: ['restless'], home: HOME, r: 1.5 },
  { id: 'animal:3', species: 'sparrow', traits: ['vain', 'shy'], home: HOME, r: 1.2 },
];
const roamOf = (a) => a.r * MOTION[a.species].roam * motionOf(a.species, a.traits).roam;
const snap = (walk) => [...walk.figures.values()].map((f) => `${f.id}|${f.pos[0]}|${f.pos[1]}|${f.h}|${f.act}|${f.face}`);

// A spot `d` cells away on dry land, for an errand to go to.
function awayFrom(gx, gz, d) {
  for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) {
    const x = gx + dx, z = gz + dz;
    if (x > 0 && z > 0 && x < SIZE - 1 && z < SIZE - 1 && terrain.isLand(x, z)) return terrain.cellWorld(x, z);
  }
  throw new Error('nowhere to send anybody');
}

test('the walk loads in Node with no loader and no document', () => {
  assert.equal(typeof createAnimalWalk, 'function');
  assert.equal(typeof globalThis.document, 'undefined', 'nothing here needed a browser');
  assert.equal(DT, 0.05);
});

test('nothing in the walk can differ between two engines', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../shared/animalwalk.mjs', import.meta.url)), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|random)\s*\(/;
  const m = src.match(banned);
  assert.equal(m, null, `shared/animalwalk.mjs uses ${m && m[0]} - see the rule at the top of shared/rng.mjs`);
  assert.ok(!/\*\*/.test(src), 'and no ** either, which is pow by another name');
  assert.ok(!/Date\.now|performance\.now|new Date/.test(src), 'the walk must not read a clock: it counts ticks');
  assert.ok(!/from '\.\.\/(web|lib)\//.test(src) && !/three/.test(src), 'and must not reach into the browser or the islander');
});

test('the same calls give the same animals, however the ticks are grouped', () => {
  const run = (group) => {
    const w = createAnimalWalk(terrain);
    w.set(herd());
    let left = 6000;
    const errandAt = 2000;
    let t = 0;
    while (left > 0) {
      const take = Math.min(left, group, errandAt - t > 0 ? errandAt - t : group);
      w.advance(take);
      t += take; left -= take;
      if (t === errandAt) w.intend([{ id: 'act:1:0', animal: 'animal:1', act: 'peck', dur: 5, to: awayFrom(HX, HZ, 4), look: null }]);
    }
    return snap(w);
  };
  // Bit for bit, not to a tolerance: two machines stepping one hen must agree exactly.
  assert.deepEqual(run(7), run(1));
});

test('left to itself every animal stays inside its own disc, and does live in it', () => {
  const w = createAnimalWalk(terrain);
  const animals = herd();
  w.set(animals);
  const seen = new Set();
  let flew = false;
  for (let i = 0; i < 24000; i++) {
    w.advance(1);
    for (const a of animals) {
      const f = w.get(a.id);
      const d = dist(f.pos[0] - HOME[0], f.pos[1] - HOME[1]);
      assert.ok(d <= roamOf(a) + 1e-9, `${a.id} is ${d} from home, outside ${roamOf(a)}`);
      seen.add(`${a.species}:${f.act}`);
      if (f.species !== 'sparrow') assert.equal(f.h, 0, `${a.id} left the ground`);
      else if (f.act === 'fly' && f.h > 0) flew = true;
      assert.ok(f.h >= 0 && f.h <= FLY_H + 1e-9, `${a.id} is ${f.h} up`);
    }
  }
  for (const want of ['chicken:walk', 'chicken:feed', 'chicken:still', 'goat:walk', 'goat:feed', 'sparrow:hop', 'sparrow:fly', 'sparrow:feed']) {
    assert.ok(seen.has(want), `nobody was ever seen at ${want}: ${[...seen].join(', ')}`);
  }
  assert.ok(flew, 'the sparrow never left the ground');
});

test('an errand goes there, does its act for its time facing what it was told, reports once and comes home', () => {
  const walls = new Set();
  const w = createAnimalWalk(terrain, { blocked: walls });
  const hen = herd()[0];
  w.set([hen]);
  w.advance(40);
  const to = awayFrom(HX, HZ, 5);
  const look = [to[0] + 1, to[1]];
  const action = { id: 'act:9:0', animal: 'animal:1', act: 'peck', dur: 6, to, look };
  w.intend([action]);
  const f = w.get('animal:1');
  let pecking = 0, arrivedAt = null, reported = [];
  for (let i = 0; i < 20 * 400 && !reported.length; i++) {
    w.advance(1);
    if (f.act === 'peck') {
      pecking++;
      if (arrivedAt === null) arrivedAt = [f.pos[0], f.pos[1]];
      assert.deepEqual(f.face.map(Math.sign), [1, 0], 'she is not facing what she was told to');
    }
    reported = w.done();
  }
  assert.deepEqual(reported, ['act:9:0']);
  assert.ok(arrivedAt && dist(arrivedAt[0] - to[0], arrivedAt[1] - to[1]) < 1e-9, `she pecked at ${arrivedAt}, not at ${to}`);
  assert.ok(Math.abs(pecking * DT - 6) <= DT * 1.5, `she pecked for ${pecking * DT} s instead of 6`);
  // The same action again is nothing to walk: the islander has simply not heard yet.
  w.intend([action]);
  for (let i = 0; i < 20 * 400; i++) {
    w.advance(1);
    assert.deepEqual(w.done(), [], 'a finished errand was reported twice');
    assert.notEqual(f.act, 'peck', 'a finished errand was walked again');
  }
  // Home, at an amble, and inside her disc again.
  assert.ok(dist(f.pos[0] - HOME[0], f.pos[1] - HOME[1]) <= roamOf(hen) + 1e-9, 'she never came home');
});

test('a hen on an errand walks round a building rather than through it', () => {
  // A wall of blocked cells across the way, with land on both sides.
  const walls = new Set();
  for (let dz = -2; dz <= 2; dz++) walls.add((HX + 2) + (HZ + dz) * SIZE);
  const w = createAnimalWalk(terrain, { blocked: walls });
  w.set([{ id: 'animal:1', species: 'chicken', traits: ['bold'], home: HOME, r: 0.3 }]);
  const to = terrain.cellWorld(HX + 4, HZ);
  w.intend([{ id: 'act:1:0', animal: 'animal:1', act: 'peck', dur: 1, to, look: null }]);
  const f = w.get('animal:1');
  let done = false;
  for (let i = 0; i < 20 * 300 && !done; i++) {
    w.advance(1);
    const gx = Math.round(f.pos[0] + terrain.half - 0.5), gz = Math.round(f.pos[1] + terrain.half - 0.5);
    assert.ok(!walls.has(gx + gz * SIZE), `she walked into a building at ${gx},${gz}`);
    done = w.done().length > 0;
  }
  assert.ok(done, 'she never got round');
});

test('a sparrow flies an errand in an arc and lands on the ground', () => {
  const w = createAnimalWalk(terrain);
  w.set([herd()[2]]);
  const to = awayFrom(HX, HZ, 6);
  w.intend([{ id: 'act:2:0', animal: 'animal:3', act: 'chirp', dur: 3, to, look: null }]);
  const f = w.get('animal:3');
  let top = 0, chirped = false, done = false;
  for (let i = 0; i < 20 * 120 && !done; i++) {
    w.advance(1);
    if (f.act === 'fly') top = Math.max(top, f.h);
    if (f.act === 'chirp') { chirped = true; assert.equal(f.h, 0, 'she chirps in mid-air'); }
    done = w.done().length > 0;
  }
  assert.ok(done && chirped, 'the errand never happened');
  assert.ok(top > FLY_H * 0.9 && top <= FLY_H + 1e-9, `the flight peaked at ${top}`);
  // And home by air, down to the ground at the end.
  for (let i = 0; i < 20 * 60; i++) w.advance(1);
  assert.equal(f.h, 0);
});

test('an errand taken away is let go of quietly, and she walks home', () => {
  const w = createAnimalWalk(terrain);
  const goat = herd()[1];
  w.set([goat]);
  w.intend([{ id: 'act:3:0', animal: 'animal:2', act: 'butt', dur: 30, to: awayFrom(HX, HZ, 6), look: null }]);
  w.advance(200);
  const f = w.get('animal:2');
  assert.ok(f.errand, 'the goat never took the errand');
  w.intend([]);
  for (let i = 0; i < 20 * 400; i++) {
    w.advance(1);
    assert.deepEqual(w.done(), [], 'a dropped errand was reported');
    assert.notEqual(f.act, 'butt');
  }
  assert.equal(f.errand, null);
  assert.ok(dist(f.pos[0] - HOME[0], f.pos[1] - HOME[1]) <= roamOf(goat) + 1e-9, 'she never went home');
});

test('saying who they are again keeps everybody where they stand', () => {
  const w = createAnimalWalk(terrain);
  w.set(herd());
  w.advance(500);
  const before = new Map([...w.figures.values()].map((f) => [f.id, [f.pos[0], f.pos[1]]]));
  const again = herd().slice(0, 2).map((a) => ({ ...a, r: a.r + 0.5, traits: ['homebody'] }));
  again.push({ id: 'animal:4', species: 'chicken', traits: ['shy'], home: HOME, r: 1 });
  w.set(again);
  assert.deepEqual(w.get('animal:1').pos, before.get('animal:1'));
  assert.deepEqual(w.get('animal:2').pos, before.get('animal:2'));
  assert.deepEqual(w.get('animal:1').traits, ['homebody']);
  assert.equal(w.get('animal:3'), null, 'the sparrow left the list and is still here');
  assert.ok(w.get('animal:4'), 'the newcomer was not born');
  // A new patch somewhere else: she walks there rather than appearing there.
  const moved = terrain.cellWorld(...dryAt(4, 40));
  const f = w.get('animal:1');
  const at = [f.pos[0], f.pos[1]];
  w.set([{ ...again[0], home: moved }]);
  w.advance(1);
  assert.ok(dist(f.pos[0] - at[0], f.pos[1] - at[1]) < 0.1, 'she jumped to her new home');
  // And new ground under her feet changes nothing about where she is.
  w.setGround(makeTerrain(SEED, { size: SIZE }), new Set());
  w.advance(1);
  assert.ok(dist(f.pos[0] - at[0], f.pos[1] - at[1]) < 0.2);
});

test('a row goes onto the wire and comes back the same animal', () => {
  const f = { pos: [3.25, -7.5], h: 0.3125, act: 'fly', face: [0, -2] };
  const row = animalRow(f, 4, 32);
  assert.equal(row.length, AF_STRIDE);
  assert.deepEqual(row, [4, Math.round((3.25 + 32) * 32), Math.round((-7.5 + 32) * 32), ACTS.indexOf('fly'), 10, 0, -16]);
  const back = decodeAnimalRows(row, 32).get(4);
  assert.deepEqual(back, { x: 3.25, z: -7.5, act: ACTS.indexOf('fly'), h: 0.3125, face: [0, -1] });
  assert.deepEqual(animalRow({ pos: [0, 0], h: 0, act: 'still', face: null }, 0, 32).slice(5), [0, 0]);
});
