// The sea bed you swim over (shared/seabed.mjs decides its shape, `archipelago.bedAt` what its
// height is; this draws it) - Plans/onderwater-zwemmen.md, 3.
//
// One mesh that follows the focus (the walker, the diver, or what the orbit camera looks at) and
// is made of three concentric rings of growing coarseness, so the ground is drawn a vertex per
// unit under your feet and a vertex per four out where the mist has it anyway:
//
//     ring 0   step 1   +-24        4608 triangles
//     ring 1   step 2   +-64        7040
//     ring 2   step 4   +-128       6144      = 17792, ONE draw call
//
// It is a *layer beside the terrain*, and does not replace any: an island still draws all its own
// ground, and this draws the whole floor of the sea as well - under a neighbour (guest-island.js
// skips the water quads of a guest, `skipSeabed`), across the open sea, under the volcano, and
// over the island's own underwater ground too. That last one is deliberate and was the other way
// round at first (the bed lowered and the island's mesh winning): the island's underwater colours
// are its shore's (`bandColour` teal-blue, then the grass sheet on top, then the sea's light), a
// dark slab against the sand of the open sea, and a diver saw its straight edge at the grid's rim
// - the sea floor must run on without a seam. So while it is drawn the bed sits `SEABED_LIFT`
// over the truth and carries a polygonOffset that pulls it forward, and a cell whose corners are
// all at the waterline or above (`SEABED_LAND`) is left out - that is land, and only the island
// draws it. From the sky and at the surface the bed is not drawn at all (see `update`).
//
// **The lattice is anchored to the world, not to the focus** (the ring centre snaps to a
// multiple of the coarsest step, and every ring's step divides it), so the same vertices are
// drawn wherever you stand and nothing swims as you move; the mesh is *rebuilt* only when the
// focus has gone `SEABED_HOLD` away from where it was built, and never twice for a swimmer
// bobbing across a snapping boundary (the hold is a hysteresis, not a grid line). A rebuild is
// one `bedAt` per vertex - about nine thousand - and is measured in tests/seabed.test.mjs.
//
// Where a fine ring meets a coarser one the fine ring's edge vertices that the coarse ring has
// no vertex for are *stitched*: their height is the straight line between the two coarse
// neighbours, so the two rings share one polyline and there is no crack.
//
// It is wanted only when somebody is in, on or under the water and looking at the floor:
// `update({ active: false })` hides it, and from orbit the caller says false. The planning (which
// vertices, which cells, which heights) is pure and exported - `seabedLayout`, `seabedPlan`,
// `seabedHeights`, `seabedIndex`, `seabedNormals` - so Node can hold it without a GL context.
import * as THREE from 'three';
import { BED_TOP, BED_DEEPEST } from 'shared/seabed.mjs';

// Rings, fine to coarse: `half` is the ring's reach from the centre, `step` its vertex
// spacing. The reach is what the underwater mist (~25 to ~60) leaves visible with room to
// spare, and the coarsest step is what the centre snaps to.
export const SEABED_RINGS = [
  { step: 1, half: 24 },
  { step: 2, half: 64 },
  { step: 4, half: 128 },
];
// `modest` halves the outer rings' density (a step twice as wide) and keeps the one under your
// feet: it is the ground you walk on, and the cheap part - 4608 of the 7904 triangles.
export const SEABED_RINGS_MODEST = [
  { step: 1, half: 24 },
  { step: 4, half: 64 },
  { step: 8, half: 128 },
];
export const SEABED_LIFT = 0.02;      // over the truth, so the bed wins over an island's own underwater ground
export const SEABED_LAND = -0.05;     // a cell all of whose corners are this high or higher is land
export const SEABED_HOLD = 8;         // how far the focus may drift from the ring centre before a rebuild

const layouts = new Map();

