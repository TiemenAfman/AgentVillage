// The volcano's guards drawn as lava imps (web/js/imp.js) rather than as members of the
// instanced crowd.
//
// Three things are worth holding here. The imp is the one model that is fetched instead of
// baked, so the rules that keep a fetch off the boot path - nothing at import, nothing before
// allowImp(), the address through modelUrl, a failure said once and never retried - are
// asserted rather than trusted. The swap in crowd-view.js has to be exact both ways: a
// guard's instanced body is parked while an imp stands in for it, comes back the moment
// there is none, and a guard who falls takes his imp with him. And one imp per guard is only
// affordable because they share their geometry, are culled by a sphere that really holds
// every pose, and stop animating when nobody sees them - so those are measured on the real
// GLB, not on a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// crowd-view.js reaches buildings.js through boat.js, which builds a TextureLoader at import.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
// Anything imp.js fetched while it was being imported would land here.
const fetched = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url) => { fetched.push(String(url)); return Promise.reject(new Error('no network in a test')); };
const THREE = await import('three');
const imp = await import('../web/js/imp.js');
const { createCrowdView } = await import('../web/js/crowd-view.js');
const { STRIKE_S, strikeArm } = await import('../web/js/settler-figures.js');
const bars = await import('../web/js/agent-bars.js');
const { pickBars } = bars;
const { buildBuilding } = await import('../web/js/buildings.js');
const { GUARDHOUSE_REACH, GUARDS } = await import('../shared/volcano.mjs');
delete globalThis.document;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'web', 'js', 'imp.js'), 'utf8');
const GLB = path.join(HERE, '..', 'web', 'models', 'hostile-settler.glb');

test('importing the imp fetches nothing, and nothing stands before the island says so', () => {
  assert.deepEqual(fetched, [], 'imp.js reached the network at import time');
  assert.equal(imp.createImp(new THREE.Scene(), 'guard:0'), null, 'an imp before allowImp() means a load on the boot path');
  assert.deepEqual(fetched, []);
});

test('the model is asked for through modelUrl, and neither the loader nor SkeletonUtils is in the boot graph', () => {
  assert.match(SRC, /modelUrl\(IMP_FILE\)/);
  assert.equal(imp.IMP_FILE, 'hostile-settler.glb');
  assert.ok(fs.existsSync(GLB), 'the GLB is not in web/models');
  assert.ok(!/^import[^\n]*(GLTFLoader|SkeletonUtils)/m.test(SRC), 'a static import puts an addon on the boot path');
  assert.match(SRC, /import\('three\/addons\/loaders\/GLTFLoader\.js'\)/);
  assert.match(SRC, /import\('three\/addons\/utils\/SkeletonUtils\.js'\)/);
  const vendor = fs.readFileSync(path.join(HERE, '..', 'scripts', 'vendor.mjs'), 'utf8');
  assert.match(vendor, /SkeletonUtils\.js/, 'SkeletonUtils is not vendored, so every imp would fail to load');
});

test('every guard on the volcano is an imp, and nobody else anywhere', () => {
  assert.equal(imp.impsOn({ village: { island: { volcano: true, hostile: true } } }), true);
  assert.equal(imp.impsOn({ village: { island: { hostile: true } } }), false, 'a hostile island is not the volcano');
  assert.equal(imp.impsOn({ village: null }), false);
  assert.equal(imp.impsOn(null), false);
  for (const id of ['guard:0', 'guard:7', 'guard:23']) assert.equal(imp.wantsImp(id), true, id);
  for (const id of ['codex:0123456789abcdef:house:s3', 'house:abc', 'civic:guardhouse', null]) assert.equal(imp.wantsImp(id), false, String(id));
});

test('the imp is 1.3 settlers tall, not its own metres', () => {
  const tall = 1.08 * imp.IMP_SCALE;
  assert.ok(Math.abs(tall - 0.430 * 1.3) < 1e-9, `the imp stands ${tall} units`);
});

test('an imp never swings on its own: only the sea starts one', () => {
  // The page used to guess - its walker in range, a cooldown of its own - and what it drew
  // and what hurt were unrelated. Nothing in imp.js may decide to attack any more.
  assert.ok(!/attackDue|ATTACK_COOLDOWN/.test(SRC), 'the page-side guess at a swing is back');
});

