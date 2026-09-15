// What makes a hamlet look like a place: who owns which ground, a hedge along the edge
// of it, and the fields and orchards in between. None of this is transmitted - the wire
// carries one bitstring per parcel row and everything here is derived from it, so the
// picture can never disagree with the plots and the roads it is drawn around.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32 } from 'shared/rng.mjs';
import { TIER_INDEX } from './buildings.js';

export const NONE = -1, TOWN = -2;

const tmpColor = new THREE.Color();
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---- who owns what ----------------------------------------------------------
// A super-cell owns the pitch x pitch ground cells at its min corner. `inset` counts how
// deep inside its own land a cell sits, up to three, which gives both the border set
// (depth one, with a neighbour outside) and the feather for the ground tint.
export function decodeOwnership(village, size) {
  const owner = new Int16Array(size * size).fill(NONE);
  const lat = village.island && village.island.lattice;
  if (!lat) return { owner, inset: new Uint8Array(size * size), lat: null };

  const stamp = (parcel, k) => {
    if (!parcel) return;
    for (let r = 0; r < parcel.h; r++) {
      const row = parcel.rows[r];
      for (let c = 0; c < parcel.w; c++) {
        if (row[c] !== '1') continue;
        const gx0 = lat.anchor[0] + lat.pitch * (parcel.i0 + c);
        const gz0 = lat.anchor[1] + lat.pitch * (parcel.j0 + r);
        for (let z = 0; z < lat.pitch; z++) {
          for (let x = 0; x < lat.pitch; x++) {
            const gx = gx0 + x, gz = gz0 + z;
            if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
            owner[gx + gz * size] = k;
          }
        }
      }
    }
  };

  stamp(village.island.town && village.island.town.parcel, TOWN);
  village.districts.forEach((d, k) => {
    for (const lobe of d.lobes || []) stamp(lobe.parcel, k);
  });

  // Two chamfer sweeps: cheap, and exact enough at a cap of three.
  const inset = new Uint8Array(size * size);
  const CAP = 3;
  for (let i = 0; i < owner.length; i++) inset[i] = owner[i] === NONE ? 0 : CAP;
  const relax = (gx, gz) => {
    const k = gx + gz * size;
    if (owner[k] === NONE) return;
    let best = CAP;
    for (const [dx, dz] of N4) {
      const nx = gx + dx, nz = gz + dz;
      const out = nx < 0 || nz < 0 || nx >= size || nz >= size;
      const no = out ? NONE : owner[nx + nz * size];
      best = Math.min(best, no === owner[k] ? inset[out ? k : nx + nz * size] + 1 : 1);
    }
    inset[k] = Math.min(inset[k], best);
  };
  for (let gz = 0; gz < size; gz++) for (let gx = 0; gx < size; gx++) relax(gx, gz);
  for (let gz = size - 1; gz >= 0; gz--) for (let gx = size - 1; gx >= 0; gx--) relax(gx, gz);

  return { owner, inset, lat };
}

// ---- the edge of a hamlet ---------------------------------------------------
// Merged strips rather than instanced blocks: buildable ground is allowed to slope by up
// to 0.6, so a rigid box on a border cell floats or sinks visibly. `buildPaths` already
// solves this for footpaths by sampling the ground per corner; a hedge does the same one
// level up, chaining collinear edges into runs and following the ground along each.
//
// The outline is closed. Every session of one project stands on that project's own land -
// that is what a district is - and an unbroken boundary is what says so from the air. It
// opens only where a road crosses, leaving two gateposts behind, so a hamlet is enclosed
// but never sealed. A river needs no code here: where one runs along a parcel edge the
// outward cell is not land, so the `isLand` test below drops that segment and the water
// does the job - the same test that already stops a hedge running out into the sea.

