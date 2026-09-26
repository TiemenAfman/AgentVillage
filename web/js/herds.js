// The island's ambient animals: sheep and cows on the fields, hens by the huts, ducks on the
// river and the lake, gulls over the quay (Plans/stal-en-veld.md, "Later").
//
// Scenery, not somebody. The story animals (web/js/animal-view.js, Plans/dierenverhalen.md)
// have names and a diary, are walked by the sea and are the same bird on every screen to the
// centimetre; these are nobody's, nothing remembers them and nothing is sent about them. What
// every screen does agree on is *where* they are kept - which field has the flock, which hut
// keeps hens, which stretch of river the ducks paddle - because that is worked out here from
// what every page already has for an island: its terrain, its village or bundle, and the
// fields its own keeper's page surveyed. How each one wanders about inside its patch is this
// page's own business, off web/js/fauna.js's brain (createBrain/stepBrain: the same state
// machine /demo and the stable run, seeded per animal), so two screens show the same flock
// in the same field, grazing to their own clocks.
//
// The rules, one per species, each a place every island can be asked about:
//
//   pasture  sheep or cows in one of the fenced field parcels each hamlet works (two for a
//            hamlet with six or more): the rects the landscape's own survey laid
//            (world.js workSites().fields for ours, the bundle's `work.fields` - the same
//            survey, posted by their keeper's page - for a neighbour). A field goes to the
//            hamlet whose middle is nearest. Kept a body's length inside the fence.
//   coop     two or three hens scratching along the front of one hut in three: the row of
//            cells outside its door, on land. Chosen by the plot, never by the house's id,
//            which a visitor only ever sees redacted.
//   water    two or three ducks at up to three spots: the lake if it holds water, then
//            river corners with water on all four sides, each tested by sampling the ground
//            round it and kept apart. A spot needs land within a few cells - a river has
//            banks, an open berth of sea does not.
//   quay     two to four gulls circling off the head of each quay (shared/quay.mjs quaysOf,
//            the same docks every page and the sea derive), in stacked rings.
//
// A choice is a hash of the island's seed and the place, never a draw in sequence, so a
// field ploughed or a hut built somewhere else moves nobody - the same rule planFields keeps.
// What an island gets is capped (SHARE, MAX_PER_ISLAND): scaled to what it has, never more
// than forty. Nothing on the volcano: nobody grazes a lava flow.
//
// And the drawing: one batch for every island (createAnimalBatch, the story animals' own,
// handed the ambient species), so all the sheep of all the islands are one InstancedMesh per
// sheep part. What that costs is a number per species present - sheep 6, cow 7, hen 6,
// duck 4, gull 6 meshes, at most 29 - and not a number per animal: tests/herds.test.mjs holds
// it the same for one animal and forty. A separate batch from the story animals on purpose:
// theirs is what the picker casts at and names the owner of, and a nameless hen in it would
// be a dossier with nobody in it.
//
// Who draws them far away: nobody. A herd exists only for the islands main.js draws whole
// (DETAILED; a silhouette on the horizon carries none), and past FAR from the eye an animal
// is neither stepped nor drawn - at that range a sheep is two pixels.
import { SEA_LEVEL, BUILD_SLOPE_MAX } from 'shared/terrain.mjs';
import { hash32 } from 'shared/rng.mjs';
import { quaysOf } from 'shared/quay.mjs';
import { DOOR_DIR } from 'shared/settlerwalk.mjs';
import { createBrain, stepBrain } from './fauna.js';
import { createAnimalBatch, poseInBatch, hideInBatch, drawCalls } from './animal-view.js';

export const AMBIENT_SPECIES = ['sheep', 'cow', 'chicken', 'duck', 'gull'];
// How the forty are shared out between the four kinds of place. By construction the island
// cap: an island that has everything gets exactly MAX_PER_ISLAND and no more.
export const SHARE = { pasture: 16, coop: 9, water: 6, quay: 9 };
export const MAX_PER_ISLAND = 40;
// Per species, across every island drawn at once: ours and DETAILED (4) neighbours, sixteen
// sheep each at most, with room to spare. A full batch leaves an animal undrawn, not broken.
export const AMBIENT_CAPACITY = 96;
// Further than this from the eye and an animal is not worth a matrix: a 0.4-unit sheep at
// 110 units is under three pixels on a 1080p screen at the island's field of view.
export const FAR = 110;
const FAR2 = FAR * FAR;

