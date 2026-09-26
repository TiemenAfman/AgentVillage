// The animals at their own business (scripts/build-fauna.py). Nobody's agent and nobody's
// errand: a horse grazes its paddock, sheep drift over a field, a hen scratches about, a duck
// paddles, a gull circles the harbour. Passive life, the kind a village has whatever its
// settlers are doing - and, since Plans/dierenverhalen.md, the joints of the island's story
// animals too, which are somebody and are walked by the sea.
//
// Every animal is baked in parts with their origins on their joints, so each part hangs on
// its own `at` and every angle below is a turn about a real hip, neck or shoulder.
//
// Two halves, kept apart on purpose:
//
//   the pose     createPose / stepPose / jointEuler: an act, whether the body is going
//                anywhere and how fast go in, an angle per joint and a lift, lean and lunge
//                of the whole body come out. It never moves the animal. It runs off its own
//                clock, like the settlers' sine waves in settler-figures.js, and nothing it
//                computes feeds back into a position - which is exactly what lets the sea
//                walk a hen while every page draws her pecking in its own time.
//   the brain    createAnimal's small state machine on a seeded rng: stand, graze or peck,
//                walk to somewhere new inside its patch. Only /demo and the stable use it -
//                an animal with nobody to answer to. So two runs of the same frames are the
//                same field (tests/fauna.test.mjs).
//
// There is one animation, not two: the brain hands its mood to the same stepPose the live
// view (web/js/animal-view.js) hands the sea's word to, and both put the angles on their
// parts through the same jointEuler. A pose added for the story animals is one the model
// sheet shows as well.
//
// `createAnimal(kind, material, { area, seed, ground })` gives { object, update(dt) }: `area`
// is where it may go, in the frame the object is added to - { x, z, r } for a round patch, or
// { x0, x1, z0, z1 } for a paddock - and
// `ground(x, z)` the height there (the water surface for a duck), 0 when not given.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from 'shared/rng.mjs';
import { ACTS } from 'shared/animals.mjs';
import { mesh } from './buildings.js';
import * as models from './models.js';

// How each kind behaves. `walk` is its pace in units a second, `stride` how far a leg swings,
// `graze` how far the head comes down; the times are how long it holds a mood, as a range.
export const KINDS = {
  horse: { legs: 4, walk: 0.22, stride: 0.42, gait: 7, graze: 0.95, still: [3, 7], feed: [4, 9] },
  cow: { legs: 4, walk: 0.1, stride: 0.3, gait: 5, graze: 1.25, still: [4, 9], feed: [6, 12] },
  sheep: { legs: 4, walk: 0.12, stride: 0.45, gait: 9, graze: 0.7, still: [2, 5], feed: [3, 8] },
  // Made from a picture (scripts/build-fauna.py, AI): quicker than a sheep and never still long.
  goat: { legs: 4, walk: 0.15, stride: 0.4, gait: 9, graze: 0.9, still: [1, 4], feed: [2, 5] },
  chicken: { legs: 2, walk: 0.12, stride: 0.5, gait: 16, graze: 1.1, still: [0.5, 2], feed: [0.4, 1.2] },
  duck: { legs: 0, walk: 0.06, stride: 0, gait: 0, graze: 1.3, still: [2, 5], feed: [0.8, 1.6], swims: true },
  gull: { legs: 2, walk: 0.9, stride: 0.5, gait: 14, graze: 0.5, still: [2, 5], feed: [1, 2], flies: true },
  // From four views of it: rooting about, never in a hurry.
  pig: { legs: 4, walk: 0.09, stride: 0.35, gait: 9, graze: 0.55, still: [2, 6], feed: [3, 8] },
  // Two models made from pictures (scripts/build-fauna.py): fauna_sparrow on the ground, hopping
  // and pecking, and fauna_sparrow_flying on the wing - see createSparrow below.
  sparrow: { legs: 0, walk: 0.8, stride: 0, gait: 0, graze: 0.9, still: [3, 9], feed: [0.15, 0.3] },
};
// A gull on the wing: how high it circles and how fast its wings go.
const FLIGHT_Y = 1.6;
const FLAP_HZ = 2.2;
// Folded, a wing sweeps back along the body (the bake has it spread).
const FOLD = 1.25;
const TAU = Math.PI * 2;

// Which way "out" is for each wing, as the sign a flap is multiplied by: [wing l, wing r]. The
// drawn birds were modelled with `wing l` on -x, the sparrow made from a picture with it on
// +x - the bird's own left, since it faces +z - so the same flap needs opposite signs. Read
// off the bake rather than argued about: the sign of each wing's `at` is the table.
const WING_SIDES = { sparrow: [1, -1] };
const DEFAULT_SIDES = [-1, 1];
const sidesOf = (kind) => WING_SIDES[kind] || DEFAULT_SIDES;
// The order the legs are named in, which is the order `pose.legs` keeps them in. Four legs
// swing in diagonal pairs (fl with br), two alternate.
const LEG_NAMES = { 4: ['fl', 'fr', 'bl', 'br'], 2: ['l', 'r'] };

