import test from 'node:test';
import assert from 'node:assert/strict';
// The same preamble as inventory.test.mjs: avatar.js reaches shared/, classic-avatar.js
// reaches buildings.js, which starts a TextureLoader at import time.
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { EQUIPMENT, SLOTS, byId, liveOf, unlockIds, unlockOf } = await import('../shared/equipment.mjs');
const { QUESTS } = await import('../shared/quests.mjs');
const { HAND_ITEMS, PLAYER_HAT_SHAPES, DEFAULT_AVATAR, normalizeAvatar } = await import('../web/js/avatar.js');
const { heldItemGeometry } = await import('../web/js/classic-avatar.js');
const { hatParts } = await import('../web/js/inventory.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

const live = EQUIPMENT.filter((e) => e.status === 'live');
const planned = EQUIPMENT.filter((e) => e.status === 'planned');

test('the catalogue is well formed', () => {
  assert.equal(new Set(EQUIPMENT.map((e) => e.id)).size, EQUIPMENT.length, 'ids are unique');
  for (const e of EQUIPMENT) {
    assert.ok(SLOTS.includes(e.slot), `${e.id}: slot ${e.slot}`);
    assert.ok(['live', 'planned'].includes(e.status), `${e.id}: status`);
    assert.ok(e.name && typeof e.name === 'string', `${e.id}: name`);
    assert.ok(e.unlock && typeof e.unlock === 'string', `${e.id}: unlock`);
    assert.equal(byId(e.id), e);
    assert.equal(unlockOf(e.id), e.unlock);
  }
  assert.ok(live.some((e) => e.id === 'shovel' && e.slot === 'hand'), 'the shovel is live');
  for (const id of ['tricorn', 'bandana', 'eyepatch', 'beard', 'hook', 'peg-leg', 'parrot', 'spyglass']) {
    assert.equal(byId(id)?.status, 'planned', id);
  }
  assert.deepEqual(liveOf('hand').map((e) => e.id), live.filter((e) => e.slot === 'hand').map((e) => e.id));
  assert.deepEqual(liveOf('face'), []);
  assert.ok(unlockIds().includes('shovel'));
  assert.equal(new Set(unlockIds()).size, unlockIds().length);
  // What the look never had to unlock is nobody's to unlock.
  assert.equal(unlockOf('sword'), null);
  assert.equal(unlockOf('nonsense'), null);
});

// The whole point of `live`: a piece the picker offers has something to draw it.
test('every live piece has a drawing function', () => {
  for (const e of live) {
    assert.ok(e.render, `${e.id}: render`);
    if (e.slot === 'hand') {
      const g = heldItemGeometry(e.render, DEFAULT_AVATAR);
      assert.ok(g && g.attributes.position.count > 0, `${e.id}: no held geometry for "${e.render}"`);
      for (const name of ['normal', 'color', 'aSheet']) {
        assert.equal(g.attributes[name]?.count, g.attributes.position.count, `${e.id}: ${name}`);
      }
    } else if (e.slot === 'head') {
      assert.ok(hatParts(e.id).length > 0, `${e.id}: no baked hat variant`);
    } else {
      assert.fail(`${e.id}: nothing draws a live "${e.slot}" piece yet`);
    }
  }
});

test('the look accepts exactly the live pieces of a slot, and never a planned one', () => {
  for (const e of liveOf('hand')) assert.ok(HAND_ITEMS.some((h) => h.id === e.id), e.id);
  for (const e of liveOf('head')) assert.ok(PLAYER_HAT_SHAPES.some((h) => h.id === e.id), e.id);
  for (const e of planned) {
    assert.ok(!HAND_ITEMS.some((h) => h.id === e.id), `${e.id} in HAND_ITEMS`);
    assert.ok(!PLAYER_HAT_SHAPES.some((h) => h.id === e.id), `${e.id} in PLAYER_HAT_SHAPES`);
  }
  // Wide, not filtered on what the wearer owns (a forged look is only decor)...
  const look = normalizeAvatar({ equip: { rightHandItem: 'shovel', leftHandItem: 'spyglass' }, hatShape: 'tricorn' });
  assert.equal(look.equip.rightHandItem, 'shovel');
  // ...but a piece nobody can draw yet is nothing.
  assert.equal(look.equip.leftHandItem, null);
  assert.equal(look.hatShape, DEFAULT_AVATAR.hatShape);
  // The pieces from before unlocking are all still there, in order, ahead of the new ones.
  assert.deepEqual(HAND_ITEMS.slice(0, 6).map((h) => h.id), ['parasol', 'hammer', 'sword', 'shield', 'torch', 'beer']);
  for (const h of HAND_ITEMS) assert.ok(h.name && h.icon, h.id);
});

// The quests promise the pieces: a live piece nothing hands out is a tile nobody can open.
test('every live piece is handed out by a quest', () => {
  const granted = new Set();
  for (const q of QUESTS) {
    for (const st of q.steps) for (const u of st.grant?.unlock || []) granted.add(u);
    for (const u of q.reward?.unlock || []) granted.add(u);
  }
  for (const e of live) assert.ok(granted.has(e.unlock), `${e.id}: no quest grants "${e.unlock}"`);
});
