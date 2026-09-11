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

const NEAR = 150;
const FAR = 190;
// The haze has to know where they lie, or it starts before they do - see applyNeighbours
// in main.js. One ring, named once.
export const RING = { near: NEAR, far: FAR };
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

export function createHorizon({ scene, pickables }) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, fog: true,
  });
  // A lit window in the dark, so you can tell somebody is home at night.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, transparent: true, opacity: 0 });
  const lampGeo = new THREE.SphereGeometry(0.9, 8, 6);

  const islands = new Map();   // id -> { group, mesh, lamp, info, x, z, top }

  function place(info) {
    const h = hash32(info.id);
    const angle = (h / 4294967296) * Math.PI * 2;
    const dist = NEAR + ((h >>> 16) % (FAR - NEAR));
    const x = Math.sin(angle) * dist;
    const z = Math.cos(angle) * dist;

    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = ((h >>> 8) % 360) * Math.PI / 180;   // not all facing the same way

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
    islands.set(info.id, { group, mesh, lamp, info, x, z, top });
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
    count: () => islands.size,
    dispose: () => {
      for (const id of [...islands.keys()]) remove(id);
      material.dispose();
      lampGeo.dispose();
      lampMat.dispose();
    },
  };
}
