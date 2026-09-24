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

// Where a body is the first time it is heard of.
//
// A figure enrolled by a roster sits at the island's own middle, because that is all a
// roster knows. `draw` already refused to show one before the sea had said where it was -
// but the refusal only covered standing there. The first position still became the far end
// of an interpolation whose near end was the middle, so every settler set off from the
// town square and walked a dead straight line to their own front door. Once at boot, once
// after a reseed, and for the whole village at once whenever a roster came back under
// different names - which is what a restarting islander does to /api/crowd-ids.
//
// The fix is one line in apply(); these are the two halves of what it has to keep true.
test('a body appears where it is, not walking out of the middle of the island', () => {
  const crowd = view();
  const [ox, oz] = region.origin;
  const f = crowd.figure('house:b');
  assert.deepEqual(f.pos, [ox, oz], 'a fresh figure starts at the island middle');

  // Well away from the middle, so a glide from it would be unmistakable.
  const idx = [...crowd.figures().entries()].find(([, g]) => g === f)[0];
  crowd.apply(new Map([[idx, { x: 20, z: -14, anim: 'walk' }]]), 1000);
  assert.deepEqual(f.from, [ox + 20, oz - 14], 'the first position must be a snap, not a glide');
  assert.deepEqual(f.to, [ox + 20, oz - 14]);

  // And drawn there straight away rather than somewhere along the way in from the square.
  crowd.draw(0.016, ground, 1000);
  assert.deepEqual(f.pos, [ox + 20, oz - 14]);
});

test('every position after the first is still interpolated', () => {
  const crowd = view();
  const f = crowd.figure('house:a');
  const idx = [...crowd.figures().entries()].find(([, g]) => g === f)[0];
  crowd.apply(new Map([[idx, { x: 0, z: 0, anim: 'walk' }]]), 1000);
  crowd.draw(0.016, ground, 1000);
  // A second word, two units on. This one must come from where the body actually is.
  crowd.apply(new Map([[idx, { x: 2, z: 0, anim: 'walk' }]]), 1200);
  assert.deepEqual(f.from, [region.origin[0], region.origin[1]], 'it should set off from where it stood');
  assert.deepEqual(f.to, [region.origin[0] + 2, region.origin[1]]);
  // Halfway along the step, which is the whole point of the glide: the word took 200 ms
  // to arrive, so the body takes 200 ms to get there and is at the middle after 100.
  crowd.draw(0.016, ground, 1300);
  assert.ok(f.pos[0] > region.origin[0], 'a walking body should have set off');
  assert.ok(f.pos[0] < region.origin[0] + 2, 'it should not have arrived yet');
  assert.ok(Math.abs(f.pos[0] - (region.origin[0] + 1)) < 0.01, `${f.pos[0] - region.origin[0]} along a two-unit step at half time`);
});

// ---- a stream of words into somebody walking -------------------------------------------
//
// The bug these guard against was not subtle once seen and was invisible in any single
// frame: every word about a walker put them a whole message *ahead* of the sea, so they
// jumped forward when it landed and crept back until the next one, five times a second,
// turning their head to face the creep each time. A straight line at a steady pace is
// the plainest way to see it, and the plainest thing to hold.

const indexOf = (crowd, f) => [...crowd.figures().entries()].find(([, g]) => g === f)[0];

test('a walker on a straight line never steps back, never jumps and never turns round', () => {
  const crowd = view();
  const f = crowd.figure('house:a');
  const idx = indexOf(crowd, f);
  const [ox] = region.origin;
  const SPEED = 0.5;             // units a second: a settler out on an errand
  const SAMPLE = 198;            // ms between a walker's words: three beats of 66
  const FRAME = 1000 / 60;
  let now = 5000, next = now, lastX = null;
  let reversals = 0, jump = 0, ahead = 0, turned = 0, gaits = 0;
  for (let i = 0; i < 300; i++) {
    while (next <= now) {
      crowd.apply(new Map([[idx, { x: SPEED * (next - 5000) / 1000, z: 0, anim: 'walk' }]]), next);
      next += SAMPLE;
    }
    crowd.draw(FRAME / 1000, ground, now, true);
    const truth = ox + SPEED * (now - 5000) / 1000;
    if (lastX != null && i > 30) {          // once the second word has landed
      const dx = f.pos[0] - lastX;
      if (dx < -1e-6) reversals++;
      jump = Math.max(jump, dx);
      if (f.pos[0] > truth + 1e-6) ahead++;
      if (!f.face || f.face[0] <= 0) turned++;
      if (f.anim !== 'walk') gaits++;
    }
    lastX = f.pos[0];
    now += FRAME;
  }
  assert.equal(reversals, 0, `${reversals} frames walked backwards`);
  assert.ok(jump <= SPEED * FRAME / 1000 * 1.5 + 1e-6, `a step of ${jump.toFixed(4)} in one frame, at ${(SPEED * FRAME / 1000).toFixed(4)} a frame`);
  assert.equal(ahead, 0, `${ahead} frames ahead of the sea`);
  assert.equal(turned, 0, `${turned} frames facing anywhere but forward`);
  assert.equal(gaits, 0, `${gaits} frames in something other than a walking gait`);
  // One message behind the sea, more or less, and no more: that is the price of the glide.
  const behind = ox + SPEED * (now - FRAME - 5000) / 1000 - f.pos[0];
  assert.ok(behind > 0 && behind < SPEED * SAMPLE / 1000 * 1.6, `${behind.toFixed(3)} units behind, and a message is ${SPEED * SAMPLE / 1000}`);
});

