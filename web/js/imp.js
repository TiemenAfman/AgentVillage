// The lava imps: the one thing on the island that is fetched rather than baked, and what
// every guard on the volcano looks like.
//
// Every other shape exists before the first line of main.js runs (CLAUDE.md, "Nothing is
// fetched at boot"), and this is the deliberate exception. The imp is a rigged, skinned
// glTF out of the img2threejs pipeline - 26 bones; `idle`, `walk`, `swim` and `attack` - and
// neither the bake into a *-mesh.js module nor an instanced figure can carry a skeleton and
// an AnimationMixer. So it is loaded, but only in a way that cannot stall a boot:
//
//   - nothing starts before main.js calls `allowImp()`, which it does after the boot screen
//     is gone and the first frame has been asked for;
//   - even then nothing is fetched until a crowd view actually has a volcano with a guard
//     to swap out (crowd-view.js asks `createImp` every frame until it gets one), so a page
//     that never sees the volcano never downloads a byte of it;
//   - the loader and SkeletonUtils are dynamic imports, so neither is in the boot module
//     graph, and a test importing this file fetches nothing;
//   - and a failed load is said once in the console and never retried: every guard stays the
//     ordinary instanced figure it would have been without an imp, which is the whole of
//     the fallback. Nothing waits on the promise.
//
// One imp per guard, and what that costs. A skinned mesh cannot be instanced, so every imp
// is its own draw call in the colour pass and another in the shadow pass - twenty-four
// guards would be forty-eight calls where the whole instanced crowd costs thirteen. Three
// things keep that honest, and they are the rules to keep if this file grows:
//
//   - one geometry and one shader program for every imp on the page. Each is a
//     SkeletonUtils clone of the loaded model, which gives it its own bones, skeleton and
//     mixer and shares the mesh on the GPU. The geometry is kept for the page's life and
//     never disposed with an imp: guards fall and come back every twenty seconds, and a
//     re-upload of the whole mesh each time the last one fell is worse than a megabyte held
//     (see `standImp`'s dispose). Each imp does get a material of its own, made once when it
//     is stood up, so that a hit can flush that one imp red (`hit`) - a colour on a shared
//     material would flush every imp on the mountain at once. That costs no draw call (every
//     imp is its own call anyway) and no program: the clones carry the template's
//     `onBeforeCompile` and `customProgramCacheKey` by reference, so three.js hands them all
//     the one compiled program and only the uniforms differ (see `impMaterial`);
//   - real frustum culling. A skinned mesh's bounds do not follow its bones, which is why
//     the one-imp version turned culling off; instead every imp carries one sphere that
//     encloses every pose of every clip (`cullSphere`, measured against the real clips in
//     tests/imp.test.mjs), so an imp off the screen - or out of the shadow camera - costs
//     no draw call at all;
//   - no animation nobody sees. An imp that was not drawn last frame, or stood more than
//     ANIMATE_RANGE from the camera, skips its mixer (unless it is swinging, which has to
//     finish); it freezes in its pose and carries on from there when it is looked at.
//
// And not every guard, on every machine: IMP_LIMIT is how many imps a page stands at once,
// nearest the camera first (`pickImps`); the rest stay instanced figures.
import * as THREE from 'three';
import { modelUrl } from './assets.js';
import { STANDALONE } from './api.js';
import { isGuard } from 'shared/volcano.mjs';
import { hash32 } from 'shared/rng.mjs';
import { SEA_LEVEL } from 'shared/terrain.mjs';

export const IMP_FILE = 'hostile-settler.glb';

// Whether this region's guards are imps. The volcano is the one island whose bundle says
// `volcano: true`, and parseBundle refuses the word on anybody else's - so a hostile
// neighbour's guards stay armed settlers.
export function impsOn(region) {
  return !!(region && region.village && region.village.island && region.village.island.volcano === true);
}
export const wantsImp = (id) => isGuard(id);

