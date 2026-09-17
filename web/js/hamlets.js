// What makes a hamlet look like a place: who owns which ground, a fence along the edge
// of it, and the fields and orchards in between. None of this is transmitted - the wire
// carries one bitstring per parcel row and everything here is derived from it, so the
// picture can never disagree with the plots and the roads it is drawn around.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32 } from 'shared/rng.mjs';
import { TIER_INDEX } from './buildings.js';
import * as models from './models.js';

export const NONE = -1, TOWN = -2;

const tmpColor = new THREE.Color();
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---- a rounded outline on the ground ----------------------------------------
// Everything the island draws flat on the ground is a rectangle with some of its corners
// taken off: a cell of paving, a yard of trodden earth, the headland round a field.
// Nothing on this island has a sharp corner, so they all want the same ring of points and
// there is one place that knows how to lay it out.
//
// It lives in this module rather than in world.js because world.js already leans on this
// one for the dressing of the ground and the import the other way round would be a cycle.
//
// The ring comes back in the order world.js has always fanned a tile in - north-west,
// south-west, south-east, north-east - which is anticlockwise seen from above and so
// faces up. `corners` says which of those four is eased, in that same order, because a
// path may only round a corner where the paving stops in both directions: an edge that a
// neighbour carries on has to stay straight or the two cells would not meet, and the road
// would come out beaded rather than continuous.
const CORNERS_ALL = [true, true, true, true];
function arcTo(out, px, pz, qx, qz, cx, cz, seg) {
  const a0 = Math.atan2(pz - cz, px - cx);
  let d = Math.atan2(qz - cz, qx - cx) - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const r = Math.hypot(px - cx, pz - cz);
  for (let k = 0; k <= seg; k++) {
    const t = a0 + (d * k) / seg;
    out.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]);
  }
}
export function roundedOutline(x0, z0, x1, z1, radius, seg = 4, corners = CORNERS_ALL) {
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (z1 - z0) / 2));
  const out = [];
  if (r > 0 && corners[0]) arcTo(out, x0 + r, z0, x0, z0 + r, x0 + r, z0 + r, seg); else out.push([x0, z0]);
  if (r > 0 && corners[1]) arcTo(out, x0, z1 - r, x0 + r, z1, x0 + r, z1 - r, seg); else out.push([x0, z1]);
  if (r > 0 && corners[2]) arcTo(out, x1 - r, z1, x1, z1 - r, x1 - r, z1 - r, seg); else out.push([x1, z1]);
  if (r > 0 && corners[3]) arcTo(out, x1, z0 + r, x1 - r, z0, x1 - r, z0 + r, seg); else out.push([x1, z0]);
  return out;
}

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

// ---- how far from anybody ---------------------------------------------------
// One breadth-first sweep over the whole grid, and two things read it. The fields ask
// "is this ground near enough to a door or a road that somebody would walk out and
// plough it?", and the forest asks the same question the other way round - "is this far
// enough from anybody that nobody has cleared it?". Both used to answer it with noise,
// which is why the island came out as one even quilt of fields and one even spatter of
// trees from the town square to the far coast.
//
// Four-connected, because everything it feeds is: the roads are routed four-connected,
// the parcels are rectangles on the same grid, and a diagonal metric would only round
// the corners of the band for twice the bookkeeping. It floods over water as happily as
// over land - a bay is exactly as far from a door as walking round it is not, and
// leaving the sea out would cost an isLand test on all 65k cells for no visible gain.
//
// `dist` counts cells from settled ground: a parcel, a road, a paved square. `near` is
// which hamlet is closest, and it is seeded from claimed parcels alone rather than from
// the same set. A road that runs out of the village belongs to nobody, and seeding the
// sweep with it would hand "nobody" down the whole corridor - so a field beside the lane
// out of town would have no hamlet to take its colour or its fence from.
export function settledDistance(terrain, owner, roadCells, { cap = 63 } = {}) {
  const size = terrain.size, n = size * size;
  const dist = new Uint8Array(n).fill(cap);
  const near = new Int16Array(n).fill(NONE);
  const queue = new Int32Array(n);

  const sweep = (seed, step) => {
    let head = 0, tail = 0;
    for (let k = 0; k < n; k++) if (seed(k)) queue[tail++] = k;
    while (head < tail) {
      const k = queue[head++];
      const gx = k % size, gz = (k - gx) / size;
      for (const [dx, dz] of N4) {
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        const nk = nx + nz * size;
        if (step(k, nk)) queue[tail++] = nk;
      }
    }
  };

  sweep((k) => {
    if (owner[k] === NONE && !roadCells.has(k)) return false;
    dist[k] = 0;
    return true;
  }, (k, nk) => {
    const d = dist[k] + 1;
    if (d >= cap || dist[nk] <= d) return false;
    dist[nk] = d;
    return true;
  });

  sweep((k) => {
    if (owner[k] === NONE) return false;
    near[k] = owner[k];
    return true;
  }, (k, nk) => {
    if (near[nk] !== NONE) return false;
    near[nk] = near[k];
    return true;
  });

  return { dist, near };
}

// ---- the edge of a hamlet ---------------------------------------------------
// Merged strips rather than instanced blocks: buildable ground is allowed to slope by up
// to 0.6, so a rigid box on a border cell floats or sinks visibly. `buildPaths` already
// solves this for footpaths by sampling the ground per corner; a boundary does the same one
// level up, chaining collinear edges into runs and following the ground along each.
//
// The outline is closed. Every session of one project stands on that project's own land -
// that is what a district is - and an unbroken boundary is what says so from the air. It
// opens only where a road crosses, leaving two gateposts behind, so a hamlet is enclosed
// but never sealed. A river needs no code here: where one runs along a parcel edge the
// outward cell is not land, so the `isLand` test below drops that segment and the water
// does the job - the same test that already stops a run of boundary running out into the sea.

