import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isletsNear, isletHeight, candidate, ISLET_KINDS, ISLET_MARGIN, ISLET_PITCH } from '../shared/islets.mjs';
import { clearOf } from '../shared/regions.mjs';

// A fleet as the sea hands it round: the volcano in the middle, two islands in ring 1 and a
// starter, each holding its whole reach.
const FLEET = [
  { id: '0000000000000000', origin: [0, 0], gridSize: 192, reach: 96, volcano: true },
  { id: 'a', origin: [336, 0], gridSize: 64, reach: 192 },
  { id: 'b', origin: [0, -336], gridSize: 64, reach: 192 },
  { id: 'c', origin: [-336, -336], gridSize: 64, reach: 192 },
];

test('every page works out the same islets from the same fleet', () => {
  const one = isletsNear(FLEET, [336, 0]);
  const two = isletsNear(structuredClone(FLEET).reverse(), [336, 0]);
  assert.ok(one.length > 3, 'hardly any islets: ' + one.length);
  assert.deepEqual(one, two);
  assert.deepEqual(one.map((i) => i.id), [...one.map((i) => i.id)].sort());
});

test('no islet takes water an island holds, or the phone berth handed over', () => {
  const phone = { half: 32, origin: [700, 700] };
  for (const islet of isletsNear(FLEET, [336, 0], { extra: [phone] })) {
    const own = { half: islet.r, origin: [islet.x, islet.z] };
    for (const row of FLEET) assert.ok(clearOf(own, { half: row.reach, origin: row.origin }, ISLET_MARGIN), `${islet.id} on ${row.id}'s water`);
    assert.ok(clearOf(own, phone, ISLET_MARGIN), `${islet.id} on the phone's berth`);
  }
});

test('an island given the water takes the islets on it away, and leaves the rest where they were', () => {
  const before = isletsNear(FLEET, [0, 0]);
  const after = isletsNear([...FLEET, { id: 'd', origin: [336, 336], gridSize: 64, reach: 192 }], [0, 0]);
  const kept = new Map(after.map((i) => [i.id, i]));
  assert.ok(after.length < before.length, 'the new island took nothing');
  for (const i of before) if (kept.has(i.id)) assert.deepEqual(kept.get(i.id), i, `${i.id} moved`);
});

test('an islet stays inside its own lattice square, so two can never touch', () => {
  for (let j = -20; j < 20; j++) for (let i = -20; i < 20; i++) {
    const c = candidate(i, j);
    if (!c) continue;
    assert.ok(c.x - c.r >= i * ISLET_PITCH && c.x + c.r <= (i + 1) * ISLET_PITCH, `${c.id} spills over x`);
    assert.ok(c.z - c.r >= j * ISLET_PITCH && c.z + c.r <= (j + 1) * ISLET_PITCH, `${c.id} spills over z`);
    const spec = ISLET_KINDS[c.kind];
    assert.ok(c.r >= spec.r[0] && c.r <= spec.r[1]);
  }
});

test('an islet is above the sea in its middle and under it past its coast, and its flora stands on it', () => {
  for (const islet of isletsNear(FLEET, [0, 0])) {
    assert.ok(isletHeight(islet, 0, 0) > 0.3, `${islet.id} is under water in the middle`);
    assert.ok(isletHeight(islet, islet.r * 1.4, 0) < 0 && isletHeight(islet, 0, -islet.r * 1.4) < 0, `${islet.id} has no coast`);
    assert.ok(islet.palms.length >= 1, `${islet.id} has no palm`);
    for (const p of [...islet.palms, ...islet.bushes]) {
      assert.ok(Math.abs(p.y - isletHeight(islet, p.x, p.z)) < 1e-12 && p.y > 0, `${islet.id}: flora off its ground`);
    }
  }
});

test('shared/islets.mjs keeps to the shared rule: no trig, no pow, no clock', () => {
  const src = readFileSync(new URL('../shared/islets.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.(sin|cos|tan|atan2?|pow|exp|log|random)\b|Date\.|performance\./);
});
