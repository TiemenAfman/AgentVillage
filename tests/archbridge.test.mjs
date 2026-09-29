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
const { propGeometry, propLift, archDeckY, archSoffitY, archSpring, ARCH_MIN_LEN, ARCH_LIFT_MIN } = await import('../web/js/props.js');
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
