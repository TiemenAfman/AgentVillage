// The animals, the stable and the countryside (scripts/build-fauna.py, build-stable.py,
// build-farmyard.py, build-bakery.py; web/js/fauna.js, stable.js, countryside.js;
// Plans/stal-en-veld.md).
//
// The promises: every animal is baked in the parts that move, each on its joint; an animal
// keeps to its patch - a horse to its sand, a duck to its pond - and stands on its ground; the
// same frames make the same field; the bees keep to their skeps; and the bakery's fire is drawn
// once, by countryside.js, not merged into the building as well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const stub = () => { globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) }; };
stub();
const { createAnimal, KINDS } = await import('../web/js/fauna.js');
const { attachStable, updateStable, paddockArea } = await import('../web/js/stable.js');
const { attachProp, updateProp, attachBakery, updateBakery, BEES } = await import('../web/js/countryside.js');
const { buildBuilding, meshAsset, isBakeryMoving } = await import('../web/js/buildings.js');
const { FAUNA } = await import('../web/js/fauna-mesh.js');
const { STABLE } = await import('../web/js/stable-mesh.js');
const { BAKERY } = await import('../web/js/bakery-mesh.js');
delete globalThis.document;

const FRAME = 1 / 60;
const material = (night = 0) => { const m = new THREE.MeshBasicMaterial(); m.userData.uniforms = { uNight: { value: night } }; return m; };
const baseNames = (asset) => [...new Set(FAUNA.assets[asset].parts.map((n) => n.split(':')[0].replace(`${asset} `, '')))].sort();

test('every animal is baked in the parts that move', () => {
  for (const kind of ['horse', 'cow']) {
    assert.deepEqual(baseNames(`fauna_${kind}`), ['body', 'head', 'leg bl', 'leg br', 'leg fl', 'leg fr', 'tail'], kind);
  }
  // The sheep made from a picture has its tail in its wool.
  assert.deepEqual(baseNames('fauna_sheep'), ['body', 'head', 'leg bl', 'leg br', 'leg fl', 'leg fr']);
  for (const kind of ['chicken', 'gull']) assert.deepEqual(baseNames(`fauna_${kind}`), ['body', 'head', 'leg l', 'leg r', 'wing l', 'wing r'], kind);
  assert.deepEqual(baseNames('fauna_duck'), ['body', 'head', 'wing l', 'wing r']);
  assert.deepEqual(Object.keys(KINDS).sort(), ['chicken', 'cow', 'duck', 'goat', 'gull', 'horse', 'pig', 'sheep', 'sparrow']);
  // On the wing: a body and two wings, hinged at the shoulders.
  assert.deepEqual(baseNames('fauna_sparrow_flying'), ['body', 'wing l', 'wing r']);
  assert.deepEqual(baseNames('fauna_sparrow'), ['body', 'head']);
  // The goat is cut out of a generated mesh, into the same parts as the drawn quadrupeds.
  assert.deepEqual(baseNames('fauna_goat'), ['body', 'head', 'leg bl', 'leg br', 'leg fl', 'leg fr', 'tail']);
});

test('each part turns about its joint: hips at the top of the legs, the neck at the front of the body', () => {
  const at = (asset, part) => FAUNA.parts[FAUNA.assets[asset].parts.find((n) => n.startsWith(`${asset} ${part}`))].at;
  for (const kind of ['horse', 'cow', 'sheep']) {
    const a = `fauna_${kind}`, head = at(a, 'head'), tail = kind === 'sheep' ? [0, 0, -1] : at(a, 'tail');
    for (const leg of ['fl', 'fr', 'bl', 'br']) {
      const hip = at(a, `leg ${leg}`);
      assert.ok(hip[1] > 0.08, `${kind} ${leg}: a hip ${hip[1]} off the ground is a foot, not a hip`);
      assert.equal(Math.sign(hip[2]), leg[0] === 'f' ? 1 : -1, `${kind} ${leg} is on the wrong end`);
      assert.equal(Math.sign(hip[0]), leg[1] === 'r' ? 1 : -1, `${kind} ${leg} is on the wrong side`);
    }
    assert.ok(head[2] > 0 && tail[2] < 0, `${kind} is back to front`);
  }
});

