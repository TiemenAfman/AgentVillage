import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { publishWorld } from '../lib/world/publish.mjs';
import { growWorld, isletsWanted, isletSpecs, MAIN } from '../lib/world/growth.mjs';

// The island grows. These guard the three properties the whole mechanism rests on, and all
// three are the kind that break silently: nothing looks wrong on the scan they break, and a
// fortnight later a hamlet is under water or the village has re-founded itself twice.
//
//   deterministic - the same village always publishes the same set
//   monotone      - more settlers never publishes fewer chunks
//   sticky        - a chunk once published is never taken back

const ENVELOPE = 768;             // the smallest window that holds all sixteen skerries
const RADIUS = 148;
const SEED = 1337;

let baked = null;                 // a published world, copied per test rather than re-baked

test.before(() => {
  baked = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-grow-'));
  publishWorld(SEED, baked, { envelopeM: ENVELOPE, radiusM: RADIUS });
});
test.after(() => { if (baked) fs.rmSync(baked, { recursive: true, force: true }); });

/** A fresh copy of the founding world, so a test can grow it without disturbing the others. */
function island() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-island-'));
  fs.cpSync(baked, dir, { recursive: true });
  return dir;
}
const manifestOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const chunkSet = (m) => new Set(m.chunks.map((c) => `${c.cx},${c.cz},${c.hash}`));

test('the ladder is a pure function, and it only ever climbs', () => {
  // No island needed: this is the trigger on its own, and it is where determinism and
  // monotonicity actually live. Everything below only checks that publishing honours it.
  let last = 0;
  for (let settlers = 0; settlers <= 600; settlers++) {
    for (let hamlets = 0; hamlets <= 20; hamlets++) {
      const a = isletsWanted({ settlers, hamlets });
      assert.equal(a, isletsWanted({ settlers, hamlets }), 'the same village asked twice');
      assert.ok(a >= isletsWanted({ settlers: settlers - 1, hamlets }), `settler ${settlers} lost an islet`);
      assert.ok(a >= isletsWanted({ settlers, hamlets: hamlets - 1 }), `hamlet ${hamlets} lost an islet`);
    }
    const here = isletsWanted({ settlers, hamlets: 0 });
    assert.ok(here >= last, `settlers ${settlers} publishes less than ${settlers - 1}`);
    last = here;
  }
  assert.equal(isletsWanted({ settlers: 0, hamlets: 0 }), 0, 'a founding village is the mainland only');
});

test('a founding publishes the mainland and nothing else', () => {
  const m = manifestOf(baked);
  const atlas = JSON.parse(fs.readFileSync(path.join(baked, 'atlas.json'), 'utf8'));
  assert.deepEqual(m.islets, [], 'the archipelago was above water on day one');
  assert.ok(m.chunks.length > 0, 'nothing was published at all');
  assert.ok(m.chunks.length < atlas.chunks.length, 'the whole envelope was published at founding');
  assert.ok(m.chunks.some((c) => c.maxY > 0), 'the mainland is not in the founding world');
  // Every chunk the atlas names is on disk from the first scan, published or not. That is
  // what makes growing free: there is nothing left to generate.
  for (const c of atlas.chunks) {
    const file = path.join(baked, 'chunk', `${c.cx}_${c.cz}.${c.hash}.bin`);
    assert.ok(fs.existsSync(file), `${path.basename(file)} was baked but not written`);
  }
  // Sixteen rocks are baked and every one of them has to survive as its own landmass, or the
  // ladder runs out of rocks long before the village runs out of repositories. Fourteen is the
  // floor the placement rule promises; see `world-skerries.test.mjs` for what it costs.
  assert.ok(atlas.islets.length >= 14, `only ${atlas.islets.length} islets baked - is this window too small?`);
});