test('each guard breathes at his own point of the idle, the same one on every page', () => {
  const phases = Array.from({ length: GUARDS.CAP }, (_, n) => imp.idlePhase(`guard:${n}`, 2));
  for (const p of phases) assert.ok(p >= 0 && p < 2, `phase ${p} is outside the clip`);
  assert.deepEqual(phases, Array.from({ length: GUARDS.CAP }, (_, n) => imp.idlePhase(`guard:${n}`, 2)), 'not deterministic');
  // Not in unison: spread over the breath, no two within a frame of each other in a row of six.
  assert.ok(new Set(phases.map((p) => p.toFixed(3))).size === phases.length, 'two guards share a phase');
  const row = phases.slice(0, 6).sort((a, b) => a - b);
  assert.ok(row.at(-1) - row[0] > 0.5, `the front row breathes within ${row.at(-1) - row[0]} s of each other`);
});

test('the nearest guards get the imps, a holder keeps his until somebody is clearly nearer, and a phone gets fewer', () => {
  assert.equal(imp.IMP_LIMIT, imp.IMP_CAP.desktop, 'this is not a phone');
  assert.equal(imp.IMP_CAP.desktop, 16);
  assert.equal(imp.IMP_CAP.phone, 6);
  assert.ok(imp.IMP_CAP.desktop <= GUARDS.CAP);
  const at = (id, x, has = false) => ({ id, x, y: 0, z: 0, has });
  const eye = { x: 0, y: 0, z: 0 };
  // No more of them than the limit: everybody, wherever the eye is.
  assert.deepEqual([...imp.pickImps([at('guard:0', 50), at('guard:1', 90)], null, 2)].sort(), ['guard:0', 'guard:1']);
  // More: the nearest.
  const four = [at('guard:0', 9), at('guard:1', 1), at('guard:2', 5), at('guard:3', 3)];
  assert.deepEqual([...imp.pickImps(four, eye, 2)].sort(), ['guard:1', 'guard:3']);
  // A holder at 5 is kept against a newcomer at 4.5 (5 * 0.8 = 4), and loses to one at 3.9.
  assert.deepEqual([...imp.pickImps([at('guard:0', 5, true), at('guard:1', 4.5)], eye, 1)], ['guard:0']);
  assert.deepEqual([...imp.pickImps([at('guard:0', 5, true), at('guard:1', 3.9)], eye, 1)], ['guard:1']);
  // A tie goes to the id, whatever order they came in.
  assert.deepEqual([...imp.pickImps([at('guard:5', 2), at('guard:4', -2)], eye, 1)], ['guard:4']);
});

// ---- the real model ---------------------------------------------------------------------

const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { clone: cloneSkinned } = await import('three/addons/utils/SkeletonUtils.js');
async function loadImp() {
  const buf = fs.readFileSync(GLB);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(ab, '', resolve, reject));
}
const template = imp.prepareImp(await loadImp(), cloneSkinned);
const skinnedOf = (root) => { let m = null; root.traverse((o) => { if (o.isSkinnedMesh && !m) m = o; }); return m; };

test('the culling sphere holds every pose of every clip, so a culled imp is really off the screen', (t) => {
  const model = cloneSkinned(template.model);
  const mesh = skinnedOf(model);
  assert.ok(mesh, 'no skinned mesh in the GLB');
  assert.equal(mesh.frustumCulled, true, 'culling is off: every imp costs a draw call wherever it is');
  assert.ok(mesh.boundingSphere, 'the imp has no sphere of its own, so three would compute one from the pose of the moment');
  const sphere = mesh.boundingSphere;
  assert.deepEqual([...template.clips.keys()].sort(), ['attack', 'idle', 'swim', 'walk'], 'not the clips the island plays (walk-rootmotion is left out on purpose)');
  const mixer = new THREE.AnimationMixer(model);
  const v = new THREE.Vector3();
  const pos = mesh.geometry.attributes.position;
  let worst = 0;
  const byClip = [];
  for (const clip of template.clips.values()) {
    let most = 0;
    mixer.stopAllAction();
    const a = mixer.clipAction(clip);
    a.reset().play();
    const N = 12;
    for (let k = 0; k <= N; k++) {
      mixer.setTime((k / N) * clip.duration);
      model.updateMatrixWorld(true);
      mesh.skeleton.update();
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, v);
        most = Math.max(most, v.distanceTo(sphere.center) / sphere.radius);
      }
    }
    byClip.push(`${clip.name} ${most.toFixed(3)}`);
    worst = Math.max(worst, most);
  }
  t.diagnostic(`the furthest vertex of each clip, as a share of the sphere's radius: ${byClip.join(', ')}`);
  assert.ok(worst <= 1, `a vertex reaches ${worst.toFixed(3)} of the culling sphere's radius`);
});