// The shape of the mesh in the ring centre's own frame - the same for every centre, so it is
// made once per tier: which lattice points there are (`lx`, `lz`), which of them are stitched
// (`sa`/`sb`/`st`: the two coarse vertices whose line it lies on, and how far along - `sa` is -1
// for a vertex that is simply sampled) and which cells there are (four vertex indices each).
export function seabedLayout(modest = false) {
  const key = modest ? 'modest' : 'full';
  let layout = layouts.get(key);
  if (layout) return layout;
  const rings = modest ? SEABED_RINGS_MODEST : SEABED_RINGS;
  const outer = rings[rings.length - 1].half;
  const snap = rings[rings.length - 1].step;
  const W = 2 * outer + 1;
  const at = new Int32Array(W * W).fill(-1);
  const lx = [], lz = [];
  const vertex = (x, z) => {
    const k = (x + outer) * W + (z + outer);
    let v = at[k];
    if (v < 0) { v = lx.length; at[k] = v; lx.push(x); lz.push(z); }
    return v;
  };
  const cells = [];
  rings.forEach((ring, k) => {
    const s = ring.step, h = ring.half, hole = k ? rings[k - 1].half : -1;
    for (let z = -h; z < h; z += s) {
      for (let x = -h; x < h; x += s) {
        // Inside the ring before it: that one draws it.
        if (k && x >= -hole && x + s <= hole && z >= -hole && z + s <= hole) continue;
        cells.push(vertex(x, z), vertex(x + s, z), vertex(x, z + s), vertex(x + s, z + s));
      }
    }
  });
  const count = lx.length;
  const sa = new Int32Array(count).fill(-1), sb = new Int32Array(count).fill(-1);
  const st = new Float32Array(count);
  // The stitching: ring k's outer edge, wherever the coarser ring k+1 has no vertex.
  for (let k = 0; k + 1 < rings.length; k++) {
    const s = rings[k].step, h = rings[k].half, coarse = rings[k + 1].step;
    if (coarse === s) continue;
    for (let t = -h; t <= h; t += s) {
      const lo = Math.floor(t / coarse) * coarse;
      if (lo === t) continue;
      const frac = (t - lo) / coarse;
      for (const [x, z, ax, az, bx, bz] of [
        [-h, t, -h, lo, -h, lo + coarse], [h, t, h, lo, h, lo + coarse],
        [t, -h, lo, -h, lo + coarse, -h], [t, h, lo, h, lo + coarse, h],
      ]) {
        const v = vertex(x, z);
        sa[v] = vertex(ax, az); sb[v] = vertex(bx, bz); st[v] = frac;
      }
    }
  }
  // A stitch only ever points at vertices a ring already made: one that made a new one would
  // index past the arrays above.
  if (lx.length !== count) throw new Error('seabed layout: a stitch made a vertex of its own');
  layout = {
    modest, rings, snap, count,
    lx: Int16Array.from(lx), lz: Int16Array.from(lz), sa, sb, st,
    cells: Int32Array.from(cells),
    maxTriangles: cells.length / 2,       // two per cell, before land is left out
  };
  layouts.set(key, layout);
  return layout;
}

// Where the rings are centred for a focus at (fx, fz), and what to call that: the centre snapped
// to the coarsest step, so two foci in the same cell get the same plan, byte for byte.
export function seabedPlan(fx, fz, { modest = false } = {}) {
  const layout = seabedLayout(modest);
  const s = layout.snap;
  const cx = Math.floor(fx / s + 0.5) * s, cz = Math.floor(fz / s + 0.5) * s;
  return { cx, cz, key: `${cx},${cz}|${modest ? 'm' : 'f'}`, layout, triangles: layout.maxTriangles };
}

// The height of every vertex of a plan, into `y` (a Float32Array of `layout.count`): sampled
// off `bedAt` at the world point where it is, and for a stitched one the line between its two
// coarse neighbours. The truth: nothing is lowered here - the mesh is, as a whole.
export function seabedHeights(plan, bedAt, y) {
  const { layout, cx, cz } = plan;
  const { count, lx, lz, sa, sb, st } = layout;
  for (let v = 0; v < count; v++) if (sa[v] < 0) y[v] = bedAt(cx + lx[v], cz + lz[v]);
  for (let v = 0; v < count; v++) {
    if (sa[v] < 0) continue;
    const a = y[sa[v]], b = y[sb[v]];
    y[v] = a + (b - a) * st[v];
  }
  return y;
}

