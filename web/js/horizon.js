// The neighbours: other people's islands, lying out on the water where you can see them.
//
// Nothing is invented and nothing is fetched. Their beacon carries a seed and a grid
// size, and shared/terrain.mjs makes the same land from the same numbers in Node and in
// the browser - so this draws their island's true shape without ever asking them for it.
// Which bearing they lie on comes from a hash of their id, so a neighbour is always in
// the same direction: you learn where to look for them.
import * as THREE from 'three';
import { makeTerrain } from 'shared/terrain.mjs';
import { hash32 } from 'shared/rng.mjs';

// How far out a neighbour lies, measured from the water between the two islands rather
// than written down flat. It used to be a fixed 150 to 190 units, which was fine when
// every island was sixty-four cells across and wrong the moment they were not: a
// two-hundred-and-fifty-six cell neighbour has a radius of a hundred and twenty-eight, so
// at 150 its coast came ashore inside ours and the two islands shared a beach. So each
// one gets its own distance - our radius, plus theirs, plus a stretch of open sea - and
// they cannot overlap us however big they are.
const GAP = 60;              // open water between the two coasts, at the nearest neighbour
const SPREAD = 40;           // and how much further out than that the rest are scattered
const OWN_HALF = 64;         // our own radius, until the page tells us otherwise
// The haze has to know where they lie, or it starts before they do - see applyFogRange in
// main.js. Live rather than constant, because the ring is no longer one distance: `near`
// is the nearest neighbour's coast and `far` the far side of the outermost one, and both
// are known only once they have been placed. main.js reads it straight after `apply`.
export const RING = { near: OWN_HALF + GAP, far: OWN_HALF + GAP + SPREAD };
// Every other cell. Out here the silhouette is all that survives the haze, and half the
// triangles draw it just as well.
const STEP = 2;

const SAND = new THREE.Color(0xd8c9a2);
const GRASS = new THREE.Color(0x6f8a4e);
const ROCK = new THREE.Color(0x8a8577);

function islandGeometry(seed, size) {
  const terrain = makeTerrain(seed, { size });
  const half = size / 2;
  const n = Math.floor(size / STEP) + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const height = new Float32Array(n * n);
  const c = new THREE.Color();

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * STEP;
      const z = -half + j * STEP;
      const h = terrain.worldHeight(x, z);
      // The seabed is not drawn, but the coast has to end somewhere: anything below the
      // waterline is pulled just under it, so the sea closes over the edge instead of
      // leaving a cut.
      const y = Math.max(h, -0.4);
      const k = (j * n + i) * 3;
      height[j * n + i] = h;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      if (h < 0.35) c.copy(SAND);
      else if (h > 3.4) c.copy(ROCK);
      else c.copy(GRASS).lerp(ROCK, Math.min(1, (h - 0.35) / 5));
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }

  // Only the quads that touch land. Without this the whole square grid is drawn and the
  // island arrives as a raft: a flat sheet of sand out to the corners of its own map.
  const idx = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
      if (height[a] < 0 && height[b] < 0 && height[d] < 0 && height[e] < 0) continue;
      idx.push(a, d, b, b, d, e);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// `half` is this island's own radius - `terrain.half`. It is optional because the ring
