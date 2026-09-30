// What the treasure hunt looks like on the ground (web/js/treasure.js decides; this draws):
// the bottle on the beach, the statue half in the sand or lying out of it, an X for a chest and
// the chest that comes up out of it, the heap beside a hole, and the sand thrown from the shovel.
//
// Everything is in scene coordinates and hangs in one group. The shapes are the island's own
// building material, so they light, fog and shadow like everything else: the statue and the heap
// are the baked `prop_treasure_carry` and `prop_treasure_mound` (assets/treasure), the bottle, the
// X and the chest are boxes and cylinders - nothing worth a bake, and a chest has no page of its
// own in the Blender set.
//
// Nothing here decides anything: a site the controller no longer lists fades out, one it lists
// again at another stage moves to it (a statue rises out of the sand over RISE_S).
import * as THREE from 'three';
import * as models from './models.js';
import { box, cylinder, sphere, meshAsset, mergeParts } from './buildings.js';
import { registerCargo } from './boat.js';

export const RISE_S = 0.6;       // a statue or a chest coming out of the sand
const FADE_S = 0.4;              // a thing leaving
const HEAP_KEEP_S = 60;          // a heap beside a finished hole, before the wind has it
// The baked statue is 0.22 tall; in the sand it is a monument, in the arms it is what you carry.
const STATUE_HEIGHT = 0.22;
const STATUE_SCALE = 2.5;
const BURIED_SINK = 0.45;        // the share of her that is under the sand before the dig
const LYING_SINK = 0.12;         // and after it: her feet are still in the ground
const MOUND_SCALE = 3;            // the heap a dig throws up
const FOOT_MOUND = 1.9;          // the low ring of sand round her feet: any more and it hides her

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// ---- shapes ------------------------------------------------------------------------------------

// A fresh geometry every call: whoever takes it owns it (a boat's cargo gives its geometry back).
function baked(asset, fallback) {
  if (models.hasAsset(asset)) return mergeParts(meshAsset(asset));
  return mergeParts(fallback());
}
export const statueGeometry = () => baked('prop_treasure_carry', () => [
  box(0.16, 0.05, 0.12, 0x6b4a2f, { y: 0.025 }),
  box(0.1, 0.12, 0.08, 0xd9a33d, { y: 0.11 }),
  sphere(0.04, 0xd9a33d, { y: 0.2 }),
]);
export const moundGeometry = () => baked('prop_treasure_mound', () => [
  cylinder(0.12, 0.19, 0.06, 8, 0xd8c690, { y: 0.03 }),
]);

// A bottle lying on its side, neck to the east: green glass, a cork and a red seal. About 0.3
// long, which is more than a bottle is beside a settler and exactly as much as a bottle on a
// beach has to be to be seen from the water.
export function bottleGeometry() {
  const GLASS = 0x6fb8a2, GLASS_DARK = 0x4f9683, CORK = 0x9a6b3f, WAX = 0xb3302a;
  const lie = { rz: Math.PI / 2 };
  return mergeParts([
    cylinder(0.06, 0.06, 0.17, 8, GLASS, { ...lie, x: -0.03, y: 0.06 }),
    cylinder(0.03, 0.055, 0.06, 8, GLASS_DARK, { ...lie, x: 0.095, y: 0.06 }),
    cylinder(0.025, 0.025, 0.07, 8, GLASS, { ...lie, x: 0.15, y: 0.06 }),
    cylinder(0.03, 0.03, 0.04, 8, CORK, { ...lie, x: 0.205, y: 0.06 }),
    sphere(0.022, WAX, { x: 0.232, y: 0.06 }),
  ]);
}

// The X that marks a chest's spot: two planks laid across each other on the sand.
export function crossGeometry() {
  const PLANK = 0x8c2d24;
  return mergeParts([
    box(0.75, 0.025, 0.09, PLANK, { ry: Math.PI / 4, y: 0.015 }),
    box(0.75, 0.025, 0.09, PLANK, { ry: -Math.PI / 4, y: 0.016 }),
  ]);
}

// A sea chest: oak body, a lid, two iron straps and a brass lock.
export function chestGeometry() {
  const OAK = 0x7a4f2a, LID = 0x8a5a30, IRON = 0x3b3d44, BRASS = 0xd9b44a;
  return mergeParts([
    box(0.36, 0.17, 0.24, OAK, { y: 0.085 }),
    box(0.37, 0.07, 0.25, LID, { y: 0.205 }),
    box(0.04, 0.24, 0.26, IRON, { x: -0.11, y: 0.12 }),
    box(0.04, 0.24, 0.26, IRON, { x: 0.11, y: 0.12 }),
    box(0.05, 0.06, 0.03, BRASS, { y: 0.17, z: 0.125 }),
  ]);
}

