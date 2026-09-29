// settler-batches.test.mjs holds the packed batches (Plans/verborgen-inwoners-tellen-niet.md) to a
// handful of hand-written orders. This walks them through thousands of random ones instead: a
// crowd that shows and hides people, loses them, takes new ones in, puts them to work, hits
// them and hands them beers, in whatever order a seeded stream deals out - because a slot that
// trades places with the wrong one does not crash anything, it puts one settler's shirt, hat or
// place on another, and the orders that do that are the ones nobody thinks to write down.
//
// After every step the same things have to hold as in settler-batches.test.mjs's `check`:
// every batch counts exactly who it draws, nobody hidden is inside a count, nothing inside a
// count is parked, and every drawn slot carries its own figure's place, colours, skirt and hat.
// Seeded, so a failure names the seed and the step and replays exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
// buildings.js starts texture requests on import; geometry tests need no image IO.
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { createFigures, settlerLook, CAPACITY } = await import('../web/js/settler-figures.js');
const { HAT_SHAPES } = await import('shared/palette.mjs');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

// mulberry32: small, fast, and the same stream on every machine.
function stream(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)] };
}

// Every word the walk can hand a figure, so the tools (hammer, hoe, barrow, tray, rod, sword,
// torch, pint) come and go with the bodies.
const ANIMS = ['still', 'walk', 'step', 'hammer', 'haul', 'barrow', 'carry', 'load', 'dance', 'hoe', 'weed', 'chop', 'gather', 'fish'];
const KINDS = [['woman', 'skirt'], ['woman', 'trousers'], ['man', 'trousers']];

function crowd({ armed = false } = {}) {
  const scene = new THREE.Scene();
  const view = createFigures(scene, new THREE.MeshBasicMaterial(), { armed });
  const [torso, , , , , , , , , head] = scene.children;
  const skirts = scene.getObjectByName('resident-skirts');
  const hair = scene.getObjectByName('resident-woman-hair');
  // The hat batches, in HAT_SHAPES order, after the two appearance layers - and after the
  // sword and the torch on an armed crowd, which are made before them.
  const shapes = HAT_SHAPES.filter((h) => h.id !== 'none').map((h) => h.id);
  const first = 13 + (armed ? 2 : 0);
  const hats = new Map(shapes.map((id, k) => [id, scene.children[first + k]]));
  return { scene, view, torso, head, skirts, hair, hats, figures: new Map(), made: 0 };
}

function parked(scene) {
  let n = 0;
  scene.traverse((m) => {
    if (!m.isInstancedMesh || !m.count) return;
    const a = m.instanceMatrix.array;
    for (let i = 0; i < m.count; i++) if (Math.hypot(a[i * 16], a[i * 16 + 1], a[i * 16 + 2]) < 0.001) n++;
  });
  return n;
}

