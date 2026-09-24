import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
// buildings.js starts texture requests on import; geometry tests need no image IO.
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { figureGeometry, settlerLook, eyeHeight } = await import('../web/js/settlers.js');
const { createFigures, kindOf, styleOf } = await import('../web/js/settler-figures.js');
const { createWalk } = await import('../web/js/settler-walk.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;
const { HAT_SHAPES } = await import('../web/js/avatar.js');

// The glue web/js/settlers.js's createSettlers used to provide, before crowd-view.js took
// over walking every figure off the wire and nothing local called it any more. Kept here,
// not resurrected in production, because this test's job is still to catch a batching or
// instancing regression in createWalk/createFigures working together.
function createSettlers(scene, material, terrain) {
  const walk = createWalk(terrain);
  const view = createFigures(scene, material);
  const figures = walk.figures;

  function add(id, spec, worldPos, opts = {}) {
    if (figures.has(id)) return figures.get(id);
    const kind = kindOf(spec);
    const look = settlerLook(id, styleOf(spec), kind);
    const f = walk.spawn(id, spec, worldPos, opts, look.height);
    if (!view.enrol(f, look, kind)) { figures.delete(id); return null; }
    return f;
  }

  function remove(id) {
    const f = walk.setVisible(id, false);
    if (f) view.hide(f);
  }

  function update(dt, nightAmount) {
    walk.step(dt, nightAmount);
    view.draw(figures, dt);
  }

  return { add, remove, figures, update, pickables: view.pickables, figureAt: view.figureAt };
}

test('all resident hats render with finite normals and no expedition equipment', () => {
  for (const [presentation, outfit] of [['man','trousers'], ['woman','trousers'], ['woman','skirt']]) {
  for (const { id } of HAT_SHAPES) {
    const look = { ...settlerLook('resident', 'sonnet'), hatShape: id, presentation, outfit };
    const g = figureGeometry('sonnet', { look });
    g.computeBoundingBox();
    assert.equal(g.groups.length, 0);
    assert.equal(g.boundingBox.min.y, 0);
    assert.ok(g.boundingBox.max.y > eyeHeight({ look }));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < .29) assert.ok(p.getZ(i) > -.10, 'no backpack behind the resident');
    }
    assert.ok(g.attributes.position.count / 3 < 3000);
    for (const attribute of Object.values(g.attributes)) assert.ok(attribute.array.every(Number.isFinite));
    for (let i = 0; i < g.attributes.normal.count; i++) {
      const n = g.attributes.normal;
      assert.ok(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > .99, id);
    }
    g.dispose();
  }
  }
});

test('women are represented across roles with both skirts and trousers', () => {
  for (const kind of ['adult','apprentice','sailor']) {
    const looks = Array.from({ length: 1000 }, (_, i) => settlerLook(`population:${i}`, 'sonnet', kind));
    const women = looks.filter((look) => look.presentation === 'woman');
    assert.ok(women.length > 400 && women.length < 600);
    assert.ok(women.some((look) => look.outfit === 'skirt'));
    assert.ok(women.some((look) => look.outfit === 'trousers'));
    if (kind === 'sailor') assert.ok(looks.every((look) => look.hatShape === 'sailor'));
  }
});

test('women clothing and hair follow their owner and are hidden on other residents', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial();
  const view = createFigures(scene, material);
  const figures = new Map();
  for (const [id, presentation, outfit] of [['woman-skirt','woman','skirt'],['woman-trousers','woman','trousers'],['man','man','trousers']]) {
    const f = { id, visible: true, pos: [2,3], y: .2, yaw: .6, anim: 'walk', mode: 'walk', speed: 1 };
    view.enrol(f, { ...settlerLook(id,'sonnet'), presentation, outfit }, 'adult');
    figures.set(id,f);
  }
  const skirt=scene.getObjectByName('resident-skirts'), hair=scene.getObjectByName('resident-woman-hair');
  const actual=new THREE.Matrix4(), expected=new THREE.Matrix4();
  for (const dt of [.1,.2]) {
    view.draw(figures,dt);
    for (const f of figures.values()) {
      skirt.getMatrixAt(f.slot,actual);
      if (f.look.outfit === 'skirt') {
        scene.children[0].getMatrixAt(f.slot,expected);
        assert.deepEqual(actual.elements,expected.elements);
      } else assert.equal(actual.elements[13],-999);
      hair.getMatrixAt(f.slot,actual);
      if (f.look.presentation === 'woman') {
        scene.children[9].getMatrixAt(f.slot,expected);
        assert.deepEqual(actual.elements,expected.elements);
      } else assert.equal(actual.elements[13],-999);
    }
  }
  view.hide(figures.get('woman-skirt'));
  for (const mesh of [skirt,hair]) {
    mesh.getMatrixAt(0,actual);
    assert.equal(actual.elements[13],-999);
  }
  view.dispose();
  assert.equal(scene.children.length,0);
  material.dispose();
});

test('resident identity stays deterministic and sailors keep their uniform', () => {
  assert.deepEqual(settlerLook('same', 'fable'), settlerLook('same', 'fable'));
  assert.notDeepEqual(settlerLook('same', 'fable'), settlerLook('different', 'fable'));
  assert.equal(settlerLook('sailor', 'opus', 'sailor').hatShape, 'sailor');
  assert.ok(eyeHeight({ look: settlerLook('young', 'sonnet', 'apprentice'), baseScale: .62 }) < .30);
});

