// The smithy (scripts/build-smithy.py, web/js/smithy.js, Plans/smidse.md).
//
// The promises: the building never draws a moving part twice; the smith works by day and goes
// in at night by the door, never through a wall, and comes back out in the morning; sparks fly
// only off a blow; and the fire, once he has gone in, dies back to an afterglow rather than out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const stub = () => { globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) }; };
stub();
const { buildBuilding, meshAsset, isSmithyMoving } = await import('../web/js/buildings.js');
const { attachSmithy, updateSmithy, disposeSmithy, smithyGeometry, AFTERGLOW, DUSK, DAWN } = await import('../web/js/smithy.js');
const { SMITHY } = await import('../web/js/smithy-mesh.js');
delete globalThis.document;

const YARD = SMITHY.assets.civic_smithy_yard.parts;
const tris = (names) => names.reduce((n, p) => n + SMITHY.parts[p].positions.length / 9, 0);
const FRAME = 1 / 60;

// The shared building material's uNight, which is what the smithy reads the night off.
function material(night = 0) {
  const m = new THREE.MeshBasicMaterial();
  m.userData.uniforms = { uNight: { value: night } };
  return m;
}
function run(smithy, seconds) {
  for (let i = 0; i < Math.round(seconds / FRAME); i++) updateSmithy(smithy, FRAME);
}
const liveChips = ({ im }) => {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); m.decompose(p, q, s); if (s.x > 0) n++; }
  return n;
};

test('the moving parts are the bellows, the fire and the lantern, and only those', () => {
  const moving = [...new Set(YARD.filter(isSmithyMoving).map((n) => n.split(':')[0].replace('civic_smithy_yard ', '')))].sort();
  assert.deepEqual(moving, ['bellows', 'coals', 'lantern']);
  assert.equal(SMITHY.assets.civic_smithy.parts.filter(isSmithyMoving).length, 0);
  assert.ok(!isSmithyMoving('civic_smithy_yard anvil:0'), 'the anvil is measured, not moved');
  stub();
  const kept = meshAsset('civic_smithy_yard', 0xffffff, { skip: isSmithyMoving });
  const built = buildBuilding({ id: 'c:smithy', kind: 'civic', civicType: 'smithy', tier: 'civic', style: 'unknown', ornaments: [] });
  delete globalThis.document;
  assert.equal(kept.reduce((n, g) => n + g.attributes.position.count / 3, 0), tris(YARD.filter((n) => !isSmithyMoving(n))));
  assert.ok(built.animated.smithy && built.anchors.smoke && built.anchors.door);
  built.geometry.dispose();
});

test('the smith has somewhere to stand and a way in', () => {
  const G = smithyGeometry();
  // He stands beside the anvil, within a hammer's reach of its face.
  const reach = Math.hypot(G.work[0] - G.anvil[0], G.work[2] - G.anvil[2]);
  assert.ok(reach > 0.08 && reach < 0.25, `he stands ${reach.toFixed(2)} from the anvil`);
  // His way to the door starts where he works and ends at the door, and it leaves the lean-to by
  // its open front: every leg but the first and last runs in front of the house's front wall.
  assert.deepEqual(G.path[0], G.work);
  assert.deepEqual(G.path.at(-1), [G.door[0], 0, G.door[2]]);
  const front = Math.max(...SMITHY.parts['civic_smithy walls'].positions.filter((_, i) => i % 3 === 2));
  for (const p of G.path.slice(1, -1)) assert.ok(p[2] > front, `a turn at z = ${p[2]} is inside the house`);
});

test('by day he strikes, and sparks fly only off a blow', () => {
  stub();
  const scene = new THREE.Scene();
  const smithy = attachSmithy(scene, [0, 0, 0], material(0));
  delete globalThis.document;
  let sparked = 0, blows = 0, lastBlows = 0, sparkFreeBeforeFirst = true;
  for (let i = 0; i < Math.round(8 / FRAME); i++) {
    updateSmithy(smithy, FRAME);
    if (smithy.blows === 0 && liveChips(smithy.sparks) > 0) sparkFreeBeforeFirst = false;
    if (liveChips(smithy.sparks) > 0) sparked++;
    if (smithy.blows > lastBlows) { blows++; lastBlows = smithy.blows; }
  }
  assert.equal(smithy.mode, 'work');
  assert.ok(smithy.figure.visible);
  assert.ok(blows >= 6, `only ${blows} blows in eight seconds`);
  assert.ok(sparked > 0 && sparkFreeBeforeFirst, 'sparks without a blow, or none at all');
  assert.ok(smithy.heat > 0.95, 'the fire is not hot while he works');
  disposeSmithy(smithy);
  assert.equal(scene.children.length, 0);
});

test('at night he goes in by the door and the fire dies back, but never out; at dawn he comes back', () => {
  stub();
  const m = material(0);
  const smithy = attachSmithy(new THREE.Scene(), [0, 0, 0], m);
  delete globalThis.document;
  run(smithy, 2);
  m.userData.uniforms.uNight.value = (DUSK + 1) / 2;
  let closest = Infinity;
  for (let i = 0; i < Math.round(8 / FRAME); i++) {
    updateSmithy(smithy, FRAME);
    const G = smithy.G, p = smithy.figure.position;
    if (smithy.figure.visible) closest = Math.min(closest, Math.hypot(p.x - G.door[0], p.z - G.door[2]));
  }
  assert.equal(smithy.mode, 'inside');
  assert.ok(!smithy.figure.visible, 'the smith is still standing outside');
  assert.ok(closest < 0.02, `he vanished ${closest.toFixed(2)} from the door`);
  const blows = smithy.blows;
  run(smithy, 90);
  assert.equal(smithy.blows, blows, 'he struck the anvil from inside');
  assert.ok(Math.abs(smithy.heat - AFTERGLOW) < 0.05 && smithy.heat > 0, `the fire is at ${smithy.heat.toFixed(2)}, not an afterglow`);
  assert.ok(smithy.bellows.rotation.z === 0, 'the bellows are pumping with nobody there');
  // A slider held in the gap between dusk and dawn moves nobody.
  m.userData.uniforms.uNight.value = (DUSK + DAWN) / 2;
  run(smithy, 5);
  assert.equal(smithy.mode, 'inside');
  m.userData.uniforms.uNight.value = 0;
  run(smithy, 8);
  assert.equal(smithy.mode, 'work');
  assert.ok(smithy.figure.visible && smithy.blows > blows, 'the morning came and he did not go back to work');
  disposeSmithy(smithy);
});

test('two smithies run the same frames the same way', () => {
  stub();
  const go = () => {
    const smithy = attachSmithy(new THREE.Scene(), [0, 0, 0], material(0));
    run(smithy, 6);
    const out = [smithy.mode, smithy.blows, smithy.heat, [...smithy.sparks.im.instanceMatrix.array], smithy.lantern.rotation.z];
    disposeSmithy(smithy);
    return out;
  };
  assert.deepEqual(go(), go());
  delete globalThis.document;
});
