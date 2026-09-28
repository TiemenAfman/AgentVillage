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
// This is the load-bearing observation of the whole feature, and it is why the shader
// patch below is switched on and off instead of always being there.
//
// world.js closes the fog at `0.95 * camera.far`, because a cut at the far plane is visible
// and a cut just inside the fog is not. So a thing cut at a range *beyond* where the fog
// closed was already invisible: the fog ate it a moment earlier, and the cut nobody sees.
// No fade needed, and - more to the point - no reason to pay for one.
//
// Cut inside the fog, though, and the cut is out in clear air where the eye can follow it.
// That is the only case that needs the dither, so that is the only case that compiles it.
// A `discard` in the fragment shader costs the early depth test for the *whole material*,
// and one material here is every building, prop, boat, animal and person on the island. At
// the default settings the range is past the fog, the patch stays out, and the shader is
// character for character what it was before any of this.
//
// `fogFar` is where the fog closed, in the same units as `range`.
export function fadeNeeded(range, fogFar) {
  return range > 0 && range < fogFar;
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
// Two things make it cheap. There is no uniform for the camera: `mvPosition` is in view space,
// so `-mvPosition.z` *is* the distance, and the eye is the origin of view space by
// definition. And it is correct for the instanced crowd without knowing anything about
// instancing, because project_vertex applies the instanceMatrix before the modelViewMatrix.
//
// The discard happens where it is cheapest - after the emissive, before any of the lighting
// is done - and it is a hash rather than an alpha, so a fading house stays in the opaque
// pass. No transparency, nothing to sort, depth writes untouched, one draw call per building.
// The stipple is what the fog then finishes off; the dither is what stops the cut from
// being a line in the air.
//
// The numbers are interpolated from the constants above, not typed out twice, because a
// band that starts at 80% on the CPU and 79% on the screen is a bug nobody finds by staring.
const F = (n) => n.toFixed(4);

export const FADE_VERTEX_DECL = [
  'uniform float uFadeRange;',
  'varying float vFade;',
].join('\n');

export const FADE_VERTEX_BODY = [
  `vFade = uFadeRange > 0.0 ? clamp((-mvPosition.z - uFadeRange * ${F(FADE_START)})`
    + ` / (uFadeRange * ${F(FADE_BAND)}), 0.0, 1.0) : 0.0;`,
].join('\n');

export const FADE_FRAGMENT_DECL = [
  'varying float vFade;',
  // A sine-free hash: the no-sin rule is about shared/ agreeing with itself in Node and in
  // the browser, and this is never evaluated in Node - but there is no reason to reach for
  // the one function that is expensive and precision-varies when this one is not.
  'float fadeHash(vec2 p) {',
  '  vec3 q = fract(vec3(p.xyx) * 0.1031);',
  '  q += dot(q, q.yzx + 33.33);',
  '  return fract((q.x + q.y) * q.z);',
  '}',
].join('\n');

// Guarded on vFade so that every solid pixel in the island - which, at any sane range, is
// nearly all of them - costs one varying and a compare and never reaches the hash.
export const FADE_FRAGMENT_BODY = [
  'if (vFade > 0.0 && vFade > fadeHash(gl_FragCoord.xy)) discard;',
].join('\n');

// The uniform the patched shader reads. It is set on `mat.userData.uniforms` whether or not
// the patch is compiled; an unused uniform in a program three never heard of is ignored, so
// the value is free to be there either way and the code does not have to remember which.
export const FADE_RANGE_UNIFORM = 'uFadeRange';
