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

const { fadeAmount, fadeNeeded, cornerCos, cullNext, CULL_PAD, CULL_HYST, FADE_START, FADE_BAND,
  FADE_VERTEX_BODY, FADE_FRAGMENT_BODY, FADE_DEPTH_VERTEX_BODY, FADE_RANGE_UNIFORM, FADE_EYE_UNIFORM,
} = await import('../web/js/fade.js');

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
test('a cut the fog can never reach past is invisible, so the dither is not compiled in', () => {
  // Against the ceiling the fog can close at (0.95 * camera.far), never the fog of the moment.
  assert.equal(fadeNeeded(600, 522), false);
  assert.equal(fadeNeeded(522, 522), false);
  // Inside it, the cut can come out of the haze - on a clear day, zoomed out - and pop.
  assert.equal(fadeNeeded(300, 522), true);
  // Off, either way round.
  assert.equal(fadeNeeded(0, 522), false);
  assert.equal(fadeNeeded(300, 0), false);
  assert.equal(fadeNeeded(300, Infinity), true);
});

test('the corner of the frame is shallower than the middle, and fadeNeeded asks there', () => {
  // The fog is linear in depth and the cut is on a distance. At the corner of a 16:9 frame at
  // 45 degrees a thing is about 0.76 as deep as it is far, so a cut at 600 under a fog capped
  // at 522 is in full fog straight ahead and in clear air at the corner.
  const cos = cornerCos(45, 16 / 9);
  assert.ok(cos > 0.74 && cos < 0.78, `corner cos ${cos}`);
  assert.equal(fadeNeeded(600, 522, 1), false);
  assert.equal(fadeNeeded(600, 522, cos), true);
  // Straight down a tube with no width, the corner is the axis.
  assert.ok(Math.abs(cornerCos(1e-9, 1) - 1) < 1e-12);
  // A wider window has a corner further off the axis.
  assert.ok(cornerCos(45, 21 / 9) < cornerCos(45, 16 / 9));
});

// ---------------------------------------------------------------- the CPU cut behind it
test('a record leaves the render list only once the shader has finished with it', () => {
  const r = 300;
  // Nowhere inside the range, nor inside the pad past it: anything a building reaches out
  // over is still in the band there.
  for (const d of [0, 100, 240, 299, 300, r + CULL_PAD - 0.01]) assert.equal(cullNext(d, r, false), false, `${d}`);
  assert.equal(cullNext(r + CULL_PAD, r, false), true);
  assert.equal(cullNext(5000, r, false), true);
  // Hysteresis: once out, it stays out a little nearer, so the line is not crossed every frame.
  assert.equal(cullNext(r + CULL_PAD - CULL_HYST / 2, r, true), true);
  assert.equal(cullNext(r + CULL_PAD - CULL_HYST - 0.01, r, true), false);
  // And the hysteresis is inside the pad, so a record let back in is still fully faded -
  // nothing it reaches out over is nearer than the range.
  assert.ok(CULL_HYST < CULL_PAD);
  assert.equal(fadeAmount(r + CULL_PAD - CULL_HYST - 14, r), 1);
  // Off means nothing is cut, however far.
  assert.equal(cullNext(1e6, 0, false), false);
  assert.equal(cullNext(1e6, 0, true), false);
});