// The triangles worth drawing: every cell that has a corner under the waterline, in the winding
// the island's own mesh uses (world.js: a, c, b and b, c, d - the same diagonal, so where the two
// coincide they coincide). Writes into `out`, returns how many indices.
export function seabedIndex(layout, y, out) {
  const c = layout.cells;
  let m = 0;
  for (let i = 0; i < c.length; i += 4) {
    const a = c[i], b = c[i + 1], cc = c[i + 2], d = c[i + 3];
    if (y[a] >= SEABED_LAND && y[b] >= SEABED_LAND && y[cc] >= SEABED_LAND && y[d] >= SEABED_LAND) continue;
    out[m++] = a; out[m++] = cc; out[m++] = b;
    out[m++] = b; out[m++] = cc; out[m++] = d;
  }
  return m;
}

// Smooth normals over the triangles that are drawn (`used` indices of `index`), into `out`
// (three floats a vertex). Area-weighted, so a vertex on a ring's seam takes its shading from the
// coarse triangles it is stitched to and shows no line between the rings.
export function seabedNormals(layout, y, index, used, out) {
  const { lx, lz, count } = layout;
  out.fill(0);
  for (let i = 0; i < used; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    const e1x = lx[b] - lx[a], e1y = y[b] - y[a], e1z = lz[b] - lz[a];
    const e2x = lx[c] - lx[a], e2y = y[c] - y[a], e2z = lz[c] - lz[a];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    // Written out: a rebuild is 17792 of these, and an array a triangle is garbage the frame after.
    out[a * 3] += nx; out[a * 3 + 1] += ny; out[a * 3 + 2] += nz;
    out[b * 3] += nx; out[b * 3 + 1] += ny; out[b * 3 + 2] += nz;
    out[c * 3] += nx; out[c * 3 + 1] += ny; out[c * 3 + 2] += nz;
  }
  for (let v = 0; v < count; v++) {
    const nx = out[v * 3], ny = out[v * 3 + 1], nz = out[v * 3 + 2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-9) { out[v * 3] = 0; out[v * 3 + 1] = 1; out[v * 3 + 2] = 0; continue; }
    out[v * 3] = nx / len; out[v * 3 + 1] = ny / len; out[v * 3 + 2] = nz / len;
  }
  return out;
}

const glsl = (v) => v.toFixed(3);

