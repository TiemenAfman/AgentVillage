// The sea's own life: kelp forests, reefs, rocks, shells, schools of fish and the bubbles a
// diver leaves (Plans/onderwater-zwemmen.md). The drawing half - what stands where is decided by
// sea-life-plan.js, which is pure and tested.
//
// Cheap on purpose, and only ever there when it can be seen. It is switched off (`active`) from
// the sky and at the surface: it costs about a dozen draw calls and a chunk plan each time the
// focus crosses into the next 16 units, none of which a page above the water should pay for.
// One InstancedMesh per shape (a merged geometry cannot pick its variant per instance), no
// shadows (a shadow-casting instance counts twice in the `?stats` colour pass), and the still
// life is written once per chunk crossing - only the fish and the bubbles move every frame.
//
// Not on the wire and not in any layout: every page plans the same reef off the same bed, and
// the fish are ambient like the ducks in herds.js - two pages see different fish in the same
// water, and nothing depends on that.
import * as THREE from 'three';
import * as models from './models.js';
import {
  CHUNK, CAPS, KINDS, KIND_NAMES, planChunk, gather, schoolPose,
} from './sea-life-plan.js';

// A fish shows up as a fish at a few units, not a speck: the baked ones are 0.3 long, which
// against a body 0.54 tall is a sardine, so they are drawn larger.
const FISH_SCALE = [1.5, 2.3];
// How far from a diver a fish starts to leave, and how far it gets pushed at point blank.
const FLEE_R = 4;
const FLEE_PUSH = 1.4;
// How far above a diver's feet the bubbles come out: about the mouth.
const MOUTH = 0.46;
const BUBBLE_UP = [0.45, 0.85];

const Y = new THREE.Vector3(0, 1, 0);

// What is asked of a shape's geometry: the sheet its parts are on (rocks are `stone`, the rest
// `plain`), read off the bake rather than written down twice.
function geometryOf(asset) {
  if (!models.hasAsset(asset)) return null;
  const slot = models.part(models.assetParts(asset)[0]).sheet;
  return models.grouped(asset, [slot]);
}

function bubbleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.9, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A pool of bubbles in one Points object. A dead one is parked far away; a new one takes the
// next slot in a ring, so a full pool drops its oldest rather than refusing the newest.
function createBubbles(cap) {
  const positions = new Float32Array(cap * 3).fill(-9999);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const tex = bubbleTexture();
  const mat = new THREE.PointsMaterial({
    size: 0.11, sizeAttenuation: true, map: tex, transparent: true, opacity: 0.85,
    depthWrite: false, color: 0xe6f7ff, fog: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  const vy = new Float32Array(cap), phase = new Float32Array(cap), alive = new Uint8Array(cap);
  let next = 0;
  const owed = new Map();
  return {
    points,
    // Every bubble ever let go: a cue for web/js/sound.js (Plans/meer-geluiden.md), which burbles
    // when it goes up. Nothing else reads it.
    emitted: 0,
    emit(x, y, z) {
      this.emitted++;
      const i = next; next = (next + 1) % cap;
      positions[i * 3] = x + (Math.random() - 0.5) * 0.12;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.12;
      vy[i] = BUBBLE_UP[0] + Math.random() * (BUBBLE_UP[1] - BUBBLE_UP[0]);
      phase[i] = Math.random() * 6.28;
      alive[i] = 1;
    },
    // Each emitter owes `rate` bubbles a second, paid out whole as they fall due.
    feed(emitters, dt) {
      const seen = new Set();
      for (const e of emitters) {
        seen.add(e.id);
        const due = (owed.get(e.id) || 0) + dt * (e.moving ? 4.5 : 0.7);
        const whole = Math.floor(due);
        for (let k = 0; k < whole; k++) this.emit(e.x, e.y + MOUTH, e.z);
        owed.set(e.id, due - whole);
      }
      for (const id of owed.keys()) if (!seen.has(id)) owed.delete(id);
    },
    step(dt, t, surface) {
      for (let i = 0; i < cap; i++) {
        if (!alive[i]) continue;
        positions[i * 3 + 1] += vy[i] * dt;
        positions[i * 3] += Math.sin(t * 3 + phase[i]) * 0.14 * dt;
        positions[i * 3 + 2] += Math.cos(t * 2.4 + phase[i]) * 0.14 * dt;
        if (positions[i * 3 + 1] >= surface - 0.03) { alive[i] = 0; positions[i * 3 + 1] = -9999; }
      }
      geo.attributes.position.needsUpdate = true;
    },
    clear() { positions.fill(-9999); alive.fill(0); geo.attributes.position.needsUpdate = true; },
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}

// `bedAt(x, z)` is the sea floor as a diver meets it (walk.js bedUnder), in scene coordinates.
// `tier`: 'full' | 'modest' | 'phone'.
export function createSeaLife({ scene, bedAt, tier = 'full' }) {
  const caps = CAPS[tier] || CAPS.full;
  const group = new THREE.Group();
  group.visible = false;
  group.name = 'sea-life';
  scene.add(group);

  const seaT = { value: 0 };
  const stillMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  // Kelp sways from its tip, off the height in the bake: the weight of a vertex is how far up its
  // strand it is, so the foot stays where it was planted. Phase from the instance's own place, or
  // a forest would nod in step.
  const kelpMat = stillMat.clone();
  kelpMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSeaT = seaT;
    shader.vertexShader = 'uniform float uSeaT;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3( position );
      #ifdef USE_INSTANCING
        vec4 seaAnchor = instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        float seaPhase = seaAnchor.x * 0.8 + seaAnchor.z * 0.6;
      #else
        float seaPhase = 0.0;
      #endif
      float seaW = position.y;
      transformed.x += sin( uSeaT * 1.2 + seaPhase + seaW * 2.2 ) * 0.09 * seaW;
      transformed.z += cos( uSeaT * 0.9 + seaPhase * 1.3 + seaW * 1.7 ) * 0.07 * seaW;
    `);
  };
  kelpMat.customProgramCacheKey = () => 'sea-kelp';

  // The still life: one instanced mesh per shape, empty until a chunk is planned.
  const capOf = (kind) => (kind.startsWith('kelp') ? caps.kelp : kind.startsWith('coral') ? caps.coral
    : kind.startsWith('rock') ? caps.rock : caps.shell);
  const still = {};
  for (const kind of KIND_NAMES) {
    const geo = geometryOf(KINDS[kind].asset);
    if (!geo) continue;
    const mesh = new THREE.InstancedMesh(geo, kind.startsWith('kelp') ? kelpMat : stillMat, Math.max(1, capOf(kind)));
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    still[kind] = mesh;
  }

  // The fish: two species, one instanced mesh each, every matrix written every frame.
  const fishGeo = ['fauna_fish_a', 'fauna_fish_b'].map(geometryOf);
  const fish = fishGeo.map((geo) => {
    if (!geo) return null;
    const mesh = new THREE.InstancedMesh(geo, stillMat, Math.max(1, caps.fish));
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    group.add(mesh);
    return mesh;
  });
  // How far up each species' centre is over its belly, from the bake (fish are modelled with the
  // belly on y = 0): lowering a fish by this puts its middle where the school's height says.
  const FISH_LIFT = [0.075, 0.045];

  const bubbles = createBubbles(caps.bubbles);
  group.add(bubbles.points);

  // Plans are kept by chunk, so a walk back over water already planned costs nothing; the whole
  // cache goes when the bed changes under it (`reshape`).
  const cache = new Map();
  const plan = (cx, cz) => {
    const key = `${cx},${cz}`;
    let p = cache.get(key);
    if (!p) {
      p = planChunk(cx, cz, bedAt);
      cache.set(key, p);
      if (cache.size > 400) cache.delete(cache.keys().next().value);
    }
    return p;
  };

  let dirty = true, lastCx = null, lastCz = null, schools = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();

  function rebuild(x, z, reach) {
    const got = gather(x, z, reach, caps, plan);
    for (const kind of KIND_NAMES) {
      const mesh = still[kind];
      if (!mesh) continue;
      const list = got.items[kind];
      const n = Math.min(list.length, mesh.instanceMatrix.count);
      for (let i = 0; i < n; i++) {
        const it = list[i];
        q.setFromAxisAngle(Y, it.rot);
        mesh.setMatrixAt(i, m.compose(pos.set(it.x, it.y, it.z), q, sc.setScalar(it.s)));
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    schools = got.schools;
  }

  const away = new THREE.Vector3();
  function swim(t, surface, divers) {
    const used = [0, 0];
    for (const s of schools) {
      const mesh = fish[s.species];
      if (!mesh) continue;
      const c = schoolPose(s, t, bedAt, surface);
      const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
      for (let i = 0; i < s.count; i++) {
        if (used[s.species] >= mesh.instanceMatrix.count) break;
        const [ox, oy, oz, ph] = s.offsets[i];
        const wob = Math.sin(t * 1.7 + ph);
        // Offsets are drawn in the school's own frame - right and forward - and turned to where it heads.
        let x = c.x + ch * ox + sh * oz;
        let z = c.z - sh * ox + ch * oz;
        const y = c.y + oy + wob * 0.05;
        // A diver close by parts the school: every fish within FLEE_R is pushed off, the more the closer.
        for (const d of divers) {
          const dx = x - d.x, dz = z - d.z, dy = y - d.y;
          const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
          if (dist < FLEE_R && dist > 1e-3) {
            const push = ((FLEE_R - dist) / FLEE_R) ** 2 * FLEE_PUSH;
            x += (dx / dist) * push;
            z += (dz / dist) * push;
          }
        }
        const scale = FISH_SCALE[0] + ((ph / 6.2832) * (FISH_SCALE[1] - FISH_SCALE[0]));
        q.setFromAxisAngle(Y, c.heading + Math.sin(t * 3 + ph) * 0.22);
        mesh.setMatrixAt(used[s.species]++, m.compose(pos.set(x, y - FISH_LIFT[s.species] * scale, z), q, sc.setScalar(scale)));
      }
    }
    for (let k = 0; k < 2; k++) {
      if (!fish[k]) continue;
      fish[k].count = used[k];
      fish[k].instanceMatrix.needsUpdate = true;
    }
  }

  return {
    group,
    // `x`, `z`: the focus (the diver or the camera), scene coordinates. `active` is whether any of
    // it can be seen at all. `divers` are the bodies fish keep away from and `emitters` the mouths
    // bubbles come from (both `{ id, x, y, z, moving }`), `reach` the most that can be seen
    // through the water (underwater.js's mist), and `surface` the height of the sea.
    update({ x, z, active, dt, t, surface = 0, reach = Infinity, divers = [], emitters = [] }) {
      group.visible = !!active;
      if (!active) return;
      const r = Math.min(caps.reach, reach);
      seaT.value = t % 1000;
      const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
      if (dirty || cx !== lastCx || cz !== lastCz) {
        rebuild(x, z, r);
        dirty = false; lastCx = cx; lastCz = cz;
      }
      swim(t, surface, divers);
      bubbles.feed(emitters, dt);
      bubbles.step(dt, t, surface);
    },
    // The bed has changed (an island joined, the islets moved): plan again from scratch.
    reshape() { cache.clear(); dirty = true; },
    // How many bubbles have gone up, ever: sound.js's cue for a diver breathing out.
    emitted: () => bubbles.emitted,
    stats() {
      let n = 0;
      for (const kind of KIND_NAMES) n += still[kind] ? still[kind].count : 0;
      return { still: n, fish: fish.reduce((a, f) => a + (f ? f.count : 0), 0), schools: schools.length };
    },
    dispose() {
      scene.remove(group);
      for (const mesh of [...Object.values(still), ...fish]) if (mesh) { mesh.geometry.dispose(); mesh.dispose(); }
      stillMat.dispose(); kelpMat.dispose();
      bubbles.dispose();
    },
  };
}
