// The gold in the gold pit, and the bar a settler carries home from it (Plans/goudkuil.md).
//
// The pit itself - a concrete trench silo, open towards the town - is an ordinary civic
// building in buildings.js, one merged geometry like every other. The gold cannot be part of
// that loaf: a merged mesh cannot lose a piece of itself, and this pile has to shrink by one
// bar for every percent of the keeper's five-hour window. So it is hung on the building's
// group as its own InstancedMesh, exactly the way the postbox flag and the clock hands are
// (mailflag.js, clock.js), and how many bars stand is its `count`: one draw call for the
// whole pile however full it is, and nothing to rebuild when a bar goes. The loose coins
// around it are a second batch that shrinks with it, so an empty pit is empty.
//
// Polished bevels come from Blender. The pile has a specular material of its own:
// the sun supplies moving highlights without an environment map or extra draw calls.
import * as THREE from 'three';
import { grouped } from './models.js';
import { GOLD_BARS } from 'shared/gold.mjs';
import { makeRng } from 'shared/rng.mjs';

// One bar, in island units (4 m): oversized on purpose, like every prop on the island, or a
// pile of real ingots would be a yellow smudge from the camera's usual height. Long along x.
export const BAR = { l: 0.26, h: 0.075, w: 0.13, top: 0.78 };
// One coin, as scripts/build-goldpit.py makes prop_goldcoin: origin under its middle.
export const COIN = { r: 0.036, h: 0.012 };
// How many coins lie about a full pit. They go with the bars, a share at a time.
export const COINS = 72;
const GOLD = 0xf0b92e;
// How much of the night-glow mask a bar takes: enough to catch the eye after dark, far
// below a window's full 1.
const GLINT = 0.22;

function glinting(g, glint) {
  g.clearGroups();
  const n = g.attributes.position.count;
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(n).fill(glint), 1));
  return g;
}

// The carried bar uses the same baked ingot, scaled to fit the settler's hands.
export function goldBarGeometry({ l = BAR.l, h = BAR.h, w = BAR.w, glint = GLINT } = {}) {
  const g = grouped('prop_goldbar', ['plain']);
  g.scale(l / BAR.l, h / BAR.h, w / BAR.w);
  return glinting(g, glint);
}

export function goldCoinGeometry({ glint = GLINT } = {}) {
  return glinting(grouped('prop_goldcoin', ['plain']), glint);
}

// ---- where the gold lies ---------------------------------------------------------------
//
// All of it in the building's own frame, its open end towards +z, and all of it drawn from
// one fixed stream ('goldpit:pile'), so every page lays the same heap bar for bar.
//
// It used to be a ruled stepped pyramid, 5x8 + 4x7 + 3x6 + 2x5 + 1x4 on an exact grid with a
// few hundredths of a radian of slew, and it read as a yellow block with lines on it rather
// than as something people had stacked. Tiemen asked for it by hand and less tidy. So the same
// five courses are the skeleton still - that is what keeps every bar resting on bars and the
// count at exactly one per percent - but each course is laid a little off the one below, each
// bar is pushed and turned by hand, the upper ones rock on the uneven course under them, and
// some corners were never stacked at all: those bars lie about on the floor.

// The skeleton: courses of nx by nz from the floor up, 100 between them.
const COURSES = [[5, 8], [4, 7], [3, 6], [2, 5], [1, 4]];
// At most this many never go on the heap. More than about ten and the floor beside it runs
// out of room: the fifteenth throw landed on top of the heap, which is no place for a bar
// that was never stacked.
const MAX_LOOSE = 9;
// A course's grid. Wider than a bar by more than the old grid was, so a hand's worth of push
// and turn has room before it runs into the next bar.
export const PILE_PITCH = { x: 0.30, z: 0.16 };
export const PILE_Z = -0.55;        // the middle of the heap, behind the middle of the plot