// How many imps one page stands at once, nearest the camera first. Twenty-four is the most
// guards there can be (GUARDS.CAP); sixteen imps keeps a desktop's worst case at sixteen
// colour and sixteen shadow calls with every one of them on screen, and a phone gets six -
// the ones near enough to matter. One rule for both with a different number, rather than
// "all" here and a cap there, because the cap is also what keeps a slow laptop honest.
export const IMP_CAP = Object.freeze({ desktop: 16, phone: 6 });
export const IMP_LIMIT = STANDALONE ? IMP_CAP.phone : IMP_CAP.desktop;
// How much nearer a guard without an imp has to be than one with, before it takes the imp
// over: distances of holders are scaled by this. Without it two guards at the edge of the
// cap trade an imp - a clone and a dispose - on every frame the camera drifts between them.
export const IMP_HOLD = 0.8;
// Past this (island units, camera to imp) an imp stops animating: it is about eight pixels
// tall there, and a mixer of 78 channels per imp is the one per-frame cost culling cannot
// take away.
export const ANIMATE_RANGE = 40;

// Its size. The GLB is in metres (1.08 m from the floor to the tip of a horn) and the island
// is not: one unit is four metres, and the settlers are not to scale with that either - a
// resident stands 0.430 units (settler-figures.js, RESIDENT_TO_PLAYER), times its own
// `look.height` of 0.9-1.1. The imp is asked to be about 1.3 times a settler, so it is scaled
// to 0.56 units, whatever that makes it in metres.
const IMP_HEIGHT_M = 1.08;
const RESIDENT_HEIGHT_U = 0.430;
export const IMP_SIZE = 1.3;
export const IMP_SCALE = (RESIDENT_HEIGHT_U * IMP_SIZE) / IMP_HEIGHT_M;

// A blow landing on one (the sea's `{t:'agent', a:'hit'}`, routed here by crowd-view.js):
// how long the flinch lasts, how far it rocks back on its heels (radians, about its feet),
// and how red it flushes at the moment of the hit, as an emissive colour that fades with it.
// Short enough that three blows in a row read as three.
export const HIT_S = 0.3;
const HIT_LEAN = 0.35;
const HIT_FLUSH = [0.9, 0.08, 0.02];

// The lava's glow, which the hour sets (`setImpNight`, from the frame loop with world.js's
// night amount - the same 0..1 the building material's uNight is given). By day the patch's
// old strength, so daytime looks exactly as it did; by night the fissures, eyes, claws and
// tail flame burn nearly three times as bright, and the whole body picks up a faint ember
// of its own colour, because under a night sky the rest of the imp goes as dark as
// everything else and a guard should still be something you can see coming. Uniforms and
// not defines, so the hour never compiles a second program.
export const LAVA_GLOW = Object.freeze({ day: 2.2, night: 6, emberNight: 0.14 });
export function lavaGlow(night) {
  const n = Number.isFinite(night) ? Math.min(1, Math.max(0, night)) : 0;
  return { glow: LAVA_GLOW.day + (LAVA_GLOW.night - LAVA_GLOW.day) * n, ember: LAVA_GLOW.emberNight * n };
}
// One pair of uniform objects for every imp material: lavaCompile hands each material these
// same objects, so one write here reaches every imp without a loop over them.
const glowUniforms = { uLavaGlow: { value: LAVA_GLOW.day }, uLavaEmber: { value: 0 } };
export function setImpNight(night) {
  const g = lavaGlow(night);
  glowUniforms.uLavaGlow.value = g.glow;
  glowUniforms.uLavaEmber.value = g.ember;
}
// For the tests and a console: where the glow stands now.
export const impGlow = () => ({ glow: glowUniforms.uLavaGlow.value, ember: glowUniforms.uLavaEmber.value });

