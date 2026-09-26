// Every island's story animals, walked by the sea (docs/animals-wire.md, Plans/dierenverhalen.md).
//
// The same place in the design as lib/crowd.mjs holds for the settlers: the islander says who
// the animals are and what it would like them to do (POST /island/:id/animals, parsed strictly
// by lib/animalbundle.mjs), and this file walks them - shared/animalwalk.mjs, unwrapped - and
// says where they are. Everything is in memory and follows from the last body each islander
// sent, like the rest of the sea: a restart is an island with no animals until its islander
// reconnects and posts again, which it does on every welcome.
//
// What it deliberately does not do is what lib/crowd.mjs does on every publish: rebuild.
// A herd is reconciled, never rebuilt. A settler put back at their own door by a republish is
// where they spend most of their life anyway; a hen half-way to somebody's doorstep who is
// suddenly back on her own patch, once a minute while anybody works, is a hen who never gets
// anywhere. So a POST changes who is in the herd by id (shared/animalwalk.mjs `set`), and an
// island republishing - a new terrain object on the fleet's row, which a house built, a polder
// drained or a coast grown all make - only swaps the ground and the walls under her feet.
//
// And the one thing that crosses back to the islander: an errand finished. The walk reports
// the action id; this file puts the POST's generation on it (docs/animals-wire.md,
// "Completion") and keeps the last DONE_MEMORY ids per island, because the islander posts
// every pending action again on each reconnect - and an action that finished while it was
// away must be answered again, not walked again.
import { createAnimalWalk, animalRow, DT } from '../shared/animalwalk.mjs';

// How many finished action ids each island remembers. Six animals with an errand each every
// few minutes finish far fewer than this between two reconnects; the number is the
// contract's.
export const DONE_MEMORY = 32;

// Every building's plot, as the cells nobody walks into. A plot is `gx..gx+w-1` by
// `gz..gz+d-1` in the island's own grid (lib/islandbundle.mjs `plot`), keyed the way
// shared/settlerwalk.mjs findPath keys a cell: `gx + gz * size`. Out of the bundle the fleet
// holds, which parseBundle has already rebuilt - so every number in it is a whole number on
// the grid it declared.
export function blockedOf(island) {
  const out = new Set();
  const size = island.terrain.size;
  for (const b of (island.bundle && island.bundle.buildings) || []) {
    const p = b && b.plot;
    if (!p) continue;
    const w = p.w || 1, d = p.d || 1;
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const gx = p.gx + x, gz = p.gz + z;
        if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
        out.add(gx + gz * size);
      }
    }
  }
  return out;
}

