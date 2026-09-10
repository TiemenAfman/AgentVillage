// The island itself: ground, sea, forest, sky and the passage of the day.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, fbm2, makeSimplex2D, hash32, clamp, lerp } from 'shared/rng.mjs';

const tmpColor = new THREE.Color();
const tmpObj = new THREE.Object3D();

const SEASON = {
  spring: { meadow: 0x93cf62, upland: 0x74ad4c, canopyMul: 1.06, summit: 0xa39d90 },
  summer: { meadow: 0x8fbf5a, upland: 0x6fa64a, canopyMul: 1.0, summit: 0xa39d90 },
  autumn: { meadow: 0xa9b053, upland: 0x8a9a48, canopyMul: 0.95, summit: 0xa39d90 },
  winter: { meadow: 0x8f9f76, upland: 0x77855f, canopyMul: 0.86, summit: 0xe6e6e0 },
};
export function seasonOf(month) {
  if (month <= 1 || month === 11) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'autumn';
}

// hour -> the look of the sky. Interpolated linearly between neighbours.
const DAY = [
  { h: 0, top: 0x0b1430, hor: 0x1c2a55, key: 0x8fa6ff, int: 0.28, sky: 0x243a6b, ground: 0x101820, amb: 0.13, night: 1, fire: 1, stars: 1 },
  { h: 5, top: 0x182a55, hor: 0x3a4a7a, key: 0xa0b0ff, int: 0.3, sky: 0x2c4270, ground: 0x14202a, amb: 0.15, night: 1, fire: 0.6, stars: 0.8 },
  { h: 6.5, top: 0x5a6fb0, hor: 0xffc9a0, key: 0xffb070, int: 1.5, sky: 0x7f8fc0, ground: 0x5a4a3a, amb: 0.26, night: 0.55, fire: 0, stars: 0 },
  { h: 8, top: 0x6fb2e8, hor: 0xe8f3ff, key: 0xfff0d0, int: 2.6, sky: 0xbfe0ff, ground: 0x7a8a5a, amb: 0.36, night: 0, fire: 0, stars: 0 },
  { h: 12, top: 0x5ea6e6, hor: 0xdcefff, key: 0xfff8ea, int: 3.0, sky: 0xbfe0ff, ground: 0x8a9a6a, amb: 0.4, night: 0, fire: 0, stars: 0 },
  { h: 17, top: 0x6fa8e0, hor: 0xffe0b8, key: 0xffd9a0, int: 2.4, sky: 0xb0c8e8, ground: 0x7a7a5a, amb: 0.35, night: 0.15, fire: 0, stars: 0 },
  { h: 18.5, top: 0x3d4f8a, hor: 0xff9a5c, key: 0xff8040, int: 1.5, sky: 0x705a80, ground: 0x4a3a3a, amb: 0.26, night: 0.7, fire: 0.3, stars: 0.1 },
  { h: 20, top: 0x141f45, hor: 0x3a3560, key: 0x8fa6ff, int: 0.32, sky: 0x2a3a6a, ground: 0x141c28, amb: 0.15, night: 1, fire: 1, stars: 0.8 },
  { h: 24, top: 0x0b1430, hor: 0x1c2a55, key: 0x8fa6ff, int: 0.28, sky: 0x243a6b, ground: 0x101820, amb: 0.13, night: 1, fire: 1, stars: 1 },
];

function dayAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  let a = DAY[0], b = DAY[DAY.length - 1];
  for (let i = 0; i < DAY.length - 1; i++) {
    if (h >= DAY[i].h && h <= DAY[i + 1].h) { a = DAY[i]; b = DAY[i + 1]; break; }
  }
  const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  return {
    top: tmpColor.setHex(a.top).lerp(new THREE.Color(b.top), t).clone(),
    hor: new THREE.Color(a.hor).lerp(new THREE.Color(b.hor), t),
    key: new THREE.Color(a.key).lerp(new THREE.Color(b.key), t),
    sky: new THREE.Color(a.sky).lerp(new THREE.Color(b.sky), t),
    ground: new THREE.Color(a.ground).lerp(new THREE.Color(b.ground), t),
    int: lerp(a.int, b.int, t),
    amb: lerp(a.amb, b.amb, t),
    night: lerp(a.night, b.night, t),
    fire: lerp(a.fire, b.fire, t),
    stars: lerp(a.stars, b.stars, t),
  };
}