// What a hamlet puts up is its own standing rather than a die roll, and it is read off
// the houses inside it: tent 0 through keep 5, averaged. Sheds belong to apprentices and
// civic lots to the town, so neither has a say in the wall.
//
//   tents and huts    post and rail, thin enough to step over
//   cottages          a hedge, grown thick enough to stop a sheep
//   houses and above  dry stone, and the grander the houses the wider it gets
//
// Thickness ramps within a material as well as between them, and never doubles back at a
// rung - it is the one number that only ever grows, sevenfold from end to end, so a
// village of manors is visibly heavier than one of plain houses. Height follows at half
// that rate: enough to keep a wall taller than it is wide, which is the difference
// between a rampart and a very long bench.
const BOUNDARY = [
  { kind: 'rail', to: 1.2, h: [0.30, 0.34], t: [0.07, 0.14], jitter: 0.02, base: 0x6b4a2f, top: 0x7d5a3a },
  { kind: 'hedge', to: 2.8, h: [0.36, 0.46], t: [0.16, 0.30], jitter: 0.06, base: 0x4a6b39, top: 0x5d8347 },
  { kind: 'wall', to: 5.0, h: [0.42, 0.56], t: [0.32, 0.50], jitter: 0.11, base: 0x8a857c, top: 0x9a958c },
];
const HEAVIEST = BOUNDARY[BOUNDARY.length - 1];
const mix = ([a, b], f) => a + (b - a) * f;

// Weight 0 - a parcel claimed but not yet built on - gets the lightest fence there is.
function variantAt(weight) {
  const w = Math.max(0, Math.min(HEAVIEST.to, Number(weight) || 0));
  let from = 0;
  for (const b of BOUNDARY) {
    if (w < b.to || b === HEAVIEST) {
      const f = Math.max(0, Math.min(1, (w - from) / (b.to - from)));
      return { kind: b.kind, h: mix(b.h, f), t: mix(b.t, f), jitter: b.jitter, base: b.base, top: b.top };
    }
    from = b.to;
  }
}

// Weighed by the ground a house actually stands on rather than by the district it belongs
// to on paper: a settler the island had no room for lodges on the commons, and it is the
// town's own wall that has to answer for that one.
function weighHouses(village, owner, size) {
  const sum = new Map(), n = new Map();
  for (const b of village.buildings || []) {
    const t = TIER_INDEX[b.tier];
    if (!(t >= 0) || !b.plot) continue;
    const gx = b.plot.gx + ((b.plot.w || 1) >> 1), gz = b.plot.gz + ((b.plot.d || 1) >> 1);
    if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
    const k = owner[gx + gz * size];
    if (k === NONE) continue;
    sum.set(k, (sum.get(k) || 0) + t);
    n.set(k, (n.get(k) || 0) + 1);
  }
  const out = new Map();
  for (const [k, s] of sum) out.set(k, s / n.get(k));
  return out;
}

