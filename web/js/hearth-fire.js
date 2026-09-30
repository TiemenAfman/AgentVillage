// A hearth's fire (the Salty Kraken's; any room that hands interior.js a `flame`): a flame
// ray-marched through noise inside a box, a bed of embers glowing under it, sparks going up the
// chimney and the glow round it all (room-glow.js's halos). Found by the keeper in Tahsin Önemli's
// Tarnished House, whose bonfire is the reason this exists - but not taken from it: that project
// is GPL-3.0, which Promptholm is not, so nothing here is its code (nor its Dark Souls bonfire
// model). Its flame is a modified copy of mattatz's THREE.Fire, which is MIT, and this is a port
// of that original.
//
// The flame, after mattatz (https://github.com/mattatz/THREE.Fire), itself after Alfred et al.,
// "Real-time procedural volumetric fire" (I3D 2007):
//
//   The MIT License (MIT) - Copyright (c) 2015 mattatz
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
//   and associated documentation files (the "Software"), to deal in the Software without
//   restriction, including without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions: The above copyright
//   notice and this permission notice shall be included in all copies or substantial portions of
//   the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//   PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
//   LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// and its noise is Ashima Arts' 3D simplex (Ian McEwan, Stefan Gustavson;
// https://github.com/ashima/webgl-noise, MIT, Copyright (C) 2011 Ashima Arts).
//
// How the flame works: the box is drawn front faces only; each pixel walks STEPS steps from where
// the ray enters it, and at every step asks what the flame is there - a teardrop shell standing on
// its round end, in (distance from the axis, height) - with the height pushed up by turbulence
// that scrolls upwards, so the shell breaks into tongues that rise and tear off. The sum is the
// colour, and its red is the alpha. mattatz reads the teardrop off a picture (Fire.png); here it
// is a sum (`shell`), so the room fetches nothing and a flame is its numbers.
//
// Like room-glow.js, all of it is unlit, additive, without depth writes and without fog, drawn over
// what the lamps lit and carrying no light of its own: the room keeps the tavern's seven lamps, and
// the hearth's own lamp (kraken-layout.js LIGHTS, `hearth: true`) flickers with `flicker(t)` here
// rather than with the sloops. Nothing is random: every seed is the fire's position, so two pages
// burn the same fire.
import * as THREE from 'three';
import { createHalos } from './room-glow.js';

