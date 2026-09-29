// The arch bridge, and the one promise it exists to keep: the Benchy sails under it.
//
// Measured, not asserted from the constants: the hull's size comes from the baked mesh in
// web/js/benchy-mesh.js, and the opening from sampling the bridge's own soffit. The boat is
// given room for her swell and roll on top of her own height, and the margin asked for is
// small on purpose: the bridge is sized so she just fits, and it stays walkable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { DRAUGHT } from '../shared/hull.mjs';
import { SHAPES } from '../shared/shapes.mjs';
register('./support/shared-loader.mjs', import.meta.url);

globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { propGeometry, propLift, archDeckY, archSoffitY, archSpring, ARCH_MIN_LEN, ARCH_LIFT_MIN, deckCellsOf, bridgeRoadCellsOf } = await import('../web/js/props.js');
const { BENCHY } = await import('../web/js/benchy-mesh.js');
delete globalThis.document;

function hull() {
  const P = BENCHY.parts['benchy hull'].positions;
  let w = 0, top = 0;
  for (let i = 0; i < P.length; i += 3) { w = Math.max(w, Math.abs(P[i])); top = Math.max(top, P[i + 1]); }
  return { beam: w * 2, airDraft: top - DRAUGHT };
}

// The widest band, centred on the channel, over which the soffit stays at least `h` up.
function clearWidth(p, h) {
  let z = 0;
  while (z < archSpring(p) && archSoffitY(p, z) >= h) z += 0.01;
  return 2 * Math.min(z, archSpring(p));
}

test('the arch bridge is in the catalogue and draws as itself, not as a cairn', () => {
  assert.ok(SHAPES.archbridge);
  const g = propGeometry({ kind: 'archbridge', x: 0, z: 0 });
  g.computeBoundingBox();
  const b = g.boundingBox;
  assert.ok(Math.abs(b.min.x + b.max.x) < 0.02, 'off centre');
  assert.ok(b.max.y > 1.5, `only ${b.max.y.toFixed(2)} high: that is not a bridge a boat goes under`);
  g.dispose();
});

