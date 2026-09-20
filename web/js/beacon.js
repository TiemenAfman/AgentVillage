// The lighthouse's light, and the bar of air it stands in.
//
// The tower has had a sweeping SpotLight on it since it was first built, and a spotlight
// with nothing in the air to catch it is a pool of brightness on the grass at its own
// feet: you had to be standing beside the lighthouse to know it was lit, which is the one
// thing a lighthouse is not for. So the lamp gets a body - a cone of faintly glowing air
// turning with it - and the thing becomes visible from across the water, which is the
// whole point of having built it.
//
// Why this is its own module rather than six more lines in main.js: three pages want it.
// Our island hangs it on a record in `attachExtras`, a guest island's records go through
// that same call, and /demo builds its own field of civics without a village at all.
// web/js/clock.js and web/js/fountain.js are the same shape and are here for the same
// reason.
//
// THE BUDGET. One mesh, one material, no texture, no shadow, and nothing at all by day -
// `visible` is false below a trace of night, so a lighthouse on a sunny island costs the
// renderer a boolean. Additive with depthWrite off, so it neither hides what is behind it
// nor has to be sorted against it. A material array here would be the mistake CLAUDE.md
// records: it is what turned 300 houses into thousands of draw calls once before.
//
// Measured on this island - 256 cells, 124 buildings, 80 settlers, standard (not modest),
// at ?hour=21 with ?stats, against the same frame with the beam meshes taken out:
//
//   one island in the sea, our own                       217 calls,  216 without   +1
//   seven islands: ours, four alongside, two far off     233 calls,  229 without   +4
//     (three of the seven have a lighthouse; the fourth of those four is the
//      horizon's own point of light, web/js/horizon.js, one call each)
//   the same seven, camera down on our own island        222 calls,  220 without   +2
//   any of the above at ?hour=12                         no change,  nothing drawn
//
// One call per lit lighthouse, and never more than one. That is not automatic: see
// `forceSinglePass` below, which is the difference between this list and twice it.
import * as THREE from 'three';

// How fast the lamp goes round, in radians a second. The number the island has always
// swept at; it is here rather than in main.js so the beam and the light cannot drift.
// Exported because web/js/horizon.js flashes a far island's lighthouse on the same beat -
// an island that drifts out of the near set must go on keeping the time it was keeping.
export const SWEEP = 0.85;

// How far the drawn beam reaches. The SpotLight's own range is 60 with a decay of 1.2, so
// by 52 units its light is long spent - drawing the air past that would be a lit bar with
// nothing underneath it, which reads as a solid object rather than as a beam.
const BEAM_LEN = 52;
// Half the beam's opening, and deliberately narrower than the SpotLight's own 0.3. That
// 0.3 is drawn with a penumbra of 0.6, so two thirds of its cone is falloff and only the
// core is a beam anybody would point at; a mesh has no penumbra, so matching the number
// would draw the falloff at full strength - a 17-degree wedge of lit air 52 units long,
// standing between the viewer and the sea.
const BEAM_ANGLE = 0.2;
// And how far it tilts down over that reach. It cannot be the SpotLight's own aim: that
// target sits 4.4 below the lamp at a radius of 16, which is 0.27 rad, and a beam at that
// angle leaves a lamp 2.4 up and is in the ground 9 units from the tower. 0.06 puts the
// far end of the axis at about the waterline, so the beam skims the sea for its whole
// length - which is what the light and the pool under it are meant to look like together.
const BEAM_DROP = 0.06;
// Where the beam starts. The lantern's glass is a cylinder of exactly this radius in
// buildings.js, so the cone leaves the lantern at the lantern's own width rather than
// from a mathematical point somewhere inside it.
const BEAM_THROAT = 0.19;
// How bright at full night, before the cone's two walls are added together: it is
// DoubleSide, so the near wall and the far wall both contribute, and that overlap is what
// gives the beam a soft core without a texture.
const BEAM_PEAK = 0.13;

const SEGMENTS = 18;   // seen edge-on far more often than end-on, so this is plenty round
const RINGS = 5;       // enough to fade along its length; two would interpolate linearly

// One geometry and one material for every lighthouse in the world, ours and the guests'.
// The fade is baked into vertex colours rather than drawn from a gradient texture: a
// texture is a fetch, and CLAUDE.md is plain that nothing is fetched at boot.
let beamGeo = null;
let beamMat = null;

