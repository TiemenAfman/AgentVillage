// The butcher's (scripts/build-butcher.py, web/js/butcher.js, Plans/slagerij.md).
//
// The promises: the building never draws a moving part twice; the cleaver comes down on the cut
// end of the joint, measured off the rig itself; the butcher works by day and goes in at night
// by the door, round the block and never through it or a wall, and comes back in the morning;
// a slice comes off only at a chop and every one ends in the tub; the awning rolls in while he
// is inside and out when he is not; and the smokehouse smokes at any hour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const stub = () => { globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) }; };
stub();
const { buildBuilding, meshAsset, isButcherMoving } = await import('../web/js/buildings.js');
const { attachButcher, updateButcher, disposeButcher, butcherGeometry, IMPACT_S, BLOWS, DUSK, DAWN, ROLLED } = await import('../web/js/butcher.js');
const { BUTCHER } = await import('../web/js/butcher-mesh.js');
delete globalThis.document;

const YARD = BUTCHER.assets.civic_butcher_yard.parts;
const tris = (names) => names.reduce((n, p) => n + BUTCHER.parts[p].positions.length / 9, 0);
const FRAME = 1 / 60;

// The shared building material's uNight, which is what the shop reads the night off.
function material(night = 0) {
  const m = new THREE.MeshBasicMaterial();
  m.userData.uniforms = { uNight: { value: night } };
  return m;
}
function open(night = 0) {
  stub();
  const m = material(night);
  const shop = attachButcher(new THREE.Scene(), [0, 0, 0], m);
  delete globalThis.document;
  return { shop, m };
}
function run(shop, seconds, each) {
  for (let i = 0; i < Math.round(seconds / FRAME); i++) { updateButcher(shop, FRAME); each?.(); }
}
const livePuffs = (im) => {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); m.decompose(p, q, s); if (s.x > 0) n++; }
  return n;
};
const onBlock = (shop) => shop.slices.filter((s) => s.state === 'rest').length;

test('what moves is the awning, the sign, the hanging meat, the joint, the slice and the fire', () => {
  const moving = [...new Set(YARD.filter(isButcherMoving).map((n) => n.split(':')[0].replace('civic_butcher_yard ', '')))].sort();
  assert.deepEqual(moving, ['awning', 'embers', 'hang 0', 'hang 1', 'hang 2', 'joint', 'sign', 'slice']);
  assert.equal(BUTCHER.assets.civic_butcher.parts.filter(isButcherMoving).length, 0);
  for (const still of ['block', 'vent', 'tub', 'smokehouse', 'rack']) {
    assert.ok(YARD.some((n) => n.startsWith(`civic_butcher_yard ${still}`)), `no ${still}`);
    assert.ok(!isButcherMoving(`civic_butcher_yard ${still}:0`), `the ${still} is not meant to move`);
  }
  stub();
  const kept = meshAsset('civic_butcher_yard', 0xffffff, { skip: isButcherMoving });
  const built = buildBuilding({ id: 'c:butcher', kind: 'civic', civicType: 'butcher', tier: 'civic', style: 'unknown', ornaments: [] });
  delete globalThis.document;
  assert.equal(kept.reduce((n, g) => n + g.attributes.position.count / 3, 0), tris(YARD.filter((n) => !isButcherMoving(n))));
  assert.ok(built.animated.butcher && built.anchors.smoke && built.anchors.door);
  built.geometry.dispose();
});

test('the cleaver comes down on the cut end of the joint', () => {
  const { shop } = open();
  const G = shop.G;
  // To the first chop, and on to the moment it lands.
  while (shop.blows === 0) updateButcher(shop, FRAME);
  run(shop, IMPACT_S - FRAME);
  shop.root.updateMatrixWorld(true);
  const blade = shop.butcher.handAttach.rightArm.children[0];
  assert.ok(blade, 'the butcher has nothing in his right hand');
  const box = new THREE.Box3().setFromObject(blade);
  // The edge reaches the meat - no higher than the top of the joint, and not far into the wood.
  const jointTop = G.top + 0.042;
  assert.ok(box.min.y <= jointTop && box.min.y > G.top - 0.03, `the blade's edge is at ${box.min.y.toFixed(3)}, the block's top at ${G.top}`);
  // And it lands across the cut: over the slices' end of the block, within the joint's depth.
  const [cx, , cz] = G.cut;
  const x = (box.min.x + box.max.x) / 2, z = (box.min.z + box.max.z) / 2;
  assert.ok(Math.abs(x - cx) < 0.03, `the blade is ${(x - cx).toFixed(3)} along from the cut`);
  assert.ok(Math.abs(z - cz) < 0.035, `the blade is ${(z - cz).toFixed(3)} in front of the joint's middle`);
  disposeButcher(shop);
});