// When it lashes out: this page's own walker within ATTACK_RANGE units, and not again until
// ATTACK_COOLDOWN_MS after the last swing finished - per imp, so a row of guards swings one
// by one as you walk past rather than in a volley. Purely a show - the sea decides who is
// hurt (lib/hostility.mjs), and nothing here reaches the wire.
export const ATTACK_RANGE = 1.5;
export const ATTACK_COOLDOWN_MS = 2000;
const FADE_S = 0.25;
// How fast the in-place walk cycle walks at scale 1, from the handoff that came with the
// model: 0.32 heights a second, 0.346 m/s. Scaled to the island and used to match the clip's
// pace to how fast the guard is actually going, so the feet do not skate.
const WALK_M_S = 0.346;
const WALK_U_S = WALK_M_S * IMP_SCALE;
// Where the water comes up to on a swimming imp, in the model's own metres: the swim clip
// holds the hips at about 0.47 and the head at 0.56-0.62, so a surface at 0.50 leaves the head
// out and the paddling hands just under. The model is lowered by this (times its scale)
// below the sea, instead of the crowd's wading clamp, which is made for a standing settler.
export const SWIM_LINE_M = 0.5;
// Clips in the GLB that are not for the island. `walk-rootmotion` is the walk with the
// pelvis travelling - the proof that the feet do not slide - and the sea already moves the
// body, so playing it would walk the model out of its own root.
const UNUSED_CLIP = /rootmotion/i;
// How much bigger than the bind pose's own bounds the culling sphere is. The bind pose is
// the rest pose with the arms down; the swim, leaning 65 degrees forward with the arms out,
// reaches furthest from it - measured, to 0.99 of the box's half-diagonal, so the 10% is
// what stands between that clip and an imp culled with a paw still on the screen.
// tests/imp.test.mjs samples every clip and fails if any vertex gets out.
export const CULL_MARGIN = 1.1;

// Whether a swing starts now. Its own function so the rule can be tested without a model.
export function attackDue(state, dist, now) {
  return !state.attacking && dist <= ATTACK_RANGE && now >= state.readyAt;
}

// Where in its idle an imp starts, from its guard's id: a row of guards breathing in
// unison is the first thing anybody notices. A hash, so every page and every reload puts
// the same guard at the same point of the breath.
export function idlePhase(id, duration) {
  return (hash32(`${id}:imp`) / 4294967296) * duration;
}

// Which guards get an imp: the `limit` nearest `eye` (scene frame), a holder's distance
// scaled by IMP_HOLD so an imp stays put until a guard clearly nearer wants it. Everybody,
// if there are no more of them than the limit; the first `limit` if nobody knows where the
// eye is. Ties go to the id, so two pages looking from the same place agree.
//
// `cands` is [{ id, x, y, z, has }], `has` meaning an imp is already standing for it.
export function pickImps(cands, eye, limit = IMP_LIMIT) {
  if (cands.length <= limit) return new Set(cands.map((c) => c.id));
  if (!eye) return new Set(cands.slice(0, limit).map((c) => c.id));
  const keyed = cands.map((c) => {
    const dx = c.x - eye.x, dy = (c.y || 0) - (eye.y || 0), dz = c.z - eye.z;
    const d = dx * dx + dy * dy + dz * dz;
    return { id: c.id, d: c.has ? d * IMP_HOLD * IMP_HOLD : d };
  });
  keyed.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Set(keyed.slice(0, limit).map((k) => k.id));
}

// The one sphere every imp is culled by, in the mesh's own frame (metres, before the
// model's scale - the renderer applies matrixWorld, which carries the scale, the heading
// and the trot's lean). Out of the bind pose's box, grown by CULL_MARGIN for what the clips
// do. Shared geometry means one sphere for every imp, which is exactly right: it is local.
export function cullSphere(geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const centre = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2;
  return new THREE.Sphere(centre, r * CULL_MARGIN);
}

let allowed = false;
let loading = null;
let template = null;
let failed = false;

