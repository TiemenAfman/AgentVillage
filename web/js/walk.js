// Walking the island on foot. A third-person camera behind a settler you steer with
// WASD, terrain underfoot, buildings you cannot walk through, and a prompt when you
// come close to something you can interact with.
import * as THREE from 'three';
import { figureGeometry } from './settlers.js';
import { box, cylinder, cone, sphere, WALK_BODY_R as BODY_R } from './buildings.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from 'shared/rng.mjs';

const WALK_SPEED = 3.4;
const RUN_SPEED = 6.6;
const TURN_LERP = 0.18;
const CAM_BACK = 2.7;
const CAM_UP = 1.6;
const EYE = 0.9;
// A settler is about 1.1 units tall, so a jump of a third of that clears a doorstep and
// a low hedge without turning the island into a platform game. Gravity is tuned to that
// height rather than to reality: it puts the player back on the ground in about 0.6 s.
const JUMP_V = 3.1;
const GRAVITY = 12.5;
// Wading, not open-water swimming: the shore has to stay within reach, so you can stand
// in the surf and cross a stream but you cannot set out to sea. The sea surface is y = 0,
// matching the water plane in world.js, and the body sits a little way into it.
const SWIM_SPEED = 1.9;
const SWIM_REACH = 2.0;
const WATER_Y = 0;
const SWIM_SINK = 0.07;
// Ctrl crouches. Keep holding it while standing still and the settler decides the day is
// over, lies down and puts up a parasol - so the countdown only runs while you are not
// moving, or a crouch-walk would end in a nap.
const CROUCH_SCALE = 0.62;
const CROUCH_SPEED = 1.7;
const LIE_AFTER_MS = 2000;
const PROBE = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return [Math.cos(a) * SWIM_REACH, Math.sin(a) * SWIM_REACH];
});

// The player is a settler like any other, with a satchel and a wide hat so you can
// pick yourself out of a crowd.
function playerGeometry() {
  const base = figureGeometry('sonnet');
  base.deleteAttribute('normal');   // the kit parts carry none; normals come after the merge
  const parts = [
    base,
    box(0.16, 0.13, 0.07, 0x8a5a34, { x: 0.11, y: 0.14, z: -0.03, ry: 0.3 }),   // satchel
    cylinder(0.008, 0.008, 0.24, 4, 0x5a3c28, { x: 0.04, y: 0.1, z: -0.02, rz: 0.5 }),
    cylinder(0.17, 0.17, 0.018, 10, 0xc9a75c, { y: 0.4 }),                       // hat brim
    sphere(0.075, 0xc9a75c, { y: 0.415 }),
  ];
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  g.scale(1.12, 1.12, 1.12);
  return g;
}