// What a hamlet puts up is its own standing rather than a die roll, and it is read off
// the houses inside it: tent 0 through keep 5, averaged. Sheds belong to apprentices and
// civic lots to the town, so neither has a say in the wall.
//
//   tents and huts    post and rail, thin enough to step over
//   huts and cottages a paling fence, closed enough to stop a sheep
//   cottages and up   a hedge, which is the first boundary that took years rather than a day
//   houses and above  dry stone, and the grander the houses the wider it gets
//
// Thickness ramps within a material as well as between them, and never doubles back at a
// rung - it is the one number that only ever grows, sevenfold from end to end, so a
// village of manors is visibly heavier than one of plain houses. Height follows at half
// that rate: enough to keep a wall taller than it is wide, which is the difference
// between a rampart and a very long bench.
//
// Height is the one that is allowed to dip, and it dips in exactly one place: a
// well-grown hedge stands taller than the lowest dry stone. That is what a hedge does -
// it is the tall thin boundary and a wall is the low thick one - and it is why thickness
// and not height is the number the ladder is read by.
//
// Three of the four are Blender models now, laid a bay to the ground cell by modelled()
// below, and only the post and rail is still a swept profile. Two things follow from that
// and are worth knowing before reading the table.
//
// A modelled rung carries no `base` or `top`. Its colour is on the material in the .blend,
// and a second opinion here would be the thing assets/README.md warns about - two things
// deciding one colour make mud. All a rung adds is the nudge towards the hamlet's own hue
// that every boundary gets.
//
// And the jitter is per bay rather than per half unit, so it means something different: a
// whole bay stands a little tall or a little short, and what a big number buys is a step
// at every joint. Sawn timber gets the rail's 0.02, growth gets more, and the wall gets
// less than the hedge because a course of stone is laid level and a hedge is not.
const BOUNDARY = [
  { kind: 'rail', to: 1.0, h: [0.30, 0.34], t: [0.07, 0.14], jitter: 0.02, base: 0x6b4a2f, top: 0x7d5a3a },
  { kind: 'fence', to: 2.2, h: [0.36, 0.46], t: [0.16, 0.28], jitter: 0.02 },
  { kind: 'hedge', to: 3.4, h: [0.46, 0.54], t: [0.29, 0.39], jitter: 0.05 },
  { kind: 'wall', to: 5.0, h: [0.50, 0.58], t: [0.40, 0.50], jitter: 0.03 },
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

// A field is fenced; it is not walled. The heaviest thing a hamlet of manors puts round
// its own land is half a metre of dry stone, and a ring of that round every parcel of
// turnips would read as a fortress farm rather than as a farm. So a lot always takes post
// and rail, and what the hamlet's standing buys it is a stouter rail rather than a
// different material - the whole 0-5 range of weights mapped onto the one rung instead of
// climbing through all three. The hue nudge is the one the hamlet edge already gets, and
// it is what makes a parcel legible as somebody's: two neighbours' fields can meet across
// a lane and still be told apart from the air.
function lotVariant(weight) {
  const rail = BOUNDARY[0];
  const f = Math.max(0, Math.min(1, (Number(weight) || 0) / HEAVIEST.to));
  return { kind: 'rail', h: mix(rail.h, f), t: mix(rail.t, f), jitter: rail.jitter, base: rail.base, top: rail.top };
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

export function buildBorders(village, terrain, owner, roadCells, fields = null) {
  const size = terrain.size;
  const isRoad = (gx, gz) => roadCells.has(gx + gz * size);
  const ownerAt = (gx, gz) => (gx < 0 || gz < 0 || gx >= size || gz >= size ? NONE : owner[gx + gz * size]);
  const hueOf = (k) => (k === TOWN ? null : (village.districts[k] || {}).hue);

  // What every owner on this island puts up, measured once: a run asks for its own.
  const weight = weighHouses(village, owner, size);
  const variants = new Map();
  const variantFor = (k) => {
    if (!variants.has(k)) variants.set(k, variantAt(weight.get(k) || 0));
    return variants.get(k);
  };

  // One run per (tag, orientation, fixed coordinate), each an unbroken length of edge. The
  // tag is whatever the edge belongs to - a hamlet, a field parcel, a house yard - and it
  // carries its own fence and tint, so the two passes below fill one map and one loop
  // turns the whole lot into one merged geometry.
  const runs = new Map();
  const posts = [];
  const edgeAt = (gx, gz, dx, dz) => ({
    axis: dx !== 0 ? 'x' : 'z',
    fixed: dx !== 0 ? gx + (dx > 0 ? 1 : 0) : gz + (dz > 0 ? 1 : 0),
    along: dx !== 0 ? gz : gx,
  });
  const edge = (tag, v, hue, gx, gz, dx, dz) => {
    const e = edgeAt(gx, gz, dx, dz);
    const key = `${tag}|${e.axis}|${e.fixed}`;
    if (!runs.has(key)) runs.set(key, { v, hue, axis: e.axis, fixed: e.fixed, at: [] });
    runs.get(key).at.push(e.along);
  };

  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const k = ownerAt(gx, gz);
      // The town puts up no boundary. A hamlet's edge says whose land you are standing on,
      // which is worth drawing; the commons is simply the middle of the island, and a
      // fence around it reads as a boundary between nothing and nothing - clearest on an
      // early island, where it was one long line across empty grass.
      if (k === NONE || k === TOWN) continue;
      for (const [dx, dz] of N4) {
        const nx = gx + dx, nz = gz + dz;
        if (ownerAt(nx, nz) === k) continue;
        // Two owners meeting would draw the boundary twice; the lower index draws it.
        const no = ownerAt(nx, nz);
        // The lower index draws a shared edge - but the town draws nothing now, so a
        // hamlet meeting the commons has to put up its own side or the run breaks there.
        if (no !== NONE && no !== TOWN && no < k) continue;
        // The coast is its own boundary, and a boundary over water looks like a mistake.
        if (!terrain.isLand(nx, nz)) continue;
        // Where a road crosses, the boundary opens and leaves two gateposts behind.
        if (isRoad(gx, gz) && isRoad(nx, nz)) { posts.push([gx, gz, dx, dz, variantFor(k)]); continue; }
        edge(`h${k}`, variantFor(k), hueOf(k), gx, gz, dx, dz);
      }
    }
  }

  // ---- what the land is for ------------------------------------------------
  // A hamlet's edge says whose land you are standing on. A lot's edge says what the land
  // is for, and that is the thing the reference picture has and the island did not: a
  // field reads as worked ground because somebody fenced it and left a gate in the fence.
  // Same chaining, same merge, same draw call - only a second map of who owns which cell.
  if (fields) {
    const lot = new Int16Array(size * size).fill(-1);
    const marks = [];
    const lotAt = (gx, gz) => (gx < 0 || gz < 0 || gx >= size || gz >= size ? -1 : lot[gx + gz * size]);
    const stamp = (cells, k, gate) => {
      const id = marks.length;
      marks.push({ v: lotVariant(weight.get(k) || 0), hue: hueOf(k), gate });
      for (const [gx, gz] of cells) lot[gx + gz * size] = id;
    };
    // Orchards are fenced like ploughland: a stand of fruit trees nobody keeps the deer
    // out of is a wood. Kitchen gardens are not - they sit inside a hamlet that is walled
    // already, and a paling round a bed of onions is a line nobody would build.
    for (const p of [...(fields.patches || []), ...(fields.orchards || [])]) stamp(p.cells, p.owner, null);
    // A yard is the three by three a house stands on, fenced all round bar a gateway in
    // front of its own door. The whole door side open is not a gate, it is a missing
    // fence; one cell wide with a post either side is the gate the front path runs
    // through, and it is where the path already comes out.
    for (const b of village.buildings || []) {
      // Residential gardens open onto shared greens. Fencing every 3x3 house
      // separately made even varied houses read as a row of square boxes.
      // Civic buildings share the open square as well: a ring of lot posts
      // around each one otherwise keeps the square looking like a grid.
      if (b.kind === 'house' || b.kind === 'civic') continue;
      if (!b.plot || b.plot.w !== 3 || b.plot.d !== 3 || !b.door) continue;
      const cells = [];
      for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) cells.push([b.plot.gx + x, b.plot.gz + z]);
      const [dgx, dgz] = b.door;
      const out = dgx === b.plot.gx ? [-1, 0] : dgx === b.plot.gx + 2 ? [1, 0] : dgz === b.plot.gz ? [0, -1] : [0, 1];
      stamp(cells, ownerAt(b.plot.gx + 1, b.plot.gz + 1), { k: dgx + dgz * size, dx: out[0], dz: out[1] });
    }

    for (let gz = 0; gz < size; gz++) {
      for (let gx = 0; gx < size; gx++) {
        const id = lotAt(gx, gz);
        if (id < 0) continue;
        const m = marks[id];
        for (const [dx, dz] of N4) {
          const nx = gx + dx, nz = gz + dz;
          if (lotAt(nx, nz) === id) continue;
          if (!terrain.isLand(nx, nz)) continue;
          // The hamlet's own boundary already runs along this edge, drawn heavier and
          // gated where the road crosses. A second fence a hand's width inside it is two
          // fences with a dead strip between them.
          if (ownerAt(nx, nz) !== ownerAt(gx, gz)) continue;
          const gated = isRoad(nx, nz) || (m.gate && m.gate.k === gx + gz * size && m.gate.dx === dx && m.gate.dz === dz);
          if (gated) { posts.push([gx, gz, dx, dz, m.v]); continue; }
          edge(`l${id}`, m.v, m.hue, gx, gz, dx, dz);
        }
      }
    }
  }

  const parts = [];
  for (const run of runs.values()) {
    run.at.sort((a, b) => a - b);
    let start = null, prev = null;
    const flush = () => {
      if (start === null) return;
      const lay = MODELLED[run.v.kind] ? modelled : strip;
      const g = lay(terrain, run.axis, run.fixed, start, prev + 1, run.v, run.hue);
      if (g) parts.push(g);
    };
    for (const a of run.at) {
      if (prev !== null && a !== prev + 1) { flush(); start = a; }
      else if (start === null) start = a;
      prev = a;
    }
    flush();
  }
  for (const [gx, gz, dx, dz, v] of posts) {
    const e = edgeAt(gx, gz, dx, dz);
    for (const end of [e.along, e.along + 1]) {
      const g = gatepost(terrain, e.axis, e.fixed, end, v);
      if (g) parts.push(g);
    }
  }
  if (!parts.length) return null;
  // mergeGeometries will only weld shapes that agree on which attributes exist, so one
  // piece built without `aSheet` stops the whole island at boot rather than coming out
  // untextured. Filling the gaps here instead of remembering to set it in every place a
  // part is made is the difference between a rule and a thing you have to remember: a
  // piece says which sheet it wants when it wants one, and whatever is left says nothing
  // and gets nothing, which is the same zero the shader reads as "leave this flat".
  let sheeted = 0;
  for (const g of parts) if (g.attributes.aSheet) sheeted++;
  if (sheeted && sheeted < parts.length) {
    for (const g of parts) {
      if (g.attributes.aSheet) continue;
      g.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    }
  }
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

