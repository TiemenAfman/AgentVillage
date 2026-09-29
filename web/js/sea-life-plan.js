// What lives on the sea floor, and where: the pure half of sea-life.js (Plans/onderwater-zwemmen.md).
// No THREE, no models, no clock - a bed function goes in and lists of things come out, so a test
// can hold every rule under Node and two pages that ask about the same water draw the same reef.
//
// The world is cut into CHUNK-wide squares and each square is planned from its own coordinates
// alone: `hash32('sea:<cx>:<cz>...')` for the choices, world-frame noise for the clusters. Nothing
// is stored and nothing is sent; walk a hundred units away and back and the kelp is where it was.
// That is also why this file never touches Math.random.
//
// Page-only and cosmetic. A fish or a shell is not on the wire and not in any layout: it is drawn
// where the seabed says there is room for it, and the only thing it answers to is `bedAt`.
import { hash32, makeRng, makeSimplex2D } from 'shared/rng.mjs';

export const CHUNK = 16;
// The candidate points inside a chunk: one jittered point per CELL x CELL square.
const CELL = 2;

// The things that stand on the bed, in the order the instanced meshes are made. `h` is the
// baked height at scale 1 (web/js/sea-mesh.js) - kelp needs it to stay under the surface.
export const KINDS = {
  kelp_a:       { asset: 'flora_kelp_a', h: 1.5 },
  kelp_b:       { asset: 'flora_kelp_b', h: 1.2 },
  coral_fan:    { asset: 'flora_coral_fan', h: 0.5 },
  coral_branch: { asset: 'flora_coral_branch', h: 0.635 },
  coral_dome:   { asset: 'flora_coral_dome', h: 0.325 },
  rock_a:       { asset: 'flora_rock_sea_a', h: 0.49 },
  rock_b:       { asset: 'flora_rock_sea_b', h: 0.2 },
  shell:        { asset: 'prop_shell', h: 0.05 },
  starfish:     { asset: 'prop_starfish', h: 0.03 },
};
export const KIND_NAMES = Object.keys(KINDS);

// How much of each a page draws at most, by tier (graphics-settings.js: full, modest, phone):
// `reach` is how far from you, in units, and the rest are instance caps. The underwater mist
// (underwater.js) closes in at 25-60 anyway, so a reach past it is water nobody sees - the
// modest and phone tiers stop well before it.
export const CAPS = {
  full:  { reach: 56, kelp: 900, coral: 250, rock: 200, shell: 300, fish: 120, bubbles: 300 },
  modest: { reach: 36, kelp: 360, coral: 100, rock: 80, shell: 120, fish: 50, bubbles: 150 },
  phone: { reach: 28, kelp: 225, coral: 62, rock: 50, shell: 75, fish: 30, bubbles: 90 },
};

// Where things may stand. Shallower than this is a beach or a polder or the fairway's floor:
// the island has its own things there, and a bank up to BED_TOP (-1.0) is still deep enough.
export const SHALLOWEST = -0.9;
const DEEPEST = -3.6;
// How far under the surface the top of a kelp strand stays: it should reach for the light, not
// break through it.
const KELP_HEADROOM = 0.35;

const kelpField = makeSimplex2D('sea:kelp');
const reefField = makeSimplex2D('sea:reef');

// A number in [0, 1) from a label, for the choices that do not need a stream of their own.
const unit = (label) => hash32(label) / 4294967296;

// The steepness of the bed round a point, as rise over run across 1.6 units.
function slopeAt(bedAt, x, z, h0) {
  const d = 0.8;
  const dx = Math.abs(bedAt(x + d, z) - bedAt(x - d, z));
  const dz = Math.abs(bedAt(x, z + d) - bedAt(x, z - d));
  return Math.max(dx, dz, Math.abs(h0 - bedAt(x + d, z + d)) * 0.7) / (2 * d);
}

