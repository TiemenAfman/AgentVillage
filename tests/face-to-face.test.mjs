// Talking to somebody face to face (web/js/facetoface.js): the camera goes to them, stays
// there for as long as the conversation lasts, and comes back only when it is ended.
//
// What broke it on the island was not this module but a second hand on the camera - the
// keepers were spoken to with walk mode still running, and its stance won the moment the
// conversation stopped moving the camera in and started following (main.js speakToKeeper,
// which now pauses the feet and holds until Escape). What is held here is this module's half:
// a held conversation stays held however long nothing ends it, it follows the settler found
// each frame - a roster arriving mid-conversation enrols a new figure object under the same
// id - and the letting go happens exactly once, on the way out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// Just enough of a document for three's loaders, which settler-figures.js reaches at import.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
globalThis.window = { innerWidth: 1200, innerHeight: 800 };
const THREE = await import('three');
const { createFaceToFace } = await import('../web/js/facetoface.js');
delete globalThis.document;

function camera() {
  const c = new THREE.PerspectiveCamera(45, 1.5, 0.5, 2000);
  c.position.set(10, 8, 10);
  c.lookAt(0, 0, 0);
  return c;
}
const figure = (x, z) => ({ pos: [x, z], y: 0, visible: true });
const run = (ff, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) ff.update(dt); };
const flat = (a, b) => Math.hypot(a.x - b[0], a.z - b[1]);

test('a conversation holds the camera on the settler until it is ended, however long that is', () => {
  const cam = camera();
  const ff = createFaceToFace({ camera: cam });
  let letGo = 0;
  assert.equal(ff.begin({ subject: figure(0, 0), viewer: { x: 0, z: 1.2, feetY: 0 }, onLetGo: () => letGo++ }), true);
  run(ff, 0.6);                                   // moved in
  const held = cam.position.clone();
  assert.ok(flat(cam.position, [0, 0]) < 1.5, 'the camera did not come to the settler');
  run(ff, 30);                                    // half a minute of nobody pressing anything
  assert.equal(ff.isActive(), true, 'the conversation ended by itself');
  assert.ok(cam.position.distanceTo(held) < 1e-3, 'the camera drifted off the settler');
  assert.equal(letGo, 0, 'the settler was let go of before the conversation ended');

  let home = 0;
  assert.equal(ff.end(() => home++), true);
  assert.equal(letGo, 1, 'ending lets the settler go at once');
  run(ff, 0.5);
  assert.equal(ff.isActive(), false);
  assert.equal(home, 1, 'nobody was told the camera was home');
  assert.ok(cam.position.distanceTo(new THREE.Vector3(10, 8, 10)) < 1e-3, 'the camera did not go back where it came from');
  assert.equal(letGo, 1, 'the settler was let go of twice');
});

test('the camera follows whichever figure the finder hands it, and holds the last one it found', () => {
  const cam = camera();
  const ff = createFaceToFace({ camera: cam });
  let current = figure(0, 0);
  ff.begin({ subject: () => current, viewer: { x: 0, z: 1.2, feetY: 0 } });
  run(ff, 0.6);
  // A roster arrives: a new object under the same id, standing a step to the side.
  current = figure(2, 0);
  run(ff, 1.5);
  assert.ok(flat(cam.position, [2, 0]) < flat(cam.position, [0, 0]), 'the camera stayed on the figure nobody moves any more');
  // A frame in which the finder finds nobody: the last figure stands in, nothing throws.
  const before = cam.position.clone();
  current = null;
  run(ff, 0.2);
  assert.ok(cam.position.distanceTo(before) < 0.05, 'losing the figure for a frame moved the camera');
  ff.cancel();
});

test('a conversation with nobody to look at does not begin, and a cancel lets go once', () => {
  const cam = camera();
  const ff = createFaceToFace({ camera: cam });
  assert.equal(ff.begin({ subject: () => null, viewer: { x: 0, z: 0, feetY: 0 } }), false);
  assert.equal(ff.isActive(), false);
  let letGo = 0;
  ff.begin({ subject: figure(0, 0), viewer: { x: 0, z: 1.2, feetY: 0 }, onLetGo: () => letGo++ });
  assert.equal(ff.cancel(), true);
  assert.equal(ff.cancel(), false);
  assert.equal(letGo, 1);
});
