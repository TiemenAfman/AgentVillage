// What makes a hamlet look like a place: who owns which ground, a hedge along the edge
// of it, and the fields and orchards in between. None of this is transmitted - the wire
// carries one bitstring per parcel row and everything here is derived from it, so the
// picture can never disagree with the plots and the roads it is drawn around.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32 } from 'shared/rng.mjs';

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
const VARIANTS = [
  { kind: 'hedge', h: 0.55, t: 0.20, jitter: 0.06, base: 0x4a6b39, top: 0x5d8347 },
  { kind: 'rail', h: 0.45, t: 0.09, jitter: 0.02, base: 0x6b4a2f, top: 0x7d5a3a },
  { kind: 'wall', h: 0.38, t: 0.26, jitter: 0.11, base: 0x8a857c, top: 0x9a958c },
];
export const variantOf = (id) => VARIANTS[hash32(String(id)) % VARIANTS.length];

export function buildBorders(village, terrain, owner, roadCells) {
  const size = terrain.size;
  const isRoad = (gx, gz) => roadCells.has(gx + gz * size);
  const ownerAt = (gx, gz) => (gx < 0 || gz < 0 || gx >= size || gz >= size ? NONE : owner[gx + gz * size]);

  // One run per (owner, orientation, fixed coordinate): collect, then split on gaps.
  const runs = new Map();
  const posts = [];
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const k = ownerAt(gx, gz);
      if (k === NONE) continue;
      for (const [dx, dz] of N4) {
        const nx = gx + dx, nz = gz + dz;
        if (ownerAt(nx, nz) === k) continue;
        // Two owners meeting would draw the hedge twice; the lower index draws it.
        const no = ownerAt(nx, nz);
        if (no !== NONE && no < k) continue;
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
    const v = variantOf(run.k === TOWN ? 'town' : (village.districts[run.k] || {}).id || 'x');
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
    const v = variantOf(k === TOWN ? 'town' : (village.districts[k] || {}).id || 'x');
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

// A length of hedge from `a` to `b` along `axis` at world coordinate `fixed - half`,
// following the ground. Two side walls and a capping strip, so it reads as a solid thing
// from any angle without needing a double-sided material.
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
  let vi = 0;
  for (let s = 0; s <= n; s++) {
    const alongW = a - half + (b - a) * (s / n);
    const jx = axis === 'x' ? f : alongW;
    const jz = axis === 'x' ? alongW : f;
    const g = terrain.worldHeight(jx, jz);
    const wob = ((hash32(`${v.kind}:${Math.round(jx * 2)}:${Math.round(jz * 2)}`) % 100) / 100 - 0.5) * 2 * v.jitter;
    const h = g + v.h + wob;
    // four corners: near/far side, ground and ridge
    const nearX = axis === 'x' ? f - t : jx, nearZ = axis === 'x' ? jz : f - t;
    const farX = axis === 'x' ? f + t : jx, farZ = axis === 'x' ? jz : f + t;
    pos.push(nearX, g - 0.05, nearZ, nearX, h, nearZ, farX, g - 0.05, farZ, farX, h, farZ);
    for (const c of [base, top, base, top]) col.push(c.r, c.g, c.b);
    if (s > 0) {
      const p = vi - 4;
      idx.push(p, p + 1, vi, vi, p + 1, vi + 1);                   // near wall
      idx.push(p + 2, vi + 2, p + 3, p + 3, vi + 2, vi + 3);       // far wall
      idx.push(p + 1, p + 3, vi + 1, vi + 1, p + 3, vi + 3);       // ridge
    }
    vi += 4;
  }
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
  const g = new THREE.BoxGeometry(0.13, v.h + 0.18, 0.13);
  g.translate(x, terrain.worldHeight(x, z) + (v.h + 0.18) / 2 - 0.05, z);
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

// The tilled ground itself, as one merged decal - the same trick `buildPaths` uses, so it
// hugs the terrain and never z-fights with it.
export function buildFieldDecals(plan, terrain, season) {
  const pal = season === 'autumn' || season === 'winter' ? STUBBLE : FIELD;
  const pos = [], col = [], idx = [];
  let vi = 0;
  const quad = (x0, z0, x1, z1, hex, lift) => {
    tmpColor.setHex(hex);
    for (const [qx, qz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      pos.push(qx, terrain.worldHeight(qx, qz) + lift, qz);
      col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
    vi += 4;
  };

  for (const p of [...plan.patches, ...plan.gardens]) {
    for (const [gx, gz] of p.cells) {
      const [x, z] = terrain.cellWorld(gx, gz);
      quad(x - 0.5, z - 0.5, x + 0.5, z + 0.5, pal.base, 0.045);
    }
    // Furrows along the long axis, a quarter of a cell apart.
    const alongX = p.w >= p.d;
    const [ox, oz] = terrain.cellWorld(p.gx, p.gz);
    const x0 = ox - 0.5, z0 = oz - 0.5;
    const steps = Math.round((alongX ? p.d : p.w) / 0.25);
    for (let s = 1; s < steps; s++) {
      const o = s * 0.25;
      if (alongX) quad(x0 + 0.08, z0 + o - 0.05, x0 + p.w - 0.08, z0 + o + 0.05, pal.furrow, 0.055);
      else quad(x0 + o - 0.05, z0 + 0.08, x0 + o + 0.05, z0 + p.d - 0.08, pal.furrow, 0.055);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
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