test('imps share their geometry and their program, each has its own skeleton, and one going leaves the rest intact', () => {
  const scene = new THREE.Scene();
  const a = imp.standImp(template, scene, 'guard:0');
  const b = imp.standImp(template, scene, 'guard:1');
  assert.equal(a.mesh.geometry, b.mesh.geometry, 'every imp uploads its own copy of the mesh');
  // A material each, so a hit can flush one imp red - but made out of the template's with the
  // same patch and the same cache key, which is what three.js shares a program by.
  const tmpl = skinnedOf(template.model).material;
  assert.notEqual(a.mesh.material, b.mesh.material, 'a hit on one imp would flush every imp');
  assert.notEqual(a.mesh.material, tmpl);
  for (const m of [a.mesh.material, b.mesh.material]) {
    assert.equal(m.onBeforeCompile, tmpl.onBeforeCompile, 'a clone lost the lava patch, or got a closure of its own');
    assert.equal(m.customProgramCacheKey, tmpl.customProgramCacheKey, 'a clone compiles a program of its own');
    assert.equal(m.customProgramCacheKey(), 'hostile-settler-lava-glow');
  }
  assert.notEqual(a.mesh.skeleton, b.mesh.skeleton, 'two imps on one skeleton move as one');
  assert.notEqual(a.mesh.skeleton.bones[0], b.mesh.skeleton.bones[0]);
  assert.notEqual(a.idleTime(), b.idleTime(), 'two guards start their idle together');
  assert.equal(a.idleTime(), imp.idlePhase('guard:0', template.clips.get('idle').duration));
  let geometryGone = 0, materialGone = 0, skeletonGone = 0;
  a.mesh.geometry.addEventListener('dispose', () => { geometryGone++; });
  a.mesh.material.addEventListener('dispose', () => { materialGone++; });
  const skel = a.mesh.skeleton;
  const realSkelDispose = skel.dispose.bind(skel);
  skel.dispose = () => { skeletonGone++; realSkelDispose(); };
  a.dispose();
  assert.equal(geometryGone, 0, 'one imp going took the shared geometry with it');
  assert.equal(materialGone, 0, 'one imp going took the shared material with it');
  assert.equal(skeletonGone, 1, 'its own skeleton outlived it');
  assert.equal(scene.children.length, 1);
  assert.equal(scene.children[0], b.object);
  assert.ok(b.mesh.geometry.attributes.position.count > 0);
  b.dispose();
  assert.equal(scene.children.length, 0);
});

test('an imp only animates when it was drawn, near enough to see - or in the middle of a swing', () => {
  const scene = new THREE.Scene();
  const a = imp.standImp(template, scene, 'guard:3');
  const camAt = (x) => { const c = new THREE.PerspectiveCamera(); c.position.set(x, 0, 0); c.updateMatrixWorld(); return c; };
  const frame = (now) => a.update({ x: 0, y: 0, z: 0, yaw: 0, dt: 0.1, now });
  const t0 = a.idleTime();
  frame(0);
  assert.equal(a.idleTime(), t0, 'animated without ever having been drawn');
  a.mesh.onBeforeRender(null, scene, camAt(5));
  frame(100);
  assert.ok(Math.abs(a.idleTime() - t0 - 0.1) < 1e-9, 'drawn and near, and it did not move');
  a.mesh.onBeforeRender(null, scene, camAt(imp.ANIMATE_RANGE + 1));
  const t1 = a.idleTime();
  frame(200);
  assert.equal(a.idleTime(), t1, 'animated past ANIMATE_RANGE');
  // Not drawn at all this time, and a walker in reach: nothing swings until the sea says so,
  // and a swing it starts runs regardless.
  a.update({ x: 0, y: 0, z: 0, yaw: 0, dt: 0.1, now: 300, player: { x: 0.5, z: 0 } });
  assert.equal(a.attacking(), false, 'the imp swung without the sea');
  assert.equal(a.swing(), true);
  assert.equal(a.swing(), false, 'a swing already playing was started again');
  a.update({ x: 0, y: 0, z: 0, yaw: 0, dt: 0.1, now: 400, player: { x: 0.5, z: 0 } });
  assert.equal(a.attacking(), true);
  assert.equal(a.clip(), 'attack');
  for (let i = 0; i < 16; i++) a.update({ x: 0, y: 0, z: 0, yaw: 0, dt: 0.1, now: 500 + i * 100 });
  assert.equal(a.attacking(), false, 'the swing never finished');
  a.dispose();
});