// What is already standing in the pit, as scripts/build-goldpit.py builds it: the inner
// faces of the walls, the keeper's office on the left of the apron (footing and the counter
// under its hatch), and the aisle a loader parks the barrow in (lib/crowd.mjs GOLD_LOAD_IN),
// which is left clear of loose bars. Coins may lie in it: that is where they get dropped.
export const SILO = { side: 1.11, back: -1.22, front: 1.3 };
export const OFFICE = { x0: -1.13, x1: -0.44, z0: 0.26, z1: 1.14 };
// The counter's top is at 0.42 in build-goldpit.py; everything here is measured from the
// heap's floor, which buildings.js publishes at 0.031 (animated.goldpile).
export const COUNTER = { x: -0.37, y: 0.42 - 0.031, z: 0.57 };
const AISLE = { x: 0.24, z: 0.05 };
// And no bar lies further forward than this, so a loader (at GOLD_LOAD_IN, 0.6) and the
// barrow they bend over stand in front of all of it, not among it.
export const LOOSE_FRONT = 0.38;

// A bar's footprint, its four corners on the floor, for a slot [x, y, z, yaw, ...].
// three.js's rotation about +y: x' = x cos + z sin, z' = -x sin + z cos.
export function barCorners([x, , z, yaw]) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => {
    const px = a * BAR.l / 2, pz = b * BAR.w / 2;
    return [x + px * c + pz * s, z - px * s + pz * c];
  });
}

// Whether two convex outlines come within `gap` of each other (separating axes).
export function outlinesMeet(a, b, gap = 0) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
      const nx = z1 - z0, nz = x0 - x1;
      const len = Math.hypot(nx, nz) || 1;
      const span = (p) => {
        let lo = Infinity, hi = -Infinity;
        for (const [x, z] of p) { const d = (x * nx + z * nz) / len; lo = Math.min(lo, d); hi = Math.max(hi, d); }
        return [lo, hi];
      };
      const [alo, ahi] = span(a), [blo, bhi] = span(b);
      if (ahi + gap < blo || bhi + gap < alo) return false;
    }
  }
  return true;
}

const inside = (x, z, m = 0) => Math.abs(x) < SILO.side - m && z > SILO.back + m && z < SILO.front - m;
const inOffice = (x, z, m = 0) => x > OFFICE.x0 - m && x < OFFICE.x1 + m && z > OFFICE.z0 - m && z < OFFICE.z1 + m;
const inAisle = (x, z) => Math.abs(x) < AISLE.x && z > AISLE.z;

// Where each of the GOLD_BARS bars lies, as [x, y, z, yaw, roll, pitch]: the middle of its
// base, a turn about the vertical, and a rock about its own long axis (roll) and across it
// (pitch). Numbered so that the first `n` are the pile with `100 - n` taken off it: the floor
// course back to front, then the loose bars, then each course above; the top goes first, a
// course half gone keeps its back rows - the side nobody is reaching from - and the bars
// lying about go before anybody starts on the bottom course.
let SLOTS = null;
export function pileSlots() {
  if (SLOTS) return SLOTS.map((s) => s.slice());
  const rng = makeRng('goldpit:pile');
  const courses = [];
  let loose = 0;
  COURSES.forEach(([nx, nz], k) => {
    // Each course laid a little off the middle of the one below, as a stack laid by hand is.
    const ox = k ? rng.range(-0.035, 0.035) : 0;
    const oz = k ? rng.range(-0.025, 0.025) : 0;
    const placed = [];
    const below = k ? courses[k - 1] : null;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        // Some bars were never stacked and lie on the floor instead: a front corner often,
        // now and then one off the side of the front half of a course. The back stays
        // whole, against the wall where a stack is started, and so does the top course -
        // four bars is little enough to read as a heap already.
        const edge = i === 0 || i === nx - 1;
        const pull = loose < MAX_LOOSE && k < 4 && edge && (j === nz - 1 ? rng.chance(0.6) : j >= nz / 2 && rng.chance(0.2));
        if (pull) { loose++; continue; }
        const gx = (i - (nx - 1) / 2) * PILE_PITCH.x + ox;
        const gz = PILE_Z + (j - (nz - 1) / 2) * PILE_PITCH.z + oz;
        const slot = lay(rng, k, gx, gz, placed, below);
        if (slot) placed.push(slot); else loose++;
      }
    }
    courses.push(placed);
  });
  const floor = courses[0];
  const lying = scatter(rng, loose, floor);
  SLOTS = [...floor, ...lying, ...courses.slice(1).flat()];
  return SLOTS.map((s) => s.slice());
}

