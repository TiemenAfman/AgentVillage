// Somebody else diving (web/js/peers.js, Plans/onderwater-zwemmen.md), with nothing new on the
// wire: a swimmer whose sent `y` is well under the surface is a diver, drawn on that `y` - and a
// page from before diving, which sends -0.07 for every swimmer, is still drawn afloat.
//
// The promises: a diver is where they said they were, never above the surface (the timeline
// extrapolates past the newest sample) and never in the bed; the body tips head-down on a
// descent and head-up on a climb, off the samples alone; the things that react to a diver
// (bubbles, fish) can ask who is down there.
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
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');
const { POSE } = await import('../lib/players.mjs');
const { SWIM_PITCH, DIVE_DOWN } = await import('../web/js/diving.js');
const { LAG_MS } = await import('../web/js/timeline.js');

const SWIMMING = POSE.SWIMMING;
const MOVING = POSE.MOVING;

function world(bed = -2.5) {
  const scene = new Scene();
  const peers = createPeers({
    scene, material: new MeshBasicMaterial({ vertexColors: true }),
    // The floor the page knows: flat water at `bed`, and no bedAt, so the ground is the bed.
    terrain: { worldHeight: () => bed },
  });
  peers.join({ id: 'ann', name: 'Ann', look: DEFAULT_AVATAR });
  const group = () => scene.children.find((o) => o.isGroup || o.type === 'Group' || o.type === 'Object3D');
  return { scene, peers, group };
}

// Two samples 100 ms apart that end `lag` ms before the frame we draw, so the frame lands just
// past the newest one, as it does on a live page.
function pose(peers, ys, f = SWIMMING | MOVING, at = performance.now() - LAG_MS - 30) {
  const step = 100;
  ys.forEach((y, i) => peers.snapshot([['ann', 0, y, 0, 0, f]], at - (ys.length - 1 - i) * step));
}
const settle = (peers, frames = 120) => { for (let i = 0; i < frames; i++) peers.update(1 / 60, { beat: 0 }); };

test('a swimmer sent well under the surface is drawn there, as a diver', () => {
  const { peers, group } = world();
  pose(peers, [-1.5, -1.5]);
  settle(peers);
  const g = group();
  assert.ok(Math.abs(g.position.y - -1.5) < 0.05, `a diver at -1.5 is drawn at ${g.position.y}`);
  const list = peers.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].swimming, true);
  assert.equal(list[0].diving, true);
  peers.dispose();
});

test('a swimmer sent at the surface, as every older page sends them, is drawn afloat and is no diver', () => {
  const { peers, group } = world();
  pose(peers, [-0.07, -0.07]);
  settle(peers);
  assert.ok(Math.abs(group().position.y - -0.07) < 0.04, `drawn at ${group().position.y}`);
  assert.equal(peers.list()[0].diving, false);
  assert.deepEqual(peers.divers(), []);
  peers.dispose();
});

test('a swimmer sent below the surface by less than a hand is still afloat', () => {
  const { peers } = world();
  pose(peers, [-0.16, -0.16]);
  settle(peers);
  assert.equal(peers.list()[0].diving, false, 'the swell and a rounded y read as a dive');
  peers.dispose();
});

test('a diver is never drawn above the surface, even when the timeline extrapolates a climb', () => {
  const { peers, group } = world();
  // Coming up fast and last heard 150 ms ago: the extrapolation carries on past the surface.
  pose(peers, [-1.0, -0.25], SWIMMING | MOVING, performance.now() - LAG_MS - 150);
  for (let i = 0; i < 30; i++) {
    peers.update(1 / 60, { beat: 0 });
    assert.ok(group().position.y <= -0.07 + 0.031, `a climbing diver is drawn at ${group().position.y}, over the water`);
  }
  peers.dispose();
});

test('a diver is never drawn in the bed', () => {
  const { peers, group } = world(-1.0);
  pose(peers, [-3, -3]);
  settle(peers);
  assert.ok(group().position.y >= -1.0 + 0.05 - 0.031, `drawn at ${group().position.y} in a bed at -1`);
  peers.dispose();
});

test('the body tips head-down on a descent and head-up on a climb, and lies level when hanging', () => {
  const rotation = (ys) => {
    const { peers, group } = world();
    for (let i = 0; i < 3; i++) pose(peers, ys);
    settle(peers, 240);
    const x = group().rotation.x;
    peers.dispose();
    return x;
  };
  const down = rotation([-0.6, -1.2]);
  const up = rotation([-1.2, -0.6]);
  const still = rotation([-1.0, -1.0]);
  assert.ok(down > SWIM_PITCH + 0.4, `descending: ${down}`);
  assert.ok(up < SWIM_PITCH - 0.3, `climbing: ${up}`);
  assert.ok(Math.abs(still - SWIM_PITCH) < 0.15, `hanging: ${still}`);
  assert.ok(DIVE_DOWN > 0);
});

test('the bubbles and the fish can ask who is under the water, and where', () => {
  const { peers } = world();
  pose(peers, [-1.8, -1.8]);
  settle(peers);
  const divers = peers.divers();
  assert.equal(divers.length, 1);
  assert.equal(divers[0].id, 'ann');
  assert.ok(Math.abs(divers[0].y - -1.8) < 0.05);
  assert.equal(divers[0].moving, true);
  // Somebody who has gone back up to the sky is nobody's.
  peers.snapshot([]);
  peers.update(1, { beat: 0 });
  assert.deepEqual(peers.divers(), []);
  peers.dispose();
});

test('a swimmer on a boat or a deck is not a diver whatever y they sent', () => {
  const { peers } = world();
  peers.snapshot([['ann', 0, -3, 0, 0, SWIMMING, 'boat']]);
  peers.snapshot([['ann', 0, -3, 0, 0, SWIMMING, 'boat']]);
  settle(peers, 5);
  assert.equal(peers.list().length === 0 || peers.list()[0].diving === false, true);
  peers.dispose();
});