// The rivers terrain.mjs carves: water where the bank has not yet climbed out of the bed,
// 2 * (w - RIVER_BED / RIVER_RISE) across, w running 0.6 at a source to 0.95 at a mouth.
const TERRAIN = readFileSync(new URL('../shared/terrain.mjs', import.meta.url), 'utf8');
const lit = (name) => Number(TERRAIN.match(new RegExp(`^const ${name} = (-?[0-9.]+);`, 'm'))[1]);
const riverWidth = (w) => 2 * (w - lit('RIVER_BED') / lit('RIVER_RISE'));
const STEP_UP = Number(readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8').match(/const STEP_UP = ([0-9.]+);/)[1]);

test('a river is about two wide, and the opening spans it', () => {
  const src = riverWidth(lit('RIVER_W0'));
  assert.ok(src > 1.8 && src < 2.1, `a river rises ${src.toFixed(2)} wide`);
  for (const length of [0, ARCH_MIN_LEN, 12, 30]) {
    const open = 2 * archSpring({ kind: 'archbridge', length });
    assert.ok(open >= 2.4, `length ${length}: opening ${open.toFixed(2)}`);
  }
});

test('the Benchy just fits under the crown: clear of it, but not by much', () => {
  const { beam, airDraft } = hull();
  // swell (BOB_RISE 0.03), a hand for roll and pitch at the rail, and a small margin
  const need = airDraft + 0.03 + 0.05;
  for (const length of [0, ARCH_MIN_LEN, 10, 14, 30]) {
    const p = { kind: 'archbridge', length };
    // over the whole beam and a little either side, at the lowest the bridge is ever set
    for (let z = 0; z <= beam / 2 + 0.15; z += 0.01) {
      const up = ARCH_LIFT_MIN + archSoffitY(p, z);
      assert.ok(up >= need, `length ${length}: ${up.toFixed(2)} at ${z.toFixed(2)}, needs ${need.toFixed(2)}`);
    }
    const crown = ARCH_LIFT_MIN + archSoffitY(p, 0);
    assert.ok(crown <= need + 0.3, `length ${length}: crown ${crown.toFixed(2)} is far more than she needs`);
  }
});

test('the deck can be walked: no cell climbs more than a step', () => {
  for (const length of [0, ARCH_MIN_LEN, 12, 30]) {
    const p = { kind: 'archbridge', length };
    const half = Math.max(ARCH_MIN_LEN, length || 10) / 2;
    // a cell is a unit; the steepest difference between two points a cell apart
    let worst = 0;
    for (let z = -half; z <= half - 1; z += 0.05) worst = Math.max(worst, Math.abs(archDeckY(p, z + 1) - archDeckY(p, z)));
    assert.ok(worst < STEP_UP, `length ${length}: ${worst.toFixed(2)} a cell against STEP_UP ${STEP_UP}`);
  }
});

test('the deck stands over the water, and meets the bank at both ends', () => {
  const p = { kind: 'archbridge', x: 0, z: 0, length: 10 };
  const flat = { worldHeight: () => -0.5 };                 // a channel with its banks drowned
  assert.ok(propLift(p, flat) >= ARCH_LIFT_MIN, 'an arch under the sea');
  assert.ok(Math.abs(archDeckY(p, 5)) < 1e-9 && Math.abs(archDeckY(p, -5)) < 1e-9);
});

// What walk mode is really given: a height per CELL, not the smooth curve. Taking the top of
// each cell made the second tread of a ten-long bridge exactly STEP_UP (0.45) and a walker
// stopped at its foot and fell in the river (the bridge at [172..182, 217], 29 September).
// Along the grid only: laid on a diagonal a cell is a step of 1.4 along the deck, and no height
// per cell can keep a ten-long arch under STEP_UP there.
test('the cells the deck is handed to walk mode in climb less than a step, along either axis', () => {
  const half = 20;
  for (const length of [10, 12, 30]) {
    for (const rot of [0, Math.PI / 2, Math.PI, 1.571]) {
      const p = { kind: 'archbridge', x: 0.5, z: 0.5, rot, length };
      // a river over the middle, banks 1.5 up: the deck rides on the higher end
      const terrain = { half, size: 2 * half, worldHeight: (x, z) => (Math.hypot(x - 0.5, z - 0.5) < 1.3 ? -0.5 : 1.5) };
      const cells = deckCellsOf([p], terrain);
      const s = Math.sin(rot), c = Math.cos(rot);
      // walked along the axis in tenths of a cell, as the walker steps it
      const at = (t) => {
        const gx = Math.floor(0.5 + s * t + half), gz = Math.floor(0.5 + c * t + half);
        return cells.get(gx + gz * 2 * half);
      };
      const len = Math.max(ARCH_MIN_LEN, length);
      let feet = terrain.worldHeight(0.5 + s * (len / 2 + 1), 0.5 + c * (len / 2 + 1)), worst = 0;
      for (let t = -len / 2 - 0.5; t <= len / 2 + 0.5; t += 0.1) {
        const y = at(t);
        if (y === undefined) continue;
        worst = Math.max(worst, y - feet);
        feet = Math.max(feet, y);
      }
      assert.ok(worst < STEP_UP, `length ${length}, rot ${rot}: a tread of ${worst.toFixed(2)} against STEP_UP ${STEP_UP}`);
    }
  }
});

test('a bridge is a road for the entrances: its axis and three cells of bank at each end, no wider', () => {
  const terrain = { half: 20, size: 40 };
  const cells = bridgeRoadCellsOf([{ kind: 'archbridge', x: 0.5, z: 0.5, rot: Math.PI / 2, length: 10 }], terrain);
  const xs = cells.map(([x]) => x), zs = new Set(cells.map(([, z]) => z));
  assert.equal(zs.size, 1, 'one row: the axis');
  const n = Math.max(...xs) - Math.min(...xs) + 1;
  assert.ok(n >= 16 && n <= 18, `${n} cells: the span and three cells of bank each side`);
  assert.deepEqual(bridgeRoadCellsOf([{ kind: 'fence', x: 0, z: 0 }], terrain), []);
});