// A striped towel and a parasol, for when the settler has had enough of the island.
// Sized off the figure, which is 0.55 tall and 0.4 across: lying down it is 0.55 long,
// so the towel runs along z with the head end at -z, which is where the lying pose puts
// it and where the parasol is planted.
function loungeGeometry() {
  const parts = [
    box(0.52, 0.03, 0.86, 0xf5efe0, { z: -0.25 }),               // the towel
    box(0.52, 0.04, 0.1, 0xc86b4a, { z: -0.06 }),                // its stripes, running across
    box(0.52, 0.04, 0.1, 0xc86b4a, { z: -0.46 }),
    cylinder(0.014, 0.017, 0.66, 6, 0x5a3c28, { z: -0.82 }),     // the pole, beyond the head
    cone(0.38, 0.15, 12, 0xd94f3d, { y: 0.58, z: -0.82 }),       // the canopy
    cone(0.29, 0.06, 12, 0xf5efe0, { y: 0.56, z: -0.82 }),       // a pale underside
    sphere(0.026, 0xd9a33d, { y: 0.74, z: -0.82 }),              // the finial
  ];
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

export function createWalkMode({ scene, camera, terrain, material, dom }) {
  const avatar = new THREE.Mesh(playerGeometry(), material);
  // Yaw first, then the swimmer's pitch about its own axis. The default XYZ order would
  // tip the body in world space and then spin it. With x = 0 both orders agree, so the
  // walk animation is untouched.
  avatar.rotation.order = 'YXZ';
  avatar.castShadow = true;
  avatar.visible = false;
  scene.add(avatar);

  const lounge = new THREE.Mesh(loungeGeometry(), material);
  lounge.castShadow = true;
  lounge.receiveShadow = true;
  lounge.visible = false;
  scene.add(lounge);

  const keys = new Set();
  const state = {
    active: false,
    pos: new THREE.Vector3(),
    yaw: 0,          // where the player faces
    camYaw: 0,       // where the camera looks from
    camPitch: 0.28,
    bob: 0,
    vy: 0,           // vertical speed; zero whenever the feet are down
    grounded: true,
    swimming: false,
    crouching: false,
    lying: false,
    ctrlSince: 0,
    blockers: [],
    interactables: [],
    near: null,
    onInteract: null,
    onSendAway: null,
    onExit: null,
    moving: false,
    paused: false,   // true while an overlay owns the input
  };

  // Letting go of Ctrl ends a crouch, but not a nap: once the settler is down they stay
  // down, so the key can be released. Getting up is moving, or pressing Ctrl again.
  function releaseCrouch() {
    state.crouching = false;
    if (!state.lying) state.ctrlSince = 0;
  }
  function standUp() {
    state.crouching = false;
    state.lying = false;
    state.ctrlSince = 0;
  }

  const onKeyDown = (e) => {
    if (!state.active || state.paused) return;   // the board has the keyboard
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      keys.add(k);
      e.preventDefault();
    }
    // Only from the ground, so holding space does not climb the sky.
    if (k === ' ') {
      e.preventDefault();
      if (state.grounded && !state.swimming) { state.vy = JUMP_V; state.grounded = false; }
    }
    if (k === 'control') {
      e.preventDefault();
      if (state.lying) standUp();                    // pressing it again is how you get up
      else if (!state.crouching) { state.crouching = true; state.ctrlSince = performance.now(); }
    }
    if (k === 'e' && state.near) { e.preventDefault(); state.onInteract && state.onInteract(state.near); }
    if (k === 'x' && state.near) { e.preventDefault(); state.onSendAway && state.onSendAway(state.near); }
    if (k === 'escape') { e.preventDefault(); state.onExit && state.onExit(); }
  };
  const onKeyUp = (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === 'control') releaseCrouch();
  };
  // A keyup that never arrives - the window losing focus with Ctrl held - would leave the
  // settler crouched for good, so anything that takes the keyboard away ends the crouch.
  // A nap survives it, the same as it survives letting go of the key.
  const onBlur = () => releaseCrouch();
  addEventListener('blur', onBlur);
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);

  // Mouse look: drag anywhere on the canvas, or take a pointer lock on double click.
  let dragging = false, lastX = 0, lastY = 0;
  const onDown = (e) => { if (!state.active) return; dragging = true; lastX = e.clientX; lastY = e.clientY; };
  const onUp = () => { dragging = false; };
  const onMove = (e) => {
    if (!state.active) return;
    const locked = document.pointerLockElement === dom;
    let dx = 0, dy = 0;
    if (locked) { dx = e.movementX; dy = e.movementY; } else if (dragging) { dx = e.clientX - lastX; dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; }
    if (!dx && !dy) return;
    state.camYaw -= dx * 0.0042;
    state.camPitch = clamp(state.camPitch + dy * 0.0032, -0.25, 0.95);
  };
  dom.addEventListener('pointerdown', onDown);
  addEventListener('pointerup', onUp);
  addEventListener('pointermove', onMove);
  dom.addEventListener('dblclick', () => { if (state.active) dom.requestPointerLock?.(); });

  function groundAt(x, z) { return terrain.worldHeight(x, z); }

  // Is there dry land within arm's reach? This is what keeps a swim to the coast and a
  // stream, and refuses the open sea, without needing to know where either of them is.
  function shoreWithinReach(x, z) {
    for (const [dx, dz] of PROBE) if (groundAt(x + dx, z + dz) >= 0.06) return true;
    return false;
  }

  // A blocker is an axis aligned rectangle: the part of a building that is low enough
  // to bump into, grown by half a settler so the avatar stops at the wall rather than
  // standing in it. Rectangles, not circles, or a market row would be a fat bollard.
  function blocked(x, z) {
    // You may wade in as long as the shore stays close; the open water is still a wall.
    if (groundAt(x, z) < 0.06 && !shoreWithinReach(x, z)) return true;
    for (const b of state.blockers) {
      if (Math.abs(x - b.x) < b.hx + BODY_R && Math.abs(z - b.z) < b.hz + BODY_R) return true;
    }
    return false;
  }

  function enter({ at, facing, blockers, interactables, onInteract, onSendAway, onExit }) {
    state.blockers = blockers || [];
    state.interactables = interactables || [];
    state.onInteract = onInteract;
    state.onSendAway = onSendAway;
    state.onExit = onExit;
    let [x, z] = at;
    // step back until we are standing somewhere legal
    for (let i = 0; i < 40 && blocked(x, z); i++) { x += 0.4; z += 0.25; }
    state.pos.set(x, groundAt(x, z), z);
    state.vy = 0;
    state.grounded = true;
    standUp();
    // look at whatever we were dropped in front of, so the camera stays behind us
    state.yaw = state.camYaw = facing ? Math.atan2(facing[0] - x, facing[1] - z) : 0;
    state.camPitch = 0.44;   // high enough to look over the treetops
    state.active = true;
    avatar.visible = true;
    keys.clear();
  }

  function exit() {
    state.active = false;
    avatar.visible = false;
    lounge.visible = false;
    standUp();
    keys.clear();
    if (document.pointerLockElement === dom) document.exitPointerLock?.();
  }

  function setBlockers(list) { state.blockers = list; }
  function setInteractables(list) { state.interactables = list; }

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  // Controller input, folded into the same movement the keyboard uses.
  const stick = { x: 0, z: 0, run: false };
  function pad(p, dt) {
    if (!state.active) return;
    stick.x = p.move.x;
    stick.z = -p.move.y;                       // pushing up on the stick walks forward
    stick.run = p.down(5) || p.rt > 0.4;       // right shoulder or right trigger
    state.camYaw -= p.look.x * 2.6 * dt;
    state.camPitch = clamp(state.camPitch + p.look.y * 1.7 * dt, -0.25, 0.95);
    if (p.hit(0) && state.near) state.onInteract && state.onInteract(state.near);
    if (p.hit(2) && state.near) state.onSendAway && state.onSendAway(state.near);   // X on the pad
  }

  function setPaused(v) {
    state.paused = !!v;
    if (v) { keys.clear(); stick.x = 0; stick.z = 0; }
  }

  function update(dt) {
    if (!state.active) return null;
    if (state.paused) { stick.x = 0; stick.z = 0; return { near: state.near, pos: state.pos, distance: 0 }; }

    const run = (keys.has('shift') || stick.run) && !state.swimming && !state.crouching;
    let ix = 0, iz = 0;
    if (keys.has('w') || keys.has('arrowup')) iz += 1;
    if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
    if (Math.abs(stick.x) > 0.01 || Math.abs(stick.z) > 0.01) { ix += stick.x; iz += stick.z; }
    stick.x = 0; stick.z = 0;   // the pad refills this every frame it is touched

    const push = Math.min(1, Math.hypot(ix, iz));
    const speed = (state.lying ? 0
      : state.swimming ? SWIM_SPEED
        : state.crouching ? CROUCH_SPEED
          : run ? RUN_SPEED : WALK_SPEED) * push * dt;
    state.moving = push > 0.02;
    if (state.moving) {
      const len = Math.hypot(ix, iz);
      ix /= len; iz /= len;
      // looking along +z with y up, the camera's right hand is -x: right = forward x up
      forward.set(Math.sin(state.camYaw), 0, Math.cos(state.camYaw));
      right.set(-Math.cos(state.camYaw), 0, Math.sin(state.camYaw));
      const vx = forward.x * iz + right.x * ix;
      const vz = forward.z * iz + right.z * ix;
      // try the full step, then each axis on its own, so you slide along walls
      const nx = state.pos.x + vx * speed, nz = state.pos.z + vz * speed;
      if (!blocked(nx, nz)) { state.pos.x = nx; state.pos.z = nz; }
      else if (!blocked(nx, state.pos.z)) state.pos.x = nx;
      else if (!blocked(state.pos.x, nz)) state.pos.z = nz;
      state.yaw = lerpAngle(state.yaw, Math.atan2(vx, vz), TURN_LERP);
      state.bob += dt * (run ? 13 : 9);
    } else {
      state.bob += dt * 1.5;
    }

    // Off the ground the height is the jump's; on it, whatever is underfoot - the terrain,
    // or the water surface where the terrain is below it. A jump keeps its arc out over
    // the water and only starts swimming when it comes down, which is what lets you clear
    // a stream instead of paddling across it.
    const ground = groundAt(state.pos.x, state.pos.z);
    const inWater = ground < 0;
    const underfoot = inWater ? WATER_Y - SWIM_SINK : ground;
    if (state.grounded) {
      state.pos.y = underfoot;
    } else {
      state.vy -= GRAVITY * dt;
      state.pos.y += state.vy * dt;
      if (state.pos.y <= underfoot) { state.pos.y = underfoot; state.vy = 0; state.grounded = true; }
    }
    state.swimming = state.grounded && inWater;

    // Standing still with Ctrl held long enough is a decision to stop for the day, and it
    // outlasts the key: once down, the settler stays down until they move or press Ctrl
    // again. While crouching, any movement puts the clock back to zero, so a crouch-walk
    // never ends in a nap.
    if (state.lying) {
      if (state.moving || !state.grounded || state.swimming) standUp();
    } else if (state.crouching && state.grounded && !state.swimming) {
      if (state.moving) state.ctrlSince = performance.now();
      else if (performance.now() - state.ctrlSince >= LIE_AFTER_MS) { state.lying = true; state.crouching = false; }
    }

    avatar.scale.setScalar(1);
    lounge.visible = state.lying;
    if (state.lying) {
      // On the back with the head at -z, which is the end the parasol stands at. Negative
      // pitch turns the front face upwards; the positive one used for swimming is prone.
      avatar.position.set(state.pos.x, state.pos.y, state.pos.z);
      avatar.rotation.set(-1.5, state.yaw, 0);
      lounge.position.set(state.pos.x, state.pos.y + 0.01, state.pos.z);
      lounge.rotation.set(0, state.yaw, 0);
    } else if (state.swimming) {
      // Prone and rolling with the stroke. The figure is one merged mesh, so there are no
      // limbs to animate - the whole body leans into it instead, which at this scale is
      // what reads as swimming.
      state.bob += dt * (state.moving ? 6.5 : 1.4);
      avatar.position.set(state.pos.x, state.pos.y + Math.sin(state.bob) * 0.03, state.pos.z);
      // Positive pitch, so the head goes forward: rotating about local x maps +y (up,
      // towards the head) onto +z, which is the direction yaw points along. The other
      // sign swims feet first.
      avatar.rotation.set(1.32 + Math.sin(state.bob) * 0.1, state.yaw, Math.sin(state.bob * 0.5) * 0.16);
    } else {
      const bobY = state.moving && state.grounded ? Math.abs(Math.sin(state.bob)) * 0.045 : 0;
      avatar.position.set(state.pos.x, state.pos.y + bobY, state.pos.z);
      avatar.rotation.set(0, state.yaw, state.moving ? Math.sin(state.bob) * 0.045 : 0);
      if (state.crouching) avatar.scale.set(1, CROUCH_SCALE, 1);
    }

    // camera sits behind and above, and never dips under the ground
    const camBack = state.lying ? CAM_BACK * 1.7 : CAM_BACK;
    const cx = state.pos.x - Math.sin(state.camYaw) * camBack * Math.cos(state.camPitch);
    const cz = state.pos.z - Math.cos(state.camYaw) * camBack * Math.cos(state.camPitch);
    const eyeDrop = state.lying ? CAM_UP * 0.55 : state.crouching ? CAM_UP * 0.3 : 0;
    const cy = state.pos.y + CAM_UP - eyeDrop + Math.sin(state.camPitch) * camBack;
    camera.position.set(cx, Math.max(cy, groundAt(cx, cz) + 0.55), cz);
    camera.lookAt(state.pos.x, state.pos.y + (state.lying ? 0.2 : state.crouching ? EYE * 0.7 : EYE), state.pos.z);

    // what is within reach?
    let near = null, bestD = Infinity;
    for (const it of state.interactables) {
      const dx = it.x - state.pos.x, dz = it.z - state.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < (it.r || 2.6) && d < bestD) { bestD = d; near = it; }
    }
    state.near = near;
    return { near, pos: state.pos, distance: bestD };
  }

  function dispose() {
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointermove', onMove);
    dom.removeEventListener('pointerdown', onDown);
    scene.remove(avatar);
    avatar.geometry.dispose();
  }

  return { state, avatar, enter, exit, update, pad, setPaused, setBlockers, setInteractables, dispose, isActive: () => state.active };
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
