// The mermaid (Plans/schip-vaart-door.md): lose your ship at sea - jumped from her under sail, fired out
// of her gun, hauled off by somebody's harpoon - and after a while one comes up beside you in the water,
// marked by a column of glowing smoke you can see from far off. Swim to her, E, and you are back on the
// planks of the last ship you were crew of (main.js mermaidHome, walk.js mermaidAboard).
//
// Two halves. `stepMermaid` / `mermaidSpot` decide when and where, with no three.js and no clock of their
// own, so tests/mermaid.test.mjs can play them; `createMermaid` draws her. She is this page's alone: a
// mermaid belongs to whoever is lost (in Sea of Thieves only your crew sees yours), so nothing of her
// goes on the wire.
//
// Never a light (CLAUDE.md: the light count is in every lit program's key, and one switched on and off
// recompiles everything on screen). The glow is additive and unlit - the smoke a column of soft points,
// the water under her a disc - and so is the shimmer on her tail, a little emissive.
//
// She herself is a bake (scripts/build-mermaid.py, set `mermaid`): one geometry of her three parts, one
// draw call, her tail and hair moved per corner on the CPU off the sea's clock, the way the galleon's sail
// is (web/js/ship-motion.js). The module is 229 kB and imported with the rest: nothing to load lazily.
import * as THREE from 'three';
import { MERMAID } from './mermaid-mesh.js';

// Lost for this long, at the surface, before she comes (the keeper's pick, 13 Oct 2026: "in Sea of Thieves
// it is a few seconds").
export const MERMAID_AFTER_S = 10;
// Lost means further than this from the ship: well past the reach of her ladders, and past where
// swimming to her is the answer.
export const MERMAID_FAR = 40;
// She comes up this far in front of you, towards the ship.
export const MERMAID_AHEAD = 6;
// And waits this long before she dives again, and the count starts over.
export const MERMAID_STAY_S = 120;
// E from this close.
export const MERMAID_REACH = 2.5;

// Where she comes up: MERMAID_AHEAD from the body towards the ship (or, with no bearing, the way the body
// faces), on water `water(x, z)` says she may float on - deep, open sky - trying either side of that
// bearing in steps before giving up. Plain arithmetic in the scene's frame; null when nothing will do.
export function mermaidSpot(body, ship, water, facing = 0) {
  let ax, az;
  if (ship) {
    const dx = ship.x - body.x, dz = ship.z - body.z, d = Math.hypot(dx, dz);
    if (d > 1e-6) { ax = dx / d; az = dz / d; }
  }
  if (ax === undefined) { ax = Math.sin(facing); az = Math.cos(facing); }
  for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI]) {
    const c = Math.cos(turn), s = Math.sin(turn);
    const x = body.x + (ax * c + az * s) * MERMAID_AHEAD, z = body.z + (az * c - ax * s) * MERMAID_AHEAD;
    if (water(x, z)) return { x, z, yaw: Math.atan2(body.x - x, body.z - z) };
  }
  return null;
}

// One frame of whether she is there. `m` is `{ t, at }` (seconds lost so far, and where she is or null),
// kept by the caller. `lost` is the caller's: swimming, on no hull, the ship known and further than
// MERMAID_FAR. Answers 'came' or 'gone' on the frame that changes, else null.
export function stepMermaid(m, { lost, body, ship, water, facing = 0 }, dt) {
  if (!lost) {
    m.t = 0;
    if (m.at) { m.at = null; return 'gone'; }
    return null;
  }
  if (m.at) {
    m.at.life += dt;
    if (m.at.life <= MERMAID_STAY_S) return null;
    m.at = null;
    m.t = 0;
    return 'gone';
  }
  m.t += dt;
  if (m.t < MERMAID_AFTER_S) return null;
  const spot = mermaidSpot(body, ship, water, facing);
  if (!spot) return null;
  m.at = { ...spot, life: 0 };
  return 'came';
}
export const newMermaid = () => ({ t: 0, at: null });

// ---- drawing -------------------------------------------------------------------------------------------

// The smoke: SMOKE points rising SMOKE_H over SMOKE_S seconds each, in a slow twist.
const SMOKE = 56, SMOKE_H = 7, SMOKE_S = 5.5;
const SMOKE_COLOUR = new THREE.Color(0x7ff7e0);
// Rising out of the water as she comes, sinking back as she goes.
const RISE_S = 1.4;