// Called once by main.js when the island is up. Before this, `createImp` answers null
// without starting anything.
export function allowImp() { allowed = true; }

// The loaded model, or null - and the first call after allowImp() starts the load.
function ready() {
  if (template || failed || !allowed) return template;
  if (!loading) {
    loading = Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/utils/SkeletonUtils.js'),
    ])
      .then(([{ GLTFLoader }, { clone }]) => new GLTFLoader().loadAsync(modelUrl(IMP_FILE))
        .then((gltf) => { template = prepareImp(gltf, clone); }))
      .catch((e) => {
        failed = true;
        console.warn(`imp: ${IMP_FILE} could not be loaded; the volcano's guards stay ordinary figures`, e);
      });
  }
  return null;
}

// The lava lives in the baked colour: fissures, claws, eyes and the tail flame are the only
// yellow-orange regions, so exactly those are promoted to emissive - imp-demo.js's mask,
// with its strength now a uniform the hour turns up (see LAVA_GLOW). What the material's own
// `emissive` says is added on top rather than thrown away, as the first version of this
// patch did: it is black, except for the moment a hit flushes one imp red.
//
// Module-level functions, not closures made per material, and that is load-bearing: a
// clone of this material (impMaterial) is handed these same two references, so three.js
// finds the same cache key and gives every imp the one compiled program.
function lavaCompile(shader) {
  shader.uniforms.uLavaGlow = glowUniforms.uLavaGlow;
  shader.uniforms.uLavaEmber = glowUniforms.uLavaEmber;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uLavaGlow;
      uniform float uLavaEmber;`)
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #ifdef USE_COLOR
        float lava = smoothstep(0.10, 0.32, vColor.g) * step(vColor.b * 1.6, vColor.r);
        totalEmissiveRadiance += vColor.rgb * (lava * uLavaGlow + uLavaEmber);
      #endif`,
    );
}
const lavaKey = () => 'hostile-settler-lava-glow';
function addLavaGlow(material) {
  material.emissive = new THREE.Color(0x000000);
  material.onBeforeCompile = lavaCompile;
  material.customProgramCacheKey = lavaKey;
}

// One imp's own material: a copy of the template's, made once when the imp is stood up and
// never per hit. Material.copy does not carry onBeforeCompile or the cache key across -
// they are instance properties the patch put there - so they are handed on here, the same
// two functions, which is what keeps the program shared. Never disposed with its imp: a
// material owns no GPU memory of its own (the textures are the template's, and dispose()
// would not free them anyway), and disposing it would release its hold on the shared
// program - so the last guard to fall would take the program with him and the next one to
// come out of the guardhouse would compile it again.
export function impMaterial(material) {
  const m = material.clone();
  m.onBeforeCompile = material.onBeforeCompile;
  m.customProgramCacheKey = material.customProgramCacheKey;
  m.emissive.setRGB(0, 0, 0);
  return m;
}

// The loaded glTF made ready to be cloned: every setting a clone should inherit is put on
// the template once, because Object3D.clone copies the settings and shares the geometry and
// the material by reference. `clone` is SkeletonUtils.clone, handed in so the tests can
// build a template from a GLB they parsed themselves.
export function prepareImp(gltf, clone) {
  const model = gltf.scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    // Culled like anything else, by a sphere big enough for every pose (see cullSphere).
    // SkinnedMesh.copy clones the sphere, so each imp carries its own copy of the same one.
    o.frustumCulled = true;
    if (o.isSkinnedMesh) o.boundingSphere = cullSphere(o.geometry);
    // The same as every figure in the crowd; nothing dynamic receives.
    o.castShadow = true;
    // Double sided since the first model, which had thin doubled shells. The skin is one
    // closed surface now, so FrontSide would be the cheaper choice - kept until somebody has
    // looked at it on the island, because a flipped patch would show as a hole.
    o.material.side = THREE.DoubleSide;
    o.material.roughness = 0.72;
    o.material.metalness = 0;
    addLavaGlow(o.material);
  });
  model.scale.setScalar(IMP_SCALE);
  const clips = new Map(gltf.animations.filter((c) => !UNUSED_CLIP.test(c.name)).map((c) => [c.name, c]));
  return { model, clips, clone };
}