// settler-batches.test.mjs's `check`, with two allowances a random crowd needs: a figure still
// red from a flinch is not held to its own colours until it has faded (the flinch test there
// holds the fading itself), and the per-frame tools are held only to "nothing parked, never more
// than there are people", because which tool a body holds is draw()'s rule, not the batches'.
const m4 = new THREE.Matrix4(), at = new THREE.Vector3(), c = new THREE.Color();
function check(k, where) {
  const drawn = [...k.figures.values()].filter((f) => f.visible);
  assert.equal(k.torso.count, drawn.length, `${where}: the body batch counts somebody it does not draw`);
  assert.equal(k.skirts.count, drawn.filter((f) => f.look.outfit === 'skirt').length, `${where}: skirts`);
  assert.equal(k.hair.count, drawn.filter((f) => f.look.presentation === 'woman').length, `${where}: hair`);
  for (const [shape, mesh] of k.hats) {
    assert.equal(mesh.count, drawn.filter((f) => f.look.hatShape === shape).length, `${where}: ${shape} hats`);
  }
  const bySlot = new Map();
  for (const f of k.figures.values()) {
    const inside = (slot, mesh) => slot >= 0 && slot < mesh.count;
    const hat = k.hats.get(f.look.hatShape);
    assert.ok(!bySlot.has(f.slot), `${where}: ${f.id} and ${bySlot.get(f.slot)} share slot ${f.slot}`);
    bySlot.set(f.slot, f.id);
    if (!f.visible) {
      assert.ok(!inside(f.slot, k.torso), `${where}: ${f.id} is hidden inside the body batch`);
      assert.ok(!inside(f.skirtSlot, k.skirts) && !inside(f.hairSlot, k.hair), `${where}: ${f.id}'s clothes are still drawn`);
      if (hat) assert.ok(!inside(f.hatSlot, hat), `${where}: ${f.id}'s hat is still drawn`);
      assert.equal(k.view.figureAt(k.torso, f.slot), null, `${where}: a ray finds the hidden ${f.id}`);
      continue;
    }
    assert.ok(inside(f.slot, k.torso), `${where}: ${f.id} is drawn outside the body batch`);
    assert.equal(k.view.figureAt(k.torso, f.slot), f, `${where}: slot ${f.slot} names somebody else than ${f.id}`);
    assert.equal(k.view.figureAt(k.head, f.slot), f, `${where}: ${f.id}'s head slot names somebody else`);
    k.torso.getMatrixAt(f.slot, m4);
    at.setFromMatrixPosition(m4);
    assert.deepEqual([at.x, at.z], [f.pos[0], f.pos[1]], `${where}: ${f.id} stands where somebody else does`);
    if (!(f.flinch > 0)) {
      k.torso.getColorAt(f.slot, c);
      assert.equal(c.getHex(), new THREE.Color(f.look.tunic).getHex(), `${where}: ${f.id} wears somebody else's shirt`);
      k.head.getColorAt(f.slot, c);
      assert.equal(c.getHex(), new THREE.Color(f.look.skin).getHex(), `${where}: ${f.id} has somebody else's face`);
    }
    assert.equal(f.skirtSlot >= 0, f.look.outfit === 'skirt', `${where}: ${f.id} has a skirt slot they do not wear`);
    assert.equal(f.hairSlot >= 0, f.look.presentation === 'woman', `${where}: ${f.id}'s hair slot`);
    if (f.skirtSlot >= 0) {
      assert.ok(inside(f.skirtSlot, k.skirts), `${where}: ${f.id}'s skirt is not drawn`);
      k.skirts.getMatrixAt(f.skirtSlot, m4);
      at.setFromMatrixPosition(m4);
      assert.deepEqual([at.x, at.z], [f.pos[0], f.pos[1]], `${where}: ${f.id}'s skirt is on somebody else`);
      k.skirts.getColorAt(f.skirtSlot, c);
      assert.equal(c.getHex(), new THREE.Color(f.look.tunic).getHex(), `${where}: ${f.id}'s skirt is somebody else's colour`);
    }
    if (hat) {
      assert.ok(inside(f.hatSlot, hat), `${where}: ${f.id}'s hat is not drawn`);
      hat.getColorAt(f.hatSlot, c);
      assert.equal(c.getHex(), new THREE.Color(f.look.hat).getHex(), `${where}: ${f.id} wears somebody else's hat`);
    }
  }
  assert.equal(parked(k.scene), 0, `${where}: an instance is parked inside a count`);
  // What a ray can hit is what is drawn: nothing when nobody is.
  assert.equal(k.view.pickables().length > 0, drawn.length > 0, `${where}: pickables and the drawn disagree`);
  k.scene.traverse((o) => {
    // One instance a person at most, except the bars in a barrow's tray (several a barrow).
    if (o.isInstancedMesh && o.name !== 'resident-barrow-gold' && o.count > drawn.length) {
      assert.fail(`${where}: ${o.name || 'a batch'} draws ${o.count} for ${drawn.length} people`);
    }
  });
}

