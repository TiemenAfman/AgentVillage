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
      const g = strip(terrain, run.axis, run.fixed, start, prev + 1, run.v, run.hue);
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
      const g = post(terrain, e.axis, e.fixed, end, v);
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
// Three surfaces on one mesh, done the way buildings.js does it rather than the obvious
// way: a sheet index carried per vertex and one branch in the fragment shader. Every
// hedge, fence and wall on the island goes into a single mergeGeometries - that is what
// keeps the whole lot to one draw call - and material groups would cut that back up into
// three, one per kind, for no gain at all.
//
// There is no uv anywhere on a boundary either. A run is a swept profile and a gatepost
// is a cylinder, and the two merge into one loaf, so the sheet is projected from the
// three axes at once and blended by how far the face turns towards each. That turns out
// to be exactly what a fence wants, for nothing: the flank of a run has a normal across
// the run, so the projection it takes is the one whose boards lie along it. A fence
// going east-west gets its grain going east-west without being told which way it faces.
//
// The wall takes the stacked stone the plinths already use and the rail takes the sawn
// boards off the decking - both were drawn for this kind of job. Only the hedge needed a
// sheet of its own, because nothing on the island was leaves at hedge scale.
const TEXTURES = 'textures/';
const SHEET_INDEX = { hedge: 1, rail: 2, wall: 3 };
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
    // the boundary always had - grain rather than gloom, and no risk of a hedge turning
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
  g.setAttribute('aSheet', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(SHEET_INDEX[v.kind] || 0), 1));
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
  // A gatepost stands in the run's own material, so it takes the run's own sheet: a post
  // in a dry stone wall is a standing stone and one in a hedge is a piece of sawn wood.
  g.setAttribute('aSheet', new THREE.Float32BufferAttribute(
    new Float32Array(g.attributes.position.count).fill(SHEET_INDEX[v.kind === 'wall' ? 'wall' : 'rail']), 1));
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

export function planFields(village, terrain, owner, cleared, { coverage = FIELD_COVERAGE, settled = null } = {}) {
  // The hook for the day the server surveys the fields itself: `village.fields` arrives
  // in the shape this function returns, so the client draws what it is told rather than
  // guessing, and nothing else in the module has to know which of the two it got.
  if (village.fields) return village.fields;

  const size = terrain.size;
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
    if (claimed[k] || cleared.has(k)) return false;
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
        // every plot and every hedge keeps a verge, and what is left is pockets. A single
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
        const lot = { cells: take(gx, gz, w, d, HEADLAND), w, d, gx, gz, owner: nearAt(k) };
        (roll < 76 ? patches : orchards).push(lot);
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
