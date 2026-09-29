// The islets on the water (shared/islets.mjs decides where and what; this draws it).
//
// Deliberately not regions and not the horizon: an islet is a dozen cells of sand, and a
// region is a whole terrain with its own heightfield, its own guest drawing path and a place
// in the archipelago the water patch is sized from. So the islets are three meshes for all
// of them together - the ground merged into one geometry, the palms and the bushes one
// InstancedMesh each. The sea under them knows they are there through `seabed`, which the
// archipelago is handed (createArchipelago's setSeabed): it is what puts the shallows round
// the sand (the water patch is dense round every square it lists), what a boat grounds on and
// what you stand on when you step out of one - all of them ask the archipelago's `height`,
// and that says isletHeight, the very function the ground below is drawn from.
//
// The palm is drawn whole near the viewer and as its `_lo` further out (two meshes, the
// split re-made every couple of seconds as the viewer moves) - the plan's "mee in de ranking
// van DETAILED" without joining the fleet's own ranking, which decides which islands are
// fetched and would have made a sandbank compete with a neighbour for a slot.
import * as THREE from 'three';
import * as models from './models.js';
import { plantMaterials } from './world.js';
import { isletsNear, isletHeight, isletBed, ISLET_SPAN, ISLET_SHOAL_REACH, ISLET_WATER_STEP } from 'shared/islets.mjs';
import { worldToScene, OPEN_SEA } from 'shared/regions.mjs';

// A palm this near the viewer is drawn whole, in scene units.
const NEAR_PALM = 160;
const RESPLIT_S = 2;
const SAND = new THREE.Color(0xe6d6a8);
const WET_SAND = new THREE.Color(0xc9b98c);
const GRASS = new THREE.Color(0x7c9a4f);
// Upper bounds for the instance buffers, so a fleet change never has to make a new mesh:
// a few dozen islets in range, five palms and six bushes at most on one.
const MAX_ISLETS = 64;

function nearestFirst(list, [x, z]) {
  const d = (i) => Math.abs(i.x - x) + Math.abs(i.z - z);
  return list.slice().sort((a, b) => d(a) - d(b) || (a.id < b.id ? -1 : 1));
}

