// The little people. One instanced mesh per style, so three hundred of them cost
// five draw calls. Movement is all sine waves and lerps: no skeletons, no physics.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, box, cylinder, cone, sphere, dome } from './buildings.js';
import { makeRng, hash32, clamp } from 'shared/rng.mjs';

const tmpObj = new THREE.Object3D();
const SKIN = 0xf1c9a5;
const CAPACITY = 420;

export function figureGeometry(style, { sailor = false } = {}) {
  const pal = PALETTE[style] || PALETTE.unknown;
  const parts = [];
  const body = new THREE.CapsuleGeometry(0.092, 0.19, 3, 7);
  body.translate(0, 0.2, 0);
  parts.push(paintGeo(body, pal.wall));
  parts.push(box(0.042, 0.12, 0.042, pal.trim, { x: -0.055, y: 0 }));
  parts.push(box(0.042, 0.12, 0.042, pal.trim, { x: 0.055, y: 0 }));
  parts.push(box(0.032, 0.032, 0.032, pal.trim, { x: -0.1, y: 0.24 }));
  parts.push(box(0.032, 0.032, 0.032, pal.trim, { x: 0.1, y: 0.24 }));
  parts.push(sphere(0.076, SKIN, { y: 0.37 }));
  if (sailor) {
    parts.push(cylinder(0.082, 0.086, 0.052, 8, 0x2b4c7e, { y: 0.41 }));
    parts.push(box(0.14, 0.022, 0.065, 0x2b4c7e, { y: 0.418, z: 0.065 }));
  } else if (style === 'fable') {
    parts.push(cone(0.1, 0.21, 6, pal.accent, { y: 0.41 }));
  } else if (style === 'opus') {
    parts.push(cylinder(0.092, 0.092, 0.042, 8, pal.roof, { y: 0.41 }));
    parts.push(box(0.13, 0.022, 0.075, pal.roof, { y: 0.418, z: 0.065 }));
  } else if (style === 'sonnet') {
    parts.push(dome(0.09, pal.roof, { y: 0.39 }));
  } else if (style === 'haiku') {
    parts.push(cylinder(0.135, 0.135, 0.02, 9, pal.roof, { y: 0.42 }));
    parts.push(cone(0.078, 0.058, 8, pal.roof, { y: 0.43 }));
  } else {
    parts.push(cylinder(0.086, 0.086, 0.047, 7, pal.trim, { y: 0.41 }));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

function paintGeo(g, hex) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const flat = g.index ? g.toNonIndexed() : g;
  const n = flat.attributes.position.count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3), emi = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.setAttribute('aEmissive', new THREE.BufferAttribute(emi, 1));
  return flat;
}

// 4-neighbour A* over the cell grid, used when a settler walks in from the beach.
function findPath(terrain, from, to, blocked) {
  const size = terrain.size;
  const key = (x, z) => x + z * size;
  const open = [[0, key(from[0], from[1])]];
  const g = new Map([[key(from[0], from[1]), 0]]);
  const prev = new Map();
  const goal = key(to[0], to[1]);
  let guard = 0;
  while (open.length && guard++ < 12000) {
    open.sort((a, b) => a[0] - b[0]);
    const [, cur] = open.shift();
    if (cur === goal) break;
    const cx = cur % size, cz = (cur - (cur % size)) / size;
    for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      if (!terrain.isLand(nx, nz)) continue;
      const k = key(nx, nz);
      if (blocked && blocked.has(k) && k !== goal) continue;
      const cost = (g.get(cur) || 0) + 1 + 4 * terrain.slope(nx, nz);
      if (g.has(k) && g.get(k) <= cost) continue;
      g.set(k, cost);
      prev.set(k, cur);
      open.push([cost + Math.abs(nx - to[0]) + Math.abs(nz - to[1]), k]);
    }
  }
  if (!prev.has(goal) && key(from[0], from[1]) !== goal) return null;
  const out = [];
  for (let k = goal; k !== undefined; k = prev.get(k)) {
    out.push(terrain.cellWorld(k % size, (k - (k % size)) / size));
    if (k === key(from[0], from[1])) break;
  }
  return out.reverse();
}

