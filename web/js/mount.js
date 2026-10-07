// A horse you ride, and what makes it a horse rather than a bicycle with legs.
//
// Plans/paard-in-plaats-van-fiets.md, with the keeper's turn of 6 October 2026: the horse is at
// its own size (1.0) and only the Adventurer rides one - the Traveller keeps his bicycle
// (web/js/bicycle.js), and F is whichever of the two the body you wear has.
//
// Laid out like bicycle.js, for the same reason: `stepMount` is a pure function of the horse,
// the reins and the ground - no THREE, no document, no clock - so tests/mount.test.mjs can ride
// it under plain Node; `mountPose` is the legs, as plain numbers on fauna.js's own pose; and
// `createMount` is the drawing, the stable's horse (`createAnimal('horse')`) with its brain left
// asleep, posed from outside the way the timber wagon's and the rave's are. No new bake.
//
// Yaw is the island's convention (see boat.js): forward is (sin yaw, cos yaw), and turning to the
// right *lowers* yaw.
import * as THREE from 'three';
import { clamp } from 'shared/rng.mjs';
import { createAnimal, createPose, stepPose, applyPose, saddleOf } from './fauna.js';
import { solidMaterial } from './buildings.js';

// ---- the way --------------------------------------------------------------------------------
// The bicycle's numbers, on purpose (the plan, "De snelheden"): everything hung on them - the
// camera's pull, wrapEye, "under a boat of 9.5" - stays tuned. Shift is the gallop, paid for out
// of the body's pool as a run is.
export const MOUNT_TOP = 8.0;
export const MOUNT_GALLOP = 1.3;      // 10.4 flat out
export const MOUNT_ACCEL = 3.2;       // a horse has mass: nearly three seconds to cruising speed
export const MOUNT_BRAKE = 9.0;       // reined in from the top in under a second, but not in a pace
export const MOUNT_ROLL = 1.2;        // let go of the reins and it comes back to a halt in a few seconds
export const MOUNT_REVERSE = 1.0;     // S at a standstill backs it up, slowly
// A horse turns on its haunches standing and at a walk, and wide at a gallop: it does not pivot
// on its own axis flat out. Rad/s, from a walk's top down to the gallop's.
export const MOUNT_TURN = 2.6;
export const MOUNT_TURN_FAST = 1.1;
const SLOPE_PULL = 2.5;               // the hill, as bicycle.js has it
// Where you may get on and off: the same 0.06 the feet call the shore.
export const MOUNT_SHORE = 0.06;
// How deep a hoof still goes: a puddle and a shelving beach, not a river. Shallower than the
// bicycle's 0.3, because the horse's leg is 0.34 and the rider would be in to the boots.
export const MOUNT_WADE = 0.2;
const STEP_UP = 0.45;                 // walk.js's: a bridge you walk onto is one you ride onto
// Space is a jump, a little higher than the feet's (JUMP_V 3.1): 0.52 up rather than 0.38.
export const MOUNT_HOP = 3.6;
export const MOUNT_GRAVITY = 12.5;
// The probes: a horse is 0.82 long and the bicycle 0.4, so the middle alone let the head go
// through a wall. The chest is tested ahead of the middle and, backing up, the rump behind it -
// stable.js's HORSE_CLEAR, "half a horse, nose to rump, and a little".
export const MOUNT_NOSE = 0.32;
export const MOUNT_RUMP = 0.28;
const TURN_BITE = 0.1;
const SCRAPE_DRAG = 6.0;
const CREEP = 0.08;
const MAX_STEP = 0.04;                // one slice never jumps a wall, as boat.js promises

const TAU = Math.PI * 2;
const damp = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);
function axis(v) {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, -1, 1) : 0;
}

// A horse at (x, z) facing `yaw`, standing. `rate` is how fast it is turning (what the pose banks
// on), the rest what bicycle.js's bikeAt keeps.
export function mountAt(x, z, yaw = 0, y = 0) {
  return { x, y, z, yaw, v: 0, rate: 0, bumped: false, vy: 0, air: false, floor: y, splash: false };
}

