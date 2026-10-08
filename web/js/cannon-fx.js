// What a gun does on screen (Plans/kanonnen.md): the ball in flight, the flash and smoke at the
// muzzle, and where it comes down a fireball and black smoke on land or a hull, or a column of spray
// on the water. Every shot is the closed-form flight of shared/cannon.mjs (`ballAt`), so a ball fired
// here and a ball another page fired (the sea passes it on as `{t:'cannon'}`) fly alike, and where
// each comes down is `ballHit` asked of this page's own world.
//
// Three draw calls at most and only while something burns: the balls are one InstancedMesh, the fire
// one additive THREE.Points, the smoke and spray one ordinary THREE.Points. Unlit and with no light of
// its own (a light would change every lit program's key, which is why room-glow.js and hearth-fire.js
// are made this way too). Fogged by distance like everything outdoors (the radial-fog chunk).
//
// No sound here: sound.js hears of a boom, a blast and a splash through `events()` - a counter and
// the last few - which main.js's soundSnapshot hands over (the cue rule of web/js/sound.js).
import * as THREE from 'three';
import { ballAt, ballHit, BALL_LIFE } from 'shared/cannon.mjs';

const MAX_BALLS = 24;
const MAX_FIRE = 384;
const MAX_SMOKE = 512;
const BALL_R = 0.055;     // a twelve-pounder at the island's scale (a cell is four metres)

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aTint;
  uniform float uScale;
  varying vec4 vTint;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vTint = aTint;
    gl_PointSize = aSize * uScale / max(-mvPosition.z, 0.05);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
// Fire: a hot core and a soft skirt, added on top of whatever is behind.
const FIRE_FRAG = /* glsl */ `
  varying vec4 vTint;
  #include <fog_pars_fragment>
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float g = exp(-r * r * 6.0) * 0.7 + exp(-r * r * 2.0) * 0.3;
    gl_FragColor = vec4(vTint.rgb * g * vTint.a * (1.0 - r), 1.0);
    // Added light fades into the haze rather than turning the haze's colour: no fog_fragment here.
    #ifdef USE_FOG
      gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  }`;
// Smoke and spray: a soft round puff, its own colour, faded by its alpha.
const PUFF_FRAG = /* glsl */ `
  varying vec4 vTint;
  #include <fog_pars_fragment>
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float a = vTint.a * smoothstep(1.0, 0.35, r);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vTint.rgb, a);
    #include <fog_fragment>
  }`;

function pool(n, additive) {
  const geometry = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), tint = new Float32Array(n * 4), size = new Float32Array(n);
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tint, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 } }]),
    vertexShader: VERT, fragmentShader: additive ? FIRE_FRAG : PUFF_FRAG,
    transparent: true, depthWrite: false, fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = additive ? 3 : 2;
  points.visible = false;
  // One particle: where, which way, how old, how long it lives, its size over its life and its
  // colour - `kind` picks the ramp in step().
  const live = [];
  return { points, live, n, pos, tint, size, geometry, material };
}