test('a body the sea said had stopped stops there, in the gait it arrived in', () => {
  const crowd = view();
  const f = crowd.figure('house:a');
  const idx = indexOf(crowd, f);
  const [ox, oz] = region.origin;
  crowd.apply(new Map([[idx, { x: 0, z: 0, anim: 'walk' }]]), 1000);
  crowd.draw(0.016, ground, 1000);
  crowd.apply(new Map([[idx, { x: 0.1, z: 0, anim: 'walk' }]]), 1200);
  crowd.draw(0.016, ground, 1216);
  // The step off the road: the sea says they have stopped, a stride further on.
  crowd.apply(new Map([[idx, { x: 0.15, z: 0, anim: 'still' }]]), 1300);
  crowd.draw(0.016, ground, 1316);
  assert.equal(f.anim, 'walk', 'the last stride of an errand should still be walked');
  for (let t = 1332; t < 4000; t += 16) crowd.draw(0.016, ground, t);
  assert.ok(Math.abs(f.pos[0] - (ox + 0.15)) < 1e-6 && Math.abs(f.pos[1] - oz) < 1e-6,
    `stood at ${f.pos[0] - ox}, not at the door at 0.15: a body told it had stopped must not be guessed onward`);
  assert.equal(f.anim, 'still');
});

test('a walker whose next word is late carries on a little, then stands rather than treads', () => {
  const crowd = view();
  const f = crowd.figure('house:a');
  const idx = indexOf(crowd, f);
  const [ox] = region.origin;
  crowd.apply(new Map([[idx, { x: 0, z: 0, anim: 'walk' }]]), 1000);
  crowd.draw(0.016, ground, 1000);
  crowd.apply(new Map([[idx, { x: 0.1, z: 0, anim: 'walk' }]]), 1200);
  let t = 1216;
  for (; t <= 1400; t += 16) crowd.draw(0.016, ground, t);
  assert.ok(Math.abs(f.pos[0] - (ox + 0.1)) < 0.01, 'should have arrived at the word as the next one fell due');
  // And nothing arrives. A little dead reckoning, then a halt - and a halt is drawn as a
  // halt, whatever the last word called them.
  for (; t <= 3000; t += 16) crowd.draw(0.016, ground, t);
  assert.ok(f.pos[0] > ox + 0.1, 'a late word should have been guessed at a little');
  assert.ok(f.pos[0] < ox + 0.2, `guessed ${f.pos[0] - ox - 0.1} past the last word, which is more than one message`);
  assert.equal(f.anim, 'still', 'a body held still was drawn walking on the spot');
});

test('a word from further than anybody can walk is a snap, not a streak across the island', () => {
  const crowd = view();
  const f = crowd.figure('house:a');
  const idx = indexOf(crowd, f);
  const [ox, oz] = region.origin;
  crowd.apply(new Map([[idx, { x: 0, z: 0, anim: 'walk' }]]), 1000);
  crowd.draw(0.016, ground, 1000);
  // The sea rebuilt its crowd and this one is back at their own door, twenty units off.
  crowd.apply(new Map([[idx, { x: 20, z: 5, anim: 'still' }]]), 1200);
  assert.deepEqual(f.from, [ox + 20, oz + 5], 'should have snapped rather than set off');
  crowd.draw(0.016, ground, 1200);
  assert.deepEqual(f.pos, [ox + 20, oz + 5]);
  assert.equal(f.anim, 'still');
});

