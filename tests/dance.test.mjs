// Dancing yourself (Plans/DONE/dansen.md): R, or the D-pad up, and the player's rig dances the dance
// the settlers on the castle's floor dance, to the beat of whatever this screen plays; the sea
// relays one bit (tests/player-look.test.mjs holds that half) and every page works the move out
// for itself from the dancer's id.
//
// The promises: one copy of the moves for both rigs; a dancer's moves are theirs, the same on
// every screen, never the DJ's, with everybody's hands up in the build's last bar; the rig puts
// the arms where the move says and the body on the beat, and lets go of both when the dance
// ends; it does not dance sitting, lying, swimming, on a bike or in first person; and the
// controller's dance button is a button nothing else on foot already uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { MeshBasicMaterial } from 'three';
register('./support/shared-loader.mjs', import.meta.url);

// peers.js paints each nameplate on a 2D canvas; a context that accepts every call is enough.
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 10 })), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
};
const { dancePose, danceStep, wallBeat, clockBeat } = await import('../web/js/dance.js');
const figures = await import('../web/js/settler-figures.js');
const { createClassicAvatar } = await import('../web/js/classic-avatar.js');
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');
const { RAVE_SONG } = await import('../web/js/sound.js');
const { MAPS } = await import('../web/js/input.js');
const { BTN } = await import('../web/js/gamepad.js');
const { createPeers } = await import('../web/js/peers.js');
const { FLAG_DANCING } = await import('../web/js/net.js');
// net.js keeps its first four bits to itself; the sea's copy is the same number.
const { POSE } = await import('../lib/players.mjs');
const { Scene } = await import('three');

const { bpm, bars, build } = RAVE_SONG;

test('the settlers and a player dance from one copy of the moves', () => {
  assert.equal(figures.dancePose, dancePose, 'settler-figures.js has a dance of its own again');
});

test('a dancer has two moves of their own, the same on every screen, and everybody\'s hands go up in the last bar of the build', () => {
  const style = (id) => Array.from({ length: bars }, (_, bar) => danceStep(id, bar * 4 + 1).move);
  for (const id of ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'me', 'c0ffee00c0ffee00']) {
    const moves = style(id);
    assert.deepEqual(moves, style(id), `${id} dances differently the second time`);
    const own = new Set(moves.slice(0, build + 3));
    assert.equal(own.size, 2, `${id} does not have exactly two moves: ${[...own]}`);
    assert.ok(!moves.includes(5), `${id} dances the DJ's move, with a hand on decks that are not there`);
    // Swapped every four bars, and a loop later it is the same dance again.
    assert.notEqual(moves[0], moves[4]);
    assert.equal(moves[0], moves[8]);
    assert.deepEqual(style(id), Array.from({ length: bars }, (_, bar) => danceStep(id, (bars + bar) * 4 + 1).move));
    for (let bar = build + 3; bar < bars; bar++) assert.equal(moves[bar], 1, `${id}'s hands are not up in bar ${bar}`);
  }
  // Different people, different styles.
  const firsts = new Set(Array.from({ length: 40 }, (_, i) => danceStep(`player-${i}`, 1).move));
  assert.ok(firsts.size >= 4, `forty dancers between them have only ${firsts.size} opening moves`);
  // The drop jumps, and then it does not.
  assert.ok(danceStep('me', 0.5).hype > 0.9);
  assert.equal(danceStep('me', 3 * 4).hype, 0);
});

test('the beat runs at the song\'s tempo whether it comes off the wall or the music', () => {
  assert.ok(Math.abs(wallBeat(60000) - bpm) < 1e-9, 'a minute of wall clock is not a minute of beats');
  assert.ok(Math.abs(clockBeat(60) - bpm) < 1e-9, 'a minute into the music is not a minute of beats');
});

const still = { moving: false, running: false, grounded: true, crouching: false, sitting: false, lying: false, swimming: false, phase: 0 };
const arms = (rig) => [rig.handAttach.leftArm.parent.rotation.x, rig.handAttach.rightArm.parent.rotation.x];
const run = (rig, pose, seconds, beatAt = () => 0.5) => {
  for (let t = 0; t < seconds; t += 1 / 60) rig.update({ ...pose, dancing: pose.dancing && { ...pose.dancing, beat: beatAt(t) } }, 1 / 60);
};