// Ashima's 3D simplex noise, as mattatz carries it.
const SNOISE = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }`;

// ---- the flame ------------------------------------------------------------------------------
// STEPS is mattatz's 20: fewer and the tongues go to stripes when the box is seen side on.
const STEPS = 20;
const FLAME_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const FLAME_FRAG = /* glsl */ `
  #define STEPS ${STEPS}
  uniform float uTime;
  uniform float uSeed;
  uniform mat4 uInv;
  uniform vec3 uScale;
  uniform vec4 uNoise;      // the noise's scale per axis, and (w) how fast it rises
  uniform float uMagnitude; // how far the turbulence pushes the flame up
  uniform float uLacunarity;
  uniform float uGain;
  uniform float uBright;
  varying vec3 vWorld;
  ${SNOISE}
  float turbulence(vec3 p) {
    float sum = 0.0, freq = 1.0, amp = 1.0;
    for (int i = 0; i < 3; i++) {
      sum += abs(snoise(p * freq)) * amp;
      freq *= uLacunarity;
      amp *= uGain;
    }
    return sum;
  }
  // The flame at (distance from the axis, height), both 0..1 in the box: a shell with a faint
  // body inside it, widest (0.7) where it stands on the logs and drawn to a point at 0.9, hottest
  // at the foot and going to orange and red towards the tips. mattatz's Fire.png is a teardrop on
  // its round end, which in a hearth read as a ball of fire hanging over the logs.
  vec3 shell(vec2 st) {
    float t = st.y / 0.9;
    if (t >= 1.0) return vec3(0.0);
    float r = 0.7 * (1.0 - t) * (1.0 - 0.3 * t) * sqrt(smoothstep(0.0, 0.1, t));
    float d = (st.x - r) / 0.14;
    float g = exp(-d * d) + 0.32 * (1.0 - smoothstep(r - 0.12, r, st.x));
    vec3 c = mix(vec3(0.36, 0.27, 0.07), vec3(0.36, 0.15, 0.02), smoothstep(0.1, 0.5, t));
    c = mix(c, vec3(0.3, 0.05, 0.0), smoothstep(0.5, 0.95, t));
    return c * g * (1.0 - t * t);
  }
  vec3 sampleFire(vec3 p) {
    vec2 st = vec2(length(p.xz), p.y);
    if (st.x >= 1.0 || st.y <= 0.0 || st.y >= 1.0) return vec3(0.0);
    vec3 q = p;
    q.y -= (uSeed + uTime) * uNoise.w;
    q *= uNoise.xyz;
    st.y += sqrt(st.y) * uMagnitude * turbulence(q);
    if (st.y >= 1.0) return vec3(0.0);
    return shell(st);
  }
  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    float stepLen = 0.0288 * length(uScale);
    // Every pixel starts its march a different fraction of a step in (interleaved gradient noise,
    // Jimenez 2014): marched from the box's face in equal steps, a flame seen close up is cut
    // into slices, stripes across its foot where it is densest; offset, they are a fine grain.
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 pos = vWorld + dir * stepLen * (jitter - 1.0);
    vec3 col = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      pos += dir * stepLen;
      vec3 lp = (uInv * vec4(pos, 1.0)).xyz;
      lp.y += 0.5;
      lp.xz *= 2.0;
      col += sampleFire(lp);
    }
    col *= uBright;
    gl_FragColor = vec4(col, min(col.r, 1.0));
  }`;

// ---- the embers -----------------------------------------------------------------------------
// A plane on the fire bed, under the logs and the coals, so it shows between them: slow noise for
// the ash going dark and bright, a little faster noise for the cracks, faded out to the bed's rim.
const EMBER_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const EMBER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform vec2 uAspect;
  varying vec2 vUv;
  ${SNOISE}
  void main() {
    vec2 c = (vUv - 0.5) * 2.0;
    float rim = 1.0 - smoothstep(0.55, 1.0, length(c));
    vec2 p = vUv * uAspect;
    float slow = snoise(vec3(p * 3.0, uSeed + uTime * 0.18)) * 0.5 + 0.5;
    float fast = snoise(vec3(p * 9.0, uSeed * 2.0 + uTime * 0.6)) * 0.5 + 0.5;
    float heat = slow * 0.65 + fast * fast * 0.55;
    vec3 col = mix(vec3(0.16, 0.015, 0.0), vec3(1.0, 0.36, 0.05), smoothstep(0.35, 0.95, heat));
    col += vec3(0.5, 0.32, 0.1) * smoothstep(0.85, 1.05, heat);
    gl_FragColor = vec4(col * rim * (0.35 + 0.65 * heat), 1.0);
  }`;

// ---- the sparks -----------------------------------------------------------------------------
// One Points for all of them and nothing on the CPU per frame: where a spark is is a sum of the
// time and its own four numbers, and a spark that reaches the top of its life is at no brightness
// when it starts again at the bottom. Sized in room units, like the halos, so they shrink with
// distance (`uScale` is set in onBeforeRender).
const SPARKS = 56;
const SPARK_VERT = /* glsl */ `
  attribute vec4 aSeed;     // where on the bed (x, z in -1..1), where in its life, how lively
  uniform float uTime;
  uniform float uScale;
  uniform float uSize;
  uniform vec3 uBase;
  uniform vec3 uReach;      // the bed's half width (x, z) and how high a spark gets (y)
  varying float vAge;
  varying float vTwinkle;
  void main() {
    float life = mix(0.9, 1.9, aSeed.w);
    float a = fract(uTime / life + aSeed.z);
    float k = aSeed.z * 6.2832;
    vec3 p = uBase;
    p.xz += aSeed.xy * uReach.xz * (1.0 + a * 0.5);
    // Fast off the embers and slowing as it cools, wandering on its own beat.
    p.y += uReach.y * mix(0.55, 1.0, aSeed.w) * a * (2.0 - a);
    p.x += 0.05 * a * sin(uTime * 3.1 + k);
    p.z += 0.05 * a * sin(uTime * 2.3 + k * 1.7);
    vAge = a;
    vTwinkle = 0.65 + 0.35 * sin(uTime * 23.0 + k * 5.0);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_PointSize = max(1.5, uSize * (1.0 - 0.6 * a) * uScale / max(-mv.z, 0.05));
    gl_Position = projectionMatrix * mv;
  }`;
const SPARK_FRAG = /* glsl */ `
  varying float vAge;
  varying float vTwinkle;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float core = exp(-r * r * 5.0);
    vec3 hot = mix(vec3(1.0, 0.82, 0.42), vec3(1.0, 0.3, 0.04), smoothstep(0.0, 0.7, vAge));
    float b = smoothstep(0.0, 0.06, vAge) * pow(1.0 - vAge, 1.5) * vTwinkle;
    gl_FragColor = vec4(hot * core * b, 1.0);
  }`;

