// Walking the island on foot. A third-person camera behind a settler you steer with
// WASD, terrain underfoot, buildings you cannot walk through, and a prompt when you
// come close to something you can interact with.
import * as THREE from 'three';
import { figureGeometry } from './settlers.js';
import { box, cylinder, sphere } from './buildings.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from 'shared/rng.mjs';

const WALK_SPEED = 3.4;
const RUN_SPEED = 6.6;
const TURN_LERP = 0.18;
const CAM_BACK = 2.7;
const CAM_UP = 1.6;
const EYE = 0.9;
const BODY_R = 0.3;

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

export function createWalkMode({ scene, camera, terrain, material, dom }) {
  const avatar = new THREE.Mesh(playerGeometry(), material);
  avatar.castShadow = true;
  avatar.visible = false;
  scene.add(avatar);

  const keys = new Set();
  const state = {
    active: false,
    pos: new THREE.Vector3(),
    yaw: 0,          // where the player faces
    camYaw: 0,       // where the camera looks from
    camPitch: 0.28,
    bob: 0,
    blockers: [],
    interactables: [],
    near: null,
    onInteract: null,
    onSendAway: null,
    onExit: null,
    moving: false,
    paused: false,   // true while an overlay owns the input
  };

  const onKeyDown = (e) => {
    if (!state.active || state.paused) return;   // the board has the keyboard
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      keys.add(k);
      e.preventDefault();
    }
    if (k === 'e' && state.near) { e.preventDefault(); state.onInteract && state.onInteract(state.near); }
    if (k === 'x' && state.near) { e.preventDefault(); state.onSendAway && state.onSendAway(state.near); }
    if (k === 'escape') { e.preventDefault(); state.onExit && state.onExit(); }
  };
  const onKeyUp = (e) => { keys.delete(e.key.toLowerCase()); };
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

  function blocked(x, z) {
    if (groundAt(x, z) < 0.06) return true;                    // no walking into the sea
    for (const b of state.blockers) {
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz < (b.r + BODY_R) * (b.r + BODY_R)) return true;
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

    const run = keys.has('shift') || stick.run;
    let ix = 0, iz = 0;
    if (keys.has('w') || keys.has('arrowup')) iz += 1;
    if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
    if (Math.abs(stick.x) > 0.01 || Math.abs(stick.z) > 0.01) { ix += stick.x; iz += stick.z; }
    stick.x = 0; stick.z = 0;   // the pad refills this every frame it is touched

    const push = Math.min(1, Math.hypot(ix, iz));
    const speed = (run ? RUN_SPEED : WALK_SPEED) * push * dt;
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

    state.pos.y = groundAt(state.pos.x, state.pos.z);
    const bobY = state.moving ? Math.abs(Math.sin(state.bob)) * 0.045 : 0;
    avatar.position.set(state.pos.x, state.pos.y + bobY, state.pos.z);
    avatar.rotation.set(0, state.yaw, state.moving ? Math.sin(state.bob) * 0.045 : 0);

    // camera sits behind and above, and never dips under the ground
    const cx = state.pos.x - Math.sin(state.camYaw) * CAM_BACK * Math.cos(state.camPitch);
    const cz = state.pos.z - Math.cos(state.camYaw) * CAM_BACK * Math.cos(state.camPitch);
    const cy = state.pos.y + CAM_UP + Math.sin(state.camPitch) * CAM_BACK;
    camera.position.set(cx, Math.max(cy, groundAt(cx, cz) + 0.55), cz);
    camera.lookAt(state.pos.x, state.pos.y + EYE, state.pos.z);

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
