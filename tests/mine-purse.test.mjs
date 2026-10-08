// The gold mine's money (Plans/goudmijn-zoektocht.md): stones and draughts kept in the garden's
// purse file (lib/garden.mjs), each op on a file of its own so the island's own garden.json is never
// touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STARTING_PURSE } from '../shared/crops.mjs';
import { GEMS, POTION_PRICE, POTION_MAX, GEMS_A_DAY } from '../shared/mine.mjs';
import { readGarden, gardenView, findGem, sellGems, buyPotion, drinkPotion, buySeed } from '../lib/garden.mjs';

const fresh = () => ({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-mine-')), 'garden.json') });

test('a stone dug is kept, and the goldsmith pays his fixed price for every one', () => {
  const o = fresh();
  findGem('quartz', 10, o);
  findGem('quartz', 10, o);
  findGem('garnet', 10, o);
  assert.deepEqual(readGarden(o).gems, { quartz: 2, garnet: 1 });
  assert.deepEqual(gardenView(o).gems, { quartz: 2, garnet: 1 });
  const price = (id) => GEMS.find((g) => g.id === id).price;
  const r = sellGems(o);
  assert.equal(r.paid, 2 * price('quartz') + price('garnet'));
  assert.equal(r.purse, STARTING_PURSE + r.paid);
  assert.deepEqual(readGarden(o).gems, {});
  assert.throws(() => sellGems(o), /no stones/);
  assert.throws(() => findGem('ruby-from-nowhere', 10, o), /no stone/);
  assert.throws(() => findGem('quartz', 'yesterday', o), /day/);
});

test('a draught costs from the purse, is kept until drunk, and a satchel holds only so many', () => {
  const o = fresh();
  assert.throws(() => drinkPotion(o), /no draught/);
  const r = buyPotion(o);
  assert.equal(r.purse, STARTING_PURSE - POTION_PRICE);
  assert.equal(readGarden(o).potions, 1);
  assert.throws(() => buyPotion(o), /coins/, 'the purse is short now');
  assert.equal(drinkPotion(o).potions, 0);
  // And the seed stall's purse is the same purse.
  for (let i = 0; i < 40; i++) findGem('amethyst', 1, o);
  sellGems(o);
  for (let i = 0; i < POTION_MAX; i++) buyPotion(o);
  assert.throws(() => buyPotion(o), /satchel/);
  buySeed('turnip', 1, o);
});

test('the stones a day have a ceiling, and a new day starts it again', () => {
  const o = fresh();
  for (let i = 0; i < GEMS_A_DAY; i++) findGem('quartz', 5, o);
  assert.throws(() => findGem('quartz', 5, o), /today/);
  findGem('quartz', 6, o);
});

test('a garden from before the mine reads as no stones and no draughts', () => {
  const o = fresh();
  fs.writeFileSync(o.file, JSON.stringify({ v: 1, purse: 40, seeds: {}, basket: {}, beds: [] }));
  const g = readGarden(o);
  assert.deepEqual(g.gems, {});
  assert.equal(g.potions, 0);
  assert.equal(g.purse, 40);
});