// ---- the sheets a boundary is built out of ----------------------------------
// Two surfaces on one mesh, done the way buildings.js does it rather than the obvious
// way: a sheet index carried per vertex and one branch in the fragment shader. Every
// fence and wall on the island goes into a single mergeGeometries - that is what keeps
// the whole lot to one draw call - and material groups would cut that back up into one
// per kind, for no gain at all.
//
// There is no uv anywhere on a boundary either. A run is a swept profile, a bay of fence
// is a baked model and a gatepost is a cylinder, and the three merge into one loaf, so
// the sheet is projected from the three axes at once and blended by how far the face
// turns towards each. That turns out to be exactly what a fence wants, for nothing: the
// flank of a run has a normal across the run, so the projection it takes is the one whose
// boards lie along it. A fence going east-west gets its grain going east-west without
// being told which way it faces.
//
// The wall takes the stacked stone the plinths already use and everything wooden takes
// the sawn boards off the decking - both were drawn for this kind of job. Only the hedge
// needed a sheet of its own, because nothing on the island was leaves at hedge scale.
const TEXTURES = 'textures/';
// What the vertex carries and the shader branches on. Zero is no sheet at all, which the
// shader reads as "leave this flat" - an iron or painted part of a baked model.
const SHEET = { leaf: 1, plank: 2, stone: 3 };
// Which of them a swept rung is built out of. Only the post and rail is swept now; the
// other three are models, and a model's parts say what they are made of themselves.
const SHEET_INDEX = { rail: SHEET.plank };
// And that is where they say it: the material name in the .blend, whose prefix is one of
// the island's sheets (assets/README.md). The map is here rather than in each build
// script because the sheet a boundary is drawn on is the boundary's business - a fence
// with an iron hinge on it should be able to say `plain:` and get the flat treatment
// without anything here changing.
const BAKED_SHEET = {
  plank: SHEET.plank, plankZ: SHEET.plank, stone: SHEET.stone, foliage: SHEET.leaf, bark: SHEET.plank,
};
// One white pixel until a sheet lands, and for good if none ever does: white multiplies
// out, so a boundary with no sheets is the boundary the island drew before there were any.
const BLANK = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
BLANK.needsUpdate = true;
// One uniform block for every boundary material ever handed out. world.js throws its
// material away and asks for a new one each time a hamlet changes, and a list of past
// materials to keep up to date would only ever grow; sharing the block means a sheet
// that arrives late reaches the material built after it as well as the one before.
const SHEETS = { uLeaf: { value: BLANK }, uPlank: { value: BLANK }, uStone: { value: BLANK } };
for (const [name, slot] of [['hedge-leaf', 'uLeaf'], ['plank', 'uPlank'], ['stone-stacked', 'uStone']]) {
  new THREE.TextureLoader().load(`${TEXTURES}${name}.png`, (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;              // the renderer clamps this to whatever the card allows
    SHEETS[slot].value = tex;
  }, undefined, () => {
    console.warn(`[island] no texture at web/${TEXTURES}${name}.png; that surface stays as it was`);
  });
}

