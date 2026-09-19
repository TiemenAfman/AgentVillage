// A tree planted on one island, seen from another - without redrawing a coastline.
//
// This is the seam the plan called "the stille prijs": a bundle is a snapshot and live is
// a stream, and the two do not combine for free. A republish is two hundred kilobytes,
// makes every viewer drop a region and build its ground and its buildings again, and -
// since the sea walks the crowd - sends every settler on that island back to their own
// front door. For one tree that is absurd, so what is standing on an island gets a door of
// its own.
//
// The three things that have to hold are all "what did NOT happen": rev did not move, the
// crowd was not rebuilt, and nothing from the wire was kept without going through the
// whitelist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { SEA_V, afloat, island, post, talk } = await import('./support/sea.mjs');
const { parseParcel, packParcel } = await import('../lib/islandbundle.mjs');

const TREE = { id: 'aabbccdd', kind: 'tree', x: 3, z: -4, rot: 0 };
// A bed is a prop-shaped thing with a world position, and `crop` is which one it is
// by number, not by name - see `crop` in lib/islandbundle.mjs.
const BED = { id: 'ddccbbaa', kind: 'bed', x: -6, z: 8, crop: 3 };

test('what is standing on an island travels without the island travelling with it', async () => {
  await afloat(async ({ sea, base, wsUrl }) => {
    const a = island();
    const first = await (await post(base, `/island/${a.id}`, a.bundle)).json();

    const watcher = talk(wsUrl);
    await watcher.ready;
    watcher.say({ t: 'join', v: SEA_V, as: 'client', island: null, name: 'Someone' });
    await watcher.until((m) => m.t === 'welcome');

    // The bodies themselves, by identity. A rebuild makes new ones and stands them all back
    // at their own front door, so this is the assertion with teeth - comparing positions
    // would only measure how long the test took, because the sea's beat runs while it does.
    const crowd = sea.crowds.get(a.id);
    const before = new Map([...crowd.figures.values()].map((f) => [f.id, f]));
    const where = new Map([...before].map(([id, f]) => [id, [f.pos[0], f.pos[1]]]));
    assert.ok(before.size > 1, 'the fixture village has nobody in it');

    const r = await post(base, `/island/${a.id}/parcel`, packParcel({ props: [TREE], crops: [BED], gridSize: 64 }));
    assert.equal(r.status, 200);

    const said = await watcher.until((m) => m.t === 'island' && m.a === 'parcel');
    assert.equal(said.i, a.id);
    assert.equal(said.props.length, 1);
    assert.equal(said.props[0].kind, 'tree');
    assert.equal(said.crops.length, 1);

    // The island is what it was. `rev` moving is what makes every viewer fetch and rebuild
    // it, and the whole point of this door is that it does not.
    assert.equal(sea.fleet.get(a.id).rev, first.rev, 'a planted tree bumped the island’s rev');

    // The same crowd, in the same places. A rebuild would put everybody back at their door
    // and would be invisible in a screenshot taken a second later.
    assert.equal(sea.crowds.get(a.id), crowd, 'the crowd was rebuilt for a tree');
    for (const f of crowd.figures.values()) {
      assert.equal(before.get(f.id), f, `${f.id} is a different body than before the tree`);
      // And they carried on from where they were, rather than being put back. A rebuild is
      // a jump to the doorstep; a beat or two of strolling is a fraction of a cell.
      const was = where.get(f.id);
      assert.ok(Math.hypot(f.pos[0] - was[0], f.pos[1] - was[1]) < 1,
        `${f.id} jumped from ${was} to ${f.pos}`);
    }

    // And somebody arriving later gets the tree with the island, not separately.
    const late = await (await fetch(`${base}/island/${a.id}`)).json();
    assert.equal(late.props.length, 1);
    assert.equal(late.crops.length, 1);

    watcher.close();
    await watcher.closed;
  });
});

