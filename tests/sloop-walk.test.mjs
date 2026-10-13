// Walking the sloop as the keeper did on 13 October 2026 (Plans/DONE/nieuwe-sloep.md): nowhere on her
// does a body go through a deck, and the step off her wheel is not into her binnacle.
//
// The walk map (web/js/shipwalk-map.js) keeps every surface of a column, and shared/hullwalk.mjs used to
// skip a floor with something standing on it and take the next clear one down: under the binnacle, the
// cabin's floor a deck below. Stood or landed there, the body was in the cabin. This walks and jumps
// from every place on every deck of hers, the way stepHull is driven by walk.js, and fails on any frame
// in which the feet passed a surface of their own column on the way down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurface, stepHull, BODY_R } from '../shared/hullwalk.mjs';
import { SHIPWALK } from '../web/js/shipwalk-map.js';
import { CRAFTS } from '../shared/crafts.mjs';

const S = createSurface(SHIPWALK);
const C = CRAFTS.galleon;
// Her floors, off the craft (the waist, the cabin, the quarterdeck), each once.
const DECKS = [...new Set(C.deck.map((d) => d.y))].filter((y) => y < 3);
// walk.js's own numbers (JUMP_V, GRAVITY) and the Adventurer's sprint and walk.
const MOVE = { radius: BODY_R, jumpV: 3.1, gravity: 12.5 };

function starts(step) {
  const out = [];
  for (let x = -1.7; x <= 1.7; x += step) for (let z = -4.6; z <= 7; z += step) for (const y0 of DECKS) {
    const f = S.standAt(x, z, y0 + 0.01);
    if (f !== null && Math.abs(f - y0) <= 0.03 && !S.blockedAt(x, z, f)) out.push([x, z, f]);
  }
  return out;
}

test('no stand on her is a deck lower than the feet it was asked for', () => {
  // Wherever the column has that deck in it (a surface at the feet), the floor is that deck, a step of
  // it, or none - never the floor under it. Under the binnacle it was the cabin's, 1.25 down.
  const wrong = [];
  for (let x = -1.7; x <= 1.7; x += 0.05) for (let z = -4.6; z <= 7; z += 0.05) for (const y of DECKS) {
    if (S.hitIn(x, z, y - 0.03, y + 0.03) === null) continue;
    const f = S.standAt(x, z, y);
    if (f !== null && f < y - 0.3) wrong.push(`${x.toFixed(2)},${z.toFixed(2)} from ${y} -> ${f.toFixed(2)}`);
  }
  assert.deepEqual(wrong.slice(0, 10), []);
});

test('walking and jumping anywhere on her, the feet never go through a surface', () => {
  const through = [];
  for (const [x, z, f] of starts(0.2)) {
    for (let k = 0; k < 8; k++) for (const [speed, jumpAt] of [[2.7, 0], [2.7, 8], [0.44, 0], [1.8, -1]]) {
      const a = (k * Math.PI) / 4, ix = Math.sin(a), iz = Math.cos(a);
      const s = { x, z, y: f, vy: 0, grounded: true };
      for (let t = 0; t < 60 && !s.off; t++) {
        const was = s.y;
        stepHull(s, { x: ix, z: iz, jump: t === jumpAt }, S, 1 / 30, { ...MOVE, speed });
        if (s.off || s.y >= was - 0.06) continue;
        const h = S.hitIn(s.x, s.z, s.y + 0.06, was - 0.06);
        if (h !== null) through.push(`${s.x.toFixed(2)},${s.z.toFixed(2)}: ${was.toFixed(2)} -> ${s.y.toFixed(2)} through ${h.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(through.slice(0, 10), []);
});

test('the binnacle is solid to a body, which cannot stand inside it', () => {
  // build-sloop.py: 0.16 square, 0.42 before the wheel on the centreline - thinner than the gaps of a
  // body's ring, so it stood inside the body untouched (the keeper's frame 45).
  const z = C.helm[1] + 0.3 + 0.42;
  for (const dz of [-0.06, 0, 0.06]) for (const dx of [-0.06, 0, 0.06]) {
    const f = S.standAt(dx, z + dz, 1.72);
    assert.ok(f === null || S.blockedAt(dx, z + dz, f), `a body stands in the binnacle at ${dx},${(z + dz).toFixed(2)}`);
  }
});

test('her helm stand is clear deck on the quarterdeck', () => {
  const [x, z] = C.helm;
  const top = Math.max(...DECKS);
  const f = S.standAt(x, z, top + 0.2);
  assert.ok(f !== null && Math.abs(f - top) < 0.05, `the pilot's stand is at ${f}`);
  assert.ok(!S.blockedAt(x, z, f), 'the pilot stands inside something');
});