// How fast a horse at speed `v` turns: MOUNT_TURN to a walk's top, falling to MOUNT_TURN_FAST at a
// gallop's.
export function turnRate(v) {
  const s = Math.abs(v);
  const t = clamp((s - GAIT_EDGES[0]) / (MOUNT_TOP * MOUNT_GALLOP - GAIT_EDGES[0]), 0, 1);
  return MOUNT_TURN + (MOUNT_TURN_FAST - MOUNT_TURN) * t;
}

// One step of the horse, `m` mutated and returned. The world is bicycle.js's: `ground(x, z)` the
// height underfoot, `blocked(x, z)` walk.js's solid test, `ceiling(x, z)` the highest the horse's
// *ground* may be under a lid there (a deck overhead less the rider's head), or omitted. Unlike
// the bicycle's, the ceiling stops the ride, not only a jump: a rider sits 0.35 higher than a
// walker, so a low deck, a bridge or the quay is a wall to a horse a walker passes under.
export function stepMount(m, { rein = 0, turn = 0, gallop = false, hop = false } = {}, dt,
  { ground, blocked = () => false, ceiling = null } = {}) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0 || typeof ground !== 'function') return m;
  if (hop === true && !m.air && !m.splash) { m.vy = MOUNT_HOP; m.air = true; m.floor = m.y; }
  const yaw0 = m.yaw;
  let left = dt;
  while (left > 1e-9 && !m.splash) {
    const step = Math.min(left, MAX_STEP);
    left -= step;
    slice(m, axis(rein), axis(turn), gallop === true, step, ground, blocked, ceiling);
  }
  let d = m.yaw - yaw0;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  m.rate = d / dt;
  return m;
}

function slice(m, p, r, boost, step, ground, blocked, ceiling) {
  const top = boost ? MOUNT_TOP * MOUNT_GALLOP : MOUNT_TOP;
  // ---- the turn ----------------------------------------------------------------------------
  // Backing up, the forehand swings the other way round, as the bicycle's front wheel does.
  m.yaw -= r * turnRate(m.v) * step * (m.v < -CREEP ? -1 : 1);
  if (m.yaw > Math.PI) m.yaw -= TAU;
  else if (m.yaw < -Math.PI) m.yaw += TAU;
  m.v *= 1 - TURN_BITE * Math.abs(r) * step;

  // ---- the reins ---------------------------------------------------------------------------
  const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
  if (m.air) {
    // nothing under the hooves to push off
  } else if (p > 0) {
    const want = p * top;
    if (m.v < want) m.v = Math.min(want, m.v + MOUNT_ACCEL * (top / MOUNT_TOP) * step);
    else m.v = Math.max(want, m.v - m.v * MOUNT_ROLL * 2 * step);
  } else if (p < 0) {
    if (m.v > 0) m.v = Math.max(0, m.v - MOUNT_BRAKE * -p * step);
    else m.v = Math.max(p * MOUNT_REVERSE, m.v - MOUNT_ACCEL * step);
  } else {
    m.v -= m.v * MOUNT_ROLL * step;
  }
  if (m.v !== 0 && !m.air) {
    const d = 0.15;
    const grade = (ground(m.x + fx * d, m.z + fz * d) - ground(m.x - fx * d, m.z - fz * d)) / (2 * d);
    m.v -= clamp(grade, -1.5, 1.5) * SLOPE_PULL * step;
  }
  m.v = clamp(m.v, -MOUNT_REVERSE, MOUNT_TOP * MOUNT_GALLOP);
  if (!p && !m.air && Math.abs(m.v) < CREEP) m.v = 0;

  // ---- the ride ----------------------------------------------------------------------------
  m.bumped = false;
  if (m.v !== 0) {
    const run = m.v * step;
    const nx = m.x + fx * run, nz = m.z + fz * run;
    const here = m.y;
    // Somewhere a hoof can be, under a lid with room for the rider.
    const footing = (x, z) => {
      const h = ground(x, z);
      if (!m.air && h < -MOUNT_WADE) return false;
      if (h - here > STEP_UP || blocked(x, z)) return false;
      return !ceiling || ceiling(x, z) >= (m.air ? m.y : h);
    };
    // The middle, and the chest going forward or the rump going back.
    const probe = m.v > 0 ? MOUNT_NOSE : -MOUNT_RUMP;
    const rideable = (x, z) => footing(x, z) && footing(x + fx * probe, z + fz * probe);
    if (rideable(nx, nz)) {
      m.x = nx; m.z = nz;
    } else {
      m.bumped = true;
      if (Math.abs(nx - m.x) > 1e-4 && rideable(nx, m.z)) m.x = nx;
      else if (Math.abs(nz - m.z) > 1e-4 && rideable(m.x, nz)) m.z = nz;
      else m.v = 0;
      m.v -= m.v * SCRAPE_DRAG * step;
      if (Math.abs(m.v) < CREEP) m.v = 0;
    }
    if (!m.air) m.y = ground(m.x, m.z);
  }

  // ---- up and down -------------------------------------------------------------------------
  if (m.air) {
    m.vy -= MOUNT_GRAVITY * step;
    m.y += m.vy * step;
    const lid = m.vy > 0 && ceiling ? ceiling(m.x, m.z) : Infinity;
    if (m.y > lid) { m.y = lid; m.vy = 0; }
    const under = ground(m.x, m.z);
    if (m.vy <= 0 && m.y <= under) {
      m.y = under;
      m.vy = 0;
      m.air = false;
      m.floor = under;
      // Came down in deep water: walk.js sends the horse off and leaves a swimmer.
      if (under < -MOUNT_WADE) { m.splash = true; m.v = 0; }
    }
  } else {
    m.floor = m.y;
  }
}

