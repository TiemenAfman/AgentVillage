// How high the Salty Kraken stands (Plans/piratenkroeg.md, "Bijsturing na het eerste oordeel in
// het spel"). It stands on the beach with its front to the sea (lib/layout.mjs `pirateTavernSite`),
// on a lot eleven by six whose ground may rise PUB_RELIEF (1.5) from the waterline to the back, and
// the middle of such a lot - what every other building stands on - left the stair's foot hanging in
// the air over the sand and the rock's front edge with it. So the lowest ground along its front
// edge: the foot of the stair (anchor.door, on that edge) meets the beach, and the back of the rock
// runs into the rise behind it, which the rock (1.75 high) hides up to where the hull begins (1.8).
// Never below the sea, so a front edge with a corner in the water does not sink the rock into it.
//
// A pub from before this, still on the three by three it was first given, stands the old way: its
// lot is flat enough, and an eleven by six sampled over three cells would read its neighbours.
import { SEA_LEVEL } from 'shared/terrain.mjs';
import { turnLocal } from './shipyard.js';

export const isPirateTavern = (spec) => !!spec && spec.kind === 'civic' && spec.civicType === 'piratetavern';

// PUB_LOT in lib/layout.mjs, as the model has it: eleven across its front (x), six deep (z).
const ACROSS = 11, DEEP = 6;

// `centre` is where the group stands on the plane, `heightAt(x, z)` the ground under a point there.
export function pirateTavernGround(plot, centre, heightAt) {
  const long = Math.max(plot.w, plot.d), short = Math.min(plot.w, plot.d);
  if (long !== ACROSS || short !== DEEP) return heightAt(centre[0], centre[1]);
  let low = Infinity;
  for (let i = 0; i <= ACROSS; i++) {
    const [dx, dz] = turnLocal(plot.rot, i - ACROSS / 2, DEEP / 2);
    const h = heightAt(centre[0] + dx, centre[1] + dz);
    if (h < low) low = h;
  }
  return Math.max(SEA_LEVEL, low);
}
