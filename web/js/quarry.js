// The quarry at work (Plans/DONE/ambachten.md): the treadwheel crane lifts a cut block off the lowest
// bench, slews round and lets it down onto the tub, the tub runs it down the rail to the stack by
// the lane and comes back empty, and the jib swings back for the next. The treadwheel turns
// forward to lift and back to lower, by exactly as much rope as it winds.
//
// The parts are baked inside the yard asset with their origins on their own axes
// (scripts/build-workshops.py), so every pivot below is a part's `at` and every distance - the
// drum's radius, the jib's reach and how far it slews, how high the pick and the drop are, how
// far the tub runs - is read off the bake rather than written down again. buildings.js leaves
// them out of the merged building (`isQuarryMoving`); this file is the only thing that draws them.
//
// Shaped like sawmill.js: `attachQuarry` builds, `updateQuarry` moves, `disposeQuarry` lets go.
// Where everything is is one function of the quarry's own clock (`craneAt`), so two runs of the
// same frames are the same quarry, and tests/workshops.test.mjs can ask it where the block is.
import * as THREE from 'three';
import { mesh, mergeParts } from './buildings.js';
import * as models from './models.js';

const YARD = 'civic_quarry_yard';
export const PART = {
  wheel: `${YARD} wheel`,
  jib: `${YARD} jib`,
  rope: `${YARD} rope`,
  hook: `${YARD} hook`,
  block: `${YARD} block`,
  tub: `${YARD} tub`,
  rail: `${YARD} rail`,
};

// How far the crane lifts a block off the bench before it slews: enough to clear the bench's
// own edge on the way round, not so much that the rope is gone into the drum.
export const LIFT = 0.3;
// The tub stops this short of the rail's end rather than hanging its front wheels off it.
const BUFFER = 0.04;

// One round of the work, in seconds of the quarry's clock. The crane: the next block is set
// ready under the hook, lifted, slewed round to the tub, let down onto it; the empty hook goes
// up, round and down again. The tub: waits for its block, runs it out, tips it onto the stack,
// runs back. Slow on purpose - a treadwheel is walked, and the island is looked at from afar.
export const CYCLE = 16;
const T = {
  ready: 0.6,          // 0 -> ready: the block grows onto the bench under the hook
  lifted: 3.4,         // -> lifted
  slewed: 5.6,         // -> round over the tub
  down: 8.2,           // -> set down on the tub, and let go
  up: 9.6,             // -> the empty hook back up
  back: 11.8,          // -> slewed back over the bench
  lowered: 14.6,       // -> down at the bench again, then a breath
  tubGoes: 8.9,        // the tub waits a moment with its block, then runs out
  tubThere: 12.3,
  tipped: 12.8,        // the block shrinks onto the stack
  tubBack: 15.6,
};

const ease = (u) => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };
const span = (t, a, b) => ease((t - a) / (b - a));

// Every baked slot of one part: a part with two colours bakes as `name:0` and `name:1`.
function slotsOf(name) {
  return models.assetParts(YARD).filter((n) => n === name || n.startsWith(name + ':'));
}
const atOf = (name) => models.part(slotsOf(name)[0]).at;

// mergeParts, not mergeGeometries, as butcher.js found: the treadwheel is planks and end grain,
// and only the planks carry a sheet, which mergeGeometries refuses to weld.
function geometryOf(name) {
  const names = slotsOf(name);
  return names.length === 1 ? mesh(names[0]) : mergeParts(names.map((n) => mesh(n)));
}

// The furthest a part's vertices reach by `f(x, y, z)`, around its own origin.
function extent(name, f) {
  let far = -Infinity;
  for (const n of slotsOf(name)) {
    const p = models.part(n).positions;
    for (let i = 0; i < p.length; i += 3) far = Math.max(far, f(p[i], p[i + 1], p[i + 2]));
  }
  return far;
}

// The quarry's own measurements, in the yard's frame, all off the bake.
function measure() {
  const wheel = atOf(PART.wheel), jib = atOf(PART.jib), tip = atOf(PART.rope);
  const hook = atOf(PART.hook), block = atOf(PART.block), tub = atOf(PART.tub);
  // The drum is the one thing on the wheel that reaches past its rims along the axle, so the
  // rope's radius is how far out from the axle the ends of the wheel reach.
  const ends = extent(PART.wheel, (x) => Math.abs(x));
  const drumR = extent(PART.wheel, (x, y, z) => (Math.abs(x) >= ends - 1e-4 ? Math.hypot(y, z) : -Infinity));
  const blockH = extent(PART.block, (x, y) => y);
  const hookH = hook[1] - (block[1] + blockH);
  const tubTop = tub[1] + extent(PART.tub, (x, y) => y);
  const tubHalf = extent(PART.tub, (x, y, z) => Math.abs(z));
  const railEnd = extent(PART.rail, (x, y, z) => z);
  // The jib is baked over the pick; it slews until its tip is over the tub's back end.
  const toPick = Math.atan2(tip[0] - jib[0], tip[2] - jib[2]);
  const toTub = Math.atan2(tub[0] - jib[0], tub[2] - jib[2]);
  let slewTo = toTub - toPick;
  while (slewTo > Math.PI) slewTo -= 2 * Math.PI;
  while (slewTo < -Math.PI) slewTo += 2 * Math.PI;
  const pick = tip[1] - hook[1];
  return {
    wheel, jib, tip, hook, block, tub, drumR, blockH, hookH, tubTop,
    reach: Math.hypot(tip[0] - jib[0], tip[2] - jib[2]),
    tubReach: Math.hypot(tub[0] - jib[0], tub[2] - jib[2]),
    slewTo,
    travel: railEnd - tubHalf - BUFFER - tub[2],
    rope: { pick, up: pick - LIFT, drop: tip[1] - (tubTop + blockH + hookH) },
  };
}

