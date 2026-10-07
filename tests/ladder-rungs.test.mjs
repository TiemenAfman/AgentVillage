// Every rope ladder is cut to the climb (shared/deck.mjs RUNG_STEP, the keeper's choice of 7 Oct 2026):
// a hand or foot of the climb that has hold stands still on a rung while the body rises, the hands
// round a rung's middle and the feet's balls on its top - for the Adventurer's Mixamo clip and the
// Traveller's reach alike - and the galleon's ladders (boat.js ladderBoxes), the Salty Kraken's
// baked one (scripts/build-piratetavern.py) and the workbench's (avatar-motion.js) hang their rungs
// where those holds are. The rig is driven as walk.js drives it on a ladder: `climbing: { rise, at }`,
// `at` the height above the ladder's foot, rung 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = { createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop };

const { createClassicAvatar, climbPerCycle, climbPhase, CLIMB_SPEED } = await import('../web/js/classic-avatar.js');
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');
const { GAIT_CLIPS } = await import('../web/js/gait-clips.js');
const { RUNG_STEP, RUNG_R, RUNG_FROM, RUNG_OUT, aloftPath } = await import('../shared/deck.mjs');
const { CRAFTS } = await import('../shared/crafts.mjs');
const { DECK_Y } = await import('../shared/hull.mjs');
const { ladderBoxes } = await import('../web/js/boat.js');
const { PIRATETAVERN } = await import('../web/js/piratetavern-mesh.js');

// The Adventurer's leg (classic-avatar.js bodyOf: hip pivot to ankle), on which the clip rises.
const ADVENTURER_LEG = 0.2111;
// How far a hold may stand off its rung, and slide along it while held: the clip's own creep - its
// right hand closes 6 mm low over the half cycle it holds, as Mixamo made it - is the most.
const OFF = 0.005, SLIDE = 0.007;
const FRAME = 1 / 60;
// A limb holds while it moves less than this share of the body's rise.
const STILL = 0.3;

test('a rung is half a cycle of the clip: each hand and foot takes the next-but-one', () => {
  const rise = GAIT_CLIPS.climb.rise * ADVENTURER_LEG;
  assert.ok(Math.abs(climbPerCycle() - rise) < 5e-4, `two rungs ${climbPerCycle()} for the clip's ${rise.toFixed(4)}`);
  assert.equal(climbPerCycle(), 2 * RUNG_STEP);
  // Martijn's choice: the clip at 1.8 times its own pace (about 2.35 cycles a second), nothing sliding.
  const rate = CLIMB_SPEED / climbPerCycle();
  assert.ok(Math.abs(rate * GAIT_CLIPS.climb.seconds - 1.8) < 0.05, `${rate.toFixed(2)} cycles a second`);
  // the phase is the height's: the same height is the same pose, a cycle on is the same again
  for (const gait of [{ clips: true }, {}]) {
    assert.ok(Math.abs(climbPhase(0.3, gait) - climbPhase(0.3 + 2 * RUNG_STEP, gait)) < 1e-9);
  }
});