test('the model is as tall as imp.js scales it for, so the imp really is 1.3 settlers', () => {
  const mesh = skinnedOf(template.model);
  mesh.geometry.computeBoundingBox();
  const top = mesh.geometry.boundingBox.max.y;
  assert.ok(Math.abs(top - 1.08) < 0.02, `the GLB is ${top.toFixed(3)} m to the horns, not the 1.08 IMP_HEIGHT_M says`);
});

test('an imp out of its depth paddles with the water at its chest, and walks or stands again ashore', () => {
  const scene = new THREE.Scene();
  const a = imp.standImp(template, scene, 'guard:5');
  const at = (o) => a.update({ x: 1, y: -0.22, z: 2, yaw: 0, dt: 0.05, now: 0, ...o });
  at({ swimming: true, moving: true, speed: 0.3 });
  assert.equal(a.clip(), 'swim');
  assert.ok(Math.abs(a.object.position.y + imp.SWIM_LINE_M * imp.IMP_SCALE) < 1e-9,
    `the swimmer stands at ${a.object.position.y}, not with the surface at ${imp.SWIM_LINE_M} m of the model`);
  at({ swimming: true, moving: false });
  assert.equal(a.clip(), 'swim', 'a swimmer who stops still has to tread water');
  at({ swimming: false, moving: true, speed: 0.3, y: 0.4 });
  assert.equal(a.clip(), 'walk');
  assert.equal(a.object.position.y, 0.4, 'ashore, the imp stands on the ground again');
  at({ swimming: false, moving: false, y: 0.4 });
  assert.equal(a.clip(), 'idle');
  a.dispose();
});

test('the guards stand clear of the castle they live in: its real footprint is within GUARDHOUSE_REACH', () => {
  const b = buildBuilding({ id: 'civic:guardhouse', kind: 'civic', civicType: 'castle', style: 'unknown', tier: 'civic', plot: { gx: 0, gz: 0, w: 3, d: 3, rot: 2 } });
  for (const r of b.solids) {
    assert.ok(Math.abs(r.x) + r.hx <= GUARDHOUSE_REACH && Math.abs(r.z) + r.hz <= GUARDHOUSE_REACH, `a wall reaches ${JSON.stringify(r)}`);
  }
  // And the step it stands on, which is not a wall but is still not where a guard should be.
  const p = b.geometry.attributes.position;
  let reach = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.3) reach = Math.max(reach, Math.abs(p.getX(i)), Math.abs(p.getZ(i)));
  assert.ok(reach <= GUARDHOUSE_REACH + 1e-6, `the castle reaches ${reach} along the ground`);
  assert.ok(reach > GUARDHOUSE_REACH - 0.05, `GUARDHOUSE_REACH (${GUARDHOUSE_REACH}) is far bigger than the castle (${reach}): measure again`);
});

test('a hit flushes that one imp red and rocks it back, then it is itself again - with no material made for it', () => {
  const scene = new THREE.Scene();
  const a = imp.standImp(template, scene, 'guard:6');
  const b = imp.standImp(template, scene, 'guard:7');
  const mat = a.mesh.material;
  const frame = (actor, dt) => actor.update({ x: 0, y: 0, z: 0, yaw: 0.7, dt, now: 0 });
  frame(a, 0); frame(b, 0);
  assert.equal(mat.emissive.getHex(), 0x000000, 'an imp nobody has hit is flushed');
  assert.equal(a.object.rotation.x, 0);
  for (let i = 0; i < 10; i++) { a.hit(); frame(a, 0.01); frame(b, 0.01); }
  assert.equal(a.mesh.material, mat, 'a hit swapped the material: one per blow is a program per blow');
  assert.equal(a.hurting(), true);
  assert.ok(mat.emissive.r > 0.5 && mat.emissive.r > mat.emissive.g * 4, `not red: ${mat.emissive.getHexString()}`);
  assert.ok(a.object.rotation.x < -0.2, 'the blow did not rock it back');
  assert.equal(a.object.rotation.order, 'YXZ', 'the flinch would tip it sideways when it faces anywhere but +z');
  assert.equal(b.mesh.material.emissive.getHex(), 0x000000, 'a hit on one imp flushed another');
  for (let t = 0; t < imp.HIT_S + 0.05; t += 0.05) frame(a, 0.05);
  assert.equal(a.hurting(), false);
  assert.equal(mat.emissive.getHex(), 0x000000, 'the flush never faded');
  assert.equal(a.object.rotation.x, 0, 'it never stood up again');
  a.dispose(); b.dispose();
});