// only needs it to keep a neighbour off our coast, and an island that has not said how
// big it is gets the default above; pass it and the ring is exact.
export function createHorizon({ scene, pickables, half = OWN_HALF }) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, fog: true,
  });
  // A lit window in the dark, so you can tell somebody is home at night.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, transparent: true, opacity: 0 });
  const lampGeo = new THREE.SphereGeometry(0.9, 8, 6);

  const islands = new Map();   // id -> { group, mesh, lamp, info, x, z, top }
  // Islands that are not out on the ring but at a real berth: an island somebody has
  // joined, which lies where shared/regions.mjs says it lies. Two things go with being
  // pinned. The hashed bearing is not used, because a berth is a decision rather than a
  // hash; and the hashed rotation is not either, because the island is walkable now and its
  // own coordinates have to mean what layout.json says they mean - a village turned nine
  // degrees is a village whose houses are not where its plots are.
  const pins = new Map();      // id -> [ox, oz]

  function place(info) {
    const h = hash32(info.id);
    const theirs = (info.gridSize || 64) / 2;
    const pinned = pins.get(info.id) || null;
    let x, z;
    if (pinned) {
      x = pinned[0]; z = pinned[1];
    } else {
      const angle = (h / 4294967296) * Math.PI * 2;
      const dist = half + theirs + GAP + ((h >>> 16) % SPREAD);
      x = Math.sin(angle) * dist;
      z = Math.cos(angle) * dist;
    }

    const group = new THREE.Group();
    group.position.set(x, 0, z);
    if (!pinned) group.rotation.y = ((h >>> 8) % 360) * Math.PI / 180;   // not all facing the same way

    const geo = islandGeometry(info.seed, info.gridSize);
    const mesh = new THREE.Mesh(geo, material);
    mesh.userData.id = `neighbour:${info.id}`;              // so the existing picking finds it
    group.add(mesh);

    const lamp = new THREE.Mesh(lampGeo, lampMat.clone());
    geo.computeBoundingBox();
    const top = geo.boundingBox.max.y;
    lamp.position.set(0, top + 0.6, 0);
    group.add(lamp);

    scene.add(group);
    pickables.push(mesh);
    const dist = Math.sqrt(x * x + z * z);
    islands.set(info.id, { group, mesh, lamp, info, x, z, top, dist, radius: theirs, pinned: !!pinned });
  }

  // Put an island at a berth instead of out on the ring, or take the pin away again. Safe
  // to call before the island has arrived: the pin is remembered and `place` reads it.
  function pin(id, origin) {
    if (origin) pins.set(id, [origin[0], origin[1]]); else pins.delete(id);
    const it = islands.get(id);
    if (it) {
      // Rebuilt rather than moved, because unpinning has to give the hashed rotation back
      // and there is nowhere to keep the old one. There are at most a handful of these.
      const info = it.info;
      remove(id);
      place(info);
    }
    measureRing();
  }

  // Where the neighbours actually lie, now that they are placed: the nearest coast and
  // the far side of the outermost island. The haze is held off until past this, so it has
  // to be the truth about this island's neighbours rather than a number from the file.
  function measureRing() {
    let near = Infinity, far = -Infinity;
    for (const it of islands.values()) {
      // A pinned island is not on the ring, and the haze does not learn its distance from
      // here: it is a region now, and main.js measures the archipelago it belongs to. Left
      // in, it would drag the fog out to a berth even when the ring itself is empty.
      if (it.pinned) continue;
      near = Math.min(near, it.dist - it.radius);
      far = Math.max(far, it.dist + it.radius);
    }
    RING.near = Number.isFinite(near) ? near : half + GAP;
    RING.far = Number.isFinite(far) ? far : half + GAP + SPREAD;
  }

  function remove(id) {
    const it = islands.get(id);
    if (!it) return;
    const i = pickables.indexOf(it.mesh);
    if (i >= 0) pickables.splice(i, 1);
    scene.remove(it.group);
    it.mesh.geometry.dispose();
    it.lamp.material.dispose();
    islands.delete(id);
  }

  // The whole list, every time: whoever is not in it has gone home.
  function apply(list) {
    const wanted = new Set();
    const arrived = [];
    for (const info of list || []) {
      wanted.add(info.id);
      if (islands.has(info.id)) {
        islands.get(info.id).info = info;   // a rename costs nothing
      } else {
        place(info);
        arrived.push(info);
      }
    }
    for (const id of [...islands.keys()]) if (!wanted.has(id)) remove(id);
    measureRing();
    return arrived;
  }

  function update(_dt, night = 0) {
    for (const it of islands.values()) it.lamp.material.opacity = night * 0.9;
  }

  // What the labels need: where each island sits and how high its name should float.
  function marks() {
    return [...islands.values()].map((it) => ({
      id: it.info.id,
      name: it.info.name,
      island: it.info.island,
      settlers: it.info.settlers,
      dev: it.info.dev || null,
      url: it.info.url,
      x: it.x,
      z: it.z,
      y: it.top + 2.5,
    }));
  }

  function find(id) {
    const it = islands.get(String(id).replace(/^neighbour:/, ''));
    return it ? { ...it.info, x: it.x, z: it.z } : null;
  }

  return {
    apply,
    update,
    marks,
    find,
    pin,
    remove,
    count: () => islands.size,
    // How many are still out on the ring. What the haze cares about: a pinned island is a
    // place you can look at, not a rumour on the horizon.
    ringCount: () => [...islands.values()].filter((it) => !it.pinned).length,
    dispose: () => {
      for (const id of [...islands.keys()]) remove(id);
      material.dispose();
      lampGeo.dispose();
      lampMat.dispose();
    },
  };
}