// One chunk's still life and its school of fish (or none).
// Returns { items: { [kind]: [{ x, y, z, rot, s }] }, school: null | { ... } }.
export function planChunk(cx, cz, bedAt) {
  const items = {};
  for (const k of KIND_NAMES) items[k] = [];
  const at = (rng, ox, oz) => ({ x: ox + rng.range(0, CELL), z: oz + rng.range(0, CELL) });
  const n = CHUNK / CELL;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const rng = makeRng(`sea:${cx}:${cz}:${i}:${j}`);
      const { x, z } = at(rng, cx * CHUNK + i * CELL, cz * CHUNK + j * CELL);
      const bed = bedAt(x, z);
      if (bed > SHALLOWEST || bed < DEEPEST) continue;
      const slope = slopeAt(bedAt, x, z, bed);
      const put = (kind, s, lift = 0) => {
        items[kind].push({ x, y: bed + lift, z, rot: rng.range(0, 6.2832), s });
      };

      // Kelp grows in forests: clusters from a field of its own, in the deeper half of the bed.
      const forest = kelpField(x * 0.05, z * 0.05);
      let taken = false;
      if (forest > 0.15 && bed <= -1.2 && slope < 0.3) {
        const many = forest > 0.5 ? 3 : forest > 0.3 ? 2 : 1;
        for (let k = 0; k < many; k++) {
          if (!rng.chance(0.65)) continue;
          const kind = rng.chance(0.5) ? 'kelp_a' : 'kelp_b';
          // The strand is shortened to fit the water it stands in, so it never breaks the
          // surface: a bank at -1.2 grows short kelp, a trench at -3 grows tall.
          const fit = Math.max(0.25, (-KELP_HEADROOM - bed) / KINDS[kind].h);
          // About twice the height of the person swimming through it at most (a strand is 1.5
          // baked, and a diver 0.54): at scales up to 1.35 the forest stood four body-heights
          // tall and hid the diver from their own camera.
          const s = Math.min(rng.range(0.4, 0.75), fit);
          items[kind].push({ x: x + rng.range(-0.6, 0.6), y: bed, z: z + rng.range(-0.6, 0.6), rot: rng.range(0, 6.2832), s });
          taken = true;
        }
      }

      // Coral on the banks: reefs, from another field, where the bed climbs into the light.
      const reef = reefField(x * 0.07 + 50, z * 0.07);
      if (!taken && reef > 0.25 && bed >= -2.3 && rng.chance(0.6)) {
        put(rng.pick(['coral_fan', 'coral_branch', 'coral_dome']), rng.range(0.9, 1.6));
        taken = true;
      }

      // Rock where the bed is steep (a trench's walls, a bank's flank), and now and then on sand.
      if (!taken && ((slope > 0.2 && rng.chance(0.5)) || rng.chance(0.03))) {
        put(rng.chance(0.5) ? 'rock_a' : 'rock_b', rng.range(0.7, 1.7) * (slope > 0.2 ? 1.2 : 1));
        taken = true;
      }

      // The sand itself: a few shells, fewer starfish.
      if (!taken && slope < 0.12) {
        if (rng.chance(0.15)) put('shell', rng.range(0.8, 1.6));
        else if (rng.chance(0.05)) put('starfish', rng.range(0.9, 1.5));
      }
    }
  }
  return { items, school: schoolOf(cx, cz, bedAt) };
}

// A school of fish that lives over a chunk: where it swims round, how many, how deep. The
// members' offsets are drawn once here so the per-frame work is a rotation and a sum.
function schoolOf(cx, cz, bedAt) {
  const rng = makeRng(`sea:school:${cx}:${cz}`);
  if (!rng.chance(0.32)) return null;
  const x0 = cx * CHUNK + rng.range(3, 13), z0 = cz * CHUNK + rng.range(3, 13);
  if (bedAt(x0, z0) > -1.5) return null;
  const count = 6 + rng.int(9);
  const offsets = [];
  for (let i = 0; i < count; i++) {
    offsets.push([rng.range(-1.3, 1.3), rng.range(-0.35, 0.35), rng.range(-1.3, 1.3), rng.range(0, 6.2832)]);
  }
  return {
    id: `${cx}:${cz}`, species: rng.int(2), count, offsets,
    x0, z0, ax: rng.range(3, 7), az: rng.range(3, 7),
    w1: rng.range(0.15, 0.3), w2: rng.range(0.12, 0.25), p1: rng.range(0, 6.2832), p2: rng.range(0, 6.2832),
    level: rng.range(0.2, 0.8),
  };
}