// The material world.js draws the merged boundary mesh with. Same base as the ground it
// stands on - vertex colours, flat shaded, unpolished - with the projection welded on.
export function createBoundaryMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLeaf = SHEETS.uLeaf;
    shader.uniforms.uPlank = SHEETS.uPlank;
    shader.uniforms.uStone = SHEETS.uStone;
    const glsl = (...lines) => lines.join(String.fromCharCode(10));
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', glsl(
        '#include <common>',
        'attribute float aSheet;',
        'varying float vSheet;',
        'varying vec3 vSheetPos;',
        'varying vec3 vSheetNrm;'))
      .replace('#include <begin_vertex>', glsl(
        '#include <begin_vertex>',
        'vSheet = aSheet;',
        'vSheetPos = position;',
        'vSheetNrm = normal;'));
    // Every sheet is multiplied over a vertex colour that is already the right colour, and
    // a sheet averages well under one, so each is lifted back to an average of about one
    // first and then mixed in by `k`. What is left is a swing either side of the colour
    // the boundary always had - grain rather than gloom, and no risk of a run turning
    // into a dark stripe across the island. The stacked stone is the loudest sheet in the
    // set by a distance and takes the smallest `k` of the three for it: the paving is
    // meant to keep the deepest tone on the island and nothing here may go near it.
    //
    // The third number is how many times the sheet repeats in a world unit, and a unit is
    // four metres: leaves at one to the unit come out a hand's width across, boards at 1.3
    // about half a metre wide, and the rubble at 0.6 lands three stones across the width
    // of a wall. All three were set by eye against a run standing on open ground.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', glsl(
        '#include <common>',
        'varying float vSheet;',
        'varying vec3 vSheetPos;',
        'varying vec3 vSheetNrm;',
        'uniform sampler2D uLeaf;',
        'uniform sampler2D uPlank;',
        'uniform sampler2D uStone;',
        'vec3 islandSheet(sampler2D m, vec3 p, vec3 n, float s) {',
        '  vec3 w = n * n;',
        '  w /= max(1e-4, w.x + w.y + w.z);',
        '  return texture2D(m, p.zy * s).rgb * w.x',
        '       + texture2D(m, p.xz * s).rgb * w.y',
        '       + texture2D(m, p.xy * s).rgb * w.z;',
        '}'))
      .replace('#include <color_fragment>', glsl(
        '#include <color_fragment>',
        'if (vSheet > 0.5) {',
        '  vec3 sn = normalize(vSheetNrm);',
        '  vec3 sc = vec3(1.0);',
        '  float k = 0.7, lift = 1.0;',
        '  if (vSheet > 2.5) { sc = islandSheet(uStone, vSheetPos, sn, 0.60); k = 0.42; lift = 1.75; }',
        '  else if (vSheet > 1.5) { sc = islandSheet(uPlank, vSheetPos, sn, 1.30); k = 0.70; lift = 1.32; }',
        '  else { sc = islandSheet(uLeaf, vSheetPos, sn, 1.00); k = 0.75; lift = 1.55; }',
        '  diffuseColor.rgb *= mix(vec3(1.0), sc * lift, k);',
        '}'));
  };
  mat.customProgramCacheKey = () => 'settlers-boundary';
  return mat;
}

// The cross-section the one swept rung is drawn along, from the ground up: half-width
// as a fraction of the run's own thickness, then height as a fraction of its own height.
// A boundary is read as a silhouette - from above, and from far enough away that no
// detail on it survives - so the shape of that outline is the whole of the job. A wall
// that leans in as it rises reads as something stacked by hand; a rail stays a plank with
// its edges taken off. Both were the same shoebox before, and a shoebox reads as scenery.
//
// There were four. The hedge's outline swelled and drew in at the top, and the wall's
// leaned in as it rose, and both were right about the shape and wrong about the length:
// one outline is one outline however far you extrude it. Both are modelled now, along
// with the fence that took the hedge's old rung - see modelled() below.
const PROFILE = {
  rail: [[0.62, 0], [1, 0.24], [1, 0.82], [0.66, 1]],
};

// A swept run from `a` to `b` along `axis` at world coordinate `fixed - half`,
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
        // pale colour would reach all the way down and the run would read as one flat board.
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
  // out through its far side, which is the one place a run stops looking like a solid thing.
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
  g.setAttribute('aSheet', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(SHEET_INDEX[v.kind] || 0), 1));
  g.setIndex(idx);
  return g;
}

// ---- a run of modelled boundary ---------------------------------------------
// Three of the four rungs are not swept at all. They are the bays baked out of
// assets/fence, assets/hedge and assets/wall - a paling bay, a length of clipped growth,
// eight stones in three courses - laid one to the ground cell, and the reason they are
// models rather than profiles is that a profile can only say one thing. It says it very
// well: a shape that swells and draws in reads as grown, a shape that leans in as it
// rises reads as stacked. What it cannot say is that this cell is not the last one. One
// outline extruded four hundred metres is the same four hundred metres of outline, and
// from the air a hamlet's edge came out looking pressed rather than built.
//
// What a bay cannot do is bend, and the ground it stands on slopes by up to 0.6 across a
// cell. So a model is warped rather than placed: every vertex takes the ground height at
// its own point along the run, which leaves a post upright - its corners share one point
// on the line - and lets a rail, a course or a hedge top lie along the slope, which is
// what all three do. It is the same trick strip() plays with its profile, off the same
// 0.5 sampling, and it is why a bay is exactly one cell long. A bay of any other length
// would leave a stub at the end of every run on the island, and the joints would stop
// landing on the cell corners the gateways are measured from.
//
// Each rung says which bays it is made of, what stands at every joint between two bays,
// and what closes the run where a gateway opens. Only the fence has a joint piece: a
// paling fence is bays hung between posts and the post is a thing you see, where a hedge
// has no joints at all and a wall's are the ones between its own stones. `nominal` is the
// size the set was modelled at - the numbers at the top of each scripts/build-*.py - and
// the run is that model scaled to its own rung of the ramp.
const MODELLED = {
  fence: { bays: 'prop_fence_', joint: 'prop_fencepost', gate: 'prop_fencepost', nominal: { h: 0.41, t: 0.22 } },
  hedge: { bays: 'prop_hedge_', joint: null, gate: null, nominal: { h: 0.50, t: 0.34 } },
  wall: { bays: 'prop_wall_', joint: null, gate: 'prop_wallpier', nominal: { h: 0.54, t: 0.45 } },
};
// The bays are asked for by prefix rather than by name, which is the point of the `_a`,
// `_b` naming in assets/README.md: a third rhythm modelled tomorrow is in the island's
// rotation the moment it is baked, with no line changed here.
const baysOf = (kind) => models.variants(MODELLED[kind].bays);

