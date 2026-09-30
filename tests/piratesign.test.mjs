// The Salty Kraken's hanging sign (scripts/build-piratesign.py, web/js/piratesign.js).
//
// The promises worth a net: the arm is merged and never drawn twice, the board and the lantern
// hang on pivots that are where their chains and hook are, the sign lands with its wall
// anchor exactly on the point a building names whatever the turn, the swing stays small, and
// the lettering lies on the lettered planks and nowhere else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const sign = await import('../web/js/piratesign.js');
const { PIRATESIGN } = await import('../web/js/piratesign-mesh.js');
delete globalThis.document;
const { isPirateSignMoving, pirateSignGeometry, pirateSignParts, pirateSignFrame, attachPirateSign,
  updatePirateSign, disposePirateSign, swingAt, SWING, LINES } = sign;

const PARTS = Object.keys(PIRATESIGN.parts);
const bare = (n) => n.split(':')[0];

test('only the board, its kraken and planks, and the lantern move; the arm stays in the merge', () => {
  const moving = [...new Set(PARTS.filter(isPirateSignMoving).map(bare))].sort();
  assert.deepEqual(moving, ['piratesign lantern', 'piratesign swing board', 'piratesign swing kraken',
    'piratesign swing text 1', 'piratesign swing text 2', 'piratesign swing text 3', 'piratesign swing text 4']);
  assert.deepEqual([...new Set(PARTS.filter((n) => !isPirateSignMoving(n)).map(bare))], ['piratesign arm']);
  const kept = pirateSignParts({ at: [0, 1, 0] });
  assert.equal(kept.length, PARTS.filter((n) => !isPirateSignMoving(n)).length);
});

test('everything that swings on the board shares one pivot, under the arm, above the board', () => {
  const G = pirateSignGeometry();
  for (const n of PARTS.filter((p) => p.startsWith('piratesign swing'))) assert.deepEqual(PIRATESIGN.parts[n].at, G.board, n);
  const [ax, ay] = G.anchor;
  assert.ok(G.board[1] < ay && G.board[1] > Math.max(...G.planks.map((p) => p.hi[1])), 'the pivot is not between arm and board');
  assert.ok(G.lantern[0] > G.board[0] && G.lantern[1] === G.board[1], 'the lantern does not hang from the arm beyond the board');
  assert.equal(ax, 0, 'the anchor is not on the wall');
  // Nothing of the sign goes into the wall.
  for (const p of Object.values(PIRATESIGN.parts)) {
    for (let i = 0; i < p.positions.length; i += 3) assert.ok(p.positions[i] + p.at[0] >= -1e-6);
  }
});

test('the wall anchor lands on the point the building names, at any turn', () => {
  const at = [0.7949, 1.16, 0.4125];
  for (const yaw of [0, 0.0349, Math.PI / 2, -Math.PI / 2, 2.5]) {
    const f = pirateSignFrame(at, yaw);
    const root = new THREE.Object3D();
    root.position.set(f.x, f.y, f.z);
    root.rotation.y = f.ry;
    root.updateMatrixWorld();
    const p = new THREE.Vector3(...pirateSignGeometry().anchor).applyMatrix4(root.matrixWorld);
    assert.ok(p.distanceTo(new THREE.Vector3(...at)) < 1e-9, `yaw ${yaw}`);
    // And the arm points along the turned +x.
    const tip = new THREE.Vector3(1, 0, 0).applyEuler(root.rotation);
    assert.ok(Math.abs(tip.x - Math.cos(yaw)) < 1e-9 && Math.abs(tip.z + Math.sin(yaw)) < 1e-9);
  }
});

test('the moving parts hang once each, in the building material, and swing a little', () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const s = attachPirateSign(group, material, { at: [0, 1, 0], lettering: false });
  const meshes = [];
  s.root.traverse((o) => o.isMesh && meshes.push(o));
  assert.equal(meshes.length, 2, 'the board and the lantern, one mesh each');
  assert.ok(meshes.every((m) => m.material === material && m.castShadow));
  const moved = PARTS.filter(isPirateSignMoving).reduce((n, p) => n + PIRATESIGN.parts[p].positions.length / 9, 0);
  assert.equal(meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0), moved);
  let most = 0;
  for (let t = 0; t < 60; t += 0.1) {
    updatePirateSign(s, t);
    most = Math.max(most, Math.abs(s.board.rotation.x));
    assert.ok(Math.abs(s.lantern.rotation.x) <= SWING.lantern + 1e-9);
  }
  assert.ok(most > SWING.board * 0.5 && most <= SWING.board + 1e-9, `the board swings ${most}`);
  // The swing is the clock's alone: every screen fed the same time draws the same sign.
  assert.deepEqual(swingAt(12.3), swingAt(12.3));
  disposePirateSign(s);
  assert.equal(group.children.length, 0);
});

test('the lettering is one plane on each face of the lettered planks, and it swings with the board', () => {
  const drawn = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (t) => ({ width: t.length * 10 }) : k === 'fillText' ? (t) => drawn.push(t) : () => {}), set: () => true });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  try {
    const s = attachPirateSign(new THREE.Group(), new THREE.MeshStandardMaterial(), { at: [0, 1, 0] });
    assert.equal(s.letters.parent, s.board);
    assert.equal(s.letters.castShadow, false);
    for (const line of LINES) assert.ok(drawn.includes(line.text), line.text);
    const G = pirateSignGeometry();
    const pos = s.letters.geometry.attributes.position.array;
    const zs = new Set();
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] + G.board[0], y = pos[i + 1] + G.board[1];
      zs.add(Math.round((pos[i + 2] + G.board[2]) * 1e6));
      assert.ok(y >= Math.min(...G.planks.map((p) => p.lo[1])) - 1e-6 && y <= Math.max(...G.planks.map((p) => p.hi[1])) + 1e-6);
      assert.ok(x >= Math.min(...G.planks.map((p) => p.lo[0])) - 1e-6 && x <= Math.max(...G.planks.map((p) => p.hi[0])) + 1e-6);
    }
    assert.equal(zs.size, 2, 'a front and a back');
    for (const z of zs) assert.ok(Math.abs(z / 1e6) > Math.max(...G.planks.map((p) => p.hi[2])), 'the lettering is inside the planks');
    updatePirateSign(s, 0, 1);
    assert.ok(s.ink.color.r < 1 && s.ink.color.r > 0.3, 'the letters do not dim at night');
  } finally {
    delete globalThis.document;
  }
});
