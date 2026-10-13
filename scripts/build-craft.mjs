// What the galleon's craft knows of her without a mesh, read off her bake: web/js/pirateship-mesh.js ->
// shared/craft-galleon.mjs. `node scripts/build-craft.mjs` (npm run models:craft); `npm run models --
// pirateship` runs it before the walk map is cut (scripts/models.mjs), and tests/craft-bake.test.mjs fails
// until it has been.
//
// shared/crafts.mjs used to type every one of these numbers by hand - deck rectangles measured by rays
// in Blender, a ladder's rope line, where a gun stands - against a bake that could change under them.
// Now the bake carries them as anchors (scripts/build-sloop.py, the grammar in scripts/model-rules.mjs:
// deck/stair/rail/solid/mast/port/climb/mount pairs, helm/nest/cargo points, the waterline) and this turns
// those into the craft: a record of literals that the sea reads as it reads any other shared module
// (Dockerfile.sea copies shared/ whole). The generator may do arithmetic - a bearing from two points, a
// square root for a unit vector - and the output may not: shared/'s rule (no trig, no clock, no three) is
// kept by writing only what came out, as shared/quay.mjs writes its HEADINGS.
//
// Frames. An anchor is in the bake's frame (keel on y = 0, +z the bow); the craft is in the hull's own
// (shared/deck.mjs: y above DECK_Y on the waterline she floats at), so craft-y = anchor-y - waterline -
// DECK_Y. What is not an anchor is cut from the hull's triangles with scripts/hull-cut.mjs: her side at
// the water (the probes she sails by, her length), her overall size, and the two heights a rope ladder
// ends against - the bulwark a side ladder is climbed over and the rim of the top a mast ladder is
// climbed into - because a bulwark's top is nothing an empty marks and the model has it anyway.
//
// What stays hand-tuned is in shared/crafts.mjs, which spreads GALLEON into CRAFTS.galleon: `crew`, the
// bulwark's one height over its rails (BULWARK), a ladder's `hw`, how she handles (`sail`, but for the
// probes), her swell and the nest's `reach`.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DECK_Y } from '../shared/hull.mjs';
import { CLIMB_OUT } from '../shared/deck.mjs';
import { MOUNT_KINDS } from './model-rules.mjs';
import { sideCut, heightsAt, sourceOf as hullOf } from './hull-cut.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const HULL_PART = 'pirateship hull';

// How far a mount may be laid off its rest, by kind: a gun traverses a little and is laid between
// level and a hand up (shared/cannon.mjs GUN_TRAVERSE, GUN_PITCH_MIN/MAX); a harpoon gun is aimed, not
// laid - wider, and down at the water, since what it catches floats (Plans/harpoen.md). Radians.
export const MOUNT_LIMITS = {
  cannon: { yawLim: 0.61, pitchLim: [-0.12, 0.42] },
  harpoon: { yawLim: 0.95, pitchLim: [-0.45, 0.6] },
};
// The mounts' order is their number on the wire ({t:'cannon', i}): starboard gun first, as it has always
// been, port second, then the harpoons. A name not listed here comes after these, alphabetically.
const MOUNT_ORDER = ['cannon-s', 'cannon-p', 'harpoon', 'harpoon-s', 'harpoon-p'];
// Half the thickness of a rail as the craft's rectangle (its anchors are two ends of a run on a line),
// and the box a mast is to feet that walk into it.
const RAIL_HALF = 0.05;
const MAST_HALF = 0.15;
// The one deck rectangle that is not a deck: the crow's nest (`deck.nest`), a layer of its own that the
// walk map cuts apart (scripts/build-shipwalk.mjs ALOFT) and the sea's clamp never reaches, so it goes to
// `aloft` and `nest` and not into `deck`.
const NEST = 'nest';
// Reading the hull for a ladder's top: how far above the floor a bulwark or a rim may stand, the step the
// hull is sampled at, and how far either side of a side ladder's line it is sampled (a rail is a run,
// and its top is the same a hand either way).
const TOP_REACH = 1.0;
const TOP_STEP = 0.025;
const TOP_SPAN = 0.1;
// How thick a bulwark may be, cap rail and all, from its outside in.
const BULWARK_W = 0.3;
// How far from the hull's middle the shoulder probes stand, as a share of the way to the bow.
const PROBE_SHARES = [2 / 3, 1 / 3];

