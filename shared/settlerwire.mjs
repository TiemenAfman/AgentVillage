// Getting a crowd onto a wire, and off it again.
//
// In shared/ because both ends need it: the sea encodes and every browser decodes, and a
// second copy of a wire format is a second copy that drifts. It is plain arithmetic and
// obeys shared/'s rule without trying.
//
// The naive shape is one row per settler per beat with a string id on it: 274 settlers at
// 10 Hz is about 123 kB/s per island per viewer, which is not a budget, it is a fire. Three
// things bring that down by two orders of magnitude, and none of them is compression.
//
//   An index instead of an id. The roster - index to building id - is sent once when an
//   island arrives and again only when its village changes. A row is then four small
//   integers and no strings at all.
//
//   No colours, ever. The far end calls settlerLook(buildingId, style, kind) out of
//   shared/palette.mjs and gets the identical face: it is hashed off the id, which both
//   sides already have. That is the promise the wardrobe has always made.
//
//   Two rates, because a crowd has two speeds. At most MAX_STROLL settlers are out on an
//   errand at any moment and they move; the other two hundred are drifting around their own
//   doorsteps in a circle a third of a cell wide. So the walkers ride at WALKER_HZ and the
//   rest are pinned in a slow rotation - everybody, once every KEYFRAME_S - which is enough
//   for a body that never gets further than half a metre from where you last saw it.
//
// Measured on a village of 274, per island per viewer: sending everybody every beat is
// 3.6 kB/s, and the two rates bring that to about 1.3. The alternative - sending only
// *events* and having each browser run the walk forward itself - is nearer 0.3, and it is
// the right answer if this ever becomes the thing that hurts. It is not this answer because
// it cannot drift: a position that arrives is a position, and a prediction that is never
// corrected is a settler walking through a wall in six months' time.

// A settler's animation, as a number. The order is the wire format and must not be
// rearranged; the names are shared/settlerwalk.mjs's own.
export const ANIMS = ['still', 'step', 'walk', 'hammer'];
const ANIM_OF = new Map(ANIMS.map((a, i) => [a, i]));

// How finely a position travels. A thirty-second of an island unit is about three
// centimetres against a body a third of a unit wide - far below anything an eye can
// separate at the distance another island is drawn from - and it keeps a coordinate on a
// 512 grid inside fourteen bits.
export const GRID = 32;

// How often every settler is pinned, walkers or not. Ten seconds is comfortably longer
// than an idle settler takes to wander the width of its own doorstep, and it spreads the
// whole village over two hundred beats.
export const KEYFRAME_S = 10;

// How often a settler who is actually going somewhere is sent. Not every beat: a settler
// walks at 0.42 units a second, so five a second leaves under a tenth of a unit between
// updates - well inside what the far end interpolates over without anybody seeing a step.
// Measured: every beat cost 3.6 kB/s per island per viewer, and this is 1.3.
export const WALKER_HZ = 5;

// Which beats carry the walkers, given the tick. Returns 1 when the beat is already slower
// than WALKER_HZ, so a slow sea never skips anybody.
export function walkerEvery(tickMs) {
  return Math.max(1, Math.round(1000 / Math.max(1, tickMs) / WALKER_HZ));
}

const quant = (v, half) => Math.round((v + half) * GRID);
const unquant = (q, half) => q / GRID - half;

// One island's crowd, as the sea sees it.
//
// `walkers` is everybody on an errand, on the beats that carry them. `pinned` is the slice
// of everybody else whose turn it is. A settler is never in both: somebody walking is not
// also pinned, so a beat that is not carrying walkers simply leaves them out and the far
// end keeps drawing them from where they were last put.
export function encodeCrowd(crowd, { half, slice = 0, slices = 1, movers = true }) {
  const walkers = [];
  const pinned = [];
  let idx = -1;
  for (const f of crowd.figures.values()) {
    idx++;
    if (!f.visible) continue;
    // Somebody in a boat is left out of both lists: encodeRides below says where they
    // are, how high and which way round, all of it every beat, and a second and slower
    // account of the same body would only argue with it. They come back into the crowd on
    // the beat they step ashore.
    if (f.aboard) continue;
    const row = [idx, quant(f.pos[0], half), quant(f.pos[1], half), ANIM_OF.get(f.anim) ?? 0];
    if (f.anim === 'walk') { if (movers) walkers.push(row); }
    else if (slices <= 1 || idx % slices === slice) pinned.push(row);
  }
  return { a: walkers.flat(), k: pinned.flat() };
}