// `onChange` is told whenever the set of islets standing changes, after the ground is laid:
// the sea bed under them has moved, so the water round them has to be worked out again.
export function createIslets({ scene, modest = false, onChange = null }) {
  const group = new THREE.Group();
  group.name = 'islets';
  scene.add(group);
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const { bark, foliage } = plantMaterials();
  const palmGeo = models.hasAsset('flora_palm_a') ? models.grouped('flora_palm_a', ['bark', 'foliage']) : null;
  const palmLoGeo = models.hasAsset('flora_palm_a_lo') ? models.grouped('flora_palm_a_lo', ['bark', 'foliage']) : palmGeo;
  const bushGeo = models.hasAsset('flora_bush_a') ? models.grouped('flora_bush_a', ['foliage']) : null;
  const instanced = (geo, mats, n) => {
    if (!geo) return null;
    const m = new THREE.InstancedMesh(geo, mats, n);
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    // The instances are spread over the whole sea, and three culls an InstancedMesh on its
    // geometry's own sphere - one palm's worth, at the origin.
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  // On a modest GPU every palm is the `_lo`, so the near mesh is never filled.
  const palmNear = modest ? null : instanced(palmGeo, [bark, foliage], MAX_ISLETS * 5);
  const palmFar = instanced(palmLoGeo, [bark, foliage], MAX_ISLETS * 5);
  const bushMesh = instanced(bushGeo, [foliage], MAX_ISLETS * 6);
  let ground = null;
  let islets = [];
  let sig = '';
  let home = [0, 0];
  let since = RESPLIT_S;
  // Past the fog ceiling (plus a pad, below) a palm or a bush is not put in the buffers at all:
  // one InstancedMesh over the whole sea cannot be masked per islet, but the palms are already
  // re-laid every RESPLIT_S, so leaving the far ones out of that pass costs nothing extra.
  // Measured from the camera (`eye`), like keepRecord, not from the focus the near/far palm
  // split uses. `Infinity` until the frame loop has said, and always in the planner's reach.
  let eye = null;
  let reach = Infinity;
  const inReach = (x, z) => !eye || Math.hypot(x - eye.x, z - eye.z) <= reach;
  const tmp = new THREE.Object3D();
  const tint = new THREE.Color();

  // Every islet's ground in one geometry, in scene coordinates: a grid a cell apart over the
  // islet's square, only the quads that reach above the sea (as horizon.js does it), coloured
  // wet at the waterline, sand above it and grass on the top of a greener one.
  function buildGround() {
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (const islet of islets) {
      const [ox, oz] = worldToScene([islet.x, islet.z], home);
      const reach = Math.ceil(islet.r * 1.35) + 1;
      const n = 2 * reach + 1;
      const base = pos.length / 3;
      const hs = new Float32Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const lx = i - reach, lz = j - reach;
          const h = isletHeight(islet, lx, lz);
          hs[j * n + i] = h;
          pos.push(ox + lx, Math.max(h, -0.5), oz + lz);
          if (h < 0.06) c.copy(WET_SAND);
          else if (islet.kind === 'green' && h > islet.peak * 0.45) c.copy(GRASS).lerp(SAND, Math.max(0, 0.6 - h) * 1.5);
          else c.copy(SAND);
          col.push(c.r, c.g, c.b);
        }
      }
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
          if (hs[a] < 0 && hs[b] < 0 && hs[d] < 0 && hs[e] < 0) continue;
          idx.push(base + a, base + d, base + b, base + b, base + d, base + e);
        }
      }
    }
    if (ground) { group.remove(ground); ground.geometry.dispose(); ground = null; }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    ground = new THREE.Mesh(g, groundMat);
    ground.receiveShadow = true;
    ground.name = 'islet ground';
    group.add(ground);
  }

  function put(mesh, k, x, y, z, rot, s, shade, sy = s) {
    tmp.position.set(x, y, z);
    tmp.rotation.set(0, rot, 0);
    tmp.scale.set(s, sy, s);
    tmp.updateMatrix();
    mesh.setMatrixAt(k, tmp.matrix);
    mesh.setColorAt(k, tint.setScalar(shade));
  }
  const done = (mesh, n) => {
    if (!mesh) return;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  function placeBushes() {
    if (!bushMesh) return;
    let k = 0;
    for (const islet of islets) {
      const [ox, oz] = worldToScene([islet.x, islet.z], home);
      for (const b of islet.bushes) {
        if (k >= bushMesh.instanceMatrix.count) break;
        if (!inReach(ox + b.x, oz + b.z)) continue;
        put(bushMesh, k++, ox + b.x, b.y - 0.04, oz + b.z, b.rot, b.s, 0.85 + (b.s - 0.8) * 0.3, b.s * 0.85);
      }
    }
    done(bushMesh, k);
  }

  // Which palms are near, re-made as the viewer moves.
  function placePalms(focus) {
    let near = 0, far = 0;
    const [fx, fz] = focus || [0, 0];
    for (const islet of islets) {
      const [ox, oz] = worldToScene([islet.x, islet.z], home);
      for (const p of islet.palms) {
        const x = ox + p.x, z = oz + p.z;
        if (!inReach(x, z)) continue;
        const whole = palmNear && Math.hypot(x - fx, z - fz) < NEAR_PALM;
        const mesh = whole ? palmNear : palmFar;
        if (!mesh) continue;
        const k = whole ? near++ : far++;
        if (k >= mesh.instanceMatrix.count) continue;
        put(mesh, k, x, p.y - 0.05, z, p.rot, p.s, 0.9 + (p.s - 0.8) * 0.3);
      }
    }
    done(palmNear, near);
    done(palmFar, far);
  }

  // The whole fleet every time (and our berth, `homeOrigin`, since everything here is drawn
  // relative to it). `extra` is water held by something that is not in the fleet - the
  // phone's own berth. Cheap when nothing changed: the list is compared by id.
  function apply(fleet, origin, { extra = [], focus = null } = {}) {
    // No berth yet is no islets, not the islets round [0,0].
    const at = origin || [0, 0];
    // The nearest MAX_ISLETS when there are more (a berth far out in empty sea): which ones
    // are drawn may differ between two screens, but never where one is.
    const next = origin ? nearestFirst(isletsNear(fleet, at, { extra }), at).slice(0, MAX_ISLETS) : [];
    const nextSig = `${at[0]},${at[1]}|${next.map((i) => i.id).join(',')}`;
    if (nextSig === sig) return islets.length;
    sig = nextSig;
    home = [at[0], at[1]];
    islets = next;
    buildGround();
    placeBushes();
    placePalms(focus);
    if (onChange) onChange(islets.length);
    return islets.length;
  }

  // `view` is { eye, reach }: the camera and how far out anything is still worth drawing.
  function update(dt, focus, view = null) {
    since += dt;
    if (since < RESPLIT_S) return;
    since = 0;
    const culls = !!view && Number.isFinite(view.reach);
    if (!palmNear && !culls && !Number.isFinite(reach)) return;
    eye = culls ? { x: view.eye.x, z: view.eye.z } : null;
    reach = culls ? view.reach : Infinity;
    placePalms(focus);
    placeBushes();
  }

  // What an islet says the sea's depth is at a point in scene coordinates, or null off every
  // islet - what the archipelago answers with between the islands, and for a test to ask.
  // The ground itself where there is any, sinking into OPEN_SEA at ISLET_SPAN radii (`isletBed`).
  function heightAt(x, z) {
    for (const islet of islets) {
      const [ox, oz] = worldToScene([islet.x, islet.z], home);
      const lx = x - ox, lz = z - oz, span = islet.r * ISLET_SPAN;
      if (Math.abs(lx) > span || Math.abs(lz) > span) continue;
      const h = isletBed(islet, lx, lz, OPEN_SEA);
      if (h != null) return h;
    }
    return null;
  }

  // The islets as a sea bed for createArchipelago: the ground, and the squares the water is
  // dense round. Read live - `islets` is swapped whole by `apply`.
  const seabed = {
    height: heightAt,
    squares: () => islets.map((islet) => ({
      origin: worldToScene([islet.x, islet.z], home),
      half: islet.r * ISLET_SPAN,
      reach: ISLET_SHOAL_REACH,
      step: ISLET_WATER_STEP,
    })),
  };

  function dispose() {
    scene.remove(group);
    if (ground) ground.geometry.dispose();
    groundMat.dispose();
    for (const m of [palmNear, palmFar, bushMesh]) if (m) m.dispose();
  }

  return { apply, update, heightAt, seabed, list: () => islets, dispose, group };
}