// Her, as scripts/build-mermaid.py bakes her: `mermaid body` still, `mermaid hair` waved about its origin
// on her crown, `mermaid tail` turned about its origin on the hinge at her hip. The waterline is the bake's
// own anchor, so she floats at the height she was modelled to and no number here repeats it.
const BODY = MERMAID.parts['mermaid body'], HAIR = MERMAID.parts['mermaid hair'], TAIL = MERMAID.parts['mermaid tail'];
export const MERMAID_WATERLINE = MERMAID.anchors.waterline[1];
// How far under the surface she starts, rising: all of her that stands above it, and a hand more.
const SUNK = MERMAID.height - MERMAID_WATERLINE + 0.1;

// The tail on the sea's clock (`t` in seconds, every page alike): a slow kick running down it all the
// time, and now and then a flick that brings the fluke up out of the water and slaps it back. A window of
// FLICK_EVERY seconds has a flick when its number hashes under FLICK_SHARE - so she does not keep time like
// a metronome - and the flick takes FLICK_S of it. Radians about the hinge's x axis, up positive (the tail
// runs back, towards -z).
export const FLICK_EVERY = 6, FLICK_S = 1.8, FLICK_SHARE = 0.6, FLICK_UP = 1.25;
const KICK = 0.12, KICK_HZ = 0.55;
// How far the ends of her hair drift, across and fore and aft (island units).
const HAIR_SWAY = 0.035;

function flickDue(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 < FLICK_SHARE;
}
export function tailPose(t) {
  const n = Math.floor(t / FLICK_EVERY), u = t - n * FLICK_EVERY;
  // up quickly, held a moment at the top, down hard: a sine over the flick's time, flattened at its crest
  const flick = flickDue(n) && u < FLICK_S ? Math.sin(Math.PI * u / FLICK_S) ** 0.7 : 0;
  return { flick: flick * FLICK_UP, phase: t * KICK_HZ * Math.PI * 2 };
}

// One geometry of the three parts, in the frame where the water is y = 0 and she faces +z. The hair and the
// tail are runs of it whose corners `pose(t)` writes from their rest copies every frame, which is what keeps
// her one draw call. Plain arrays, so tests/mermaid.test.mjs can pose her under Node.
export function mermaidGeometry() {
  const parts = [BODY, HAIR, TAIL];
  const n = parts.reduce((k, p) => k + p.positions.length, 0);
  const pos = new Float32Array(n), col = new Float32Array(n);
  const runs = [];
  let o = 0;
  for (const p of parts) {
    const at = p.at;
    for (let i = 0; i < p.positions.length; i += 3) {
      pos[o + i] = p.positions[i] + at[0];
      pos[o + i + 1] = p.positions[i + 1] + at[1] - MERMAID_WATERLINE;
      pos[o + i + 2] = p.positions[i + 2] + at[2];
    }
    col.set(p.colors, o);
    runs.push({ from: o, to: o + p.positions.length, pivot: [at[0], at[1] - MERMAID_WATERLINE, at[2]] });
    o += p.positions.length;
  }
  const [, hair, tail] = runs;
  const rest = pos.slice();
  // The tail: how far from the hinge its furthest corner lies (the fluke's tips), so the kick grows along it.
  let reach = 0;
  for (let i = tail.from; i < tail.to; i += 3) reach = Math.max(reach, Math.hypot(rest[i + 1] - tail.pivot[1], rest[i + 2] - tail.pivot[2]));
  // The hair: how far under the crown its longest strand hangs.
  let drop = 0;
  for (let i = hair.from; i < hair.to; i += 3) drop = Math.max(drop, hair.pivot[1] - rest[i + 1]);
  function pose(t) {
    const { flick, phase } = tailPose(t);
    const py = tail.pivot[1], pz = tail.pivot[2];
    for (let i = tail.from; i < tail.to; i += 3) {
      const y = rest[i + 1] - py, z = rest[i + 2] - pz;
      const f = Math.hypot(y, z) / reach;
      const a = flick + KICK * f * Math.sin(phase - f * 2.6);
      const c = Math.cos(a), s = Math.sin(a);
      pos[i + 1] = py + y * c - z * s;
      pos[i + 2] = pz + y * s + z * c;
    }
    // The crown stays where it is; a corner drifts by how far under it it hangs.
    const hy = hair.pivot[1];
    for (let i = hair.from; i < hair.to; i += 3) {
      const y = rest[i + 1];
      const w = Math.max(0, (hy - 0.06 - y) / drop) ** 1.5;
      pos[i] = rest[i] + w * HAIR_SWAY * Math.sin(t * 1.1 + y * 9);
      pos[i + 2] = rest[i + 2] + w * HAIR_SWAY * 0.7 * Math.sin(t * 0.8 + y * 7 + 1.3);
    }
  }
  return { positions: pos, colors: col, hair, tail, pose };
}

