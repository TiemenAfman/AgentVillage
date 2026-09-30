// Everything a chest or the pirate can give has a place to be found in: a tile in the inventory.
// shared/treasure.mjs names the ids (UNLOCK_IDS), shared/equipment.mjs is the catalogue of pieces and
// shared/palette.mjs PLAYER_SWATCHES the colours; nothing else ties the three, so a reward added in
// one and forgotten in the others would be unlocked, toasted and then never appear anywhere. The
// error says which id and which list to add it to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { UNLOCK_IDS, REWARD_COLORS, REWARD_HATS, REWARD_ITEMS, SHOVEL } = await import('../shared/treasure.mjs');
const { EQUIPMENT, unlockIds, byId } = await import('../shared/equipment.mjs');
const { PLAYER_SWATCHES, PLAYER_SWATCH_PARTS, SWATCHES } = await import('../shared/palette.mjs');
const { UNLOCK_NAMES } = await import('../web/js/quest-log.js');

const swatchIds = new Set(PLAYER_SWATCHES.map((s) => s.id));
const pieceUnlocks = new Set(unlockIds());

test('every colour a chest gives is a locked tile in the palette, with the name the toast uses', () => {
  for (const c of REWARD_COLORS) {
    assert.ok(swatchIds.has(c.id), `reward colour "${c.id}" is not in PLAYER_SWATCHES (shared/palette.mjs): a chest would unlock a colour with no tile`);
    const s = PLAYER_SWATCHES.find((x) => x.id === c.id);
    assert.equal(s.name, c.name, `"${c.id}" is called "${s.name}" on its tile and "${c.name}" in the chest`);
  }
  // And the other way: no tile that no chest or quest can ever open ('sea-green' is the pirate's).
  const granted = new Set(UNLOCK_IDS);
  for (const s of PLAYER_SWATCHES) assert.ok(granted.has(s.id), `swatch "${s.id}" is in no unlock list (shared/treasure.mjs UNLOCK_IDS)`);
});

test('every hat and item a chest gives is a piece of the catalogue, and the shovel is one too', () => {
  for (const p of [...REWARD_HATS, ...REWARD_ITEMS, { id: SHOVEL }]) {
    assert.ok(pieceUnlocks.has(p.id), `reward "${p.id}" has no piece in shared/equipment.mjs whose unlock is "${p.id}"`);
    assert.ok(byId(p.id), `reward "${p.id}" is not an equipment id`);
  }
});

test('every unlock id is a colour or a piece, never both, never neither', () => {
  for (const id of UNLOCK_IDS) {
    const colour = swatchIds.has(id), piece = pieceUnlocks.has(id);
    assert.ok(colour || piece, `unlock "${id}" opens nothing: add it to PLAYER_SWATCHES or to EQUIPMENT`);
    assert.ok(!(colour && piece), `unlock "${id}" is both a colour and a piece`);
    assert.ok(UNLOCK_NAMES[id], `unlock "${id}" has no name for the toast (web/js/quest-log.js UNLOCK_NAMES)`);
  }
  assert.equal(new Set(UNLOCK_IDS).size, UNLOCK_IDS.length, 'an id listed twice');
});

test('the chest colours never enter the settlers\' palette, which they draw their faces from', () => {
  const settlerHexes = new Set(Object.values(SWATCHES).flat().map((s) => s.hex));
  for (const s of PLAYER_SWATCHES) {
    assert.ok(!settlerHexes.has(s.hex), `"${s.id}" repeats a SWATCHES colour: two tiles that look alike`);
    assert.ok(Number.isInteger(s.hex) && s.hex >= 0 && s.hex <= 0xffffff);
  }
  assert.ok(PLAYER_SWATCH_PARTS.every((p) => p in SWATCHES && p !== 'skin'), 'the tunic, trim and hat dyes take them; skin does not');
  for (const key of Object.keys(SWATCHES)) {
    assert.ok(SWATCHES[key].every((s) => !swatchIds.has(s.id)), `${key}: a chest colour leaked into SWATCHES`);
  }
});

test('nothing in the catalogue is offered as a live tile without an unlock to earn it', () => {
  for (const e of EQUIPMENT) {
    if (e.status === 'live') assert.ok(e.unlock, `live piece "${e.id}" has no unlock: it would be locked for ever or free for all`);
  }
});