// ---------------------------------------------------------------- it is the same band
test('the shader uses the same band as the arithmetic, or nothing pops in the right places', () => {
  // Interpolated from the constants rather than typed out, so this can only fail if someone
  // changes the maths and forgets the string - which is the failure it exists to catch.
  assert.ok(FADE_VERTEX_BODY.includes(FADE_START.toFixed(4)));
  assert.ok(FADE_VERTEX_BODY.includes(FADE_BAND.toFixed(4)));
  assert.equal(FADE_RANGE_UNIFORM, 'uFadeRange');
  // A distance, not a depth: the CPU cut behind the fade measures straight-line distance, and
  // on a depth the corners of the frame would still be in the band when the cut came.
  assert.ok(FADE_VERTEX_BODY.includes('length(mvPosition.xyz)'));
  assert.ok(!FADE_VERTEX_BODY.includes('-mvPosition.z'));
  assert.ok(FADE_VERTEX_BODY.includes(FADE_RANGE_UNIFORM));
  assert.ok(FADE_FRAGMENT_BODY.includes('discard'));
  // The shadow pass: the same band, measured to the player's eye in the world.
  assert.ok(FADE_DEPTH_VERTEX_BODY.includes(FADE_START.toFixed(4)));
  assert.ok(FADE_DEPTH_VERTEX_BODY.includes(FADE_BAND.toFixed(4)));
  assert.ok(FADE_DEPTH_VERTEX_BODY.includes(FADE_EYE_UNIFORM));
  assert.ok(FADE_DEPTH_VERTEX_BODY.includes('instanceMatrix'));
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
  // And the shadow pass's hooks, in three's own depth shader.
  const dv = THREE.ShaderLib.depth.vertexShader;
  const df = THREE.ShaderLib.depth.fragmentShader;
  assert.ok(dv.includes('#include <common>'), 'depth vertex lost <common>');
  assert.ok(dv.includes('#include <project_vertex>'), 'depth vertex lost <project_vertex>');
  assert.ok(dv.includes('#include <begin_vertex>'), 'depth vertex no longer declares transformed');
  assert.ok(df.includes('#include <common>'), 'depth fragment lost <common>');
  assert.ok(df.includes('#include <clipping_planes_fragment>'), 'depth fragment lost <clipping_planes_fragment>');
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

test('the depth twin fades the shadow with the building, and only while the fade is on', async () => {
  const THREE = await import('three');
  const { createBuildingMaterial, adoptFadeDepth } = await import('../web/js/buildings.js');
  const mat = createBuildingMaterial();
  const depth = mat.userData.fadeDepth;
  assert.ok(depth && depth.isMeshDepthMaterial, 'no depth twin');
  // The packing three's own shadow pass uses, or an unpatched twin would not be a no-op.
  assert.equal(depth.depthPacking, THREE.RGBADepthPacking);
  const compile = () => {
    const shader = {
      vertexShader: THREE.ShaderLib.depth.vertexShader,
      fragmentShader: THREE.ShaderLib.depth.fragmentShader,
      uniforms: {},
    };
    depth.onBeforeCompile(shader);
    return shader;
  };
  const off = compile();
  assert.equal(off.vertexShader, THREE.ShaderLib.depth.vertexShader, 'the twin is patched while the fade is off');
  assert.equal(depth.customProgramCacheKey(), 'settlers-depth-v1');

  const before = depth.version;
  mat.userData.fade(100, 522, 0.76);
  assert.ok(depth.version > before, 'the twin was not told to recompile');
  assert.equal(depth.customProgramCacheKey(), 'settlers-depth-v1-fade');
  const on = compile();
  assert.ok(on.vertexShader.includes(FADE_DEPTH_VERTEX_BODY), 'the depth vertex body did not land');
  assert.ok(on.vertexShader.includes('uniform vec3 uFadeEye;'));
  assert.ok(on.fragmentShader.includes(FADE_FRAGMENT_BODY), 'the depth fragment body did not land');
  // The same range as the colour pass: one uniform object, not a copy that can drift.
  assert.equal(on.uniforms[FADE_RANGE_UNIFORM], mat.userData.uniforms[FADE_RANGE_UNIFORM]);
  assert.ok(on.uniforms[FADE_EYE_UNIFORM].value.isVector3);

  // Handed to meshes drawn with the material, and to nothing else.
  const root = new THREE.Group();
  const ours = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const other = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const claimed = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const own = new THREE.MeshDepthMaterial();
  claimed.customDepthMaterial = own;
  root.add(ours, other, claimed);
  adoptFadeDepth(root);
  assert.equal(ours.customDepthMaterial, depth);
  assert.equal(other.customDepthMaterial, undefined);
  assert.equal(claimed.customDepthMaterial, own, 'a depth material somebody chose was replaced');
});

test("a building's other materials fade with it, and keep the program they had", async () => {
  const THREE = await import('three');
  const { createBuildingMaterial, followFade, followFadeUnder } = await import('../web/js/buildings.js');
  const owner = createBuildingMaterial();
  const compile = (m, lib) => {
    const shader = { vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader, uniforms: {} };
    m.onBeforeCompile(shader, null);
    return shader;
  };
  // Two plain materials: before following, three would key both on the default no-op's text.
  // After, they must still differ from anything with a real onBeforeCompile of its own.
  const gold = new THREE.MeshPhongMaterial();
  const flag = new THREE.MeshStandardMaterial();
  flag.onBeforeCompile = (shader) => { shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n// flag'); };
  flag.customProgramCacheKey = () => 'settlers-flag';
  const plainKey = gold.customProgramCacheKey();
  assert.equal(followFade(gold, owner), true);
  assert.equal(followFade(flag, owner), true);
  assert.equal(followFade(gold, owner), false, 'followed twice');
  assert.equal(gold.customProgramCacheKey(), plainKey, 'following changed the key while the fade is off');
  assert.equal(flag.customProgramCacheKey(), 'settlers-flag');
  assert.doesNotMatch(compile(gold, 'phong').fragmentShader, /discard/);

  const v = gold.version;
  owner.userData.fade(100, 522, 0.76);
  assert.ok(gold.version > v, 'a follower was not told to recompile');
  assert.equal(gold.customProgramCacheKey(), plainKey + '|fade');
  assert.equal(flag.customProgramCacheKey(), 'settlers-flag|fade');
  const g = compile(gold, 'phong');
  assert.ok(g.vertexShader.includes(FADE_VERTEX_BODY));
  assert.ok(g.fragmentShader.includes(FADE_FRAGMENT_BODY));
  assert.equal(g.uniforms[FADE_RANGE_UNIFORM], owner.userData.uniforms[FADE_RANGE_UNIFORM]);
  // The flag's own splice still happens, before the fade's.
  const f = compile(flag, 'standard');
  assert.ok(f.vertexShader.includes('// flag'));
  assert.ok(f.fragmentShader.includes(FADE_FRAGMENT_BODY));
  // Basic has no emissive chunk, which is why the followers splice at the clipping planes.
  const basic = new THREE.MeshBasicMaterial();
  followFade(basic, owner);
  assert.ok(compile(basic, 'basic').fragmentShader.includes(FADE_FRAGMENT_BODY));

  // A shader of somebody's own, and a building material, are left alone.
  const custom = new THREE.ShaderMaterial();
  assert.equal(followFade(custom, owner), false);
  assert.equal(followFade(createBuildingMaterial(), owner), false);

  // Under a record: followed, and given the owner's depth twin - except a cut-out.
  const root = new THREE.Group();
  const pile = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhongMaterial());
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ alphaTest: 0.5 }));
  root.add(pile, leaf);
  followFadeUnder(root, owner);
  assert.equal(pile.material.userData.fadeOwner, owner);
  assert.equal(pile.customDepthMaterial, owner.userData.fadeDepth);
  assert.equal(leaf.customDepthMaterial, undefined);
});