// Where a school is at time `t`, and which way it heads (radians, the settlers' yaw: 0 is +z).
// A slow figure of eight round its chunk. Water depth is asked of the bed at the centre every
// call, so a school over a bank rides up it.
export function schoolPose(school, t, bedAt, surface = 0) {
  const a = school.w1 * t + school.p1, b = school.w2 * t + school.p2;
  const x = school.x0 + school.ax * Math.sin(a);
  const z = school.z0 + school.az * Math.sin(b);
  const vx = school.ax * school.w1 * Math.cos(a), vz = school.az * school.w2 * Math.cos(b);
  const bed = bedAt(x, z);
  // Between half a unit off the bed and just under the surface, at the school's own level.
  const low = bed + 0.5, high = Math.max(low, surface - 0.6);
  return { x, y: low + (high - low) * school.level, z, heading: Math.atan2(vx, vz) };
}

// The chunks a page draws round (x, z), nearest first: every one whose square comes within
// `reach`. Nearest first matters - a cap that is hit cuts the far end, not the near.
export function chunksAround(x, z, reach) {
  const out = [];
  const r = Math.ceil(reach / CHUNK) + 1;
  const cx0 = Math.floor(x / CHUNK), cz0 = Math.floor(z / CHUNK);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const cx = cx0 + dx, cz = cz0 + dz;
      // The nearest point of the square, not its middle.
      const nx = Math.max(cx * CHUNK - x, 0, x - (cx + 1) * CHUNK);
      const nz = Math.max(cz * CHUNK - z, 0, z - (cz + 1) * CHUNK);
      const d = Math.sqrt(nx * nx + nz * nz);
      if (d <= reach) out.push({ cx, cz, d });
    }
  }
  return out.sort((a, b) => a.d - b.d || a.cx - b.cx || a.cz - b.cz);
}

// Everything to draw round (x, z): the still life per kind, capped, and the schools. `plan` is
// a function (cx, cz) -> planChunk's answer (sea-life.js caches it). Items are kept if they lie
// within `reach` of the focus - a chunk is square, the view is not.
export function gather(x, z, reach, caps, plan) {
  const out = {};
  for (const k of KIND_NAMES) out[k] = [];
  const schools = [];
  const limit = {
    kelp_a: caps.kelp, kelp_b: caps.kelp,
    coral_fan: caps.coral, coral_branch: caps.coral, coral_dome: caps.coral,
    rock_a: caps.rock, rock_b: caps.rock, shell: caps.shell, starfish: caps.shell,
  };
  // The caps are per family: kelp's two shapes share one, and so do the three corals.
  const family = {
    kelp_a: 'kelp', kelp_b: 'kelp', coral_fan: 'coral', coral_branch: 'coral', coral_dome: 'coral',
    rock_a: 'rock', rock_b: 'rock', shell: 'shell', starfish: 'shell',
  };
  const used = { kelp: 0, coral: 0, rock: 0, shell: 0 };
  const r2 = reach * reach;
  let fish = 0;
  for (const c of chunksAround(x, z, reach)) {
    const p = plan(c.cx, c.cz);
    for (const kind of KIND_NAMES) {
      const f = family[kind];
      for (const it of p.items[kind]) {
        if (used[f] >= limit[kind]) break;
        const dx = it.x - x, dz = it.z - z;
        if (dx * dx + dz * dz > r2) continue;
        out[kind].push(it);
        used[f]++;
      }
    }
    if (p.school && fish + p.school.count <= caps.fish) { schools.push(p.school); fish += p.school.count; }
  }
  return { items: out, schools, fish };
}