test('an animal keeps to its patch and stands on its ground', () => {
  stub();
  const area = { x: 2, z: -1, r: 0.6 };
  for (const kind of ['horse', 'cow', 'sheep', 'chicken']) {
    const a = createAnimal(kind, material(), { area, seed: `t:${kind}`, ground: () => 0.25 });
    let walked = 0, last = [a.x, a.z];
    for (let i = 0; i < 60 / FRAME; i++) {
      a.update(FRAME);
      assert.ok(Math.hypot(a.x - area.x, a.z - area.z) <= area.r + 1e-6, `${kind} wandered off to ${a.x}, ${a.z}`);
      assert.ok(Math.abs(a.object.position.y - 0.25) < 0.01, `${kind} is not on its ground`);
      walked += Math.hypot(a.x - last[0], a.z - last[1]);
      last = [a.x, a.z];
    }
    assert.ok(walked > 0.2, `${kind} stood still for a minute (${walked.toFixed(2)})`);
    a.dispose();
  }
  // A duck rides its water; a gull circles well over its patch.
  const duck = createAnimal('duck', material(), { area, ground: () => -0.1 });
  const gull = createAnimal('gull', material(), { area, ground: () => 0 });
  for (let i = 0; i < 20 / FRAME; i++) { duck.update(FRAME); gull.update(FRAME); }
  assert.ok(Math.abs(duck.object.position.y + 0.1) < 0.01);
  assert.ok(gull.object.position.y > 1, 'the gull came down');
  delete globalThis.document;
});

test('the same frames make the same field', () => {
  stub();
  const go = () => {
    const a = createAnimal('sheep', material(), { area: { x: 0, z: 0, r: 1 }, seed: 'same' });
    for (let i = 0; i < 20 / FRAME; i++) a.update(FRAME);
    return [a.x, a.z, a.yaw, a.mood, a.head.rotation.x, a.legs.map((l) => l.rotation.x)];
  };
  assert.deepEqual(go(), go());
  delete globalThis.document;
});

test('the horse keeps to the sand, and the stable brings it and two hens', () => {
  stub();
  const area = paddockArea();
  const sand = STABLE.parts['civic_stable_yard paddock'];
  assert.ok(area.x1 > area.x0 && area.z1 > area.z0, 'no room left on the sand');
  const stable = attachStable(new THREE.Scene(), [0, 0, 0], material());
  assert.deepEqual(stable.animals.map((a) => a.kind), ['horse', 'chicken', 'chicken']);
  const horse = stable.animals[0];
  let xs = [Infinity, -Infinity];
  for (let i = 0; i < 90 / FRAME; i++) {
    updateStable(stable, FRAME);
    assert.ok(horse.x >= area.x0 - 1e-6 && horse.x <= area.x1 + 1e-6 && horse.z >= area.z0 - 1e-6 && horse.z <= area.z1 + 1e-6, 'the horse is out of its paddock');
    xs = [Math.min(xs[0], horse.x), Math.max(xs[1], horse.x)];
  }
  // It uses the paddock, not one corner of it.
  assert.ok(xs[1] - xs[0] > (area.x1 - area.x0) * 0.3, `the horse kept to ${(xs[1] - xs[0]).toFixed(2)} of it`);
  assert.ok(sand.positions.length > 0);
  delete globalThis.document;
});

test('the bees keep to their skeps, and the reeds and the scarecrow lean but stay planted', () => {
  stub();
  const scene = new THREE.Scene();
  const hive = attachProp('beehive', scene, [0, 0, 0], material());
  const reeds = attachProp('reeds', scene, [1, 0, 0], material());
  const scare = attachProp('scarecrow', scene, [2, 0, 0], material());
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let leant = 0;
  for (let i = 0; i < 10 / FRAME; i++) {
    for (const x of [hive, reeds, scare]) updateProp(x, FRAME);
    for (let b = 0; b < BEES; b++) {
      hive.bees.getMatrixAt(b, m); m.decompose(p, q, s);
      assert.ok(Math.hypot(p.x, p.z) < 0.3 && p.y > 0.05 && p.y < 0.4, `a bee flew off to ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
    }
    leant = Math.max(leant, Math.abs(reeds.object.rotation.z));
    assert.deepEqual(scare.object.position.toArray(), [2, 0, 0], 'the scarecrow walked');
  }
  assert.ok(leant > 0.05, 'the reeds never moved');
  delete globalThis.document;
});

test('the bakery merges everything but its fire, which breathes and lights up at night', () => {
  stub();
  const kept = meshAsset('civic_bakery', 0xffffff, { skip: isBakeryMoving });
  const all = BAKERY.assets.civic_bakery.parts;
  assert.equal(kept.length, all.filter((n) => !isBakeryMoving(n)).length);
  assert.ok(all.some(isBakeryMoving), 'there is no fire to leave out');
  const built = buildBuilding({ id: 'c:bakery', kind: 'civic', civicType: 'bakery', tier: 'civic', style: 'unknown', ornaments: [] });
  assert.ok(built.animated.bakery && built.anchors.smoke);
  const day = attachBakery(new THREE.Scene(), [0, 0, 0], material(0));
  const night = attachBakery(new THREE.Scene(), [0, 0, 0], material(1));
  const glows = new Set();
  for (let i = 0; i < 5 / FRAME; i++) {
    updateBakery(day, FRAME); updateBakery(night, FRAME);
    glows.add(day.glow.geometry.attributes.aEmissive.array[0].toFixed(3));
  }
  assert.ok(glows.size > 10, 'the fire does not breathe');
  assert.ok(night.light.intensity > day.light.intensity * 3, 'the oven lights the night no more than the day');
  delete globalThis.document;
});
