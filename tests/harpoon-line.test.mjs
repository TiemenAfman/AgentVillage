// One harpoon's line on the page (web/js/harpoon-line.js, Plans/harpoen.md): fired, it flies on its
// line and hooks the shore or a target - and keeps hold of a target that moves - is reeled in by
// itself, and from the water it comes home and is stowed. The rope is drawn only while it is out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
const { createHarpoonLine, TICK } = await import('../web/js/harpoon-line.js');
const { REEL_MIN } = await import('../shared/harpoon.mjs');

const MOUTH = { x: 0, y: 2, z: 0 };
const shore = (x) => (x > 12 ? 2 : -2);           // land from x 12 on
const run = (line, s, mouth = MOUTH) => { for (let i = 0; i < Math.round(s / TICK); i++) line.update(mouth, TICK); };

test('stowed it draws nothing; fired at the shore it hooks the land and reels in by itself', () => {
  const line = createHarpoonLine({ world: { ground: shore } });
  line.update(MOUTH, TICK);
  assert.equal(line.mesh.visible, false);
  assert.equal(line.fire(MOUTH, { x: 0.97, y: 0.24, z: 0 }), true);
  assert.equal(line.fire(MOUTH, { x: 1, y: 0, z: 0 }), false, 'one line out at a time');
  run(line, 2);
  assert.equal(line.state, 'hooked');
  const h = line.hooked();
  assert.equal(h.kind, 'land');
  assert.ok(h.x >= 12, `on the shore (${h.x})`);
  assert.equal(line.mesh.visible, true);
  const before = line.L;
  run(line, 1);
  assert.ok(line.L < before, 'the reel takes line in by itself');
  run(line, 20);
  assert.equal(line.L, REEL_MIN);
  assert.ok(line.cues.clicks > 10 && line.cues.fired === 1 && line.cues.hooked === 1);
});

test('a hooked target that moves takes the hook with it', () => {
  const statue = { id: 'statue', kind: 'statue', x: 8, y: 1.2, z: 0, r: 0.6, at(o) { o.x = this.x; o.y = this.y; o.z = this.z; return o; } };
  const line = createHarpoonLine({ world: { ground: () => -3, targets: () => [statue] } });
  line.fire(MOUTH, { x: 0.995, y: -0.1, z: 0 });
  run(line, 1.5);
  assert.equal(line.state, 'hooked');
  assert.equal(line.hooked().id, 'statue');
  statue.x = 5; statue.z = 1;
  run(line, TICK);
  assert.ok(Math.abs(line.hooked().x - statue.x) < 0.7 && Math.abs(line.hooked().z - 1) < 0.7, 'the hook went with her');
});

test('into the water the bolt comes home and is stowed; let go, a hooked one does too', () => {
  const line = createHarpoonLine({ world: { ground: () => -3 } });
  line.fire(MOUTH, { x: 0.9, y: -0.43, z: 0 });
  run(line, 1);
  assert.notEqual(line.state, 'hooked');
  run(line, 10);
  assert.equal(line.state, 'stowed');
  assert.equal(line.mesh.visible, false);

  const held = createHarpoonLine({ world: { ground: shore } });
  held.fire(MOUTH, { x: 0.97, y: 0.24, z: 0 });
  run(held, 2);
  held.release();
  assert.equal(held.hooked(), null);
  run(held, 15);
  assert.equal(held.state, 'stowed');
});

test('the rope is drawn between the mouth and the bolt', () => {
  const line = createHarpoonLine({ world: { ground: shore } });
  line.fire(MOUTH, { x: 0.97, y: 0.24, z: 0 });
  run(line, 2);
  const p = line.mesh.geometry.attributes.position;
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < p.count; i++) { minX = Math.min(minX, p.getX(i)); maxX = Math.max(maxX, p.getX(i)); }
  assert.ok(minX < 0.05 && maxX > 11.9, `${minX}..${maxX}`);
  for (const v of p.array) assert.ok(Number.isFinite(v));
});
