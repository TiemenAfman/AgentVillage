import test from 'node:test';
import assert from 'node:assert/strict';
// The same preamble as avatar.test.mjs: avatar.js reaches shared/palette.mjs, and
// classic-avatar.js reaches buildings.js, which starts a TextureLoader at import time.
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { DEFAULT_AVATAR, PLAYER_HAT_SHAPES, HAND_ITEMS, SWATCHES } = await import('../web/js/avatar.js');
const { EQUIPMENT, byId, unlockOf } = await import('../shared/equipment.mjs');
const { SETTLER_PARTS } = await import('../web/js/settler-mesh.js');
const { INVENTORY_SLOTS, INVENTORY_FLASKS, slotIcon, optionIcon, iconDyes, iconKey, iconGeometry } =
  await import('../web/js/inventory.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

const slot = (id) => INVENTORY_SLOTS.find((s) => s.id === id);

// The point of keeping the table out of studio.js: a piece added to the spec has to be given
// a slot, and a swatch row has to be given a dye button, or these fail rather than the screen
// quietly showing less than the settler wears.
test('every equip key is owned by exactly one slot', () => {
  const owned = INVENTORY_SLOTS.map((s) => s.equip).filter(Boolean);
  assert.deepEqual([...owned].sort(), Object.keys(DEFAULT_AVATAR.equip).sort());
  assert.equal(new Set(owned).size, owned.length);
});

test('every swatch part is owned by exactly one dye control', () => {
  const dyes = [...INVENTORY_SLOTS.map((s) => s.dye), ...INVENTORY_FLASKS.map((f) => f.dye)].filter(Boolean);
  assert.deepEqual([...dyes].sort(), Object.keys(SWATCHES).sort());
});

test('picker options are the ids the spec accepts', () => {
  assert.deepEqual(slot('head').options.map((o) => o.id), PLAYER_HAT_SHAPES.map((h) => h.id));
  for (const id of ['lefthand', 'righthand']) {
    assert.deepEqual(slot(id).options.map((o) => o.id), ['', ...HAND_ITEMS.map((h) => h.id)]);
  }
});

// The catalogue (shared/equipment.mjs) decides what a picker offers: a live piece is a tile in
// the picker of its slot (the unlock id is the tile the quest opens), and a planned one is in
// none - it has nothing to draw, so a tile for it would render an empty well.
test('every live piece is a tile, and no planned piece is in any picker', () => {
  const pickers = { hand: ['lefthand', 'righthand'], head: ['head'] };
  for (const e of EQUIPMENT.filter((p) => p.status === 'live')) {
    const ids = pickers[e.slot];
    assert.ok(ids, `${e.id}: no picker for slot ${e.slot}`);
    for (const id of ids) {
      assert.ok(slot(id).options.some((o) => o.id === e.id), `${e.id} missing from ${id}`);
      assert.ok(optionIcon(slot(id), e.id).item || optionIcon(slot(id), e.id).shape, `${e.id}: no icon`);
    }
  }
  for (const e of EQUIPMENT.filter((p) => p.status === 'planned')) {
    for (const s of INVENTORY_SLOTS) {
      assert.ok(!(s.options || []).some((o) => o.id === e.id), `${e.id} is planned but in ${s.id}`);
    }
  }
});

test('a locked piece is a tile like any other, and the unlock id it waits for is a real one', () => {
  // The picker locks by the catalogue's unlock id (studio.js): every tile that can be locked
  // must name an unlock a quest can hand out, and every other tile must be free for all.
  const lockable = new Set(EQUIPMENT.filter((e) => e.status === 'live').map((e) => e.id));
  for (const s of INVENTORY_SLOTS.filter((x) => x.options)) {
    for (const o of s.options) {
      if (lockable.has(o.id)) assert.ok(unlockOf(o.id), `${o.id}: locked with no unlock id`);
      else assert.equal(unlockOf(o.id), null, `${o.id}: locked but not in the catalogue as live`);
    }
  }
  assert.ok(byId('shovel').hint, 'a locked tile says where the piece comes from');
});

test('icon part lists name only baked parts', () => {
  const names = new Set(SETTLER_PARTS.map((p) => p.name));
  for (const s of INVENTORY_SLOTS) {
    for (const name of [...(s.parts || []), ...(s.ghost || [])]) assert.ok(names.has(name), `${s.id}: ${name}`);
  }
});

// Renders every slot as worn by default and every tile of every picker. The hat tiles are the
// ones this guards: buildFigure only keeps a hat's parts when spec.hatShape names its variant,
// so a tile for a hat you are not wearing comes out empty unless iconGeometry forces the shape.
test('every slot and every picker tile renders a non-empty geometry with the material contract', () => {
  for (const s of INVENTORY_SLOTS) {
    const icons = [slotIcon(s, DEFAULT_AVATAR), ...(s.options || []).map((o) => optionIcon(s, o.id))];
    for (const icon of icons) {
      const g = iconGeometry(icon, DEFAULT_AVATAR);
      assert.ok(g.attributes.position.count > 0, icon.id);
      for (const name of ['normal', 'color', 'aSheet']) {
        assert.equal(g.attributes[name]?.count, g.attributes.position.count, `${icon.id}: ${name}`);
      }
      g.dispose();
    }
  }
});

test('an icon goes stale on exactly the colours its parts read', () => {
  const hand = slot('righthand'), head = slot('head');
  const sword = optionIcon(hand, 'sword'), hammer = optionIcon(hand, 'hammer'), ghost = optionIcon(hand, '');
  assert.deepEqual(iconDyes(sword), ['trim']);      // the grip
  assert.deepEqual(iconDyes(hammer), []);           // procedural, fixed colours
  assert.deepEqual(iconDyes(ghost), ['skin']);      // an empty hand is a hand
  assert.deepEqual(iconDyes(optionIcon(head, 'helmet')), []);            // steel and brass
  assert.deepEqual(iconDyes(optionIcon(head, 'wide')), ['trim', 'hat']); // straw plus its ribbon
  assert.deepEqual(iconDyes(slotIcon(slot('tunic'), DEFAULT_AVATAR)), ['tunic', 'trim']);
  assert.notEqual(iconKey(sword, DEFAULT_AVATAR), iconKey(sword, { ...DEFAULT_AVATAR, trim: 0x111111 }));
  assert.equal(iconKey(sword, DEFAULT_AVATAR), iconKey(sword, { ...DEFAULT_AVATAR, hat: 0x111111 }));
});

test('the outfit thumbnail includes the chosen waistcoat, pouch and shirt sleeves', () => {
  const names = slot('tunic').parts;
  for (const part of ['Fitted waistcoat', 'Fitted waistcoat.001', 'Belt pouch', 'Tailored linen tunic', 'Left continuous sleeve', 'Right continuous sleeve']) {
    assert.ok(names.includes(part), part);
  }
  assert.ok(!names.includes('Backpack'), 'removable pack must stay in its own slot');
  assert.ok(!names.includes('Head'), 'outfit must not contain the face');
});