// How far inside its patch a body keeps its middle: half a body and a little, so a cow
// turning at the fence does not put her head through it. Measured off the bake: a cow is
// 0.81 long, a sheep 0.41, a hen 0.15.
const INSET = { sheep: 0.3, cow: 0.45, chicken: 0.15 };
// A flock's field, and the most bodies it may take, by area: cows want room.
const PER_CELL = { sheep: 0.5, cow: 0.25 };
// Water deep enough to be water from above rather than a wet sheen on the sand, and how far
// round a duck spot it is sampled.
const WET = -0.08;
const DUCK_R = { lake: 1.0, river: 0.5 };
const DUCK_SPOTS = 3;
const DUCK_APART = 8;
const BANK_NEAR = 3;
// Gull rings: the first this far round the head, each next one further out.
const GULL_R0 = 1.1, GULL_DR = 0.5;

// ---- the plan: which animals, where ------------------------------------------------------
// Pure: the same terrain, village and fields give the same list, in the same order, on any
// page. Each entry is { id, kind, area, on, seed } - `area` in the island's own local frame
// (fauna.js's { x, z, r } or { x0, x1, z0, z1 }), `on` what it stands on ('land', 'water',
// 'air'), `seed` its brain's. The id says where it is kept, which is what lets a re-plan keep
// every animal whose place did not change.
export function planAmbient({ terrain, village, fields = null, max = MAX_PER_ISLAND } = {}) {
  if (!terrain || !village || terrain.volcano || (village.island && village.island.volcano)) return [];
  const seed = terrain.seed;
  const out = [];
  const add = (list) => { for (const e of list) if (out.length < max) out.push(e); };
  const rects = fields != null ? fields : (village.work && village.work.fields) || [];
  add(pastures(terrain, village, rects, seed));
  add(coops(terrain, village, seed));
  add(waters(terrain, seed));
  add(quays(terrain, village, seed));
  return out;
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const entry = (id, kind, area, on, seed) => ({ id, kind, area, on, seed: `ambient:${seed}:${id}` });
// Whole groups, cheapest hash first, while the share holds: a flock is never half a flock.
function fill(groups, share) {
  groups.sort((a, b) => a.h - b.h || (a.key < b.key ? -1 : 1));
  const out = [];
  for (const g of groups) if (out.length + g.list.length <= share) out.push(...g.list);
  return out;
}

function pastures(terrain, village, rects, seed) {
  const half = terrain.half;
  const workable = (Array.isArray(rects) ? rects : []).filter((r) => {
    if (!Array.isArray(r) || r.length < 4 || !r.every(num)) return false;
    const [gx, gz, w, d] = r;
    if (w < 2 || d < 2) return false;
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!terrain.isLand(gx + x, gz + z)) return false;
    return true;
  });
  // Which hamlet works it: the one whose middle is nearest, ties to the earlier.
  const hamlets = (village.districts || []).filter((d) => d && Array.isArray(d.center) && d.center.every(num));
  const byHamlet = new Map();
  for (const r of workable) {
    const mx = r[0] + r[2] / 2, mz = r[1] + r[3] / 2;
    let best = -1, bestD = Infinity;
    hamlets.forEach((d, i) => {
      const dx = d.center[0] + 0.5 - mx, dz = d.center[1] + 0.5 - mz, dd = dx * dx + dz * dz;
      if (dd < bestD) { bestD = dd; best = i; }
    });
    if (!byHamlet.has(best)) byHamlet.set(best, []);
    byHamlet.get(best).push(r);
  }
  const groups = [];
  for (const list of byHamlet.values()) {
    const ranked = list.map((r) => ({ r, h: hash32(`${seed}:pasture:${r[0]},${r[1]}`) })).sort((a, b) => a.h - b.h);
    const flocks = ranked.length >= 6 ? 2 : 1;
    for (const { r: [gx, gz, w, d], h } of ranked.slice(0, flocks)) {
      const kind = (h >>> 4) % 5 < 3 ? 'sheep' : 'cow';
      const want = (kind === 'sheep' ? 3 : 2) + ((h >>> 8) % 2);
      const n = Math.max(1, Math.min(want, Math.floor(w * d * PER_CELL[kind])));
      const inset = INSET[kind];
      const area = { x0: gx - half + inset, x1: gx + w - half - inset, z0: gz - half + inset, z1: gz + d - half - inset };
      const key = `pasture:${gx},${gz},${w},${d}`;
      const list2 = [];
      for (let i = 0; i < n; i++) list2.push(entry(`${key}:${i}`, kind, area, 'land', seed));
      groups.push({ key, h, list: list2 });
    }
  }
  return fill(groups, SHARE.pasture);
}