function slotsOf(asset, name) {
  return models.assetParts(asset).filter((n) => n === name || n.startsWith(name + ':'));
}
const atOf = (asset, name) => {
  const names = slotsOf(asset, name);
  return names.length ? models.part(names[0]).at : null;
};

export function hasAnimal(kind) {
  return models.hasAsset(`fauna_${kind}`);
}

// ---- the parts ------------------------------------------------------------------------------
// The baked models a kind is drawn from. Every kind is one, except the sparrow, which is two
// that take turns: sitting on the ground and on the wing (`pose.flying` says which).
export const SPARROW_SITTING = 'fauna_sparrow';
export const SPARROW_FLYING = 'fauna_sparrow_flying';
export function assetsOf(kind) {
  const names = kind === 'sparrow' ? [SPARROW_SITTING, SPARROW_FLYING] : [`fauna_${kind}`];
  return names.filter((n) => models.hasAsset(n));
}
// Whether `asset` is the model to show for this pose, given which of the kind's models exist.
// Without the sitting sparrow there is nothing to show on the ground - a flying sparrow with
// its wings folded down is no bird at all - so the flying one stands in, and the other way
// round.
export function showsAsset(kind, pose, asset, has = models.hasAsset) {
  if (kind !== 'sparrow') return true;
  const flying = pose.flying ? has(SPARROW_FLYING) : !has(SPARROW_SITTING);
  return asset === (flying ? SPARROW_FLYING : SPARROW_SITTING);
}

// The moving parts of one asset: each named part (its slots `:0`, `:1` merged back into one),
// what kind of joint it is and which leg or wing, and where the joint is. The same list
// createAnimal hangs its pivots from and animal-view.js builds its instanced batches from,
// so the two can never disagree about which part turns about what.
export function animalParts(asset) {
  const kind = asset.replace(/^fauna_/, '').replace(/_flying$/, '');
  const legs = LEG_NAMES[(KINDS[kind] || {}).legs] || [];
  const out = [];
  const seen = new Set();
  for (const n of models.assetParts(asset)) {
    const base = n.split(':')[0];
    if (seen.has(base)) continue;
    seen.add(base);
    const [role, which = ''] = base.slice(asset.length + 1).split(' ');
    const index = role === 'leg' ? legs.indexOf(which) : role === 'wing' ? ['l', 'r'].indexOf(which) : 0;
    out.push({ name: base, role, index, at: models.part(n).at, order: role === 'wing' ? 'YZX' : 'XYZ' });
  }
  return out;
}
// One part as one geometry, its slots merged: what a pivot or an InstancedMesh draws.
export function partGeometry(base) {
  const asset = base.split(' ')[0];
  const names = slotsOf(asset, base);
  if (!names.length) return null;
  return names.length === 1 ? mesh(names[0]) : mergeGeometries(names.map((x) => mesh(x)), false);
}