test('the same village publishes the same island', () => {
  const a = island(), b = island();
  try {
    const model = { settlers: 140, hamlets: 7 };
    const one = growWorld(a, model).manifest;
    const two = growWorld(b, model).manifest;
    assert.deepEqual(two.islets, one.islets);
    assert.equal(two.worldRev, one.worldRev, 'two islands of the same village disagree');
    assert.deepEqual(
      two.chunks.map((c) => `${c.cx},${c.cz},${c.hash}`),
      one.chunks.map((c) => `${c.cx},${c.cz},${c.hash}`));

    // And the order a village arrives in decides nothing: growing in one step must land on
    // the same island as growing through every step before it.
    const c = island();
    try {
      for (let settlers = 0; settlers <= model.settlers; settlers += 7) {
        growWorld(c, { settlers, hamlets: Math.min(model.hamlets, Math.floor(settlers / 20)) });
      }
      growWorld(c, model);
      assert.equal(manifestOf(c).worldRev, one.worldRev, 'the island remembers how it got here');
    } finally {
      fs.rmSync(c, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test('more settlers never publishes fewer chunks', () => {
  const dir = island();
  try {
    let previous = chunkSet(manifestOf(dir));
    for (const settlers of [0, 10, 29, 30, 60, 75, 120, 200, 300, 900]) {
      growWorld(dir, { settlers, hamlets: 0 });
      const now = chunkSet(manifestOf(dir));
      for (const c of previous) assert.ok(now.has(c), `${settlers} settlers dropped chunk ${c}`);
      assert.ok(now.size >= previous.size);
      previous = now;
    }
    assert.ok(previous.size > chunkSet(manifestOf(baked)).size, 'the island never grew at all');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a chunk once published is never taken back', () => {
  // The case this is really about: a project gets archived, or a run of sessions is banished,
  // and the settler count falls. The sea must not close over a hamlet that is standing.
  const dir = island();
  try {
    growWorld(dir, { settlers: 300, hamlets: 12 });
    const grown = manifestOf(dir);
    assert.ok(grown.islets.length > 0, 'nothing was published to lose');

    for (const model of [{ settlers: 1, hamlets: 0 }, { settlers: 0, hamlets: 0 }]) {
      const back = growWorld(dir, model);
      assert.equal(back.added, 0, 'a shrinking village rewrote the manifest');
      assert.deepEqual(manifestOf(dir).islets, grown.islets);
      assert.deepEqual(chunkSet(manifestOf(dir)), chunkSet(grown));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('growing the island never changes the ground already under it', () => {
  // The promise chunks exist for: the bytes a house stands on are written once. A chunk that
  // changed its hash would be a different piece of ground under the same name.
  const dir = island();
  try {
    const before = manifestOf(dir);
    const was = new Map(before.chunks.map((c) => [`${c.cx},${c.cz}`, c.hash]));
    growWorld(dir, { settlers: 400, hamlets: 14 });
    const after = manifestOf(dir);
    for (const c of after.chunks) {
      if (!was.has(`${c.cx},${c.cz}`)) continue;
      assert.equal(c.hash, was.get(`${c.cx},${c.cz}`), `chunk ${c.cx},${c.cz} was rewritten`);
    }
    assert.equal(after.bakeRev, before.bakeRev, 'the ground changed revision because it grew');
    assert.notEqual(after.worldRev, before.worldRev, 'a grown island kept the client cache key');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an islet is a landmass of its own, named by its skerry', () => {
  const dir = island();
  try {
    growWorld(dir, { settlers: 900, hamlets: 20 });
    const m = manifestOf(dir);
    const islets = m.landmasses.filter((l) => Number.isInteger(l.islet));
    assert.equal(islets.length, m.islets.length, 'a published islet has no landmass, or the other way round');
    assert.equal(new Set(islets.map((l) => l.islet)).size, islets.length, 'two islets share an index');
    for (const l of islets) assert.ok(l.index > 0, 'the mainland was published as an islet');
    assert.ok(m.landmasses.some((l) => l.index === 0 && l.islet === undefined), 'the mainland lost itself');

    const specs = isletSpecs(m);
    assert.equal(specs.length, islets.length);
    assert.deepEqual(specs.map((s) => s.index), [...specs.map((s) => s.index)].sort((a, b) => a - b),
      'the islets are handed out in some order other than their own');
    assert.ok(specs.every((s) => s.index !== MAIN));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a world with no atlas is left alone rather than half-grown', () => {
  // A world baked by an older generator has no atlas to grow into. `ensureWorld` re-bakes it
  // on `worldV`, but growWorld must not throw in the meantime, or a scan dies on a stale
  // data directory instead of replacing it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-old-'));
  try {
    assert.equal(growWorld(dir, { settlers: 100, hamlets: 5 }), null);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ worldV: 2, chunks: [] }));
    assert.equal(growWorld(dir, { settlers: 100, hamlets: 5 }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
