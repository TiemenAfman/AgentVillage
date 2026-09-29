// How far away is this, and what happens to it on the way to the edge?
//
// All four graphics distances ask the same question, and three of them answer it the same
// way: a thing is drawn solid, then faded, then not drawn at all. This is that one answer,
// in a file with no three.js in it, so a test can ask it without a renderer.
//
// The four are not the same knob with four names, and that is the whole reason this file
// exists rather than a line in main.js. View Distance moves `camera.far`, which moves the
// fog and with it the sea, the beach and the horizon. Object Distance moves how far a
// *house* is drawn. NPC Distance moves how far a *person* is drawn. Shadow Distance moves
// nothing anybody can see except the length of a shadow. Coupling any two of them turns one
// slider into a fight with the other three.
//
// ---------------------------------------------------------------------------------
// The band starts at 80% and runs to the range
// ---------------------------------------------------------------------------------
// Pop-in is the reason the last fifth is not a cliff. A building that simply stops being
// there at exactly 300 units is visible doing it, because the eye tracks a thing that was
// there a moment ago and is not now. The same argument is why the fog in world.js closes
// *inside* the far plane: the cut has to happen where nothing can see it.
//
// So the last fifth of every range is a fade. FADE_START is where it begins, as a fraction
// of the range, and everything nearer than that is completely solid.
export const FADE_START = 0.8;
export const FADE_BAND = 1 - FADE_START;

