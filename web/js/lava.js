// What makes the volcano a volcano once the ground is drawn: the lava in its gullies, the
// pool on the crater floor, the smoke out of the top and the steam where a flow meets the
// sea. Plans/vulkaan-in-het-midden.md, step 5.
//
// Keyed on nothing but the terrain. `terrain.lavaFlows` and `terrain.crater` come out of
// shared/terrain.mjs, the same numbers the sea hurts people by, so a flow is drawn exactly
// where standing in it counts - and whoever hands createLandscape a volcano terrain gets all
// of this, our own island or a region at a berth alike. It is drawn in the island's own
// coordinates inside the landscape's group, which guest-island.js has already put at the
// berth: the rule from shared/regions.mjs, a module that builds its positions out of the
// terrain wants the raw local terrain and an offset group.
//
// Two draw calls, whatever the number of flows. Every flow and the pool are one geometry
// under one ShaderMaterial - a flow is a strip, the pool is a fan, and the shader cannot
// tell them apart because both carry the same two numbers per vertex (how far across the
// flow, how far down it). The smoke and the steam are one InstancedMesh, the way the clouds
// are. Neither casts a shadow: lava is a light source, and a plume's shadow sliding over the
// flank as it rises would cost a shadow pass over every puff for a smudge.
//
// The lava is its own light. Its colour is written straight out, unlit, so it glows at night
// without a lamp - a point light here would be one more light every material on the island
// has to loop over, on every island in the sea.
import * as THREE from 'three';
import { LAVA_W0 as W0, LAVA_W1 as W1 } from 'shared/terrain.mjs';

// How far above the ground under it the surface floats. The ground is drawn as two triangles
// a cell and `worldHeight` is bilinear, and the two disagree by a few hundredths on a curved
// flank; the polygon offset takes care of the rest.
const LIFT = 0.1;
const SPACING = 0.5;           // world units between cross-sections down a flow
const ACROSS = [-1, -0.5, 0, 0.5, 1];

// The course is a four-connected staircase of cell middles, and lava does not turn corners
// at right angles. A running mean over five cells first, which is what turns a diagonal
// staircase into the diagonal it is standing in for - Chaikin alone keeps the steps as a
// ripple you can see from the air - and then Chaikin twice, with the ends held, for the
// bends that are real. Neither takes the line further from the course than the gully
// reaches: the floor is flat for a whole half-width round every cell middle on it.
function soften(course) {
  const R = 2;
  let out = course.map((p, i) => {
    if (i === 0 || i === course.length - 1) return p;
    const r = Math.min(R, i, course.length - 1 - i);
    let x = 0, z = 0;
    for (let k = i - r; k <= i + r; k++) { x += course[k][0]; z += course[k][1]; }
    return [x / (2 * r + 1), z / (2 * r + 1)];
  });
  for (let pass = 0; pass < 2; pass++) {
    if (out.length < 3) return out;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const [ax, az] = out[i], [bx, bz] = out[i + 1];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

// Evenly spaced points down a polyline, so a sharp bend does not bunch the cross-sections
// and a long straight does not stretch the texture.
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= len) {
      const u = d / len;
      out.push([ax + (bx - ax) * u, az + (bz - az) * u]);
      d += step;
    }
    carry = len - (d - step);
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
  return out;
}

// Every flow as the line it is drawn along, in the island's own coordinates, with its
// half-width at each point. Exported because the ground under it is painted from the same
// line (world.js, the basalt), and a black bank that followed the staircase of cells while
// the lava followed this would be two different rivers side by side.
export function lavaLines(terrain) {
  const out = [];
  for (const course of terrain.lavaFlows || []) {
    const points = resample(soften(course.map(([gx, gz]) => terrain.cellWorld(gx, gz))), SPACING);
    if (points.length < 2) continue;
    out.push({ points, widths: points.map((_, s) => W0 + (W1 - W0) * (s / (points.length - 1))) });
  }
  return out;
}

