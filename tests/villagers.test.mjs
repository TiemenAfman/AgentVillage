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
  for (const { id } of HAT_SHAPES) {
    const look = { ...settlerLook('resident', 'sonnet'), hatShape: id };
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
  // The gold bars (a bar carried home from the gold pit, Plans/goudkuil.md) are one more
  // batch, and like the pints they cost no draw call while nobody is carrying one.
  assert.equal(scene.children.length, 20, 'eleven articulated body, six hats, one hammer batch, one pint batch, one gold-bar batch');
  for (let i = 0; i < 100; i++) settlers.add(`resident:${i}`, { style: 'sonnet', kind: 'hut' }, [i,0,0]);
  const walker = settlers.figures.get('resident:0');
  walker.mode = 'walk'; walker.path = [[0, 0], [2, 0]]; walker.pathI = 0; walker.pos = [0, 0];
  settlers.update(0.1, 0);
  assert.equal(scene.children.length, 20, 'no mesh per person');
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

// Plans/bier-en-dronken.md: a settler with a few beers in them zigzags round the route the sea
// walks them along - drawn, never moved: `f.pos` stays the sea's - and stands nearly still
// again when they stop, without jumping back onto the route.
test('a drunk settler zigzags round their route on the move and not off it standing', () => {
  const scene = new THREE.Scene();
  const view = createFigures(scene, new THREE.MeshStandardMaterial());
  const f = { id: 'house:tipsy', pos: [0, 0], y: 0, yaw: 0, anim: 'walk', mode: 'walk', speed: 0.5, face: null, turn: 0.2, faceAngle: 0, visible: true, sway: 1 };
  assert.ok(view.enrol(f, settlerLook(f.id, 'sonnet', 'house'), 'house'));
  const torso = scene.children[0], m = new THREE.Matrix4(), at = new THREE.Vector3();
  const figures = new Map([[0, f]]);
  const side = () => { torso.getMatrixAt(f.slot, m); at.setFromMatrixPosition(m); return at.x; };   // yaw 0: sideways is x
  let widest = 0;
  for (let i = 0; i < 400; i++) { view.draw(figures, 0.05); widest = Math.max(widest, Math.abs(side())); }
  assert.ok(widest > 0.12, 'a drunk walks a straight line: ' + widest);
  assert.deepEqual(f.pos, [0, 0], 'the zigzag moved the body itself');
  // Standing, the zigzag eases away: a sway of a few centimetres is all that is left.
  f.anim = 'still'; f.mode = 'idle';
  let jump = 0, last = side();
  for (let i = 0; i < 100; i++) { view.draw(figures, 0.05); jump = Math.max(jump, Math.abs(side() - last)); last = side(); }
  assert.ok(Math.abs(side()) < 0.06, 'still off the route standing: ' + side());
  assert.ok(jump < 0.03, 'snapped back onto the route: ' + jump);
  // Sober, nothing at all.
  f.sway = 0; f.anim = 'walk'; f.mode = 'walk';
  for (let i = 0; i < 60; i++) view.draw(figures, 0.05);
  assert.ok(Math.abs(side()) < 1e-9, 'a sober settler wandered off the route: ' + side());
  view.dispose();
});
