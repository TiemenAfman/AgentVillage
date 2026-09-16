// The island itself: ground, sea, forest, sky and the passage of the day.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, fbm2, makeSimplex2D, hash32, smoothstep, clamp, lerp } from 'shared/rng.mjs';
import { decodeOwnership, settledDistance, buildBorders, planFields, buildFieldDecals, dressFieldMaterial, createBoundaryMaterial, orchardTrees, roundedOutline, FIELD_COVERAGE, NONE, TOWN } from './hamlets.js';

const tmpColor = new THREE.Color();
const tmpTint = new THREE.Color();
const tmpGround = new THREE.Color();
const tmpObj = new THREE.Object3D();

const SEASON = {
  spring: { meadow: 0x93cf62, upland: 0x74ad4c, canopyMul: 1.06, summit: 0xa39d90 },
  summer: { meadow: 0x8fbf5a, upland: 0x6fa64a, canopyMul: 1.0, summit: 0xa39d90 },
  autumn: { meadow: 0x91ad68, upland: 0x738b53, canopyMul: 0.95, summit: 0xa39d90 },
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
  { h: 12, top: 0x5ea6e6, hor: 0xdcefff, key: 0xfff8ea, int: 3.0, sky: 0xbfe0ff, ground: 0x8f8a60, amb: 0.4, night: 0, fire: 0, stars: 0 },
  // Late afternoon is the hour the island is meant to be looked at, so it carries the
  // warmth: a goldener key, a little more of it, and a horizon that has already turned.
  // `ground` is the light the meadow throws back up - warm here, which is what keeps a
  // north wall from going flat grey now that the sun sits so low that it never reaches one.
  { h: 17, top: 0x6fa8e0, hor: 0xffd7a2, key: 0xffc98a, int: 2.6, sky: 0xb0c8e8, ground: 0x8a7850, amb: 0.38, night: 0.15, fire: 0, stars: 0 },
  { h: 18.5, top: 0x3d4f8a, hor: 0xff8f46, key: 0xff8f52, int: 1.7, sky: 0x705a80, ground: 0x53402f, amb: 0.28, night: 0.7, fire: 0.3, stars: 0.1 },
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
  // How high the sun climbs at noon. It used to reach 1.15 rad - 66 degrees, a sun over
  // the tropics - and at that angle a roof casts a shadow shorter than its own eaves at
  // midday and the island reads as a flat map at every hour. 0.85 rad tops out at 49
  // degrees and puts the sun at about 13 degrees at five in the afternoon, which is where
  // the long raking light of the reference picture comes from. The clamp below stays: it
  // is what keeps the shadow frustum's own maths out of trouble when the sun is on the
  // horizon, not a lighting choice.
  const el = Math.sin(Math.PI * p) * (day ? 0.85 : 0.9);
  const az = Math.PI * p + 3.5;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.max(0.06, Math.sin(el)), Math.cos(el) * Math.cos(az)).normalize();
}

// The shadow frustum as [tightest, widest] half-width, and the share of the camera's
// distance it tries to cover. It used to be a fixed 42 - 84 units across, chosen when a
// whole island fitted inside it - and from the distance this one is framed at, two thirds
// of the picture came out shadowless. Widening it for good instead would spend the same
// shadow map on nine times the ground and blur every eave you zoom in on, so it breathes:
// tight when you are down among the houses, wide enough for the coast when you pull back.
const SHADOW_SPAN = [42, 130];
const SHADOW_OF_DIST = 0.48;

function bandColour(h, season) {
  const s = SEASON[season];
  if (h < -0.6) return 0x3f6a7c;
  if (h < 0) return 0x8f9f7a;
  if (h < 0.35) return 0xefddb2;
  if (h < 1.6) return s.meadow;
  if (h < 3.4) return s.upland;
  if (h < 5.2) return 0x8f8a80;
  return s.summit;
}

