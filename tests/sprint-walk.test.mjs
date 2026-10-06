// Walking, running and sprinting, and a jump that keeps the way it took off with (web/js/walk.js,
// web/js/avatar-gait.js GAITS, Plans/tweede-avonturier.md), on a real walk mode driven frame by frame
// the way tests/carry-dig-walk.test.mjs drives it: Shift with breath in the pool is a sprint at the
// body's own sprint speed, Shift once it is spent is a run - a jog, never a walk - and no Shift a
// walk; a jump from a sprint carries much further than one from standing, which goes straight up.
// The gait half (feet planted, flight, reach) is at the bottom, on the profiles alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = {
  createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop,
  pointerLockElement: null, exitPointerLock: noop,
};
const handlers = { keydown: [], keyup: [] };
globalThis.addEventListener = (type, fn) => { if (handlers[type]) handlers[type].push(fn); };
globalThis.removeEventListener = noop;
const { createWalkMode } = await import('../web/js/walk.js');
const { GAITS, createGait, solveLeg, sprintAt, mixOf } = await import('../web/js/avatar-gait.js');
const { normalizeAvatar } = await import('../web/js/avatar.js');
const { ADVENTURER_RIG, ADVENTURER_JOINTS } = await import('../web/js/adventurer-mesh.js');
const { PLAYER_SCALE } = await import('../web/js/avatar.js');
const { createClassicAvatar } = await import('../web/js/classic-avatar.js');
// What a body really walks, runs and sprints at: the Adventurer's are his Mixamo clips' own
// (classic-avatar.js withClips), not the profile's.
const speedsOf = (character) => createClassicAvatar(normalizeAvatar({ character }), new THREE.MeshBasicMaterial()).speeds;

const FRAME = 1 / 60;
const key = (k, down) => {
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};
const press = (k) => key(k, true);
const release = (k) => key(k, false);
const run = (walk, seconds) => { for (let i = 0; i < Math.round(seconds / FRAME); i++) walk.update(FRAME); };

function make(character) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const h = () => 1;
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1, 0.5, 1000),
    terrain: { half: 64, size: 128, worldHeight: h }, ground: { height: h, bedAt: h, regionAt: () => null, levelKey: () => null },
    material: new THREE.MeshBasicMaterial(), avatar: normalizeAvatar({ character }),
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
  });
  walk.enter({ at: [0, -40], facing: [0, 0], blockers: [], interactables: [], onExit: noop });
  run(walk, 0.2);
  return walk;
}
// How far the body goes in `seconds`, and what it said it was doing at the end.
function stretch(walk, seconds) {
  const z0 = walk.state.pos.z;
  run(walk, seconds);
  return { d: walk.state.pos.z - z0, running: walk.state.running, sprinting: walk.state.sprinting };
}

for (const character of ['traveller', 'adventurer']) {
  const gait = speedsOf(character);
  test(`${character}: a walk, a sprint while there is breath, and a run - never a walk - once it is spent`, () => {
    const walk = make(character);
    press('w');
    const walking = stretch(walk, 1);
    assert.ok(Math.abs(walking.d - gait.walk) < 0.02, `walks ${walking.d}`);
    assert.equal(walking.running, false);
    press('shift');
    run(walk, 0.1);
    const sprinting = stretch(walk, 1);
    assert.ok(Math.abs(sprinting.d - gait.sprint) < 0.02, `sprints ${sprinting.d}`);
    assert.equal(sprinting.sprinting, true);
    assert.equal(sprinting.running, true, 'a sprint is drawn as running to the others (FLAG_RUNNING)');
    run(walk, 6);   // the pool empties in six seconds of sprint (stamina.js BODY)
    const jogging = stretch(walk, 1);
    assert.ok(Math.abs(jogging.d - gait.run) < 0.02, `out of breath it goes ${jogging.d}, not a run at ${gait.run}`);
    assert.equal(jogging.running, true);
    assert.equal(jogging.sprinting, false);
    release('shift'); release('w');
  });

  test(`${character}: a jump keeps the way it took off with`, () => {
    const jumpFrom = (shift, forward) => {
      const walk = make(character);
      if (forward) press('w');
      if (shift) press('shift');
      run(walk, 0.6);
      const z0 = walk.state.pos.z;
      if (!forward) press('w');   // a standing jump, pushed forward only once in the air
      press(' ');
      walk.update(FRAME);
      release(' ');
      let frames = 0;
      while (!walk.state.grounded && frames < 120) { walk.update(FRAME); frames++; }
      release('w'); release('shift');
      return walk.state.pos.z - z0;
    };
    const sprintJump = jumpFrom(true, true), walkJump = jumpFrom(false, true), standing = jumpFrom(false, false);
    const air = 2 * 3.1 / 12.5;   // walk.js JUMP_V and GRAVITY
    assert.ok(Math.abs(sprintJump - gait.sprint * air) < 0.06, `a sprint's leap went ${sprintJump}`);
    assert.ok(sprintJump > walkJump * 2, `sprint ${sprintJump} against walk ${walkJump}`);
    assert.ok(standing < walkJump * 0.6, `a standing jump steered forward went ${standing}, a walking one ${walkJump}`);
  });
}