test('the lava glows brighter by night, by one shared uniform, and exactly as before by day', () => {
  assert.equal(imp.lavaGlow(0).glow, 2.2, 'daytime is not what it was');
  assert.equal(imp.lavaGlow(0).ember, 0);
  let last = -1;
  for (const n of [0, 0.25, 0.5, 0.75, 1]) {
    const g = imp.lavaGlow(n);
    assert.ok(g.glow > last, `the glow does not rise at night ${n}`);
    last = g.glow;
  }
  assert.ok(imp.lavaGlow(1).glow >= 2.5 * imp.lavaGlow(0).glow, 'hardly brighter at night');
  assert.deepEqual(imp.lavaGlow(7), imp.lavaGlow(1), 'not clamped');
  assert.deepEqual(imp.lavaGlow(NaN), imp.lavaGlow(0));
  // Two imps' materials are handed the same uniform objects, so one write lights them all.
  const scene = new THREE.Scene();
  const a = imp.standImp(template, scene, 'guard:8');
  const b = imp.standImp(template, scene, 'guard:9');
  const src = '#include <common>\nvoid main() {\n#include <emissivemap_fragment>\n}';
  const sa = { uniforms: {}, fragmentShader: src }, sb = { uniforms: {}, fragmentShader: src };
  a.mesh.material.onBeforeCompile(sa);
  b.mesh.material.onBeforeCompile(sb);
  assert.equal(sa.uniforms.uLavaGlow, sb.uniforms.uLavaGlow, 'each imp has a glow of its own to set');
  assert.equal(sa.fragmentShader, sb.fragmentShader, 'two imps, two programs');
  assert.match(sa.fragmentShader, /uniform float uLavaGlow;/);
  assert.match(sa.fragmentShader, /totalEmissiveRadiance \+= /, 'the patch throws the material\'s own emissive (the hit flush) away');
  imp.setImpNight(1);
  assert.equal(sa.uniforms.uLavaGlow.value, imp.LAVA_GLOW.night);
  assert.deepEqual(imp.impGlow(), imp.lavaGlow(1));
  imp.setImpNight(0);
  assert.equal(sb.uniforms.uLavaGlow.value, imp.LAVA_GLOW.day);
  a.dispose(); b.dispose();
});

// ---- the swap in crowd-view.js --------------------------------------------------------

const volcano = {
  id: '0000000000000000', origin: [40, -20], half: 64, worldHeight: () => 0,
  village: { island: { volcano: true, hostile: true } },
};
const guardhouse = { id: 'civic:guardhouse', kind: 'civic', civicType: 'castle', style: 'unknown' };
const LODGER = 'codex:0123456789abcdef:house:s3';

function stubImps() {
  const made = [];
  const make = (id) => {
    const calls = { id, updates: [], disposed: 0, hits: 0, swings: 0 };
    const actor = { update: (u) => calls.updates.push(u), dispose: () => { calls.disposed++; }, hit: () => { calls.hits++; },
      swing: () => { calls.swings++; return true; } };
    made.push({ id, calls, actor });
    return actor;
  };
  return { made, make, of: (id) => made.filter((m) => m.id === id).at(-1) };
}

function crowdWith(make, extra = {}, ids = ['guard:0', 'guard:1', LODGER]) {
  const scene = new THREE.Scene();
  const crowd = createCrowdView({
    scene, material: new THREE.MeshBasicMaterial(), region: volcano, buildings: [guardhouse], imp: make, ...extra,
  });
  crowd.roster(ids);
  crowd.apply(new Map(ids.map((_, i) => [i, { x: 1 + 2 * i, z: 2 + 2 * i, anim: 'still' }])), 1000);
  return crowd;
}

// Where the crowd put somebody's torso this frame; -999 is where a hidden body is parked.
const m = new THREE.Matrix4();
const pos = new THREE.Vector3();
function torsoY(crowd, id) {
  const f = crowd.figure(id);
  const torso = crowd.pickables()[0];
  torso.getMatrixAt(f.slot, m);
  return pos.setFromMatrixPosition(m).y;
}

