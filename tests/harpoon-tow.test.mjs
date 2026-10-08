// A ship on a harpoon's line (web/js/harpoon-tow.js, Plans/harpoen.md): drawn to the hook while it is
// reeled in, never further from it than the line, swung bow-on to it, and making way across it she
// goes round it instead of stopping dead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { towHull, TOW_SPEED } from '../web/js/harpoon-tow.js';

const DT = 1 / 60;
const hook = { x: 0, z: 0 };

test('a slack line does nothing', () => {
  const b = { x: 5, z: 0, yaw: 1, v: 2 };
  assert.equal(towHull(b, hook, 10, DT), false);
  assert.deepEqual(b, { x: 5, z: 0, yaw: 1, v: 2 });
});

test('reeled in, she is drawn to the hook bow first, at no more than the tow speed', () => {
  const b = { x: 20, z: 0, yaw: 0, v: 0 };          // abeam: her bow points along +z
  let L = 20;
  for (let i = 0; i < 60 * 8; i++) {
    L = Math.max(6, L - 4 * DT);
    towHull(b, hook, L, DT, L > 6);
    b.x += Math.sin(b.yaw) * b.v * DT; b.z += Math.cos(b.yaw) * b.v * DT;
    assert.ok(b.v <= TOW_SPEED + 1e-9);
  }
  assert.ok(Math.hypot(b.x, b.z) <= 6.2, `at ${Math.hypot(b.x, b.z)}`);
  const bow = Math.atan2(-b.x, -b.z);
  assert.ok(Math.abs(((b.yaw - bow + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3, 'bow-on to the hook');
});

test('making way across a taut line she goes round it', () => {
  const b = { x: 10, z: 0, yaw: 0, v: 6 };
  let turned = 0, px = b.x, pz = b.z;
  for (let i = 0; i < 60 * 10; i++) {
    towHull(b, hook, 10, DT, false);
    b.x += Math.sin(b.yaw) * b.v * DT; b.z += Math.cos(b.yaw) * b.v * DT;
    turned += Math.abs(Math.atan2(px * b.z - pz * b.x, px * b.x + pz * b.z));
    px = b.x; pz = b.z;
    assert.ok(Math.hypot(b.x, b.z) < 10.3);
  }
  assert.ok(turned > Math.PI / 2, `went round ${turned}`);
});