// One clock over every herd, for lib/crowd.mjs createCrowds' reason: they all step the same
// whole ticks at the same moment. A second accumulator beside the crowds' rather than a share
// of it, because a herd has no business in that file and a tick count is cheap to keep twice.
export function createHerds({ fleet, now = () => Date.now(), maxTicksPerBeat = 8 } = {}) {
  const herds = new Map();       // island id -> herd
  let last = now();
  let owed = 0;
  let ticks = 0;
  let completed = [];            // [{ island, action, gen }], drained by completions()

  // The ground under a herd, brought up to date with the island as the fleet holds it now.
  // Identity, not content: the fleet builds a new terrain on every publish, so a changed
  // object is exactly "the island republished", and the walls are worked out again with it
  // because the buildings came in the same bundle.
  function reground(h, island) {
    if (!island || h.terrain === island.terrain) return false;
    h.terrain = island.terrain;
    h.walk.setGround(island.terrain, blockedOf(island));
    return true;
  }

  function remember(h, id) {
    if (h.finished.includes(id)) return;
    h.finished.push(id);
    if (h.finished.length > DONE_MEMORY) h.finished.shift();
  }

  // What one islander says its herd is now: parseAnimals' output, for an island the door has
  // already vouched for. Returns whether the public part changed, which is what decides
  // whether everybody is told (`herd`), and how many finished actions were asked for again.
  function set(islandId, body) {
    const island = fleet.get(islandId);
    if (!island) {
      const e = new Error('no such island here');
      e.status = 404;
      throw e;
    }
    let h = herds.get(islandId);
    if (!h) {
      h = {
        id: islandId,
        walk: createAnimalWalk(island.terrain, { blocked: blockedOf(island) }),
        terrain: island.terrain,
        seq: 0, gen: 0, animals: [], traces: [], order: [],
        // action id -> the generation of the latest POST that carried it. The latest, not the
        // first: the islander bumps its generation on every reconnect and re-posts what is
        // pending, and accepts a `done` only under the generation it has now - so an errand
        // the sea kept walking across a reconnect is reported under the new one.
        genOf: new Map(),
        finished: [],
        // The last row each animal was sent as, so a beat sends only who changed.
        sent: new Map(),
        said: null,
      };
      herds.set(islandId, h);
    } else {
      reground(h, island);
    }

    h.gen = body.gen;
    h.walk.set(body.animals.map(({ id, species, traits, home, r }) => ({ id, species, traits, home, r })));

    const walking = [];
    const again = [];
    for (const a of body.actions) {
      if (h.finished.includes(a.id)) { again.push(a.id); continue; }
      h.genOf.set(a.id, body.gen);
      walking.push(a);
    }
    const posted = new Set(walking.map((a) => a.id));
    for (const id of [...h.genOf.keys()]) if (!posted.has(id)) h.genOf.delete(id);
    h.walk.intend(walking);
    // Answered at once rather than on the next beat: the islander is waiting on exactly these.
    for (const id of again) completed.push({ island: islandId, action: id, gen: body.gen });

    const said = JSON.stringify([body.animals, body.traces]);
    const changed = said !== h.said;
    h.said = said;
    h.seq = body.seq;
    h.animals = body.animals;
    h.traces = body.traces;
    // The order the rows are indexed in: the herd's list as posted (sorted by id). A new
    // list may give an index to somebody else, so what each was last sent as is forgotten
    // and the caller sends everybody after the `herd` that says who the indices mean.
    h.order = body.animals.map((a) => a.id);
    if (changed) h.sent.clear();
    return { changed, again: again.length };
  }

  // Step every herd by however much wall-clock time has gone by, in whole ticks - with the
  // crowds' cap, and for their reason: a sea that was suspended comes back owing minutes, and
  // nobody was watching a hen that nobody was connected to.
  function tick() {
    const t = now();
    owed += (t - last) / 1000;
    last = t;
    let n = Math.floor(owed / DT);
    if (n <= 0) return 0;
    owed -= n * DT;
    if (n > maxTicksPerBeat) { n = maxTicksPerBeat; owed = 0; }
    for (const h of herds.values()) {
      const island = fleet.get(h.id);
      // An island the fleet no longer has is waiting for the sweep to drop its herd; it does
      // not walk meanwhile, and says nothing (encode below).
      if (!island) continue;
      reground(h, island);
      h.walk.advance(n);
      for (const id of h.walk.done()) {
        const gen = h.genOf.has(id) ? h.genOf.get(id) : h.gen;
        h.genOf.delete(id);
        remember(h, id);
        completed.push({ island: h.id, action: id, gen });
      }
    }
    ticks += n;
    return n;
  }

  // The `af` rows for one island: [idx, qx, qz, act, qh, fx, fz, ...] (docs/animals-wire.md).
  // Only the animals whose row changed since they were last sent, unless `all`. `mark: false`
  // is for the join dump - one socket being told everything must not make the next beat think
  // everybody else has been told it too.
  function encode(islandId, { all = false, mark = true } = {}) {
    const h = herds.get(islandId);
    const island = fleet.get(islandId);
    if (!h || !island) return [];
    const out = [];
    h.order.forEach((id, idx) => {
      const f = h.walk.figures.get(id);
      if (!f) return;
      const row = animalRow(f, idx, island.half);
      const key = row.join(',');
      if (!all && h.sent.get(id) === key) return;
      if (mark) h.sent.set(id, key);
      for (const v of row) out.push(v);
    });
    return out;
  }

  const publicOf = (islandId) => {
    const h = herds.get(islandId);
    return h ? { seq: h.seq, animals: h.animals, traces: h.traces } : null;
  };

  // The errands finished (or asked about again) since the last call, drained.
  function completions() {
    const out = completed;
    completed = [];
    return out;
  }

  // The island has gone home and been swept. Its herd goes with it, and so does anything it
  // was still owed: there is nobody left on the line to tell.
  function drop(islandId) {
    if (!herds.has(islandId)) return false;
    herds.delete(islandId);
    completed = completed.filter((c) => c.island !== islandId);
    return true;
  }

  // Bring one herd's ground up to date now rather than on the next tick - the sea calls it
  // straight after a republish, so a POST that lands in between plans on the new island.
  const regroundId = (islandId) => {
    const h = herds.get(islandId);
    return h ? reground(h, fleet.get(islandId)) : false;
  };

  return {
    set, tick, encode, publicOf, completions, drop,
    reground: regroundId,
    get: (id) => herds.get(id) || null,
    has: (id) => herds.has(id),
    ids: () => [...herds.keys()],
    count: () => herds.size,
    animals: () => {
      let n = 0;
      for (const h of herds.values()) n += h.walk.figures.size;
      return n;
    },
    ticks: () => ticks,
  };
}