test('the gaits run slower than they sprint, and a peer is a sprinter only past the middle', () => {
  for (const g of Object.values(GAITS)) {
    assert.ok(g.walk < g.run && g.run < g.sprint, JSON.stringify([g.walk, g.run, g.sprint]));
    assert.equal(sprintAt(g, g.run), 0);
    assert.equal(sprintAt(g, g.sprint), 1);
  }
  assert.equal(mixOf([1, 2, 4], 1, 1), 4);
  assert.equal(mixOf([1, 2], 1, 1), 2, 'a pair has no sprint');
});

// The Adventurer's legs, scaled as the rig scales them.
const hip = ADVENTURER_RIG.leftLeg[1] * PLAYER_SCALE, knee = ADVENTURER_JOINTS.leftLeg.bend[1] * PLAYER_SCALE;
const ankle = ADVENTURER_JOINTS.leftLeg.end[1] * PLAYER_SCALE;
test("the Adventurer's planted foot holds the ground and is within his leg's reach at every pace", () => {
  for (const [running, sprinting] of [[false, false], [true, false], [true, true]]) {
    const gait = createGait(hip, knee, ankle, GAITS.athlete);
    const g = GAITS.athlete, speed = sprinting ? g.sprint : running ? g.run : g.walk, dt = 1 / 120;
    let distance = 0, previous = null, held = 0, flight = 0;
    for (let i = 0; i < 900; i++) {
      distance += speed * dt;
      const out = gait.update(speed * dt, { moving: true, grounded: true, running, sprinting }, dt);
      if (i < 450) { previous = { distance, out }; continue; }
      if (out.feet.every((f) => !f.planted)) flight++;
      for (let j = 0; j < 2; j++) {
        const f = out.feet[j], before = previous.out.feet[j];
        assert.ok(f.lift >= 0);
        if (!f.planted) continue;
        // Within reach: the solved leg puts the ankle where it was asked to, so the sole stays down.
        const down = hip - out.drop - ankle;
        const leg = solveLeg(f.z, down, hip - knee, knee - ankle);
        const gotZ = -(hip - knee) * Math.sin(leg.hip) - (knee - ankle) * Math.sin(leg.hip + leg.knee);
        assert.ok(Math.abs(gotZ - f.z) < 2e-3, `${running}/${sprinting}: a planted foot out of reach by ${gotZ - f.z}`);
        if (before.planted && f.z < before.z) {
          assert.ok(Math.abs((distance + f.z) - (previous.distance + before.z)) < 1e-6, 'a planted foot slid');
          held++;
        }
      }
      previous = { distance, out };
    }
    assert.ok(held > 50);
    if (running) assert.ok(flight > 40, `${sprinting ? 'sprint' : 'run'}: ${flight} frames in the air`);
    else assert.equal(flight, 0, 'a walk has no flight');
  }
});

// From the sky (Plans/tweede-avonturier.md): a body walked along a route by a click is the
// keeper's errand, not a game of breath - it sprints all the way and spends nothing.
for (const character of ['traveller', 'adventurer']) {
  test(`${character}: a route walked from the sky is a sprint, and costs no stamina`, () => {
    const walk = make(character);
    walk.park();
    const pool = walk.state.stamina.body.level;
    assert.equal(walk.goTo([[0, 40]]), true);
    const z0 = walk.state.pos.z;
    run(walk, 1);
    const went = walk.state.pos.z - z0;
    assert.ok(Math.abs(went - speedsOf(character).sprint) < 0.03, `went ${went}`);
    assert.equal(walk.state.sprinting, true);
    assert.equal(walk.state.stamina.body.level, pool, 'the pool was drawn on');
    run(walk, 8);
    assert.equal(walk.state.sprinting, true, 'still sprinting after the pool would have run out');
  });
}
