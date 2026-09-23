// Hovering somebody on a visiting island: which body the ray finds, and what the label says.
//
// web/js/guest-pick.js picks by where crowd-view last drew a figure rather than through its
// mesh, because a guard near the camera is a skinned imp and not an instance at all. These
// hold the arithmetic and the one promise of the label: it names, and never shows an id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { nearestOnRay, guestLabel } = await import('../web/js/guest-pick.js');

const body = (id, x, z, extra = {}) => ({ id, pos: [x, z], y: 0, to: [x, z], hidden: false, ...extra });
const crowd = (...fs) => new Map(fs.map((f, i) => [i, f]));
// Looking straight down -z from the height of a middle.
const o = { x: 0, y: 0.25, z: 10 };
const d = { x: 0, y: 0, z: -1 };

test('the nearest body on the ray wins, not the first in the crowd', () => {
  const far = body('house:s1', 0, 0), near = body('house:s2', 0.05, 5);
  const h = nearestOnRay(crowd(far, near), o, d, 50);
  assert.equal(h.f, near);
  assert.ok(Math.abs(h.t - 5) < 1e-9);
});

test('a body off to the side, behind the eye or past maxT is nobody', () => {
  assert.equal(nearestOnRay(crowd(body('house:s1', 1, 0)), o, d, 50).f, null);
  assert.equal(nearestOnRay(crowd(body('house:s1', 0, 20)), o, d, 50).f, null);
  assert.equal(nearestOnRay(crowd(body('house:s1', 0, 0)), o, d, 5).f, null);
});

test('a body not yet placed, or filtered out, is not picked; an imp guard is', () => {
  assert.equal(nearestOnRay(crowd(body('house:s1', 0, 0, { to: null })), o, d, 50).f, null);
  assert.equal(nearestOnRay(crowd(body('house:s1', 0, 0, { hidden: true })), o, d, 50).f, null);
  // crowd-view writes visible = false for every guard standing as an imp.
  const g = body('guard:3', 0, 0, { visible: false });
  assert.equal(nearestOnRay(crowd(g), o, d, 50).f, g);
});

test('a guard is the bigger target, the size of the imp he may be drawn as', () => {
  const off = 0.3;   // past a settler's reach, inside a guard's
  assert.equal(nearestOnRay(crowd(body('house:s1', off, 0)), o, d, 50).f, null);
  assert.ok(nearestOnRay(crowd(body('guard:1', off, 0)), o, d, 50).f);
});

const volcano = { name: 'De Vulkaan', keeper: 'the sea' };
const fleet = [{ id: 'abcdef0123456789', name: 'Tiemenholm', keeper: 'Tiemen' }];

test('labels: a guard, a Codex settler with a house, a lodger, an unknown keeper', () => {
  assert.equal(guestLabel(body('guard:4', 0, 0), volcano, fleet).name, 'Guard of De Vulkaan');
  const housed = guestLabel(body('codex:abcdef0123456789:house:s3', 0, 0, { spec: { kind: 'house', tier: 'cottage' } }), volcano, fleet);
  assert.deepEqual(housed, { name: 'Codex settler of Tiemen', sub: 'from Tiemenholm · lives in a cottage' });
  const lodger = guestLabel(body('codex:abcdef0123456789:house:s4', 0, 0, { spec: { kind: 'civic' } }), volcano, fleet);
  assert.equal(lodger.sub, 'from Tiemenholm · lodges at the guardhouse');
  const stranger = guestLabel(body('codex:ffffffffffffffff:house:s1', 0, 0), volcano, fleet);
  assert.equal(stranger.name, 'Codex settler');
});

test('a label never carries an id', () => {
  const ids = ['guard:4', 'codex:abcdef0123456789:house:s3', 'house:s9'];
  for (const id of ids) {
    const l = guestLabel(body(id, 0, 0, { spec: { kind: 'house' } }), volcano, fleet);
    for (const part of [l.name, l.sub]) {
      assert.ok(!part.includes(id) && !/abcdef0123456789|house:s|guard:/.test(part), `${id} -> ${part}`);
    }
  }
  assert.deepEqual(guestLabel(body('house:s9', 0, 0), { name: 'Tiemenholm', keeper: true }, fleet),
    { name: 'Settler of Tiemenholm', sub: '' });
});