test('every guard is parked while an imp stands in for him, where he would have stood; a lodger stays a settler', () => {
  const s = stubImps();
  const crowd = crowdWith(s.make, { player: () => ({ x: 41.5, z: -18 }) });
  crowd.draw(0.016, () => 0.5, 1000);
  assert.deepEqual([...crowd.imps().keys()].sort(), ['guard:0', 'guard:1']);
  const u0 = s.of('guard:0').calls.updates.at(-1);
  const u1 = s.of('guard:1').calls.updates.at(-1);
  assert.deepEqual([u0.x, u0.y, u0.z], [41, 0.5, -18], 'guard:0\'s imp is not where he is (origin included)');
  assert.deepEqual([u1.x, u1.y, u1.z], [43, 0.5, -16], 'guard:1\'s imp is not where he is');
  assert.equal(u0.visible, true);
  assert.deepEqual(u0.player, { x: 41.5, z: -18 }, 'the walker never reached the imp');
  assert.deepEqual(u1.player, { x: 41.5, z: -18 }, 'only one imp can swing');
  assert.equal(torsoY(crowd, 'guard:0'), -999, 'guard:0 is drawn under his imp');
  assert.equal(torsoY(crowd, 'guard:1'), -999, 'guard:1 is drawn under his imp');
  assert.equal(torsoY(crowd, LODGER), 0.5, 'a Codex lodger became an imp');
  assert.equal(s.made.length, 2);
  // And again on the next frame, which is the one that writes visible back to true.
  crowd.draw(0.016, () => 0.5, 1016);
  assert.equal(torsoY(crowd, 'guard:1'), -999);
  assert.equal(s.made.length, 2, 'an imp was made again for a guard who already had one');
});

test('a hit reaches the imp standing in for a guard, and makes an ordinary figure flinch and come back to its colours', () => {
  const s = stubImps();
  const crowd = crowdWith(s.make);
  crowd.draw(0.016, () => 0.5, 1000);
  assert.equal(crowd.hit('guard:0'), true);
  assert.equal(s.of('guard:0').calls.hits, 1, 'the imp never heard of the blow');
  assert.equal(s.of('guard:1').calls.hits, 0);
  assert.equal(crowd.hit('guard:99'), false, 'somebody nobody here has heard of was hit');
  // The lodger is an instanced settler: his torso goes red and comes back exactly.
  const f = crowd.figure(LODGER);
  const torso = crowd.pickables()[0];
  const c = new THREE.Color();
  torso.getColorAt(f.slot, c);
  const before = c.getHex();
  assert.equal(crowd.hit(LODGER), true);
  crowd.draw(0.016, () => 0.5, 1016);
  torso.getColorAt(f.slot, c);
  assert.notEqual(c.getHex(), before, 'the figure did not flush');
  assert.ok(c.r > c.g, 'the flush is not red');
  assert.equal(s.of('guard:0').calls.hits, 1, 'the lodger\'s blow reached an imp');
  for (let i = 0; i < 25; i++) crowd.draw(0.016, () => 0.5, 1032 + i * 16);
  torso.getColorAt(f.slot, c);
  assert.equal(c.getHex(), before, 'the figure kept the flush');
  assert.equal(f.flinch, 0);
});

test('a swing the sea starts reaches the imp, or swings an ordinary figure\'s sword arm and puts it back', () => {
  const s = stubImps();
  const crowd = crowdWith(s.make);
  crowd.draw(0.016, () => 0.5, 1000);
  assert.equal(crowd.swing('guard:1'), true);
  assert.equal(s.of('guard:1').calls.swings, 1);
  assert.equal(s.of('guard:0').calls.swings, 0);
  assert.equal(crowd.swing('guard:99'), false);
  const f = crowd.figure(LODGER);
  assert.equal(crowd.swing(LODGER), true);
  assert.equal(f.strike, STRIKE_S);
  assert.equal(s.of('guard:0').calls.swings + s.of('guard:1').calls.swings, 1, 'the lodger\'s swing reached an imp');
  // Wound up over the head at the top, down in front at the blow, and back where it was.
  const rest = strikeArm(0, -0.45);
  assert.equal(rest, -0.45);
  assert.ok(strikeArm(0.55, -0.45) < -2, 'not wound up at the top of the swing');
  assert.ok(strikeArm(0.72, -0.45) > -0.3, 'not down in front at the blow');
  assert.ok(Math.abs(strikeArm(1, -0.45) + 0.45) < 1e-9, 'the arm did not come back to where it was');
  for (let i = 0; i < 60; i++) crowd.draw(0.016, () => 0.5, 1016 + i * 16);
  assert.equal(f.strike, 0, 'the swing never ended');
});