// Climb two cycles at the climb's speed and gather each limb's holds: runs of frames in which it
// stands still on the ladder, with where it stood.
function holdsOf(character) {
  const rig = createClassicAvatar({ ...DEFAULT_AVATAR, character }, new THREE.MeshBasicMaterial());
  const parent = new THREE.Group();
  parent.add(rig.object);
  const per = climbPerCycle(), rise = CLIMB_SPEED * FRAME;
  let at = 1;
  for (let i = 0; i < 90; i++) rig.update({ moving: true, grounded: true, climbing: { rise: 0, at } }, FRAME);
  const v = new THREE.Vector3(), rows = [];
  while (at < 1 + 2 * per) {
    at += rise;
    parent.position.y = at;
    rig.update({ moving: true, grounded: true, climbing: { rise, at } }, FRAME);
    parent.updateWorldMatrix(true, true);
    const p = (o) => v.set(0, 0, 0).applyMatrix4(o.matrixWorld).clone();
    rows.push({ lh: p(rig.handAttach.leftArm), rh: p(rig.handAttach.rightArm), lf: p(rig.joints.leftLeg.toe), rf: p(rig.joints.rightLeg.toe) });
  }
  const holds = {};
  for (const k of ['lh', 'rh', 'lf', 'rf']) {
    const runs = [];
    let run = null;
    for (let i = 1; i < rows.length; i++) {
      if (Math.abs(rows[i][k].y - rows[i - 1][k].y) < STILL * rise) (run ||= []).push(rows[i][k]);
      else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    holds[k] = runs.filter((r) => r.length >= 4).map((r) => {
      const ys = r.map((q) => q.y);
      return { n: r.length, y: ys.reduce((a, b) => a + b) / ys.length, slide: Math.max(...ys) - Math.min(...ys), x: r[0].x, z: r[0].z };
    });
  }
  return { holds, frames: rows.length };
}

for (const character of ['adventurer', 'traveller']) {
  test(`the ${character}'s hands close round a rung and the feet stand on one, without sliding`, () => {
    const { holds, frames } = holdsOf(character);
    for (const [k, list] of Object.entries(holds)) {
      const foot = k.endsWith('f');
      // once a cycle each, for a good share of it
      assert.ok(list.length >= 2, `${k}: ${list.length} holds in two cycles`);
      const held = list.reduce((a, h) => a + h.n, 0);
      assert.ok(held > frames * 0.2, `${k} holds ${held} of ${frames} frames`);
      for (const h of list) {
        // a hand on the rung's middle, a foot's ball on its top
        const want = foot ? RUNG_R : 0;
        const off = ((h.y - want) / RUNG_STEP - Math.round((h.y - want) / RUNG_STEP)) * RUNG_STEP;
        assert.ok(Math.abs(off) < OFF, `${k} holds ${off.toFixed(4)} off a rung (at ${h.y.toFixed(3)})`);
        assert.ok(h.slide < SLIDE, `${k} slides ${h.slide.toFixed(4)} while it holds`);
        // and inside the ropes
        assert.ok(Math.abs(h.x) < CRAFTS.galleon.ladders[0].hw, `${k} at ${h.x.toFixed(3)} across`);
      }
    }
  });
}

test('the clip\'s hands and feet hold within reach of the rungs\' plane', () => {
  // the rungs RUNG_FROM in front of the climber's root: between where the clip's hands (0.11) and
  // feet's balls (0.15) are when they hold
  const { holds } = holdsOf('adventurer');
  for (const [k, list] of Object.entries(holds)) {
    for (const h of list) assert.ok(Math.abs(h.z - RUNG_FROM) < 0.03, `${k} ${h.z.toFixed(3)} from the root, rungs at ${RUNG_FROM}`);
  }
});

test('the galleon\'s rungs are the climb\'s: RUNG_STEP apart from the ladder\'s foot, RUNG_OUT outside it', () => {
  const ship = CRAFTS.galleon;
  const boxes = ladderBoxes({ ladders: ship.ladders });   // her side's: the mast's are tests/crows-nest.test.mjs's
  for (const l of ship.ladders) {
    const s = l.x < 0 ? -1 : 1;
    const rungs = boxes.map((g) => { g.computeBoundingBox(); return g.boundingBox; })
      .filter((b) => b.max.y - b.min.y < 3 * RUNG_R && b.max.z - b.min.z > l.hw && Math.sign(b.min.x) === s);
    assert.ok(rungs.length > 25, `${rungs.length} rungs`);
    for (const b of rungs) {
      const y = (b.min.y + b.max.y) / 2 - DECK_Y - l.foot, k = Math.round(y / RUNG_STEP);
      assert.ok(Math.abs(y - k * RUNG_STEP) < 1e-6 && k >= 1, `a rung ${y.toFixed(4)} above the foot`);
      assert.ok(Math.abs((b.min.x + b.max.x) / 2 - s * (Math.abs(l.x) + RUNG_OUT)) < 1e-6);
      assert.ok(b.max.y < DECK_Y + l.top, 'below the bulwark');
    }
  }
});

test('the Salty Kraken\'s rope ladder is baked to the climb: rungs RUNG_STEP above its foot, RUNG_FROM before the climber', () => {
  const lo = PIRATETAVERN.anchors['climb.side.lo'], hi = PIRATETAVERN.anchors['climb.side.hi'];
  const rungs = Object.entries(PIRATETAVERN.parts).filter(([n]) => /^Salty side ladder rung/.test(n)).map(([, p]) => p.at);
  assert.ok(rungs.length > 40, `${rungs.length} rungs`);
  // the climber faces from `lo` towards the hull (`hi` lies the other way along z)
  const toward = Math.sign(hi[2] - lo[2]);
  for (const [x, y, z] of rungs) {
    const k = Math.round((y - lo[1]) / RUNG_STEP);
    assert.ok(Math.abs(y - lo[1] - k * RUNG_STEP) < 2e-4 && k >= 1, `a rung ${(y - lo[1]).toFixed(4)} above the landing`);
    assert.ok(Math.abs((z - lo[2]) * toward - RUNG_FROM) < 2e-4, `${((z - lo[2]) * toward).toFixed(4)} before the climber`);
    assert.ok(Math.abs(x - lo[0]) < 1e-4);
  }
  // the bake repeats deck.mjs's numbers
  const py = readFileSync(new URL('../scripts/build-piratetavern.py', import.meta.url), 'utf8');
  assert.equal(Number(/^RUNG_STEP = ([\d.]+)/m.exec(py)[1]), RUNG_STEP);
  assert.equal(Number(/^RUNG_R = ([\d.]+)/m.exec(py)[1]), RUNG_R);
  assert.equal(Number(/^RUNG_OUT = CLIMB_OUT - ([\d.]+)/m.exec(py)[1]), RUNG_FROM);
});

test('the workbench hangs its ladder from deck.mjs too', () => {
  const js = readFileSync(new URL('../web/js/avatar-motion.js', import.meta.url), 'utf8');
  assert.match(js, /import \{ RUNG_STEP, RUNG_R, RUNG_OUT \} from 'shared\/deck\.mjs'/);
  assert.match(js, /climbing:\{rise:climbRise,at:climbY\}/);
});

// The two ladders up the Salty Kraken's mast (scripts/krakenkit/mast.py ladders(), kraken-layout.js
// MAST_CLIMBS) are cut to the climb as well: plumb, MAST_LADDER out from the mast along its yard, their
// rungs RUNG_STEP apart from the pit - the kit's y = 0 and the climb's `at` 0 - and the climber's foot
// RUNG_FROM in front of them. Measured off the bake: a rung is a rod across the ladder (wooden on the
// east one, rope on the west), so the vertices near the ladder's plane gather in one cluster a rung.
test('the Salty Kraken\'s mast ladders are baked to the climb: plumb, rungs RUNG_STEP above the pit', async () => {
  const { KRAKENKIT } = await import('../web/js/krakenkit-mesh.js');
  const K = await import('../web/js/kraken-layout.js');
  // the nest's planks in the kit's own frame (mast.py NEST_Y), which the ladders hang from
  const py = readFileSync(new URL('../scripts/krakenkit/mast.py', import.meta.url), 'utf8');
  const nest = Number(/^NEST_Y = ([\d.]+)/m.exec(py)[1]);
  for (const [side, part] of [[1, 'civic_kraken_mast plain wood'], [-1, 'civic_kraken_mast plain rope']]) {
    const p = KRAKENKIT.parts[part].positions, ys = [], xs = [];
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
      if (Math.abs(x - side * K.MAST_LADDER) < 0.012 && Math.abs(z) < 0.075 && y > 0.03 && y < nest - 0.06) { ys.push(y); xs.push(x); }
    }
    ys.sort((a, b) => a - b);
    const rungs = [];
    let lo = ys[0], hi = ys[0];
    for (const y of ys.slice(1).concat(Infinity)) {
      if (y - hi > 0.02) { rungs.push((lo + hi) / 2); lo = y; }
      hi = y;
    }
    assert.ok(rungs.length > 40, `${part}: ${rungs.length} rungs`);
    rungs.forEach((y, i) => assert.ok(Math.abs(y - (i + 1) * RUNG_STEP) < 2e-4, `${part}: rung ${i + 1} at ${y.toFixed(4)}`));
    assert.ok(rungs.at(-1) < nest - 0.06, 'under the nest\'s planks');
    // plumb: every rung in the one plane, MAST_LADDER out
    assert.ok(Math.max(...xs) - Math.min(...xs) < 0.025, `${part}: from ${Math.min(...xs)} to ${Math.max(...xs)} across`);
  }
  // the walk mode climbs them from a foot RUNG_FROM before the rungs, on the pit (rung 0)
  for (const l of K.MAST_CLIMBS.filter((c) => !c.exit)) {
    const out = Math.hypot(l.lo.x - K.KIT.mast.x, l.lo.z - K.KIT.mast.z);
    assert.ok(Math.abs(out - K.MAST_LADDER - RUNG_FROM) < 1e-9, `${l.name}: foot ${out.toFixed(3)} out`);
    assert.equal(l.lo.y, K.KIT.mast.y);
  }
  assert.equal(K.MAST_FROM, RUNG_FROM);
  // the bake reads deck.mjs for the step, and shares MAST_LADDER
  assert.match(py, /^RUNG_STEP = _deck\('RUNG_STEP'\)/m);
  assert.equal(Number(/^LADDER_X = ([\d.]+)/m.exec(py)[1]), K.MAST_LADDER);
});