// ---- the gaits ------------------------------------------------------------------------------
// Bands of the speed, not a state anybody keeps (the plan, "Wat een paard bijzonder maakt"): the
// rider and every peer work it out of how fast the horse goes, so nothing about it is on the wire.
// The edges are the horse's, not the feet's: at the island's walking pace (0.65) a horse would be
// standing still. W rides it up through a walk and a trot into a canter at MOUNT_TOP; Shift is the
// gallop above it. GAIT_MARGIN either side of an edge keeps a horse riding on one from flickering.
export const GAITS = ['stand', 'walk', 'trot', 'canter', 'gallop'];
export const GAIT_EDGES = [0.15, 1.6, 4.2, MOUNT_TOP + 0.2];
export const GAIT_MARGIN = 0.3;
export function gaitOf(v, was = null) {
  const s = Math.abs(v);
  let g = 0;
  while (g < GAIT_EDGES.length && s > GAIT_EDGES[g]) g++;
  const k = GAITS.indexOf(was);
  if (k < 0 || k === g) return GAITS[g];
  // Stay in the old gait while within the margin of the edge between them. Standing still is
  // never held: a horse that has stopped has stopped.
  if (g > k && s <= GAIT_EDGES[g - 1] + GAIT_MARGIN && g - k === 1) return GAITS[k];
  if (g < k && s >= GAIT_EDGES[k - 1] - GAIT_MARGIN && k - g === 1 && g > 0) return GAITS[k];
  return GAITS[g];
}

// Strides a second. The reference horse (the plan, "De gangen van een referentiepaard, gemeten")
// keeps 1.27 Hz from a walk to a run and gains its speed with a longer stride; a real gallop is
// about 2 Hz. So the cadence saturates there and the island's game speeds are made up by hooves
// that slide - the bicycle's compromise, with its GEAR set high on purpose.
export const CADENCE = { stand: 0, walk: [0.8, 1.27], trot: [1.45, 1.6], canter: [1.7, 1.85], gallop: [1.95, 2.05] };
export const CADENCE_MAX = 2.1;
export function cadenceOf(v, gait) {
  const c = CADENCE[gait];
  if (!c) return 0;
  const k = GAITS.indexOf(gait);
  const lo = GAIT_EDGES[k - 1], hi = GAIT_EDGES[k] ?? MOUNT_TOP * MOUNT_GALLOP;
  const t = clamp((Math.abs(v) - lo) / (hi - lo), 0, 1);
  return Math.min(CADENCE_MAX, c[0] + (c[1] - c[0]) * t);
}