function lavaGeometry(terrain) {
  const pos = [], flow = [], heat = [], idx = [];
  for (const { points: line, widths } of lavaLines(terrain)) {
    const base = pos.length / 3;
    let run = 0;
    for (let s = 0; s < line.length; s++) {
      const a = line[Math.max(0, s - 1)], b = line[Math.min(line.length - 1, s + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const L = Math.hypot(tx, tz) || 1;
      tx /= L; tz /= L;
      if (s > 0) run += Math.hypot(line[s][0] - line[s - 1][0], line[s][1] - line[s - 1][1]);
      const along = s / (line.length - 1);
      const w = widths[s];
      for (const u of ACROSS) {
        const x = line[s][0] - tz * u * w, z = line[s][1] + tx * u * w;
        pos.push(x, terrain.worldHeight(x, z) + LIFT, z);
        flow.push(u, run);
        // It cools on the way down: white-yellow out of the rim, a deeper orange with more
        // crust on it by the time it reaches the beach.
        heat.push(1 - 0.45 * along);
      }
    }
    const n = ACROSS.length;
    for (let s = 0; s < line.length - 1; s++) {
      for (let k = 0; k < n - 1; k++) {
        const a = base + s * n + k, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }

  // The pool on the crater floor: a fan, level, with the same two numbers - across is how
  // far out from the middle, down is the same thing in world units, so it wells up in the
  // middle and runs out to a crusted edge.
  const crater = terrain.crater;
  if (crater && crater.pool > 0) {
    const [cx, cz] = crater.centre;
    const y = crater.floor + LIFT * 0.6;
    const SEG = 28, RINGS = 3;
    const base = pos.length / 3;
    pos.push(cx, y, cz); flow.push(0, 0); heat.push(1);
    for (let r = 1; r <= RINGS; r++) {
      const rr = (crater.pool * r) / RINGS;
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        pos.push(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
        flow.push(r / RINGS, rr);
        heat.push(1);
      }
    }
    for (let k = 0; k < SEG; k++) idx.push(base, base + 1 + ((k + 1) % SEG), base + 1 + k);
    for (let r = 1; r < RINGS; r++) {
      const inner = base + 1 + (r - 1) * SEG, outer = inner + SEG;
      for (let k = 0; k < SEG; k++) {
        const k1 = (k + 1) % SEG;
        idx.push(inner + k, inner + k1, outer + k, inner + k1, outer + k1, outer + k);
      }
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  g.setAttribute('aHeat', new THREE.Float32BufferAttribute(heat, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function lavaMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    // A strip and a fan built by hand, seen only from above; double-sided so their winding
    // is not something to get right twice.
    side: THREE.DoubleSide,
    vertexShader: `
      #include <fog_pars_vertex>
      attribute vec2 aFlow;
      attribute float aHeat;
      varying vec2 vFlow;
      varying float vHeat;
      void main() {
        vFlow = aFlow;
        vHeat = aHeat;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    // A texture that scrolls downhill, made in the shader rather than fetched: value noise at
    // two scales, moving down the flow at a walking pace. Where it is high, and towards the
    // edges, a dark crust has formed; the cracks between the plates stay lit. `aFlow.y` is
    // distance in world units, so the plates are the same size on every flow however long
    // it is, and the scroll is in the same units, so every flow runs at the same speed.
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime;
      varying vec2 vFlow;
      varying float vHeat;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float across = abs(vFlow.x);
        vec2 p = vec2(vFlow.x * 1.3, vFlow.y * 0.8 - uTime * 0.45);
        float n = noise(p * 1.7) * 0.62 + noise(p * 4.3 + 7.1) * 0.38;
        float crust = smoothstep(0.52, 0.78, n + across * across * 0.6 - 0.18 * vHeat);
        vec3 core = mix(vec3(1.0, 0.36, 0.05), vec3(1.0, 0.78, 0.32), (1.0 - across) * vHeat);
        vec3 rock = vec3(0.09, 0.05, 0.04);
        vec3 col = mix(core * 1.35, rock, crust);
        // The seams between the plates, still molten.
        float seam = 1.0 - smoothstep(0.0, 0.05, abs(n - 0.62));
        col += vec3(1.0, 0.32, 0.04) * seam * crust * 0.8;
        // A slow throb, so a flow seen from across the water is alive and not a painted line.
        col *= 0.92 + 0.08 * sin(uTime * 1.7 + vFlow.y * 0.3);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });
}

// Where the smoke comes from: the middle of the crater, and the last point of every flow,
// where the lava runs into the sea.
function plumeSources(terrain) {
  const out = [];
  const crater = terrain.crater;
  if (crater) {
    // Sized off the crater, so the plume out of a bowl fourteen cells across is not the
    // wisp that came out of one of nine: it has to clear a rim ten units above the pool
    // and still read as a column over it from the next island.
    const k = Math.max(1, crater.r / 9);
    out.push({ x: crater.centre[0], y: crater.floor, z: crater.centre[1], puffs: 18, rise: 22 * k, drift: 12 * k, size: 2.0 * k, tone: 0x77726c, rate: 0.05 });
  }
  // A thin wisp out of every parasitic cone's pit - still warm, not erupting.
  for (const v of (crater && crater.vents) || []) {
    out.push({ x: v.x, y: terrain.worldHeight(v.x, v.z), z: v.z, puffs: 5, rise: 7, drift: 3, size: 0.7, tone: 0xa9a49c, rate: 0.08 });
  }
  for (const course of terrain.lavaFlows || []) {
    const [gx, gz] = course[course.length - 1];
    const [x, z] = terrain.cellWorld(gx, gz);
    out.push({ x, y: Math.max(0, terrain.worldHeight(x, z)), z, puffs: 6, rise: 5, drift: 2, size: 0.9, tone: 0xf2f2ef, rate: 0.16 });
  }
  return out;
}

const tmp = new THREE.Object3D();
const tmpColour = new THREE.Color();

export function createVolcanoDressing({ parent, terrain }) {
  const group = new THREE.Group();
  group.name = 'volcano';
  parent.add(group);

  const lavaGeo = lavaGeometry(terrain);
  const lavaMat = lavaMaterial();
  const lava = lavaGeo ? new THREE.Mesh(lavaGeo, lavaMat) : null;
  if (lava) {
    lava.castShadow = false;
    lava.receiveShadow = false;
    group.add(lava);
  }

  // The plumes. Every puff is a unit icosahedron that is born small at its source, swells
  // as it rises and drifts downwind, and shrinks to nothing at the top of its climb - so
  // there is no opacity per puff to keep, only a scale, and the whole lot is one material.
  const sources = plumeSources(terrain);
  const puffs = [];
  // Each puff gets its own size and its own way off the plume's centreline, from the golden
  // angle rather than from a random stream: the same plume on every screen, and no two puffs
  // stacked straight above each other, which is what made the first cut read as a column of
  // grey footballs.
  for (const s of sources) {
    for (let k = 0; k < s.puffs; k++) {
      const spin = (k * 2.39996) % 6.283;
      puffs.push({ s, phase: k / s.puffs, spin, big: 0.7 + ((k * 0.618034) % 1) * 0.6, ox: Math.cos(spin), oz: Math.sin(spin) });
    }
  }
  const smokeMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, flatShading: true,
    // Lit from underneath by what it came out of. Invisible against daylight, and at night
    // it is what keeps the plume from vanishing into the dark: without it the smoke over a
    // glowing crater was a hole in the stars.
    emissive: 0x2a1407,
  });
  const smoke = puffs.length ? new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), smokeMat, puffs.length) : null;
  if (smoke) {
    smoke.castShadow = false;
    smoke.receiveShadow = false;
    // They move every frame and wrap, so a bounding sphere taken once would cull them in
    // plain sight; the clouds do the same for the same reason.
    smoke.frustumCulled = false;
    smoke.renderOrder = 3;
    puffs.forEach((p, i) => smoke.setColorAt(i, tmpColour.setHex(p.s.tone)));
    if (smoke.instanceColor) smoke.instanceColor.needsUpdate = true;
    group.add(smoke);
  }

  let time = 0;
  function placePuffs() {
    if (!smoke) return;
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i], s = p.s;
      const a = (time * s.rate + p.phase) % 1;
      // Spreading as it climbs, and bent over by the wind the higher it gets.
      const spread = s.size * (0.3 + 1.4 * a);
      const sway = Math.sin(time * 0.5 + p.spin) * 0.4 * s.size * a;
      tmp.position.set(
        s.x + p.ox * spread + s.drift * a * a + sway,
        s.y + 0.4 + s.rise * a,
        s.z + p.oz * spread + Math.cos(time * 0.4 + p.spin) * 0.3 * s.size * a,
      );
      tmp.rotation.set(p.spin, p.spin * 0.7 + time * 0.1, 0);
      const grow = s.size * p.big * (0.35 + 1.3 * a) * (1 - a * a * a);
      tmp.scale.set(grow, grow * 0.8, grow);
      tmp.updateMatrix();
      smoke.setMatrixAt(i, tmp.matrix);
    }
    smoke.instanceMatrix.needsUpdate = true;
  }
  placePuffs();

  return {
    group,
    // The triangle count this adds, for whoever keeps the budget.
    triangles: (lavaGeo ? lavaGeo.index.count / 3 : 0)
      + (smoke ? (smoke.geometry.attributes.position.count / 3) * puffs.length : 0),
    update(dt) {
      time += dt || 0;
      lavaMat.uniforms.uTime.value = time;
      placePuffs();
    },
    dispose() {
      parent.remove(group);
      if (lavaGeo) lavaGeo.dispose();
      lavaMat.dispose();
      if (smoke) { smoke.geometry.dispose(); smoke.dispose(); }
      smokeMat.dispose();
    },
  };
}
