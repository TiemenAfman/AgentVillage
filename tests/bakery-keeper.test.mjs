// The baker at the bakery's oven (web/js/bakery-keeper.js, Plans/stal-en-veld.md).
//
// The promises: the peel goes into the oven's mouth - not under it, not through the lip - and
// comes clear of it again; dough goes in and bread comes out, by day; at night he goes in by the
// shop door, walking along the front rather than through it, and comes back in the morning; and
// two bakers run the same frames the same way. Where the mouth and the door are is read off the
// bake here too, so a rebake that moves the oven fails this rather than leaving him pushing a
// peel into a wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const stub = () => { globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) }; };
stub();
const { attachBaker, updateBaker, disposeBaker, bakeryMarks, PEEL_IN } = await import('../web/js/bakery-keeper.js');
const { DUSK, DAWN } = await import('../web/js/smithy.js');
const { BAKERY } = await import('../web/js/bakery-mesh.js');
delete globalThis.document;

const FRAME = 1 / 60;
// Half the height of the mouth's dark opening (scripts/build-bakery.py, 0.08 tall), and a
// little under half its width (0.1): how far off its middle the blade may be and still be in it.
const MOUTH_HALF = { x: 0.04, y: 0.035 };

function material(night = 0) {
  const m = new THREE.MeshBasicMaterial();
  m.userData.uniforms = { uNight: { value: night } };
  return m;
}
function run(baker, seconds, each) {
  for (let i = 0; i < Math.round(seconds / FRAME); i++) { updateBaker(baker, FRAME); if (each) each(); }
}
function tipOf(baker) {
  baker.root.updateMatrixWorld(true);
  return baker.root.worldToLocal(baker.tip.getWorldPosition(new THREE.Vector3()));
}
function make(night = 0) {
  stub();
  const scene = new THREE.Scene();
  const m = material(night);
  const baker = attachBaker(scene, [0, 0, 0], m);
  delete globalThis.document;
  return { scene, m, baker };
}

test('the oven has a mouth and the shop a door to measure', () => {
  const marks = bakeryMarks();
  assert.ok(marks, 'no glow part or no door anchor in the bake');
  assert.deepEqual(marks.door, BAKERY.assets.civic_bakery.anchors.door);
});

test('the peel goes into the mouth at full stretch, level with it, and comes clear of it', () => {
  const { scene, baker } = make();
  const [mx, my, mz] = baker.marks.mouth;
  let deepest = Infinity, clearest = -Infinity, full = null;
  run(baker, 10, () => {
    const tip = tipOf(baker);
    // The whole stroke is level with the opening: dipping below it is the stone lip.
    assert.ok(Math.abs(tip.y - my) < MOUTH_HALF.y, `the blade is at ${tip.y.toFixed(3)}, the mouth at ${my}`);
    deepest = Math.min(deepest, tip.z);
    clearest = Math.max(clearest, tip.z);
    if (baker.push === 1 && !full) full = tip;
    // He never walks into the oven to do it.
    assert.ok(baker.figure.position.z - mz > 0.3, 'the baker is standing in the oven');
  });
  assert.ok(full, 'he never reached in');
  assert.ok(Math.abs(full.x - mx) < MOUTH_HALF.x, `the blade goes in ${(full.x - mx).toFixed(3)} off the middle of the mouth`);
  assert.ok(Math.abs(deepest - (mz - PEEL_IN)) < 0.005, `the blade goes ${(mz - deepest).toFixed(3)} in, not ${PEEL_IN}`);
  assert.ok(clearest - mz > 0.05, `drawn back the blade is only ${(clearest - mz).toFixed(3)} out of the mouth`);
  disposeBaker(baker);
  assert.equal(scene.children.length, 0);
});

test('by day dough goes in and bread comes out', () => {
  const { baker } = make();
  const seen = { in: new Set(), out: new Set() };
  run(baker, 16, () => {
    if (baker.phase === 'in') seen.in.add(baker.dough.visible && !baker.bread.visible ? 'dough' : 'wrong');
    if (baker.phase === 'out') seen.out.add(baker.bread.visible && !baker.dough.visible ? 'bread' : 'wrong');
  });
  assert.equal(baker.mode, 'work');
  assert.ok(baker.loaves >= 3, `only ${baker.loaves} loaves in sixteen seconds`);
  assert.deepEqual([...seen.in], ['dough']);
  assert.deepEqual([...seen.out], ['bread']);
  disposeBaker(baker);
});

test('at night he goes in by the door along the front of the shop, and at dawn comes back', () => {
  const { baker, m } = make();
  run(baker, 2);
  m.userData.uniforms.uNight.value = (DUSK + 1) / 2;
  // The front of the shop: everything the house part has below his head, between where he
  // works and the door - the sill of loaves under the window stands furthest out.
  const house = Object.entries(BAKERY.parts).filter(([n]) => n.startsWith('civic_bakery house'));
  const [x0, x1] = [baker.marks.door[0], baker.work[0]].sort((a, b) => a - b);
  let front = -Infinity;
  for (const [, p] of house) {
    for (let i = 0; i < p.positions.length; i += 3) {
      const x = p.positions[i] + p.at[0], y = p.positions[i + 1] + p.at[1], z = p.positions[i + 2] + p.at[2];
      if (y < 0.4 && x > x0 && x < x1) front = Math.max(front, z);
    }
  }
  for (const p of baker.path.slice(1, -1)) assert.ok(p[2] - front > 0.04, `a turn at z = ${p[2]} brushes the shop front at ${front.toFixed(3)}`);
  let closest = Infinity;
  run(baker, 12, () => {
    const p = baker.figure.position, d = baker.marks.door;
    if (baker.figure.visible) closest = Math.min(closest, Math.hypot(p.x - d[0], p.z - d[2]));
  });
  assert.equal(baker.mode, 'inside');
  assert.ok(!baker.figure.visible, 'the baker is still standing outside');
  assert.ok(closest < 0.02, `he vanished ${closest.toFixed(2)} from the door`);
  const loaves = baker.loaves;
  run(baker, 60);
  assert.equal(baker.loaves, loaves, 'he baked from inside the shop');
  // A slider held in the gap between dusk and dawn moves nobody.
  m.userData.uniforms.uNight.value = (DUSK + DAWN) / 2;
  run(baker, 5);
  assert.equal(baker.mode, 'inside');
  m.userData.uniforms.uNight.value = 0;
  run(baker, 14);
  assert.equal(baker.mode, 'work');
  assert.ok(baker.figure.visible && baker.loaves > 0, 'the morning came and he did not go back to the oven');
  disposeBaker(baker);
});

test('two bakers run the same frames the same way', () => {
  const go = () => {
    const { baker } = make();
    run(baker, 9);
    const tip = tipOf(baker);
    const out = [baker.mode, baker.phase, baker.loaves, baker.push, baker.restFor, tip.x, tip.y, tip.z, baker.dough.visible, baker.bread.visible];
    disposeBaker(baker);
    return out;
  };
  assert.deepEqual(go(), go());
});
