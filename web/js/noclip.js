// The noclip camera (Plans/noclip-camera.md): a free-flying debug camera that goes through walls,
// ground and water, for looking at the graphics without driving a body there first. main.js owns
// the mode (`state.mode === 'noclip'`) and everything it has to hand back; this file is the flying
// itself - the pure arithmetic first, tested under Node (tests/noclip.test.mjs) with no document,
// then `createNoclip`, which is the keys, the mouse and the pointer lock.
//
// A pose is { x, y, z, yaw, pitch } in the scene's own coordinates (the island's, or a room's),
// with yaw in walk.js's convention - looking along (sin yaw, cos yaw) - and pitch positive up.

export const NOCLIP_KEY = 'promptholm.debug.noclip';
export const SPOTS_KEY = 'promptholm.noclip.spots';
// Units a second. The island and a room want very different speeds - a cell is 4 m, a room is a
// few units across - so each keeps its own, and the wheel moves whichever is in use.
export const SPEED = { island: 8, room: 1.5, min: 0.1, max: 400, notch: 1.2 };
// Just short of straight up and down, where yaw would stop meaning anything.
export const PITCH_MAX = 1.55;
// Radians per pixel of mouse.
export const LOOK = 0.0028;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export const clampPitch = (p) => clamp(p, -PITCH_MAX, PITCH_MAX);

// Where a pose looks, as a unit vector.
export function forwardOf(yaw, pitch) {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

// One step of flying. `move` is { f, r, u } in -1..1 (forward, right, up): forward follows the
// view, pitch included, which is what makes it noclip and not a hovering walk; right stays level;
// up is the world's. Diagonals are not faster than straight on.
export function stepNoclip(pose, move, dt, speed) {
  const f = clamp(move.f || 0, -1, 1), r = clamp(move.r || 0, -1, 1), u = clamp(move.u || 0, -1, 1);
  const len = Math.hypot(f, r, u);
  if (!(len > 0) || !(dt > 0) || !(speed > 0)) return { ...pose };
  const k = (speed * dt) / Math.max(1, len);
  const [fx, fy, fz] = forwardOf(pose.yaw, pose.pitch);
  // Right of (sin yaw, cos yaw) is (-cos yaw, sin yaw): at yaw 0 forward is +z and right is -x,
  // as walk.js's routeInput has it.
  const rx = -Math.cos(pose.yaw), rz = Math.sin(pose.yaw);
  return {
    ...pose,
    x: pose.x + (fx * f + rx * r) * k,
    y: pose.y + (fy * f + u) * k,
    z: pose.z + (fz * f + rz * r) * k,
  };
}

// The mouse: right turns right, down looks down.
export function turnBy(pose, dx, dy, k = LOOK) {
  return { ...pose, yaw: wrapAngle(pose.yaw - dx * k), pitch: clampPitch(pose.pitch - dy * k) };
}

export function wrapAngle(a) {
  const t = Math.PI * 2;
  return a - t * Math.floor((a + Math.PI) / t);
}

// The yaw and pitch that look from one point at another; a target on the eye keeps the old aim.
export function lookFrom(from, to, keep = { yaw: 0, pitch: 0 }) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-9 && Math.abs(dy) < 1e-9) return { yaw: keep.yaw, pitch: keep.pitch };
  return { yaw: flat < 1e-9 ? keep.yaw : Math.atan2(dx, dz), pitch: clampPitch(Math.atan2(dy, flat)) };
}

// The wheel: a notch towards you (deltaY < 0) is faster, as zooming in on a map is "more".
export function nudgeSpeed(speed, deltaY) {
  if (!deltaY) return speed;
  const s = deltaY < 0 ? speed * SPEED.notch : speed / SPEED.notch;
  return clamp(s, SPEED.min, SPEED.max);
}

// `?cam=x,y,z[,yaw[,pitch]]`: null for anything that is not three to five finite numbers.
export function parseCam(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const parts = text.split(',').map((s) => s.trim());
  if (parts.length < 3 || parts.length > 5 || parts.some((s) => s === '')) return null;
  const n = parts.map(Number);
  if (!n.every(Number.isFinite)) return null;
  return { x: n[0], y: n[1], z: n[2], yaw: wrapAngle(n[3] ?? 0), pitch: clampPitch(n[4] ?? 0) };
}

const short = (v, d) => String(Math.round(v * 10 ** d) / 10 ** d);
export function formatCam(p) {
  return [short(p.x, 2), short(p.y, 2), short(p.z, 2), short(p.yaw, 3), short(p.pitch, 3)].join(',');
}

// This page with the pose (and the room) in its query, every other parameter kept: a screenshot
// spot as a link. `noclip` is implied by `cam`, so it is dropped rather than repeated.
export function camLink(href, pose, room = null) {
  const u = new URL(href);
  u.searchParams.delete('noclip');
  u.searchParams.set('cam', formatCam(pose));
  if (room) u.searchParams.set('room', room); else u.searchParams.delete('room');
  // The commas read better as commas than as %2C, and are allowed in a query.
  return u.toString().replace(/%2C/gi, ',');
}

// A pose with whatever `patch` gives over `base`, the angles kept in range; nonsense is ignored.
export function mergePose(base, patch = {}) {
  const out = { ...base };
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch']) if (finite(patch[k])) out[k] = patch[k];
  out.yaw = wrapAngle(out.yaw);
  out.pitch = clampPitch(out.pitch);
  return out;
}

