// The four graphics distances, and the one question the fade rests on.
//
// Two halves, and the second is the one that would have bitten. The first is arithmetic and
// could not be more wrong in an interesting way. The second checks that the shader patch in
// createBuildingMaterial still has somewhere to go: the hook points are three.js chunk names
// in a vendored copy of a library, and if one of them is renamed the fade stops fading
// silently - no error, no warning, a slider that does nothing and looks like it works.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader the moment it loads, which wants a document. The same
// stub the other tests that reach it use.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };

const { fadeAmount, fadeNeeded, FADE_START, FADE_BAND,
  FADE_VERTEX_BODY, FADE_FRAGMENT_BODY, FADE_RANGE_UNIFORM } = await import('../web/js/fade.js');

// ---------------------------------------------------------------- the band
test('solid up to 80% of the range, then down to nothing', () => {
  const r = 300;
  assert.equal(fadeAmount(0, r), 0);
  assert.equal(fadeAmount(100, r), 0);
  // The turn, and the two ends of it.
  assert.equal(fadeAmount(FADE_START * r, r), 0);
  assert.equal(fadeAmount(r, r), 1);
  assert.equal(fadeAmount(r * 4, r), 1);
  // Halfway through the band is halfway faded, which is what makes the band a fade and not
  // a step with a ramp glued on.
  assert.ok(Math.abs(fadeAmount(FADE_START * r + (r * FADE_BAND) / 2, r) - 0.5) < 1e-9);
});

test('a range of zero means off, not invisible', () => {
  // A slider nobody has touched, and an island with nothing on it, must not come up blank.
  assert.equal(fadeAmount(0, 0), 0);
  assert.equal(fadeAmount(500, 0), 0);
  assert.equal(fadeAmount(500, -1), 0);
  assert.equal(fadeAmount(500, undefined), 0);
});

test('never outside 0..1', () => {
  for (const d of [-100, -1, 0, 1, 79, 80, 120, 299, 300, 301, 5000]) {
    const a = fadeAmount(d, 300);
    assert.ok(a >= 0 && a <= 1, `${d} gave ${a}`);
  }
});

// ---------------------------------------------------------------- whether it is worth it
test('a cut past the fog is invisible, so the dither is not compiled in', () => {
  // The whole reason the patch is switchable. Object Distance 300 with the haze closing at
  // 218 (half 64 * 3.4) is past it, and that is the default on a single island - so the
  // default page runs the shader it ran before any of this.
  assert.equal(fadeNeeded(300, 218), false);
  assert.equal(fadeNeeded(218, 218), false);
  // Inside the fog, the cut is out in clear air and the eye can follow it.
  assert.equal(fadeNeeded(100, 218), true);
  // Off, either way round.
  assert.equal(fadeNeeded(0, 218), false);
  assert.equal(fadeNeeded(300, 0), false);
  // A fog that never closes - which is what an island with no haze on it reads as - leaves the
  // cut out in clear air, so the fade is wanted there and this is the one case where "no fog"
  // is an answer rather than a shrug.
  assert.equal(fadeNeeded(300, Infinity), true);
});

// ---------------------------------------------------------------- it is the same band
test('the shader uses the same band as the arithmetic, or nothing pops in the right places', () => {
  // Interpolated from the constants rather than typed out, so this can only fail if someone
  // changes the maths and forgets the string - which is the failure it exists to catch.
  assert.ok(FADE_VERTEX_BODY.includes(FADE_START.toFixed(4)));
  assert.ok(FADE_VERTEX_BODY.includes(FADE_BAND.toFixed(4)));
  assert.equal(FADE_RANGE_UNIFORM, 'uFadeRange');
  assert.ok(FADE_VERTEX_BODY.includes('mvPosition'));
  assert.ok(FADE_VERTEX_BODY.includes(FADE_RANGE_UNIFORM));
  assert.ok(FADE_FRAGMENT_BODY.includes('discard'));
});

