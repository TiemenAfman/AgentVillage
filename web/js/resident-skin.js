// The residents in the Wanderer's style, skinned on the GPU one instance at a time
// (Plans/inwoners-in-avonturierstijl.md, fase 2). scripts/build-residents.py bakes a man and a
// woman and their clothes, every corner with two joints and the first one's weight; this file
// turns a part of that bake into an instanced geometry, a crowd's poses into one texture, and
// the crowd's material into one that bends each body by its own row of it.
//
// Why matrices in the texture and not the angles the plan first named: a joint is turned about
// up to three axes (a drinking arm swings and turns in, a body leans, rolls and twists), so
// rebuilding the chain in the vertex shader is five levels of three rotations - some sixty
// sin/cos a vertex, for both influences, in both passes, on every body in reach. Composed here
// it is seventeen small matrix products per figure on the CPU, where the old crowd already did
// eleven of them, and six texel fetches a vertex. What goes up a frame is 51 texels a figure,
// about what the eleven instance matrices of the old body cost.
import * as THREE from 'three';
import { RESIDENTS } from './residents-mesh.js';

export const RESIDENT_JOINTS = RESIDENTS.male.rig.joints;
export const JOINT = Object.fromEntries(RESIDENT_JOINTS.map((n, i) => [n, i]));
const N = RESIDENT_JOINTS.length;
// A joint is three texels: the three rows of its 3x4 matrix.
export const POSE_TEXELS = 3;
export const POSE_FLOATS = N * 12;

// The bake's parts, by sex and id.
const PARTS = Object.fromEntries(Object.entries(RESIDENTS).map(([sex, b]) =>
  [sex, Object.fromEntries(b.parts.map((p) => [p.id, p]))]));
export function residentPartOf(sex, id) { return PARTS[sex]?.[id] || null; }
export function residentRig(sex) { return RESIDENTS[sex].rig; }
// The skin parts that show for one outfit: the always part and the bare pieces whose `shows`
// holds `<bottom>/<feet>` (build-residents.py: the shins under a skirt, above a clog).
export function skinPartsFor(sex, bottom, feet) {
  const combo = `${bottom}/${feet}`;
  return RESIDENTS[sex].parts.filter((p) => p.kind === 'skin' && p.shows.includes(combo)).map((p) => p.id);
}