// A three.js camera looks down its own -z, so a yaw of `y` is a rotation of y + pi about +y.
export function applyPose(camera, p) {
  camera.position.set(p.x, p.y, p.z);
  camera.up.set(0, 1, 0);
  camera.rotation.set(p.pitch, p.yaw + Math.PI, 0, 'YXZ');
  camera.updateMatrixWorld();
}
// And back: read off whatever direction the camera is looking now.
export function poseOf(camera) {
  const e = camera.matrixWorld.elements;
  const fx = -e[8], fy = -e[9], fz = -e[10];
  const p = camera.position;
  return { x: p.x, y: p.y, z: p.z, ...lookFrom({ x: 0, y: 0, z: 0 }, { x: fx, y: fy, z: fz }) };
}

// The keys a noclip camera listens to, by KeyboardEvent.key (lower case). `code` is not used, so a
// rebound layout flies the way its letters say.
const MOVE_KEYS = {
  w: ['f', 1], arrowup: ['f', 1], s: ['f', -1], arrowdown: ['f', -1],
  d: ['r', 1], arrowright: ['r', 1], a: ['r', -1], arrowleft: ['r', -1],
  ' ': ['u', 1], e: ['u', 1], shift: ['u', -1], q: ['u', -1],
};
export const moveOf = (held) => {
  const m = { f: 0, r: 0, u: 0 };
  for (const k of held) { const a = MOVE_KEYS[k]; if (a) m[a[0]] += a[1]; }
  return m;
};

// The flying, on a canvas. `onExit` is the Escape that leaves (after the one that only freed the
// mouse); everything a mode needs to hand back is main.js's.
export function createNoclip({ camera, dom, onExit = null, onChange = null }) {
  let on = false;
  let pose = { x: 0, y: 10, z: 0, yaw: 0, pitch: 0 };
  const speed = { ...SPEED };
  let where = 'island';
  const held = new Set();
  let dragging = false, lastX = 0, lastY = 0;
  let unlockedAt = -Infinity;

  const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const locked = () => document.pointerLockElement === dom;
  function lock(again = 0) {
    if (locked()) return;
    // The browser refuses a lock for ~1.3 s after the user's own Escape (a SecurityError, as in
    // walk.js): a click inside that wait asks again once it is over, on the click's activation.
    try {
      dom.requestPointerLock()?.catch?.((err) => {
        if (err?.name !== 'SecurityError' || again >= 3) return;   // else: no lock, drag to look
        setTimeout(() => { if (on && !locked()) lock(again + 1); }, Math.max(150, 1350 - (performance.now() - unlockedAt)));
      });
    } catch { /* drag to look */ }
  }
  const changed = () => { if (onChange) onChange(); };

  // Capture phase on window, so walk.js and the island's own keys never see what flies.
  function onKeyDown(e) {
    if (!on || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      // The Escape that took the pointer lock away only frees the mouse, as on foot.
      if (performance.now() - unlockedAt < 250) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (onExit) onExit();
      return;
    }
    if (k === '+' || k === '=' || k === '-' || k === '_') {
      e.preventDefault(); e.stopImmediatePropagation();
      speed[where] = nudgeSpeed(speed[where], k === '-' || k === '_' ? 1 : -1);
      changed();
      return;
    }
    if (!MOVE_KEYS[k]) return;
    e.preventDefault(); e.stopImmediatePropagation();
    held.add(k);
  }
  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (held.delete(k) && on) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  // Shift released over another window, or a lost focus, must not leave you sinking for ever.
  const onBlur = () => held.clear();
  function onDown(e) {
    if (!on || e.button !== 0) return;
    lock();
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  }
  const onUp = () => { dragging = false; };
  function onMove(e) {
    if (!on) return;
    let dx = 0, dy = 0;
    if (locked()) { dx = e.movementX; dy = e.movementY; } else if (dragging) { dx = e.clientX - lastX; dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; }
    if (!dx && !dy) return;
    pose = turnBy(pose, dx, dy);
    applyPose(camera, pose);
  }
  function onWheel(e) {
    if (!on) return;
    e.preventDefault();
    speed[where] = nudgeSpeed(speed[where], e.deltaY);
    changed();
  }
  const onLock = () => { if (!locked()) unlockedAt = performance.now(); };

  addEventListener('keydown', onKeyDown, true);
  addEventListener('keyup', onKeyUp, true);
  addEventListener('blur', onBlur);
  dom.addEventListener('pointerdown', onDown);
  addEventListener('pointerup', onUp);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('pointerlockchange', onLock);

  return {
    active: () => on,
    // `wantLock`: true when the call came from a key or a click, which is a gesture the browser
    // will grant a lock for; from the console it would only be refused.
    enter(p, { wantLock = false } = {}) {
      on = true;
      held.clear();
      pose = mergePose(pose, p);
      applyPose(camera, pose);
      if (wantLock) lock();
    },
    exit() {
      on = false;
      held.clear();
      dragging = false;
      if (locked()) document.exitPointerLock?.();
    },
    update(dt) {
      if (!on) return false;
      const m = moveOf(held);
      if (!m.f && !m.r && !m.u) return false;
      pose = stepNoclip(pose, m, dt, speed[where]);
      applyPose(camera, pose);
      return true;
    },
    pose: () => ({ ...pose }),
    set(p) { pose = mergePose(pose, p); applyPose(camera, pose); },
    // Which speed is in use: the island's or a room's.
    setWhere(w) { where = w === 'room' ? 'room' : 'island'; },
    speed(v) {
      if (finite(v) && v > 0) { speed[where] = clamp(v, SPEED.min, SPEED.max); changed(); }
      return speed[where];
    },
    locked,
  };
}
