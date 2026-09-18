// A berth's scenery and a berth's garden are not this island's.
//
// props.mjs and garden.mjs used to write to one fixed path each. They now take a `file`,
// because a visiting island parked under data/guests/<id>/ has hand-placed scenery and a
// purse of its own, and neither island may write into the other's file. Every test here
// runs against a temp directory and then asserts that the REAL data/props.json and
// data/garden.json were not touched - which is the assertion this file exists for.
//
// The second one is the memoisation trap. `reach()` decides how far out to sea a jetty may
// stand, and it is worked out from the island's gridSize. A berth can be a different size
// from this island and from the berth beside it, so caching that number in a module-level
// `let` would let one island's bench be refused as off the map and the next one's be
// accepted a hundred cells out in the water. It is asserted by placing the same prop on a
// large berth, a small one, and the large one again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STARTING_PURSE } from '../shared/crops.mjs';
import { addProp, removeProp, listProps, clearProps, PROPS_FILE } from '../lib/props.mjs';
import { readGarden, gardenView, buySeed, sellCrop, holdSeed, GARDEN_FILE } from '../lib/garden.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-berth-file-'));
}

// What the real file looks like right now, or null if there is none. Compared before and
// after: this suite must be invisible to the island it is running on.
function snapshot(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

test('addProp writes the file it is given and leaves this island alone', () => {
  const dir = tempDir();
  const berth = path.join(dir, 'props.json');
  const before = snapshot(PROPS_FILE);

  const bench = addProp({ kind: 'bench', x: 5, z: -3, label: 'Elsewhere' }, { file: berth });
  assert.match(bench.id, /^prop:[0-9a-f]{8}$/);
  assert.equal(bench.kind, 'bench');

  // It is in the berth...
  const mine = listProps({ file: berth });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, bench.id);
  assert.ok(fs.existsSync(berth));

  // ...and this island neither gained a bench nor a file it did not have.
  assert.equal(snapshot(PROPS_FILE), before, 'the real props.json moved');
  assert.ok(!listProps().some((p) => p.id === bench.id), 'a berth put a bench on this island');

  // The rest of the mutators take the same option, and each one sees only its own file.
  const second = addProp({ kind: 'tree', x: 1, z: 1 }, { file: berth });
  assert.equal(listProps({ file: berth }).length, 2);
  assert.equal(removeProp(second.id, { file: berth }).id, second.id);
  assert.equal(removeProp(second.id, { file: berth }), null, 'unbuilding twice was not a no-op');
  assert.equal(listProps({ file: berth }).length, 1);
  assert.equal(clearProps({ file: berth }), 1);
  assert.deepEqual(listProps({ file: berth }), []);

  assert.equal(snapshot(PROPS_FILE), before, 'the real props.json moved');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('two berths of two sizes do not share a memoised reach', () => {
  const dir = tempDir();
  const big = path.join(dir, 'big.json');
  const small = path.join(dir, 'small.json');
  const before = snapshot(PROPS_FILE);

  // gridSize 256 reaches 128 + 20; gridSize 16 reaches 8 + 20. A buoy a hundred cells out
  // belongs to the first island and not to the second.
  const out = { kind: 'buoy', x: 100, z: 0 };

  assert.ok(addProp(out, { file: big, gridSize: 256 }).id, 'a 256-cell island refused its own buoy');
  assert.throws(() => addProp(out, { file: small, gridSize: 16 }), /off the map/, 'a 16-cell island accepted a buoy a hundred cells out');
  // And back again - the order is the point. If the edge were remembered from either of
  // the two calls above, one of these three lines would be wrong.
  assert.ok(addProp(out, { file: big, gridSize: 256 }).id, 'the big island lost its reach to the small one');
  assert.throws(() => addProp(out, { file: small, gridSize: 16 }), /off the map/);

  assert.equal(listProps({ file: big }).length, 2);
  assert.equal(listProps({ file: small }).length, 0);
  assert.ok(!fs.existsSync(small), 'a refused prop created a file anyway');
  assert.equal(snapshot(PROPS_FILE), before, 'the real props.json moved');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a berth keeps its own purse, pouch and basket', () => {
  const dir = tempDir();
  const berth = path.join(dir, 'garden.json');
  const before = snapshot(GARDEN_FILE);

  // A garden nobody has opened yet is the town hall's starting coins, which is what makes
  // this a fair test of "the berth read its own file" rather than of the real one.
  assert.equal(readGarden({ file: berth }).purse, STARTING_PURSE);

  const bought = buySeed('turnip', 3, { file: berth });
  assert.equal(bought.count, 3);
  assert.equal(bought.purse, STARTING_PURSE - 3 * 2);
  assert.equal(readGarden({ file: berth }).seeds.turnip, 3);
  assert.equal(holdSeed('turnip', { file: berth }).held, 'turnip');

  // The purse will not stretch to fifty pumpkins, and says so rather than going negative.
  assert.throws(() => buySeed('pumpkin', 50, { file: berth }), /the purse holds/);
  assert.ok(readGarden({ file: berth }).purse >= 0);

  // Selling out of an empty basket is refused, not invented.
  assert.throws(() => sellCrop('carrot', 1, { file: berth }), /no carrots in the basket/);

  // gardenView takes the same option and reports the berth, not this island.
  const view = gardenView({ file: berth });
  assert.equal(view.purse, STARTING_PURSE - 6);
  assert.deepEqual(view.beds, []);

  assert.equal(snapshot(GARDEN_FILE), before, 'the real garden.json moved');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every existing caller keeps working without an options object', () => {
  // The whole point of the defaults: serve.mjs and tools/island.mjs pass nothing, and
  // nothing about them changed. These are reads only - this suite never writes to data/.
  const before = { props: snapshot(PROPS_FILE), garden: snapshot(GARDEN_FILE) };
  assert.ok(Array.isArray(listProps()));
  assert.ok(Number.isFinite(readGarden().purse));
  assert.ok(Number.isFinite(gardenView().purse));
  assert.equal(snapshot(PROPS_FILE), before.props);
  assert.equal(snapshot(GARDEN_FILE), before.garden);
});