// One part of the bake as a geometry the skinned material draws: the corner arrays as they are,
// the joints as bytes, no emissive (the building material reads it), and room for the per-instance
// pose row (`aFigure`), which the crowd writes. A new geometry per call: an instanced attribute
// lives on the geometry, so two meshes cannot share one.
export function residentGeometry(part, capacity) {
  const g = new THREE.BufferGeometry();
  const n = part.positions.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(part.colors, 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aJoints', new THREE.BufferAttribute(Uint8Array.from(part.joints), 2));
  g.setAttribute('aWeight', new THREE.Float32BufferAttribute(part.weights, 1));
  g.setAttribute('aFigure', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
  g.computeBoundingSphere();
  return g;
}

const SKIN_DECL = [
  'attribute vec2 aJoints;',
  'attribute float aWeight;',
  'attribute float aFigure;',
  'uniform highp sampler2D uPose;',
  'mat4 residentJoint(int j, int row) {',
  '  vec4 a = texelFetch(uPose, ivec2(j * 3, row), 0);',
  '  vec4 b = texelFetch(uPose, ivec2(j * 3 + 1, row), 0);',
  '  vec4 c = texelFetch(uPose, ivec2(j * 3 + 2, row), 0);',
  '  return mat4(a.x, b.x, c.x, 0.0, a.y, b.y, c.y, 0.0, a.z, b.z, c.z, 0.0, a.w, b.w, c.w, 1.0);',
  '}',
  'mat4 residentSkin() {',
  '  int row = int(aFigure + 0.5);',
  '  return residentJoint(int(aJoints.x), row) * aWeight + residentJoint(int(aJoints.y), row) * (1.0 - aWeight);',
  '}',
].join('\n');

// Splices the skin into a shader that some other onBeforeCompile has already had: after
// <begin_vertex>, so it bends whatever that left in `transformed` and the instance matrix still
// places the result; the normal too where the shader has one (the depth pass has none).
export function patchSkin(shader, pose) {
  shader.uniforms.uPose = pose;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${SKIN_DECL}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (residentSkin() * vec4(transformed, 1.0)).xyz;');
  if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\nobjectNormal = mat3(residentSkin()) * objectNormal;');
  }
}

// The crowd's material with the skin in it: a clone that shares the source's userData (its night,
// fade and sheet uniforms, so they reach it live), runs the source's hook first and adds `-skin`
// to its key, as solidMaterial in buildings.js does for the see-through. Its own uPose, because
// every crowd has its own figures, and its own depth twin with the same patch, or the shadow is a
// stiff doll. The source's fade flipping recompiles both through `followers`.
// Cloned without its userData: three copies that through JSON, and the source's `followers`
// holds every earlier clone, whose userData is the source's - the second crowd made from one
// material threw on the circle.
function bare(m) {
  const kept = m.userData;
  m.userData = {};
  try { return m.clone(); } finally { m.userData = kept; }
}
export function skinnedMaterial(base, pose) {
  const mat = bare(base);
  mat.userData = base.userData;
  const hook = base.onBeforeCompile;
  const key = base.customProgramCacheKey;
  mat.onBeforeCompile = function (shader, renderer) {
    hook.call(this, shader, renderer);
    patchSkin(shader, pose);
  };
  mat.customProgramCacheKey = function () { return key.call(this) + '-skin'; };
  const baseDepth = base.userData && base.userData.fadeDepth;
  const depth = baseDepth ? bare(baseDepth) : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const depthHook = baseDepth ? baseDepth.onBeforeCompile : () => {};
  const depthKey = baseDepth ? baseDepth.customProgramCacheKey : () => 'depth';
  depth.onBeforeCompile = function (shader, renderer) {
    depthHook.call(this, shader, renderer);
    patchSkin(shader, pose);
  };
  depth.customProgramCacheKey = function () { return depthKey.call(this) + '-skin'; };
  // Not enumerable: three clones a material's userData through JSON, and every other clone of the
  // crowd's material (a player's rig in classic-avatar.js, a room's walk) choked on a list of
  // materials whose userData is this one - the circle.
  if (base.userData && !base.userData.followers) {
    Object.defineProperty(base.userData, 'followers', { value: [], enumerable: false });
  }
  const followers = base.userData ? base.userData.followers : [];
  followers.push(mat, depth);
  const dispose = () => {
    for (const m of [mat, depth]) {
      const i = followers.indexOf(m);
      if (i >= 0) followers.splice(i, 1);
      m.dispose();
    }
  };
  return { material: mat, depth, dispose };
}

// The crowd's poses: one row per drawn figure, POSE_FLOATS wide, grown in powers of two so it is
// made again only a handful of times however the crowd grows, and sent up only while anybody in
// it is drawn. `uniform` is what the material's uPose is.
export function createPoseTexture() {
  const uniform = { value: null };
  let rows = 0, data = null;
  function ensure(n) {
    if (n <= rows) return;
    let r = Math.max(16, rows);
    while (r < n) r *= 2;
    const next = new Float32Array(r * N * POSE_TEXELS * 4);
    if (data) next.set(data);
    data = next;
    rows = r;
    if (uniform.value) uniform.value.dispose();
    const t = new THREE.DataTexture(data, N * POSE_TEXELS, rows, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    uniform.value = t;
  }
  ensure(16);
  return {
    uniform,
    get data() { return data; },
    ensure,
    // Row `i`'s floats into the texture's data.
    write(i, joints) { ensure(i + 1); data.set(joints, i * POSE_FLOATS); },
    // Two rows trade places (a figure changing sides in the packed pose batch).
    swap(i, j) {
      ensure(Math.max(i, j) + 1);
      for (let k = 0; k < POSE_FLOATS; k++) {
        const a = i * POSE_FLOATS + k, b = j * POSE_FLOATS + k;
        const t = data[a]; data[a] = data[b]; data[b] = t;
      }
    },
    upload() { if (uniform.value) uniform.value.needsUpdate = true; },
    dispose() { if (uniform.value) uniform.value.dispose(); uniform.value = null; },
  };
}

// ---- posing ------------------------------------------------------------------------------
// A pose is three angles a joint (`x`, `y`, `z`, Float32Arrays of N, turned X then Y then Z as a
// three.js Euler is), plus the body's own proportions: `build` across, `height` up, and `head`,
// the size the head is drawn at over whatever body it sits on (shared/palette.mjs settlerLook).
export function createPose() {
  return { x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), build: 1, height: 1, head: 1 };
}
export function clearPose(p) { p.x.fill(0); p.y.fill(0); p.z.fill(0); p.build = p.height = p.head = 1; return p; }

// 3x4 matrices as 12 numbers, row-major: [r00 r01 r02 tx, r10 ... ty, r20 ... tz]. Float64 while
// they are worked on (a Float32Array would round every product on the way through), unrolled,
// because this runs seventeen times a figure a frame.
const world = new Float64Array(N * 12);
const local = new Float64Array(12);
function mul(out, o, a, ao, b) {
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
  const b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
  for (let r = 0; r < 12; r += 4) {
    const a0 = a[ao + r], a1 = a[ao + r + 1], a2 = a[ao + r + 2], a3 = a[ao + r + 3];
    out[o + r] = a0 * b0 + a1 * b4 + a2 * b8;
    out[o + r + 1] = a0 * b1 + a1 * b5 + a2 * b9;
    out[o + r + 2] = a0 * b2 + a1 * b6 + a2 * b10;
    out[o + r + 3] = a0 * b3 + a1 * b7 + a2 * b11 + a3;
  }
}
// Rotation X then Y then Z (R = Rx Ry Rz) about the point p, into `local`. A turn about x alone is
// most of what a figure does (a stride, a swing, a knee), and pays for one sine and one cosine.
function turnAbout(x, y, z, p) {
  if (y === 0 && z === 0) {
    const c = Math.cos(x), s = Math.sin(x);
    local[0] = 1; local[1] = 0; local[2] = 0; local[3] = 0;
    local[4] = 0; local[5] = c; local[6] = -s; local[7] = p[1] - (c * p[1] - s * p[2]);
    local[8] = 0; local[9] = s; local[10] = c; local[11] = p[2] - (s * p[1] + c * p[2]);
    return;
  }
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const r00 = cy * cz, r01 = -cy * sz, r02 = sy;
  const r10 = cx * sz + sx * sy * cz, r11 = cx * cz - sx * sy * sz, r12 = -sx * cy;
  const r20 = sx * sz - cx * sy * cz, r21 = sx * cz + cx * sy * sz, r22 = cx * cy;
  local[0] = r00; local[1] = r01; local[2] = r02; local[3] = p[0] - (r00 * p[0] + r01 * p[1] + r02 * p[2]);
  local[4] = r10; local[5] = r11; local[6] = r12; local[7] = p[1] - (r10 * p[0] + r11 * p[1] + r12 * p[2]);
  local[8] = r20; local[9] = r21; local[10] = r22; local[11] = p[2] - (r20 * p[0] + r21 * p[1] + r22 * p[2]);
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
// Every joint's matrix in the figure's own frame (feet at the origin, before the instance matrix
// places and turns it), into `out` at `o`: the chain of turns about each joint's rest point, the
// body stretched by build and height under it, and the head - with the hair and the hat, which
// are weighted to it - at its own size about the neck rather than stretched with the body.
export function poseJoints(rig, pose, out, o = 0) {
  const pts = rig.points, parents = rig.parents;
  for (let j = 0; j < N; j++) {
    const x = pose.x[j], y = pose.y[j], z = pose.z[j], up = parents[j], w = j * 12;
    // A joint not turned is where its parent took it.
    if (x === 0 && y === 0 && z === 0) {
      if (up < 0) world.set(IDENTITY, w);
      else world.copyWithin(w, up * 12, up * 12 + 12);
      continue;
    }
    turnAbout(x, y, z, pts[j]);
    if (up < 0) world.set(local, w);
    else mul(world, w, world, up * 12, local);
  }
  // The head scaled about its own point by (head/build, head/height, head/build), so after the
  // body's stretch below it comes out `head` all round: M T(p) D T(-p) is M with its columns
  // scaled by D and its translation moved by M's rotation of p - Dp.
  const b = pose.build, h = pose.height;
  const hw = JOINT.head * 12, hp = pts[JOINT.head];
  const dx = pose.head / b, dy = pose.head / h;
  if (dx !== 1 || dy !== 1) {
    const d = [dx, dy, dx];
    for (let r = 0; r < 12; r += 4) {
      world[hw + r + 3] += world[hw + r] * hp[0] * (1 - dx) + world[hw + r + 1] * hp[1] * (1 - dy) + world[hw + r + 2] * hp[2] * (1 - dx);
      world[hw + r] *= d[0]; world[hw + r + 1] *= d[1]; world[hw + r + 2] *= d[2];
    }
  }
  for (let w = 0; w < N * 12; w += 12) {
    const at = o + w;
    out[at] = world[w] * b; out[at + 1] = world[w + 1] * b; out[at + 2] = world[w + 2] * b; out[at + 3] = world[w + 3] * b;
    out[at + 4] = world[w + 4] * h; out[at + 5] = world[w + 5] * h; out[at + 6] = world[w + 6] * h; out[at + 7] = world[w + 7] * h;
    out[at + 8] = world[w + 8] * b; out[at + 9] = world[w + 9] * b; out[at + 10] = world[w + 10] * b; out[at + 11] = world[w + 11] * b;
  }
  return out;
}

// One joint of a posed row as a Matrix4, for what hangs rigidly off it (a tool in a fist).
export function jointMatrix(joints, o, j, target = new THREE.Matrix4()) {
  const w = o + j * 12;
  return target.set(
    joints[w], joints[w + 1], joints[w + 2], joints[w + 3],
    joints[w + 4], joints[w + 5], joints[w + 6], joints[w + 7],
    joints[w + 8], joints[w + 9], joints[w + 10], joints[w + 11],
    0, 0, 0, 1);
}

// Where a fist holds things, in the rest frame: a little past the wrist along the forearm.
export function gripOf(sex, side) {
  const rig = residentRig(sex);
  const w = rig.points[JOINT[side + 'Wrist']], e = rig.points[JOINT[side + 'Elbow']];
  return [0, 1, 2].map((k) => w[k] + (w[k] - e[k]) * 0.35);
}