export function createCannonFx({ scene }) {
  const fire = pool(MAX_FIRE, true);
  const smoke = pool(MAX_SMOKE, false);
  scene.add(fire.points, smoke.points);
  const ballGeometry = new THREE.SphereGeometry(BALL_R, 10, 8);
  const ballMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.6, metalness: 0.4 });
  const balls = new THREE.InstancedMesh(ballGeometry, ballMaterial, MAX_BALLS);
  balls.count = 0;
  balls.frustumCulled = false;
  balls.castShadow = false;
  scene.add(balls);
  const flying = [];         // { shot, t, id, by }
  const events = [];         // the last few, for sound.js: { n, kind, x, y, z }
  let count = 0;
  let wind = [0.35, 0.1];
  const m4 = new THREE.Matrix4(), p3 = [0, 0, 0];

  // Seeded per burst so two pages draw a burst alike enough; the look of smoke needs no more.
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  function emit(p, at, v, life, s0, s1, kind, tint) {
    if (p.live.length >= p.n) p.live.shift();
    p.live.push({ x: at[0], y: at[1], z: at[2], vx: v[0], vy: v[1], vz: v[2], age: 0, life, s0, s1, kind, tint });
  }
  function say(kind, at) {
    count++;
    events.push({ n: count, kind, x: at[0], y: at[1], z: at[2] });
    if (events.length > 8) events.shift();
  }

  // The muzzle: a flash, a jet of fire down the bore's line, and a bank of white smoke.
  function flash(at, dir) {
    seed = 1 + ((Math.abs(at[0] * 131 + at[2] * 71) | 0) % 9973);
    emit(fire, [at[0] + dir[0] * 0.25, at[1] + dir[1] * 0.25, at[2] + dir[2] * 0.25], [dir[0] * 2, dir[1] * 2, dir[2] * 2], 0.12, 0.5, 0.9, 'flash', [1.0, 0.75, 0.35]);
    for (let k = 0; k < 8; k++) {
      const s = 3 + rnd() * 6;
      emit(fire, at, [dir[0] * s + (rnd() - 0.5), dir[1] * s + (rnd() - 0.5), dir[2] * s + (rnd() - 0.5)], 0.18 + rnd() * 0.1, 0.25, 0.05, 'spark', [1, 0.6, 0.2]);
    }
    // The bank starts a pace out of the mouth and thin: the gunner's eye is a metre behind it, and
    // a puff on the lens was a white glare over the whole view.
    const out = [at[0] + dir[0] * 0.5, at[1] + dir[1] * 0.5, at[2] + dir[2] * 0.5];
    for (let k = 0; k < 14; k++) {
      const s = 1.2 + rnd() * 2.6;
      emit(smoke, out, [dir[0] * s + (rnd() - 0.5) * 0.6, dir[1] * s + rnd() * 0.4, dir[2] * s + (rnd() - 0.5) * 0.6],
        2.2 + rnd() * 1.6, 0.12, 0.8 + rnd() * 0.5, 'smoke', [0.86, 0.85, 0.82]);
    }
  }
  // A ball coming down on something hard: a fireball, sparks and black smoke rising.
  function blast(at) {
    seed = 7 + ((Math.abs(at[0] * 53 + at[2] * 97) | 0) % 9973);
    emit(fire, at, [0, 1.2, 0], 0.35, 1.2, 2.4, 'flash', [1.0, 0.55, 0.18]);
    for (let k = 0; k < 18; k++) {
      const a = rnd() * Math.PI * 2, up = 2 + rnd() * 5, out = 1 + rnd() * 3;
      emit(fire, at, [Math.cos(a) * out, up, Math.sin(a) * out], 0.4 + rnd() * 0.5, 0.18, 0.04, 'ember', [1, 0.5, 0.15]);
    }
    for (let k = 0; k < 18; k++) {
      const a = rnd() * Math.PI * 2, out = rnd() * 1.2;
      emit(smoke, [at[0], at[1] + 0.2, at[2]], [Math.cos(a) * out, 0.8 + rnd() * 1.4, Math.sin(a) * out],
        2.5 + rnd() * 2, 0.4, 1.6 + rnd() * 0.8, 'soot', [0.16, 0.15, 0.14]);
    }
  }
  // A ball into the sea: a white column that falls back, and a ring of foam.
  function splash(at) {
    seed = 3 + ((Math.abs(at[0] * 29 + at[2] * 41) | 0) % 9973);
    for (let k = 0; k < 26; k++) {
      const a = rnd() * Math.PI * 2, out = rnd() * 0.9, up = 3.5 + rnd() * 4.5;
      emit(smoke, at, [Math.cos(a) * out, up, Math.sin(a) * out], 1.1 + rnd() * 0.5, 0.18, 0.5, 'spray', [0.93, 0.96, 1.0]);
    }
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      emit(smoke, [at[0], at[1] + 0.03, at[2]], [Math.cos(a) * 1.6, 0.15, Math.sin(a) * 1.6], 1.3, 0.25, 0.7, 'foam', [0.95, 0.97, 1.0]);
    }
  }

  function impact(kind, at) {
    if (kind === 'splash') splash(at);
    else if (kind === 'blast' || kind === 'hull' || kind === 'body') blast(at);
    if (kind !== 'lost') say(kind === 'splash' ? 'splash' : 'blast', at);
  }

  // A shot fired - ours or somebody else's: { o, v, b, by, id, self }. `dir` for the flash is the
  // velocity's own direction; a body fired (`self`) has a flash and no ball.
  function fire1(shot) {
    const n = Math.hypot(shot.v[0], shot.v[1], shot.v[2]) || 1;
    flash(shot.o, [shot.v[0] / n, shot.v[1] / n, shot.v[2] / n]);
    say('boom', shot.o);
    if (!shot.self) {
      if (flying.length >= MAX_BALLS) flying.shift();
      flying.push({ shot, t: 0, id: shot.id || null });
    }
  }

  // The sea says a ball of `id` came down at `at` (it hit somebody): end it there, if it is still flying.
  function landed(id, at, kind = 'body') {
    const k = flying.findIndex((f) => f.id === id);
    if (k < 0) return false;
    flying.splice(k, 1);
    impact(kind, at);
    return true;
  }

  function stepPool(p, dt) {
    let j = 0;
    for (const q of p.live) {
      q.age += dt;
      if (q.age >= q.life) continue;
      const f = q.age / q.life;
      if (q.kind === 'smoke' || q.kind === 'soot') {
        const drag = Math.exp(-2.2 * dt);
        q.vx = q.vx * drag + wind[0] * dt; q.vz = q.vz * drag + wind[1] * dt;
        q.vy = q.vy * drag + 0.25 * dt;
      } else if (q.kind === 'spray' || q.kind === 'ember') {
        q.vy -= 9.5 * dt;
      } else if (q.kind === 'foam') {
        const drag = Math.exp(-2.5 * dt);
        q.vx *= drag; q.vz *= drag; q.vy = 0;
      }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.kind === 'spray' && q.y < 0) { q.age = q.life; continue; }
      const alpha = q.kind === 'flash' ? (1 - f) * 2.2
        : q.kind === 'spark' || q.kind === 'ember' ? (1 - f) * 1.6
        : q.kind === 'smoke' ? 0.4 * (1 - f) * Math.min(1, f * 5)
        : q.kind === 'soot' ? 0.8 * (1 - f) * Math.min(1, f * 6)
        : q.kind === 'spray' ? 0.85 * (1 - f * f)
        : 0.6 * (1 - f);
      p.pos[j * 3] = q.x; p.pos[j * 3 + 1] = q.y; p.pos[j * 3 + 2] = q.z;
      const heat = q.kind === 'flash' || q.kind === 'ember' ? 1 - f * 0.6 : 1;
      p.tint[j * 4] = q.tint[0]; p.tint[j * 4 + 1] = q.tint[1] * heat; p.tint[j * 4 + 2] = q.tint[2] * heat; p.tint[j * 4 + 3] = alpha;
      p.size[j] = q.s0 + (q.s1 - q.s0) * f;
      p.live[j++] = q;
    }
    p.live.length = j;
    p.geometry.setDrawRange(0, j);
    p.points.visible = j > 0;
    if (j) {
      p.geometry.attributes.position.needsUpdate = true;
      p.geometry.attributes.aTint.needsUpdate = true;
      p.geometry.attributes.aSize.needsUpdate = true;
    }
  }

  // Every frame: `world` is ballHit's (height, hulls) in the scene's frame; `scale` turns a unit's
  // size into pixels (the canvas's height over twice the tangent of half the field of view).
  function update(dt, world, scale) {
    if (scale) fire.material.uniforms.uScale.value = smoke.material.uniforms.uScale.value = scale;
    let k = 0;
    for (let i = 0; i < flying.length; i++) {
      const f = flying[i];
      const from = f.t;
      f.t = Math.min(BALL_LIFE, f.t + dt);
      const hit = world ? ballHit(f.shot, world, from, f.t) : null;
      if (hit) { impact(hit.kind, hit.at); continue; }
      ballAt(f.shot, f.t, p3);
      m4.makeTranslation(p3[0], p3[1], p3[2]);
      balls.setMatrixAt(k, m4);
      flying[k++] = f;
    }
    flying.length = k;
    balls.count = k;
    balls.visible = k > 0;
    if (k) balls.instanceMatrix.needsUpdate = true;
    stepPool(fire, dt);
    stepPool(smoke, dt);
  }

  // A gun's fuse, asked every frame it is to be seen: a loaded gun shows a stub of match in its vent
  // (`burning` false), a lit one throws sparks and a thread of smoke from it.
  function fuse(at, burning) {
    emit(fire, at, [0, 0, 0], 0.03, burning ? 0.09 : 0.035, burning ? 0.07 : 0.035, 'flash', burning ? [1, 0.7, 0.25] : [0.6, 0.18, 0.05]);
    if (!burning) return;
    seed = (seed + 7919) % 2147483647 || 1;
    for (let k = 0; k < 2; k++) {
      emit(fire, at, [(rnd() - 0.5) * 1.6, 0.6 + rnd() * 1.4, (rnd() - 0.5) * 1.6], 0.25 + rnd() * 0.2, 0.05, 0.015, 'ember', [1, 0.75, 0.3]);
    }
    if (rnd() < 0.3) emit(smoke, at, [(rnd() - 0.5) * 0.1, 0.35, (rnd() - 0.5) * 0.1], 1.2, 0.03, 0.18, 'smoke', [0.7, 0.7, 0.68]);
  }

  // A boat going down where she was (her hull jumps home, so this is what is seen at the spot): a
  // ring of spray, wreck smoke and a splash, bigger for a ship.
  function sink(at, ship) {
    splash(at);
    const r = ship ? 3 : 0.8;
    seed = 11 + ((Math.abs(at[0] * 17 + at[2] * 23) | 0) % 9973);
    for (let k = 0; k < (ship ? 30 : 10); k++) {
      const a = rnd() * Math.PI * 2, d = rnd() * r;
      const p = [at[0] + Math.cos(a) * d, 0.1, at[2] + Math.sin(a) * d];
      emit(smoke, p, [Math.cos(a) * 0.4, 1 + rnd() * 2.5, Math.sin(a) * 0.4], 2.5 + rnd() * 2, 0.4, 1.8 + rnd(), 'soot', [0.2, 0.19, 0.18]);
      emit(smoke, p, [Math.cos(a) * 1.4, 2 + rnd() * 3, Math.sin(a) * 1.4], 1 + rnd() * 0.5, 0.2, 0.6, 'spray', [0.93, 0.96, 1.0]);
    }
    say('splash', at);
  }

  return {
    fire: fire1,
    sink,
    fuse,
    landed,
    update,
    setWind(x, z) { wind = [x, z]; },
    // For sound.js, through main.js's soundSnapshot: how many have happened, and the last few.
    events: () => ({ n: count, list: events }),
    flying: () => flying.length,
    dispose() {
      scene.remove(fire.points, smoke.points, balls);
      for (const p of [fire, smoke]) { p.geometry.dispose(); p.material.dispose(); }
      ballGeometry.dispose(); ballMaterial.dispose();
    },
  };
}