// ---------------------------------------------------------------- the hook points exist
// The load-bearing test. createBuildingMaterial patches three's own shader by string, and
// three's shader is a vendored file that a `three` bump can change under us.
test('the places the fade is spliced in are still places in three', async () => {
  const THREE = await import('three');
  const v = THREE.ShaderLib.standard.vertexShader;
  const f = THREE.ShaderLib.standard.fragmentShader;
  // -mvPosition.z is the distance to the eye, and it is only in scope because of the first
  // one. If that include went away the fade would read an undeclared variable and every
  // building on the island would stop compiling.
  assert.ok(v.includes('#include <fog_vertex>'), 'vertex lost <fog_vertex>');
  assert.ok(v.includes('#include <common>'), 'vertex lost <common>');
  assert.ok(v.includes('mvPosition'), 'vertex no longer has mvPosition at all');
  // The discard goes in before the lighting, so a pixel thrown away never paid for a light.
  assert.ok(f.includes('#include <emissivemap_fragment>'), 'fragment lost <emissivemap_fragment>');
  assert.ok(f.includes('#include <common>'), 'fragment lost <common>');
  // And the built-in dither chunk is still there, which is the one a material would use if
  // somebody ever moves the fade to a real alpha path.
  assert.ok(f.includes('#include <dithering_fragment>'), 'fragment lost <dithering_fragment>');
});

test('the patched shader still says what it has to say', async () => {
  const THREE = await import('three');
  const { createBuildingMaterial } = await import('../web/js/buildings.js');
  // Run the material's own onBeforeCompile over three's real shader strings and read the
  // result, which is the only way to see the splice without a renderer. Done through a fresh
  // object each time, because onBeforeCompile reads the material and writes the shader - a
  // second pass over the first pass's output would tell us nothing.
  const mat = createBuildingMaterial();
  const compile = () => {
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {},
    };
    mat.onBeforeCompile(shader);
    return shader;
  };
  // Off first. This is not three's own string - the material has always spliced aEmissive and
  // aSheet into it - so the claim is that the *fade* is not in there, which is the thing that
  // costs the island its early depth test.
  const off = compile();
  assert.ok(off.vertexShader.includes('aEmissive'), 'the material stopped patching itself');
  assert.ok(!off.vertexShader.includes('uFadeRange'), 'the fade is in the vertex shader while it is off');
  assert.ok(!off.vertexShader.includes('vFade'), 'the fade is in the vertex shader while it is off');
  assert.ok(!off.fragmentShader.includes('vFade'), 'the fade is in the fragment shader while it is off');
  assert.ok(!off.fragmentShader.includes('discard'), 'a discard is compiled into a page that needs none');
  assert.equal(mat.userData.uniforms[FADE_RANGE_UNIFORM].value, 0);
  assert.equal(mat.customProgramCacheKey(), 'settlers-emissive-ground-v1');

  // Then on, and every hook has to have landed exactly once.
  mat.userData.fade(100, 218);
  assert.equal(mat.customProgramCacheKey(), 'settlers-emissive-ground-v1-fade');
  assert.equal(mat.userData.uniforms[FADE_RANGE_UNIFORM].value, 100);
  const { vertexShader: v, fragmentShader: f } = compile();
  assert.ok(v.includes('uniform float uFadeRange;'), 'no range uniform in the vertex shader');
  assert.ok(v.includes(FADE_VERTEX_BODY), 'the vertex body did not land');
  assert.ok(v.includes('#include <fog_vertex>'), 'the vertex hook was consumed');
  assert.ok(f.includes('varying float vFade;'), 'the fragment never hears about the fade');
  assert.ok(f.includes('fadeHash'), 'no hash in the fragment shader');
  assert.ok(f.includes(FADE_FRAGMENT_BODY), 'the fragment body did not land');
  // Still the built-in chunks underneath, so the lighting and the fog are all still there.
  assert.ok(f.includes('#include <lights_fragment_begin>'), 'the lighting went missing');
  assert.ok(f.includes('#include <fog_fragment>'), 'the fog went missing');

  // And the gate: a range the fog already ate must take the patch back out again, or the
  // dither is paid for on a page that never needed it.
  mat.userData.fade(300, 218);
  assert.equal(mat.customProgramCacheKey(), 'settlers-emissive-ground-v1');
  assert.equal(mat.userData.uniforms[FADE_RANGE_UNIFORM].value, 0);
  // NeedsUpdate is what actually gets the other program built, so it is what has to be set.
  assert.equal(mat.version > 0, true);
});
