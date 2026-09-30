// A room's glow and its light shafts (Plans/piratenkroeg.md, "Licht"): what a bloom pass and
// volumetric light would give, made of two cheap additive meshes instead, because the renderer is
// the island's (main.js renders the room's scene with it) and has no post-processing, and a
// composer for one room is a second render path to keep in step with the island's.
//
// Both are drawn unlit, additive, without depth writes and without fog: added light on top of
// what the seven PointLights already lit, never a surface of their own. They carry no light
// themselves - the room's light count (and so its program) stays the tavern's.
import * as THREE from 'three';

// ---- halos: a soft round glow round every flame, lamp and lit window ---------------------------
// One THREE.Points for all of them, so a hall full of candles is one draw call. A halo is sized in
// room units, so it shrinks with distance like the flame it sits on; `uScale` turns a unit into
// pixels at the current viewport (set in onBeforeRender, so a resize needs nothing else).
const HALO_VERT = /* glsl */ `
  attribute float size;
  attribute float phase;
  attribute vec3 tint;
  uniform float uScale;
  uniform float uTime;
  varying vec3 vTint;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Candles flicker a little, each on its own beat; a window (phase < 0) holds still.
    float f = phase < 0.0 ? 1.0 : 0.88 + 0.12 * sin(uTime * 9.0 + phase) * sin(uTime * 4.3 + phase * 1.7);
    vTint = tint * f;
    gl_PointSize = size * uScale / max(-mv.z, 0.05);
    gl_Position = projectionMatrix * mv;
  }`;
const HALO_FRAG = /* glsl */ `
  varying vec3 vTint;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // A tight core and a long soft skirt: the look of bloom round a small bright source.
    float g = exp(-r * r * 9.0) * 0.55 + exp(-r * r * 2.6) * 0.45;
    gl_FragColor = vec4(vTint * g * (1.0 - r), 1.0);
  }`;

export function createHalos(list) {
  const n = list.length;
  const pos = new Float32Array(n * 3), tint = new Float32Array(n * 3);
  const size = new Float32Array(n), phase = new Float32Array(n);
  list.forEach((h, i) => {
    pos.set(h.at, i * 3);
    const c = new THREE.Color(h.hex);
    tint.set([c.r * h.strength, c.g * h.strength, c.b * h.strength], i * 3);
    size[i] = h.size;
    phase[i] = h.steady ? -1 : (i * 2.399) % 6.283;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
    uniforms: { uScale: { value: 500 }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  const px = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(px);
    mat.uniforms.uScale.value = px.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };
  return {
    object: points,
    update(t) { mat.uniforms.uTime.value = t; },
    dispose() { g.dispose(); mat.dispose(); },
  };
}

// Where the glow goes, read off the room's own geometry rather than listed by hand: every part that
// glows (the bake emits each glowing part on its own, so a part is one flame or one window) gets a
// halo at its middle, tinted by its own baked colour. A small hot part is a flame or a lamp's globe;
// a broad one that glows at a fraction (a niche's back, a window's night) gets a wide, faint one.
export function halosOf(geometries, { flame = 0.28, window = 1.4 } = {}) {
  const out = [];
  const box = new THREE.Box3(), mid = new THREE.Vector3(), span = new THREE.Vector3();
  for (const g of geometries) {
    const e = g.attributes.aEmissive;
    if (!e) continue;
    let hot = 0;
    for (let i = 0; i < e.count; i++) hot = Math.max(hot, e.array[i]);
    if (hot < 0.3) continue;
    g.computeBoundingBox();
    box.copy(g.boundingBox);
    box.getCenter(mid);
    box.getSize(span);
    const across = Math.max(span.x, span.y, span.z);
    const col = g.attributes.color;
    const c = new THREE.Color(1, 0.8, 0.5);
    if (col) {
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < col.count; i++) { r += col.getX(i); gg += col.getY(i); b += col.getZ(i); }
      c.setRGB(r / col.count, gg / col.count, b / col.count);
    }
    if (across < 0.08) {
      out.push({ at: [mid.x, mid.y, mid.z], hex: c.getHex(), size: flame, strength: 0.5 * hot });
    } else if (across < 0.2) {
      // A lamp's globe, a skull's eyes, the jukebox's tubes: a glow no bigger than the thing, and
      // fainter - scaled up like a flame's, the jukebox wore a red cloud.
      out.push({ at: [mid.x, mid.y, mid.z], hex: c.getHex(), size: across * 2.2, strength: 0.25 * hot });
    } else {
      out.push({ at: [mid.x, mid.y, mid.z], hex: c.getHex(), size: Math.min(window, across * 1.3), strength: 0.22 * hot, steady: true });
    }
  }
  return out;
}

// ---- shafts: moonlight falling through the roof's openings --------------------------------------
// A shaft is a frustum from an opening (a rectangle at `top`) down to `bottom`, slanting along
// `lean` (units sideways per unit down) and widening as it falls. Its colour runs from `strength`
// at the top to nothing at the foot: added light that fades out, so no alpha and no sorting. Seen
// from inside or out, both faces draw.
export function createShafts(list) {
  const pos = [], col = [];
  // A side face is two halves meeting at a bright strip down its middle, dark at both its edges and
  // at its foot: where two faces meet at a corner both are dark, so the shaft has no outline.
  const tri = (pts) => { for (const [p, k] of pts) { pos.push(...p); col.push(...k); } };
  const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
  const quad = (a, b, c, d, hi, lo) => {
    const mt = mid(a, b), mb = mid(d, c);
    tri([[a, lo], [mt, hi], [mb, lo]]); tri([[a, lo], [mb, lo], [d, lo]]);
    tri([[mt, hi], [b, lo], [c, lo]]); tri([[mt, hi], [c, lo], [mb, lo]]);
  };
  for (const s of list) {
    const c = new THREE.Color(s.hex);
    const hi = [c.r * s.strength, c.g * s.strength, c.b * s.strength], lo = [0, 0, 0];
    const drop = s.top - s.bottom, grow = s.grow ?? 1.35;
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    const hx = (s.x1 - s.x0) / 2, hz = (s.z1 - s.z0) / 2;
    const bx = cx + s.lean[0] * drop, bz = cz + s.lean[1] * drop;
    const T = [[cx - hx, s.top, cz - hz], [cx + hx, s.top, cz - hz], [cx + hx, s.top, cz + hz], [cx - hx, s.top, cz + hz]];
    const B = T.map(([x, , z]) => [bx + (x - cx) * grow, s.bottom, bz + (z - cz) * grow]);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(T[i], T[j], B[j], B[i], hi, lo); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // A face seen flat on is looked through the shaft's whole depth; one seen edge-on only grazes it.
  // Weighting by how squarely a face is seen takes the hard outline off the box (the first try, with
  // a plain additive material, was a lit slab with edges), and the fade with height does the rest.
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vColor;
      varying float vFace;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFace = abs(dot(n, normalize(-mv.xyz)));
        vColor = color;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vFace;
      void main() {
        float soft = vFace;
        gl_FragColor = vec4(vColor * soft, 1.0);
      }`,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  return { object: mesh, dispose() { g.dispose(); mat.dispose(); } };
}