test('crowd batches stay constant, new skin and face parts track and hide with their owner', () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial();
  const terrain = { half: 32, size: 64, worldHeight: () => 0 };
  const settlers = createSettlers(scene, material, terrain);
  // Four chore batches (hoe, axe, rod, a bundle of sticks) and the gold bar carried home from
  // the gold pit (Plans/goudkuil.md) sit between the hats and the hammer, hidden outright while
  // nobody holds one - see createFigures.
  assert.equal(scene.children.length, 25, 'eleven articulated body, two appearance layers, six hats, four chore tools, one gold bar, one hammer batch');
  for (let i = 0; i < 100; i++) settlers.add(`resident:${i}`, { style: 'sonnet', kind: 'hut' }, [i,0,0]);
  const walker = settlers.figures.get('resident:0');
  walker.mode = 'walk'; walker.path = [[0, 0], [2, 0]]; walker.pathI = 0; walker.pos = [0, 0];
  settlers.update(0.1, 0);
  assert.equal(scene.children.length, 25, 'no mesh per person');
  const [torso, trim, leftLeg, rightLeg, leftArm, rightArm, leftHand, rightHand, skinCore, head, details] = scene.children;
  const body = [torso, trim, leftLeg, rightLeg, leftArm, rightArm, leftHand, rightHand, skinCore, head, details];
  for (const mesh of body) assert.equal(mesh.count, 100);
  for (const mesh of [leftHand, rightHand, skinCore]) {
    assert.deepEqual([...head.instanceColor.array], [...mesh.instanceColor.array]);
  }
  for (const mesh of [leftArm, rightArm]) assert.deepEqual([...torso.instanceColor.array], [...mesh.instanceColor.array]);
  for (const mesh of [leftLeg, rightLeg]) assert.deepEqual([...trim.instanceColor.array], [...mesh.instanceColor.array]);
  assert.deepEqual([...torso.instanceMatrix.array], [...trim.instanceMatrix.array]);
  const torsoPose = new THREE.Matrix4(), legPose = new THREE.Matrix4(), otherLegPose = new THREE.Matrix4();
  torso.getMatrixAt(0, torsoPose); leftLeg.getMatrixAt(0, legPose); rightLeg.getMatrixAt(0, otherLegPose);
  assert.notDeepEqual(torsoPose.elements, legPose.elements);
  assert.notDeepEqual(legPose.elements, otherLegPose.elements);
  assert.deepEqual([...head.instanceMatrix.array], [...details.instanceMatrix.array]);
  assert.deepEqual(settlers.pickables(), [torso, head]);
  assert.equal(settlers.figureAt(head, 3).id, 'resident:3');
  settlers.remove('resident:3');
  assert.equal(settlers.figureAt(head, 3), null);
  const matrix = new THREE.Matrix4();
  for (const mesh of body) {
    mesh.getMatrixAt(3, matrix);
    assert.equal(matrix.elements[13], -999);
  }
  for (const mesh of scene.children) mesh.geometry.dispose();
  material.dispose();
});

test('working hammers stay in the posed hand for every body size and beyond sixty builders', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial();
  const view = createFigures(scene, material);
  const figures = new Map();
  for (let i = 0; i < 80; i++) {
    const f = { id: `builder:${i}`, visible: true, pos: [i, -i], y: 0.4,
      yaw: i * 0.37, anim: 'hammer', mode: 'hammer' };
    view.enrol(f, settlerLook(f.id, 'sonnet'), i % 2 ? 'apprentice' : 'settler');
    figures.set(f.id, f);
  }
  const hand = scene.children[7], hammers = scene.children.at(-1);
  for (const dt of [0, 0.17, 0.31, 0.49]) {
    view.draw(figures, dt);
    assert.equal(hammers.count, figures.size);
    for (const f of figures.values()) {
      const handPose = new THREE.Matrix4(), hammerPose = new THREE.Matrix4();
      hand.getMatrixAt(f.slot, handPose);
      hammers.getMatrixAt(f.slot, hammerPose);
      const grip = new THREE.Vector3(0.113, 0.19, 0.015);
      assert.ok(grip.clone().applyMatrix4(handPose).distanceTo(grip.clone().applyMatrix4(hammerPose)) < 1e-6);
      assert.deepEqual(hammerPose.elements, handPose.elements, 'the tool follows the full hand rotation and scale');
      const vertices = hammers.geometry.attributes.position;
      const head = new THREE.Vector3();
      // The head is the second box: measure the actual geometry, not just its pose.
      for (let i = 36; i < vertices.count; i++) head.add(new THREE.Vector3().fromBufferAttribute(vertices, i));
      head.divideScalar(vertices.count - 36).applyMatrix4(hammerPose);
      const fromHand = head.sub(grip.clone().applyMatrix4(handPose));
      assert.ok(fromHand.dot(new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw))) > .015,
        'the hammer head stays in front of the fist, away from the shoulder');
      assert.ok(fromHand.y > .015, 'the head is raised above the grip');
    }
  }
  view.dispose();
  material.dispose();
});