// Four decimals: a tenth of a millimetre on the island, and the one rounding that turns an anchor
// lifted by the waterline and DECK_Y (six decimals each, scripts/export-models.py) back into the
// number it was typed as - 1.108, not 1.107999.
const rd = (v) => {
  const r = Math.round(v * 1e4) / 1e4;
  return r === 0 ? 0 : r;   // never -0: JSON has no such number, and the module is JSON
};
const pt = (p) => ({ x: p[0], y: p[1], z: p[2] });

// What the craft was derived from: the anchors and the height, and the hull they were measured on, since
// the probes and the ladders' tops are cut from its triangles.
export function sourceOf(bake) {
  const hull = hullOf(bake.parts[HULL_PART].positions);
  return createHash('sha1').update(JSON.stringify({ anchors: bake.anchors, height: bake.height, hull })).digest('hex').slice(0, 16);
}

// Every `<kind>.<name>.<end>` anchor of a kind, as { name, lo, hi } (or a, b), by name.
function pairs(anchors, kind, ends = ['lo', 'hi']) {
  const out = new Map();
  for (const [key, p] of Object.entries(anchors)) {
    const m = new RegExp(`^${kind}\\.(.+)\\.(${ends.join('|')})$`).exec(key);
    if (!m) continue;
    if (!out.has(m[1])) out.set(m[1], { name: m[1] });
    out.get(m[1])[m[2]] = pt(p);
  }
  for (const v of out.values()) {
    if (!v[ends[0]] || !v[ends[1]]) throw new Error(`${kind}.${v.name}: half a pair (model-rules.mjs should have refused it)`);
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// The rectangle between two opposite corners.
function rect(a, b) {
  return { x: rd((a.x + b.x) / 2), z: rd((a.z + b.z) / 2), hx: rd(Math.abs(b.x - a.x) / 2), hz: rd(Math.abs(b.z - a.z) / 2) };
}

// The height of the planking at (x, z) by the craft's own rule (shared/deck.mjs deckAt, written out
// here so the generator imports nothing that reads the module it writes): the highest rectangle the
// point is in, a ramp's at that z.
function floorAt(deck, x, z) {
  let best = null;
  for (const r of deck) {
    if (Math.abs(x - r.x) > r.hx || Math.abs(z - r.z) > r.hz) continue;
    const y = r.slope ? r.y + r.slope * (z - r.z) : r.y;
    if (best === null || y > best) best = y;
  }
  return best;
}

export function derive(bake) {
  const A = bake.anchors;
  const part = bake.parts[HULL_PART];
  if (!part) throw new Error(`the bake has no "${HULL_PART}"`);
  if (!A.waterline) throw new Error('the bake has no anchor.waterline: where does she float?');
  const pos = part.positions.map((v, i) => v + part.at[i % 3]);
  const waterline = A.waterline[1];
  const lift = waterline + DECK_Y;
  const raw = (p) => p.y - lift;
  const cy = (p) => rd(raw(p));
  const heights = (x, z) => heightsAt(pos, x, z, lift);

  // Her size: overall from her triangles, at the water from her side.
  let xMax = 0, zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    xMax = Math.max(xMax, Math.abs(pos[i]));
    zMin = Math.min(zMin, pos[i + 2]);
    zMax = Math.max(zMax, pos[i + 2]);
  }
  const side = sideCut(pos, waterline);
  const slices = side.lo.map((lo, k) => (lo <= side.hi[k] ? k : -1)).filter((k) => k >= 0);
  if (!slices.length) throw new Error('nothing of the hull at the waterline');
  const stern = side.z0 + slices[0] * side.dz, bow = side.z0 + (slices[slices.length - 1] + 1) * side.dz;
  const halfAt = (z) => {
    const k = Math.min(side.lo.length - 1, Math.max(0, Math.floor((z - side.z0) / side.dz)));
    return Math.max(side.hi[k], -side.lo[k]) / 100;
  };
  const length = rd(bow - stern);

  // The planking: level rectangles from `deck.*`, ramps from `stair.*` (foot to head, the rise per
  // unit of z), the crow's nest kept apart.
  const deck = [];
  let nestRect = null;
  for (const d of pairs(A, 'deck')) {
    if (Math.abs(d.lo.y - d.hi.y) > 1e-6) throw new Error(`deck.${d.name} is not level: ${d.lo.y} and ${d.hi.y}`);
    const r = { ...rect(d.lo, d.hi), y: cy(d.lo) };
    if (d.name === NEST) nestRect = r;
    else deck.push(r);
  }
  for (const s of pairs(A, 'stair')) {
    if (Math.abs(s.hi.z - s.lo.z) < 1e-6) throw new Error(`stair.${s.name} runs across, not fore and aft`);
    deck.push({ ...rect(s.lo, s.hi), y: rd((raw(s.lo) + raw(s.hi)) / 2), slope: rd((raw(s.hi) - raw(s.lo)) / (s.hi.z - s.lo.z)) });
  }

  // What cannot be walked through: a rail (with the floor under it, for crafts.mjs to put the bulwark's
  // top on), a solid box (no top: a wall), a mast.
  const rails = [];
  for (const r of pairs(A, 'rail', ['a', 'b']).sort((a, b) => Number(a.name) - Number(b.name))) {
    if (Math.abs(r.a.y - r.b.y) > 1e-6) throw new Error(`rail.${r.name} is not on one floor`);
    const q = rect(r.a, r.b);
    rails.push({ x: q.x, z: q.z, hx: Math.max(q.hx, RAIL_HALF), hz: Math.max(q.hz, RAIL_HALF), floor: cy(r.a) });
  }
  for (const s of pairs(A, 'solid')) rails.push(rect(s.lo, s.hi));
  const masts = Object.entries(A).filter(([k]) => /^mast\./.test(k)).sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [, p] of masts) rails.push({ x: rd(p[0]), z: rd(p[2]), hx: MAST_HALF, hz: MAST_HALF });

  // The rope ladders over her side: the climber's foot stand (`lo`) is CLIMB_OUT outside the ropes;
  // where they step off (`hi`) is the deck. Through a port the top is that deck; over a bulwark it is
  // the bulwark's top, read off the hull between the landing and the ropes.
  const ports = pairs(A, 'port');
  const ladders = [];
  for (const c of pairs(A, 'climb').filter((c) => /^side(-|$)/.test(c.name))) {
    const s = c.lo.x < 0 ? -1 : 1;
    const x = rd(c.lo.x - s * CLIMB_OUT), z = rd(c.lo.z);
    if (Math.abs(x) < halfAt(z)) throw new Error(`climb.${c.name}: its ropes hang at ${x}, inside the hull's side (${s * halfAt(z)}) at z ${z}`);
    const land = [rd(c.hi.x), rd(c.hi.z)];
    const floor = floorAt(deck, land[0], land[1]);
    if (floor === null) throw new Error(`climb.${c.name} lands at (${land}) where there is no deck`);
    const port = ports.find((p) => Math.sign(p.lo.x) === s && Math.min(p.lo.z, p.hi.z) <= z && z <= Math.max(p.lo.z, p.hi.z));
    const ladder = { x, z, foot: cy(c.lo), top: null, land };
    if (port) {
      ladder.top = rd(floor);
      ladder.port = rd(Math.abs(port.hi.z - port.lo.z) / 2);
    } else {
      // The bulwark is the outermost thing standing on the planking between the landing and the
      // ropes: from the ropes inward, the first column of the hull with anything in the band over the
      // floor, and the top is the highest within BULWARK_W of it - no further in, or a cleat or a
      // bucket by the landing (the port side has one) is read as the rail.
      let top = -Infinity;
      for (const sz of [z - TOP_SPAN, z, z + TOP_SPAN]) {
        let outer = null;
        for (let sx = Math.abs(x); sx >= Math.abs(land[0]) - 1e-9; sx -= TOP_STEP) {
          const band = heights(s * sx, sz).filter((h) => h > floor + 0.05 && h <= floor + TOP_REACH);
          if (!band.length) continue;
          if (outer === null) outer = sx;
          if (sx < outer - BULWARK_W) break;
          top = Math.max(top, ...band);
        }
      }
      if (!Number.isFinite(top)) throw new Error(`climb.${c.name}: no bulwark between its landing and its ropes`);
      ladder.top = rd(top);
    }
    ladders.push(ladder);
  }
  ladders.sort((a, b) => b.x - a.x);   // starboard first, as the hand-typed list had them

  // Up a mast to its top: `out` is the unit vector from the mast to the climber, the ropes CLIMB_OUT
  // back along it, and the top is the rim, the highest of the hull in the nest's rectangle.
  const aloft = [];
  for (const c of pairs(A, 'climb').filter((c) => /^mast(-|$)/.test(c.name))) {
    const mast = A[`mast.${c.name === 'mast' ? 'main' : c.name.slice(5)}`];
    if (!mast) throw new Error(`climb.${c.name}: no mast.${c.name === 'mast' ? 'main' : c.name.slice(5)} to climb`);
    if (!nestRect) throw new Error(`climb.${c.name}: no deck.${NEST} to climb into`);
    const dx = c.lo.x - mast[0], dz = c.lo.z - mast[2], len = Math.sqrt(dx * dx + dz * dz);
    const out = [dx / len, dz / len];
    const floor = cy(c.hi);
    let top = -Infinity;
    for (let sx = nestRect.x - nestRect.hx; sx <= nestRect.x + nestRect.hx + 1e-9; sx += 2 * TOP_STEP) {
      for (let sz = nestRect.z - nestRect.hz; sz <= nestRect.z + nestRect.hz + 1e-9; sz += 2 * TOP_STEP) {
        for (const h of heights(sx, sz)) if (h > floor && h <= floor + TOP_REACH && h > top) top = h;
      }
    }
    if (!Number.isFinite(top)) throw new Error(`climb.${c.name}: no rim over the nest's floor`);
    // `out` is written unrounded: shared/deck.mjs walks CLIMB_OUT along it and back, and a unit vector
    // rounded to four decimals is 2e-5 short of one, which is a climber 3 um off the line the rungs
    // are hung on (tests/ladder-rungs.test.mjs holds that to 1e-9).
    aloft.push({
      x: rd(c.lo.x - out[0] * CLIMB_OUT), z: rd(c.lo.z - out[1] * CLIMB_OUT), out: [out[0], out[1]],
      foot: cy(c.lo), top: rd(top), land: [rd(c.hi.x), rd(c.hi.z)], floor,
    });
  }

  // Where to sit up there, looking out over the bow, and the height a body must be above to be in the nest.
  const nest = A.nest && nestRect
    ? { seat: { x: rd(A.nest[0]), z: rd(A.nest[2]), y: cy(pt(A.nest)), yaw: 0 }, floor: nestRect.y }
    : null;

  // What can be manned: `hi` is the carriage on the planking, `lo` whoever mans it, and the bearing
  // from the one to the other is the way it points at rest (0 forward, +pi/2 starboard).
  const mounts = [];
  for (const m of pairs(A, 'mount')) {
    const kind = MOUNT_KINDS.find((k) => m.name === k || m.name.startsWith(`${k}-`));
    if (!kind) throw new Error(`mount.${m.name}: not a kind of mount`);
    // The bearing from the stand as written to the carriage as written, so that the two literals
    // and the yaw agree exactly and not to the rounding.
    const dx = rd(m.hi.x) - rd(m.lo.x), dz = rd(m.hi.z) - rd(m.lo.z);
    if (Math.hypot(dx, dz) < 1e-6) throw new Error(`mount.${m.name}: the stand is on the carriage, so it points nowhere`);
    mounts.push({
      name: m.name, kind, x: rd(m.hi.x), z: rd(m.hi.z), y: cy(m.hi), yaw: Math.atan2(dx, dz), stand: [rd(m.lo.x), rd(m.lo.z)],
      yawLim: MOUNT_LIMITS[kind].yawLim, pitchLim: [...MOUNT_LIMITS[kind].pitchLim],
    });
  }
  const rank = (n) => (MOUNT_ORDER.includes(n) ? MOUNT_ORDER.indexOf(n) : MOUNT_ORDER.length);
  mounts.sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : 1));
  for (const m of mounts) delete m.name;

  // The points of her hull tested against the ground as she sails (web/js/boat.js, and where a
  // berth is cut for her, shared/quay.mjs): her bow at the water, and shoulders either side at two
  // thirds and a third of the way out from her middle, as wide as her side is there.
  const probes = [[0, rd(bow)]];
  for (const share of PROBE_SHARES) {
    const z = rd(bow * share), w = halfAt(z);
    probes.push([w, z], [-w, z]);
  }

  // Her outline to a ball (shared/cannon.mjs inHull): half her width at the rails, half her length at
  // the water, from her keel to the planking her highest bulwark stands on (crafts.mjs adds the bulwark).
  const bulwarks = rails.filter((r) => r.floor !== undefined);
  const box = {
    hx: rd(Math.max(...bulwarks.map((r) => Math.abs(r.x) + r.hx))),
    hz: rd(length / 2),
    y0: -waterline,
    deck: rd(Math.max(...bulwarks.map((r) => r.floor))),
  };

  return {
    draught: waterline,
    tall: rd(bake.height - waterline),
    length,
    overall: rd(zMax - zMin),
    beam: rd(xMax),
    near: Math.ceil(length / 2 + 1.5),
    helm: A.helm ? [rd(A.helm[0]), rd(A.helm[2])] : null,
    cargo: A.cargo ? { x: rd(A.cargo[0]), z: rd(A.cargo[2]), y: cy(pt(A.cargo)) } : null,
    deck, rails, ladders, aloft, nest, mounts, probes, box,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { PIRATESHIP } = await import(pathToFileURL(`${root}web/js/pirateship-mesh.js`).href);
  const craft = derive(PIRATESHIP);
  const out = `// Generated by scripts/build-craft.mjs from web/js/pirateship-mesh.js. Never hand-edit.
// What the galleon's craft knows of her without her mesh, read off her bake's anchors and her hull:
// shared/crafts.mjs spreads it into CRAFTS.galleon and adds what is tuned by hand. Literals only, so
// the sea reads it like any shared module. \`source\` is what it was derived from (tests/craft-bake.test.mjs).
export const GALLEON = ${JSON.stringify({ source: sourceOf(PIRATESHIP), ...craft }, null, 2)};
`;
  writeFileSync(`${root}shared/craft-galleon.mjs`, out);
  console.log(`craft-galleon.mjs: ${craft.deck.length} deck rectangles, ${craft.rails.length} rails, ${craft.ladders.length} ladders, ${craft.aloft.length} aloft, ${craft.mounts.length} mounts; ${craft.length} at the water, ${craft.overall} overall`);
}
