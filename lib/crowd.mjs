// One island's people, stepped by the sea.
//
// Everything here comes out of the bundle that island published: its buildings, its lanes,
// its square, where the renderer actually put each house and where a road is carried over
// water. Nothing is asked of the island while it is running, which is what lets a crowd
// keep walking for the forty-five seconds of grace after its keeper closes their laptop.
//
// The walk itself is shared/settlerwalk.mjs, unchanged and unwrapped. This file is only the
// translation: a bundle in, a stepped sim out.
import { createWalk, DT } from '../shared/settlerwalk.mjs';
import { roadCells, squareCells } from '../shared/roads.mjs';
import { settlerLook, kindOf, styleOf } from '../shared/palette.mjs';
// Deliberately not imported from lib/placements.mjs, which is six lines of arithmetic
// sitting behind lib/paths.mjs and therefore behind node:fs. The sea writes nothing, and
// that is worth being structural rather than a promise: nothing in its import graph can
// touch a disk. So the arithmetic is here, and it is the same arithmetic.
//
// Where a building stands, or where the survey says it should if no browser has drawn this
// island yet. The fallback is web/js/main.js's cellCentre, so the two agree exactly for the
// buildings that were never nudged - which on a real village is fifteen out of 274.
function placementOf(placements, spec, half) {
  const at = placements && placements.at && placements.at[spec.id];
  if (at) return at;
  const p = spec.plot;
  if (!p) return null;
  return [p.gx + p.w / 2 - half, p.gz + p.d / 2 - half];
}

// Civic buildings house nobody. The browser's placeFigure has always skipped them and the
// sea has to skip exactly the same ones, or two machines disagree about who exists.
const HOUSED = (spec) => spec && spec.kind !== 'civic' && !!spec.plot;

export function createCrowd(island) {
  const { bundle, terrain } = island;
  const walk = createWalk(terrain);

  // The streets first: a figure works out which road cell it steps onto the first time it
  // is asked, and caches it, so the network has to be there before anybody is spawned.
  walk.setRoads(roadCells(bundle), squareCells(bundle));

  // Where a road is carried over water. The plain `gx + gz * size` key, which is what a
  // settler walking this island uses - an island bundle is one island, so the region
  // strides that walk mode needs do not come into it.
  const decks = new Map();
  for (const [cell, y] of Object.entries(bundle.decks || {})) decks.set(Number(cell), y);
  walk.setDecks(decks);

  const placements = { at: bundle.placements || {} };
  let spawned = 0;
  for (const spec of bundle.buildings || []) {
    if (!HOUSED(spec)) continue;
    const at = placementOf(placements, spec, terrain.half);
    if (!at) continue;
    // The height decides the stride, and it is hashed off the building id - the same hash
    // the browser draws the face from, so the two agree about who this is without a word.
    const look = settlerLook(spec.id, styleOf(spec), kindOf(spec));
    // spawn takes a three-element world position because that is what the browser hands
    // it from a mesh; only x and z are read.
    walk.spawn(spec.id, spec, [at[0], 0, at[1]], {}, look.height);
    spawned++;
  }

  return {
    walk,
    id: island.id,
    figures: walk.figures,
    count: () => spawned,
    advance: (ticks, night) => walk.advance(ticks, night),
  };
}

// Every island's crowd, and one clock over the lot.
//
// The accumulator lives here rather than in each crowd: they all step the same whole ticks
// at the same moment, so a settler on one island and a settler on another are always the
// same age. Two accumulators would drift apart by less than a tick and be impossible to
// reason about afterwards.
export function createCrowds({ now = () => Date.now(), maxTicksPerBeat = 8 } = {}) {
  const crowds = new Map();
  let last = now();
  let owed = 0;
  let ticks = 0;

  function join(island) {
    // Rebuilt from scratch when an island republishes. A crowd is cheap to make and the
    // village underneath it may have changed shape entirely - a house built, a district
    // founded, a polder drained - and reconciling that in place is a whole machine nobody
    // has asked for. What it costs is that everybody walks back to their own doorstep,
    // which is where a settler spends most of its life anyway.
    const crowd = createCrowd(island);
    crowds.set(island.id, crowd);
    return crowd;
  }

  const leave = (id) => crowds.delete(id);
  const get = (id) => crowds.get(id) || null;

  // Step everybody by however much wall-clock time has gone by, in whole ticks.
  //
  // The cap matters. A process that was suspended - a laptop lid, a breakpoint, a long
  // garbage collection - comes back owing minutes, and stepping all of them at once would
  // freeze the sea for as long as it takes and then teleport every settler. Better to lose
  // the time: nobody is watching a crowd that nobody was connected to.
  function tick(nightAmount = 0) {
    const t = now();
    owed += (t - last) / 1000;
    last = t;
    let n = Math.floor(owed / DT);
    if (n <= 0) return 0;
    owed -= n * DT;
    if (n > maxTicksPerBeat) { n = maxTicksPerBeat; owed = 0; }
    for (const crowd of crowds.values()) crowd.advance(n, nightAmount);
    ticks += n;
    return n;
  }

  return {
    join, leave, get, tick,
    ticks: () => ticks,
    count: () => crowds.size,
    all: () => [...crowds.values()],
    // Everybody in the world, for a snapshot or a count.
    figures: () => {
      let n = 0;
      for (const c of crowds.values()) n += c.figures.size;
      return n;
    },
  };
}