// What a boat carries when the statue lies on her deck (boat.js registerCargo): the same baked
// figure as in the arms, one to one. Called once at boot.
export function registerStatueCargo() {
  registerCargo('statue', (material) => {
    const m = new THREE.Mesh(statueGeometry(), material);
    m.castShadow = true;
    m.userData.ownsGeometry = true;
    return m;
  });
}

// ---- the dust ----------------------------------------------------------------------------------

// A ring of sand grains in one Points object, like the bubbles in sea-life.js: a dead grain is
// parked far away and a new one takes the next slot, so a full pool drops its oldest. The
// physics is a plain class-less function so a test can step it without a GPU.
export function createGrains(cap = 96) {
  const pos = new Float32Array(cap * 3).fill(-9999);
  const vel = new Float32Array(cap * 3);
  const age = new Float32Array(cap).fill(Infinity);
  const life = new Float32Array(cap).fill(1);
  let next = 0;
  return {
    pos,
    // `n` grains thrown up and outwards from (x, y, z).
    burst(x, y, z, n = 10) {
      for (let k = 0; k < n; k++) {
        const i = next; next = (next + 1) % cap;
        const a = Math.random() * Math.PI * 2, s = 0.25 + Math.random() * 0.55;
        pos[i * 3] = x + (Math.random() - 0.5) * 0.12;
        pos[i * 3 + 1] = y + 0.04;
        pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.12;
        vel[i * 3] = Math.cos(a) * s;
        vel[i * 3 + 1] = 0.9 + Math.random() * 0.9;
        vel[i * 3 + 2] = Math.sin(a) * s;
        age[i] = 0;
        life[i] = 0.5 + Math.random() * 0.4;
      }
    },
    step(dt) {
      for (let i = 0; i < cap; i++) {
        if (age[i] === Infinity) continue;
        age[i] += dt;
        if (age[i] >= life[i]) { age[i] = Infinity; pos[i * 3 + 1] = -9999; continue; }
        vel[i * 3 + 1] -= 4.2 * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
    },
    alive: () => age.reduce((n, a) => n + (a === Infinity ? 0 : 1), 0),
  };
}

function grainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(8, 8, 7, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- the view ----------------------------------------------------------------------------------

// `material` is the island's building material.
export function createTreasureView({ scene, material }) {
  const group = new THREE.Group();
  group.name = 'treasure';
  scene.add(group);
  const geos = [];
  const own = (g) => { geos.push(g); return g; };
  const shapes = {
    statue: own(statueGeometry()), mound: own(moundGeometry()), bottle: own(bottleGeometry()),
    cross: own(crossGeometry()), chest: own(chestGeometry()),
  };
  const solid = (geo) => {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // id -> { group, parts, want: {x,y,z,rot,stage}, t: tween 0..1 of the current stage change,
  //         from, leaving: seconds left or null }
  const entries = new Map();

  function makeEntry(site) {
    const g = new THREE.Group();
    const parts = {};
    if (site.kind === 'statue') {
      parts.mound = solid(shapes.mound);
      parts.mound.scale.setScalar(FOOT_MOUND);
      parts.body = solid(shapes.statue);
      parts.body.scale.setScalar(STATUE_SCALE);
      g.add(parts.mound, parts.body);
    } else if (site.kind === 'bottle') {
      parts.body = solid(shapes.bottle);
      parts.body.scale.setScalar(1.5);
      g.add(parts.body);
    } else {
      parts.cross = solid(shapes.cross);
      parts.body = solid(shapes.chest);
      g.add(parts.cross, parts.body);
    }
    group.add(g);
    return { group: g, parts, kind: site.kind, stage: null, from: 0, to: 0, t: 1, leaving: null };
  }

  // How far up out of the ground each stage stands, 0 (buried) to 1 (out).
  const levelOf = (kind, stage) => (kind === 'statue' ? (stage === 'unearthed' ? 1 : 0)
    : kind === 'chest' ? (stage === 'open' ? 1 : 0) : 1);

  function pose(e, k) {
    const { parts, kind } = e;
    if (kind === 'statue') {
      const sink = (BURIED_SINK + (LYING_SINK - BURIED_SINK) * k) * STATUE_HEIGHT * STATUE_SCALE;
      parts.body.position.y = -sink;
    } else if (kind === 'chest') {
      // Buried, the chest is under the X; coming up it clears the sand.
      parts.body.visible = k > 0.001;
      parts.body.position.y = -0.3 * (1 - k);
      parts.cross.visible = k < 0.999;
    }
  }

  // One list of what stands on the islets: [{ id, kind: 'statue' | 'chest', stage, x, y, z, rot }].
  function setSites(list) {
    const seen = new Set();
    for (const site of list) {
      seen.add(site.id);
      let e = entries.get(site.id);
      const fresh = !e;
      if (fresh) { e = makeEntry(site); entries.set(site.id, e); }
      if (e.leaving != null) { e.leaving = null; e.group.scale.setScalar(1); }
      e.group.visible = true;
      e.group.position.set(site.x, site.y, site.z);
      e.group.rotation.y = site.rot || 0;
      const level = levelOf(site.kind, site.stage);
      if (fresh) { e.from = e.to = level; e.t = 1; pose(e, level); }
      else if (level !== e.to) { e.from = e.t >= 1 ? e.to : e.from + (e.to - e.from) * ease(e.t); e.to = level; e.t = 0; }
      e.stage = site.stage;
    }
    for (const [id, e] of entries) if (!seen.has(id) && !id.startsWith('bottle:') && e.leaving == null) e.leaving = FADE_S;
  }

  // The day's bottle, or none. Keyed by its own id, so a new day's bottle is a new entry.
  function setBottle(b) {
    const want = b ? `bottle:${b.id}` : null;
    if (b && !entries.has(want)) {
      const e = makeEntry({ kind: 'bottle' });
      entries.set(want, e);
      e.group.position.set(b.x, b.y, b.z);
      e.group.rotation.y = (b.cell[0] * 7 + b.cell[1] * 13) % 6.28;
    }
    for (const [id, e] of entries) if (id.startsWith('bottle:') && id !== want && e.leaving == null) e.leaving = FADE_S;
  }

  // ---- the heap and the sand ----
  const heap = { mesh: null, k: 0, want: 0 };
  const kept = [];   // heaps left beside finished holes: { mesh, left }
  function heapMesh() {
    const m = solid(shapes.mound);
    m.visible = false;
    group.add(m);
    return m;
  }
  // The heap beside the hole a dig is making, grown to `k` (0..1) - or none. Eased in update().
  function setMound(at, k) {
    if (!at) { heap.want = 0; return; }
    if (!heap.mesh) heap.mesh = heapMesh();
    heap.mesh.position.set(at.x, at.y - 0.01, at.z);
    heap.want = k;
  }
  // The dig ended well: the heap stays where it is, and a new dig starts a fresh one.
  function keepMound() {
    if (!heap.mesh) return;
    kept.push({ mesh: heap.mesh, left: HEAP_KEEP_S });
    heap.mesh = null;
    heap.k = 0;
    heap.want = 0;
  }

  const grains = createGrains();
  const grainGeo = new THREE.BufferGeometry();
  grainGeo.setAttribute('position', new THREE.BufferAttribute(grains.pos, 3));
  const grainTex = grainTexture();
  const grainMat = new THREE.PointsMaterial({
    size: 0.07, sizeAttenuation: true, map: grainTex, transparent: true, opacity: 0.95,
    depthWrite: false, color: 0xd8c690, fog: true,
  });
  const points = new THREE.Points(grainGeo, grainMat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  group.add(points);

  function update(dt) {
    for (const [id, e] of entries) {
      if (e.leaving != null) {
        e.leaving -= dt;
        const s = Math.max(0, e.leaving / FADE_S);
        e.group.scale.setScalar(Math.max(s, 1e-4));
        if (e.leaving <= 0) { group.remove(e.group); entries.delete(id); }
        continue;
      }
      if (e.t < 1) {
        e.t = Math.min(1, e.t + dt / RISE_S);
        pose(e, e.from + (e.to - e.from) * ease(e.t));
      }
    }
    // The heap follows the dig's progress a touch behind it, so it swells rather than jumps.
    if (heap.mesh) {
      heap.k += (heap.want - heap.k) * Math.min(1, dt * 8);
      if (heap.want === 0 && heap.k < 0.01) { heap.mesh.visible = false; heap.k = 0; }
      else { heap.mesh.visible = true; heap.mesh.scale.set(MOUND_SCALE * (0.25 + 0.75 * heap.k), MOUND_SCALE * heap.k + 0.01, MOUND_SCALE * (0.25 + 0.75 * heap.k)); }
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      kept[i].left -= dt;
      if (kept[i].left <= 0) { group.remove(kept[i].mesh); kept.splice(i, 1); continue; }
      if (kept[i].left < 3) kept[i].mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 0.8));
    }
    grains.step(dt);
    grainGeo.attributes.position.needsUpdate = true;
  }

  function dispose() {
    scene.remove(group);
    for (const g of geos) g.dispose();
    grainGeo.dispose();
    grainMat.dispose();
    grainTex.dispose();
  }

  return {
    group, setSites, setBottle, setMound, keepMound, update, dispose,
    dust: (x, y, z, n) => grains.burst(x, y, z, n),
    grains: () => grains.alive(),
    // For tests and the browser console: what stands where, by id.
    entries: () => new Map(entries),
  };
}