function geometry() {
  if (beamGeo) return beamGeo;
  const tipR = Math.tan(BEAM_ANGLE) * BEAM_LEN;
  // The downward tilt is baked in here rather than set on the mesh, so that the only
  // thing the frame loop touches is rotation.y - the sweep - and the two cannot be
  // applied in the wrong order.
  const cos = Math.cos(BEAM_DROP), sin = Math.sin(BEAM_DROP);
  const pos = new Float32Array(RINGS * SEGMENTS * 3);
  const col = new Float32Array(RINGS * SEGMENTS * 3);
  const idx = [];
  const tint = new THREE.Color(0xffeaa8);
  for (let r = 0; r < RINGS; r++) {
    const t = r / (RINGS - 1);
    const x = t * BEAM_LEN;
    const rad = BEAM_THROAT + t * (tipR - BEAM_THROAT);
    // Fading faster than linear, because light does. It is also why there are five rings
    // and not two: a colour is interpolated across a triangle, so a cone with a bright end
    // and a dark end can only ever fade in a straight line however the ends are chosen.
    const f = Math.pow(1 - t, 1.8);
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const y = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const k = (r * SEGMENTS + s) * 3;
      pos[k] = x * cos + y * sin;
      pos[k + 1] = -x * sin + y * cos;
      pos[k + 2] = z;
      col[k] = tint.r * f; col[k + 1] = tint.g * f; col[k + 2] = tint.b * f;
    }
  }
  for (let r = 0; r < RINGS - 1; r++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = r * SEGMENTS + s, b = r * SEGMENTS + (s + 1) % SEGMENTS;
      const c = a + SEGMENTS, d = b + SEGMENTS;
      idx.push(a, c, b, b, c, d);
    }
  }
  beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  beamGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  beamGeo.setIndex(idx);
  // The mesh only ever turns about its own apex, so this sphere is right in local space
  // for every angle the sweep can reach and the frustum cull is exact without a rebuild.
  beamGeo.computeBoundingSphere();
  return beamGeo;
}

function material() {
  if (beamMat) return beamMat;
  beamMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Both walls of the cone add, which is what gives the beam a soft core without a
    // texture - and this is what keeps that at ONE draw call. Since r152 three.js puts a
    // transparent double-sided object in the render list twice, back faces then front, so
    // that a stained-glass window sorts correctly against itself. Measured here: two calls
    // a beam instead of one, on every island that has a lighthouse. Additive blending is
    // commutative - dst + a + b is dst + b + a - so the second pass buys this material
    // nothing at all and is simply switched off.
    forceSinglePass: true,
    // Haze added to an additive surface is haze *added*, so a fogged beam paints a grey
    // wedge over the water rather than fading into it. It is also the honest answer: a
    // light you can see through weather is what a lighthouse is, and horizon.js's own lit
    // windows are fog: false for the same reason.
    fog: false,
  });
  return beamMat;
}

// Hang a lamp on a building group at the anchor buildBuilding handed back.
//
// The light, its target and the beam all go in the SAME group, which is what keeps them in
// step through the building's own yaw: `pose.yaw` has already turned the group, so a beam
// that turned in world space would sweep past a target that turned with the tower.
export function attachBeacon(group, at) {
  const light = new THREE.SpotLight(0xfff2b0, 0, 60, 0.3, 0.6, 1.2);
  light.position.set(...at);
  const target = new THREE.Object3D();
  target.position.set(14, -1, 0);

  const beam = new THREE.Mesh(geometry(), material());
  beam.position.set(...at);
  beam.castShadow = false;
  beam.receiveShadow = false;
  // Drawn after the solid world so it lays over the coast rather than fighting it for the
  // same depth. It writes no depth of its own, so nothing after it is disturbed.
  beam.renderOrder = 3;
  beam.visible = false;

  group.add(light, target, beam);
  light.target = target;
  return { light, target, beam, a: 0 };
}

// One step of the sweep. `night` is the world's own 0..1, the same number the spotlight
// has always faded on.
//
// The opacity is set on the shared material from inside a per-beacon call, which looks
// like a mistake and is not: every lighthouse in the world is lit by the one sky, so
// every caller writes the same value, and the alternative is a second hook line in
// main.js's frame loop for a number that could never differ.
export function updateBeacon(b, dt, night = 0) {
  if (!b) return;
  b.a += dt * SWEEP;
  b.target.position.set(Math.cos(b.a) * 16, -2, Math.sin(b.a) * 16);
  b.light.intensity = 55 * night;
  // Turning by MINUS a, and the sign is the whole of it: a rotation about +Y sends local
  // +X to (cos a, 0, -sin a), while the target on the line above walks to (cos a, ., +sin
  // a). Turned by +a the beam and the light would agree twice a revolution and be mirrored
  // about the x axis the rest of the time - which looks like a beam that is nearly right.
  b.beam.rotation.y = -b.a;
  // Nothing at all by day. The threshold rather than zero opacity because an invisible
  // mesh is skipped before it is a draw call, where a transparent one is still sorted,
  // still uploaded and still drawn.
  b.beam.visible = night > 0.02;
  b.beam.material.opacity = BEAM_PEAK * night;
}