test('he stands behind the block, and his way to the door goes round it', () => {
  const G = butcherGeometry();
  const b = G.block;
  // Behind it, facing the street, with the whole of him clear of it.
  const BODY = 0.035;                      // half his depth, front to back, at BUTCHER_SCALE
  assert.ok(G.work[2] + BODY < b.min[2], `he stands at z = ${G.work[2]}, into the block`);
  assert.deepEqual(G.path[0], G.work);
  assert.deepEqual(G.path.at(-1), [G.door[0], 0, G.door[2]]);
  // No leg of the way crosses the block, the smokehouse or the house, with a body's width to
  // spare: the house is only ever reached at its door, which stands in front of it.
  const R = 0.05;
  const rect = (name) => {
    const ps = BUTCHER.parts[name] ? [name] : Object.keys(BUTCHER.parts).filter((n) => n.startsWith(name + ':'));
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const n of ps) {
      const { positions, at } = BUTCHER.parts[n];
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i] + at[0], z = positions[i + 2] + at[2];
        lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], z); hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], z);
      }
    }
    return { lo, hi };
  };
  const walls = rect('civic_butcher walls');
  const solids = { block: rect('civic_butcher_yard block'), smokehouse: rect('civic_butcher_yard smokehouse'), house: walls };
  const hits = ([ax, , az], [bx, , bz], { lo, hi }) => {
    for (let k = 0; k <= 100; k++) {
      const x = ax + (bx - ax) * k / 100, z = az + (bz - az) * k / 100;
      if (x > lo[0] - R && x < hi[0] + R && z > lo[1] - R && z < hi[1] + R) return true;
    }
    return false;
  };
  for (let i = 1; i < G.path.length; i++) {
    for (const [what, r] of Object.entries(solids)) {
      assert.ok(!hits(G.path[i - 1], G.path[i], r), `leg ${i} of the way to the door runs through the ${what}`);
    }
  }
  assert.ok(G.door[2] > walls.hi[1], 'the door is inside the house');
});

test('by day he chops: a slice off each chop, and every slice ends in the tub', () => {
  const { shop } = open();
  let impacts = 0, lastSquash = shop.squashAt, most = 0, early = false;
  run(shop, 16, () => {
    if (shop.squashAt !== lastSquash) { impacts++; lastSquash = shop.squashAt; }
    const seen = shop.slices.filter((s) => s.state !== 'off').length;
    if (impacts === 0 && seen > 0) early = true;
    most = Math.max(most, onBlock(shop));
  });
  assert.equal(shop.mode, 'work');
  assert.ok(shop.figure.visible);
  assert.ok(!early, 'a slice came off before the first chop');
  assert.ok(impacts >= 9, `only ${impacts} chops in sixteen seconds`);
  assert.equal(most, BLOWS, `${most} slices were on the block at once, not one for each chop of a round`);
  // Between rounds the block is cleared: step to just before a round's first chop.
  while (!(shop.blows % BLOWS === 0 && shop.blowAt - shop.time < 0.1)) updateButcher(shop, FRAME);
  assert.equal(shop.slices.filter((s) => s.state !== 'off').length, 0, 'slices left over from the last round');
  disposeButcher(shop);
});

test('at night he goes in by the door, the awning rolls in and the smoke goes on; in the morning it all comes back', () => {
  const { shop, m } = open();
  run(shop, 2.3);
  m.userData.uniforms.uNight.value = (DUSK + 1) / 2;
  let closest = Infinity;
  run(shop, 10, () => {
    const G = shop.G, p = shop.figure.position;
    if (shop.figure.visible) closest = Math.min(closest, Math.hypot(p.x - G.door[0], p.z - G.door[2]));
  });
  assert.equal(shop.mode, 'inside');
  assert.ok(!shop.figure.visible, 'the butcher is still standing outside');
  assert.ok(closest < 0.02, `he vanished ${closest.toFixed(2)} from the door`);
  assert.equal(onBlock(shop), 0, 'he left meat out on the block for the night');
  const blows = shop.blows;
  run(shop, 30);
  assert.equal(shop.blows, blows, 'he chopped from inside');
  assert.ok(Math.abs(shop.awning.scale.z - ROLLED) < 1e-9, `the awning is at ${shop.awning.scale.z.toFixed(2)}, not rolled in`);
  assert.ok(livePuffs(shop.smoke) > 0, 'the smokehouse went out at night');
  // A slider held in the gap between dusk and dawn moves nobody.
  m.userData.uniforms.uNight.value = (DUSK + DAWN) / 2;
  run(shop, 5);
  assert.equal(shop.mode, 'inside');
  m.userData.uniforms.uNight.value = 0;
  run(shop, 10);
  assert.equal(shop.mode, 'work');
  assert.equal(shop.awning.scale.z, 1, 'the awning stayed in');
  assert.ok(shop.figure.visible && shop.blows > blows, 'the morning came and he did not go back to work');
  assert.ok(livePuffs(shop.smoke) > 0);
  disposeButcher(shop);
});

test('two shops run the same frames the same way', () => {
  const go = () => {
    const { shop } = open();
    run(shop, 7);
    const out = [shop.mode, shop.blows, shop.slices.map((s) => [s.state, s.mesh.position.x, s.mesh.scale.x]), [...shop.smoke.instanceMatrix.array], shop.sign.rotation.x];
    disposeButcher(shop);
    return out;
  };
  assert.deepEqual(go(), go());
});