export function buildBorders(village, terrain, owner, roadCells) {
  const size = terrain.size;
  const isRoad = (gx, gz) => roadCells.has(gx + gz * size);
  const ownerAt = (gx, gz) => (gx < 0 || gz < 0 || gx >= size || gz >= size ? NONE : owner[gx + gz * size]);

  // What every owner on this island puts up, measured once: a run asks for its own.
  const weight = weighHouses(village, owner, size);
  const variants = new Map();
  const variantFor = (k) => {
    if (!variants.has(k)) variants.set(k, variantAt(weight.get(k) || 0));
    return variants.get(k);
  };

  // One run per (owner, orientation, fixed coordinate), each an unbroken length of edge.
  const runs = new Map();
  const posts = [];
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const k = ownerAt(gx, gz);
      // The town puts up no hedge. A hamlet's edge says whose land you are standing on,
      // which is worth drawing; the commons is simply the middle of the island, and a
      // fence around it reads as a boundary between nothing and nothing - clearest on an
      // early island, where it was one long line across empty grass.
      if (k === NONE || k === TOWN) continue;
      for (const [dx, dz] of N4) {
        const nx = gx + dx, nz = gz + dz;
        if (ownerAt(nx, nz) === k) continue;
        // Two owners meeting would draw the hedge twice; the lower index draws it.
        const no = ownerAt(nx, nz);
        // The lower index draws a shared edge - but the town draws nothing now, so a
        // hamlet meeting the commons has to put up its own side or the run breaks there.
        if (no !== NONE && no !== TOWN && no < k) continue;
        // The coast is its own boundary, and a hedge over water looks like a mistake.
        if (!terrain.isLand(nx, nz)) continue;
        // Where a road crosses, the hedge opens and leaves two gateposts behind.
        if (isRoad(gx, gz) && isRoad(nx, nz)) { posts.push([gx, gz, dx, dz, k]); continue; }
        const axis = dx !== 0 ? 'x' : 'z';
        const fixed = dx !== 0 ? gx + (dx > 0 ? 1 : 0) : gz + (dz > 0 ? 1 : 0);
        const along = dx !== 0 ? gz : gx;
        const key = `${k}|${axis}|${fixed}`;
        if (!runs.has(key)) runs.set(key, { k, axis, fixed, at: [] });
        runs.get(key).at.push(along);
      }
    }
  }

  const parts = [];
  const hueOf = (k) => (k === TOWN ? null : (village.districts[k] || {}).hue);
  for (const run of runs.values()) {
    const v = variantFor(run.k);
    run.at.sort((a, b) => a - b);
    let start = null, prev = null;
    const flush = () => {
      if (start === null) return;
      const g = strip(terrain, run.axis, run.fixed, start, prev + 1, v, hueOf(run.k));
      if (g) parts.push(g);
    };
    for (const a of run.at) {
      if (prev !== null && a !== prev + 1) { flush(); start = a; }
      else if (start === null) start = a;
      prev = a;
    }
    flush();
  }
  for (const [gx, gz, dx, dz, k] of posts) {
    const v = variantFor(k);
    const axis = dx !== 0 ? 'x' : 'z';
    const fixed = dx !== 0 ? gx + (dx > 0 ? 1 : 0) : gz + (dz > 0 ? 1 : 0);
    const along = dx !== 0 ? gz : gx;
    for (const end of [along, along + 1]) {
      const g = post(terrain, axis, fixed, end, v);
      if (g) parts.push(g);
    }
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

// The cross-section each kind of boundary is swept along, from the ground up: half-width
// as a fraction of the run's own thickness, then height as a fraction of its own height.
// A boundary is read as a silhouette - from above, and from far enough away that no
// detail on it survives - so the shape of that outline is the whole of the job. A hedge
// that swells and draws in at the top reads as something grown; a wall that leans in as
// it rises reads as something stacked by hand; a rail stays a plank with its edges taken
// off. All three were the same shoebox before, and a shoebox reads as scenery.
const PROFILE = {
  rail: [[0.62, 0], [1, 0.24], [1, 0.82], [0.66, 1]],
  hedge: [[0.52, 0], [0.96, 0.26], [1, 0.58], [0.84, 0.84], [0.44, 1]],
  wall: [[1, 0], [0.94, 0.30], [0.82, 0.64], [0.66, 0.88], [0.40, 1]],
};

// A length of hedge from `a` to `b` along `axis` at world coordinate `fixed - half`,
// following the ground: the profile above, swept along the run and closed off at both
// ends, so it reads as a solid thing from any angle without needing a double-sided
// material.
function strip(terrain, axis, fixed, a, b, v, hue) {
  const half = terrain.half;
  const f = fixed - half;
  const STEP = 0.5;
  const n = Math.max(1, Math.round((b - a) / STEP));
  const pos = [], col = [], idx = [];
  const base = tmpColor.setHex(v.base).clone();
  const top = tmpColor.setHex(v.top).clone();
  if (hue != null) {
    // A nudge toward the hamlet's own colour, enough to tell two neighbours apart.
    top.lerp(tmpColor.setHSL(hue / 360, 0.4, 0.45), 0.22);
    base.lerp(tmpColor.setHSL(hue / 360, 0.4, 0.3), 0.16);
  }
  const t = v.t / 2;
  const prof = PROFILE[v.kind];
  const L = prof.length, S = L * 2;
  // Which side of the line the near face lies on is not a free choice: it has to be the
  // run's own direction turned right, or the triangles come out wound the other way and
  // the run is drawn inside out. That is what used to happen to every run along z - the
  // outward faces were all facing in, so half of every outline on the island was a hole
  // you looked straight through, and a corner where the two axes met came out as a notch.
  const sx = axis === 'x' ? -1 : 0, sz = axis === 'x' ? 0 : 1;
  const side = tmpColor.clone();
  let vi = 0, last = 0;
  for (let s = 0; s <= n; s++) {
    const alongW = a - half + (b - a) * (s / n);
    const jx = axis === 'x' ? f : alongW;
    const jz = axis === 'x' ? alongW : f;
    const g = terrain.worldHeight(jx, jz);
    const wob = ((hash32(`${v.kind}:${Math.round(jx * 2)}:${Math.round(jz * 2)}`) % 100) / 100 - 0.5) * 2 * v.jitter;
    const foot = g - 0.05, rise = v.h + wob + 0.05;
    // Near side first, bottom to top, then the far side the same way round.
    for (const dir of [-1, 1]) {
      for (const [wf, hf] of prof) {
        const w = t * wf * dir;
        pos.push(jx + sx * w, foot + rise * hf, jz + sz * w);
        // Weighted towards the base, because the light already finds the crown: a plain
        // lerp up a rounded profile lands the pale colour on the flanks as well, and the
        // hedge comes out the colour of new growth all the way down.
        side.copy(base).lerp(top, Math.pow(hf, 1.6));
        col.push(side.r, side.g, side.b);
      }
    }
    if (s > 0) {
      const p = vi - S;
      for (let i = 0; i < L - 1; i++) {
        const pn = p + i, vn = vi + i, pf = p + L + i, vf = vi + L + i;
        idx.push(pn, pn + 1, vn, vn, pn + 1, vn + 1);              // near face
        idx.push(pf, vf, pf + 1, pf + 1, vf, vf + 1);              // far face
      }
      const pn = p + L - 1, vn = vi + L - 1, pf = p + S - 1, vf = vi + S - 1;
      idx.push(pn, pf, vn, vn, pf, vf);                            // the ridge along the top
    }
    last = vi;
    vi += S;
  }
  // Both ends closed. A run stops wherever a gate opens or the land runs out, and an open
  // end is not a small thing on a face-culled material: you see straight into the run and
  // out through its far side, which is the one place a hedge stops looking like a hedge.
  const cap = (bas, forward) => {
    const ring = [];
    for (let i = 0; i < L; i++) ring.push(bas + i);
    for (let i = L - 1; i >= 0; i--) ring.push(bas + L + i);
    if (!forward) ring.reverse();
    for (let i = 1; i < ring.length - 1; i++) idx.push(ring[0], ring[i], ring[i + 1]);
  };
  cap(0, false);
  cap(last, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function post(terrain, axis, fixed, at, v) {
  const half = terrain.half;
  const x = axis === 'x' ? fixed - half : at - half;
  const z = axis === 'x' ? at - half : fixed - half;
  // A gatepost is as stout as the thing it holds up, or the gateway into a walled village
  // would be two twigs either side of the road. Six sides and a foot wider than its head,
  // rather than a box: it stands at the open end of a run that now swells and draws in,
  // and a square stake against that reads as scaffolding somebody forgot to take away.
  const w = Math.max(0.17, v.t * 1.05);
  const hp = v.h + 0.22;
  const g = new THREE.CylinderGeometry(w * 0.40, w * 0.52, hp, 6);
  g.translate(x, terrain.worldHeight(x, z) + hp / 2 - 0.05, z);
  const c = tmpColor.setHex(v.kind === 'wall' ? 0x8a857c : 0x6b4a2f);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // A merge needs every piece to carry the same attributes, and the strips are position
  // and colour only; normals are computed once over the merged whole.
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

// ---- fields, orchards and kitchen gardens -----------------------------------
// Where a patch goes is derived from the hash of its own cell, never from a sequential
// draw. Candidacy changes as parcels grow and houses are built, and with a sequential
// generator every field on the island would shuffle on a change anywhere - which would
// look like a bug in the live update rather than in the noise.
const FIELD = { base: 0x6b563f, furrow: 0x7d6a4e };
const STUBBLE = { base: 0x8f7f5c, furrow: 0xa08b62 };

export function planFields(village, terrain, owner, cleared, { coverage = 0.35 } = {}) {
  const size = terrain.size;
  const claimed = new Uint8Array(size * size);
  const patches = [], orchards = [], gardens = [];
  const candidate = (gx, gz) => {
    if (gx < 1 || gz < 1 || gx >= size - 1 || gz >= size - 1) return false;
    const k = gx + gz * size;
    if (claimed[k] || cleared.has(k)) return false;
    if (!terrain.isLand(gx, gz) || terrain.isBeach(gx, gz)) return false;
    return terrain.slope(gx, gz) < 0.35;
  };
  const fits = (gx, gz, w, d) => {
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!candidate(gx + x, gz + z)) return false;
    return true;
  };
  const take = (gx, gz, w, d) => {
    const cells = [];
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) { claimed[(gx + x) + (gz + z) * size] = 1; cells.push([gx + x, gz + z]); }
    return cells;
  };

  for (let gz = 1; gz < size - 1; gz++) {
    for (let gx = 1; gx < size - 1; gx++) {
      if (!candidate(gx, gz)) continue;
      const h = hash32(`${terrain.seed}:field:${gx},${gz}`);
      if ((h % 1000) / 1000 > coverage) continue;
      const mine = owner[gx + gz * size];
      const roll = (h >> 10) % 100;
      if (mine === NONE) {
        // Countryside: ploughed strips and orchards, big enough to read from above.
        const w = 2 + ((h >> 17) % 2), d = 3 + ((h >> 19) % 2);
        if (roll < 62 && fits(gx, gz, w, d)) patches.push({ cells: take(gx, gz, w, d), w, d, gx, gz });
        else if (fits(gx, gz, 3, 3)) orchards.push({ cells: take(gx, gz, 3, 3), gx, gz, w: 3, d: 3 });
      } else {
        // Inside a hamlet, on land nobody has built on: a kitchen garden.
        if (roll < 70 && fits(gx, gz, 1, 2)) gardens.push({ cells: take(gx, gz, 1, 2), gx, gz, w: 1, d: 2 });
        else if (fits(gx, gz, 1, 1)) gardens.push({ cells: take(gx, gz, 1, 1), gx, gz, w: 1, d: 1 });
      }
    }
  }
  return { patches, orchards, gardens };
}

// ---- the sheet the fields are ploughed on -----------------------------------
// world.js keeps the island's texture loader to itself and this module hands back bare
// geometry rather than meshes, so the fields fetch their own sheet and hang it on the
// material they are given. Everything about it is optional, exactly as it is over there:
// a sheet that never arrives leaves the fields the flat colours they have always had,
// which is why the palettes below are still the whole picture on their own.
//
// `field.png` is brightness only, around 0.8 - the vertex colours underneath carry the
// season, so a stubble field in autumn stays stubble-coloured and merely gains a tilth.
const FIELD_SHEET = 'textures/field.png';
let fieldSheet = null, fieldSheetAsked = false;
const awaitingSheet = new Set();

function loadFieldSheet() {
  fieldSheetAsked = true;
  new THREE.TextureLoader().load(FIELD_SHEET, (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;              // the renderer clamps this to whatever the card allows
    fieldSheet = tex;
    for (const m of awaitingSheet) dressFieldMaterial(m);
    awaitingSheet.clear();
  }, undefined, () => {
    console.warn(`[island] no texture at web/${FIELD_SHEET}; the fields stay as they were`);
  });
}

// Hand this the material the field decal is drawn with and it becomes tilled soil. The
// sheet usually lands after the first island is already standing, so a material that
// asks early is remembered and dressed the moment it arrives - the fields are rebuilt
// often enough (a season, a parcel, a new hamlet) that waiting for one would show.
export function dressFieldMaterial(material) {
  if (!material) return material;
  if (!fieldSheetAsked) loadFieldSheet();
  if (!fieldSheet) { awaitingSheet.add(material); return material; }
  material.map = fieldSheet;
  // The sheet averages about four fifths, and multiplying that over soil that is already
  // dark brown makes mud of it. The lift puts the average back where the flat colour was,
  // so the sheet spends its range on grain rather than on gloom - which is the difference
  // between a plough-turned field and a scorch mark seen from the air.
  material.color.setScalar(1 / 0.78);
  material.needsUpdate = true;
  return material;
}

// The tilled ground itself, as one merged decal - the same trick `buildPaths` uses, so it
// hugs the terrain and never z-fights with it.
//
// A cell is one world unit and four metres, and the sheet carries sixteen plough rows. At
// four units to the sheet those rows fall a metre apart, which is a real ridge-and-furrow
// pitch and also the quarter-cell pitch the furrow decals below have always used; and no
// patch is bigger than four cells, so no field ever shows the sheet twice.
const FIELD_TEX_UNITS = 4;

export function buildFieldDecals(plan, terrain, season) {
  const pal = season === 'autumn' || season === 'winter' ? STUBBLE : FIELD;
  const pos = [], col = [], uv = [], idx = [];
  let vi = 0;
  // UVs in world coordinates rather than per quad, as `buildPaths` does with its paving:
  // a field of five cells then reads as one ploughed field instead of the same stamp laid
  // five times, and the cell boundaries inside it disappear. `alongX` turns the sheet a
  // quarter so its rows run down the length of the patch, because a field ploughed
  // north-south with an east-west grain on it reads as two fields on top of each other.
  const quad = (x0, z0, x1, z1, hex, lift, alongX) => {
    tmpColor.setHex(hex);
    for (const [qx, qz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      pos.push(qx, terrain.worldHeight(qx, qz) + lift, qz);
      col.push(tmpColor.r, tmpColor.g, tmpColor.b);
      uv.push((alongX ? qx : qz) / FIELD_TEX_UNITS, (alongX ? qz : qx) / FIELD_TEX_UNITS);
    }
    idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
    vi += 4;
  };

  for (const p of [...plan.patches, ...plan.gardens]) {
    const alongX = p.w >= p.d;
    for (const [gx, gz] of p.cells) {
      const [x, z] = terrain.cellWorld(gx, gz);
      quad(x - 0.5, z - 0.5, x + 0.5, z + 0.5, pal.base, 0.045, alongX);
    }
    // Furrows along the long axis, half a cell apart - it was a quarter before the sheet.
    // The sheet ploughs the field itself, at sixteen rows to its four units, which is
    // exactly the quarter-cell pitch these lines used to sit at: drawn there they land on
    // rows that are already drawn, and the field comes out striped twice over. At half a
    // cell they stop being the furrows and become the gaps between beds - wide bands over
    // a fine tilth, which is one field rather than two patterns arguing. With no sheet to
    // multiply they are still the only thing that marks a field as ploughed at all.
    const [ox, oz] = terrain.cellWorld(p.gx, p.gz);
    const x0 = ox - 0.5, z0 = oz - 0.5;
    const steps = Math.round((alongX ? p.d : p.w) / 0.5);
    for (let s = 1; s < steps; s++) {
      const o = s * 0.5;
      if (alongX) quad(x0 + 0.08, z0 + o - 0.05, x0 + p.w - 0.08, z0 + o + 0.05, pal.furrow, 0.055, alongX);
      else quad(x0 + o - 0.05, z0 + 0.08, x0 + o + 0.05, z0 + p.d - 0.08, pal.furrow, 0.055, alongX);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Where the orchard trees stand: a regular grid of small, barely-rotated trees. Next to a
// scattered forest that reads unmistakably as planted, and it costs no new mesh - these
// go into an instanced mesh of their own with room to grow.
export function orchardTrees(plan, terrain) {
  const out = [];
  for (const o of plan.orchards) {
    for (let z = 0; z < o.d; z++) {
      for (let x = 0; x < o.w; x++) {
        const [wx, wz] = terrain.cellWorld(o.gx + x, o.gz + z);
        out.push([wx, wz, 0.46 + ((hash32(`orch:${o.gx + x},${o.gz + z}`) % 20) / 100)]);
      }
    }
  }
  return out;
}