// The sheets the island is drawn on, and the one place that knows how to fetch one.
// Everything here is optional: a sheet that does not arrive leaves the surface exactly
// as it was drawn before there were any, which is why nothing below waits on one.
const TEXTURES = 'textures/';
const texLoader = new THREE.TextureLoader();
function sheet(name, onLoad) {
  texLoader.load(`${TEXTURES}${name}.png`, (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;              // the renderer clamps this to whatever the card allows
    onLoad(tex);
  }, undefined, () => {
    console.warn(`[island] no texture at web/${TEXTURES}${name}.png; that surface stays as it was`);
  });
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
  // Grass is a nap rather than a pattern, so the sheet is tiled small and often. Three
  // units - twelve metres - is about as large as it can be before the eye starts to read
  // the sheet itself instead of the ground.
  const GRASS_UNITS = 3;
  const uv = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = i + j * N;
      pos[k * 3] = i - half;
      pos[k * 3 + 1] = terrain.H[k];
      pos[k * 3 + 2] = j - half;
      uv[k * 2] = (i - half) / GRASS_UNITS;
      uv[k * 2 + 1] = (j - half) / GRASS_UNITS;
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
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  // Whose land a ground vertex stands on, and how far inside it. A vertex touches up to
  // four cells, and `inset` already ramps over three of them, so the tint feathers over
  // about three world units for free - farmland fading into heath rather than a border
  // drawn on a political map.
  const tintHue = new Float32Array(N * N);
  const tintAmt = new Float32Array(N * N);
  function computeTint(owner, inset, hues) {
    tintAmt.fill(0);
    if (!owner) return;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let best = NONE, depth = 0;
        for (const [dx, dz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
          const gx = i + dx, gz = j + dz;
          if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
          const o = owner[gx + gz * size];
          if (o === NONE) continue;
          const d = inset[gx + gz * size];
          if (best === NONE || d > depth || (d === depth && o < best)) { best = o; depth = d; }
        }
        const k = i + j * N;
        if (best === NONE || hues[best] == null) continue;
        tintHue[k] = hues[best];
        tintAmt[k] = Math.min(1, depth / 3);
      }
    }
  }

  const TINT = 0.11;          // past about 0.14 the hue reads as a category, not as soil
  const meadowNoise = makeSimplex2D(hash32(`meadow:${village.seed || 0}`));
  function paintGround(seasonName) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = i + j * N;
        const h = terrain.H[k];
        tmpColor.setHex(bandColour(h, seasonName));
        // Broad, stable patches of colour soften the grid without textures or geometry.
        if (h >= 0.35 && h < 3.4) {
          tmpColor.multiplyScalar(1 + meadowNoise(i * 0.12, j * 0.12) * 0.065);
        }
        const a = tintAmt[k];
        // Meadow and upland only: tinting the sand or the summit is what would make this
        // look like an overlay rather than like farmland.
        if (a > 0 && h >= 0.35 && h < 3.4) {
          tmpTint.setHSL(tintHue[k] / 360, 0.3, 0.5);
          tmpColor.lerp(tmpTint, TINT * a);
          tmpColor.offsetHSL(0, 0, 0.015 * a);
        }
        col[k * 3] = tmpColor.r; col[k * 3 + 1] = tmpColor.g; col[k * 3 + 2] = tmpColor.b;
      }
    }
    geo.attributes.color.needsUpdate = true;
  }

  // The colour the ground has already been painted at a world point, read straight out of
  // the attribute above. A decal drawn on the ground can then end in the colour of the
  // ground it ends on, which is a feather that costs no alpha, no second pass and no
  // sorting: the outer edge of a patch of trodden earth simply *is* the meadow, so there
  // is no edge to see. Bilinear rather than nearest because the season, the height band
  // and the district tint all live in these numbers and a patch is only half a cell wider
  // than the thing it sits under - a whole vertex of error would show as a step.
  function groundColourAt(x, z, out) {
    const fx = clamp(x + half, 0, size - 1e-6), fz = clamp(z + half, 0, size - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j;
    const k00 = (i + j * N) * 3, k10 = k00 + 3, k01 = k00 + N * 3, k11 = k01 + 3;
    out.setRGB(
      lerp(lerp(col[k00], col[k10], u), lerp(col[k01], col[k11], u), w),
      lerp(lerp(col[k00 + 1], col[k10 + 1], u), lerp(col[k01 + 1], col[k11 + 1], u), w),
      lerp(lerp(col[k00 + 2], col[k10 + 2], u), lerp(col[k01 + 2], col[k11 + 2], u), w),
    );
    return out;
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: false, roughness: 0.96, metalness: 0,
  }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);
  // The bands, the season, the district tint and the meadow noise are all already in the
  // vertex colours. The sheet is brightness only, so it grains the ground without having
  // an opinion about any of them.
  sheet('grass', (tex) => { ground.material.map = tex; ground.material.needsUpdate = true; });

  // ---- sea, the lake and the rivers ---------------------------------------
  // One surface for all the water there is: everything below SEA_LEVEL is under this
  // plane and the ground mesh hides it everywhere else, which is how the lake has always
  // been drawn and is now how the rivers are drawn too. A river is only about two cells
  // across, though, and the old two-unit grid put barely a vertex in the channel - the
  // depth it shaded by came from the bank. Hence a vertex per unit here.
  //
  // 260 was a fixed number that happened to fit a grid of 140 with room to spare. A grid
  // can be 512, and then the detailed patch stopped at 130 while the coast ran on to 256:
  // half the island's own water had no rivers shaded into it. It follows the island now,
  // with the same margin - which on a small island is less to draw than before, not more.
  const wSpan = Math.max(260, size + 120);
  const wSeg = opts.modest ? Math.round(wSpan / 2) : wSpan;
  const waterGeo = new THREE.PlaneGeometry(wSpan, wSpan, wSeg, wSeg);
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
        uDeep: { value: new THREE.Color(0x215e78) },
        uShallow: { value: new THREE.Color(0x65c4b5) },
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
        float foam = smoothstep(-0.32, -0.02, vDepth) * (0.55 + 0.45 * sin(uTime * 1.3 + vDepth * 28.0 + sin(vWorld.x * 0.7 + vWorld.z * 0.5)));
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.65);
        vec3 n = normalize(vWave);
        vec3 v = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        col = mix(col, uShallow, fresnel * 0.18);
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

  // The open sea, beyond the detailed patch. It used to be a flat blue card of radius 500,
  // which was enough while nothing stood on it. The neighbours do: they lie at 150 to 190
  // and an island of the largest grid reaches 256 further again, so the far water is
  // something you look at rather than past. It is the same shader now, sharing the same
  // uniforms so there is one clock and one sun over the whole sea, and it runs out to
  // 1200 - inside the camera's far plane, with the sky grown to stay outside it.
  //
  // A handful of segments is all it needs. Out here `aDepth` is the same -2.5 the patch
  // gives everything past its own edge, so the colour is constant and there is nothing to
  // interpolate; the waves are 5 cm on a surface a kilometre across.
  //
  // Opaque, unlike the patch, because there is nothing underneath it to show through.
  const OCEAN_R = 1200;
  const oceanGeo = new THREE.CircleGeometry(OCEAN_R, 128);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanDepth = new Float32Array(oceanGeo.attributes.position.count).fill(-2.5);
  oceanGeo.setAttribute('aDepth', new THREE.BufferAttribute(oceanDepth, 1));
  const oceanMat = waterMat.clone();
  oceanMat.uniforms = waterMat.uniforms;   // one clock, one sun, one nightfall
  oceanMat.transparent = false;
  oceanMat.depthWrite = true;
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  // Wave troughs reach -0.09. Keep the backdrop underneath them to avoid blue tiles: this
  // disc carries the same wave, but with a vertex only at its centre and its rim it is
  // flat where the patch is not, so the two do not dip together.
  ocean.position.y = -0.2;
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
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1340, 26, 16), skyMat);   // outside the sea, inside the camera's far plane
  sky.frustumCulled = false;
  group.add(sky);

  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(11, 14, 10), new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false }));
  const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(8, 14, 10), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false }));
  group.add(sunDisc, moonDisc);

  // The haze exists here because every material has to compile knowing there is fog, but
  // the two distances are set from main.js and nowhere else. They used to be set in both
  // places - scaled to the island here, overwritten with a fixed 235 on every neighbour
  // sync there - and the fixed pair always won. Colour still follows the sky, below.
  scene.fog = new THREE.Fog(0xdcefff, terrain.half * 1.1, terrain.half * 3.4);

  // ---- lights --------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x8f8a60, 0.85);
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  const key = new THREE.DirectionalLight(0xfff8ea, 3.0);
  key.castShadow = true;
  key.shadow.mapSize.set(opts.shadowSize || 2048, opts.shadowSize || 2048);
  // Half-width of the shadow frustum. `followShadow` moves it with the zoom, so this is
  // only the tightest it ever gets; SHADOW_SPAN below says what the numbers mean.
  key.shadow.camera.left = -SHADOW_SPAN[0]; key.shadow.camera.right = SHADOW_SPAN[0];
  key.shadow.camera.top = SHADOW_SPAN[0]; key.shadow.camera.bottom = -SHADOW_SPAN[0];
  key.shadow.camera.near = 10; key.shadow.camera.far = 2 * SHADOW_SPAN[0] + 90;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  // One step softer, now that the sun is low enough for a shadow to run the length of a
  // lane: a hard edge that far from its caster reads as a painted stripe. PCFSoft only,
  // so `modest` (PCFShadowMap, which ignores the radius) is untouched.
  key.shadow.radius = 4;
  scene.add(hemi, ambient, key, key.target);

  // ---- vegetation ----------------------------------------------------------
  // Two sets, and the difference matters. `clearedBase` is ground that buildings, roads
  // and squares have taken - that is what decides where a field may go. `cleared` is that
  // plus the fields themselves, which is what keeps the forest from growing on top of
  // them. Planning fields against `cleared` would find nothing the second time round,
  // because the first plan's own cells would have ruled every candidate out.
  const baseCleared = (v) => {
    const out = new Set((v.cleared || []).map(([gx, gz]) => gx + gz * size));
    // The wire clears the paths but not every paved cell of a square, and a field
    // planned over paving comes out as furrows running across the stones. It never
    // showed while the paving was a flat sandy colour and the furrows were sandy too;
    // against cobbles it is the first thing you see.
    for (const [gx, gz] of squareCells(v)) out.add(gx + gz * size);
    // A bridge is a road that happens to be off the ground, and nothing grows on a
    // deck. Without this the scatter plants a wood straight through the planks - which
    // is exactly what it was doing, because the wire does not clear a bridge either.
    for (const b of v.bridges || []) for (const [gx, gz] of b.cells || []) out.add(gx + gz * size);
    // A dike is a wall and a causeway is a road. Neither is ground that grows anything,
    // and both are flat and high enough that the scatter below would otherwise plant
    // trees along the top of the sea wall.
    for (const p of v.polders || []) {
      for (const [gx, gz] of [...(p.dike || []), ...(p.road || [])]) out.add(gx + gz * size);
    }
    for (const b of v.buildings || []) {
      if (!b.plot) continue;
      for (let z = -1; z <= b.plot.d; z++) for (let x = -1; x <= b.plot.w; x++) out.add((b.plot.gx + x) + (b.plot.gz + z) * size);
    }
    return out;
  };
  // How much of the countryside is under the plough. The chronicle hands down a share so
  // the fields arrive with the village that works them; a live village has none and gets
  // the full spread.
  const fieldOpts = (v) => (v.farmShare == null ? {} : { coverage: FIELD_COVERAGE * v.farmShare });

  // Which cells the settlers walk on. The hedges have always needed this to know where to
  // leave a gate; the fields and the forest now need it too, because how far a cell is
  // from a road is most of what decides whether anybody ploughs it or nobody has ever
  // cleared it. Built once here rather than three times over.
  const roadSet = (v) => {
    const out = new Set();
    for (const p of v.paths || []) for (const c of p.cells) out.add(c[0] + c[1] * size);
    for (const c of squareCells(v)) out.add(c[0] + c[1] * size);
    return out;
  };

  let clearedBase = baseCleared(village);
  const cleared = new Set(clearedBase);
  // Reclaimed land is farmland, not heath. It sits at POLDER_H, just under the height
  // the scatter treats as shore, so without this every polder comes out strewn with
  // boulders - about one cell in ten. It stays out of `clearedBase` so that a hamlet
  // which settles a polder still gets its fields.
  for (const p of village.polders || []) {
    for (const [gx, gz] of p.cells || []) cleared.add(gx + gz * size);
  }

  let own = decodeOwnership(village, size);
  let hues = village.districts.map((d) => d.hue);
  // Before the fields are planned, not after: clearedBase is what planFields reads to
  // decide where a patch may go.
  wallVerge(own.owner, clearedBase);
  wallVerge(own.owner, cleared);
  let roads = roadSet(village);
  let settled = settledDistance(terrain, own.owner, roads);
  let fieldPlan = planFields(village, terrain, own.owner, clearedBase, { ...fieldOpts(village), settled });
  computeTint(own.owner, own.inset, hues);
  paintGround(season);
  // Tilled ground is cleared ground: without this the forest is scattered straight on
  // top of the fields.
  for (const p of [...fieldPlan.patches, ...fieldPlan.orchards, ...fieldPlan.gardens]) {
    for (const [gx, gz] of p.cells) cleared.add(gx + gz * size);
  }

  // A tree is dropped at its cell's middle give or take 0.38, and an oak's canopy is
  // 0.45 across, so it reaches 0.83 from the middle - a third of a cell past its own
  // edge. A boundary wall stands on that edge and is up to 0.5 thick, so a tree beside
  // one goes straight through it. There is no offset that fixes this: half a cell minus
  // half a wall leaves 0.25, and the canopy alone is 0.44. So the wall gets a verge, and
  // a cell that touches a boundary is simply not planted.
  //
  // It began as a rule about trees, on the reasoning that a field may run right up to a
  // wall. It may not: a patch is a rectangle laid over whole cells and it will happily
  // take the cells either side of a boundary, so the ploughing ran under the wall and out
  // into the next hamlet's land. The verge is now the same for both - nothing is planted
  // and nothing is tilled on a cell that touches a boundary, which also gives every wall
  // the strip of grass along it that a wall in a field has anyway.
  //
  // This mirrors the test in buildBorders(): the town puts up no hedge and the coast is
  // its own boundary, so neither of those earns a verge.
  function wallVerge(ownerArr, into) {
    const at = (gx, gz) => (gx < 0 || gz < 0 || gx >= size || gz >= size ? NONE : ownerArr[gx + gz * size]);
    const walled = (o) => o !== NONE && o !== TOWN;
    for (let gz = 0; gz < size; gz++) {
      for (let gx = 0; gx < size; gx++) {
        const k = at(gx, gz);
        if (!walled(k)) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = at(gx + dx, gz + dz);
          if (n === k || !terrain.isLand(gx + dx, gz + dz)) continue;
          into.add(gx + gz * size);
          if (walled(n) || n === NONE) into.add((gx + dx) + (gz + dz) * size);
        }
      }
    }
  }

  const rng = makeRng(terrain.seed).fork('flora');
  const forest = makeSimplex2D(hash32(terrain.seed + ':forest'));

  // The trunk runs 0 to 0.5 and the first cone now starts at 0.42, so its skirt closes
  // over the wood instead of hanging above it. The tree loses a little height by it,
  // which the trunk takes back: a conifer is mostly stem at the bottom anyway.
  //
  // Both are merged with groups, so trunk and canopy are separate draws off one geometry
  // and can take bark and needles rather than one sheet stretched over the whole tree.
  const pineGeo = merge([
    cyl(0.06, 0.09, 0.62, 5, 0x6b4a2f, 0.31),
    cone(0.42, 0.8, 6, 0x3f7d47, 0.42),
    cone(0.3, 0.7, 6, 0x478950, 0.85),
  ], true);
  const oakGeo = merge([
    cyl(0.07, 0.09, 0.5, 5, 0x6b4a2f, 0.25),
    ico(0.45, 0x5c9a3f, 0.72, 0.85),
  ], true);
  const rockGeo = dodeca(0.22, 0x7f7a72, 0.1);
  const grassGeo = cone(0.08, 0.18, 3, 0x7fb64d, 0.09);
  for (const g of [rockGeo, grassGeo]) g.computeVertexNormals();

  // ---- where the forest stands ---------------------------------------------
  // It used to be noise alone, which put the same even spatter of trees on the town
  // square's doorstep as on the far headland - nowhere was a clearing and nowhere was a
  // wood. The same distance field the fields are surveyed against shapes it now: inside
  // six cells of a door or a lane the canopy is pulled open, from eight out to twenty-four
  // it thins into heath with copses standing in it, and past that it closes into the dark
  // pine edge the island is meant to be ringed by. `cleared` is still the hard line, so a
  // polder stays bare grass however far from anybody it lies.
  const NEAR_CLEARING = 0.15;   // canopy a doorstep takes away
  const FAR_CANOPY = 0.35;      // canopy the wilderness adds back
  // Past CLOSED the third stem on a cell is bought and never seen: the canopy over it is
  // already shut. Past DEEP one stem to a cell is a wood from any distance the camera can
  // get to. Neither is a saving for its own sake - the trees are instanced and cost one
  // draw call between them - but the shadow pass walks every instance on the island, and
  // that is the bill `?stats` cannot show you, because three resets renderer.info after
  // the shadow pass and before the colour one.
  const CLOSED = 20, DEEP = 36;
  const TREE_CAP = opts.modest ? 9000 : 25000;

  // How many stems this cell wants. Noise and distance only - not one random number in
  // it - which is what makes the counting pass below affordable.
  const stems = (gx, gz, wx, wz) => {
    const d = settled.dist[gx + gz * size];
    const dens = fbm2(forest, wx * 0.09, wz * 0.09, { octaves: 3 })
      - NEAR_CLEARING * (1 - smoothstep(0, 6, d))
      + FAR_CANOPY * smoothstep(8, 24, d);
    if (dens < 0.12) return 0;
    let n = 1 + (dens > 0.3 ? 1 : 0) + (dens > 0.45 ? 1 : 0);
    if (d > CLOSED) n = Math.min(n, 2);
    if (d > DEEP) n = 1;
    return n;
  };
  const plantable = (gx, gz, h) =>
    !cleared.has(gx + gz * size) && h >= 0.45 && !terrain.isBeach(gx, gz)
    && terrain.slope(gx, gz) <= 1.3 && h <= 5.0;

  // Count first, plant second. Stopping dead once the budget is full would plant in the
  // order `landCells` happens to come in and leave one whole side of the island bald; a
  // ratio takes the same number of stems off evenly, and which cell loses one is decided
  // by that cell's own hash rather than by where the loop had got to. One extra noise
  // lookup per cell is the whole price.
  let wanted = 0;
  for (const [gx, gz] of terrain.landCells) {
    const h = terrain.heightAt(gx, gz);
    if (!plantable(gx, gz, h)) continue;
    const [wx, wz] = terrain.cellWorld(gx, gz);
    wanted += stems(gx, gz, wx, wz);
  }
  const thin = wanted > TREE_CAP ? TREE_CAP / wanted : 1;

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
    let n = stems(gx, gz, wx, wz);
    if (rng.chance(0.5)) tufts.push([wx + rng.range(-0.45, 0.45), wz + rng.range(-0.45, 0.45), rng.range(0.7, 1.3)]);
    if (thin < 1) {
      // Stochastic rounding on a spatial hash: the expected count is exactly `n * thin`,
      // and it is the same on every reload and the same for every viewer.
      const want = n * thin;
      n = Math.floor(want);
      if ((hash32(`thin:${gx},${gz}`) % 1000) / 1000 < want - n) n += 1;
    }
    if (!n) continue;
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
  // Same material, twice, with a sheet each. Clones rather than new materials so that a
  // tree with no textures at all is pixel for pixel the tree the island always drew.
  const barkMat = treeMat.clone();
  const foliageMat = treeMat.clone();
  sheet('bark', (tex) => { tex.repeat.set(2, 1); barkMat.map = tex; barkMat.needsUpdate = true; });
  sheet('foliage', (tex) => { tex.repeat.set(2, 2); foliageMat.map = tex; foliageMat.needsUpdate = true; });
  const pineMats = [barkMat, foliageMat, foliageMat];
  const oakMats = [barkMat, foliageMat];
  const orchard = orchardTrees(fieldPlan, terrain);
  const ORCHARD_CAP = 1500;
  const pineMesh = new THREE.InstancedMesh(pineGeo, pineMats, Math.max(1, pines.length));
  const oakMesh = new THREE.InstancedMesh(oakGeo, oakMats, Math.max(1, oaks.length));
  const rockMesh = new THREE.InstancedMesh(rockGeo, treeMat, Math.max(1, rocks.length));
  const grassMesh = new THREE.InstancedMesh(grassGeo, treeMat, Math.max(1, tufts.length));
  const orchardMesh = new THREE.InstancedMesh(oakGeo, oakMats, ORCHARD_CAP);
  for (const m of [pineMesh, oakMesh, rockMesh, orchardMesh]) { m.castShadow = true; m.receiveShadow = true; }
  grassMesh.castShadow = false;
  group.add(pineMesh, oakMesh, rockMesh, grassMesh, orchardMesh);

  // Planted rather than scattered: a grid, one size, barely any rotation.
  function placeOrchard(list, seasonName) {
    orchardMesh.count = Math.min(ORCHARD_CAP, list.length);
    const autumn = seasonName === 'autumn';
    for (let i = 0; i < orchardMesh.count; i++) {
      const [x, z, sc] = list[i];
      tmpObj.position.set(x, terrain.worldHeight(x, z) - 0.02, z);
      tmpObj.rotation.set(0, ((hash32(`o${x},${z}`) % 12) / 12) * 0.5, 0);
      tmpObj.scale.set(sc, sc * 1.05, sc);
      tmpObj.updateMatrix();
      orchardMesh.setMatrixAt(i, tmpObj.matrix);
      const tint = autumn ? 0xd7a24a : 0x6fae4a;
      orchardMesh.setColorAt(i, tmpColor.setHex(tint).multiplyScalar(0.9 + ((hash32(`t${x},${z}`) % 20) / 100)));
    }
    orchardMesh.instanceMatrix.needsUpdate = true;
    if (orchardMesh.instanceColor) orchardMesh.instanceColor.needsUpdate = true;
  }
  placeOrchard(orchard, season);

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

  // ---- trodden earth -------------------------------------------------------
  // A house used to end where its stone plinth ended, on grass that was as green a
  // millimetre from the doorstep as it was out on the headland. Nobody's front garden
  // looks like that: the ground in front of a door is walked bare, and the grass along a
  // lane gives up a hand's breadth either side of it. Two decals, one merged layer.
  //
  // The trick that makes them read is the outer ring. It is laid at the colour the ground
  // already is at that exact spot - the season, the height band and the district tint all
  // come out of `groundColourAt` - so the patch has no edge at all: it fades from bare
  // earth into whatever the meadow happens to be there, with no alpha, no second pass and
  // nothing to sort. It doubles as the contact shadow the island never had, because the
  // earth is darker than the grass and the darkest of it is right against the wall.
  //
  // Lifts on the ground are a stack, and this is the bottom of it: earth 0.03, river
  // shingle 0.035, paving and tilth 0.045, furrows 0.055. The polygon offset is a notch
  // gentler than the layers above for the same reason - it pulls this one towards the
  // camera less, so the order the lifts ask for is the order the depth buffer gets even
  // from across the island, where a hundredth of a unit is thinner than a depth step.
  const WEAR_LIFT = 0.03;
  const WEAR_EARTH = 0x99855f;      // trodden, dry, a little warmer than ploughed soil
  const WEAR_SAND = 0xbda981;       // the sand a lane sheds into the grass beside it
  const WEAR_FEATHER = 0.36;        // how far either of them takes to become meadow again
  const YARD_R = 0.36;              // corner radius of a yard; nothing here is square
  const YARD_SEG = 4;               // and how many steps that corner is drawn in
  const YARD_INSET = 0.5;           // grass left round the edge of a three-cell plot
  // Street furniture is not a building. A bench, a lamp or a flower bed stands *on* the
  // grass of the square and nobody has worn a yard round it, and the well and the
  // fountain are round - a rectangle of earth under either would be the corner they just
  // stopped having. Same list as `NO_PORCH` in buildings.js and for the same reason,
  // written out here because the two answer different questions and neither should start
  // deciding the other's.
  const NO_WEAR = new Set(['bench', 'lamp', 'planter', 'terrace', 'tables', 'board', 'issues',
    'statue', 'well', 'fountain', 'watertower']);
  let wearMesh = null;
  let wearVillage = village;
  // What the last pass of `buildPaths` laid, so the verge is cut from exactly the shapes
  // the paving got rather than from a second guess at them: the tiles at the junctions
  // and the swept ribbons in between. `CORNER_R` and `CORNER_SEG` down in the footpaths
  // section are borrowed for the same reason.
  const paved = [];
  const pavedLanes = [];
  let pavedSet = new Set();
  const onRoad = (x, z) => pavedSet.has(Math.floor(x + half) + Math.floor(z + half) * size);

  function buildGroundWear() {
    if (wearMesh) {
      group.remove(wearMesh);
      wearMesh.geometry.dispose();
      wearMesh.material.dispose();
      wearMesh = null;
    }
    const pos = [], col = [], idx = [];
    let v = 0;
    const vertex = (x, z, c) => {
      pos.push(x, terrain.worldHeight(x, z) + WEAR_LIFT, z);
      col.push(c.r, c.g, c.b);
    };
    // A ring fanned from its own middle, in one colour: the bare ground itself.
    const fan = (ring, cx, cz, hex) => {
      tmpColor.setHex(hex);
      const centre = v;
      vertex(cx, cz, tmpColor);
      for (const [x, z] of ring) vertex(x, z, tmpColor);
      for (let k = 0; k < ring.length; k++) idx.push(centre, centre + 1 + k, centre + 1 + ((k + 1) % ring.length));
      v += ring.length + 1;
    };
    // And the skirt round it: the same ring again, pushed out by the feather, in the
    // colour of the ground out there. Both rings are asked of `roundedOutline` with the
    // same corners and the same segment count, so they come back the same length and the
    // strip between them zips up without a seam.
    //
    // `skip` leaves a stretch of it out. The verge needs that: a cell of paving hands over
    // its whole outline, joints included, and a strip laid along a joint runs off under
    // the next cell's paving - where it is not reliably hidden, because a path tile is one
    // flat fan across a unit of ground that may be curved and the hundredth of a unit
    // between the two lifts is thinner than that curve. So the joints are simply not
    // drawn, which is cheaper as well.
    const skirt = (inner, outer, hex, skip = null) => {
      const base = v;
      for (let k = 0; k < inner.length; k++) {
        tmpColor.setHex(hex);
        vertex(inner[k][0], inner[k][1], tmpColor);
        vertex(outer[k][0], outer[k][1], groundColourAt(outer[k][0], outer[k][1], tmpGround));
      }
      for (let k = 0; k < inner.length; k++) {
        const n = (k + 1) % inner.length;
        if (skip && skip(inner[k], inner[n])) continue;
        const a = base + k * 2, b = base + n * 2;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
      v += inner.length * 2;
    };

    // The yards. A three-cell plot keeps half a cell of grass round the outside, which is
    // where the hedge and the neighbour's lane are; what is left is a rectangle of earth
    // a little larger than the house standing on it, so the walls come out of bare ground
    // and the porch no longer sits on a lawn.
    for (const b of wearVillage.buildings || []) {
      if (!b.plot || b.harbour) continue;
      if (b.kind === 'civic' && NO_WEAR.has(b.civicType)) continue;
      const [ax, az] = terrain.cellWorld(b.plot.gx, b.plot.gz);
      const [bx, bz] = terrain.cellWorld(b.plot.gx + b.plot.w - 1, b.plot.gz + b.plot.d - 1);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const hw = Math.max(0.45, b.plot.w / 2 - YARD_INSET);
      const hd = Math.max(0.45, b.plot.d / 2 - YARD_INSET);
      const inner = roundedOutline(cx - hw, cz - hd, cx + hw, cz + hd, YARD_R, YARD_SEG);
      const f = WEAR_FEATHER;
      const outer = roundedOutline(cx - hw - f, cz - hd - f, cx + hw + f, cz + hd + f, YARD_R + f, YARD_SEG);
      fan(inner, cx, cz, WEAR_EARTH);
      skirt(inner, outer, WEAR_EARTH);
    }

    // The verge along a lane follows the ribbon rather than the cells under it. A lane
    // bends now, and a band of sand cut to the cells beside a bend would stick out past
    // the paving in little square tabs at every corner - which is the very staircase the
    // ribbon was drawn to get rid of.
    for (const lane of pavedLanes) {
      const f = WEAR_FEATHER * 0.6;      // a lane sheds less than a doorstep wears
      for (const side of [1, -1]) {
        const base = v;
        for (let i = 0; i < lane.curve.length; i++) {
          const p = lane.curve[i], n = lane.nrm[i];
          const ox = p[0] + n[0] * (lane.hw + f) * side, oz = p[1] + n[1] * (lane.hw + f) * side;
          tmpColor.setHex(WEAR_SAND);
          vertex(p[0] + n[0] * lane.hw * side, p[1] + n[1] * lane.hw * side, tmpColor);
          vertex(ox, oz, groundColourAt(ox, oz, tmpGround));
        }
        for (let i = 0; i + 1 < lane.curve.length; i++) {
          const a = base + i * 2, c = base + (i + 1) * 2;
          if (side > 0) idx.push(a, a + 1, c, a + 1, c + 1, c);
          else idx.push(a + 1, a, c, a + 1, c, c + 1);
        }
        v += lane.curve.length * 2;
      }
    }

    // And round the tiles at the junctions. Only the skirt, and only where the paving
    // ends: the middle of a cell is under the paving, and a joint with the next cell is
    // under that one. Which stretch is which is settled by looking - a step outward from
    // the middle of a stretch either lands on paving, and then it is a joint, or it lands
    // on grass, and then it is the edge of the lane and wants sand along it.
    for (const t of paved) {
      const f = WEAR_FEATHER * 0.6;      // a lane sheds less than a doorstep wears
      const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
      const inner = roundedOutline(t.x0, t.z0, t.x1, t.z1, CORNER_R, CORNER_SEG, t.corners);
      const outer = roundedOutline(t.x0 - f, t.z0 - f, t.x1 + f, t.z1 + f, CORNER_R + f, CORNER_SEG, t.corners);
      skirt(inner, outer, WEAR_SAND, (a, b) => {
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        const dx = mx - cx, dz = mz - cz, d = Math.hypot(dx, dz) || 1;
        return onRoad(mx + (dx / d) * 0.2, mz + (dz / d) * 0.2);
      });
    }

    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    wearMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    wearMesh.receiveShadow = true;
    group.add(wearMesh);
  }

  // ---- footpaths -----------------------------------------------------------
  let laneMeshes = [];
  let pathTexture = null, sandTexture = null;
  // Only the town square and a village green are laid in stone. A hamlet's green stays
  // grass - a plaza three cells across, thirty times over, reads as a rash of empty
  // patios - so the wire only names the ones that are actually paved.
  function squareCells(v) {
    const out = [];
    const town = v.island && v.island.town;
    if (town && town.paved) out.push(...town.paved);
    else if (town && town.square) {
      const n = town.size || 3;
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out.push([town.square[0] + x, town.square[1] + z]);
    }
    for (const d of v.districts || []) for (const c of d.paved || []) out.push(c);
    return out;
  }

  // The two surfaces the island is walked on, and which sheet each takes. Both sheets are
  // seamless and both are tiled in world space rather than per quad: a lane running across
  // three cells reads as one continuous surface instead of the same stamp laid three
  // times. A cell is one world unit and four metres, so a sheet to the unit puts a cobble
  // at about half a metre - and the sand is tiled at half that frequency, because grit has
  // no size of its own and the coarser tile is what keeps its repeat out of sight.
  const TEX_UNITS = { stone: 1, plaza: 1, sand: 2 };
  // Half the width of a lane, and how much of an outside corner is taken off a tile. The
  // ribbon is swept at exactly the half-width a tile is drawn to, so a tile and the lane
  // leaving it meet edge to edge with nothing to line up by hand. Both went up a notch
  // with the sand: a sandy track two and a half metres across reads as a track, where the
  // same width in cobbles read as a kerbed street.
  const H = 0.30;
  const CORNER_R = 0.3;
  const CORNER_SEG = 6;
  const LIFT = 0.045;
  // How far a lane's middle may end up from a cell middle it was built from. This is a
  // bound rather than a taste: settlers walk cell middles (`settlers.js`, a four-connected
  // BFS) and `gateOf` in main.js looks a road cell up by its middle, so paving that has
  // wandered off them would put the whole village walking beside its own paths. At 0.18
  // the sharpest corner on the island still has a tenth of a unit of paving outside the
  // middle. `smoothLane` keeps to it by construction; tests/paths.test.mjs holds it there.
  const LANE_DEV = 0.18;
  // Multiplied over the sheet, so these are tints rather than colours: the square is laid
  // in clean stone, a road in the same stone gone duller underfoot, and a footpath between
  // two front doors in sand. With no sheet to multiply they stand on their own, and are
  // the sand and flagstone the island had before there was a sheet to lay.
  const TINTED = { stone: 0xd9d2c6, plaza: 0xffffff };
  const PLAIN = { stone: 0xcbb691, plaza: 0xd6cbb2 };
  const SAND = 0xcbb68f;            // one colour either way: its sheet has none of its own
  // `path-sand.png` is brightness only and averages about four fifths, and multiplying
  // that over a colour that is already sand makes mud of it. The lift puts the average
  // back where the flat colour was, so the sheet spends its range on grit rather than on
  // gloom - the same correction the fields make for their tilth.
  const SAND_SHEET_AVG = 0.82;

  function buildPaths(paths, squares = squareCells(village)) {
    for (const m of laneMeshes) { group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    laneMeshes = [];
    const graph = roadGraph(paths, squares, terrain.size);
    const tintOf = (kind) => (kind === 'sand' ? SAND : (pathTexture ? TINTED : PLAIN)[kind]);
    // One buffer per sheet. The cobbles carry their own colour and the sand does not, so
    // the two cannot share a material; everything else the island walks on shares one of
    // these, which is two draw calls for the whole road network.
    const buf = { stone: bucket(), sand: bucket() };
    const into = (kind) => (kind === 'sand' ? buf.sand : buf.stone);
    const vertex = (b, x, z, units) => {
      b.pos.push(x, terrain.worldHeight(x, z) + LIFT, z);
      b.uv.push(x / units, z / units);
      b.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    };

    // The junctions, the dead ends and every cell of a plaza: a tile on its own middle,
    // widened towards whichever neighbours carry on, exactly as the whole road used to be
    // drawn. A crossing has to be paving at the cell middle, and a plaza is not a path.
    paved.length = 0;
    pavedSet = new Set(graph.kind.keys());
    for (const t of graph.tiles) {
      const [x, z] = terrain.cellWorld(t.gx, t.gz);
      const x0 = x - (t.west ? 0.5 : H), x1 = x + (t.east ? 0.5 : H);
      const z0 = z - (t.north ? 0.5 : H), z1 = z + (t.south ? 0.5 : H);
      const corners = [!t.west && !t.north, !t.west && !t.south, !t.east && !t.south, !t.east && !t.north];
      const ring = roundedOutline(x0, z0, x1, z1, CORNER_R, CORNER_SEG, corners);
      paved.push({ x0, z0, x1, z1, corners });
      const b = into(t.kind), units = TEX_UNITS[t.kind];
      tmpColor.setHex(tintOf(t.kind));
      const centre = b.v;
      vertex(b, (x0 + x1) / 2, (z0 + z1) / 2, units);
      for (const [qx, qz] of ring) vertex(b, qx, qz, units);
      for (let k = 0; k < ring.length; k++) b.idx.push(centre, centre + 1 + k, centre + 1 + ((k + 1) % ring.length));
      b.v += ring.length + 1;
    }

    // And everything between them: one swept ribbon per chain of cells. It starts and ends
    // on the edge of the tile it leaves, so the two abut with neither a gap nor an overlap
    // to z-fight over, and it passes through every cell middle in between.
    const centreOf = (c) => terrain.cellWorld(c[0], c[1]);
    const between = (a, b) => {
      const [ax, az] = centreOf(a), [bx, bz] = centreOf(b);
      return [(ax + bx) / 2, (az + bz) / 2];
    };
    pavedLanes.length = 0;
    for (const chain of graph.chains) {
      const line = [between(chain.from, chain.run[0])];
      for (const c of chain.run) line.push(centreOf(c));
      if (chain.to) line.push(between(chain.run[chain.run.length - 1], chain.to));
      const curve = smoothLane(line, LANE_DEV);
      const nrm = laneNormals(curve);
      pavedLanes.push({ curve, nrm, hw: H });
      const b = into(chain.kind), units = TEX_UNITS[chain.kind];
      tmpColor.setHex(tintOf(chain.kind));
      const base = b.v;
      for (let i = 0; i < curve.length; i++) {
        const p = curve[i], n = nrm[i];
        vertex(b, p[0] + n[0] * H, p[1] + n[1] * H, units);
        vertex(b, p[0] - n[0] * H, p[1] - n[1] * H, units);
      }
      for (let i = 0; i + 1 < curve.length; i++) {
        const a = base + i * 2, c = base + (i + 1) * 2;
        b.idx.push(a + 1, a, c, a + 1, c, c + 1);
      }
      b.v += curve.length * 2;
    }

    for (const [kind, b] of Object.entries(buf)) {
      if (!b.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(b.idx);
      g.computeVertexNormals();
      const map = kind === 'sand' ? sandTexture : pathTexture;
      const mat = new THREE.MeshStandardMaterial({
        map, vertexColors: true, flatShading: true, roughness: 1,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      if (kind === 'sand' && sandTexture) mat.color.setScalar(1 / SAND_SHEET_AVG);
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      laneMeshes.push(mesh);
      group.add(mesh);
    }
    // The verge is cut from the shapes this pass just laid, so it is turned over whenever
    // the paving is - a route the router has changed leaves no strip of sand lying in the
    // grass where the old one ran.
    buildGroundWear();
  }
  buildPaths(village.paths);

  // The sheets arrive after the island is already standing, so the paving is laid again
  // the moment each one lands. If one never lands the island keeps the colours it had,
  // which is why the tints and the plain colours are two separate sets rather than one set
  // the texture is expected to rescue.
  sheet('path-cobble', (tex) => { pathTexture = tex; buildPaths(village.paths); });
  sheet('path-sand', (tex) => { sandTexture = tex; buildPaths(village.paths); });

  // ---- riverbanks ----------------------------------------------------------
  // The water itself needs nothing drawn: it is under the same plane as the sea, and the
  // height bands already put sand along a channel that has cut down to below sea level.
  // What is missing is any sign that it is fresh water rather than a wet ditch, so the
  // banks get a shingle decal at the waterline and a stand of reeds along it. Rivers are
  // part of the terrain and never change, so this is built once.
  function buildRiverBanks() {
    if (!terrain.riverBankCells || !terrain.riverBankCells.length) return null;
    const pos = [], col = [], idx = [];
    let v = 0;
    const tri = (a, b, c, hex) => {
      tmpColor.setHex(hex);
      for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(tmpColor.r, tmpColor.g, tmpColor.b); }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 1);      // both faces: a blade has no back
      v += 3;
    };
    const shingleQuad = (x0, z0, x1, z1, hex) => {
      tmpColor.setHex(hex);
      for (const [qx, qz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        pos.push(qx, terrain.worldHeight(qx, qz) + 0.035, qz);
        col.push(tmpColor.r, tmpColor.g, tmpColor.b);
      }
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      v += 4;
    };
    for (const [gx, gz] of terrain.riverBankCells) {
      const [x, z] = terrain.cellWorld(gx, gz);
      const h = hash32(`bank:${gx},${gz}`);
      shingleQuad(x - 0.5, z - 0.5, x + 0.5, z + 0.5, (h & 1) ? 0x9a8a6a : 0x8d7d60);
      // Reeds only where the bank is close to the waterline; the top of a ravine is dry.
      if (terrain.worldHeight(x, z) > 0.9) continue;
      const clumps = 1 + (h % 3);
      for (let n = 0; n < clumps; n++) {
        const g = hash32(`reed:${gx},${gz},${n}`);
        const rx = x + ((g % 100) / 100 - 0.5) * 0.8;
        const rz = z + (((g >>> 7) % 100) / 100 - 0.5) * 0.8;
        const y = terrain.worldHeight(rx, rz);
        const tall = 0.3 + ((g >>> 14) % 100) / 400;
        const hue = (g >>> 21) & 1 ? 0x6f7f46 : 0x86924f;
        for (let b = 0; b < 3; b++) {
          const a = ((g >>> (b * 3)) % 8) / 8 * 6.2832;
          const lx = Math.cos(a) * 0.13, lz = Math.sin(a) * 0.13;
          tri([rx - 0.035, y, rz], [rx + 0.035, y, rz], [rx + lx, y + tall, rz + lz], hue);
        }
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
  {
    const bg = buildRiverBanks();
    if (bg) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
      const bm = new THREE.Mesh(bg, mat);
      bm.receiveShadow = true;
      group.add(bm);
    }
  }

  // ---- hedges and fields ---------------------------------------------------
  let borderMesh = null, fieldMesh = null;
  const groundMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });

  function buildHamletDressing(v, seasonName) {
    if (borderMesh) { group.remove(borderMesh); borderMesh.geometry.dispose(); borderMesh.material.dispose(); borderMesh = null; }
    if (fieldMesh) { group.remove(fieldMesh); fieldMesh.geometry.dispose(); fieldMesh.material.dispose(); fieldMesh = null; }

    // A hedge opens where a road crosses it, and the road set is the one the settlers
    // already walk on, so no extra data is needed to know where the gates are. The field
    // plan goes in with it: a parcel is fenced and gated by the same pass, out of the
    // same merged geometry, for no extra draw call.
    const bg = buildBorders(v, terrain, own.owner, roads, fieldPlan);
    if (bg) {
      // Rail, hedge and wall all come back welded into one geometry, so the sheet cannot
      // be chosen per mesh: hamlets.js writes which one each vertex wants and its own
      // material reads that, projecting from three axes so nothing needs a UV. It dresses
      // itself when the sheets land, and draws the flat colours until they do.
      borderMesh = new THREE.Mesh(bg, createBoundaryMaterial());
      borderMesh.castShadow = true;
      borderMesh.receiveShadow = true;
      group.add(borderMesh);
    }
    const fg = buildFieldDecals(fieldPlan, terrain, seasonName);
    if (fg) {
      const mat = groundMat();
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
      // The fields are drawn here but dressed there: hamlets.js hands back bare geometry
      // and owns the ploughed-soil sheet, so it is the only place that knows the tiling
      // and the brightness the sheet has to be corrected for. It handles the wait itself -
      // a sheet that lands after this material was made still reaches it.
      dressFieldMaterial(mat);
      fieldMesh = new THREE.Mesh(fg, mat);
      fieldMesh.receiveShadow = true;
      group.add(fieldMesh);
    }
  }
  buildHamletDressing(village, season);

  // The land register changed: a parcel grew, a hamlet was founded, a hedge moved out.
  function setOwnership(v, seasonName = currentSeason) {
    own = decodeOwnership(v, size);
    hues = v.districts.map((d) => d.hue);
    clearedBase = baseCleared(v);
    wallVerge(own.owner, clearedBase);
    roads = roadSet(v);
    settled = settledDistance(terrain, own.owner, roads);
    fieldPlan = planFields(v, terrain, own.owner, clearedBase, { ...fieldOpts(v), settled });
    for (const p of [...fieldPlan.patches, ...fieldPlan.orchards, ...fieldPlan.gardens]) {
      for (const [gx, gz] of p.cells) cleared.add(gx + gz * size);
    }
    wallVerge(own.owner, cleared);
    computeTint(own.owner, own.inset, hues);
    paintGround(seasonName);
    placeOrchard(orchardTrees(fieldPlan, terrain), seasonName);
    buildHamletDressing(v, seasonName);
    // A new house has a new yard, and every yard's feather is the colour of the ground
    // `paintGround` has just rewritten - so this goes after both, not before either.
    wearVillage = v;
    buildGroundWear();
  }

  // ---- clouds --------------------------------------------------------------
  // Nine clouds, each a handful of squashed icosahedra. They used to be some 34 separate
  // meshes, and every one cost a draw call in the colour pass and another in the shadow
  // pass. One InstancedMesh over a unit icosahedron draws the whole layer in two: each
  // puff is an instance whose matrix carries its radius, its squash and its place in the
  // cloud. The random draws happen in the same order as before, so the clouds look the
  // same and the fireflies further down still land where they did.
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xfbfbf7, flatShading: true, roughness: 1 });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
  const cloudPuffs = []; // one per instance: which cloud it belongs to, its offset and its size
  const cloudDrift = []; // one per cloud: where it is and how fast it drifts
  for (let i = 0; i < 9; i++) {
    const parts = 3 + rng.int(3);
    for (let k = 0; k < parts; k++) {
      const r = rng.range(1.6, 3.2);
      const ox = rng.range(-3, 3), oy = rng.range(-0.4, 0.4), oz = rng.range(-2, 2);
      const squash = rng.range(0.4, 0.6);
      cloudPuffs.push({ cloud: i, ox, oy, oz, sx: r, sy: r * squash, sz: r });
    }
    cloudDrift.push({ x: rng.range(-70, 70), y: rng.range(24, 33), z: rng.range(-70, 70), speed: rng.range(0.35, 0.75) });
  }
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudPuffs.length);
  clouds.castShadow = true;
  // The instances drift and wrap around the island, so a bounding sphere taken at boot
  // would go stale and cull clouds that are plainly in view. The layer is always in
  // sight anyway, like the sky and the fireflies.
  clouds.frustumCulled = false;
  function placeClouds() {
    for (let i = 0; i < cloudPuffs.length; i++) {
      const p = cloudPuffs[i], c = cloudDrift[p.cloud];
      tmpObj.position.set(c.x + p.ox, c.y + p.oy, c.z + p.oz);
      tmpObj.rotation.set(0, 0, 0);
      tmpObj.scale.set(p.sx, p.sy, p.sz);
      tmpObj.updateMatrix();
      clouds.setMatrixAt(i, tmpObj.matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
  }
  placeClouds();
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
  // The shadow frustum follows what you are looking at, and now also how far away you are
  // standing: anchored and fixed it covered 84 units of a 234-unit island, so from the
  // boot camera most of the coast cast nothing at all. Following the target alone was not
  // enough, because the whole point of pulling back is to see all of it at once. So the
  // half-width comes from the camera distance - and only the half-width, so zoomed in you
  // keep today's 24 shadow-map pixels per unit and today's crisp eaves.
  //
  // The light rides out with it. It sat a flat 90 units up the sun ray, which is fine for
  // a 42-unit frustum but puts everything on the sunward half of a 130-unit one *behind*
  // the lamp, where the shadow camera cannot see it - the coast would have gone dark-free
  // again for a subtler reason. Near and far follow for the same reason, and because a
  // depth range no wider than it needs to be is what keeps `shadow.bias` honest: tight
  // when you are close, which is exactly when a millimetre of peter-panning shows.
  const shadowFocus = new THREE.Vector3();
  let shadowSpan = SHADOW_SPAN[0];
  let lightRange = shadowSpan + 60;
  const followShadow = (x, z, dist) => {
    shadowFocus.set(x, 0, z);
    if (!(dist > 0)) return;
    const f = clamp(dist * SHADOW_OF_DIST, SHADOW_SPAN[0], SHADOW_SPAN[1]);
    if (Math.abs(f - shadowSpan) < 0.5) return;   // a matrix rebuild per frame of zoom, not per frame
    shadowSpan = f;
    lightRange = f + 60;
    const cam = key.shadow.camera;
    cam.left = -f; cam.right = f; cam.top = f; cam.bottom = -f;
    cam.near = 10; cam.far = 2 * f + 90;
    cam.updateProjectionMatrix();
  };

  function update(dt, hour, month) {
    time += dt;
    const d = dayAt(hour);
    const dir = sunDirection(hour);
    state.sun.copy(dir);
    state.night = d.night;

    key.target.position.lerp(shadowFocus, Math.min(1, dt * 4));
    key.position.copy(key.target.position).addScaledVector(dir, lightRange);
    key.color.copy(d.key);
    key.intensity = d.int;
    hemi.color.copy(d.sky); hemi.groundColor.copy(d.ground);
    hemi.intensity = lerp(0.5, 0.9, 1 - d.night);
    ambient.intensity = d.amb + d.night * 0.09;

    skyMat.uniforms.uTop.value.copy(d.top);
    skyMat.uniforms.uHor.value.copy(d.hor);
    skyMat.uniforms.uSunDir.value.copy(dir);
    skyMat.uniforms.uSunColor.value.copy(d.key);
    skyMat.uniforms.uStars.value = d.stars;
    // The haze is the horizon seen through more of itself, with a quarter of the sky's own
    // blue mixed back in. Less of that blue than before and a breath of the sun's colour
    // on top, so the far coast goes gold in the afternoon instead of grey-blue - the
    // distance in the reference picture is warm, not cold. Distances: see main.js.
    scene.fog.color.copy(d.hor).lerp(d.top, 0.15).lerp(d.key, 0.12);

    waterMat.uniforms.uTime.value = time;
    waterMat.uniforms.uSunDir.value.copy(dir);
    waterMat.uniforms.uSunColor.value.copy(d.key);
    waterMat.uniforms.uNight.value = d.night;
    // The open sea used to be a plain colour that had to be dimmed by hand to follow the
    // rest of the water into the evening. It shares these uniforms now, so it darkens on
    // its own - one nightfall over the whole sea rather than two kept in step.

    const isDay = hour >= 6 && hour <= 18;
    sunDisc.visible = isDay; moonDisc.visible = !isDay;
    (isDay ? sunDisc : moonDisc).position.copy(dir).multiplyScalar(430);

    for (const c of cloudDrift) {
      c.x += c.speed * dt;
      if (c.x > 90) c.x = -90;
    }
    placeClouds();

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
      placeOrchard(orchardTrees(fieldPlan, terrain), s);
      buildHamletDressing(village, s);      // ploughed earth in spring, stubble after the harvest
      buildGroundWear();                    // and the feather round a yard follows the meadow
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

  // The coast of another moment. Polders are stamped into the heightfield rather than
  // drawn on top of it, so replaying the island's history means moving the ground
  // itself - there is no visibility flag that can put the sea back. Everything else is
  // already incremental: the colour attribute is written in place by `paintGround`, and
  // the scatter never touches a polder or its dike, so nothing is left hanging in the
  // air when the water returns.
  function reshape(next) {
    terrain = next;
    const pa = geo.attributes.position;
    for (let k = 0; k < N * N; k++) pa.array[k * 3 + 1] = terrain.H[k];
    pa.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    paintGround(currentSeason);
    // The decals stand on the heightfield, so a coast that has moved takes them with it.
    buildGroundWear();
    const wa = waterGeo.attributes.aDepth;
    for (let i = 0; i < wp.count; i++) {
      const x = wp.getX(i), z = wp.getZ(i);
      wa.array[i] = (Math.abs(x) > half || Math.abs(z) > half) ? -2.5 : terrain.worldHeight(x, z);
    }
    wa.needsUpdate = true;
  }

  return {
    group, ground, water, sky, key, hemi, ambient, clouds, fireflies, update, fellTrees,
    buildPaths, squareCells, setOwnership, followShadow, ownership: () => own, state,
    season: () => currentSeason, reshape,
  };
}

// ---- the road, as a graph --------------------------------------------------
// Which cells of paving are a junction and which are a stretch of lane between two of
// them. Pure, and exported, because the one hard requirement on the drawing is measurable
// and tests/paths.test.mjs measures it: a settler walks from cell middle to cell middle
// and `gateOf` in main.js looks a road cell up by its middle, so wherever the paving ends
// up drawn it has to still be under those middles.
//
// A junction, a dead end and every cell of a plaza keep a tile of their own. The plaza is
// the interesting one: the corner cell of a five-by-five square has exactly two
// neighbours, so by degree alone it would be taken for a stretch of lane and the square
// would come out with a bite out of each corner.
const ROAD_N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function roadGraph(paths, squares, size) {
  const kind = new Map();
  const at = (gx, gz) => gx + gz * size;
  const inside = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size;
  const put = (gx, gz, k) => { if (inside(gx, gz) && !kind.has(at(gx, gz))) kind.set(at(gx, gz), k); };
  for (const p of paths || []) {
    // A lane between two front doors is a sandy track that feet have made; a road and the
    // way up to a civic building are laid. The id is the only place that says which.
    const k = String(p.id || '').startsWith('path:house:') ? 'sand' : 'stone';
    for (const c of p.cells) put(c[0], c[1], k);
  }
  // A cell that is both a square and a path keeps the path's surface and gains the
  // square's habit of standing still, which is how the two have always met.
  const plaza = new Set();
  for (const c of squares || []) {
    if (!inside(c[0], c[1])) continue;
    plaza.add(at(c[0], c[1]));
    put(c[0], c[1], 'plaza');
  }
  const has = (gx, gz) => inside(gx, gz) && kind.has(at(gx, gz));
  const nbs = (gx, gz) => {
    const out = [];
    for (const [dx, dz] of ROAD_N4) if (has(gx + dx, gz + dz)) out.push([gx + dx, gz + dz]);
    return out;
  };
  const cells = [];
  for (const k of kind.keys()) cells.push([k % size, (k - (k % size)) / size]);

  const nodes = new Set();
  for (const [gx, gz] of cells) if (plaza.has(at(gx, gz)) || nbs(gx, gz).length !== 2) nodes.add(at(gx, gz));
  const isNode = (gx, gz) => nodes.has(at(gx, gz));

  const chains = [];
  const taken = new Set();
  const walk = (from, first) => {
    const run = [];
    let prev = from, cur = first;
    while (cur && !isNode(cur[0], cur[1]) && !taken.has(at(cur[0], cur[1]))) {
      run.push(cur);
      taken.add(at(cur[0], cur[1]));
      const next = nbs(cur[0], cur[1]).find((q) => q[0] !== prev[0] || q[1] !== prev[1]);
      prev = cur;
      cur = next;
    }
    if (!run.length) return;
    // A stub off a road may reuse a cell or two of it, so a lane is whatever most of it
    // is; a tie goes to stone, because a road gone sandy for one cell reads as a fault.
    let sand = 0;
    for (const [gx, gz] of run) if (kind.get(at(gx, gz)) === 'sand') sand++;
    chains.push({ from, run, to: cur || null, kind: sand * 2 > run.length ? 'sand' : 'stone' });
  };
  for (const [gx, gz] of cells) {
    if (!isNode(gx, gz)) continue;
    for (const n of nbs(gx, gz)) if (!isNode(n[0], n[1]) && !taken.has(at(n[0], n[1]))) walk([gx, gz], n);
  }
  // A ring of degree-two cells has no junction to be cut at, so it is cut anywhere: the
  // cell we happen to reach first becomes a tile and the rest of the loop a lane that
  // starts and ends on it.
  for (const [gx, gz] of cells) {
    if (isNode(gx, gz) || taken.has(at(gx, gz))) continue;
    nodes.add(at(gx, gz));
    for (const n of nbs(gx, gz)) if (!isNode(n[0], n[1]) && !taken.has(at(n[0], n[1]))) walk([gx, gz], n);
  }
  // Last, so that a cell promoted above still gets its tile.
  const tiles = [];
  for (const [gx, gz] of cells) {
    if (!isNode(gx, gz)) continue;
    tiles.push({
      gx, gz, kind: kind.get(at(gx, gz)),
      west: has(gx - 1, gz), east: has(gx + 1, gz), north: has(gx, gz - 1), south: has(gx, gz + 1),
    });
  }
  return { cells, kind, tiles, chains };
}

// A chain of cell middles, turned into a curve. The straights stay straight and every
// corner is replaced by a circular fillet tangent to both legs.
//
// A fillet rather than a spline, and that is the whole of the argument. Chaikin or
// Catmull-Rom would be shorter, but neither can promise how far it wanders from the points
// it was built from, and here that promise is the requirement: two passes of Chaikin cut a
// single right angle by 0.177, which fits inside 0.18, and a staircase of right angles by
// twice as much, which does not - and a staircase is exactly what a meandering router
// produces. A fillet's depth is arithmetic: for an interior angle a and radius r it is
// r (1/sin(a/2) - 1), so the radius can be solved for the depth that is allowed. The
// bound then holds at every corner on the island by construction rather than by
// measurement, and the radius is capped at half of the shorter leg so two fillets on
// neighbouring corners never eat into each other.
export function smoothLane(pts, maxDev, arcStep = 0.5) {
  if (pts.length < 3) return pts.slice();
  const leg = (p, v) => {
    const x = p[0] - v[0], z = p[1] - v[1];
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, z: z / len, len };
  };
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const v = pts[i];
    const a = leg(pts[i - 1], v), b = leg(pts[i + 1], v);
    const angle = Math.acos(clamp(a.x * b.x + a.z * b.z, -1, 1));
    if (angle > Math.PI - 0.02) { out.push(v); continue; }       // straight: nothing to cut
    const h = angle / 2;
    const r = Math.min(maxDev / (1 / Math.sin(h) - 1), Math.min(a.len, b.len) * 0.5 * Math.tan(h));
    const t = r / Math.tan(h);
    const bl = Math.hypot(a.x + b.x, a.z + b.z) || 1;
    const cx = v[0] + ((a.x + b.x) / bl) * (r / Math.sin(h));
    const cz = v[1] + ((a.z + b.z) / bl) * (r / Math.sin(h));
    const a0 = Math.atan2(v[1] + a.z * t - cz, v[0] + a.x * t - cx);
    let d = Math.atan2(v[1] + b.z * t - cz, v[0] + b.x * t - cx) - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const seg = Math.max(1, Math.ceil(Math.abs(d) / arcStep));
    for (let k = 0; k <= seg; k++) {
      const ang = a0 + (d * k) / seg;
      out.push([cx + Math.cos(ang) * r, cz + Math.sin(ang) * r]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// How far the furthest of `pts` ends up from the polyline `curve`. The measurement the
// bound above is stated in, and the reason `smoothLane` is a separate function at all.
export function offCurve(pts, curve) {
  let worst = 0;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 0; i + 1 < curve.length; i++) {
      const [ax, az] = curve[i], [bx, bz] = curve[i + 1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 ? clamp(((p[0] - ax) * dx + (p[1] - az) * dz) / l2, 0, 1) : 0;
      best = Math.min(best, Math.hypot(p[0] - (ax + dx * t), p[1] - (az + dz * t)));
    }
    if (best > worst) worst = best;
  }
  return worst;
}

// The offset direction at every point of a swept lane: the average of the two segment
// normals either side of it, lengthened so the ribbon keeps its width through a bend
// instead of pinching. Capped, because a hairpin would send a mitre off to infinity.
function laneNormals(curve) {
  const dirs = [];
  for (let i = 0; i + 1 < curve.length; i++) {
    const x = curve[i + 1][0] - curve[i][0], z = curve[i + 1][1] - curve[i][1];
    const l = Math.hypot(x, z) || 1;
    dirs.push([x / l, z / l]);
  }
  if (!dirs.length) return curve.map(() => [0, 1]);
  const out = [];
  for (let i = 0; i < curve.length; i++) {
    const d0 = dirs[Math.max(0, i - 1)], d1 = dirs[Math.min(dirs.length - 1, i)];
    const n0 = [-d0[1], d0[0]], n1 = [-d1[1], d1[0]];
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const l = Math.hypot(mx, mz);
    if (l < 1e-6) { out.push(n0); continue; }
    mx /= l; mz /= l;
    const k = 1 / Math.max(0.5, mx * n0[0] + mz * n0[1]);
    out.push([mx * k, mz * k]);
  }
  return out;
}

// One growing vertex buffer, so a pass can fill several of them and hand each to a mesh.
function bucket() {
  return { pos: [], col: [], uv: [], idx: [], v: 0 };
}

// ---- tiny geometry helpers (vertex-coloured, flat shaded) -----------------
function paint(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  // The UV stays: three's own cylinder and cone wrap sensibly, which is all a trunk or a
  // cone of needles needs. (The normal goes because merge() recomputes it flat.)
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
function merge(geos, groups = false) {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = mergeGeometries(flat, groups);
  out.computeVertexNormals();
  return out;
}
