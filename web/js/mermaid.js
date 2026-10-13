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
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

const SKIN = 0xe8bf9c, HAIR = 0x2f8c84, TAIL = 0x1f9e8f, FIN = 0x5fd6c4, SHELL = 0xf08c7a;
// The smoke: SMOKE points rising SMOKE_H over SMOKE_S seconds each, in a slow twist.
const SMOKE = 56, SMOKE_H = 7, SMOKE_S = 5.5;
const SMOKE_COLOUR = new THREE.Color(0x7ff7e0);
// Rising out of the water as she comes, sinking back as she goes.
const RISE_S = 1.4;

function part(geom, colour, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const g = geom.toNonIndexed();
  g.scale(...scale);
  g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]);
  g.translate(...at);
  const c = new THREE.Color(colour);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

// Her body above the water, in island units (a settler is about half a unit tall; she is drawn a little
// larger, so she reads from a boat's length). The waterline is y = 0, she faces +z.
function bodyGeometry() {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.06, 0.075, 0.24, 7), SKIN, { at: [0, 0.07, 0] }),                 // torso
    part(new THREE.SphereGeometry(0.035, 6, 4), SHELL, { at: [0.033, 0.13, 0.05] }),                    // shells
    part(new THREE.SphereGeometry(0.035, 6, 4), SHELL, { at: [-0.033, 0.13, 0.05] }),
    part(new THREE.CylinderGeometry(0.022, 0.026, 0.05, 6), SKIN, { at: [0, 0.215, 0] }),              // neck
    part(new THREE.SphereGeometry(0.062, 8, 6), SKIN, { at: [0, 0.285, 0.005] }),                      // head
    part(new THREE.SphereGeometry(0.068, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), HAIR, { at: [0, 0.29, -0.008] }),
    part(new THREE.CylinderGeometry(0.06, 0.035, 0.3, 7), HAIR, { at: [0, 0.16, -0.05], rot: [0.18, 0, 0] }), // hair down her back
    part(new THREE.CylinderGeometry(0.018, 0.015, 0.2, 5), SKIN, { at: [0.09, 0.09, 0.02], rot: [-0.2, 0, 0.35] }),  // arms
    part(new THREE.CylinderGeometry(0.018, 0.015, 0.2, 5), SKIN, { at: [-0.09, 0.09, 0.02], rot: [-0.2, 0, -0.35] }),
    part(new THREE.CylinderGeometry(0.078, 0.07, 0.08, 7), TAIL, { at: [0, -0.04, 0] }),               // scales at the hip
  ]);
}
// The tail, hung from its root at the hip and swung about x as a whole (a flick out of the water).
function tailGeometry() {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.07, 0.03, 0.42, 7), TAIL, { at: [0, 0, -0.21], rot: [Math.PI / 2, 0, 0] }),
    part(new THREE.ConeGeometry(0.11, 0.14, 4), FIN, { at: [0, 0, -0.47], rot: [-Math.PI / 2, 0, 0], scale: [1.6, 1, 0.25] }),
  ]);
}

export function createMermaid({ scene }) {
  const group = new THREE.Group();
  group.visible = false;
  group.name = 'mermaid';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x0a3a34 });
  const body = new THREE.Mesh(bodyGeometry(), mat);
  const tail = new THREE.Mesh(tailGeometry(), mat);
  tail.position.set(0, -0.06, -0.02);
  const figure = new THREE.Group();
  figure.add(body, tail);
  figure.scale.setScalar(1.6);
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
    figure.position.y = (k - 1) * 0.7 + Math.sin(t * 1.3) * 0.03;
    figure.rotation.y = at.yaw + Math.sin(t * 0.4) * 0.25;
    figure.rotation.z = Math.sin(t * 0.9) * 0.06;
    // A flick of the tail every few seconds: up out of the water, and back.
    const flick = Math.max(0, Math.sin(t * 0.8)) ** 6;
    tail.rotation.x = -0.15 - flick * 0.9 + Math.sin(t * 3) * 0.05;
    uniforms.uTime.value = t % 1000;
    uniforms.uFade.value = k;
    if (pixels) uniforms.uScale.value = pixels * 0.6;
  }
  function dispose() {
    scene.remove(group);
    for (const o of [body, tail, smoke, glow]) { o.geometry.dispose(); }
    mat.dispose(); smoke.material.dispose(); glow.material.dispose();
  }
  return { show, hide, update, dispose, where: () => (at && !leaving ? at : null), group };
}