test('the rig dances the move it is given, on the beat, and lets go when the dance ends', () => {
  const rig = createClassicAvatar(DEFAULT_AVATAR, new MeshBasicMaterial({ vertexColors: true }));
  // Hands up (move 1): both arms over the head, where dancePose says.
  const up = dancePose(1, 0.5, 0);
  run(rig, { ...still, dancing: { move: 1, hype: 0 } }, 1.5);
  const [l, r] = arms(rig);
  assert.ok(Math.abs(l - up.left) < 0.05 && Math.abs(r - up.right) < 0.05, `the arms are at ${l.toFixed(2)}, ${r.toFixed(2)}, not up`);
  // The whole body on the beat: up between two kicks, down on them.
  const y = (beat) => { run(rig, { ...still, dancing: { move: 1, hype: 0 } }, 0.5, () => beat); return rig.object.position.y; };
  assert.ok(y(0.5) > y(0) + 0.005, 'the body does not bounce with the beat');
  // Stopped: arms down again and the body back on its feet, straight.
  run(rig, still, 2);
  for (const a of arms(rig)) assert.ok(Math.abs(a) < 0.1, `an arm stayed up at ${a.toFixed(2)}`);
  assert.equal(rig.object.position.y, 0);
  assert.deepEqual([rig.object.rotation.x, rig.object.rotation.y, rig.object.rotation.z], [0, 0, 0]);
  rig.dispose();
});

test('nobody dances sitting, lying, swimming, on a bicycle or in first person', () => {
  for (const [what, pose] of [
    ['sitting', { sitting: true }], ['lying', { lying: true }], ['swimming', { swimming: true }],
    ['on a bicycle', { riding: { crank: 0, standing: false } }], ['in first person', { firstPerson: true }],
  ]) {
    const rig = createClassicAvatar(DEFAULT_AVATAR, new MeshBasicMaterial({ vertexColors: true }));
    run(rig, { ...still, ...pose, dancing: { move: 1, hype: 0 } }, 1);
    assert.ok(arms(rig).every((a) => a > -2), `danced ${what}`);
    assert.equal(rig.object.position.y, 0, `bounced ${what}`);
    rig.dispose();
  }
});

test('the dance button on the controller is a button nothing else on foot uses', () => {
  for (const where of ['walk', 'inside']) {
    const map = MAPS[where];
    assert.equal(map.dance.hit, BTN.UP, `${where}: dancing is not the D-pad up`);
    const others = Object.entries(map).filter(([name]) => name !== 'dance')
      .flatMap(([, b]) => [b.hit, b.down]).filter((b) => b != null);
    assert.ok(!others.includes(BTN.UP), `${where}: the D-pad up already does something else`);
  }
});

test('somebody else whose pose says they dance is drawn dancing, to our beat, and on what they stand on', () => {
  const scene = new Scene();
  const peers = createPeers({ scene, material: new MeshBasicMaterial({ vertexColors: true }), terrain: { worldHeight: () => 0 } });
  peers.join({ id: 'ann', name: 'Ann', look: DEFAULT_AVATAR });
  // The rig's own root, under the peer's group: the one mirrored node (classic-avatar.js).
  const rigOf = () => { let r = null; scene.traverse((o) => { if (o.scale.x === -1 && !r) r = o; }); return r; };
  const pose = (f, y = 0) => peers.snapshot([['ann', 0, y, 0, 0, f]]);
  const settle = (beat) => { for (let i = 0; i < 90; i++) peers.update(1 / 60, { beat }); };
  // Standing: no bounce, whatever the beat.
  pose(0); pose(0);
  settle(0.5);
  assert.equal(rigOf().position.y, 0);
  // Dancing, up on the rave's stage (0.2 over a floor this page thinks is flat): up between two
  // kicks and down on them, and on the stage rather than in it.
  pose(FLAG_DANCING, 0.2); pose(FLAG_DANCING, 0.2);
  settle(0.5);
  const high = rigOf().position.y;
  settle(0);
  assert.ok(high > rigOf().position.y + 0.005, 'a dancing peer does not bounce with the beat');
  let group = rigOf().parent;
  while (group.parent !== scene) group = group.parent;
  assert.ok(Math.abs(group.position.y - 0.2) < 1e-6, `a dancer on the stage is drawn at ${group.position.y.toFixed(3)}, in the boards`);
  // Walking off ends it on our screen too, even with the bit still set by an older page.
  pose(FLAG_DANCING | POSE.MOVING); pose(FLAG_DANCING | POSE.MOVING);
  settle(0.5);
  assert.ok(Math.abs(rigOf().position.y) < 1e-3, 'a peer dances while walking');
  peers.dispose();
});