export function quarryGeometry() {
  return models.hasAsset(YARD) ? measure() : null;
}

// The whole quarry at time t: how far round the jib is (0 over the bench, 1 over the tub), how
// much rope is out, how much of a block hangs on the hook and how much sits on the tub (a block
// grows in and shrinks out rather than appearing), and how far along the rail the tub is.
export function craneAt(t, G) {
  const c = ((t % CYCLE) + CYCLE) % CYCLE;
  const { pick, up, drop } = G.rope;
  let slew = 0, rope = pick, carried = 0;
  if (c < T.ready) carried = span(c, 0, T.ready);
  else if (c < T.lifted) { carried = 1; rope = pick + (up - pick) * span(c, T.ready, T.lifted); }
  else if (c < T.slewed) { carried = 1; rope = up; slew = span(c, T.lifted, T.slewed); }
  else if (c < T.down) { carried = 1; slew = 1; rope = up + (drop - up) * span(c, T.slewed, T.down); }
  else if (c < T.up) { slew = 1; rope = drop + (up - drop) * span(c, T.down, T.up); }
  else if (c < T.back) { rope = up; slew = 1 - span(c, T.up, T.back); }
  else if (c < T.lowered) rope = up + (pick - up) * span(c, T.back, T.lowered);
  let run = 0, load = 0;
  if (c >= T.down && c < T.tubGoes) load = 1;
  else if (c >= T.tubGoes && c < T.tubThere) { load = 1; run = span(c, T.tubGoes, T.tubThere); }
  else if (c >= T.tubThere && c < T.tipped) { run = 1; load = 1 - span(c, T.tubThere, T.tipped); }
  else if (c >= T.tipped && c < T.tubBack) run = 1 - span(c, T.tipped, T.tubBack);
  return { slew, rope, carried, run, load };
}

// Where the jib's tip is, slewed `a` about the mast: the rope hangs from here.
export function tipAt(G, a) {
  const dx = G.tip[0] - G.jib[0], dz = G.tip[2] - G.jib[2];
  return [G.jib[0] + dx * Math.cos(a) + dz * Math.sin(a), G.tip[1], G.jib[2] - dx * Math.sin(a) + dz * Math.cos(a)];
}

export function attachQuarry(group, at, material, yaw = 0) {
  const G = quarryGeometry();
  if (!G) return null;
  const root = new THREE.Group();
  root.position.set(...at);
  root.rotation.y = yaw;
  group.add(root);

  const geometries = [];
  const hang = (geometry, where) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    m.position.set(...where);
    root.add(m);
    return m;
  };
  const own = (name) => {
    const g = geometryOf(name);
    geometries.push(g);
    return g;
  };
  const wheel = hang(own(PART.wheel), G.wheel);
  const jib = hang(own(PART.jib), G.jib);
  const rope = hang(own(PART.rope), G.tip);
  const hook = hang(own(PART.hook), G.hook);
  // One block's geometry, twice over: the one on the hook and the one on the tub.
  const blockGeometry = own(PART.block);
  const block = hang(blockGeometry, G.block);
  const load = hang(blockGeometry, G.block);
  const tub = hang(own(PART.tub), G.tub);

  const quarry = { root, G, wheel, jib, rope, hook, block, load, tub, geometries, time: 0 };
  updateQuarry(quarry, 0);
  return quarry;
}

export function updateQuarry(quarry, dt) {
  if (!quarry) return;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  quarry.time += step;
  const G = quarry.G;
  const s = craneAt(quarry.time, G);

  // The jib, and what hangs from its tip: the hook and its block keep their own heading while the
  // jib turns over them, as a load on a rope does.
  const a = G.slewTo * s.slew;
  quarry.jib.rotation.y = a;
  const [tx, ty, tz] = tipAt(G, a);
  quarry.rope.position.set(tx, ty, tz);
  quarry.rope.scale.y = s.rope / G.rope.pick;
  quarry.hook.position.set(tx, ty - s.rope, tz);
  quarry.block.position.set(tx, ty - s.rope - G.hookH - G.blockH, tz);
  quarry.block.scale.setScalar(Math.max(s.carried, 1e-4));
  quarry.block.visible = s.carried > 0;
  // The treadwheel winds the rope on its drum: turned forward by what the rope is shorter.
  quarry.wheel.rotation.x = (G.rope.pick - s.rope) / G.drumR;

  // The tub on its rail, and the block it carries.
  const z = G.tub[2] + G.travel * s.run;
  quarry.tub.position.set(G.tub[0], G.tub[1], z);
  quarry.load.position.set(G.tub[0], G.tubTop, z);
  quarry.load.scale.setScalar(Math.max(s.load, 1e-4));
  quarry.load.visible = s.load > 0;
}

export function disposeQuarry(quarry) {
  if (!quarry) return;
  quarry.root.parent?.remove(quarry.root);
  for (const g of quarry.geometries) g.dispose();
}