// An imp standing in `scene` for the guard `id`, or null while the model is not there (not
// allowed yet, still loading, failed).
export function createImp(scene, id) {
  const t = ready();
  return t ? standImp(t, scene, id) : null;
}

// One imp out of a prepared template. Exported for the tests, which have a template of
// their own; the island only ever gets here through createImp.
export function standImp(t, scene, id) {
  const model = t.clone(t.model);
  let mesh = null;
  model.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  // Its own material, once - see impMaterial and the header. Every mesh in the model, in
  // case a later GLB splits the body; one today.
  const own = [];
  model.traverse((o) => { if (o.isMesh) { o.material = impMaterial(o.material); own.push(o.material); } });
  // root carries where and which way; body the bob and the lean, so neither disturbs the
  // other; the model inside keeps its own scale.
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.name = `imp:${id}`;
  // Yaw first, then the flinch's pitch about the imp's own shoulders - with the default
  // order a hit would rock it sideways whenever it was not facing down the z axis.
  root.rotation.order = 'YXZ';
  root.add(body);
  body.add(model);
  scene.add(root);

  // What the last render said about this imp: whether it was drawn at all (the renderer
  // only calls onBeforeRender for what passed the frustum test - the shadow pass has a hook
  // of its own) and how far the camera that drew it stood. Read and cleared by update(),
  // so a frame's decision is the frame before's evidence - one frame late, invisibly.
  let seen = false;
  let eyeD2 = 0;
  if (mesh) {
    mesh.onBeforeRender = (_r, _s, camera) => {
      seen = true;
      const e = camera.matrixWorld.elements, p = root.position;
      const dx = e[12] - p.x, dy = e[13] - p.y, dz = e[14] - p.z;
      eyeD2 = dx * dx + dy * dy + dz * dz;
    };
  }

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [name, clip] of t.clips) actions[name] = mixer.clipAction(clip);
  if (actions.attack) {
    actions.attack.setLoop(THREE.LoopOnce, 1);
    actions.attack.clampWhenFinished = true;
  }
  // The walk and the swim, if the GLB has them: both are in-place cycles, and without them
  // a moving imp trots on its idle and a swimming one wades like a settler.
  const walkName = actions.walk ? 'walk' : null;
  const swimName = actions.swim ? 'swim' : null;
  let current = null;
  const st = { attacking: false, readyAt: 0 };
  // Seconds left of the flinch from the last blow; 0 when none is showing.
  let hurt = 0;
  let lastNow = 0;
  let time = 0;
  let yaw = 0;

  function play(name) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset().play();
    if (current) next.crossFadeFrom(current, FADE_S, false);
    current = next;
  }
  // The attack clip ends in the rest pose, feet planted, so fading back into idle from its
  // last frame is seamless; the cooldown counts from here rather than from the swing's start.
  mixer.addEventListener('finished', (e) => {
    if (e.action !== actions.attack) return;
    st.attacking = false;
    st.readyAt = lastNow + ATTACK_COOLDOWN_MS;
    play('idle');
  });
  play('idle');
  // Each guard at its own point of the breath, and the pose put on at once - the first
  // frame is not drawn yet, so without this it would show the bind pose until it was.
  if (actions.idle) actions.idle.time = idlePhase(id, actions.idle.getClip().duration);
  mixer.update(0);

  // Once a frame, from the figure crowd-view.js would otherwise have drawn: where it is in
  // the scene, which way it faces, whether it is going anywhere and how fast, whether it is
  // out of its depth - and where this page's own walker is, if they are on foot, in the same
  // scene frame.
  function update({
    x, y, z, yaw: figureYaw, moving = false, speed = 0, swimming = false,
    visible = true, dt = 0, now = 0, player = null,
  }) {
    lastNow = now;
    root.visible = visible;
    const drawn = seen;
    seen = false;
    // The flinch runs on whether or not the imp is drawn, so one hit off the screen is not
    // saved up and played the moment it comes back into view.
    if (hurt > 0) {
      hurt = Math.max(0, hurt - dt);
      const k = hurt / HIT_S;
      for (const m of own) m.emissive.setRGB(HIT_FLUSH[0] * k, HIT_FLUSH[1] * k, HIT_FLUSH[2] * k);
    }
    if (!visible) return;
    time += dt;
    const swims = swimming && !!swimName;
    root.position.set(x, swims ? SEA_LEVEL - SWIM_LINE_M * IMP_SCALE : y, z);
    let target = figureYaw;
    if (player) {
      const dx = player.x - x, dz = player.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (actions.attack && attackDue(st, dist, now)) { st.attacking = true; play('attack'); }
      // A swing is aimed: while it lasts the imp turns to whoever it is swinging at.
      if (st.attacking && dist > 1e-3) target = Math.atan2(dx, dz);
    }
    let d = target - yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    yaw += d * Math.min(1, dt * 12);
    root.rotation.y = yaw;
    // Rocked back on its heels by the blow, and straight up again as the flush fades: eased
    // out of the moment of the hit, so it snaps back first and settles last.
    const k = hurt / HIT_S;
    root.rotation.x = k > 0 ? -HIT_LEAN * k * k : 0;
    // In the water it paddles, moving or not; on land a walk clip is used the moment the GLB
    // has one, at the pace the body is going. Without one a moving imp keeps idle and gets a
    // trot on top of it: a small bob and a lean into the direction of travel, enough that it
    // does not glide. Every change of clip is play()'s crossfade.
    if (!st.attacking && swims) play(swimName);
    else if (!st.attacking && walkName) {
      play(moving ? walkName : 'idle');
      if (moving) actions[walkName].timeScale = Math.min(3, Math.max(0.5, speed / WALK_U_S));
    } else if (!st.attacking) play('idle');
    if (moving && !st.attacking && !walkName && !swims) {
      body.position.y = Math.abs(Math.sin(time * 9)) * 0.03;
      body.rotation.x = 0.16;
      body.rotation.z = Math.sin(time * 9) * 0.05;
    } else {
      body.position.y *= 0.8;
      body.rotation.x *= 0.8;
      body.rotation.z *= 0.8;
    }
    // The animation level of detail. A swing always runs, or its 'finished' never comes and
    // the imp is stuck mid-attack; otherwise only an imp that was drawn, near enough to see.
    if (st.attacking || (drawn && eyeD2 <= ANIMATE_RANGE * ANIMATE_RANGE)) mixer.update(dt);
  }

  // Out of the scene with everything that is this imp's alone: its mixer and its skeleton
  // (whose bone texture is its own). The geometry and the material are every imp's, and
  // stay - see the header.
  function dispose() {
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    if (mesh) {
      mesh.onBeforeRender = () => {};
      mesh.skeleton.dispose();
    }
    body.remove(model);
    scene.remove(root);
  }

  // A blow from somebody's swing. Only starts the flinch: the colour and the lean are
  // update()'s, off the same clock as everything else, and a blow while one is still showing
  // starts it again from the top.
  function hit() { hurt = HIT_S; }

  return {
    object: root, mesh, update, dispose, hit,
    attacking: () => st.attacking,
    hurting: () => hurt > 0,
    // For the tests and a console: where this imp is in its idle, and what it is playing.
    idleTime: () => (actions.idle ? actions.idle.time : null),
    clip: () => (current ? current.getClip().name : null),
  };
}