// Whether a bar would stay where it is put, now that corners of the course below may be
// missing: its middle has to fall within the bars it lies across. Not "on a bar" - a
// course is laid half a pitch off the one under it, so a bar's middle is over the seam
// between four, and asking for a bar right under it turned the whole heap into loose bars.
// Without the rule, the top of a heap whose front corners had gone hung half its length
// over nothing.
export function restsOn(slot, below) {
  const outline = barCorners(slot);
  const under = below.filter((b) => outlinesMeet(barCorners(b), outline)).flatMap(barCorners);
  if (!under.length) return false;
  const [x, , z] = slot;
  const m = 0.01;
  const xs = under.map((p) => p[0]), zs = under.map((p) => p[1]);
  return x > Math.min(...xs) + m && x < Math.max(...xs) - m && z > Math.min(...zs) + m && z < Math.max(...zs) - m;
}

// One bar onto its course: pushed and turned by hand, tried again with a steadier hand if it
// would touch a neighbour or a wall, and square to the grid as the last resort. Null if even
// that does not fit, or there is nothing under it - it goes on the floor with the rest.
//
// How hard the hand pushes is set by the grid: at most this far and this much turn, a bar
// cannot reach into the square spot of the bar beside it, so the last resort always fits
// and the tries before it only decide how untidy. Pushed harder than that (0.16 rad and three
// hundredths were tried), a third of the upper courses found their spot taken and ended up on
// the floor.
const HAND = { yaw: 0.1, x: 0.02, z: 0.01 };
function lay(rng, k, gx, gz, placed, below) {
  for (let t = 0; t <= 6; t++) {
    const hand = t === 6 ? 0 : 1 - t / 6;
    const yaw = rng.range(-HAND.yaw, HAND.yaw) * hand;
    const x = gx + rng.range(-HAND.x, HAND.x) * hand;
    const z = gz + rng.range(-HAND.z, HAND.z) * hand;
    // The floor is flat; everything above rests on bars that are not quite level.
    const roll = k ? rng.range(-0.045, 0.045) * (hand || 0.5) : 0;
    const pitch = k ? rng.range(-0.03, 0.03) * (hand || 0.5) : 0;
    // Lifted by half of how far the low corner would drop: it sinks a hair into the bar
    // under it (the same gold, nothing shows) instead of floating off the high side.
    const lift = (BAR.w / 2 * Math.abs(Math.sin(roll)) + BAR.l / 2 * Math.abs(Math.sin(pitch))) / 2;
    const slot = [x, k * BAR.h + lift, z, yaw, roll, pitch];
    const outline = barCorners(slot);
    if (!outline.every(([cx, cz]) => inside(cx, cz))) continue;
    if (placed.some((p) => outlinesMeet(barCorners(p), outline, 0.004))) continue;
    if (below && !restsOn(slot, below)) continue;
    return slot;
  }
  return null;
}

// The bars that never went on the heap, on the floor beside it: along the sides, turned
// roughly lengthways as if set down there to be stacked later, or dropped at any angle in
// front of it - never in the office and never where the barrow parks.
function scatter(rng, count, floor) {
  const out = [];
  const taken = () => [...floor, ...out].map(barCorners);
  for (let n = 0; n < count; n++) {
    let slot = null;
    for (let t = 0; t < 200 && !slot; t++) {
      const where = rng.next();
      let cand;
      if (where < 0.55) {
        const side = rng.chance(0.5) ? 1 : -1;
        cand = [side * rng.range(0.84, 1.03), 0, rng.range(-1.12, 0.1), Math.PI / 2 + rng.range(-0.4, 0.4), 0, 0];
      } else {
        cand = [rng.range(-0.8, 0.95), 0, rng.range(0.08, 0.26), rng.range(0, Math.PI), 0, 0];
      }
      const outline = barCorners(cand);
      if (!outline.every(([x, z]) => inside(x, z) && !inOffice(x, z) && !inAisle(x, z) && z < LOOSE_FRONT)) continue;
      if (taken().some((p) => outlinesMeet(p, outline, 0.01))) continue;
      slot = cand;
    }
    // Two hundred throws have always been plenty; should a change ever make them not be,
    // the bar goes on top of the heap rather than a percent going missing.
    out.push(slot || [0, COURSES.length * BAR.h, PILE_Z, rng.range(-0.3, 0.3), 0, 0]);
  }
  return out;
}

