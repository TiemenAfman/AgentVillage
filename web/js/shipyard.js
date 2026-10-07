// The shipyard (Plans/DONE/scheepswerf.md, scripts/build-shipyard.py): which of its parts a stage
// draws, and where on its lot it stands. Plain arithmetic and no three.js, because the island,
// a guest island and the tests all ask the same two questions and must get the same answers.
//
// The yard is the first civic lot that is not square - five across and sixteen along, the long
// way out from the coast - and the first that stands half in the sea. Both of those are the
// reason this file exists: main.js sets every other building down at the height of the middle
// of its plot, and the middle of this one is over water.
import { SEA_LEVEL } from 'shared/terrain.mjs';

// What the islander writes on the yard's record, in the order a Dutch yard of her century built
// a ship - the bottom before the frames (schaalbouw, as Witsen describes it): 0 the empty stocks,
// 1 the keel and the stems, 2 the bottom planking held by cleats, 3 the frames set into it and
// rising to the height of her sides, 4 her hull complete. The masts are never here: a ship was
// masted at the fitting-out quay after her launch, so she comes to the roads rigged. Anything
// missing, broken or out of range is read as the empty stocks - a sea older than the field drops
// it, and its pages are meant to draw a slipway with nothing on it rather than refuse the yard.
export const YARD_STAGES = 5;
export const YARD_STAGE_NAMES = Object.freeze(['Empty stocks', 'Keel and stems', 'Bottom planking', 'Frames', 'Hull']);
// From this stage the hull on the ways is the Batavia's own bake (bataviaOnStocks in
// buildings.js) rather than anything of the yard's: the ship at 115 is the ship at 120.
export const HULL_STAGE = 4;
export function yardStage(spec) {
  const s = Math.floor(Number(spec && spec.stage));
  return Number.isFinite(s) ? Math.min(YARD_STAGES - 1, Math.max(0, s)) : 0;
}

// A part of the ship is named `shipyard s<a>-<b> <what>` and is drawn at stages a to b; a part
// without the token is the yard itself and is always drawn. The range is the whole rule, and a
// later stage leaves out what it covers: the cleats are `s2-2` because the frames hold the
// strakes once they are in, the stem braces `s1-2` for the same reason, and the keel, the stems,
// the bottom and the frames all end at 3, where her own hull takes the ways.
const STAGED = /^shipyard s(\d)-(\d) /;
export function shownAtStage(partName, stage) {
  const m = STAGED.exec(partName);
  return !m || (stage >= Number(m[1]) && stage <= Number(m[2]));
}

// The lot, in the model's own frame: x across, z along, the sea at +z.
export const YARD_W = 5;
export const YARD_D = 16;
// How much of it, from the landward end, is land (the site rule's promise) and is sampled for
// the ground the yard stands on: the shed, the sheerlegs, the stacks, the hearth and the head of
// the slipway are all in these six rows. All six and not only the ones under the shed, because
// the slipway runs down through them too, and a dune at the top of the beach would come up
// through its bed if the yard were stood on the lower ground behind it.
export const LAND_ROWS = 6;
// The lowest the yard is ever set, over the sea. The ship's keel is laid near the land's own
// height and the slipway falls 1 in 24 under her, so on a beach lower than this her stern would
// stand in the water. So the yard is raised onto its own ground instead: its shed and its bed
// have skirts, and a low beach is what a skirt is for.
export const YARD_FLOOR = 0.65;

// Local (x, z) on the lot, turned the way the group is turned for each rot - the same quarter
// turns makeRecord's yaw makes (`Math.PI - rot * Math.PI / 2`), written out so that no sine can
// leave a hair's breadth of error where a cell's corner should be.
const TURN = [
  (x, z) => [-x, -z],
  (x, z) => [z, -x],
  (x, z) => [x, z],
  (x, z) => [-z, x],
];
export const turnLocal = (rot, x, z) => TURN[((rot || 0) % 4 + 4) % 4](x, z);

// How high the yard's group stands: the highest land among the corners of its landward rows,
// and never lower than YARD_FLOOR. The highest rather than the middle, because what stands
// there is a shed and a hearth with skirts under them - lower ground is hidden by a skirt, and
// higher ground would come up through the shed floor. Water corners are left out: the land zone
// of a coast lot may still have a wet corner, and the sea's own floor is not ground to stand on.
//
// `centre` is where the group stands in x and z (cellCentre in main.js), and `heightAt(x, z)`
// the ground in the same frame.
export function shipyardGround(plot, centre, heightAt) {
  let best = -Infinity;
  for (let z = 0; z <= LAND_ROWS; z++) {
    for (let x = 0; x <= YARD_W; x++) {
      const [dx, dz] = turnLocal(plot && plot.rot, x - YARD_W / 2, z - YARD_D / 2);
      const h = heightAt(centre[0] + dx, centre[1] + dz);
      if (h > SEA_LEVEL && h > best) best = h;
    }
  }
  return Math.max(YARD_FLOOR, best);
}

export const isShipyard = (spec) => !!spec && spec.kind === 'civic' && spec.civicType === 'shipyard';