// When each leg comes down in its cycle (fl, fr, bl, br - fauna.js's LEG_NAMES order), how much
// of the cycle it stands, and how far it swings either side of hanging (radians).
//   walk     four-beat and lateral, as the reference measured: a hind, then the fore on the
//            same side a quarter later.
//   trot     diagonal pairs, with a moment of suspension.
//   canter   three beats: a hind, then the other hind with the diagonal fore, then the lead fore.
//   gallop   the reference's crossed gallop: LF 0, RF 20, LH 42, RH 60, a flight round 88-100%.
export const PATTERN = {
  walk: { land: [0.80, 0.30, 0.52, 0.02], duty: 0.70, swing: [0.24, 0.36] },
  trot: { land: [0.0, 0.5, 0.5, 0.0], duty: 0.42, swing: [0.36, 0.46] },
  canter: { land: [0.30, 0.55, 0.0, 0.30], duty: 0.36, swing: [0.46, 0.58] },
  gallop: { land: [0.0, 0.20, 0.42, 0.60], duty: 0.26, swing: [0.6, 0.72] },
};
// One leg's swing at `u` (0..1 of the cycle since it landed): forward at the landing, back along
// the ground through the stance, then forward through the air. Positive puts the hoof behind.
function legAt(u, duty, a) {
  if (u < duty) return -a + 2 * a * (u / duty);
  const s = (u - duty) / (1 - duty);
  return a - 2 * a * (0.5 - 0.5 * Math.cos(Math.PI * s));
}
const frac = (x) => x - Math.floor(x);
const LEG_RATE = 12;

// What the horse's body does, as fauna.js's pose (`headX`, `tailX`, `legs`, `bodyY`, `bodyX`...),
// for a horse going `speed` and turning at `rate`, `air` in the middle of a jump. Standing, it is
// the stable's horse's own 'still' - breathing, the tail's swish, the head about, the weight from
// one hind leg to the other (fauna.js stepPose) - and going, the gait is laid over that, so the
// tail still swishes at a walk. Writes the pose and never a position.
export function createRide({ phase = 0 } = {}) {
  return {
    pose: createPose('horse', { phase }),
    idle: createPose('horse', { phase }),
    cycle: 0, gait: 'stand', go: 0, hz: 0, lean: 0,
  };
}
export function mountPose(r, { speed = 0, rate = 0, air = false } = {}, dt = 0) {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  const v = Number.isFinite(speed) ? speed : 0;
  r.gait = gaitOf(v, r.gait);
  r.hz = cadenceOf(v, r.gait);
  r.cycle = frac(r.cycle + r.hz * step);
  const going = r.gait !== 'stand' || air;
  r.go = damp(r.go, going ? 1 : 0, going ? 6 : 3, step);
  stepPose('horse', r.idle, { act: 'still' }, step);
  const P = r.pose, I = r.idle, go = r.go;
  const pat = PATTERN[r.gait] || PATTERN.walk;
  const k = GAITS.indexOf(r.gait);
  const lo = GAIT_EDGES[k - 1] ?? 0, hi = GAIT_EDGES[k] ?? MOUNT_TOP * MOUNT_GALLOP;
  const within = clamp((Math.abs(v) - lo) / (hi - lo), 0, 1);
  const amp = pat.swing[0] + (pat.swing[1] - pat.swing[0]) * within;
  const c = r.cycle, w = TAU * c;
  // Backing up runs the walk the other way round.
  const back = v < 0 ? -1 : 1;
  for (let i = 0; i < 4; i++) {
    let to;
    if (air) to = i < 2 ? -0.55 : 0.5;                    // tucked over a jump
    else to = legAt(frac(back * c - pat.land[i]), pat.duty, amp);
    const was = P.legs[i];
    P.legs[i] = I.legs[i] + (to - I.legs[i]) * go;
    // A change of gait is a change of pattern: eased, not snapped. LEG_RATE is well over what a
    // gallop's own swing asks (~6 rad/s), so only a jump from one pattern to another is held back.
    const most = LEG_RATE * step;
    if (Math.abs(P.legs[i] - was) > most) P.legs[i] = was + Math.sign(P.legs[i] - was) * most;
  }
  // The back: still at a walk (the reference: 0.014 of a leg), a bounce twice a stride at a trot,
  // and in a canter and a gallop the whole body rocking once a stride, the head against it.
  let y = 0, pitch = 0, nod = 0, tailUp = 0;
  switch (r.gait) {
    case 'walk': y = 0.002 * Math.cos(2 * w); nod = 0.06 * Math.sin(2 * w); tailUp = 0.05; break;
    case 'trot': y = 0.012 * Math.abs(Math.sin(w)) - 0.006; nod = 0.04 * Math.sin(2 * w); tailUp = 0.25; break;
    case 'canter': y = 0.016 * Math.sin(w); pitch = 0.07 * Math.sin(w + 0.6); nod = -0.12 * Math.sin(w + 0.6); tailUp = 0.4; break;
    case 'gallop': y = 0.026 * Math.sin(w); pitch = 0.1 * Math.sin(w + 0.6) + 0.03; nod = -0.15 * Math.sin(w + 0.6) + 0.12; tailUp = 0.55; break;
    default: break;
  }
  if (air) { y = 0; pitch = 0; nod = -0.1; tailUp = 0.5; }
  r.lean = damp(r.lean, clamp(-rate * Math.abs(v) * 0.012, -0.12, 0.12), 6, step);
  P.headX = I.headX * (1 - go) + (nod + 0.05) * go;
  P.headY = I.headY * (1 - go);
  P.tailX = I.tailX + tailUp * go;
  // The swish goes on at every gait, smaller the faster the tail streams out behind.
  P.tailZ = I.tailZ * (1 - 0.6 * go) + 0.06 * go * Math.sin(w * 2);
  P.bodyY = I.bodyY * (1 - go) + y * go;
  P.bodyX = I.bodyX * (1 - go) + pitch * go;
  P.bodyZ = I.bodyZ * (1 - go) + r.lean;
  P.surge = 0;
  P.low = 0;
  return r;
}

