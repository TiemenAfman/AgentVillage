// The crowd as somebody else's island sends it, and what the island asks of it back.
//
// This view was written to draw a *guest* island: bodies arrive off the wire by index and
// nothing on this side ever has an opinion about one of them. Our own island asks two more
// things of it, and both are here because both are easy to get subtly wrong:
//
//   - everything that is *about* a person - the dossier, the hover label, a conversation -
//     knows them by the id of the house they live in, not by the index the wire counts in;
//   - a filter, or a chronicle scrubbed back past the day they arrived, takes somebody out
//     of sight without taking them out of the crowd. That had to be a different word from
//     `visible`, which draw() writes every single frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// The view reaches boat.js for an outing's hull, which reaches buildings.js, which asks
// for its texture sheets the moment it loads. The same stub tests/boat.test.mjs uses.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const THREE = await import('three');
const { createCrowdView } = await import('../web/js/crowd-view.js');
delete globalThis.document;

const region = { id: 'testholm', origin: [120, -80], half: 32, worldHeight: () => 0 };
const ground = () => 0;

function view(keep) {
  const scene = new THREE.Scene();
  if (keep) keep.scene = scene;
  const material = new THREE.MeshBasicMaterial();
  const buildings = ['house:a', 'house:b', 'house:c'].map((id, i) => ({
    id, kind: 'house', name: `House ${i}`, style: 'opus',
  }));
  const crowd = createCrowdView({ scene, material, region, buildings });
  crowd.roster(buildings.map((b) => b.id));
  return crowd;
}

// Where the sea last said everybody was. Nobody is drawn before this has happened - see
// the test below - so anything about visibility has to place them first.
function place(crowd, at = 1000) {
  const rows = new Map();
  let i = 0;
  for (const idx of crowd.figures().keys()) rows.set(idx, { x: i, z: i++, anim: 'still' });
  crowd.apply(rows, at);
}

test('a body can be found by the name the rest of the island calls it', () => {
  const crowd = view();
  assert.equal(crowd.count(), 3);
  const f = crowd.figure('house:b');
  assert.ok(f, 'the middle house has nobody living in it');
  assert.equal(f.id, 'house:b');
  assert.equal(crowd.figure('house:nobody'), null);
  assert.equal(crowd.byId().size, 3);

  // And the index map and the id map are the same three bodies, not two sets of them.
  for (const g of crowd.figures().values()) assert.equal(crowd.figure(g.id), g);
});

test('somebody who leaves the roster is forgotten by both names', () => {
  const crowd = view();
  const gone = crowd.figure('house:c');
  // The village shrank: the third house is not in the new roster at all.
  crowd.roster(['house:a', 'house:b']);
  assert.equal(crowd.figure('house:c'), null, 'a body nobody can see is still answering to its name');
  assert.equal(crowd.byId().size, 2);
  assert.equal(gone.visible, false);
});

test('nobody is drawn before the sea has said where they are', () => {
  // A body enrolled by a roster starts at the island's own middle, and used to stand
  // there in plain sight until its slice of the rotation came round - up to ten seconds
  // of a stranger on the town square. It shows worst at the moment it matters most: a
  // newcomer is enrolled and walked up from the beach in the same breath.
  const crowd = view();
  const f = crowd.figure('house:a');
  crowd.draw(0.016, ground, 1000, true);
  assert.equal(f.visible, false, 'somebody was drawn at the island’s middle');

  place(crowd, 1016);
  crowd.draw(0.016, ground, 1032, true);
  assert.equal(f.visible, true);
});

test('a filter hides somebody without the next frame putting them back', () => {
  const crowd = view();
  const f = crowd.figure('house:a');
  place(crowd);
  crowd.draw(0.016, ground, 1000, true);
  assert.equal(f.visible, true);

  crowd.setVisible('house:a', false);
  // Three frames, because the failure this is here for is draw() writing `visible` back -
  // one frame would pass with the flag simply not having been read yet.
  for (let i = 0; i < 3; i++) crowd.draw(0.016, ground, 1000 + i * 16, true);
  assert.equal(f.visible, false, 'a filtered settler came back the moment anything moved');

  crowd.setVisible('house:a', true);
  crowd.draw(0.016, ground, 1100, true);
  assert.equal(f.visible, true);
});

test('a hidden settler is not put back on the water either', () => {
  const crowd = view();
  const f = crowd.figure('house:a');
  const idx = [...crowd.figures()].find(([, g]) => g === f)[0];
  crowd.setVisible('house:a', false);
  // An outing for somebody the filter has taken out of sight. The hull is still drawn -
  // it is a boat, and it is not what the filter was about - but nobody is stood up in it.
  crowd.applyRides(new Map([[idx, { x: 1, z: 2, yaw: 0, rx: 1, rz: 2, ry: 0.05, ryaw: 0 }]]), 1000);
  crowd.draw(0.016, ground, 1000, true);
  assert.equal(f.visible, false);
});

test('stepping off Live takes the whole crowd out of sight, hulls and all', () => {
  const crowd = view();
  place(crowd);
  crowd.draw(0.016, ground, 1000, true);
  crowd.draw(0.016, ground, 1016, false);
  for (const f of crowd.figures().values()) assert.equal(f.visible, false);
});

test('a ray can be turned back into a body', () => {
  const crowd = view();
  const meshes = crowd.pickables();
  assert.ok(Array.isArray(meshes) && meshes.length, 'there is nothing to aim at');
  // Instance 0 is the first body enrolled, which is the first house in the roster.
  const hit = crowd.figureAt(meshes[0], 0);
  assert.ok(hit, 'a hit on the first instance named nobody');
  assert.equal(hit.id, 'house:a');
});

test('a crowd that is thrown away takes its meshes with it', () => {
  // One crowd is built per island and rebuilt on every reseed. Eleven instanced meshes
  // left standing empty per rebuild is the sort of leak that only turns up on a machine
  // somebody has had open all day, so it is asserted rather than assumed.
  const keep = {};
  const crowd = view(keep);
  const after = keep.scene.children.length;
  assert.ok(after > 0, 'the crowd put nothing in the scene at all');
  crowd.dispose();
  assert.equal(keep.scene.children.length, 0, `${keep.scene.children.length} meshes left behind`);
});
