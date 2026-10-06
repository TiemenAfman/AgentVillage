// Somebody else riding (web/js/peers.js, Plans/paard-in-plaats-van-fiets.md), with nothing new on
// the wire: RIDING (128) is the bit it always was, and what is under the rider is read off the
// body their page sent - a horse under an Adventurer, the bicycle under a Traveller - so a sea
// from before the horse needs nothing new, and the gait is mount.js's of the speed they go.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { MeshBasicMaterial, Scene } from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 10 })), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
};
const { createPeers } = await import('../web/js/peers.js');
const { normalizeAvatar } = await import('../web/js/avatar.js');
const { POSE } = await import('../lib/players.mjs');
const { LAG_MS } = await import('../web/js/timeline.js');
const { MOUNT } = await import('../web/js/mount.js');

function world(character) {
  const scene = new Scene();
  const peers = createPeers({ scene, material: new MeshBasicMaterial({ vertexColors: true }), terrain: { worldHeight: () => 0 } });
  peers.join({ id: 'ann', name: 'Ann', look: normalizeAvatar({ character }) });
  return { scene, peers };
}
// Riding north at `speed` a second, a sample every 100 ms ending just before the frame drawn.
function ride(peers, speed, n = 8) {
  const end = performance.now() - LAG_MS - 30;
  for (let i = 0; i < n; i++) {
    const t = end - (n - 1 - i) * 100;
    peers.snapshot([['ann', 0, 0, speed * (t / 1000), 0, POSE.RIDING | POSE.MOVING]], t);
  }
}
const horses = (scene) => scene.children.filter((o) => o.children.length === 7 && o.children.every((c) => c.type === 'Group')
  && o.visible && o.children.some((c) => c.children[0]?.geometry && c.position.y > 0.4));

test('an Adventurer riding is drawn on a horse, in the saddle', () => {
  const { scene, peers } = world('adventurer');
  ride(peers, 4);
  for (let i = 0; i < 30; i++) peers.update(1 / 60, { beat: 0 });
  const h = horses(scene);
  assert.equal(h.length, 1, 'no horse under the Adventurer');
  // The rider's rig (its origin at the soles) is lifted so the hips sit on the seat: with hips
  // about 0.25 over the soles, the origin stands near seat - 0.25 over the ground.
  let skinned = 0;
  const rider = scene.children.find((o) => { let k = 0; o.traverse((m) => { if (m.isSkinnedMesh) k++; }); skinned = k; return k > 0; });
  assert.ok(rider && skinned, 'no rider drawn');
  const y = rider.position.y;
  assert.ok(y > MOUNT.seat - 0.35 && y < MOUNT.seat, `rider's soles at ${y.toFixed(3)} for a seat at ${MOUNT.seat}`);
  peers.dispose();
});

test('a Traveller riding is drawn on his bicycle, and no horse', () => {
  const { scene, peers } = world('traveller');
  ride(peers, 4);
  for (let i = 0; i < 30; i++) peers.update(1 / 60, { beat: 0 });
  assert.equal(horses(scene).length, 0);
  peers.dispose();
});