// ---- where the rider goes -------------------------------------------------------------------
// The seat and the irons, read off the bake (fauna.js saddleOf), so a saddle baked again carries
// its rider with it; null without the horse in the build.
export const MOUNT = (() => {
  const s = saddleOf();
  return s ? { seat: s.seat, stirrup: s.stirrup, nose: MOUNT_NOSE, rump: MOUNT_RUMP } : null;
})();
// The horse is drawn at its own size: the Adventurer fits it (classic-avatar.js horsebackOf).
export const MOUNT_SCALE = 1;
// How much higher a rider's head is than a walker's: the hips on a seat at 0.48 rather than over
// the feet at the Adventurer's 0.25 - what the lid has to leave room for.
export const MOUNT_HEAD = MOUNT ? MOUNT.seat * MOUNT_SCALE - 0.25 : 0.23;

// ---- the drawing ----------------------------------------------------------------------------
// The stable's horse, nobody's brain in it: `place` puts it where `stepMount` says, `pose` steps
// mountPose and puts it on the joints, and `seat(out, hipY, perch)` is where a rider's feet go
// (his rig's origin) so that his hips sit on the saddle, in the world, after the pose - so the
// horse's bob and rock carry him. Seven parts, seven draw calls, like the bicycle.
export function createMount({ scene, material, seed = 'mount' }) {
  // Never seen through (buildings.js solidMaterial): the horse is under the rider the cone
  // is cut to show. The stable's, the wagon's and the story animals keep the island's.
  const horse = createAnimal('horse', solidMaterial(material), { area: { x: 0, z: 0, r: 0 }, seed });
  if (!horse) return null;
  const ride = createRide({ phase: (seed.length * 1.7) % 9 });
  horse.pose = ride.pose;
  horse.object.scale.setScalar(MOUNT_SCALE);
  horse.object.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(horse.object);
  const local = new THREE.Vector3();
  let at = [0, 0, 0];
  return {
    object: horse.object,
    ride,
    place(x, y, z, yaw) { at = [x, y, z]; horse.yaw = yaw; },
    pose(input, dt) {
      mountPose(ride, input, dt);
      applyPose(horse, at[0], at[1], at[2]);
      horse.object.updateMatrixWorld(true);
    },
    seat(out, hipY, perch = 0.015) {
      local.set(0, (MOUNT ? MOUNT.seat : 0.48) + (perch - hipY) / MOUNT_SCALE, 0);
      return out.copy(local).applyMatrix4(horse.object.matrixWorld);
    },
    get gait() { return ride.gait; },
    set visible(on) { horse.object.visible = on; },
    get visible() { return horse.object.visible; },
    dispose() { horse.dispose(); },
  };
}