// Where each of the COINS coins lies, as [x, y, z, yaw, tilt]: the middle of its underside,
// which way it faces and how far it rocks. Mostly strewn at the foot of the heap and thinning
// out away from it, a few in the aisle where the loading goes on, some fallen half onto
// another, a handful of little stacks by the heap - and one on the cashier's counter under
// the office hatch, which is the last coin to go. Ordered nearest the heap first, a stack
// bottom first, so the ones that go first are the strays furthest out and the tops of stacks;
// none lies on a bar, because a bar can go and a coin on it would be left in the air.
let COIN_SLOTS = null;
export function coinSlots() {
  if (COIN_SLOTS) return COIN_SLOTS.map((s) => s.slice());
  const rng = makeRng('goldpit:coins');
  const bars = pileSlots().filter((s) => s[1] < BAR.h / 2).map(barCorners);
  const clearOfBars = (x, z, m) => {
    const disc = [[x - m, z - m], [x + m, z - m], [x + m, z + m], [x - m, z + m]];
    return !bars.some((b) => outlinesMeet(b, disc, 0.003));
  };
  // How far a point is from the heap's floor, roughly - the course-0 bars' box.
  const heap = bars.flat();
  const hx0 = Math.min(...heap.map((p) => p[0])), hx1 = Math.max(...heap.map((p) => p[0]));
  const hz0 = Math.min(...heap.map((p) => p[1])), hz1 = Math.max(...heap.map((p) => p[1]));
  const away = (x, z) => Math.hypot(Math.max(hx0 - x, 0, x - hx1), Math.max(hz0 - z, 0, z - hz1));
  const coins = [];     // { x, z, y, yaw, tilt, key, level }
  const onFloor = [];
  const fits = (x, z) => inside(x, z, COIN.r) && !inOffice(x, z, COIN.r) && clearOfBars(x, z, COIN.r);
  const free = (x, z) => onFloor.every((c) => Math.hypot(c.x - x, c.z - z) > 2 * COIN.r + 0.004);

  // The counter first, so it is the last to go.
  for (let level = 0; level < 3; level++) {
    coins.push({ x: COUNTER.x + rng.range(-0.004, 0.004), y: COUNTER.y + level * COIN.h, z: COUNTER.z + rng.range(-0.004, 0.004), yaw: rng.range(0, 1.3), tilt: 0, key: -1, level });
  }
  // Little stacks where somebody counted them out, hard by the heap.
  for (let s = 0, t = 0; s < 5 && t < 400; t++) {
    const x = rng.range(-0.95, 1.0), z = rng.range(-1.15, 0.3);
    const d = away(x, z);
    if (d < 0.03 || d > 0.14 || !fits(x, z) || !free(x, z)) continue;
    const high = 2 + rng.int(4);
    for (let level = 0; level < high; level++) {
      coins.push({ x: x + rng.range(-0.005, 0.005), y: level * COIN.h, z: z + rng.range(-0.005, 0.005), yaw: rng.range(0, 1.3), tilt: level === high - 1 ? rng.range(0, 0.06) : 0, key: d, level });
    }
    onFloor.push({ x, z });
    s++;
  }
  // The strays, thinning out with distance: a throw is kept with a chance that falls away
  // from one at the heap's foot to nothing half a metre out (island units), and a few more
  // are thrown into the aisle in front of it, spilled from a barrow.
  for (let t = 0; coins.length < COINS && t < 6000; t++) {
    const aisle = rng.chance(0.12);
    const x = aisle ? rng.range(-0.22, 0.22) : rng.range(-1.08, 1.08);
    const z = aisle ? rng.range(0.1, 0.9) : rng.range(-1.19, 0.6);
    const d = away(x, z);
    if (!aisle && !rng.chance(Math.max(0, 1 - d / 0.45) ** 2)) continue;
    if (!fits(x, z)) continue;
    const yaw = rng.range(0, 1.3);
    if (free(x, z)) {
      coins.push({ x, y: 0, z, yaw, tilt: rng.chance(0.2) ? rng.range(0, 0.03) : 0, key: d, level: 0 });
      onFloor.push({ x, z });
      continue;
    }
    // Landing on exactly one coin already down is falling half onto it: it rests on that
    // one's top and droops towards the floor. Anything more crowded is thrown again.
    const under = onFloor.filter((c) => Math.hypot(c.x - x, c.z - z) <= 2 * COIN.r + 0.004);
    const below = under.length === 1 && coins.find((c) => c.x === under[0].x && c.z === under[0].z && c.level === 0);
    const gap = below ? Math.hypot(below.x - x, below.z - z) : 0;
    if (!below || gap < COIN.r * 0.6 || !rng.chance(0.5)) continue;
    // Faced away from the one under it, so its far edge is the one that droops.
    const face = Math.atan2(x - below.x, z - below.z);
    coins.push({ x, y: COIN.h, z, yaw: face, tilt: rng.range(0.05, 0.11), key: below.key, level: 1 });
    onFloor.push({ x, z, over: true });
  }
  coins.sort((a, b) => (a.key - b.key) || (a.level - b.level));
  COIN_SLOTS = coins.map((c) => [c.x, c.y, c.z, c.yaw, c.tilt]);
  return COIN_SLOTS.map((s) => s.slice());
}