export function createSettlers(scene, material, terrain) {
  const styles = ['fable', 'opus', 'sonnet', 'haiku', 'unknown'];
  const meshes = {};
  for (const s of styles) {
    for (const kind of ['adult', 'apprentice', 'sailor']) {
      const geo = figureGeometry(s, { sailor: kind === 'sailor' });
      if (kind === 'apprentice') geo.scale(0.62, 0.62, 0.62);
      const m = new THREE.InstancedMesh(geo, material, CAPACITY);
      m.castShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
      meshes[`${s}:${kind}`] = { mesh: m, slots: 0 };
    }
  }
  const hammerGeo = mergeGeometries([
    paintGeo(new THREE.BoxGeometry(0.022, 0.16, 0.022), 0x8b5e3c),
    (() => { const g = new THREE.BoxGeometry(0.075, 0.05, 0.05); g.translate(0, 0.09, 0); return paintGeo(g, 0x3a3a3f); })(),
  ], false);
  hammerGeo.computeVertexNormals();
  const hammers = new THREE.InstancedMesh(hammerGeo, material, 64);
  hammers.count = 0;
  hammers.frustumCulled = false;
  scene.add(hammers);

  const figures = new Map();   // buildingId -> figure
  let time = 0;

  function add(id, spec, worldPos, opts = {}) {
    if (figures.has(id)) return figures.get(id);
    const kind = spec.kind === 'shed' ? 'apprentice' : (spec.harbour ? 'sailor' : 'adult');
    const style = PALETTE[spec.style] ? spec.style : 'unknown';
    const bucket = meshes[`${style}:${kind}`];
    const slot = bucket.slots++;
    if (slot >= CAPACITY) return null;
    bucket.mesh.count = bucket.slots;
    const rng = makeRng(hash32(id + ':walk'));
    const f = {
      id, bucket, slot, spec,
      home: [worldPos[0], worldPos[2]],
      pos: [worldPos[0] + rng.range(-0.3, 0.3), worldPos[2] + rng.range(-0.3, 0.3)],
      target: null, yaw: rng.range(0, 6.28), pause: rng.range(0, 3),
      mode: opts.mode || 'idle', speed: 0.34, rng, phase: rng.range(0, 6.28),
      radius: spec.kind === 'shed' ? 0.3 : 0.5, visible: true, path: null, pathI: 0, onDone: null,
      hammerSlot: -1, y: 0,
    };
    figures.set(id, f);
    return f;
  }

  function remove(id) {
    const f = figures.get(id);
    if (!f) return;
    f.visible = false;
    hide(f);
  }
  function hide(f) {
    tmpObj.position.set(0, -999, 0);
    tmpObj.scale.setScalar(0.0001);
    tmpObj.updateMatrix();
    f.bucket.mesh.setMatrixAt(f.slot, tmpObj.matrix);
    f.bucket.mesh.instanceMatrix.needsUpdate = true;
  }

  function setVisible(id, v) {
    const f = figures.get(id);
    if (!f) return;
    f.visible = v;
    if (!v) hide(f);
  }
  function setMode(id, mode) {
    const f = figures.get(id);
    if (f && f.mode !== 'walk' && f.mode !== 'sail') f.mode = mode;
  }

  // Walk in from the shore to a plot.
  function walkIn(id, fromCell, toCell, onDone) {
    const f = figures.get(id);
    if (!f) { onDone && onDone(); return; }
    const path = findPath(terrain, fromCell, toCell, null);
    if (!path || path.length < 2) { onDone && onDone(); return; }
    f.path = path;
    f.pathI = 0;
    f.pos = [path[0][0], path[0][1]];
    f.mode = 'walk';
    f.speed = Math.max(1.1, path.length / 7.5);
    f.onDone = onDone;
    f.visible = true;
  }

  function update(dt, nightAmount) {
    time += dt;
    let hammerCount = 0;
    for (const f of figures.values()) {
      if (!f.visible) continue;
      let bob = 0;

      if (f.mode === 'walk' && f.path) {
        const t = f.path[Math.min(f.pathI + 1, f.path.length - 1)];
        const dx = t[0] - f.pos[0], dz = t[1] - f.pos[1];
        const d = Math.hypot(dx, dz);
        if (d < 0.12) {
          f.pathI++;
          if (f.pathI >= f.path.length - 1) {
            f.mode = 'idle'; f.path = null;
            f.home = [f.pos[0], f.pos[1]];
            if (f.onDone) { const cb = f.onDone; f.onDone = null; cb(); }
          }
        } else {
          const step = Math.min(d, f.speed * dt);
          f.pos[0] += (dx / d) * step;
          f.pos[1] += (dz / d) * step;
          f.yaw = lerpAngle(f.yaw, Math.atan2(dx, dz), 0.2);
        }
        bob = Math.abs(Math.sin(time * 11 + f.phase)) * 0.035;
      } else if (f.mode === 'hammer') {
        const dx = f.home[0] - f.pos[0], dz = f.home[1] - f.pos[1];
        const d = Math.hypot(dx, dz);
        const want = 0.52;
        if (Math.abs(d - want) > 0.08) {
          const dir = d > want ? 1 : -1;
          f.pos[0] += (dx / (d || 1)) * dir * 0.5 * dt;
          f.pos[1] += (dz / (d || 1)) * dir * 0.5 * dt;
        }
        f.yaw = lerpAngle(f.yaw, Math.atan2(dx, dz), 0.15);
        bob = Math.abs(Math.sin(time * 8 + f.phase)) * 0.02;
        if (hammerCount < 60) {
          const swing = -1.15 + 0.75 * (0.5 + 0.5 * Math.sin(time * 8 + f.phase));
          tmpObj.position.set(f.pos[0] + Math.sin(f.yaw) * 0.16, f.y + 0.26, f.pos[1] + Math.cos(f.yaw) * 0.16);
          tmpObj.rotation.set(0, f.yaw, swing);
          tmpObj.scale.setScalar(f.spec.kind === 'shed' ? 0.62 : 1);
          tmpObj.updateMatrix();
          hammers.setMatrixAt(hammerCount++, tmpObj.matrix);
        }
      } else {
        f.pause -= dt;
        if (!f.target && f.pause <= 0) {
          const a = f.rng.range(0, 6.283), r = f.rng.range(0.1, f.radius);
          f.target = [f.home[0] + Math.cos(a) * r, f.home[1] + Math.sin(a) * r];
        }
        if (f.target) {
          const dx = f.target[0] - f.pos[0], dz = f.target[1] - f.pos[1];
          const d = Math.hypot(dx, dz);
          if (d < 0.06) { f.target = null; f.pause = f.rng.range(1.2, 4.5); } else {
            const step = Math.min(d, f.speed * dt);
            f.pos[0] += (dx / d) * step;
            f.pos[1] += (dz / d) * step;
            f.yaw = lerpAngle(f.yaw, Math.atan2(dx, dz), 0.12);
            bob = Math.abs(Math.sin(time * 9 + f.phase)) * 0.03;
          }
        }
      }

      f.y = f.deckY != null ? f.deckY : terrain.worldHeight(f.pos[0], f.pos[1]);
      tmpObj.position.set(f.pos[0], f.y + bob, f.pos[1]);
      tmpObj.rotation.set(0, f.yaw, Math.sin(time * 9 + f.phase) * (bob > 0.001 ? 0.05 : 0.012));
      tmpObj.scale.setScalar(1);
      tmpObj.updateMatrix();
      f.bucket.mesh.setMatrixAt(f.slot, tmpObj.matrix);
      f.bucket.mesh.instanceMatrix.needsUpdate = true;
    }
    hammers.count = hammerCount;
    hammers.instanceMatrix.needsUpdate = true;
    void nightAmount;
  }

  return { add, remove, setMode, setVisible, walkIn, update, figures, findPath: (a, b) => findPath(terrain, a, b, null) };
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