// How faded a thing at `dist` is: 0 solid, 1 gone. Mirrors the shader below exactly, and
// tests/fade.test.mjs holds the two together.
//
// A range of 0 means "off", not "invisible". A slider nobody has touched yet, or an island
// with nothing on it, must not come up blank.
export function fadeAmount(dist, range) {
  if (!(range > 0)) return 0;
  const band = range * FADE_BAND;
  if (band <= 0) return 0;
  const a = (dist - range * FADE_START) / band;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

// ---------------------------------------------------------------------------------
// When the fade is worth compiling at all
// ---------------------------------------------------------------------------------
// This is why the shader patch below is switched on and off instead of always being there.
// A `discard` in the fragment shader costs the early depth test for the *whole material*,
// and one material here is every building, prop, boat, animal and person on the island - so
// the dither is compiled in only where a cut could be seen without it.
//
// A cut is invisible when everything cut is already in full fog. Two things make that
// question harder than "is the range past fog.far", and the first version of this function
// asked exactly that and was wrong on both (and on a third, now gone):
//
// - fog.far is not a constant. applyFogRange moves it with the zoom, the neighbours, the
//   world's edge and the weather, and it can do so every frame. Deciding against a moment's
//   fog.far meant a clearing sky left the dither out while the cut came out of the haze.
//   `fogCap` is therefore the ceiling fog.far can never pass - main.js fogCeiling: inside the
//   far plane, and never past Object Distance - so the answer holds whatever the haze does.
// - Recompiling is not free, so a decision that flipped with the haze would stutter; one
//   against the ceiling flips only when a slider is dragged.
// - (Gone:) three's fog was linear in *depth*, and a cut is on a distance; at the corner of
//   the frame a thing is only ~0.76 as deep as it is far, so a cut "past the fog" was in clear
//   air there. The fog is by distance now (radial-fog.js), and the two agree everywhere.
//
// Because the ceiling is never past Object Distance, a building cut never needs the dither -
// it is always cut in full fog, and comes out of the mist on the way back. The people do:
// NPC Distance can lie well inside the haze.
export function fadeNeeded(range, fogCap) {
  return range > 0 && range < fogCap;
}

// The furthest the haze may close (main.js fogCeiling): inside the far plane - `view` is
// already FOG_CAP of it - and never further out than Object Distance, so a house is always
// cut in full fog and comes out of it on the way in. The planner draws the whole island.
export function fogCeilingOf(view, objectDistance, plan = false) {
  if (plan || !(objectDistance > 0)) return view;
  return Math.min(view, objectDistance);
}

// Object Distance from above. It is a distance to the camera, and from the sky that let a
// low setting take away the very village the camera orbits: pulled back past Object Distance,
// the town under the target went into the fog and out of the picture. So in orbit it never
// lies nearer than the target's own distance times ORBIT_REACH plus ORBIT_MARGIN. The factor
// is what keeps the target itself out of the haze at every zoom: setFogRange opens the haze
// at 0.8 of where it closes, and 0.8 x 1.5 is past 1. The margin is the neighbourhood round
// it when the camera is close in. On foot `orbit` is null and the setting means exactly what
// it says - that is the price, and the reason the floor is only ever a floor.
export const ORBIT_REACH = 1.5;
export const ORBIT_MARGIN = 32;
export function objectReachOf(objectDistance, orbit = null) {
  if (!(objectDistance > 0) || !(orbit >= 0)) return objectDistance;
  return Math.max(objectDistance, orbit * ORBIT_REACH + ORBIT_MARGIN);
}

// ---------------------------------------------------------------------------------
// The cut behind the fade
// ---------------------------------------------------------------------------------
// The dither only throws pixels away; the vertices are still transformed and the triangles
// still rasterised, and the mill still turns. A record past its range is therefore also
// taken out of the render list on the CPU (main.js keepRecord) - but only once it is gone,
// in the fog or in the shader, or the cut is a pop after all. A record is judged by its origin, and
// a building reaches out from its origin: CULL_PAD is more than the reach of the biggest
// thing on the island (a ship's lot is 4 x 16, and the Batavia's masts stand above it), so a
// record whose origin is CULL_PAD past the range has nothing left nearer than the range.
// CULL_HYST keeps a record on the line from going in and out every frame; it is inside the
// pad, so either side of it is invisible anyway.
export const CULL_PAD = 16;
export const CULL_HYST = 2;

// Whether a record at `dist` (straight-line, from the eye) should be out of the render list,
// given whether it is out now. A range of 0 is off, as everywhere in this file.
export function cullNext(dist, range, culled) {
  if (!(range > 0)) return false;
  const edge = range + CULL_PAD;
  return culled ? dist >= edge - CULL_HYST : dist >= edge;
}

// ---------------------------------------------------------------------------------
// The shader
// ---------------------------------------------------------------------------------
// Every one of these shapes is drawn with the one building material, so the fade cannot be
// a material property - one opacity belongs to the whole island. The existing
// `onBeforeCompile` in createBuildingMaterial already carries per-object data to the shader
// as vertex attributes (aEmissive, aSheet), and this follows that road rather than inventing
// a second one.
//
// Two things make it cheap. There is no uniform for the camera in the colour pass:
// `mvPosition` is in view space, where the eye is the origin by definition, so
// `length(mvPosition.xyz)` *is* the distance - the same one the fog now uses (radial-fog.js)
// and the CPU cut measures, so the three agree about what "far" means. And it is correct for
// the instanced crowd without knowing anything about instancing, because project_vertex
// applies the instanceMatrix before the modelViewMatrix.
//
// The discard happens where it is cheapest - after the emissive, before any of the lighting
// is done - and it is a hash rather than an alpha, so a fading house stays in the opaque
// pass. No transparency, nothing to sort, depth writes untouched, one draw call per building.
//
// The numbers are interpolated from the constants above, not typed out twice, because a
// band that starts at 80% on the CPU and 79% on the screen is a bug nobody finds by staring.
const F = (n) => n.toFixed(4);
const band = (dist) => `uFadeRange > 0.0 ? clamp((${dist} - uFadeRange * ${F(FADE_START)})`
  + ` / (uFadeRange * ${F(FADE_BAND)}), 0.0, 1.0) : 0.0`;

export const FADE_VERTEX_DECL = [
  'uniform float uFadeRange;',
  'varying float vFade;',
].join('\n');

export const FADE_VERTEX_BODY = `vFade = ${band('length(mvPosition.xyz)')};`;

// A sine-free hash: the no-sin rule is about shared/ agreeing with itself in Node and in the
// browser, and this is never evaluated in Node - but there is no reason to reach for the one
// function that is expensive and precision-varies when this one is not.
const HASH = [
  'float fadeHash(vec2 p) {',
  '  vec3 q = fract(vec3(p.xyx) * 0.1031);',
  '  q += dot(q, q.yzx + 33.33);',
  '  return fract((q.x + q.y) * q.z);',
  '}',
].join('\n');

export const FADE_FRAGMENT_DECL = ['varying float vFade;', HASH].join('\n');

// Guarded on vFade so that every solid pixel in the island - which, at any sane range, is
// nearly all of them - costs one varying and a compare and never reaches the hash.
export const FADE_FRAGMENT_BODY = 'if (vFade > 0.0 && vFade > fadeHash(gl_FragCoord.xy)) discard;';

// ---------------------------------------------------------------------------------
// The shadow pass
// ---------------------------------------------------------------------------------
// The sun draws the island a second time, from its own side, with three's MeshDepthMaterial -
// which knows nothing of the patch above. So a house stippled away in the colour pass still
// laid its whole shadow on the grass: with Object Distance under the orbit distance, the
// village you were looking down at was a field of shadows with nothing standing in them.
// Each building material therefore has a depth twin (createBuildingMaterial's `fadeDepth`),
// patched with the same band and the same hash, handed to every mesh drawn with it as
// `customDepthMaterial`.
//
// In that pass the view is the sun's, so the distance has to be to the *player's* eye, in
// the world: `uFadeEye`, one Vector3 shared by every twin and copied from the camera once a
// frame. The world position is worked out here the way worldpos_vertex would - that chunk
// is compiled out of a depth material.
export const FADE_DEPTH_VERTEX_DECL = [
  'uniform float uFadeRange;',
  'uniform vec3 uFadeEye;',
  'varying float vFade;',
].join('\n');

export const FADE_DEPTH_VERTEX_BODY = [
  'vec4 fadeWorld = vec4(transformed, 1.0);',
  '#ifdef USE_INSTANCING',
  'fadeWorld = instanceMatrix * fadeWorld;',
  '#endif',
  'fadeWorld = modelMatrix * fadeWorld;',
  `vFade = ${band('distance(fadeWorld.xyz, uFadeEye)')};`,
].join('\n');

// The uniforms the patched shaders read. They are set on the uniform objects whether or not
// the patch is compiled; an unused uniform in a program three never heard of is ignored, so
// the value is free to be there either way and the code does not have to remember which.
export const FADE_RANGE_UNIFORM = 'uFadeRange';
export const FADE_EYE_UNIFORM = 'uFadeEye';