test('everybody who can be fought is offered a health bar, at what the sea last said is left', () => {
  const s = stubImps();
  const crowd = crowdWith(s.make);
  crowd.draw(0.016, () => 0.5, 1000);
  const whole = crowd.bars();
  assert.equal(whole.length, 3, 'two guards and a lodger');
  assert.ok(whole.every((b) => b.frac === 1), 'somebody nobody has hit is not whole');
  const [g0, , lodger] = whole;
  assert.deepEqual([g0.x, g0.z], [41, -18], 'the bar is not over guard:0 (origin included)');
  assert.ok(g0.top > lodger.top, 'the bar over an imp does not clear its horns');
  crowd.hit('guard:0', 50, 100);
  crowd.hit(LODGER, 25, 100);
  const hurt = crowd.bars();
  assert.equal(hurt[0].frac, 0.5);
  assert.equal(hurt[1].frac, 1);
  assert.equal(hurt[2].frac, 0.25);
  // A hit with no numbers (an older sea) still flinches and leaves the bar alone.
  crowd.hit('guard:1');
  assert.equal(crowd.bars()[1].frac, 1);
  // And nobody on a friendly island has one.
  const friendly = createCrowdView({
    scene: new THREE.Scene(), material: new THREE.MeshBasicMaterial(),
    region: { ...volcano, village: { island: {} } }, buildings: [guardhouse],
  });
  friendly.roster(['guard:0']);
  friendly.apply(new Map([[0, { x: 1, z: 2, anim: 'still' }]]), 1000);
  assert.deepEqual(friendly.bars(), []);
});

test('the bars go to the nearest in range, a hurt one further out, in two draw calls', () => {
  const eye = { x: 0, y: 0, z: 0 };
  const at = (x, frac = 1) => ({ x, y: 0, z: 0, frac, top: 0.6 });
  assert.deepEqual(pickBars([at(5), at(bars.SHOW_RANGE + 1)], eye).map((c) => c.x), [5]);
  assert.deepEqual(pickBars([at(bars.SHOW_RANGE + 1, 0.5)], eye).map((c) => c.x), [bars.SHOW_RANGE + 1], 'a hurt guard lost its bar while you backed off');
  assert.deepEqual(pickBars([at(bars.HURT_RANGE + 1, 0.5)], eye), []);
  assert.deepEqual(pickBars([at(3), at(1), at(2)], eye, 2).map((c) => c.x), [1, 2]);
  assert.deepEqual(pickBars([at(1)], null), []);
  const scene = new THREE.Scene();
  const drawn = bars.createAgentBars(scene);
  const camera = new THREE.PerspectiveCamera();
  camera.updateMatrixWorld();
  const cands = Array.from({ length: 30 }, (_, i) => at(1 + i * 0.3, i === 0 ? 0 : 1));
  assert.equal(drawn.update(cands, camera), bars.BAR_LIMIT);
  const meshes = drawn.meshes();
  assert.equal(meshes.length, 2, 'more than two meshes for every bar on the screen');
  assert.ok(meshes.every((mesh) => mesh.isInstancedMesh && mesh.count === bars.BAR_LIMIT));
  // A bar at nothing is a sliver, not a singular matrix.
  meshes[1].getMatrixAt(0, m);
  assert.ok(Number.isFinite(m.determinant()) && m.determinant() !== 0);
  assert.equal(drawn.update([], camera), 0);
  assert.ok(meshes.every((mesh) => mesh.count === 0));
  drawn.dispose();
  assert.equal(scene.children.length, 0);
});

test('a guard over water is told he is swimming, and one on land is not', () => {
  const s = stubImps();
  const crowd = crowdWith(s.make);
  // guard:0 stands at local x 1, guard:1 at 3: the sea bed under the first, grass under the second.
  crowd.draw(0.016, (x) => (x < 42 ? -1.2 : 0.3), 1000);
  const u0 = s.of('guard:0').calls.updates.at(-1);
  const u1 = s.of('guard:1').calls.updates.at(-1);
  assert.equal(u0.swimming, true);
  assert.equal(u0.y, -0.22, 'the wading clamp is what the imp is handed; placing a swimmer is its own business');
  assert.equal(u1.swimming, false);
});

test('no imp to be had leaves every guard an ordinary figure', () => {
  let asked = 0;
  const crowd = crowdWith(() => { asked++; return null; });
  crowd.draw(0.016, () => 0.5, 1000);
  crowd.draw(0.016, () => 0.5, 1016);
  assert.equal(asked, 4, 'the view should keep asking, for every guard, until the model has loaded');
  assert.equal(crowd.imps().size, 0);
  assert.equal(torsoY(crowd, 'guard:0'), 0.5);
  assert.equal(torsoY(crowd, 'guard:1'), 0.5);
});