// How many coins lie about when `bars` bars are left: the same share of COINS, so the coins
// thin out as the heap goes down and the last bar takes the last coin with it.
export const coinsFor = (bars) => Math.round(COINS * Math.max(0, Math.min(GOLD_BARS, bars)) / GOLD_BARS);

// Three batches of gold, a shade apart, so the heap reads as a heap of bars rather than as
// one yellow block with lines ruled on it. Picked per slot by arithmetic, not at random:
// every page draws the same pile.
const BATCHES = [1, 0.9, 1.08];

// Hang the pile on a building's group. `at` is where the heap's floor is in that group's
// frame (buildings.js publishes it as `animated.goldpile`). Returns the handle main.js
// keeps: `setBars(n)` shows the first n, clamped to the pile, and the coins that go with
// them.
export function attachGoldPile(group, at) {
  const material = new THREE.MeshPhongMaterial({
    vertexColors: true, specular: 0xffe8a6, shininess: 85,
    emissive: 0x6b4309, emissiveIntensity: 0.12,
  });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const tint = new THREE.Color();
  const batch = (geo, slots, { shadow }) => {
    const mesh = new THREE.InstancedMesh(geo, material, slots.length);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    slots.forEach(([x, y, z, yaw, roll = 0, pitch = 0], i) => {
      e.set(roll, yaw, pitch);
      mesh.setMatrixAt(i, m.compose(p.set(at[0] + x, at[1] + y, at[2] + z), q.setFromEuler(e), one));
      mesh.setColorAt(i, tint.setScalar(BATCHES[(i * 7) % BATCHES.length]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    return mesh;
  };
  const barGeo = goldBarGeometry();
  const coinGeo = goldCoinGeometry();
  const mesh = batch(barGeo, pileSlots(), { shadow: true });
  // A coin's shadow is a hair's breadth wide at this scale; not worth a second shadow draw.
  const coinPlaces = coinSlots();
  const coinMax = coinPlaces.length;
  const coins = batch(coinGeo, coinPlaces, { shadow: false });
  const handle = {
    mesh,
    coins,
    bars: GOLD_BARS,
    setBars(n) {
      const bars = Math.max(0, Math.min(GOLD_BARS, Math.round(Number.isFinite(n) ? n : GOLD_BARS)));
      handle.bars = bars;
      mesh.count = bars;
      coins.count = Math.min(coinMax, coinsFor(bars));
      // Nothing left is nothing drawn: an empty pit costs no draw call for its gold.
      mesh.visible = bars > 0;
      coins.visible = coins.count > 0;
    },
    dispose() {
      group.remove(mesh);
      group.remove(coins);
      barGeo.dispose();
      coinGeo.dispose();
      material.dispose();
      mesh.dispose?.();
      coins.dispose?.();
    },
  };
  return handle;
}
