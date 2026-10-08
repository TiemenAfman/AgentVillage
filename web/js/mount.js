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
// asleep, posed from outside the way the timber wagon's and the rave's are. Blender supplies the skin and skeleton.
//
// Yaw is the island's convention (see boat.js): forward is (sin yaw, cos yaw), and turning to the
// right *lowers* yaw.
import * as THREE from 'three';
import { clamp } from 'shared/rng.mjs';
import { createAnimal, createPose, stepPose, stepDance, applyPose, saddleOf } from './fauna.js';
import { HORSE_TROT, HORSE_GALLOP, HORSE_PATTERNS, horseCadence, hoofPath, horseBody } from './horse-gait.js';
import { solidMaterial } from './buildings.js';
import { canBoost, spendPool } from './stamina.js';

// ---- the way --------------------------------------------------------------------------------
// Speeds match the small horse’s stride length. Sprint/Shift selects gallop.
export const MOUNT_TOP = HORSE_TROT;
export const MOUNT_GALLOP = HORSE_GALLOP / HORSE_TROT;
export const MOUNT_ACCEL = 1.4;       // a horse has mass: over a second to a trot, two more to a gallop
export const MOUNT_BRAKE = 4.5;       // reined in from the gallop in under a second, but not in a pace
export const MOUNT_ROLL = 1.2;        // let go of the reins and it comes back to a halt in a few seconds
export const MOUNT_REVERSE = .35;     // S at a standstill backs it up, slowly
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
// stable.js's HORSE_CLEAR, "half a horse, nose to rump, and a little". Moved out 0.1 with the
// longer neck (scripts/horse-model.py NECK_REACH), so the muzzle stands as far off a wall as before.
export const MOUNT_NOSE = 0.42;
export const MOUNT_RUMP = 0.28;
const TURN_BITE = 0.1;
const SCRAPE_DRAG = 6.0;
const CREEP = 0.08;
const MAX_STEP = 0.04;                // one slice never jumps a wall, as boat.js promises

// What each gait costs the horse's own pool (stamina.js HORSE), as a share of its full drain: a
// gallop all of it, a trot a tenth (forty seconds of gallop, four hundred of trot), and anything
// at or under MOUNT_WALK - a walk on a half-pressed stick, reined in, standing - nothing, which is
// where the pool fills. Measured off the horse's speed, as the gait is, after the step.
export const MOUNT_TROT_SHARE = 0.1;
export const MOUNT_WALK = 1.0;

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
//
// `pool` is the horse's own breath (stamina.js createPool(HORSE)): given one, `gallop` is only
// asked for - the horse gallops while the pool lets it and drops back to a trot once it is spent,
// as an empty body drops from a sprint - and the gait it went at is paid for after the step
// (`gaitShare`). `m.gallop` says whether this step was a gallop. Without a pool `gallop` is
// obeyed as it always was (the workbench, older tests).
export function stepMount(m, { rein = 0, turn = 0, gallop = false, hop = false, pool = null } = {}, dt,
  { ground, blocked = () => false, ceiling = null } = {}) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0 || typeof ground !== 'function') return m;
  if (hop === true && !m.air && !m.splash) { m.vy = MOUNT_HOP; m.air = true; m.floor = m.y; }
  const boost = gallop === true && (!pool || canBoost(pool));
  m.gallop = boost;
  const yaw0 = m.yaw;
  let left = dt;
  while (left > 1e-9 && !m.splash) {
    const step = Math.min(left, MAX_STEP);
    left -= step;
    slice(m, axis(rein), axis(turn), boost, step, ground, blocked, ceiling);
  }
  let d = m.yaw - yaw0;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  m.rate = d / dt;
  if (pool) spendPool(pool, gaitShare(m.v), dt);
  return m;
}