// The row of cells outside a plot's door, as { x0, x1, z0, z1 } cells - DOOR_DIR[rot], the one
// copy of which way a door faces.
function frontRow(p) {
  const [dx, dz] = DOOR_DIR[((p.rot | 0) % 4 + 4) % 4];
  if (dz < 0) return { gx0: p.gx, gx1: p.gx + p.w - 1, gz0: p.gz - 1, gz1: p.gz - 1 };
  if (dz > 0) return { gx0: p.gx, gx1: p.gx + p.w - 1, gz0: p.gz + p.d, gz1: p.gz + p.d };
  if (dx > 0) return { gx0: p.gx + p.w, gx1: p.gx + p.w, gz0: p.gz, gz1: p.gz + p.d - 1 };
  return { gx0: p.gx - 1, gx1: p.gx - 1, gz0: p.gz, gz1: p.gz + p.d - 1 };
}

function coops(terrain, village, seed) {
  const half = terrain.half;
  const groups = [];
  for (const b of village.buildings || []) {
    const p = b && b.plot;
    if (!p || b.kind !== 'house' || b.tier !== 'hut' || ![p.gx, p.gz, p.w, p.d].every(num)) continue;
    const h = hash32(`${seed}:coop:${p.gx},${p.gz}`);
    if (h % 3 !== 0) continue;
    const row = frontRow(p);
    let dry = true;
    for (let gz = row.gz0; gz <= row.gz1 && dry; gz++) {
      for (let gx = row.gx0; gx <= row.gx1 && dry; gx++) {
        if (!terrain.isLand(gx, gz) || terrain.slope(gx, gz) >= BUILD_SLOPE_MAX) dry = false;
      }
    }
    if (!dry) continue;
    const i0 = INSET.chicken;
    const area = { x0: row.gx0 - half + i0, x1: row.gx1 + 1 - half - i0, z0: row.gz0 - half + i0, z1: row.gz1 + 1 - half - i0 };
    const key = `coop:${p.gx},${p.gz},${p.rot | 0}`;
    const n = 2 + ((h >>> 5) % 2);
    const list = [];
    for (let i = 0; i < n; i++) list.push(entry(`${key}:${i}`, 'chicken', area, 'land', seed));
    groups.push({ key, h, list });
  }
  return fill(groups, SHARE.coop);
}

// Water all round a spot: its middle and a ring of twelve, all under WET. Twelve points on a
// circle without a sine each time: the ring is fixed.
const RING = Array.from({ length: 12 }, (_, k) => [Math.cos((k / 12) * Math.PI * 2), Math.sin((k / 12) * Math.PI * 2)]);
function wetAround(terrain, x, z, r) {
  if (!(terrain.worldHeight(x, z) < WET)) return false;
  for (const [cx, sz] of RING) if (!(terrain.worldHeight(x + cx * r, z + sz * r) < WET)) return false;
  return true;
}
function bankNear(terrain, gx, gz) {
  for (let dz = -BANK_NEAR; dz <= BANK_NEAR; dz++) {
    for (let dx = -BANK_NEAR; dx <= BANK_NEAR; dx++) if (terrain.isLand(gx + dx, gz + dz)) return true;
  }
  return false;
}

function waters(terrain, seed) {
  const half = terrain.half;
  const spots = [];
  const apart = (x, z) => spots.every((s) => (s.x - x) ** 2 + (s.z - z) ** 2 >= DUCK_APART * DUCK_APART);
  const tryAt = (key, x, z, r, gx, gz) => {
    if (spots.length >= DUCK_SPOTS || !apart(x, z) || !bankNear(terrain, gx, gz) || !wetAround(terrain, x, z, r)) return;
    spots.push({ key, x, z, r });
  };
  // The lake first, where there is one: the middle the terrain dug it round.
  const lc = terrain.lakeCentre;
  if (Array.isArray(lc) && lc.every(num)) {
    tryAt(`duck:lake:${Math.round(lc[0])},${Math.round(lc[1])}`, lc[0], lc[1], DUCK_R.lake,
      Math.floor(lc[0] + half), Math.floor(lc[1] + half));
  }
  // Then the rivers: a corner with a wet cell on each of its four sides is mid-channel.
  const wet = new Set((terrain.riverCells || []).map(([gx, gz]) => gx + gz * terrain.size));
  const corners = [];
  for (const [gx, gz] of terrain.riverCells || []) {
    // The corner at (gx, gz)'s min side, shared with the three cells up and left of it.
    const s = terrain.size;
    if (!wet.has(gx - 1 + gz * s) || !wet.has(gx + (gz - 1) * s) || !wet.has(gx - 1 + (gz - 1) * s)) continue;
    corners.push({ gx, gz, h: hash32(`${seed}:duck:${gx},${gz}`) });
  }
  corners.sort((a, b) => a.h - b.h || a.gx - b.gx || a.gz - b.gz);
  for (const c of corners) {
    if (spots.length >= DUCK_SPOTS) break;
    tryAt(`duck:${c.gx},${c.gz}`, c.gx - half, c.gz - half, DUCK_R.river, c.gx, c.gz);
  }
  const groups = spots.map((s) => {
    const h = hash32(`${seed}:${s.key}`);
    const n = 2 + ((h >>> 6) % 2);
    const list = [];
    for (let i = 0; i < n; i++) list.push(entry(`${s.key}:${i}`, 'duck', { x: s.x, z: s.z, r: s.r }, 'water', seed));
    return { key: s.key, h, list };
  });
  return fill(groups, SHARE.water);
}

