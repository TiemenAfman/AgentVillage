// What stands between the camera and the walker is seen through: the trees (world.js) and the
// buildings (buildingMat in main.js, through createBuildingMaterial's `seeThrough`). With the
// follow camera at a fixed distance by default (camera-prefs.js), a walker otherwise lost their
// own figure behind the first crown or wall the camera passed.
//
// Two halves, and they are deliberately not the same shape.
//
// The TRIGGER is the walker's own silhouette: main.js (seeThroughFrame) casts rays from the feet,
// the middle, the head and both shoulders (SILHOUETTE) to the camera, against walk mode's boom
// test (buildings' part boxes and blockers with a height) and the crowns (world.js crowns()). Only
// when one of them is cut does the hole open, eased in and out by `uSeeOn` (0..1). A noticeboard
// standing beside the walker cuts none of them and stays whole. Doing that test per pixel was
// tried and is wrong by construction: a pixel cannot know whether its object covers the body
// somewhere else, so the cone either reached past the body's sides (a board beside you went)
// or was cut to the body's own oval (a hole the shape of a body in a roof, which looked like a
// fault, not a window).
//
// The HOLE is round and soft, and opens only while something covers: a cone from the camera to
// the middle of the body, SEE_R across at the body, stippled away the way fade.js does it - a hash
// and a discard, still the opaque pass: nothing sorted, the shadow pass untouched, so a house or a
// wood keeps its shadow on the ground. Worked out in view space, where the camera is the origin:
// `vViewPosition` is in every lit material three has and has already been through the instance or
// batch matrix, so the same lines serve an InstancedMesh of trees and the island's BatchedMesh.
//
// Only what stands higher than a step over the walker's feet is let through: a pier's planks, a
// bridge's deck, a porch or the galleon's deck under the body lie inside the cone too, and a floor
// stippled away round your feet reads as falling through it.
import * as THREE from 'three';

const SEE_THROUGH = {
  uSeeFocus: { value: new THREE.Vector3() },
  uSeeOn: { value: 0 },
};
// How much is let through at most: a crown stays readable as a crown, a wall as a wall.
const SEE_MAX = 0.8;
// The hole's radius at the body, in island units; it shrinks to nothing at the camera. The figure
// is ~0.55 from feet to hat, so this shows all of it with a soft rim (from SEE_SOFT of the way out).
const SEE_R = 0.6, SEE_SOFT = 0.35;
// The focus is the middle of the body (main.js passes feet + BODY_MID); what is lower than
// FLOOR_CLEAR over the feet is never let through.
export const BODY_MID = 0.3;
const FLOOR_CLEAR = 0.15;
// Where the trigger's rays leave the body: [across, up] from the feet, across being the camera's
// own right. Feet, middle and head, and the shoulders - the silhouette, not the hole.
export const SILHOUETTE = [[0, 0.08], [0, BODY_MID], [0, 0.52], [-0.15, 0.32], [0.15, 0.32]];
// How fast the hole opens and closes, per second (exponential).
export const SEE_EASE = 8;

// main.js hands over how open the hole is (0 shut, 1 open) and where the middle of the body is.
export function setSeeThrough(amount, x = 0, y = 0, z = 0) {
  SEE_THROUGH.uSeeOn.value = amount;
  if (amount > 0) SEE_THROUGH.uSeeFocus.value.set(x, y, z);
}

const f = (n) => n.toFixed(2);
const DECL = [
  'uniform vec3 uSeeFocus;',
  'uniform float uSeeOn;',
  'float seeHash(vec2 p) {',
  '  vec3 q = fract(vec3(p.xyx) * 0.1031);',
  '  q += dot(q, q.yzx + 33.33);',
  '  return fract((q.x + q.y) * q.z);',
  '}',
].join('\n');
const BODY = [
  'if (uSeeOn > 0.001) {',
  '  vec3 seeF = (viewMatrix * vec4(uSeeFocus, 1.0)).xyz;',
  '  vec3 seeP = -vViewPosition;',
  // viewMatrix[1].xyz is the world's up in view space: how high this point is over the body.
  `  if (dot(seeP - seeF, viewMatrix[1].xyz) > ${f(FLOOR_CLEAR - BODY_MID)}) {`,
  '    float seeT = dot(seeP, seeF) / max(dot(seeF, seeF), 1e-4);',
  '    if (seeT > 0.0 && seeT < 1.0) {',
  `      float seeD = distance(seeP, seeF * seeT) / (${f(SEE_R)} * seeT);`,
  `      float seeA = ${f(SEE_MAX)} * uSeeOn * (1.0 - smoothstep(${f(SEE_SOFT)}, 1.0, seeD));`,
  '      if (seeA > seeHash(gl_FragCoord.xy)) discard;',
  '    }',
  '  }',
  '}',
].join('\n');

// Splices the cone into a lit material's shader inside its own onBeforeCompile. The caller
// keeps its customProgramCacheKey distinct from the unpatched program's.
export function patchSeeThrough(shader) {
  Object.assign(shader.uniforms, SEE_THROUGH);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${DECL}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${BODY}`);
}
