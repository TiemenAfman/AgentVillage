// Object Distance on the CPU: taking a record (a house, a civic building) out of the picture
// once the fog has closed over it, and putting it back. No DOM and no three.js import - it
// works on whatever has `traverse`, `layers`, `children` and `matrixWorld` - so
// tests/record-cull.test.mjs can drive it with plain objects. What it is for, and why the cut
// can never be seen, is Plans/DONE/graphics-afstanden.md; the arithmetic is cullNext in fade.js.
//
// The cut is `layers.mask = 0` on the record's objects, not `rec.group.visible`: that flag is
// state (applyVisibility owns it - filtered, alive in the chronicle, arrived - and popIn and a
// build clear it), and writing it from here would put a filtered-out code house back on the
// island. A mask of 0 matches no camera, no light's shadow pass and no raycaster, and nothing
// else in the project touches layers, so the mask belongs to this file alone. The mask each
// object had is kept in `userData.cut` and put back.
//
// Two kinds of object are not masked, and both were found by review rather than by eye:
//
// - Lights. three builds its light list from what passes the layer test, and the number of
//   lights is part of every lit program's key - so a masked campfire, smithy, oven or
//   lighthouse light recompiled every MeshStandard, Lambert and Phong material on screen
//   each time a record crossed the line (smithy.js already warns that "three recompiles every
//   material when the number of lights changes"). A light out of range is turned down to 0
//   instead, which keeps the count, and turned back up to what it had.
// - Records with a part the fog does not touch (`fog: false`: a lighthouse's beam, a
//   campfire's flame). "Cut in full fog" means nothing for a thing the fog never covers: at
//   night a neighbour's beam is visible through the haze on purpose (beacon.js), and masking
//   it made it vanish at the line and pop back on the way in. Such a record is a landmark and
//   is never cut - there are few of them, and a tent is cheap.
import { cullNext, CULL_PAD, CULL_HYST } from './fade.js';

// Does anything under `g` draw without fog? Asked once per group (the answer is cached on the
// record against the group, since a rebuilt record gets a new one).
export function seenThroughFog(g) {
  let yes = false;
  g.traverse((o) => {
    if (yes || !o.material) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some((m) => m && m.fog === false)) yes = true;
  });
  return yes;
}

// `key` names whose cut this is. A record can be cut (key 'cull') and the whole island it
// stands on cut as well (key 'far', keepRegion below), in either order and undone in either
// order. So each object keeps what it had once, in `userData.cut`, with the list of cuts that
// hold it; it is drawn again only when the last of them lets go. (Two separate saved masks
// were tried first and are wrong: an island cut before its record saved the record's live
// mask, and then the island coming back put a still-cut record back on screen.) An array and
// not a Set, because Object3D.copy clones userData through JSON.
function cut(o, key) {
  let c = o.userData.cut;
  if (!c) c = o.userData.cut = { keys: [], mask: o.layers.mask, intensity: o.intensity };
  if (!c.keys.includes(key)) c.keys.push(key);
  if (o.isLight) o.intensity = 0;
  else o.layers.mask = 0;
}
function uncut(o, key) {
  const c = o.userData.cut;
  if (!c) return;
  const i = c.keys.indexOf(key);
  if (i < 0) return;
  c.keys.splice(i, 1);
  if (c.keys.length) return;
  if (o.isLight) o.intensity = c.intensity;
  else o.layers.mask = c.mask;
  delete o.userData.cut;
}

export function maskGroup(g, key = 'cull') {
  g.traverse((o) => cut(o, key));
}

export function unmaskGroup(g, key = 'cull') {
  g.traverse((o) => uncut(o, key));
}

// How many objects hang under `g`, all the way down: a nameplate or a scaffold added to a
// record while it is out has to be masked, and one added a level below the group's own
// children is still a new object. The walk is every DEEP_EVERY frames per record; in
// between, a change in the group's own children is caught on the frame it happens. Either
// way the new object is behind the fog already - this is tidiness, not a pop.
const DEEP_EVERY = 30;
function countUnder(g) {
  let n = 0;
  g.traverse(() => { n++; });
  return n;
}

// Whether `rec` is drawn this frame (and so worth animating), measuring from `eye` in a
// straight line - the same distance the fog (radial-fog.js) and the dither use. A range of 0
// lets every record back in, which is how the planner asks for the whole island. The record's
// position is read off matrixWorld, worked out by the last render, so a guest island's records
// inside their region's group measure the same as ours.
export function keepRecord(rec, range, eye) {
  const g = rec.group;
  if (!g) return true;
  // A record whose group was rebuilt has a fresh group nobody masked.
  if (rec.cull && rec.cull.group !== g) rec.cull = null;
  if (!rec.seen || rec.seen.group !== g) rec.seen = { group: g, through: seenThroughFog(g) };
  const r = rec.seen.through ? 0 : range;
  const e = g.matrixWorld.elements;
  const d = Math.hypot(e[12] - eye.x, e[13] - eye.y, e[14] - eye.z);
  const out = cullNext(d, r, !!rec.cull);
  if (out && !rec.cull) {
    maskGroup(g);
    rec.cull = { group: g, kids: g.children.length, count: countUnder(g), tick: 0 };
  } else if (!out && rec.cull) {
    unmaskGroup(g);
    rec.cull = null;
  } else if (out) {
    const c = rec.cull;
    const deep = ++c.tick % DEEP_EVERY === 0;
    if (g.children.length !== c.kids || (deep && countUnder(g) !== c.count)) {
      maskGroup(g);
      c.kids = g.children.length;
      c.count = countUnder(g);
    }
  }
  return !out;
}

// A whole neighbour behind the fog: its ground, its wood, its fields, its props and its houses
// in one mask. Records are cut one by one past Object Distance, but an island's landscape is
// not a record and was drawn in full fog however far off it lay - a starter's forest alone is
// ~80k triangles, measured. `g` is a guest island (guest-island.js: `group` offset to the
// region's origin, `region.half`, `records`). Judged by the nearest point of its square, flat,
// against `ceiling` - main.js fogCeiling(), where the haze has closed - plus the same pad and
// hysteresis as a record, so everything masked is past the fog and nothing pops. `ceiling`
// Infinity (the planner) lets it back. An island with a landmark on it (seenThroughFog) is left
// alone, for the same reason its lighthouse is. Returns whether it is drawn.
export function keepRegion(g, ceiling, eye) {
  const grp = g.group;
  if (!grp || !g.region) return true;
  const e = grp.matrixWorld.elements;
  const half = g.region.half || 0;
  const dx = Math.max(0, Math.abs(eye.x - e[12]) - half);
  const dz = Math.max(0, Math.abs(eye.z - e[14]) - half);
  const d = Math.hypot(dx, dz);
  const landmark = (g.records || []).some((r) => r.group && (r.seen && r.seen.group === r.group ? r.seen.through : seenThroughFog(r.group)));
  const edge = ceiling + CULL_PAD;
  const out = Number.isFinite(ceiling) && !landmark && (g.farOut ? d >= edge - CULL_HYST : d >= edge);
  if (out && !g.farOut) { maskGroup(grp, 'far'); g.farOut = { kids: grp.children.length }; }
  else if (!out && g.farOut) { unmaskGroup(grp, 'far'); g.farOut = null; }
  else if (out && grp.children.length !== g.farOut.kids) { maskGroup(grp, 'far'); g.farOut.kids = grp.children.length; }
  return !out;
}