test('a guard who falls takes his imp with him, the others keep theirs, and he comes back to a fresh one', () => {
  const s = stubImps();
  const crowd = crowdWith(s.make);
  crowd.draw(0.016, () => 0, 1000);
  const first0 = s.of('guard:0');
  crowd.roster([null, 'guard:1', LODGER]);
  crowd.draw(0.016, () => 0, 1016);
  assert.equal(first0.calls.disposed, 1, 'the imp outlived its guard');
  assert.equal(s.of('guard:1').calls.disposed, 0, 'a fall took somebody else\'s imp');
  assert.deepEqual([...crowd.imps().keys()], ['guard:1']);
  crowd.roster([null, 'guard:1', LODGER, 'guard:0']);
  crowd.apply(new Map([[3, { x: 0, z: 0, anim: 'still' }]]), 1100);
  crowd.draw(0.016, () => 0, 1116);
  assert.equal(s.made.length, 3);
  assert.notEqual(s.of('guard:0'), first0);
  assert.equal(crowd.imps().get('guard:0'), s.of('guard:0').actor);
});

test('past the limit only the guards nearest the camera are imps, and the rest are figures', () => {
  const s = stubImps();
  const ids = ['guard:0', 'guard:1', 'guard:2', 'guard:3'];
  // Placed at local (1, 2), (3, 4), (5, 6), (7, 8) - world (41, -18) .. (47, -12); the eye
  // stands just past the far end.
  let eye = { x: 48, y: 0, z: -11 };
  const crowd = crowdWith(s.make, { eye: () => eye, impLimit: 2 }, ids);
  crowd.draw(0.016, () => 0.5, 1000);
  assert.deepEqual([...crowd.imps().keys()].sort(), ['guard:2', 'guard:3']);
  assert.equal(torsoY(crowd, 'guard:0'), 0.5, 'a guard past the limit is not drawn at all');
  assert.equal(torsoY(crowd, 'guard:3'), -999);
  // The camera goes to the other end: the imps move with it, and the ones left are disposed.
  eye = { x: 40, y: 0, z: -19 };
  crowd.draw(0.016, () => 0.5, 1016);
  assert.deepEqual([...crowd.imps().keys()].sort(), ['guard:0', 'guard:1']);
  assert.equal(s.of('guard:3').calls.disposed, 1);
  crowd.draw(0.016, () => 0.5, 1032);
  assert.equal(torsoY(crowd, 'guard:3'), 0.5, 'a guard who gave his imp up was left undrawn');
});

test('off Live every imp is hidden with everybody else, and a thrown-away crowd disposes them all', () => {
  const s = stubImps();
  const crowd = crowdWith(s.make, { player: () => ({ x: 0, z: 0 }) });
  crowd.draw(0.016, () => 0, 1000, false);
  for (const m of s.made) {
    assert.equal(m.calls.updates.at(-1).visible, false);
    assert.equal(m.calls.updates.at(-1).player, null, 'a hidden imp should not be swinging');
  }
  crowd.dispose();
  assert.equal(s.made.length, 2);
  for (const m of s.made) assert.equal(m.calls.disposed, 1);
});

test('an island that is not the volcano never asks for an imp', () => {
  let asked = 0;
  const scene = new THREE.Scene();
  const crowd = createCrowdView({
    scene, material: new THREE.MeshBasicMaterial(), region: { ...volcano, village: { island: { hostile: true } } },
    buildings: [guardhouse], imp: () => { asked++; return null; },
  });
  crowd.roster(['guard:0']);
  crowd.apply(new Map([[0, { x: 0, z: 0, anim: 'still' }]]), 1000);
  crowd.draw(0.016, () => 0, 1000);
  assert.equal(asked, 0);
});

// Last, because it flips the module's one-way switches: allowed, and then failed for good.
test('a model that will not load is said once and never asked for again', async () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a);
  try {
    imp.allowImp();
    const scene = new THREE.Scene();
    assert.equal(imp.createImp(scene, 'guard:0'), null, 'the first ask starts the load and answers null');
    for (let i = 0; i < 200 && !warned.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(warned.length, 1, 'the failure was not reported');
    assert.match(String(warned[0][0]), /hostile-settler\.glb/);
    const before = fetched.length;
    assert.equal(imp.createImp(scene, 'guard:1'), null);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(warned.length, 1, 'a failed load was retried or reported twice');
    assert.equal(fetched.length, before, 'a failed load was fetched again');
    assert.equal(scene.children.length, 0);
  } finally {
    console.warn = realWarn;
    globalThis.fetch = realFetch;
  }
});
