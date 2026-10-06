// The Traveller in the saddle (HORSEBACK in web/js/classic-avatar.js, step one of
// Plans/paard-in-plaats-van-fiets.md): the angles of the measured riding pose, and what they come
// to on the stable's horse (web/js/fauna.js saddleOf) at the size he rides it - the hips on the
// seat, the soles on the irons' treads and nothing of a leg inside the horse. Drawing only: no
// pose bit and nothing on the wire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { normalizeAvatar } = await import('../web/js/avatar.js');
const { createClassicAvatar, HORSEBACK } = await import('../web/js/classic-avatar.js');
const { saddleOf } = await import('../web/js/fauna.js');
const models = await import('../web/js/models.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

const DEG = Math.PI / 180;
const SADDLE = { moving: false, grounded: true, horseback: true };

function rider(pose = SADDLE) {
  const avatar = createClassicAvatar(normalizeAvatar({}), new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.add(avatar.object);
  for (let i = 0; i < 120; i++) avatar.update(pose, 1 / 60);
  root.updateMatrixWorld(true);
  return { avatar, root };
}
const at = (o) => o.getWorldPosition(new THREE.Vector3());
// Every vertex of the rig's skinned limbs where it is drawn, in the rig's own frame (soles at 0).
function limbVertices(avatar) {
  const out = [], v = new THREE.Vector3();
  avatar.object.traverse((m) => {
    if (!m.isSkinnedMesh || !m.visible) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      m.applyBoneTransform(i, v);
      out.push(v.applyMatrix4(m.matrixWorld).clone());
    }
  });
  return out;
}

test('the pose is the measured one, angle for angle', () => {
  // Plans/paard-in-plaats-van-fiets.md "De ruiterhouding, gemeten".
  for (const [key, deg] of [['lean', 15], ['thigh', 36], ['knee', 73], ['arm', 28], ['elbow', 51]]) {
    assert.ok(Math.abs(HORSEBACK[key] - deg * DEG) < 1e-9, `${key} is ${HORSEBACK[key] / DEG} degrees`);
  }
  const { avatar } = rider();
  for (const side of ['leftLeg', 'rightLeg']) {
    const c = avatar.joints[side];
    assert.ok(Math.abs(c.root.parent.parent.rotation.x + HORSEBACK.thigh) < 1e-3, `${side} forward ${c.root.parent.parent.rotation.x}`);
    assert.ok(Math.abs(Math.abs(c.root.parent.parent.rotation.z) - HORSEBACK.spread) < 1e-9, `${side} out ${c.root.parent.parent.rotation.z}`);
    assert.ok(Math.abs(c.bend.rotation.x - HORSEBACK.knee) < 1e-9, `${side} knee ${c.bend.rotation.x}`);
  }
  for (const side of ['leftArm', 'rightArm']) {
    const c = avatar.joints[side];
    assert.ok(Math.abs(c.root.parent.parent.rotation.x + HORSEBACK.arm) < 1e-3, `${side} forward ${c.root.parent.parent.rotation.x}`);
    assert.ok(Math.abs(c.bend.rotation.x + HORSEBACK.elbow) < 1e-9, `${side} elbow ${c.bend.rotation.x}`);
  }
});

test('the ankles hang under the hips, three hip-widths apart, and the hands meet at the reins', () => {
  const { avatar } = rider();
  const hips = ['leftLeg', 'rightLeg'].map((s) => at(avatar.joints[s].root));
  const ankles = ['leftLeg', 'rightLeg'].map((s) => at(avatar.joints[s].end));
  const hipWidth = hips[0].distanceTo(hips[1]);
  for (const [i, ankle] of ankles.entries()) {
    assert.ok(Math.abs(ankle.z - hips[i].z) < 0.02, `ankle ${ankle.z.toFixed(3)} against hip ${hips[i].z.toFixed(3)}`);
    assert.ok(ankle.y < hips[i].y - 0.07, 'the legs hang down');
  }
  const apart = Math.abs(ankles[0].x - ankles[1].x) / hipWidth;
  assert.ok(apart > 2.6 && apart < 3.4, `ankles ${apart.toFixed(2)} hip-widths apart`);
  const hands = ['leftArm', 'rightArm'].map((s) => at(avatar.handAttach[s]));
  const reins = hands[0].distanceTo(hands[1]);
  assert.ok(reins > 0.03 && reins < 0.1, `hands ${reins.toFixed(3)} apart`);
  for (const hand of hands) {
    assert.ok(hand.z > 0.04, `a hand in front of the hips: ${hand.z.toFixed(3)}`);
    assert.ok(hand.y > hips[0].y && hand.y < hips[0].y + 0.08, `a hand just over the hips: ${hand.y.toFixed(3)}`);
  }
  // The torso leans forward: the neck is ahead of the small of the back.
  let spine, neck;
  avatar.object.traverse((o) => { if (o.name === 'torso:spine') spine = at(o); if (o.name === 'torso:neck') neck = at(o); });
  assert.ok(neck.z - spine.z > 0.015, `neck ${neck.z.toFixed(3)} ahead of the spine ${spine.z.toFixed(3)}`);
});

test('on the stable\'s horse at its size the soles are on the irons and no leg is inside it', () => {
  const saddle = saddleOf();
  assert.ok(saddle && saddle.stirrup, 'the horse has a seat and irons');
  // Plans/paard-in-plaats-van-fiets.md: the seat round y 0.50, the irons round 0.30-0.32.
  assert.ok(saddle.seat > 0.45 && saddle.seat < 0.53, `seat ${saddle.seat}`);
  assert.ok(saddle.stirrup.y > 0.28 && saddle.stirrup.y < 0.33, `irons ${saddle.stirrup.y}`);
  const s = HORSEBACK.horse;
  const { avatar } = rider();
  // The rider's feet at y = 0 stand this high in the horse's frame, in the horse's units.
  const lift = saddle.seat * s + HORSEBACK.perch - avatar.hipY;
  // The legs below the top of the seat: the hips are HORSEBACK.perch over it, and where the
  // thighs leave them they sit on the cloth, which a slab of the solid cannot tell from a wall.
  const legs = limbVertices(avatar).filter((p) => p.y < avatar.hipY - HORSEBACK.perch);
  const sole = Math.min(...legs.map((p) => p.y)) + lift;
  assert.ok(sole >= saddle.stirrup.y * s - 0.002 && sole <= saddle.stirrup.top * s, `soles at ${sole.toFixed(3)}, irons ${(saddle.stirrup.y * s).toFixed(3)}-${(saddle.stirrup.top * s).toFixed(3)}`);
  // The horse's body as a solid: how far out it reaches either side in every 1 cm slab of
  // height and length - the barrel, the saddle and its flaps, the irons.
  const C = 0.01, half = new Map();
  for (const n of models.assetParts('fauna_horse').filter((n) => n.startsWith('fauna_horse body'))) {
    const { positions: p, at: o } = models.part(n);
    for (let i = 0; i < p.length; i += 3) {
      const key = Math.round((p[i + 1] + o[1]) / C) + ',' + Math.round((p[i + 2] + o[2]) / C);
      half.set(key, Math.max(half.get(key) || 0, Math.abs(p[i] + o[0])));
    }
  }
  const inside = legs.filter((p) => {
    const h = half.get(Math.round((p.y + lift) / s / C) + ',' + Math.round(p.z / s / C));
    return h && Math.abs(p.x) / s < h - 0.004;
  });
  assert.equal(inside.length, 0, `${inside.length} leg vertices inside the horse`);
});

test('out of the saddle the legs come back together, and the bicycle wins over the horse', () => {
  const { avatar } = rider();
  for (let i = 0; i < 120; i++) avatar.update({ moving: false, grounded: true }, 1 / 60);
  for (const side of ['leftLeg', 'rightLeg']) assert.equal(avatar.joints[side].root.parent.parent.rotation.z, 0);
  const bike = rider({ ...SADDLE, riding: { crank: 0 } }).avatar;
  for (const side of ['leftLeg', 'rightLeg']) assert.equal(bike.joints[side].root.parent.parent.rotation.z, 0);
});