function quays(terrain, village, seed) {
  const landing = village.island && village.island.landing;
  if (!Array.isArray(landing)) return [];
  let list;
  try { list = quaysOf(terrain, village, landing); } catch { return []; }
  const rings = list.map((q) => {
    // Off the head, a little out over the water it faces.
    const x = q.head[0] + q.dir[0] * 0.8, z = q.head[1] + q.dir[1] * 0.8;
    const key = `gull:${q.shore[0]},${q.shore[1]}`;
    return { key, x, z, want: 2 + (hash32(`${seed}:${key}`) % 3), got: 0 };
  });
  // Two for every quay before a third for any: round and round until the share runs out.
  let left = SHARE.quay;
  for (let more = true; more && left > 0;) {
    more = false;
    for (const r of rings) if (left > 0 && r.got < r.want) { r.got++; left--; more = true; }
  }
  const out = [];
  for (const r of rings) {
    for (let i = 0; i < r.got; i++) out.push(entry(`${r.key}:${i}`, 'gull', { x: r.x, z: r.z, r: GULL_R0 + GULL_DR * i }, 'air', seed));
  }
  return out;
}

// The fence the brain does not know about. fauna.js sets off once it roughly faces where it
// is going - within about forty-five degrees - and turns as it walks, so its path bows: in
// the demo's round patch a metre across nobody sees it, but in the strip before a hut's door,
// 0.7 wide, a hen on a long diagonal walked straight out through the side (measured, in
// tests/herds.test.mjs). So whatever stands on something is put back inside its patch after
// every step, and stood on the ground there. A gull flies its circle exactly and is left be.
function fence(a, area) {
  let x = a.x, z = a.z;
  if (area.x0 !== undefined) {
    x = x < area.x0 ? area.x0 : x > area.x1 ? area.x1 : x;
    z = z < area.z0 ? area.z0 : z > area.z1 ? area.z1 : z;
  } else {
    const dx = x - area.x, dz = z - area.z, d2 = dx * dx + dz * dz;
    if (d2 > area.r * area.r) { const k = area.r / Math.sqrt(d2); x = area.x + dx * k; z = area.z + dz * k; }
  }
  if (x === a.x && z === a.z) return;
  a.x = x; a.z = z;
  a.y = a.ground(x, z);
}