test("the galleon's mast ladder is the climb's too: rungs RUNG_STEP up from its foot on the deck, RUNG_FROM before the climber", () => {
  // Up to her crow's nest (shared/crafts.mjs aloft, Plans/DONE/kraaiennest.md): the same rungs, turned to the face of the top it hangs from.
  const SHIP = CRAFTS.galleon, L = SHIP.aloft[0];
  const boxes = ladderBoxes({ ladders: [], aloft: SHIP.aloft });
  const rungs = boxes.map((g) => { g.computeBoundingBox(); return g.boundingBox; }).filter((bb) => bb.max.y - bb.min.y < 3 * RUNG_R);
  const span = (L.top - L.foot);
  assert.ok(rungs.length > span / RUNG_STEP - 3, `${rungs.length} rungs for ${span.toFixed(2)} of rope`);
  for (const bb of rungs) {
    const y = (bb.min.y + bb.max.y) / 2 - DECK_Y - L.foot, k = Math.round(y / RUNG_STEP);
    assert.ok(Math.abs(y - k * RUNG_STEP) < 1e-6 && k >= 1, `a rung ${y.toFixed(4)} above the foot`);
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const out = (cx - L.x) * L.out[0] + (cz - L.z) * L.out[1];
    assert.ok(Math.abs(out - RUNG_OUT) < 1e-6, `a rung ${out.toFixed(4)} out from the ropes`);
  }
  // the climber hangs on the line aloftPath has them on: RUNG_FROM behind the rungs, as on her side
  const [a] = aloftPath(L);
  const back = (a.x - L.x) * L.out[0] + (a.z - L.z) * L.out[1];
  assert.ok(Math.abs(back - RUNG_OUT - RUNG_FROM) < 1e-9, `the climber ${back.toFixed(3)} out from the ropes`);
});