export function sunDirection(hour) {
  const h = ((hour % 24) + 24) % 24;
  const day = h >= 6 && h <= 18;
  const p = day ? (h - 6) / 12 : (((h + 6) % 24) / 12);
  const el = Math.sin(Math.PI * p) * (day ? 1.15 : 0.9);
  const az = Math.PI * p + 3.5;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.max(0.06, Math.sin(el)), Math.cos(el) * Math.cos(az)).normalize();
}

function bandColour(h, season) {
  const s = SEASON[season];
  if (h < -0.6) return 0x3f6a7c;
  if (h < 0) return 0x8f9f7a;
  if (h < 0.35) return 0xe8d6a4;
  if (h < 1.6) return s.meadow;
  if (h < 3.4) return s.upland;
  if (h < 5.2) return 0x8f8a80;
  return s.summit;
}

export function createWorld(scene, terrain, village, opts = {}) {
  const size = terrain.size, half = terrain.half, N = terrain.N;
  const season = seasonOf(opts.month ?? new Date().getMonth());
  const group = new THREE.Group();
  scene.add(group);

  // ---- ground -------------------------------------------------------------
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * N * 3);
  const col = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = i + j * N;
      pos[k * 3] = i - half;
      pos[k * 3 + 1] = terrain.H[k];
      pos[k * 3 + 2] = j - half;
    }
  }
  const idx = new Uint32Array(size * size * 6);
  let p = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const a = i + j * N, b = a + 1, c = a + N, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  function paintGround(seasonName) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = i + j * N;
        tmpColor.setHex(bandColour(terrain.H[k], seasonName));
        col[k * 3] = tmpColor.r; col[k * 3 + 1] = tmpColor.g; col[k * 3 + 2] = tmpColor.b;
      }
    }
    geo.attributes.color.needsUpdate = true;
  }
  paintGround(season);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0,
  }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // ---- sea ----------------------------------------------------------------
  const waterGeo = new THREE.PlaneGeometry(260, 260, 130, 130);
  waterGeo.rotateX(-Math.PI / 2);
  const wp = waterGeo.attributes.position;
  const depth = new Float32Array(wp.count);
  for (let i = 0; i < wp.count; i++) {
    depth[i] = terrain.worldHeight(wp.getX(i), wp.getZ(i));
    if (Math.abs(wp.getX(i)) > half || Math.abs(wp.getZ(i)) > half) depth[i] = -2.5;
  }
  waterGeo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

  const waterMat = new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x2a6f98) },
        uShallow: { value: new THREE.Color(0x5fb8c9) },
        uFoam: { value: new THREE.Color(0xeaf6f8) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uNight: { value: 0 },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      attribute float aDepth;
      uniform float uTime;
      varying float vDepth;
      varying vec3 vWorld;
      varying vec3 vWave;
      void main() {
        vDepth = aDepth;
        vec3 p = position;
        float w1 = sin(p.x * 1.3 + uTime * 1.1);
        float w2 = sin(p.z * 1.7 - uTime * 0.9);
        p.y += 0.05 * w1 + 0.04 * w2;
        vWave = vec3(-0.065 * cos(p.x * 1.3 + uTime * 1.1), 1.0, -0.068 * cos(p.z * 1.7 - uTime * 0.9));
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform vec3 uDeep, uShallow, uFoam, uSunColor;
      uniform vec3 uSunDir;
      uniform float uTime, uNight;
      varying float vDepth;
      varying vec3 vWorld;
      varying vec3 vWave;
      void main() {
        float shallow = smoothstep(-2.0, -0.1, vDepth);
        vec3 col = mix(uDeep, uShallow, shallow);
        float foam = smoothstep(-0.32, -0.02, vDepth) * (0.55 + 0.45 * sin(uTime * 2.0 + vDepth * 34.0));
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.65);
        vec3 n = normalize(vWave);
        vec3 v = normalize(cameraPosition - vWorld);
        vec3 r = reflect(-normalize(uSunDir), n);
        float spec = pow(max(dot(r, v), 0.0), 60.0);
        col += uSunColor * spec * 0.55 * (1.0 - uNight * 0.8);
        col *= mix(1.0, 0.34, uNight);
        gl_FragColor = vec4(col, 0.88);
        #include <fog_fragment>
      }
    `,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = 0;
  water.renderOrder = 1;
  group.add(water);

  // A plain disc of sea beyond the detailed patch, so the horizon has no seam.
  const oceanGeo = new THREE.CircleGeometry(500, 72);
  oceanGeo.rotateX(-Math.PI / 2);
  const ocean = new THREE.Mesh(oceanGeo, new THREE.MeshBasicMaterial({ color: 0x2a6f98, fog: true }));
  ocean.position.y = -0.06;
  ocean.renderOrder = 0;
  group.add(ocean);

  // ---- sky ----------------------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x5ea6e6) },
      uHor: { value: new THREE.Color(0xdcefff) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xffffff) },
      uStars: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uTop, uHor, uSunColor; uniform vec3 uSunDir; uniform float uStars;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = mix(uHor, uTop, smoothstep(-0.05, 0.45, d.y));
        float halo = pow(max(dot(d, normalize(uSunDir)), 0.0), 48.0);
        col += uSunColor * halo * 0.5;
        if (uStars > 0.01 && d.y > 0.0) {
          vec2 g = floor(d.xz * 260.0 + d.y * 40.0);
          float s = step(0.9975, hash(g));
          col += vec3(s) * uStars * (0.6 + 0.4 * hash(g + 3.0)) * smoothstep(0.0, 0.35, d.y);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(620, 26, 16), skyMat);
  sky.frustumCulled = false;
  group.add(sky);

  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(11, 14, 10), new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false }));
  const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(8, 14, 10), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false }));
  group.add(sunDisc, moonDisc);

  // Scaled to the island rather than fixed: 85/235 was chosen for a 64 grid, and at the
  // distance this one has to be viewed from, the far coast sat in full fog.
  scene.fog = new THREE.Fog(0xdcefff, terrain.half * 1.2, terrain.half * 3.9);

  // ---- lights --------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x8a9a6a, 0.85);
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  const key = new THREE.DirectionalLight(0xfff8ea, 3.0);
  key.castShadow = true;
  key.shadow.mapSize.set(opts.shadowSize || 2048, opts.shadowSize || 2048);
  key.shadow.camera.left = -42; key.shadow.camera.right = 42;
  key.shadow.camera.top = 42; key.shadow.camera.bottom = -42;
  key.shadow.camera.near = 10; key.shadow.camera.far = 220;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 3;
  scene.add(hemi, ambient, key, key.target);

  // ---- vegetation ----------------------------------------------------------
  const cleared = new Set((village.cleared || []).map(([gx, gz]) => gx + gz * size));
  for (const b of village.buildings || []) {
    if (!b.plot) continue;
    for (let z = -1; z <= b.plot.d; z++) for (let x = -1; x <= b.plot.w; x++) cleared.add((b.plot.gx + x) + (b.plot.gz + z) * size);
  }

  const rng = makeRng(terrain.seed).fork('flora');
  const forest = makeSimplex2D(hash32(terrain.seed + ':forest'));

  const pineGeo = merge([
    cyl(0.06, 0.09, 0.5, 5, 0x6b4a2f, 0.25),
    cone(0.42, 0.8, 6, 0x3f7d47, 0.72),
    cone(0.3, 0.7, 6, 0x478950, 1.15),
  ]);
  const oakGeo = merge([
    cyl(0.07, 0.09, 0.45, 5, 0x6b4a2f, 0.22),
    ico(0.45, 0x5c9a3f, 0.78, 0.85),
  ]);
  const rockGeo = dodeca(0.22, 0x7f7a72, 0.1);
  const grassGeo = cone(0.08, 0.18, 3, 0x7fb64d, 0.09);
  for (const g of [rockGeo, grassGeo]) g.computeVertexNormals();

  const trees = [];
  const treeCells = new Map();
  const pines = [], oaks = [], rocks = [], tufts = [];
  for (const [gx, gz] of terrain.landCells) {
    const k = gx + gz * size;
    const h = terrain.heightAt(gx, gz);
    const [wx, wz] = terrain.cellWorld(gx, gz);
    if (h < 0.45 || terrain.isBeach(gx, gz)) {
      if (h >= 0.05 && rng.chance(0.1)) rocks.push([wx + rng.range(-0.3, 0.3), wz + rng.range(-0.3, 0.3), rng.range(0.4, 0.9)]);
      continue;
    }
    if (cleared.has(k)) continue;
    if (terrain.slope(gx, gz) > 1.3 || h > 5.0) {
      if (rng.chance(0.3)) rocks.push([wx + rng.range(-0.3, 0.3), wz + rng.range(-0.3, 0.3), rng.range(0.6, 1.6)]);
      continue;
    }
    const dens = fbm2(forest, wx * 0.09, wz * 0.09, { octaves: 3 });
    if (rng.chance(0.5)) tufts.push([wx + rng.range(-0.45, 0.45), wz + rng.range(-0.45, 0.45), rng.range(0.7, 1.3)]);
    if (dens < 0.12) continue;
    const n = 1 + (dens > 0.3 ? 1 : 0) + (dens > 0.45 ? 1 : 0);
    const highland = h > 3.0;
    for (let t = 0; t < n; t++) {
      const x = wx + rng.range(-0.38, 0.38), z = wz + rng.range(-0.38, 0.38);
      const item = { x, z, s: rng.range(0.6, 0.98), rot: rng.range(0, 6.283), cell: k, kind: highland || rng.chance(0.45) ? 'pine' : 'oak' };
      (item.kind === 'pine' ? pines : oaks).push(item);
      trees.push(item);
      if (!treeCells.has(k)) treeCells.set(k, []);
      treeCells.get(k).push(item);
    }
  }

  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const pineMesh = new THREE.InstancedMesh(pineGeo, treeMat, Math.max(1, pines.length));
  const oakMesh = new THREE.InstancedMesh(oakGeo, treeMat, Math.max(1, oaks.length));
  const rockMesh = new THREE.InstancedMesh(rockGeo, treeMat, Math.max(1, rocks.length));
  const grassMesh = new THREE.InstancedMesh(grassGeo, treeMat, Math.max(1, tufts.length));
  for (const m of [pineMesh, oakMesh, rockMesh]) { m.castShadow = true; m.receiveShadow = true; }
  grassMesh.castShadow = false;
  group.add(pineMesh, oakMesh, rockMesh, grassMesh);

  function placeTrees(list, mesh, seasonName) {
    const autumn = seasonName === 'autumn';
    const mul = SEASON[seasonName].canopyMul;
    list.forEach((it, i) => {
      it.mesh = mesh; it.index = i; it.scale = it.s;
      tmpObj.position.set(it.x, terrain.worldHeight(it.x, it.z) - 0.05, it.z);
      tmpObj.rotation.set(0, it.rot, 0);
      tmpObj.scale.setScalar(it.s);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);
      let tint = 0.86 + ((hash32(i + ':' + it.x) % 100) / 100) * 0.3;
      tmpColor.setScalar(tint * mul);
      if (autumn && mesh === oakMesh && (hash32('a' + i) % 100) < 42) {
        tmpColor.setHex((hash32('b' + i) % 2) ? 0xd68a3a : 0xc9553a).multiplyScalar(1.05);
      }
      mesh.setColorAt(i, tmpColor);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  placeTrees(pines, pineMesh, season);
  placeTrees(oaks, oakMesh, season);
  rocks.forEach((r, i) => {
    tmpObj.position.set(r[0], terrain.worldHeight(r[0], r[1]) - 0.04, r[1]);
    tmpObj.rotation.set(rng.range(0, 1), rng.range(0, 6.28), rng.range(0, 1));
    tmpObj.scale.setScalar(r[2]);
    tmpObj.updateMatrix();
    rockMesh.setMatrixAt(i, tmpObj.matrix);
    rockMesh.setColorAt(i, tmpColor.setScalar(0.85 + ((hash32('r' + i) % 100) / 100) * 0.3));
  });
  rockMesh.instanceMatrix.needsUpdate = true;
  tufts.forEach((g, i) => {
    tmpObj.position.set(g[0], terrain.worldHeight(g[0], g[1]) - 0.02, g[1]);
    tmpObj.rotation.set(0, hash32('g' + i) % 6, 0);
    tmpObj.scale.set(g[2], g[2] * 1.2, g[2]);
    tmpObj.updateMatrix();
    grassMesh.setMatrixAt(i, tmpObj.matrix);
    grassMesh.setColorAt(i, tmpColor.setScalar(0.8 + ((hash32('h' + i) % 100) / 100) * 0.4));
  });
  grassMesh.instanceMatrix.needsUpdate = true;

  // ---- footpaths -----------------------------------------------------------
  let pathMesh = null;
  // Only the town square is laid in stone. A district square is a green with a plaque
  // and a well on it, not a plaza, and paving three by three of them across the island
  // reads as a rash of empty patios. Roads meet them at a doorstep instead.
  function squareCells(v) {
    const out = [];
    const town = v.island && v.island.town;
    if (!town) return out;
    if (town.paved) return town.paved;          // the plaza as it actually came out
    if (!town.square) return out;
    const n = town.size || 3;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out.push([town.square[0] + x, town.square[1] + z]);
    return out;
  }

  function buildPaths(paths, squares = squareCells(village)) {
    if (pathMesh) { group.remove(pathMesh); pathMesh.geometry.dispose(); pathMesh = null; }
    const positions = [], colors = [], indices = [];
    let v = 0;
    // A track half a cell wide, widened towards whichever neighbours continue the path,
    // so a run of cells joins up into one continuous footpath. Squares are laid the same
    // way in a paler stone, which is what makes a road meet a plaza instead of stopping
    // a cell short of it.
    const seen = new Set();
    const tiles = [];
    for (const p of paths || []) for (const c of p.cells) { seen.add(c[0] + c[1] * terrain.size); tiles.push([c, 0xcbb691]); }
    for (const c of squares || []) {
      const k = c[0] + c[1] * terrain.size;
      if (seen.has(k)) continue;
      seen.add(k);
      tiles.push([c, 0xd6cbb2]);
    }
    const hasCell = (gx, gz) => seen.has(gx + gz * terrain.size);
    const H = 0.26;
    {
      for (const [[gx, gz], hex] of tiles) {
        const [x, z] = terrain.cellWorld(gx, gz);
        const x0 = x - (hasCell(gx - 1, gz) ? 0.5 : H), x1 = x + (hasCell(gx + 1, gz) ? 0.5 : H);
        const z0 = z - (hasCell(gx, gz - 1) ? 0.5 : H), z1 = z + (hasCell(gx, gz + 1) ? 0.5 : H);
        for (const [qx, qz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
          positions.push(qx, terrain.worldHeight(qx, qz) + 0.045, qz);
          tmpColor.setHex(hex);
          colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
        }
        indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
        v += 4;
      }
    }
    if (!positions.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    pathMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    pathMesh.receiveShadow = true;
    group.add(pathMesh);
  }
  buildPaths(village.paths);

  // ---- clouds --------------------------------------------------------------
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xfbfbf7, flatShading: true, roughness: 1 });
  const clouds = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    const parts = 3 + rng.int(3);
    for (let k = 0; k < parts; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(1.6, 3.2), 0), cloudMat);
      m.position.set(rng.range(-3, 3), rng.range(-0.4, 0.4), rng.range(-2, 2));
      m.scale.set(1, rng.range(0.4, 0.6), 1);
      m.castShadow = true;
      c.add(m);
    }
    c.position.set(rng.range(-70, 70), rng.range(24, 33), rng.range(-70, 70));
    c.userData.speed = rng.range(0.35, 0.75);
    clouds.add(c);
  }
  group.add(clouds);

  // ---- fireflies -----------------------------------------------------------
  // Fireflies gather near the lake and along the edge of the forest, not out at sea.
  const nearWater = terrain.landCells.filter(([gx, gz]) => {
    const [x, z] = terrain.cellWorld(gx, gz);
    const dl = Math.hypot(x - terrain.lakeCentre[0], z - terrain.lakeCentre[1]);
    return dl < 9 || (terrain.heightAt(gx, gz) > 0.6 && terrain.heightAt(gx, gz) < 2.6);
  });
  const pool = nearWater.length > 40 ? nearWater : terrain.landCells;
  const FF = 190;
  const ffPos = new Float32Array(FF * 3);
  const ffCol = new Float32Array(FF * 3);
  const ffBase = [];
  for (let i = 0; i < FF; i++) {
    const c = pool[rng.int(pool.length)];
    const [x, z] = terrain.cellWorld(c[0], c[1]);
    const bx = x + rng.range(-0.5, 0.5), bz = z + rng.range(-0.5, 0.5);
    ffBase.push({ x: bx, z: bz, y: terrain.worldHeight(bx, bz) + rng.range(0.35, 1.1), ph: rng.range(0, 6.28) });
    ffPos[i * 3] = bx; ffPos[i * 3 + 1] = ffBase[i].y; ffPos[i * 3 + 2] = bz;
  }
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('color', new THREE.BufferAttribute(ffCol, 3));
  const fireflies = new THREE.Points(ffGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexColors: true,
    uniforms: { uScale: { value: window.innerHeight * 0.5 } },
    vertexShader: `varying vec3 vC; uniform float uScale;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 0.13 * uScale / max(0.001, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5);
        float m = smoothstep(0.5, 0.0, d); if (m <= 0.01) discard;
        gl_FragColor = vec4(vC, m * m); }`,
  }));
  fireflies.frustumCulled = false;
  fireflies.renderOrder = 2;
  group.add(fireflies);

  // ---- update --------------------------------------------------------------
  let time = 0;
  let currentSeason = season;
  const state = { night: 0, fire: 0, sun: new THREE.Vector3() };
  // The shadow frustum follows what you are looking at. It is 84 units across and the
  // island is about 120, so anchored at the origin the far half of the coast cast no
  // shadow at all. Widening it instead would take the shadow map from 24 pixels per unit
  // down to 15 and soften every roof edge, so it moves. Eased, not snapped, or shadows
  // pop in and out along the frustum edge while you pan.
  const shadowFocus = new THREE.Vector3();
  const followShadow = (x, z) => shadowFocus.set(x, 0, z);

  function update(dt, hour, month) {
    time += dt;
    const d = dayAt(hour);
    const dir = sunDirection(hour);
    state.sun.copy(dir);
    state.night = d.night;

    key.target.position.lerp(shadowFocus, Math.min(1, dt * 4));
    key.position.copy(key.target.position).addScaledVector(dir, 90);
    key.color.copy(d.key);
    key.intensity = d.int;
    hemi.color.copy(d.sky); hemi.groundColor.copy(d.ground);
    hemi.intensity = lerp(0.35, 0.9, 1 - d.night);
    ambient.intensity = d.amb;

    skyMat.uniforms.uTop.value.copy(d.top);
    skyMat.uniforms.uHor.value.copy(d.hor);
    skyMat.uniforms.uSunDir.value.copy(dir);
    skyMat.uniforms.uSunColor.value.copy(d.key);
    skyMat.uniforms.uStars.value = d.stars;
    scene.fog.color.copy(d.hor).lerp(d.top, 0.25);

    waterMat.uniforms.uTime.value = time;
    waterMat.uniforms.uSunDir.value.copy(dir);
    waterMat.uniforms.uSunColor.value.copy(d.key);
    waterMat.uniforms.uNight.value = d.night;

    const isDay = hour >= 6 && hour <= 18;
    sunDisc.visible = isDay; moonDisc.visible = !isDay;
    (isDay ? sunDisc : moonDisc).position.copy(dir).multiplyScalar(430);

    for (const c of clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 90) c.position.x = -90;
    }

    fireflies.visible = d.fire > 0.02;
    if (fireflies.visible) {
      const arr = ffGeo.attributes.position.array, ca = ffGeo.attributes.color.array;
      for (let i = 0; i < FF; i++) {
        const b = ffBase[i];
        arr[i * 3] = b.x + 0.2 * Math.sin(time * 0.7 + b.ph);
        arr[i * 3 + 1] = b.y + 0.25 * Math.sin(time * 1.3 + b.ph * 1.7);
        arr[i * 3 + 2] = b.z + 0.2 * Math.cos(time * 0.6 + b.ph * 0.7);
        const g = (0.3 + 0.7 * Math.max(0, Math.sin(time * 3 + b.ph))) * d.fire;
        ca[i * 3] = 1.0 * g; ca[i * 3 + 1] = 0.78 * g; ca[i * 3 + 2] = 0.22 * g;
      }
      ffGeo.attributes.position.needsUpdate = true;
      ffGeo.attributes.color.needsUpdate = true;
    }

    const s = seasonOf(month);
    if (s !== currentSeason) {
      currentSeason = s;
      paintGround(s);
      placeTrees(pines, pineMesh, s);
      placeTrees(oaks, oakMesh, s);
    }
    // felling animation
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.t += dt;
      const k = clamp(f.t / 0.7, 0, 1);
      tmpObj.position.set(f.it.x, terrain.worldHeight(f.it.x, f.it.z) - 0.05, f.it.z);
      tmpObj.rotation.set(k * 1.4, f.it.rot, 0);
      tmpObj.scale.setScalar(f.it.s * (1 - k));
      tmpObj.updateMatrix();
      f.it.mesh.setMatrixAt(f.it.index, tmpObj.matrix);
      f.it.mesh.instanceMatrix.needsUpdate = true;
      if (k >= 1) falling.splice(i, 1);
    }
  }

  const falling = [];
  function fellTrees(cells, animate = true) {
    const out = [];
    for (const [gx, gz] of cells) {
      const list = treeCells.get(gx + gz * size);
      if (!list) continue;
      for (const it of list) {
        if (it.felled) continue;
        it.felled = true;
        out.push([it.x, it.z]);
        if (animate) falling.push({ it, t: 0 });
        else {
          tmpObj.position.set(0, -999, 0); tmpObj.scale.setScalar(0.0001); tmpObj.rotation.set(0, 0, 0); tmpObj.updateMatrix();
          it.mesh.setMatrixAt(it.index, tmpObj.matrix);
          it.mesh.instanceMatrix.needsUpdate = true;
        }
      }
      treeCells.delete(gx + gz * size);
    }
    return out;
  }
  // anything already cleared at load time is simply not planted, so nothing to do here

  return {
    group, ground, water, sky, key, hemi, ambient, clouds, fireflies, update, fellTrees,
    buildPaths, squareCells, followShadow, state, season: () => currentSeason,
  };
}

// ---- tiny geometry helpers (vertex-coloured, flat shaded) -----------------
function paint(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}
function cyl(rt, rb, h, seg, hex, y) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(0, y, 0);
  return paint(g, hex);
}
function cone(r, h, seg, hex, y) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, y + h / 2, 0);
  return paint(g, hex);
}
function ico(r, hex, y, sy) {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.scale(1, sy || 1, 1);
  g.translate(0, y, 0);
  return paint(g, hex);
}
function dodeca(r, hex, y) {
  const g = new THREE.DodecahedronGeometry(r, 0);
  g.translate(0, y, 0);
  return paint(g, hex);
}
function merge(geos) {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = mergeGeometries(flat, false);
  out.computeVertexNormals();
  return out;
}