test('the parcel door is a door in the hull, and is treated like one', async () => {
  await afloat(async ({ base }) => {
    const a = island();
    await post(base, `/island/${a.id}`, a.bundle);

    // An island nobody has heard of.
    assert.equal((await post(base, '/island/0123456789abcdef/parcel', { props: [] })).status, 404);

    // Somebody else's island, once it has a token on it. Published untokened above, so
    // this one is claimed first and then written to with the wrong key.
    const b = island({ port: 4748, name: 'Buurholm' });
    await post(base, `/island/${b.id}`, b.bundle, 'the-right-key');
    assert.equal((await post(base, `/island/${b.id}/parcel`, { props: [] }, 'the-wrong-key')).status, 409);
    assert.equal((await post(base, `/island/${b.id}/parcel`, { props: [] }, 'the-right-key')).status, 200);

    // And rubbish is refused rather than stored.
    assert.equal((await post(base, `/island/${a.id}/parcel`, { props: 'a forest' })).status, 400);
  });
});

test('a parcel is rebuilt field by field, like everything else off a wire', () => {
  // Packed the way the islander packs it, and then two fields nobody whitelisted stuffed
  // in - which is what a bundle from a machine running other code looks like.
  const dirty = packParcel({ props: [TREE], crops: [BED], gridSize: 64 });
  dirty.props[0].keeper = 'Martijn';
  dirty.props[0].cwd = 'D:\git\AgentVillage';
  const clean = parseParcel(dirty, { gridSize: 64 });
  assert.equal(clean.props.length, 1);
  assert.equal(clean.props[0].kind, 'tree');
  assert.equal(clean.props[0].keeper, undefined, 'a field nobody whitelisted came through');
  assert.equal(clean.props[0].cwd, undefined);

  // The caps are the bundle's own, so a parcel cannot be the way somebody gets round them.
  // Refused outright rather than quietly trimmed, which is what `strict` means here.
  assert.throws(
    () => parseParcel({ props: Array.from({ length: 900 }, (_, i) => ({ ...TREE, id: String(i).padStart(8, '0') })) }, { gridSize: 64 }),
    /more than the 500/,
  );

  // Missing is empty, not a crash: an island with nothing on it patches to nothing on it.
  assert.deepEqual(parseParcel({}, { gridSize: 64 }), { props: [], crops: [] });
  assert.throws(() => parseParcel(null, { gridSize: 64 }));
  assert.throws(() => parseParcel([TREE], { gridSize: 64 }));

  // And the keys a bundle refuses outright. Parsed rather than written as a literal,
  // because `__proto__:` in source sets the prototype instead of making a key.
  assert.throws(() => parseParcel(JSON.parse('{"props":[],"__proto__":{"x":1}}'), { gridSize: 64 }));
});

test('a raw prop is packed before it is sent, or it is refused whole', async () => {
  // The failure this is here for: props.json carries only what whoever built a thing gave
  // it, and `scale` is usually not among them. buildBundle has always filled that in with
  // the forgiving context; the parcel door is strict, like every other door in the hull,
  // so an unpacked prop comes back as "a measurement arrived as something that is not a
  // number" and the tree silently never appears anywhere else.
  const raw = { id: 'aabbccdd', kind: 'tree', x: 3, z: -4 };
  assert.throws(() => parseParcel({ props: [raw] }, { gridSize: 64 }), /not a number/);

  const packed = packParcel({ props: [raw], gridSize: 64 });
  assert.equal(packed.props[0].scale, 1, 'packing did not fill the missing field in');
  assert.doesNotThrow(() => parseParcel(packed, { gridSize: 64 }));

  // And over the wire, which is the only place it matters.
  await afloat(async ({ base }) => {
    const a = island();
    await post(base, `/island/${a.id}`, a.bundle);
    assert.equal((await post(base, `/island/${a.id}/parcel`, { props: [raw] })).status, 400);
    assert.equal((await post(base, `/island/${a.id}/parcel`, packed)).status, 200);
  });
});