test('stepping off a boat leaves the body standing on the quay, not out of sight', () => {
  const crowd = view();
  const f = crowd.figure('house:a');
  const idx = indexOf(crowd, f);
  const [ox, oz] = region.origin;
  crowd.applyRides(new Map([[idx, { x: 1, z: 2, yaw: 0, rx: 1, rz: 2, ry: 0.05, ryaw: 0 }]]), 1000);
  crowd.draw(0.016, ground, 1000, true);
  assert.equal(f.visible, true);
  // The outing is over: the beat with no row for them takes the hull away.
  crowd.applyRides(new Map(), 1200);
  crowd.draw(0.016, ground, 1200, true);
  assert.equal(f.visible, true, 'vanished on the quay until the next word about them');
  assert.deepEqual(f.pos, [ox + 1, oz + 2]);
  assert.equal(f.anim, 'still');
});

test('a hostile island arms its people with a sword and a torch, two meshes for the lot', () => {
  const meshes = (hostile) => {
    const keep = {};
    const scene = new THREE.Scene();
    const buildings = ['house:a', 'house:b'].map((id) => ({ id, kind: 'house', name: id, style: 'opus' }));
    const r = { ...region, village: { island: { hostile } } };
    const crowd = createCrowdView({ scene, material: new THREE.MeshBasicMaterial(), region: r, buildings });
    crowd.roster(buildings.map((b) => b.id));
    keep.inst = scene.children.filter((c) => c.isInstancedMesh);
    return keep.inst;
  };
  const friendly = meshes(false), hostile = meshes(true);
  assert.equal(hostile.length, friendly.length + 2);
  // Every resident gets one of each: the two extra meshes count exactly as far as the torso.
  // They come straight after the eleven body meshes, before the hats and the hammer.
  const extra = hostile.slice(11, 13);
  const torso = hostile[0];
  for (const m of extra) assert.equal(m.count, torso.count);
  assert.equal(torso.count, 2);
  // The flame is the one part that glows after dark, and it came along with the torch.
  const glow = extra[1].geometry.attributes.aEmissive.array;
  assert.ok(glow.some((v) => v > 0), 'the torch has no flame');
  assert.ok(!extra[0].geometry.attributes.aEmissive.array.some((v) => v > 0), 'the sword is glowing');
});

// Plans/bier-en-dronken.md: a beer handed over by the player. The settler turns to whoever
// gave it, drinks it, lets go of their face once it is down, and from the third glass sways -
// all of it on this page, keyed by the house they live in so a re-dress keeps it.
test('a settler handed beers turns to the giver, drinks one at a time and sways from the third', async () => {
  const { SETTLER_DRINK_S } = await import('../web/js/settler-figures.js');
  const crowd = view();
  place(crowd, 1000);
  crowd.draw(0.016, ground, 1000);
  const f = crowd.figure('house:a');
  assert.equal(crowd.giveBeer('house:nobody', [0, 0], 1000), false);
  assert.equal(crowd.giveBeer('house:a', [f.pos[0], f.pos[1] + 2], 1000), true);
  assert.ok(Math.abs(f.faceAngle) < 1e-9, 'did not turn to the giver standing due +z: ' + f.faceAngle);
  assert.equal(crowd.giveBeer('house:a', [0, 0], 1100), false, 'a second beer before the first was down');
  // Drawn through the drink: the glass goes down, the face is let go of.
  let now = 1000;
  const step = (s) => { for (let t = 0; t < s; t += 0.05) { now += 50; crowd.draw(0.05, ground, now); } };
  step(SETTLER_DRINK_S + 0.2);
  assert.equal(f.faceAngle, null, 'still turned to the giver after the glass was down');
  assert.equal(f.sway || 0, 0, 'one beer and already swaying');
  for (let i = 0; i < 2; i++) { assert.equal(crowd.giveBeer('house:a', null, now), true); step(SETTLER_DRINK_S + 0.2); }
  assert.ok(Math.abs(crowd.beersIn('house:a') - 3) < 0.05, 'three beers in: ' + crowd.beersIn('house:a'));
  assert.ok(f.sway > 0.4 && f.sway < 0.6, 'the third should start the sway: ' + f.sway);
  assert.equal(crowd.giveBeer('house:a', null, now), true);
  step(SETTLER_DRINK_S + 0.2);
  assert.ok(f.sway > 0.95, 'the fourth should have them rocking: ' + f.sway);
  // And it wears off.
  for (let i = 0; i < 300; i++) { now += 1000; crowd.draw(1, ground, now); }
  assert.equal(f.sway, 0, 'still swaying five minutes on');
  assert.equal(crowd.beersIn('house:a'), 0);
  crowd.dispose();
});