// The material. Colour is worked out from the truth (`vBed`, the vertex's own height: the mesh
// as a whole is lifted by SEABED_LIFT, and the colour must not know), from the slope of the
// smooth normal, and from the depth under the surface; the caustics are the water's own light
// thrown on it. The colours are written raw, in the space the screen is in - the same as the
// water shader, whose fog colour (three hands it over in the output space) they are mixed with.
//
// uTime is the water's clock (sea seconds mod 20 pi, world.js WAVE_LOOP): every rate below is a
// multiple of a tenth, so a whole number of periods fits in 20 pi and the caustics do not jump
// where the clock wraps. Keep it that way for a new one.
function createMaterial(uniforms) {
  const shared = {
    uTime: uniforms.uTime || { value: 0 },
    uSunDir: uniforms.uSunDir || { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: uniforms.uSunColor || { value: new THREE.Color(0xffffff) },
    uNight: uniforms.uNight || { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    fog: true,
    // Pulled towards the eye, so it wins where it lies over an island's own mesh (SEABED_LIFT).
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      varying vec3 vNorm;
      varying float vBed;
      void main() {
        vBed = position.y;
        // The mesh is only ever translated, so the normal it was built with is the world's.
        vNorm = normal;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform vec3 uSunDir, uSunColor;
      uniform float uTime, uNight;
      varying vec3 vWorld;
      varying vec3 vNorm;
      varying float vBed;

      // Two sums of three crossed waves; the bright net is where a sum passes through zero, and
      // two of them at different scales and speeds is the moving mesh of light on a sand floor.
      float caustics(vec2 p, float t) {
        float a = sin(p.x * 0.9 + t * 0.9) + sin(p.y * 1.1 - t * 0.7) + sin((p.x + p.y) * 0.6 + t * 1.1);
        float b = sin(p.x * 1.7 - t * 1.3 + 1.7) + sin(p.y * 1.9 + t * 1.0) + sin((p.x - p.y) * 1.2 - t * 0.8);
        float la = max(1.0 - abs(a) * 0.3333, 0.0);
        float lb = max(1.0 - abs(b) * 0.3333, 0.0);
        float pa = la * la; pa = pa * pa * la * la;
        float pb = lb * lb; pb = pb * pb * lb * lb;
        return 0.55 * pa + 0.55 * pb;
      }
      // Value noise, for breaking up the rock so a steep flank is patches and not a stripe. Smooth:
      // a hash per unit block on its own was a checkerboard of visible squares.
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      void main() {
        vec3 n = normalize(vNorm);
        // 0 at the top of a bank (BED_TOP), 1 on the floor of a trench (BED_DEEPEST).
        float d01 = clamp((vBed - ${glsl(BED_TOP)}) / (${glsl(BED_DEEPEST)} - ${glsl(BED_TOP)}), 0.0, 1.0);
        float below = max(-vBed, 0.0);

        // Sand: warm where it is shallow, a cool grey-tan out in the deep, silt in a trench.
        vec3 sand = mix(vec3(0.86, 0.77, 0.53), vec3(0.50, 0.49, 0.42), smoothstep(0.0, 0.75, d01));
        sand = mix(sand, vec3(0.21, 0.23, 0.23), smoothstep(0.78, 1.0, d01) * 0.85);
        // Long crests of a slightly different tone, the ripples' shading.
        sand *= 0.95 + 0.05 * sin(vWorld.x * 0.7 + vWorld.z * 1.3 + sin(vWorld.z * 0.4) * 2.0);

        // Rock: on the steep flanks and a little on the tops of banks, broken up by a hash.
        float steep = smoothstep(0.012, 0.045, 1.0 - n.y);
        float crown = (1.0 - smoothstep(0.05, 0.45, d01)) * 0.45;
        float clump = 0.5 + 0.5 * smoothstep(0.3, 0.7, vnoise(vWorld.xz * 0.3));
        float rock = clamp(max(steep, crown) * clump, 0.0, 1.0);
        vec3 col = mix(sand, vec3(0.42, 0.43, 0.44) * (0.85 + 0.3 * vnoise(vWorld.xz * 1.6)), rock);

        // The light that gets down: the sun and its angle on the slope, less of it the deeper
        // it goes and none at night, bluer with depth - and the caustics on top.
        float day = smoothstep(0.02, 0.45, uSunDir.y);
        float diffuse = max(dot(n, normalize(uSunDir)), 0.0);
        col *= mix(0.62, 0.62 + 0.38 * diffuse, day);
        col *= exp(-below * 0.14);
        col = mix(col, col * vec3(0.55, 0.82, 0.96), 1.0 - exp(-below * 0.4));
        col *= mix(1.0, 0.34, uNight);
        // The net is a few units across: past about fifty it is only noise, so it fades with the
        // distance from the eye (which also keeps the far rings from shimmering as you turn).
        float eye = distance(vWorld, cameraPosition);
        float cs = caustics(vWorld.xz, uTime) * (1.0 - smoothstep(25.0, 75.0, eye));
        col += uSunColor * cs * 0.5 * exp(-below * 0.4) * day * (1.0 - uNight) * (0.5 + 0.5 * n.y);

        gl_FragColor = vec4(col, 1.0);
        // The water's own fog, by distance from the eye per pixel (see waterMat in world.js:
        // a distance interpolated across a big triangle is always longer than the real one).
        #ifdef USE_FOG
          float fogDist = eye;
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp(- fogDensity * fogDensity * fogDist * fogDist);
          #else
            float fogFactor = smoothstep(fogNear, fogFar, fogDist);
          #endif
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        #endif
      }
    `,
  });
  // The water's uniforms, shared and not cloned: one clock, one sun, one nightfall.
  for (const k of Object.keys(shared)) mat.uniforms[k] = shared[k];
  return mat;
}

// `sea` is the archipelago (createArchipelago: `bedAt`, and `bedSampler` for the bulk reads a
// rebuild makes), `uniforms` the water's `{ uTime, uSunDir, uSunColor, uNight }` - handed in, not
// made, so the bed lives on the water's clock and light. Hidden until it is asked to be drawn.
export function createSeabed({ scene, sea, uniforms = {}, modest = false } = {}) {
  const layout = seabedLayout(modest);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(layout.count * 3);
  for (let v = 0; v < layout.count; v++) { pos[v * 3] = layout.lx[v]; pos[v * 3 + 2] = layout.lz[v]; }
  const nrm = new Float32Array(layout.count * 3);
  // A Uint16 index while it fits: half the upload on every rebuild.
  const index = layout.count < 65536 ? new Uint16Array(layout.cells.length / 4 * 6) : new Uint32Array(layout.cells.length / 4 * 6);
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const nrmAttr = new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage);
  const idxAttr = new THREE.BufferAttribute(index, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', nrmAttr);
  geo.setIndex(idxAttr);
  geo.setDrawRange(0, 0);
  // Always around the focus, and one draw call: a bounding sphere would only ever say yes.
  const material = createMaterial(uniforms);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'seabed';
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  const y = new Float32Array(layout.count);
  let cx = null, cz = null;
  let dirty = true, disposed = false, rebuilds = 0, drawn = 0;

  function rebuild() {
    const plan = { cx, cz, layout };
    const bedAt = typeof sea.bedSampler === 'function' ? sea.bedSampler() : (x, z) => sea.bedAt(x, z);
    seabedHeights(plan, bedAt, y);
    const used = seabedIndex(layout, y, index);
    seabedNormals(layout, y, index, used, nrm);
    for (let v = 0; v < layout.count; v++) pos[v * 3 + 1] = y[v];
    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
    idxAttr.needsUpdate = true;
    geo.setDrawRange(0, used);
    mesh.position.set(cx, SEABED_LIFT, cz);
    mesh.updateMatrixWorld();
    drawn = used / 3;
    rebuilds++;
    dirty = false;
  }

  // Every frame, cheap: a few comparisons unless the focus has gone SEABED_HOLD from where the
  // rings were centred (or `reshape` was called), and nothing at all while it is not wanted.
  function update({ x, z, active } = {}) {
    if (disposed) return;
    if (!active || !Number.isFinite(x) || !Number.isFinite(z) || !sea) { mesh.visible = false; return; }
    if (cx === null || Math.abs(x - cx) > SEABED_HOLD || Math.abs(z - cz) > SEABED_HOLD) {
      const plan = seabedPlan(x, z, { modest });
      cx = plan.cx; cz = plan.cz;
      dirty = true;
    }
    if (dirty) rebuild();
    mesh.visible = true;
  }

  // The sea changed under it - an island joined or left, an islet was laid, the berth moved:
  // the heights it drew are not the heights there are. Rebuilt on the next `update`.
  function reshape() { dirty = true; }

  function dispose() {
    disposed = true;
    mesh.visible = false;
    scene.remove(mesh);
    geo.dispose();
    material.dispose();
  }

  return { update, reshape, dispose, mesh, info: () => ({ cx, cz, rebuilds, triangles: drawn, modest }) };
}