// The share of the pool's drain a horse going at `v` spends: the gait bands (gaitOf, without its
// hysteresis - the pool needs no flicker guard, it only adds up) with a walk carved out of the trot.
export function gaitShare(v) {
  const s = Math.abs(v);
  if (s > GAIT_EDGES[1]) return 1;
  if (s > MOUNT_WALK) return MOUNT_TROT_SHARE;
  return 0;
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
// Normal reins select trot; sprint selects gallop. Hysteresis prevents flicker.
export const GAITS = ['stand', 'trot', 'gallop'];
export const GAIT_EDGES = [.02, 2.6];   // between the trot (1.9) and the gallop (4.8)
export const GAIT_MARGIN = .05;
export function gaitOf(v, was = null) {
  const speed=Math.abs(v);
  if(speed<=GAIT_EDGES[0])return 'stand';
  const threshold=GAIT_EDGES[1]+(was==='gallop'?-GAIT_MARGIN:was==='trot'?GAIT_MARGIN:0);
  return speed>threshold?'gallop':'trot';
}
export const CADENCE = {stand:0,trot:[.75,2.5],gallop:[1.7,3.0]};
export const CADENCE_MAX=3.1;
export const cadenceOf=(speed,gait)=>gait==='stand'?0:horseCadence(speed,gait);
export const PATTERN=HORSE_PATTERNS;
const frac=(x)=>x-Math.floor(x);
const body={};
export function createRide({phase=0}={}) {
  return {pose:createPose('horse',{phase}),idle:createPose('horse',{phase}),
    cycle:0,gait:'stand',go:0,hz:0,lean:0,transition:0,offsets:[],speed:0};
}
export function mountPose(r,{speed=0,rate=0,air=false,graze=false,dance=null}={},dt=0) {
  const step=Number.isFinite(dt)&&dt>0?Math.min(dt,.1):0;
  const v=Number.isFinite(speed)?speed:0;
  const old=r.gait;
  r.gait=gaitOf(v,r.gait);
  r.hz=cadenceOf(v,r.gait);
  r.cycle=frac(r.cycle+r.hz*step);
  r.speed=v;
  r.go=damp(r.go,r.gait==='stand'&&!air?0:1,8,step);
  // Standing, a horse may put its head down and graze (fauna.js HORSE_GRAZE), rider or not.
  // Or, at the rave's count (`dance` = the beat), dance as the stable's horse does (fauna.js HORSE_DANCE).
  const dancing=Number.isFinite(dance)&&r.gait==='stand';
  if(dancing) stepDance('horse',r.idle,{beat:dance,up:false},step);
  else stepPose('horse',r.idle,{act:graze&&r.gait==='stand'?'feed':'still'},step);
  const P=r.pose,I=r.idle;
  P.hooves ||= Array.from({length:4},()=>({z:0,y:0,flex:0,contact:true}));
  if(old!==r.gait) {
    r.transition=1;
    r.offsets=P.hooves.map((foot,i)=>{
      const next=hoofPath(r.cycle,i,r.gait==='stand'?0:v,r.gait,r.hz);
      const o={z:foot.z-next.z,y:foot.y-next.y,flex:(foot.flex||0)-next.flex};
      // Never carry a bad number into the ease: one NaN here stays in that hoof for good.
      for(const k in o) if(!Number.isFinite(o[k])) o[k]=0;
      return o;
    });
  }
  r.transition=Math.max(0,r.transition-step*5);
  // The body over the stride (Preston Blair's sheets, horse-gait.js horseBody): the trot
  // bobs twice a stride, everything together; the gallop see-saws, pelvis and ribcage in
  // turn, most compressed in the suspension and most stretched over the fores.
  const B=horseBody(r.cycle,r.gait==='stand'?'trot':r.gait,body);
  P.bodyY=I.bodyY*(1-r.go)+B.bodyY*r.go;
  P.bodyX=I.bodyX*(1-r.go)+B.bodyX*r.go;
  P.graze=(I.graze||0)*(1-r.go);
  // Dancing up on its hind legs (fauna.js HORSE_DANCE) horse-rig.js poses the legs from these.
  P.rear=(I.rear||0)*(1-r.go);P.hindStep=I.hindStep;
  r.lean=damp(r.lean,clamp(-rate*Math.abs(v)*.055,-.09,.09),6,step);
  P.bodyZ=I.bodyZ*(1-r.go)+r.lean;
  P.headX=I.headX*(1-r.go)+B.headX*r.go;
  P.headY=I.headY*(1-r.go);
  P.tailX=I.tailX+B.tailX*r.go;
  P.tailZ=I.tailZ*(1-.5*r.go);
  for(let i=0;i<4;i++) {
    const foot=P.hooves[i];
    hoofPath(r.cycle,i,r.gait==='stand'?0:v,r.gait,r.hz,foot);
    if(dancing&&I.danceHooves){const d=I.danceHooves[i];foot.z=d.z;foot.y=d.y;foot.flex=d.flex;foot.contact=d.contact;}
    if(r.transition&&r.offsets[i]) {
      const ease=r.transition*r.transition*(3-2*r.transition);
      foot.z+=r.offsets[i].z*ease;
      foot.y=Math.max(0,foot.y+r.offsets[i].y*ease);
      foot.flex=Math.max(0,foot.flex+r.offsets[i].flex*ease);
    }
    // In the air the legs are drawn in, fores folded under the chest, hinds trailing.
    if(air){foot.y=i<2?.12:.075;foot.z=i<2?-.06:.04;foot.flex=i<2?1.2:.6;foot.contact=false;}
    P.legs[i]=I.legs[i]*(1-r.go)+Math.atan2(-foot.z,.3)*r.go;
  }
  if(air){P.bodyY=0;P.bodyX=0;}
  P.surge=0;P.low=0;
  return r;
}

// ---- how the rider rides ---------------------------------------------------------------------
// A rider is not bolted to the saddle. Copying the horse's quaternion onto him (as walk.js,
// peers.js and the motion workbench did) tipped him whole with every rock of the gallop - seven
// degrees either way, the head swinging like the end of a stick. A rider's seat follows the
// saddle and his spine takes the rest: the pelvis goes with `PELVIS_SHARE` of the horse's pitch,
// the torso stays nearly where it was in the world, and what is left over is a body on springs -
// a little late on every rise of the back, a little overshoot when the gait changes. In the
// gallop he goes into a half seat (forward over the withers, hips a hand off the leather, the
// knees taking the bob), at the trot he sits it and is lifted a touch on each diagonal, and his
// hands give and take with the horse's head so the reins stay the same length.
// Drawing only: nothing here is on the wire, and each page works it out of the horse it draws.
export const PELVIS_SHARE = .3;
export const RIDER_SEAT = {
  stand: { lean: 0, rise: 0, give: 0 },
  trot: { lean: 4 * Math.PI / 180, rise: 0, give: .3 },
  gallop: { lean: 17 * Math.PI / 180, rise: .012, give: .7 },
};
export function createRider() {
  return { lean: 0, leanV: 0, y: 0, yV: 0, rise: 0, seatY: null, pitch: 0, arm: 0,
    bob: 0, bobV: 0, lastV: 0, motion: { lean: 0, arm: 0, elbow: 0, lift: 0 } };
}
// One step of the rider over the horse's pose: `saddleY` is the saddle's height this frame (the
// spring works on how it moves, not where it is). Returns the rider's own pitch (radians,
// forward positive like bodyX), vertical offset from the seat and his `motion` for the rig.
export function stepRider(k, ride, saddleY, dt) {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, .05) : 0;
  const P = ride.pose, want = RIDER_SEAT[ride.gait] || RIDER_SEAT.stand, go = ride.go;
  // The hips sit the saddle; the body above lags it. A stiff spring when he sits (trot, stand:
  // a sitting trot is felt in the seat), softer in the half seat, where the knees take the bob.
  if (k.seatY === null || !step) { k.seatY = saddleY; k.y = 0; k.yV = 0; }
  const moved = saddleY - k.seatY; k.seatY = saddleY;
  // The arms hang loose off the shoulders: what lifts the body flings them down a moment later
  // and they swing back - a damped spring driven by how the body's height speeds up and slows.
  const bodyV = step ? (moved + k.yV * step) / step : 0;
  const accel = step ? Math.max(-40, Math.min(40, (bodyV - k.lastV) / step)) : 0;
  k.lastV = bodyV;
  k.bobV += (-120 * k.bob - 2 * .3 * Math.sqrt(120) * k.bobV + 4.5 * accel) * step;
  k.bob = Math.max(-.25, Math.min(.25, k.bob + k.bobV * step));
  const stiff = ride.gait === 'gallop' ? 90 : 260, damping = 2 * .55 * Math.sqrt(stiff);
  k.y -= moved;                                    // the saddle went, the body has not yet
  k.yV += (-stiff * k.y - damping * k.yV) * step;
  k.y += k.yV * step;
  // He can be left behind by a falling saddle, never sink into a rising one: the leather pushes
  // him up at once and he comes down onto it again on his own weight.
  if (k.y < 0) { k.y = 0; if (k.yV < 0) k.yV = 0; }
  // At most what his knees can give back with his feet kept in the irons (classic-avatar.js
  // stirrupLeg, tests/horseback-pose.test.mjs): with the thighs close along the saddle, 25 degrees
  // out, that is about 2.5 cm before the leg is straight (it was 6 mm with them round the old box
  // flaps at 45). Rise plus this is 2 cm, inside it with a margin.
  if (k.y > .008) { k.y = .008; if (k.yV > 0) k.yV = 0; }
  k.rise = damp(k.rise, want.rise * go, 4, step);
  // The torso's own lean: the gait's seat, plus what the horse's pitch would have tipped it by
  // and the spine gave back, eased by a spring so it overshoots a little and settles.
  const target = want.lean * go;
  k.leanV += (90 * (target - k.lean) - 2 * .5 * Math.sqrt(90) * k.leanV) * step;
  k.lean += k.leanV * step;
  k.pitch = P.bodyX * PELVIS_SHARE;
  // The hands follow the mouth: forward as the head goes down, back as it comes up.
  k.arm = damp(k.arm, want.give * (P.headX - .03) * go, 12, step);
  k.motion.lean = k.lean;
  k.motion.arm = k.arm + k.bob * .4;
  k.motion.elbow = -k.arm * .8 + k.bob;
  k.motion.lift = k.y + k.rise;
  return k;
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
  const local = new THREE.Vector3(), hips = new THREE.Vector3(), up = new THREE.Vector3();
  const rider = createRider();
  let at = [0, 0, 0];
  return {
    object: horse.object,
    ride,
    joints: horse.horseRig,
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
    // Puts a rider's rig (its origin at the soles) so that his hips are on the saddle, turned
    // as a rider turns (stepRider), and returns his `motion` for the rig's horseback pose.
    // `extraRoll` is a drunk's sway, about his own forward axis.
    carry(object, hipY, perch = 0.015, dt = 0, extraRoll = 0) {
      local.set(0, (MOUNT ? MOUNT.seat : 0.48) + perch / MOUNT_SCALE, 0);
      hips.copy(local).applyMatrix4(horse.object.matrixWorld);
      stepRider(rider, ride, hips.y, dt);
      object.rotation.set(rider.pitch, horse.yaw, ride.pose.bodyZ + extraRoll);
      up.set(0, hipY - rider.y - rider.rise, 0).applyEuler(object.rotation);
      object.position.copy(hips).sub(up);
      return rider.motion;
    },
    get gait() { return ride.gait; },
    set visible(on) { horse.object.visible = on; },
    get visible() { return horse.object.visible; },
    dispose() { horse.dispose(); },
  };
}