// A number per fire, from where it stands: the noise's offset, so two hearths do not burn in step.
const seedOf = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 19.19;
};

// The hash for the sparks' own numbers: whole-number arithmetic, the same on every page.
function sparkSeeds(n, seed) {
  const out = new Float32Array(n * 4);
  let h = (Math.floor(seed * 1e6) ^ 0x9e3779b9) >>> 0;
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return h / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const a = next() * Math.PI * 2, r = Math.sqrt(next());
    out.set([Math.cos(a) * r, Math.sin(a) * r, next(), next()], i * 4);
  }
  return out;
}

// The lamp's flicker: incommensurate beats, so it never falls into a rhythm the way one sine does,
// between 0.7 and 1.0 of the lamp's intensity.
export function fireFlicker(t, seed = 0) {
  return 0.85 + 0.07 * Math.sin(t * 7.3 + seed) + 0.05 * Math.sin(t * 13.9 + seed * 2.1)
    + 0.03 * Math.sin(t * 23.1 + seed * 0.7);
}

// `at` is the middle of the fire's foot (on the bed), `w` its width across (x and z), `h` its
// height, `bed` the embers' half widths [x, z]; everything in the room's own units.
export function createHearthFire({ at, w = 0.42, h = 0.58, bed = [0.2, 0.18], bright = 1 } = {}) {
  const [x, y, z] = at;
  const seed = seedOf(x, z);
  const group = new THREE.Group();

  const flameMat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
    uniforms: {
      uTime: { value: 0 }, uSeed: { value: seed },
      uInv: { value: new THREE.Matrix4() }, uScale: { value: new THREE.Vector3(w, h, w) },
      uNoise: { value: new THREE.Vector4(1, 2, 1, 1.1) },
      uMagnitude: { value: 1.1 }, uLacunarity: { value: 2 }, uGain: { value: 0.5 },
      uBright: { value: bright },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flameGeo = new THREE.BoxGeometry(1, 1, 1);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.scale.set(w, h, w);
  flame.position.set(x, y + h / 2, z);
  // The march is in the box's own frame; the box never moves, but the group might be put somewhere.
  flame.onBeforeRender = () => { flameMat.uniforms.uInv.value.copy(flame.matrixWorld).invert(); };
  group.add(flame);

  const emberMat = new THREE.ShaderMaterial({
    vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uAspect: { value: new THREE.Vector2(bed[0] / bed[1], 1) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const emberGeo = new THREE.PlaneGeometry(bed[0] * 2, bed[1] * 2);
  emberGeo.rotateX(-Math.PI / 2);
  const embers = new THREE.Mesh(emberGeo, emberMat);
  embers.position.set(x, y + 0.004, z);
  group.add(embers);

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(sparkSeeds(SPARKS, seed), 4));
  const sparkMat = new THREE.ShaderMaterial({
    vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 500 }, uSize: { value: 0.02 },
      uBase: { value: new THREE.Vector3(x, y + 0.06, z) },
      uReach: { value: new THREE.Vector3(bed[0] * 0.7, h * 1.35, bed[1] * 0.7) },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  // Every spark is placed in the shader; the geometry's own positions are all zero.
  sparks.frustumCulled = false;
  const px = new THREE.Vector2();
  sparks.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(px);
    sparkMat.uniforms.uScale.value = px.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };
  group.add(sparks);

  // The glow: a broad warm one filling the firebox, and a hot one low on the embers.
  const halos = createHalos([
    { at: [x + w * 0.35, y + h * 0.4, z], hex: 0xff6a24, size: 1.5, strength: 0.32 },
    { at: [x + w * 0.2, y + h * 0.15, z], hex: 0xffb24a, size: 0.6, strength: 0.42 },
  ]);
  group.add(halos.object);

  return {
    object: group,
    flicker: (t) => fireFlicker(t, seed),
    update(t) {
      flameMat.uniforms.uTime.value = t;
      emberMat.uniforms.uTime.value = t;
      sparkMat.uniforms.uTime.value = t;
      halos.update(t);
    },
    dispose() {
      flameGeo.dispose(); flameMat.dispose();
      emberGeo.dispose(); emberMat.dispose();
      sparkGeo.dispose(); sparkMat.dispose();
      halos.dispose();
    },
  };
}