// One run, from cell `a` to cell `b`: a bay in every gap between whole coordinates, and
// whatever the rung puts at a joint at every one of them. `a === b` draws no bays at all,
// which is the single piece a gateway leaves behind.
//
// Everything lands in one geometry rather than one per piece, because a run of twenty
// cells is forty-one pieces and mergeGeometries is handed the whole boundary at once.
function modelled(terrain, axis, fixed, a, b, v, hue, only = null) {
  const spec = MODELLED[v.kind];
  const bays = only ? [] : baysOf(v.kind);
  if (!only && !bays.length) return null;
  const half = terrain.half;
  const f = fixed - half;
  const sy = (v.h + 0.05) / spec.nominal.h, sx = v.t / spec.nominal.t;

  // The ground under the line the run follows, sampled at the same half unit strip() uses
  // and read between samples. Per vertex would be nine hundred worldHeight calls to the
  // bay; per half unit is two, and the difference is invisible because the terrain itself
  // has no detail finer than the cell.
  const STEP = 0.5;
  const sampled = new Map();
  const sample = (t) => {
    let g = sampled.get(t);
    if (g === undefined) {
      g = terrain.worldHeight(axis === 'x' ? f : t - half, axis === 'x' ? t - half : f);
      sampled.set(t, g);
    }
    return g;
  };
  const groundAt = (along) => {
    const k = along / STEP, i = Math.floor(k), frac = k - i;
    return sample(i * STEP) * (1 - frac) + sample((i + 1) * STEP) * frac;
  };

  const pos = [], col = [], sheet = [];
  const tint = hue == null ? null : tmpColor.setHSL(hue / 360, 0.4, 0.42).clone();
  const c = new THREE.Color();

  // One piece, with its middle at `along` on the run. Every model in every set runs along
  // its own +z and stands across its own x, so a run along the island's z axis takes it as
  // it is while one along x turns it a quarter - a turn and not a mirror, because the
  // island's material is single sided and a mirrored bay is a bay you look straight
  // through.
  const stamp = (asset, along) => {
    // A hand's width of slack on the height, per piece rather than per sample: a bay is
    // rigid and the wobble has to be too, or the boards within one bay would fan.
    const wob = ((hash32(`${v.kind}:${axis}:${fixed}:${along}`) % 100) / 100 - 0.5) * 2 * v.jitter;
    const rise = sy + wob / spec.nominal.h;
    for (const name of models.assetParts(asset)) {
      const part = models.part(name);
      const id = BAKED_SHEET[part.sheet] || 0;
      for (let i = 0; i < part.positions.length; i += 3) {
        const mx = (part.positions[i] + part.at[0]) * sx;
        const my = (part.positions[i + 1] + part.at[1]) * rise;
        const at = along + part.positions[i + 2] + part.at[2];
        const y = groundAt(at) - 0.05 + my;
        if (axis === 'x') pos.push(f + mx, y, at - half);
        else pos.push(at - half, y, f - mx);
        c.setRGB(part.colors[i], part.colors[i + 1], part.colors[i + 2]);
        if (tint) c.lerp(tint, 0.18);
        col.push(c.r, c.g, c.b);
        sheet.push(id);
      }
    }
  };

  for (let i = a; i < b; i++) {
    stamp(bays[hash32(`bay:${v.kind}:${axis}:${fixed}:${i}`) % bays.length], i + 0.5);
  }
  const ends = only || spec.joint;
  if (ends && models.hasAsset(ends)) for (let i = a; i <= b; i++) stamp(ends, i);
  if (!pos.length) return null;

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSheet', new THREE.Float32BufferAttribute(sheet, 1));
  // Indexed, and only because mergeGeometries refuses a mixture: the swept runs and the
  // hewn gateposts both carry an index, and a merge is all of them or none.
  g.setIndex([...Array(pos.length / 3).keys()]);
  return g;
}

// What stands either side of a gateway. A modelled rung that has a piece for it stands
// its own - the fence's post, the wall's pier - so that the gateway plainly is the
// boundary stopping rather than two different things at the end of it. A hedge has no
// such piece and takes the hewn post below, which is what it always had: a gatepost in a
// hedge is a piece of sawn wood, because a hedge cannot hold a gate up by itself.
function gatepost(terrain, axis, fixed, at, v) {
  const spec = MODELLED[v.kind];
  if (spec && spec.gate && models.hasAsset(spec.gate)) {
    return modelled(terrain, axis, fixed, at, at, v, null, spec.gate);
  }
  return post(terrain, axis, fixed, at, v);
}