// How far a body sinks when it lies down, and how long it is, measured off the bake rather
// than written down per kind: lying down is the belly on the grass, which is how high the
// lowest point of the body part is, and a lunge is a fraction of a body length. Cached, since
// the pose asks every frame.
const measured = new Map();
function measureOf(kind) {
  let m = measured.get(kind);
  if (m) return m;
  m = { drop: 0, len: 0.2 };
  const asset = assetsOf(kind)[0];
  if (asset) {
    let y0 = Infinity, z0 = Infinity, z1 = -Infinity;
    for (const n of slotsOf(asset, `${asset} body`)) {
      const p = models.part(n);
      for (let i = 0; i < p.positions.length; i += 3) {
        y0 = Math.min(y0, p.positions[i + 1] + p.at[1]);
        const z = p.positions[i + 2] + p.at[2];
        z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
    }
    // Nine tenths: a body lying *on* the ground reads as floating over it from any angle
    // but straight along the grass, and a hair into it reads as lying in it.
    if (Number.isFinite(y0)) m.drop = Math.max(0, y0 * 0.9);
    if (z1 > z0) m.len = z1 - z0;
  }
  measured.set(kind, m);
  return m;
}

// ---- the pose -------------------------------------------------------------------------------
// What a joint is doing, for a kind, as plain numbers: no Object3D, no matrix. Everything
// createAnimal and animal-view.js draw comes out of these fields, and nothing else.
//
//   headX, headY       the neck's nod (down is positive) and turn (to the animal's left)
//   tailX, tailZ       the tail raised (positive) and wagged
//   legs[i]            each hip's swing, in LEG_NAMES order; positive puts the foot behind
//   wingY[i], wingZ[i] each shoulder, [l, r]: folded back along the body, and flapped out
//   bodyY              the whole body up or down: a stride's bob, a hop, lying down
//   bodyX, bodyZ       the whole body leant forward (positive) and banked
//   surge              the whole body lunged forward along its facing: a butt, a nudge
//   flying             the sparrow on the wing - which of its two models shows
//
// `phase` offsets the pose's own clock, so a flock does not nod in step.
export function createPose(kind, { phase = 0 } = {}) {
  const K = KINDS[kind] || KINDS.chicken;
  const sides = sidesOf(kind);
  return {
    kind, t: phase, gait: 0, act: 'still', since: 0,
    headX: 0, headY: 0, tailX: 0, tailZ: 0,
    legs: new Array(K.legs).fill(0),
    wingY: [sides[0] * FOLD, sides[1] * FOLD], wingZ: [0, 0],
    bodyY: 0, bodyX: 0, bodyZ: 0, surge: 0,
    flying: false,
    // What is damped rather than set: how far down the body has settled (0 standing, 1 lying),
    // and the lean, bank and lunge, which would otherwise snap from one act to the next.
    low: 0,
  };
}

const damp = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// A beat within a repeating cycle: 0..1 over `period` seconds of `t`.
const cyc = (t, period) => { const u = t / period; return u - Math.floor(u); };
// A sharp jab and a slower draw back: up to 1 in the first `up` of the cycle, back to 0 by
// `back`, and nothing for the rest. A butt, not a sine.
const jab = (u, up, back) => (u < up ? u / up : u < back ? 1 - (u - up) / (back - up) : 0);
const ACT_SET = new Set(ACTS);
// The acts with their own going: a hop and a flight carry the body however it is moving,
// so a stride is not laid over them.
const OWN_GAIT = new Set(['hop', 'fly']);
// Acts a head does quickly. Damped at the grazing rate, a peck would never reach the ground.
const QUICK = new Set(['peck', 'scratch', 'nudge', 'butt', 'nibble', 'chirp', 'steal', 'perch', 'dust', 'hop']);
// How far each kind's legs fold lying down, and how high a hop goes, in radians and units.
const FOLD_LEGS = { 4: [1.35, 1.35, -1.35, -1.35], 2: [1.2, 1.2] };
const HOP_HIGH = { sparrow: 0.018, chicken: 0.03, gull: 0.03, duck: 0.02 };
// The sparrow on the ground: a hop lasts HOP_S and it pauses between them; on the wing it
// flaps FLAP.hz times a second. Past SPARROW_FLY_U it is going too fast for hopping and is
// crossing by air, whatever word came with it (MOTION.sparrow.hurry is 1.1, its amble 0.06).
const HOP_S = 0.2;
const FLAP = { amp: 0.7, hz: 9 };
const SPARROW_FLY_U = 0.35;

// Advance a pose by `dt`: `act` is a word out of ACTS (anything else reads as 'still'),
// `moving` whether the body is actually going anywhere on this screen and `speed` how fast,
// in units a second. `turn` is the heading's rate of change (radians a second), which banks a
// bird on the wing; `bank` sets that lean outright instead. Nothing here moves the animal.
export function stepPose(kind, pose, { act = 'still', moving = false, speed = 0, turn = 0, bank = null } = {}, dt = 0) {
  if (!pose) return pose;
  const K = KINDS[kind] || KINDS.chicken;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  let a = ACT_SET.has(act) ? act : 'still';
  const sparrow = kind === 'sparrow';
  const four = K.legs === 4, two = K.legs === 2;
  // Nobody walks on the spot: a walk the body is not making is standing. And only what can
  // fly flies - a goat told to is a goat walking.
  if (a === 'fly' && !sparrow && !K.flies && !two) a = moving ? 'walk' : 'still';
  if (a === 'walk' && !moving) a = 'still';
  if (a !== pose.act) { pose.act = a; pose.since = 0; }
  pose.t += step;
  pose.since += step;
  const t = pose.t, since = pose.since;
  const sides = sidesOf(kind);
  const M = measureOf(kind);

  // The sparrow's model: on the wing for a flight, and for anything fast enough that it can
  // only be one. Everything else it does sitting.
  pose.flying = sparrow && (a === 'fly' || (moving && speed > SPARROW_FLY_U && a !== 'hop'));
  const inFlight = a === 'fly' && (K.flies || sparrow);
  // Stepping: whenever the body goes somewhere on its feet. A sparrow's feet are a hop.
  const striding = moving && !OWN_GAIT.has(a) && !pose.flying && !sparrow && K.stride > 0;
  const hopping = !pose.flying && (a === 'hop' || (sparrow && moving));
  const pace = K.walk > 0 ? clamp(speed / K.walk, 0.5, 3) : 1;
  if (striding) pose.gait += step * K.gait * pace * (a === 'steal' ? 1.3 : 1);

  // ---- the head ---------------------------------------------------------------------------
  let pitch = 0, yaw = 0;
  const g = K.graze;
  switch (a) {
    case 'still':
      pitch = 0.08 * Math.sin(t * 0.7);
      // A sparrow looks about in jerks: three headings, held, snapped between.
      yaw = sparrow ? 0.35 * Math.round(1.4 * Math.sin(t * 1.1)) : 0.25 * Math.sin(t * 0.37);
      break;
    case 'feed':
      // Grazing puts the head down and keeps it there; a hen, a gull and a duck dip.
      pitch = two || K.swims || sparrow ? g * Math.max(0, Math.sin(t * (K.swims ? 3 : 9))) : g;
      break;
    case 'peck': {
      // Single dips from the moment it starts, in bursts: a peck and a look, a peck and a look.
      const period = sparrow ? 0.55 : two ? 0.45 : 1.2, dip = sparrow ? 0.3 : two ? 0.22 : 0.6;
      const u = (since % period) / dip;
      pitch = u < 1 ? g * Math.sin(Math.PI * u) : 0;
      break;
    }
    case 'dust': pitch = 0.3; break;
    case 'scratch': pitch = 0.55 + 0.12 * Math.max(0, Math.sin(t * 7)); break;
    case 'rest': pitch = 0.25; break;
    case 'nudge': pitch = 0.45 + 0.12 * Math.sin(t * 4); break;
    case 'butt': pitch = 0.55 + 0.25 * jab(cyc(since, 1.1), 0.12, 0.35); break;
    case 'nibble':
      pitch = 0.15 + 0.07 * Math.sin(t * 11);
      yaw = 0.12 * Math.sin(t * 1.7);
      break;
    case 'watch':
      // Head up, turning slowly from one side to the other: keeping an eye on the place.
      pitch = -0.35;
      yaw = sparrow ? 0.45 * Math.round(1.4 * Math.sin(t * 0.8)) : 0.6 * Math.sin(t * 0.45);
      break;
    case 'perch':
      yaw = 0.4 * Math.round(1.4 * Math.sin(t * 1.3));
      pitch = 0.05;
      break;
    case 'chirp':
      // Head back and the beak going: a bob at the rate of the song.
      pitch = -0.45 + 0.14 * Math.abs(Math.sin(t * 10));
      yaw = 0.2 * Math.round(Math.sin(t * 0.7));
      break;
    case 'hop': pitch = 0.1 * Math.max(0, Math.sin(t * 5)); break;
    case 'fly': pitch = 0.1; break;
    case 'steal':
      // Head up with whatever it has got, and looking back over its shoulder when it stops.
      pitch = -0.15;
      yaw = moving ? 0 : 0.45 * Math.sin(t * 3);
      break;
    case 'point': pitch = -0.22; break;
    default: break;
  }
  // A walk carries the head level, the way it always did. Only a walk: a peck or a butt the
  // page is still gliding the last centimetres of keeps reading as a peck or a butt.
  if (striding && a === 'walk') { pitch = 0; yaw = 0; }
  const quick = QUICK.has(a) || sparrow;
  pose.headX = damp(pose.headX, pitch, quick ? 18 : two ? 14 : 3, step);
  pose.headY = damp(pose.headY, yaw, sparrow ? 30 : 6, step);

  // ---- the tail ---------------------------------------------------------------------------
  const swish = 0.25 * Math.sin(t * 2.3) * Math.max(0, Math.sin(t * 0.41));
  let tailZ = swish, tailX = 0;
  if (a === 'rest') tailZ = swish * 0.3;
  else if (a === 'watch' || a === 'point') tailZ = 0;
  else if (a === 'butt' || a === 'nudge' || a === 'nibble') tailZ = 0.3 * Math.sin(t * 9);
  if (a === 'point' || a === 'steal' || a === 'watch') tailX = 0.35;
  pose.tailZ = tailZ;
  pose.tailX = damp(pose.tailX, tailX, 6, step);

  // ---- lying down and crouching -----------------------------------------------------------
  const lowTo = a === 'rest' ? 1 : a === 'dust' ? (four ? 0.8 : 0.6) : 0;
  pose.low = damp(pose.low, lowTo, 3, step);
  const fold = FOLD_LEGS[K.legs];

  // ---- the legs ---------------------------------------------------------------------------
  const stride = K.stride * clamp(0.85 + 0.15 * pace, 0.85, 1.3);
  let air = 0;
  if (hopping) {
    // A hop and a pause, the whole body in the air for the hop. On the move the pause is
    // shorter: a sparrow crossing a lawn is a string of them.
    const period = HOP_S + (moving ? 0.12 : 0.45);
    const u = (since % period) / HOP_S;
    air = u < 1 ? Math.sin(Math.PI * u) : 0;
  }
  for (let i = 0; i < pose.legs.length; i++) {
    if (a === 'fly') pose.legs[i] = 0.9;                  // tucked up behind
    else if (striding) {
      // Diagonal pairs together on four, alternate on two.
      const pair = four ? (i === 0 || i === 3 ? 0 : Math.PI) : i * Math.PI;
      pose.legs[i] = stride * Math.sin(pose.gait + pair);
    } else if (a === 'scratch') {
      // A hen kicks back with one foot, then the other; a goat paws with a front hoof.
      const s = Math.sin(t * 7);
      const to = two ? 0.8 * Math.max(0, i === 0 ? s : -s) : i === 0 ? -0.6 * Math.max(0, Math.sin(t * 5)) : 0;
      pose.legs[i] = damp(pose.legs[i], to, 30, step);
    } else if (a === 'butt') {
      // The back legs drive the lunge.
      pose.legs[i] = four && i >= 2 ? 0.25 * jab(cyc(since, 1.1), 0.12, 0.35) : 0;
    } else if (hopping) {
      // Tucked in the air: front feet forward, back feet back.
      pose.legs[i] = air * (four ? (i < 2 ? -0.35 : 0.35) : 0.5);
    } else {
      // Folded under a body lying down, and back to standing from wherever they were.
      pose.legs[i] = damp(pose.legs[i], fold ? fold[i] * pose.low : 0, 8, step);
    }
  }

  // ---- the wings --------------------------------------------------------------------------
  for (let i = 0; i < 2; i++) {
    const side = sides[i];
    let y = side * FOLD, z = 0;
    if (sparrow) {
      // The flying model's wings; the sitting model has none, so folded is only ever seen as
      // the instant between the two.
      y = 0;
      z = pose.flying ? side * FLAP.amp * Math.sin(t * FLAP.hz * TAU) : side * 0.9;
    } else if (inFlight) {
      // A gull gliding every so often, flapping between.
      const gliding = Math.sin(t * 0.5) > 0.4;
      y = 0;
      z = side * (gliding ? 0.15 : 0.55 * Math.sin(t * FLAP_HZ * TAU));
    } else if (a === 'fly') {
      // A hen told to fly: wings out and beating hard, going nowhere much.
      y = side * FOLD * 0.3;
      z = side * 0.8 * Math.abs(Math.sin(t * 12));
    } else if (a === 'dust') {
      // Half spread and shuffling, throwing the dust up.
      y = side * FOLD * 0.6;
      z = side * (0.25 + 0.2 * Math.abs(Math.sin(t * 13)));
    } else if (a === 'feed' && !K.swims) z = side * 0.08 * Math.max(0, Math.sin(t * 5));
    else if (a === 'chirp' || a === 'steal') z = side * 0.18 * Math.abs(Math.sin(t * 6));
    else if (a === 'point' && i === 0) z = side * 0.3;
    pose.wingY[i] = y;
    pose.wingZ[i] = z;
  }

  // ---- the whole body ---------------------------------------------------------------------
  let bodyY = -M.drop * pose.low, bodyX = 0, bodyZ = 0, surge = 0;
  if (K.swims) bodyY += Math.sin(t * 2.1) * 0.004;
  else if (striding) bodyY += Math.abs(Math.sin(pose.gait)) * 0.006;
  if (hopping) bodyY += (HOP_HIGH[kind] || 0.06) * air;
  if (a === 'rest') bodyY += 0.002 * Math.sin(t * 1.6);               // breathing
  if (a === 'chirp') bodyY += 0.002 * Math.abs(Math.sin(t * 10));    // the chest puffing
  if (a === 'fly' && !inFlight && !sparrow) bodyY += 0.02 + 0.01 * Math.sin(t * 12);
  switch (a) {
    case 'scratch': bodyX = two ? 0.15 : 0.05; break;
    case 'dust': bodyZ = (four ? 0.25 : 0.12) * Math.sin(t * (four ? 2 : 6)); break;
    case 'nudge': surge = 0.06 * M.len * (0.5 + 0.5 * Math.sin(t * 4)); bodyX = 0.05; break;
    case 'butt': {
      const j = jab(cyc(since, 1.1), 0.12, 0.35);
      surge = 0.18 * M.len * j;
      bodyX = 0.1 * j;
      break;
    }
    case 'point': bodyX = -0.05; break;
    case 'watch': bodyX = -0.03; break;
    default: break;
  }
  // Banked into a turn on the wing: set outright by a caller that knows (the gull's circle),
  // else from how fast the heading is changing.
  if (bank != null) bodyZ = bank;
  else if (inFlight || pose.flying) bodyZ = clamp(-turn * 0.3, -0.5, 0.5);
  pose.bodyY = bodyY;
  pose.bodyX = damp(pose.bodyX, bodyX, 10, step);
  pose.bodyZ = bank != null ? bodyZ : damp(pose.bodyZ, bodyZ, 8, step);
  // A butt is a jab, and a jab damped is a shove; everything else eases in and out.
  pose.surge = a === 'butt' ? surge : damp(pose.surge, surge, 10, step);
  return pose;
}

// The rotation of one part, as an Euler: `role` and `index` as animalParts gives them. Written
// into `e` and returned, so a pivot can be handed its own `rotation` and a batch a scratch one.
export function jointEuler(pose, role, index, e) {
  switch (role) {
    case 'head': return e.set(pose.headX, pose.headY, 0, 'XYZ');
    case 'tail': return e.set(pose.tailX, 0, pose.tailZ, 'XYZ');
    case 'leg': return e.set(pose.legs[index] || 0, 0, 0, 'XYZ');
    case 'wing': return e.set(0, pose.wingY[index] || 0, pose.wingZ[index] || 0, 'YZX');
    default: return e.set(0, 0, 0, 'XYZ');
  }
}

// ---- the brain: an animal nobody walks ------------------------------------------------------
// Every part of an asset on its own pivot in `group`, in animalParts order.
function hangAsset(asset, material, group, geometries) {
  const out = [];
  for (const p of animalParts(asset)) {
    const geometry = partGeometry(p.name);
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(...p.at);
    pivot.add(m);
    group.add(pivot);
    out.push({ ...p, pivot });
  }
  return out;
}
// The pose onto the pivots, and the lean and lunge onto the whole animal at (x, y, z).
function applyPose(a, x, y, z) {
  const p = a.pose;
  a.object.position.set(x + Math.sin(a.yaw) * p.surge, y + p.bodyY, z + Math.cos(a.yaw) * p.surge);
  a.object.rotation.set(p.bodyX, a.yaw, p.bodyZ);
  for (const j of a.joints) jointEuler(p, j.role, j.index, j.pivot.rotation);
}

// The brain on its own: the state machine, the seeded rng and the pose, and no Object3D at
// all. `x`, `y`, `z` and `yaw` are where it is, in the frame its `area` is in, once
// stepBrain has run; `pose` is what its joints are doing. createAnimal hangs pivots on one
// of these; web/js/herds.js draws a whole island's worth of them through one instanced
// batch, which is why the two are apart - forty sheep as forty Groups of pivots would be
// forty sets of part geometries nobody draws. Not the sparrow, whose two models take turns
// and whose hops are its own (createSparrow below). The rng draws are taken in exactly the
// order createAnimal always took them - `left`, `circle`, the first target, the yaw - so an
// animal made either way walks the same field.
export function createBrain(kind, { area = { x: 0, z: 0, r: 1 }, seed = kind, ground = () => 0, yaw = 0 } = {}) {
  const K = KINDS[kind];
  if (!K || kind === 'sparrow') return null;
  const rng = makeRng(`fauna:${seed}`);
  const a = {
    kind, K, area, ground, rng, x: 0, y: 0, z: 0, yaw,
    mood: 'still', left: rng.range(...K.still), to: null, time: 0,
    pose: createPose(kind), flying: !!K.flies, circle: rng.range(0, TAU),
  };
  ({ x: a.x, z: a.z } = pickTarget(a));
  a.yaw = rng.range(-Math.PI, Math.PI);
  return a;
}

export function createAnimal(kind, material, { area = { x: 0, z: 0, r: 1 }, seed = kind, ground = () => 0, yaw = 0 } = {}) {
  if (kind === 'sparrow') return createSparrow(material, { area, seed, ground, yaw });
  const asset = `fauna_${kind}`;
  const K = KINDS[kind];
  if (!K || !models.hasAsset(asset)) return null;
  const object = new THREE.Group();
  object.rotation.order = 'YXZ';
  const geometries = [];
  const joints = hangAsset(asset, material, object, geometries);
  const find = (role, index = 0) => (joints.find((j) => j.role === role && j.index === index) || {}).pivot || null;
  const body = find('body');
  const head = find('head');
  const tail = find('tail');
  const legs = (LEG_NAMES[K.legs] || []).map((_, i) => find('leg', i));
  const wings = [find('wing', 0), find('wing', 1)].filter(Boolean);

  const a = Object.assign(createBrain(kind, { area, seed, ground, yaw }), { object, body, head, tail, legs, wings, joints, geometries });
  a.update = (dt) => updateAnimal(a, dt);
  a.dispose = () => { object.parent?.remove(object); for (const g of geometries) g.dispose(); };
  updateAnimal(a, 0);
  return a;
}

function turnTowards(from, to, rate) {
  let d = to - from;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return from + Math.max(-rate, Math.min(rate, d));
}

// Somewhere inside the patch.
function pickTarget(a) {
  const { rng, area } = a;
  if (area.x0 !== undefined) return { x: rng.range(area.x0, area.x1), z: rng.range(area.z0, area.z1) };
  const t = rng.range(0, TAU), r = Math.sqrt(rng.next()) * area.r;
  return { x: area.x + Math.cos(t) * r, z: area.z + Math.sin(t) * r };
}
// The middle of a patch and how far round it a gull may circle, whichever shape it is.
export function middleOf(area) {
  if (area.x0 === undefined) return area;
  return { x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2, r: Math.min(area.x1 - area.x0, area.z1 - area.z0) / 2 };
}

export function updateAnimal(a, dt) {
  stepBrain(a, dt);
  applyPose(a, a.x, a.y, a.z);
}

// One step of the brain: the mood, the walk and the pose, and where that leaves it in
// `a.x`, `a.y`, `a.z`, `a.yaw`. Nothing drawn - updateAnimal puts it on the pivots,
// web/js/herds.js into its instances.
export function stepBrain(a, dt) {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  a.time += step;
  const K = a.K;

  if (a.flying) return fly(a, step);

  // ---- the mood ---------------------------------------------------------------------------
  a.left -= step;
  if (a.left <= 0) {
    const roll = a.rng.next();
    if (a.mood !== 'walk' && roll < 0.45) { a.mood = 'walk'; a.to = pickTarget(a); a.left = 30; }
    else if (roll < 0.8) { a.mood = 'feed'; a.left = a.rng.range(...K.feed); }
    else { a.mood = 'still'; a.left = a.rng.range(...K.still); }
  }
  let moving = false;
  if (a.mood === 'walk' && a.to) {
    const dx = a.to.x - a.x, dz = a.to.z - a.z, d = Math.hypot(dx, dz);
    if (d < 0.02) { a.mood = 'still'; a.left = a.rng.range(...K.still); a.to = null; }
    else {
      const want = Math.atan2(dx, dz);
      a.yaw = turnTowards(a.yaw, want, 2.2 * step);
      // Walks once it roughly faces the way, so it turns on the spot rather than skating.
      const facing = Math.cos(want - a.yaw);
      if (facing > 0.7) {
        const v = Math.min(d, K.walk * step);
        a.x += Math.sin(a.yaw) * v;
        a.z += Math.cos(a.yaw) * v;
        moving = true;
      }
    }
  }

  // ---- the pose: the same one the sea's animals are drawn in ------------------------------
  // A walk still turning on the spot is standing, which is what stepPose makes of it anyway.
  stepPose(a.kind, a.pose, { act: a.mood, moving, speed: moving ? K.walk : 0 }, step);
  a.y = a.ground(a.x, a.z);
}

// A gull: circles above its patch on flapping wings, gliding every so often.
function fly(a, step) {
  const t = a.time;
  const m = middleOf(a.area), r = Math.max(0.6, m.r);
  a.circle += (a.K.walk / r) * step;
  a.x = m.x + Math.cos(a.circle) * r;
  a.z = m.z + Math.sin(a.circle) * r;
  // Flying anticlockwise seen from above, the heading is the tangent.
  a.yaw = Math.atan2(-Math.sin(a.circle), Math.cos(a.circle));
  // Banked by the same -0.3 it always has been, rather than by what the circle's turn would
  // work out to: this is the gull the model sheet has always shown.
  stepPose(a.kind, a.pose, { act: 'fly', moving: true, speed: a.K.walk, bank: -0.3 }, step);
  a.y = a.ground(a.x, a.z) + FLIGHT_Y + 0.15 * Math.sin(t * 0.6);
}

// ---- the sparrow ----------------------------------------------------------------------------
// Two models, swapped: on the ground the sitting one hops about and pecks; every few seconds it
// flies up in an arc on flapping wings to somewhere else in its patch and comes down there. The
// hops and the arcs are the brain's - they carry it somewhere - and the pecking, the looking
// about and the flapping are the pose's.
const HOP = { s: 0.2, far: [0.02, 0.05], high: 0.018 };
const FLIGHT = { speed: 0.9, rise: 0.22 };

function createSparrow(material, { area, seed, ground, yaw }) {
  const sits = models.hasAsset(SPARROW_SITTING), flies = models.hasAsset(SPARROW_FLYING);
  if (!sits && !flies) return null;
  const object = new THREE.Group();
  object.rotation.order = 'YXZ';
  const geometries = [];
  const sitting = new THREE.Group(), flying = new THREE.Group();
  object.add(sitting, flying);
  const sp = sits ? hangAsset(SPARROW_SITTING, material, sitting, geometries) : [];
  const fp = flies ? hangAsset(SPARROW_FLYING, material, flying, geometries) : [];
  const rng = makeRng(`fauna:${seed}`);
  const a = {
    kind: 'sparrow', K: KINDS.sparrow, object, area, ground, rng, geometries, time: 0,
    x: 0, z: 0, yaw, mode: 'ground', next: rng.range(0.3, 1), grounded: rng.range(...KINDS.sparrow.still),
    hop: null, peck: 0, flight: null, pose: createPose('sparrow'), joints: [...sp, ...fp],
    head: (sp.find((j) => j.role === 'head') || {}).pivot || null,
    wings: fp.filter((j) => j.role === 'wing').map((j) => j.pivot),
  };
  ({ x: a.x, z: a.z } = pickTarget(a));
  a.update = (dt) => updateSparrow(a, dt);
  a.dispose = () => { object.parent?.remove(object); for (const g of geometries) g.dispose(); };
  updateSparrow(a, 0);
  return a;
}

function updateSparrow(a, dt) {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  a.time += step;
  const rng = a.rng;
  let lift = 0;
  // Without the sitting model it stays up, from one perch in the air to the next (showsAsset).
  if (a.mode === 'ground' && !a.head) a.grounded = 0;
  if (a.mode === 'ground') {
    a.grounded -= step;
    a.next -= step;
    if (a.grounded <= 0) {
      const to = pickTarget(a);
      const d = Math.hypot(to.x - a.x, to.z - a.z);
      a.flight = { from: { x: a.x, z: a.z }, to, t: 0, dur: Math.max(0.6, d / FLIGHT.speed + 0.3) };
      a.mode = 'flight';
    } else if (a.hop) {
      a.hop.t += step;
      const k = Math.min(1, a.hop.t / HOP.s);
      a.x = a.hop.x + Math.sin(a.yaw) * a.hop.far * k;
      a.z = a.hop.z + Math.cos(a.yaw) * a.hop.far * k;
      lift = HOP.high * Math.sin(Math.PI * k);
      if (k >= 1) a.hop = null;
    } else if (a.next <= 0) {
      const roll = rng.next();
      if (roll < 0.45) {
        // A hop the way it faces, turned back towards the middle if that would leave the patch.
        const far = rng.range(...HOP.far);
        const nx = a.x + Math.sin(a.yaw) * far, nz = a.z + Math.cos(a.yaw) * far;
        const t = pickTarget(a);
        if (!inside(a.area, nx, nz)) a.yaw = Math.atan2(t.x - a.x, t.z - a.z);
        else a.hop = { t: 0, x: a.x, z: a.z, far };
      } else if (roll < 0.8) a.peck = rng.range(...KINDS.sparrow.feed);
      else a.yaw += rng.range(-1.2, 1.2);
      a.next = rng.range(0.25, 0.9);
    }
    a.peck = Math.max(0, a.peck - step);
  } else {
    const f = a.flight;
    f.t += step;
    const k = Math.min(1, f.t / f.dur);
    a.x = f.from.x + (f.to.x - f.from.x) * k;
    a.z = f.from.z + (f.to.z - f.from.z) * k;
    a.yaw = Math.atan2(f.to.x - f.from.x, f.to.z - f.from.z);
    lift = FLIGHT.rise * Math.sin(Math.PI * k) + (a.head ? 0 : FLIGHT.rise * 0.6);
    if (k >= 1) { a.mode = 'ground'; a.grounded = rng.range(...KINDS.sparrow.still); a.flight = null; a.next = 0.5; }
  }
  // Its own hop is the brain's (it goes somewhere), so the pose is told 'still' through it
  // rather than 'hop', which would hop a second time on top.
  const act = a.mode === 'flight' ? 'fly' : a.peck > 0 ? 'peck' : 'still';
  stepPose('sparrow', a.pose, { act, moving: a.mode === 'flight', speed: a.mode === 'flight' ? FLIGHT.speed : 0, bank: 0 }, step);
  const onWing = showsAsset('sparrow', a.pose, SPARROW_FLYING);
  a.object.children[0].visible = !onWing;
  a.object.children[1].visible = onWing;
  applyPose(a, a.x, a.ground(a.x, a.z) + lift, a.z);
}

function inside(area, x, z) {
  if (area.x0 !== undefined) return x >= area.x0 && x <= area.x1 && z >= area.z0 && z <= area.z1;
  return Math.hypot(x - area.x, z - area.z) <= area.r;
}