function run(seed, { armed = false, steps = 1500 } = {}) {
  const rng = stream(seed);
  const k = crowd({ armed });
  const add = () => {
    const id = `resident:${k.made++}`;
    const [presentation, outfit] = rng.pick(KINDS);
    const f = {
      id, visible: rng.next() < 0.8, pos: [rng.int(200) - 100, rng.int(200) - 100], y: 0.25,
      yaw: 0, anim: rng.pick(ANIMS), mode: 'idle', speed: 0,
    };
    if (!k.view.enrol(f, { ...settlerLook(id, rng.pick(['sonnet', 'opus', 'haiku'])), presentation, outfit }, rng.next() < 0.3 ? 'apprentice' : 'adult')) return null;
    k.figures.set(id, f);
    return f;
  };
  const some = () => (k.figures.size ? rng.pick([...k.figures.values()]) : null);
  for (let i = 0; i < 40; i++) add();
  k.view.draw(k.figures, 0.016);
  check(k, `seed ${seed}, start`);

  for (let step = 1; step <= steps; step++) {
    const where = `seed ${seed}${armed ? ' armed' : ''}, step ${step}`;
    const r = rng.next();
    // Straight through hide(), with no draw after it: what crowd-view does when the chronicle
    // takes the crowd off the screen.
    if (r < 0.08) {
      for (let n = 1 + rng.int(6); n > 0; n--) { const f = some(); if (f && f.visible) { f.visible = false; k.view.hide(f); } }
      check(k, `${where} (hide)`);
      continue;
    }
    // Gone for good, drawn or not.
    if (r < 0.16) {
      for (let n = 1 + rng.int(4); n > 0 && k.figures.size > 1; n--) {
        const f = some();
        if (rng.next() < 0.5) f.visible = false;
        k.view.free(f);
        assert.equal(f.slot, null, `${where}: a freed figure kept its slot`);
        k.figures.delete(f.id);
      }
      check(k, `${where} (free)`);
      continue;
    }
    // Otherwise a frame: a few things change, then draw() and the check.
    const burst = rng.next() < 0.1;   // a camera sweep across NPC Distance: many at once
    for (let n = burst ? 10 + rng.int(20) : 1 + rng.int(4); n > 0; n--) {
      const f = some();
      if (!f) break;
      const what = rng.next();
      if (what < 0.45) f.visible = !f.visible;
      else if (what < 0.65) f.anim = rng.pick(ANIMS);
      else if (what < 0.8) f.pos = [f.pos[0] + rng.int(9) - 4, f.pos[1] + rng.int(9) - 4];
      else if (what < 0.88) k.view.flinch(f);
      else if (what < 0.94) k.view.drinkBeer(f);
      else k.view.strike(f);
    }
    for (let n = rng.next() < 0.2 ? 1 + rng.int(5) : 0; n > 0 && k.figures.size < 120; n--) add();
    k.view.draw(k.figures, [0.001, 0.016, 0.05, 0.4][rng.int(4)]);
    check(k, where);
  }
  k.view.dispose();
}

test('the batches stay packed and honest through thousands of random orders', () => {
  for (const seed of [1, 2, 3, 17, 4242]) run(seed);
});

test('and on an armed crowd, whose swords and torches are counted per frame', () => {
  for (const seed of [5, 23, 9001]) run(seed, { armed: true });
});

test('a crowd filled to capacity and emptied again ends where it began', () => {
  const rng = stream(77);
  const k = crowd();
  let made = 0;
  const all = [];
  for (;;) {
    const id = `resident:${made++}`;
    const [presentation, outfit] = rng.pick(KINDS);
    const f = { id, visible: true, pos: [made, -made], y: 0.25, yaw: 0, anim: 'still', mode: 'idle', speed: 0 };
    if (!k.view.enrol(f, { ...settlerLook(id, 'sonnet'), presentation, outfit }, 'adult')) break;
    k.figures.set(id, f);
    all.push(f);
  }
  assert.equal(k.figures.size, CAPACITY, 'the crowd filled up before its capacity');
  k.view.draw(k.figures, 0.016);
  check(k, 'full');
  // Half hidden, then everybody gone in a random order, then room for a whole crowd again.
  for (const f of all) if (rng.next() < 0.5) f.visible = false;
  k.view.draw(k.figures, 0.016);
  check(k, 'half hidden');
  while (all.length) {
    const f = all.splice(rng.int(all.length), 1)[0];
    k.view.free(f);
    k.figures.delete(f.id);
  }
  check(k, 'empty');
  k.scene.traverse((o) => { if (o.isInstancedMesh) assert.equal(o.count, 0, `${o.name || 'a batch'} still counts somebody`); });
  const again = { id: 'resident:again', visible: true, pos: [3, 4], y: 0.25, yaw: 0, anim: 'still', mode: 'idle', speed: 0 };
  assert.ok(k.view.enrol(again, settlerLook(again.id, 'sonnet'), 'adult'), 'the emptied crowd had no room');
  k.figures.set(again.id, again);
  k.view.draw(k.figures, 0.016);
  check(k, 'one again');
  assert.equal(again.slot, 0, 'the first slot was not the one taken');
  k.view.dispose();
});