// How finely a heading travels. A full turn in a thousand and twenty-four steps is a third
// of a degree, well under what an eye separates on a hull two hundred units away, and it
// keeps a bearing in ten bits. A power of two so the wrap is a mask and not a modulo that
// has to be told what to do with a negative.
export const TURNS = 1024;
const TAU = Math.PI * 2;
const qturn = (a) => Math.round((a / TAU) * TURNS) & (TURNS - 1);
const unturn = (q) => (q / TURNS) * TAU;

// The dinghies, and the bodies standing in them.
//
// A row is the whole of an outing: where the hull is, and where the body standing in it
// is. Everything the water adds and the land answered for free - a settler ashore is
// grounded by the far end with groundOrDeck and turned by the way it is walking, and in a
// boat it is standing still on something that is moving, so both give the wrong answer.
//
// The rider is carried here rather than left in the crowd's own list, which is where the
// first version put it. Two rates were the problem: the hull would arrive every beat and
// the body every fourth, and a settler visibly trailing the boat it is standing in is
// worse than either rate on its own. So they travel together, at the hull's rate.
//
// Sent whole every beat rather than only when it changes, because that is what makes a
// row's *absence* mean the outing is over - the only signal the far end gets to take a
// hull back out of the water.
//
// What that costs, measured rather than waved at: an island with both its boats out pays
// 67 B a beat against the crowd's own 213, so while anybody is sailing this is about a
// third again on top - roughly 1 kB/s. That is not nothing, and it is affordable only
// because of how rare an outing is: MAX_OUT is two and the wait between them is fifty to
// two hundred seconds, so most beats carry `"b":[]` and four bytes. The cheaper shape -
// the walker rate, with the hull interpolated the way a body is - was left on the shelf
// because at CRUISE that is two thirds of a unit between messages and every voyage would
// need the same from/to machinery figures have. Reach for it if a sea ever has eight
// islands all sailing at once; until then this is the plain one.
//
// The height is the deck with no swell in it. The browser bobs its own hulls off its own
// clock (web/js/boat.js), so it adds that rise to the rider it draws and the two agree
// without a clock ever being sent.
export function encodeRides(rides, half) {
  const out = [];
  for (const r of rides) {
    out.push(r.idx, quant(r.x, half), quant(r.z, half), qturn(r.yaw),
      quant(r.rx, half), quant(r.rz, half), Math.round(r.ry * GRID), qturn(r.ryaw));
  }
  return out;
}

export function decodeRides(flat, half, into = new Map()) {
  into.clear();
  if (!Array.isArray(flat)) return into;
  for (let i = 0; i + 7 < flat.length; i += 8) {
    into.set(flat[i], {
      x: unquant(flat[i + 1], half),
      z: unquant(flat[i + 2], half),
      yaw: unturn(flat[i + 3]),
      rx: unquant(flat[i + 4], half),
      rz: unquant(flat[i + 5], half),
      ry: flat[i + 6] / GRID,
      ryaw: unturn(flat[i + 7]),
    });
  }
  return into;
}

// And back again. Rows land in a map the far end keeps, so a settler that was not in this
// message keeps whatever it was told last - which is the whole point of the slow rotation.
export function decodeCrowd(flat, half, into = new Map()) {
  if (!Array.isArray(flat)) return into;
  for (let i = 0; i + 3 < flat.length; i += 4) {
    into.set(flat[i], {
      x: unquant(flat[i + 1], half),
      z: unquant(flat[i + 2], half),
      anim: ANIMS[flat[i + 3]] || 'still',
    });
  }
  return into;
}

// Who the indices mean. Sent when an island arrives and again when its village changes -
// which is the only time the order can move, because it is the order of the buildings in
// the bundle. Colours are deliberately absent: see the header.
export function crowdRoster(crowd) {
  const out = [];
  for (const f of crowd.figures.values()) out.push(f.id);
  return out;
}

// How many beats one full rotation takes, so every settler is pinned once per KEYFRAME_S.
export function sliceCount(tickMs) {
  return Math.max(1, Math.round((KEYFRAME_S * 1000) / Math.max(1, tickMs)));
}
