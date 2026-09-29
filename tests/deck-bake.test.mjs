// The ship's walking surface against the model it is walked on (shared/crafts.mjs, the galleon).
//
// The deck is a handful of rectangles, each with a height, and the bake is 30000 triangles: the
// two can only be kept honest by asking the bake. What a settler stands on is a surface, so the
// claim to hold is the one that was broken - a settler put a stride into a staircase because the
// stairs were drawn as stairs and walked as a step - that wherever the craft says there is
// planking, at the height it says, the model has an up-facing surface within a few centimetres of
// it. Props do not hide the floor from this (a barrel stands on it), and a wall or a mast is not
// asked for: only points that the craft itself lets a body stand on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CRAFTS } from '../shared/crafts.mjs';
import { deckAt, railed } from '../shared/deck.mjs';
import { PIRATESHIP } from '../web/js/pirateship-mesh.js';

// Where boat.js puts the bake: keel up by nothing, dropped by the draught (SHIP_TALL * 7 / 58.56 in
// boat.js), and DECK_Y (shared/hull.mjs) is what the craft's own y is measured from.
const DRAUGHT = 12.29 * 7 / 58.56;
const DECK_Y = 0.1855 - 0.13;

const pos = PIRATESHIP.parts['pirateship hull'].positions;
// Up-facing triangles only, as tuples in the craft's own frame, so that the walk over 30000 of them
// per sampled point stays cheap.
const tris = [];
for (let t = 0; t < pos.length; t += 9) {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => pos[t + k]);
  const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  if (!(ny > 1e-6)) continue;
  tris.push({
    ax, az, bx, bz, cx, cz,
    ay: ay - DRAUGHT - DECK_Y, by: by - DRAUGHT - DECK_Y, cy: cy - DRAUGHT - DECK_Y,
    minx: Math.min(ax, bx, cx), maxx: Math.max(ax, bx, cx), minz: Math.min(az, bz, cz), maxz: Math.max(az, bz, cz),
  });
}

// Every height at which the bake has an up-facing surface over (x, z).
function surfaces(x, z) {
  const out = [];
  for (const t of tris) {
    if (t.minx > x || t.maxx < x || t.minz > z || t.maxz < z) continue;
    const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d;
    const l2 = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    out.push(l1 * t.ay + l2 * t.by + l3 * t.cy);
  }
  return out;
}

const galleon = CRAFTS.galleon;
// A hair over what a tread's edge is from a straight line through its treads, and well under a
// riser (0.08): a settler on a stair is on it, not in it, and not floating over it.
const TOLERANCE = 0.05;

test('wherever the galleon says there is planking, the bake has a surface at that height', () => {
  const bad = [];
  let n = 0;
  for (const r of galleon.deck) {
    // Inside each stretch, away from its edges (walls, bulwarks and the next stretch's riser stand there).
    for (let x = r.x - r.hx + 0.3; x <= r.x + r.hx - 0.3 + 1e-9; x += 0.25) {
      for (let z = r.z - r.hz + 0.3; z <= r.z + r.hz - 0.3 + 1e-9; z += 0.25) {
        const claimed = deckAt(galleon, x, z);
        // Only where a body can be: not inside a rail, a mast or the side of a stair.
        if (railed(galleon, x, z, 0.16, claimed)) continue;
        n++;
        const found = surfaces(x, z).some((y) => Math.abs(y - claimed) <= TOLERANCE);
        if (!found) bad.push(`(${x.toFixed(2)}, ${z.toFixed(2)}) claims ${claimed.toFixed(3)}, the bake has ${surfaces(x, z).filter((y) => y > 0.9 && y < 2.3).map((y) => y.toFixed(2)).join('/')}`);
      }
    }
  }
  assert.ok(n > 100, `only ${n} points sampled`);
  assert.equal(bad.length, 0, `${bad.length} of ${n} points stand in the model or float over it:\n  ${bad.slice(0, 25).join('\n  ')}`);
});

test('the stairs are ramps: every tread of the aft flights is stood on', () => {
  // The quarterdeck stairs, on both sides, sampled at the treads' own depth: from the waist's
  // 1.108 up to the quarterdeck's 1.738 in a straight climb, with no 0.6 step at a wall.
  for (const s of [1, -1]) {
    let last = deckAt(galleon, s * 1.45, -1.3);
    assert.equal(last, 1.108, 'the waist below the stairs');
    for (let z = -1.3; z >= -2.4; z -= 0.05) {
      const y = deckAt(galleon, s * 1.45, z);
      assert.notEqual(y, null, `no planking at z ${z.toFixed(2)}`);
      assert.ok(y - last < 0.12, `a step of ${(y - last).toFixed(2)} at z ${z.toFixed(2)}: that is a wall, not a stair`);
      last = y;
    }
    assert.equal(last, 1.738, 'the quarterdeck at the top');
  }
});
