// Fog by distance, not by depth.
//
// three's fog is linear in *depth* - `vFogDepth = -mvPosition.z`, how far along the view axis
// a point lies - so at the edge of the picture a thing is less fogged than the same thing
// straight ahead, and turning the camera moves the haze across a house that has not moved.
// Measured on a 16:9 frame at 45 degrees, the corner is only ~0.76 as deep as it is far.
//
// That used to be a curiosity. It stopped being one when Object Distance started taking
// houses out of the picture (Plans/graphics-afstanden.md): the rule is that a house is only
// ever cut where the fog has already closed over it, so it comes *out of the mist* on the way
// in rather than appearing, and on a depth fog "already closed" was true in the middle of the
// screen and false at its corners. On a distance fog it is true everywhere, and the cut and
// the haze agree about what "far" means - the CPU cut (main.js keepRecord) measures the same
// straight line.
//
// The far plane is still a plane, and it still cuts on depth; distance is never less than
// depth, so a fog that closes inside the far plane straight ahead closes inside it
// everywhere. What the old comment in setFogRange promised - the far-plane cut is always in
// full fog - holds with more margin at the corners, not less.
//
// One chunk, patched once before anything compiles. Every material that fogs goes through
// `#include <fog_vertex>` with `mvPosition` in scope: three's own, the building material's
// onBeforeCompile, and the hand-written water, lava and weather shaders alike. So this is the
// one place it can be done, and tests/fade.test.mjs holds the original text it replaces - a
// three upgrade that rewrote the chunk would otherwise leave this a silent no-op.
export const DEPTH_FOG_LINE = 'vFogDepth = - mvPosition.z;';
export const RADIAL_FOG_LINE = 'vFogDepth = length( mvPosition.xyz );';

export function useRadialFog(THREE) {
  const chunk = THREE.ShaderChunk.fog_vertex;
  if (chunk.includes(RADIAL_FOG_LINE)) return true;
  if (!chunk.includes(DEPTH_FOG_LINE)) return false;
  THREE.ShaderChunk.fog_vertex = chunk.replace(DEPTH_FOG_LINE, RADIAL_FOG_LINE);
  return true;
}
