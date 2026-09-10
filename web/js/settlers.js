// The little people. One instanced mesh per style, so three hundred of them cost
// five draw calls. Movement is all sine waves and lerps: no skeletons, no physics.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, box, cylinder, cone, sphere, dome } from './buildings.js';
import { makeRng, hash32, clamp } from 'shared/rng.mjs';

const tmpObj = new THREE.Object3D();
const SKIN = 0xf1c9a5;
const CAPACITY = 420;
const MAX_STROLL = 36;      // settlers out on an errand at the same time
// Which way a plot's door faces, by its rotation: 0 = -z, 1 = +x, 2 = +z, 3 = -x.
const DOOR_DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];

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
      const bucket = { mesh: m, slots: 0, figs: [] };
      m.userData.bucket = bucket;      // so a ray hit can be traced back to a person
      meshes[`${s}:${kind}`] = bucket;
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
    // Stand outside the door, not in the middle of the floor. A settler placed on its
    // own plot centre spends its life inside its own walls, and an apprentice, whose
    // shed is barely wider than it is, walks straight through them.
    const rot = (spec.plot ? spec.plot.rot : 0) | 0;
    const [ox, oz] = DOOR_DIR[rot] || DOOR_DIR[0];
    const reach = spec.kind === 'shed' ? 0.46 : 0.85;
    const home = [worldPos[0] + ox * reach, worldPos[2] + oz * reach];
    const f = {
      id, bucket, slot, spec,
      home,
      pos: [home[0] + rng.range(-0.12, 0.12), home[1] + rng.range(-0.12, 0.12)],
      target: null, yaw: rng.range(0, 6.28), pause: rng.range(0, 3),
      mode: opts.mode || 'idle', speed: 0.34, rng, phase: rng.range(0, 6.28),
      radius: spec.kind === 'shed' ? 0.14 : 0.3, visible: true, path: null, pathI: 0, onDone: null,
      hammerSlot: -1, y: 0,
      strollIn: rng.range(4, 150), strollHome: null, keepHome: false, gate: undefined,
    };
    figures.set(id, f);
    bucket.figs[slot] = f;
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

  // ---- errands ---------------------------------------------------------------
  // Once there are streets there is somewhere to go, so settlers leave the yard now
  // and then, walk the road network to somewhere else in town, stand about for a bit
  // and walk home again. Everything below is bookkeeping on top of the walk mode that
  // already existed: no new movement code, only a reason to move.
  let roads = null;
  let strolling = 0;

  function setRoads(paths, squares) {
    const cells = new Set();
    for (const p of paths || []) for (const [gx, gz] of p.cells) cells.add(gx + gz * terrain.size);
    for (const [gx, gz] of squares || []) cells.add(gx + gz * terrain.size);
    roads = cells.size ? { cells, list: [...cells] } : null;
    for (const f of figures.values()) f.gate = undefined;   // streets moved; look again
  }

  // The road cell a figure steps out onto, cached: its front path by construction.
  function gateOf(f) {
    if (f.gate !== undefined) return f.gate;
    f.gate = null;
    if (roads) {
      const hx = Math.round(f.home[0] + terrain.half - 0.5);
      const hz = Math.round(f.home[1] + terrain.half - 0.5);
      let best = null, bd = Infinity;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const k = (hx + dx) + (hz + dz) * terrain.size;
          if (!roads.cells.has(k)) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = k; }
        }
      }
      f.gate = best;
    }
    return f.gate;
  }

  // Breadth first over road cells only. Roads are a thin network, so this stays small.
  function roadRoute(from, to) {
    if (!roads || from == null || to == null || from === to) return null;
    const size = terrain.size;
    const prev = new Map([[from, -1]]);
    const queue = [from];
    let head = 0;
    while (head < queue.length && head < 6000) {
      const cur = queue[head++];
      if (cur === to) {
        const out = [];
        for (let k = cur; k !== -1; k = prev.get(k)) out.push(terrain.cellWorld(k % size, (k - (k % size)) / size));
        out.reverse();
        return out;
      }
      const cx = cur % size, cz = (cur - cx) / size;
      for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
        const k = nx + nz * size;
        if (!roads.cells.has(k) || prev.has(k)) continue;
        prev.set(k, cur);
        queue.push(k);
      }
    }
    return null;
  }

  function walkRoute(f, points, onDone) {
    f.path = [[f.pos[0], f.pos[1]], ...points];
    f.pathI = 0;
    f.mode = 'walk';
    f.keepHome = true;
    f.speed = 0.42 + f.rng.range(0, 0.14);
    f.onDone = onDone;
  }

  function startStroll(f) {
    const gate = gateOf(f);
    if (gate == null) { f.strollIn = f.rng.range(20, 60); return; }
    const size = terrain.size;
    const gx = gate % size, gz = (gate - (gate % size)) / size;
    let dest = null;
    for (let tries = 0; tries < 6 && dest === null; tries++) {
      const k = roads.list[f.rng.int(roads.list.length)];
      const kx = k % size, kz = (k - (k % size)) / size;
      const d = Math.hypot(kx - gx, kz - gz);
      if (d > 5 && d < 42) dest = k;
    }
    const out = dest === null ? null : roadRoute(gate, dest);
    if (!out || out.length < 3) { f.strollIn = f.rng.range(15, 50); return; }

    strolling++;
    const home = [f.home[0], f.home[1]];
    walkRoute(f, out, () => {
      f.mode = 'idle';
      f.target = null;
      f.pause = f.rng.range(3, 11);          // stand about wherever the errand led
      f.strollHome = () => {
        walkRoute(f, [...out].reverse().concat([home]), () => {
          f.mode = 'idle';
          f.keepHome = false;
          f.home = home;
          f.strollIn = f.rng.range(40, 160);
          strolling--;
        });
      };
    });
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
            if (!f.keepHome) f.home = [f.pos[0], f.pos[1]];   // an arrival settles here; an errand does not
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
        if (f.strollHome && f.pause <= 0) {
          const go = f.strollHome; f.strollHome = null; go();
          continue;
        }
        // Fewer errands after dark, and never more at once than the eye can follow.
        f.strollIn -= dt;
        if (f.strollIn <= 0 && roads && strolling < MAX_STROLL && !f.deckY) {
          if (nightAmount > 0.55 && f.rng.next() < nightAmount) f.strollIn = f.rng.range(20, 70);
          else startStroll(f);
          if (f.mode === 'walk') continue;
        }
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
  }

  // The people are instanced, so a ray hit comes back as a mesh plus an instance
  // number. These two turn that back into the settler standing there, which is what
  // lets you hover someone halfway down a street and read who it is.
  const pickables = () => Object.values(meshes).filter((b) => b.mesh.count > 0).map((b) => b.mesh);
  const figureAt = (mesh, i) => {
    const b = mesh && mesh.userData && mesh.userData.bucket;
    const f = b && i != null ? b.figs[i] : null;
    return f && f.visible ? f : null;
  };

  return {
    add, remove, setMode, setVisible, setRoads, walkIn, update, figures,
    pickables, figureAt,
    findPath: (a, b) => findPath(terrain, a, b, null),
  };
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