export function createMermaid({ scene }) {
  const group = new THREE.Group();
  group.visible = false;
  group.name = 'mermaid';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x0a3a34 });
  const her = mermaidGeometry();
  const geom = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(her.positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', position);
  geom.setAttribute('color', new THREE.BufferAttribute(her.colors, 3));
  // Round every pose: a tail flicked up stands where it never is at rest, and the sphere is never redone.
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -0.1), 1.2);
  const body = new THREE.Mesh(geom, mat);
  const figure = new THREE.Group();
  figure.add(body);
  group.add(figure);

  // The smoke: every point's phase and twist in its attributes, its height and fade in the shader, so
  // the column costs one draw call and nothing on the CPU.
  const seeds = new Float32Array(SMOKE * 2);
  for (let i = 0; i < SMOKE; i++) { seeds[i * 2] = i / SMOKE; seeds[i * 2 + 1] = (i * 0.618034) % 1; }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMOKE * 3), 3));
  sg.setAttribute('seed', new THREE.BufferAttribute(seeds, 2));
  sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SMOKE_H / 2, 0), SMOKE_H);
  const uniforms = { uTime: { value: 0 }, uFade: { value: 0 }, uColour: { value: SMOKE_COLOUR }, uScale: { value: 600 } };
  const smoke = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec2 seed;
      uniform float uTime, uScale;
      varying float vAlpha;
      void main() {
        float life = fract(uTime / ${SMOKE_S.toFixed(1)} + seed.x);
        float a = seed.y * 6.2832 + life * 3.0;
        float r = 0.25 + life * 0.9;
        vec3 p = vec3(cos(a) * r, life * ${SMOKE_H.toFixed(1)}, sin(a) * r);
        vAlpha = sin(life * 3.14159) * (1.0 - life * 0.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.5 + life * 1.6) * uScale / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColour;
      uniform float uFade;
      varying float vAlpha;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float d = dot(q, q);
        if (d > 1.0) discard;
        gl_FragColor = vec4(uColour * (1.0 - d) * (1.0 - d) * vAlpha * uFade * 0.5, 1.0);
      }`,
  }));
  smoke.frustumCulled = false;
  // After the water (transparent, drawn back to front by its far-off middle), or the sea paints over both.
  smoke.renderOrder = 20;
  group.add(smoke);

  // The glow on the water under her.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColour;
      uniform float uFade, uTime;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float ring = 0.6 + 0.4 * sin(uTime * 2.0 - d * 6.0);
        gl_FragColor = vec4(uColour * pow(max(0.0, 1.0 - d), 2.0) * ring * uFade, 1.0);
      }`,
  }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.1;
  glow.renderOrder = 20;
  group.add(glow);
  scene.add(group);

  let at = null, shown = 0, leaving = false;
  function show(spot) { at = spot; leaving = false; shown = 0; group.visible = true; }
  function hide() { leaving = true; }
  // `t` the sea's seconds (every page alike, though only this one draws her), `surfaceAt` the drawn swell
  // (world.js), `pixels` the canvas's height (for the smoke's point size).
  function update(dt, t, surfaceAt, pixels) {
    if (!group.visible || !at) return;
    shown = leaving ? Math.max(0, shown - dt / RISE_S) : Math.min(1, shown + dt / RISE_S);
    if (leaving && shown === 0) { group.visible = false; at = null; return; }
    const sea = surfaceAt ? surfaceAt(at.x, at.z) : 0;
    const k = shown * shown * (3 - 2 * shown);
    group.position.set(at.x, sea, at.z);
    figure.position.y = (k - 1) * SUNK + Math.sin(t * 1.3) * 0.03;
    figure.rotation.y = at.yaw + Math.sin(t * 0.4) * 0.25;
    figure.rotation.z = Math.sin(t * 0.9) * 0.06;
    // The tail's kick and flick and the hair's drift, on her corners (mermaidGeometry): only those two runs
    // move, so only they go up to the GPU again.
    her.pose(t);
    position.clearUpdateRanges();
    position.addUpdateRange(her.hair.from, her.tail.to - her.hair.from);
    position.needsUpdate = true;
    uniforms.uTime.value = t % 1000;
    uniforms.uFade.value = k;
    if (pixels) uniforms.uScale.value = pixels * 0.6;
  }
  function dispose() {
    scene.remove(group);
    for (const o of [body, smoke, glow]) { o.geometry.dispose(); }
    mat.dispose(); smoke.material.dispose(); glow.material.dispose();
  }
  return { show, hide, update, dispose, where: () => (at && !leaving ? at : null), group };
}