// ---- the herds ---------------------------------------------------------------------------
// `createHerds({ scene, material })` makes the one batch; `forIsland` a herd per island that
// takes slots in it. `batch` may be handed in instead (it must hold AMBIENT_SPECIES), and is
// then the caller's to dispose.
export function createHerds({ scene, material, batch = null, capacity = AMBIENT_CAPACITY } = {}) {
  const own = !batch;
  const shared = batch || createAnimalBatch(scene, material, { capacity, species: AMBIENT_SPECIES });
  const herds = new Set();

  // One island's animals. `region` is { id, origin, half, terrain (raw, local), village } -
  // or a function returning the current one, for ours, which main.js replaces when the
  // chronicle redraws the coast. `groundAt(x, z)` is the height at a SCENE position (decks and
  // steps included), else the region's own terrain. `fields` is the island's surveyed field
  // rects [gx, gz, w, d] or a function giving them; left out, the bundle's `work.fields`.
  //
  // The herd re-plans itself whenever the region's village or terrain is a different object
  // - every scan on ours, every republish on theirs - and keeps every animal whose place is
  // unchanged, walking where it was: a new hut gets hens, a pulled-down one loses them, and
  // nobody else jumps. Never while hidden, so scrubbing the chronicle costs nothing.
  function forIsland({ region, groundAt = null, fields = null, max = MAX_PER_ISLAND } = {}) {
    const regionOf = typeof region === 'function' ? region : () => region;
    const bodies = new Map();   // id -> body
    let list = [];              // the same bodies, as an array the frame walks without an iterator
    let seen = null, seenVillage, seenTerrain;
    let ox = 0, oz = 0, terrain = null;

    // The heights a brain stands at, in the island's own frame: its patch is local.
    const land = (x, z) => (groundAt ? groundAt(x + ox, z + oz) : terrain ? terrain.worldHeight(x, z) : 0);
    const water = () => SEA_LEVEL;
    const air = (x, z) => Math.max(land(x, z), SEA_LEVEL);
    const GROUND = { land, water, air };

    function retire(b) {
      if (b.slot >= 0) { hideInBatch(shared, b.kind, b.slot); shared.give(b.kind, b.slot); }
      b.slot = -1;
      bodies.delete(b.id);
    }
    function replan() {
      const r = regionOf();
      seen = r; seenVillage = r && r.village; seenTerrain = r && r.terrain;
      terrain = (r && r.terrain) || null;
      ox = r && Array.isArray(r.origin) ? r.origin[0] : 0;
      oz = r && Array.isArray(r.origin) ? r.origin[1] : 0;
      const plan = r ? planAmbient({
        terrain, village: r.village,
        fields: typeof fields === 'function' ? fields() : fields,
        max,
      }) : [];
      const keep = new Set();
      for (const e of plan) {
        keep.add(e.id);
        let b = bodies.get(e.id);
        if (b && b.kind !== e.kind) { retire(b); b = null; }
        if (!b) {
          const brain = createBrain(e.kind, { area: e.area, seed: e.seed, ground: GROUND[e.on] });
          if (!brain) continue;
          b = { id: e.id, kind: e.kind, on: e.on, area: e.area, brain, slot: -1, drawn: false };
          stepBrain(brain, 0);
          bodies.set(e.id, b);
        }
        // A batch that was full when it arrived may have room now.
        if (b.slot < 0) b.slot = shared.take(e.kind, b);
      }
      for (const b of [...bodies.values()]) if (!keep.has(b.id)) retire(b);
      list = [...bodies.values()];
    }
    replan();

    function conceal(b) {
      if (!b.drawn) return;
      b.drawn = false;
      hideInBatch(shared, b.kind, b.slot);
    }

    // `showing` is false while the chronicle is scrubbed back: out of sight, and not stepped -
    // they are scenery, and coming back to them grazing where they were is no lie. `eye` is
    // the camera's position in the scene, for FAR.
    function update(dt, { showing = true, eye = null } = {}) {
      if (!showing) { for (let i = 0; i < list.length; i++) conceal(list[i]); return; }
      const r = regionOf();
      if (r !== seen || (r && (r.village !== seenVillage || r.terrain !== seenTerrain))) replan();
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.slot < 0) continue;
        const a = b.brain;
        if (eye) {
          const dx = a.x + ox - eye.x, dy = a.y - eye.y, dz = a.z + oz - eye.z;
          if (dx * dx + dy * dy + dz * dz > FAR2) { conceal(b); continue; }
        }
        stepBrain(a, dt);
        if (b.on !== 'air') fence(a, b.area);
        poseInBatch(shared, b.kind, b.slot, a.pose, a.x + ox, a.y, a.z + oz, a.yaw);
        b.drawn = true;
      }
    }

    const herd = {
      update,
      dispose() {
        for (const b of [...bodies.values()]) retire(b);
        list = [];
        herds.delete(herd);
      },
      replan,
      get region() { const r = regionOf(); return r ? r.id : null; },
      count: () => bodies.size,
      // What is standing where, for tests and the console: island-local positions.
      animals: () => list.map((b) => ({
        id: b.id, kind: b.kind, on: b.on, area: b.area, drawn: b.drawn,
        x: b.brain.x, y: b.brain.y, z: b.brain.z,
      })),
    };
    herds.add(herd);
    return herd;
  }

  return {
    batch: shared,
    forIsland,
    // The colour pass's cost of every ambient animal on the page (the shadow pass draws the
    // same meshes once more).
    drawCalls: () => drawCalls(shared),
    dispose() {
      for (const h of [...herds]) h.dispose();
      if (own) shared.dispose();
    },
  };
}