function post(terrain, axis, fixed, at, v) {
  const half = terrain.half;
  const x = axis === 'x' ? fixed - half : at - half;
  const z = axis === 'x' ? at - half : fixed - half;
  // A gatepost is as stout as the thing it holds up, or the gateway into a walled village
  // would be two twigs either side of the road. Six sides and a foot wider than its head,
  // rather than a box: it stands at the open end of a run that swells and draws in, and a
  // square stake against that reads as scaffolding somebody forgot to take away.
  //
  // Two rungs reach here now, and both of them for the same reason: neither can hold a
  // gate up by itself. A post and rail is hung on posts like these already, and a hedge
  // is a plant. The fence and the wall have a modelled piece each and take that instead
  // - see gatepost() above.
  const w = Math.max(0.17, v.t * 1.05);
  const hp = v.h + 0.22;
  const g = new THREE.CylinderGeometry(w * 0.40, w * 0.52, hp, 6);
  g.translate(x, terrain.worldHeight(x, z) + hp / 2 - 0.05, z);
  const c = tmpColor.setHex(0x6b4a2f);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Sawn wood, whatever it is standing at the end of: this post is cut for the job
  // rather than grown or quarried, which is exactly why the two rungs that can quarry or
  // grow their own no longer come here.
  g.setAttribute('aSheet', new THREE.Float32BufferAttribute(
    new Float32Array(g.attributes.position.count).fill(SHEET.plank), 1));
  // A merge needs every piece to carry the same attributes, and the strips are position,
  // colour and sheet only; normals are computed once over the merged whole.
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

// A field is worked from somewhere, and that is the whole of what was wrong with the
// version of this that rolled a die on all 65k cells: it put 17.8k of them under the
// plough - 57% of the island - in strips of two by three that reached the far coast, with
// no owner, no edge, and nobody within a day's walk to turn them over. From the air it
// read as a quilt laid over the island rather than as the land a village lives off.
//
// What replaces it is a survey. Ground within FIELD_REACH of a door or a road is
// workable and nothing beyond it is; a parcel is anchored on the same lattice the houses
// stand on, so its edges run with the lanes instead of cutting across them; a whole
// furlong of ground shares one ploughing direction, so a neighbourhood of parcels reads
// as one survey rather than as a heap of rectangles; and every parcel keeps a cell of
// turning ground to itself, which is what makes two neighbours read as two fields and
// not as one larger one with a seam down the middle.
// The land within reach that is actually workable - in reach, off the lanes, off the
// plots, off the beach, off the steep - measures 2.4k cells on the live island, and at
// this share the survey tills about half of it: 1.2k cells in some 70 fenced parcels
// against the 17.8k loose cells it replaces. Half is the figure the reference picture
// reads at; the other half is the grass, the headland and the odd corner that tells you
// the fields are fields.
export const FIELD_REACH = 8;       // cells from settled ground that anybody still ploughs
export const FIELD_COVERAGE = 0.75; // share of anchors in reach that a parcel is laid on
const HEADLAND = 1;                // cells of turning ground kept clear around a parcel
const FURLONG = 16;                // cells of countryside that share one ploughing direction
// How much room the square keeps around it. A parcel with paving this close is dropped,
// so the nearest furrow ends four cells out and there are three clear cells of grass
// between the two. Measured on the live island rather than chosen: at three the nearest
// parcel still stands clear, at four the two that close the square in come out, and at
// five a third goes with them that nobody would say was standing against it.
const SQUARE_VERGE = 4;

export function planFields(village, terrain, owner, cleared, { coverage = FIELD_COVERAGE, settled = null, square = null } = {}) {
  // The hook for the day the server surveys the fields itself: `village.fields` arrives
  // in the shape this function returns, so the client draws what it is told rather than
  // guessing, and nothing else in the module has to know which of the two it got.
  const size = terrain.size;
  // Derive the reservation here as well, so previews and server-surveyed fields
  // obey the same rule as world.js. Town land is civic ground, not a garden.
  if (!square) {
    square = new Set();
    const town = village.island?.town;
    if (town?.paved) for (const [x,z] of town.paved) square.add(x+z*size);
    else if (town?.square) {
      const n = town.size || 3;
      for (let z=0;z<n;z++) for (let x=0;x<n;x++)
        square.add(town.square[0]+x+(town.square[1]+z)*size);
    }
  }
  const lat = village.island && village.island.lattice;
  const pitch = (lat && lat.pitch) || 4;
  const ax = lat ? lat.anchor[0] : 0, az = lat ? lat.anchor[1] : 0;
  // Parcels start on the lattice the plots and the lanes are laid out on, so a field's
  // edge runs with the road rather than across it - but on the half step, not the full
  // one. A parcel plus its headland has to repeat on a whole number of anchor steps or
  // the next anchor along falls inside the last parcel's headland and is refused: at the
  // full pitch of four that puts fields on an eight-cell grid, which tills a third of the
  // land within reach and leaves a two-cell weed strip between every pair. The half step
  // keeps every edge parallel to the lanes and at a fixed phase against them, and lets a
  // five-cell field sit six cells from the next - one cell of headland, as intended.
  const step = Math.max(2, pitch >> 1);
  const onLattice = (gx, gz) => ((gx - ax) % step + step) % step === 0 && ((gz - az) % step + step) % step === 0;
  const claimed = new Uint8Array(size * size);
  const patches = [], orchards = [], gardens = [];
  const nearAt = (k) => (settled ? settled.near[k] : NONE);
  const candidate = (gx, gz) => {
    if (gx < 1 || gz < 1 || gx >= size - 1 || gz >= size - 1) return false;
    const k = gx + gz * size;
    if (claimed[k] || cleared.has(k) || owner[k] === TOWN) return false;
    // Apply before choosing a field type: kitchen gardens must leave the same
    // verge as large parcels, including the visible headland and feather.
    if (touchesSquare(gx, gz, 1, 1)) return false;
    // Out of reach of every door and every road: that is where a field stopped being a
    // field and became a pattern on the map.
    if (settled && settled.dist[k] > FIELD_REACH) return false;
    if (!terrain.isLand(gx, gz) || terrain.isBeach(gx, gz)) return false;
    return terrain.slope(gx, gz) < 0.35;
  };
  const fits = (gx, gz, w, d) => {
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!candidate(gx + x, gz + z)) return false;
    return true;
  };
  // The parcel, and the ring of headland around it. The ring is claimed but never tilled
  // and never returned, so the next parcel along cannot start inside it - which is the
  // only thing keeping a gap of grass between two fields. A kitchen garden asks for
  // `ring` 0: inside a hamlet the ground is scarce and a bed of onions needs no headland.
  const take = (gx, gz, w, d, ring) => {
    const cells = [];
    for (let z = -ring; z < d + ring; z++) {
      for (let x = -ring; x < w + ring; x++) {
        const cx = gx + x, cz = gz + z;
        if (cx < 0 || cz < 0 || cx >= size || cz >= size) continue;
        claimed[cx + cz * size] = 1;
        if (x >= 0 && z >= 0 && x < w && z < d) cells.push([cx, cz]);
      }
    }
    return cells;
  };

  // Does this parcel stand against the square? A village opens out where it paves, and a
  // fence and a furrow against the paving close it in: from above the middle of the island
  // then reads as a farmyard rather than as the place everybody crosses. Nothing on the
  // live island actually shares an edge with the paving - the nearest parcel is three cells
  // off it - so the test is not "touching" but "within the verge", and the verge is the one
  // number here that was measured rather than reasoned.
  const touchesSquare = (gx, gz, w, d) => {
    if (!square || !square.size) return false;
    const v = SQUARE_VERGE;
    for (let z = -v; z < d + v; z++) {
      for (let x = -v; x < w + v; x++) {
        const cx = gx + x, cz = gz + z;
        if (cx < 0 || cz < 0 || cx >= size || cz >= size) continue;
        if (square.has(cx + cz * size)) return true;
      }
    }
    return false;
  };

  if (village.fields) {
    const allowed = (p) => {
      if (touchesSquare(p.gx,p.gz,p.w,p.d)) return false;
      for (let z=0;z<p.d;z++) for (let x=0;x<p.w;x++)
        if (owner[p.gx+x+(p.gz+z)*size] === TOWN) return false;
      return true;
    };
    return { ...village.fields,
      patches: (village.fields.patches || []).filter(allowed),
      orchards: (village.fields.orchards || []).filter(allowed),
      gardens: (village.fields.gardens || []).filter(allowed),
    };
  }

  for (let gz = 1; gz < size - 1; gz++) {
    for (let gx = 1; gx < size - 1; gx++) {
      if (!candidate(gx, gz)) continue;
      const k = gx + gz * size;
      // The anchor hash stays per cell rather than per parcel-in-sequence. Candidacy
      // changes as parcels grow and houses are built, and with a sequential generator
      // every field on the island would shuffle on a change anywhere - which would look
      // like a bug in the live update rather than in the noise.
      const h = hash32(`${terrain.seed}:field:${gx},${gz}`);
      // Unsigned shifts throughout. `hash32` fills all 32 bits, so a signed `>>` turns
      // the top half of its range negative and `4 + (h >> 17) % 3` then draws a parcel
      // two cells wide - which is how a survey of four-by-three parcels was quietly
      // coming out at seven cells a piece.
      const roll = (h >>> 10) % 100;
      if (owner[k] === NONE) {
        if (!onLattice(gx, gz)) continue;
        if ((h % 1000) / 1000 > coverage) continue;
        // Long side along x or along z, and the whole furlong agrees. Two adjacent
        // parcels ploughed across each other read as a mistake; a dozen ploughed the same
        // way read as one estate, which is what the reference picture has.
        const alongX = (hash32(`${terrain.seed}:furlong:${Math.floor(gx / FURLONG)},${Math.floor(gz / FURLONG)}`) & 1) === 0;
        const long = 4 + ((h >>> 17) % 3), short = 3 + ((h >>> 19) % 3);
        // Biggest first. Ground in reach is not open country: the lanes run through it,
        // every plot and every boundary keeps a verge, and what is left is pockets. A single
        // size would leave most of those pockets empty and the fields would only ever
        // appear where the land happened to be clear for six cells - so the survey offers
        // the parcel it wanted, then smaller ones, and stops at three by two. Below that a
        // lot is not a field with a fence round it; it is a vegetable bed, and those are
        // gardens.
        let w = 0, d = 0;
        for (const [a, b] of [[long, short], [long - 1, short], [4, 3], [3, 3], [3, 2]]) {
          const tw = alongX ? a : b, td = alongX ? b : a;
          if (fits(gx, gz, tw, td)) { w = tw; d = td; break; }
        }
        if (!w) continue;
        // Countryside: ploughed parcels and orchards, each with a hamlet to answer for it.
        // The ground is claimed either way - `take` first, the question second - so a parcel
        // dropped for standing against the square takes its headland out of the survey with
        // it. Nothing smaller creeps into the gap, and what is left round the paving is grass.
        const cells = take(gx, gz, w, d, HEADLAND);
        if (touchesSquare(gx, gz, w, d)) continue;
        (roll < 76 ? patches : orchards).push({ cells, w, d, gx, gz, owner: nearAt(k) });
      } else {
        // Inside a hamlet, on land nobody has built on: a kitchen garden.
        if (roll < 70 && fits(gx, gz, 1, 2)) gardens.push({ cells: take(gx, gz, 1, 2, 0), gx, gz, w: 1, d: 2, owner: owner[k] });
        else if (fits(gx, gz, 1, 1)) gardens.push({ cells: take(gx, gz, 1, 1, 0), gx, gz, w: 1, d: 1, owner: owner[k] });
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
const FIELD_SHEET = `${TEXTURES}field.png`;
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
  // Each surface carries its whole plot bounds, not its cell bounds: the
  // furrows stay continuous inside a field and only its outside edge fades.
  if (!material.userData.fieldFeather) {
    material.userData.fieldFeather = true;
    material.transparent = true;
    material.depthWrite = false;
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute vec4 fieldBounds; varying vec4 vFieldBounds; varying vec2 vFieldXZ;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvFieldBounds=fieldBounds;vFieldXZ=position.xz;');
      shader.fragmentShader = 'varying vec4 vFieldBounds; varying vec2 vFieldXZ;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
vec2 edge=min(vFieldXZ-vFieldBounds.xy,vFieldBounds.zw-vFieldXZ);
float rag=sin(vFieldXZ.x*7.3+sin(vFieldXZ.y*4.1))*sin(vFieldXZ.y*9.1)*.065
  +sin(vFieldXZ.x*21.0+vFieldXZ.y*17.0)*.025;
float width=min(.55,min(vFieldBounds.z-vFieldBounds.x,vFieldBounds.w-vFieldBounds.y)*.30);
float edgeFade=smoothstep(.015,width,min(edge.x,edge.y)+rag);
diffuseColor.a*=edgeFade;
`);
    };
    material.customProgramCacheKey = () => 'field-soft-edge-v1';
  }
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
// pitch and also the quarter-cell pitch the furrow decals below have always used. Parcels
// are six cells long now rather than four, so the sheet does repeat once across the
// longest of them - which is what a tiled, seamless sheet is for, and it is invisible
// because the UVs are taken in world space rather than per quad.
const FIELD_TEX_UNITS = 4;

// The strip a plough turns on. Every parcel already keeps a cell of ground to itself for
// it - that is what HEADLAND above claims and never tills - but the drawing stopped dead
// at the tilled cells, so a field was a brown rectangle with corners like a cut tile. A
// headland is the one part of a field that is never ploughed and always driven over: it
// is dry, it is paler than the furrows, and it is what gives a field an edge instead of a
// boundary. Drawn as one rounded outline under the tilled cells, which are then inset
// into it - so the soil is the field and the band round it is the turning ground.
const HEADLAND_COL = { earth: 0x9c8a63, dry: 0xa89873 };
const HEADLAND_IN = 0.1;      // how far the tilled cells sit inside the parcel's own edge
// And how far the band reaches out past it. Every parcel already claims a whole cell of
// turning ground on every side and never tills it, so this is the parcel's own land and
// nothing else can be standing on it. Taken from the inside alone the band came out a
// tenth of a unit wide, which at the distance the island is framed from is a line rather
// than a headland.
const HEADLAND_OUT = 0.3;
const HEADLAND_R = 0.5;       // and how round its corners are
const HEADLAND_SEG = 4;
// Whose field it is, mixed into the soil the way the meadow already carries its district
// tint. Two farms whose headlands meet then read as two holdings rather than as one
// larger field with a seam down the middle. Faint, and for the same reason the ground's
// own tint is faint: past about a seventh the hue reads as a category and not as soil.
const OWNER_TINT = 0.12;
const tmpMix = new THREE.Color();
const ownedBy = (hex, owner, hues) => {
  tmpMix.setHex(hex);
  const hue = owner != null && owner >= 0 && hues ? hues[owner] : null;
  if (hue != null) tmpMix.lerp(new THREE.Color().setHSL(hue / 360, 0.3, 0.5), OWNER_TINT);
  return tmpMix.getHex();
};

export function buildFieldDecals(plan, terrain, season, hues = null) {
  const bare = season === 'autumn' || season === 'winter';
  const pal = bare ? STUBBLE : FIELD;
  const head = bare ? HEADLAND_COL.dry : HEADLAND_COL.earth;
  const pos = [], col = [], uv = [], idx = [], bounds = [];
  let plotBounds;
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
      bounds.push(...plotBounds);
      uv.push((alongX ? qx : qz) / FIELD_TEX_UNITS, (alongX ? qz : qx) / FIELD_TEX_UNITS);
    }
    idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
    vi += 4;
  };
  // A rounded outline, fanned from its own middle: the same ring the paving and the yards
  // are drawn on, so nothing on this island has a sharp corner.
  const patch = (x0, z0, x1, z1, r, hex, lift, alongX) => {
    tmpColor.setHex(hex);
    const ring = roundedOutline(x0, z0, x1, z1, r, HEADLAND_SEG);
    const centre = vi;
    const vertex = (qx, qz) => {
      pos.push(qx, terrain.worldHeight(qx, qz) + lift, qz);
      col.push(tmpColor.r, tmpColor.g, tmpColor.b);
      bounds.push(...plotBounds);
      uv.push((alongX ? qx : qz) / FIELD_TEX_UNITS, (alongX ? qz : qx) / FIELD_TEX_UNITS);
    };
    vertex((x0 + x1) / 2, (z0 + z1) / 2);
    for (const [qx, qz] of ring) vertex(qx, qz);
    for (let k = 0; k < ring.length; k++) idx.push(centre, centre + 1 + k, centre + 1 + ((k + 1) % ring.length));
    vi += ring.length + 1;
  };

  // A kitchen garden is a bed of onions, not a field: it asks for no headland (`ring` 0
  // in planFields) and there is no room for one inside a hamlet. It gets the rounded
  // outline all the same, in one piece rather than cell by cell - a one-cell brown square
  // with corners on it, standing next to parcels that have none, is the only thing on the
  // ground that would still look stamped on.
  for (const p of plan.gardens) {
    const [ax, az] = terrain.cellWorld(p.gx, p.gz);
    const [bx, bz] = terrain.cellWorld(p.gx + p.w - 1, p.gz + p.d - 1);
    plotBounds=[ax-.5,az-.5,bx+.5,bz+.5];
    patch(ax - 0.5, az - 0.5, bx + 0.5, bz + 0.5, 0.2, ownedBy(pal.base, p.owner, hues), 0.045, p.w >= p.d);
  }

  for (const p of plan.patches) {
    const alongX = p.w >= p.d;
    // The turning ground first, under everything, as one piece the width of the parcel.
    const [ax, az] = terrain.cellWorld(p.gx, p.gz);
    const [bx, bz] = terrain.cellWorld(p.gx + p.w - 1, p.gz + p.d - 1);
    const o = HEADLAND_OUT;
    plotBounds=[ax-.5-o,az-.5-o,bx+.5+o,bz+.5+o];
    patch(ax - 0.5 - o, az - 0.5 - o, bx + 0.5 + o, bz + 0.5 + o, HEADLAND_R, ownedBy(head, p.owner, hues), 0.04, alongX);
    plotBounds=[ax-.5+HEADLAND_IN,az-.5+HEADLAND_IN,bx+.5-HEADLAND_IN,bz+.5-HEADLAND_IN];
    const base = ownedBy(pal.base, p.owner, hues);
    const furrow = ownedBy(pal.furrow, p.owner, hues);
    for (const [gx, gz] of p.cells) {
      const [x, z] = terrain.cellWorld(gx, gz);
      // Only the cells on the parcel's own edge give ground to the headland. Inset all
      // round and the furrows inside the field would come apart into stamps again.
      const x0 = x - 0.5 + (gx === p.gx ? HEADLAND_IN : 0);
      const x1 = x + 0.5 - (gx === p.gx + p.w - 1 ? HEADLAND_IN : 0);
      const z0 = z - 0.5 + (gz === p.gz ? HEADLAND_IN : 0);
      const z1 = z + 0.5 - (gz === p.gz + p.d - 1 ? HEADLAND_IN : 0);
      quad(x0, z0, x1, z1, base, 0.045, alongX);
    }
    // Furrows along the long axis, half a cell apart - it was a quarter before the sheet.
    // The sheet ploughs the field itself, at sixteen rows to its four units, which is
    // exactly the quarter-cell pitch these lines used to sit at: drawn there they land on
    // rows that are already drawn, and the field comes out striped twice over. At half a
    // cell they stop being the furrows and become the gaps between beds - wide bands over
    // a fine tilth, which is one field rather than two patterns arguing. With no sheet to
    // multiply they are still the only thing that marks a field as ploughed at all.
    //
    // They keep off the headland as well, so the ends of the beds are turning ground and
    // not a set of lines running into the grass.
    const x0 = ax - 0.5, z0 = az - 0.5;
    const end = HEADLAND_IN + 0.08;
    const steps = Math.round((alongX ? p.d : p.w) / 0.5);
    for (let s = 1; s < steps; s++) {
      const o = s * 0.5;
      if (alongX) quad(x0 + end, z0 + o - 0.05, x0 + p.w - end, z0 + o + 0.05, furrow, 0.055, alongX);
      else quad(x0 + o - 0.05, z0 + end, x0 + o + 0.05, z0 + p.d - end, furrow, 0.055, alongX);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('fieldBounds', new THREE.Float32BufferAttribute(bounds, 4));
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
