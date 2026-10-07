// How high the Salty Kraken stands, and the gangway it is reached by (Plans/piratenkroeg.md,
// Plans/kraken-op-zee.md).
//
// The bake's ground is not its y = 0: its rock runs on below the foot of the stair by a skirt
// (scripts/build-piratetavern.py SKIRT), so that it rises out of the water - or out of the sand -
// instead of standing on it with a seam, and every asset's lowest point is y = 0. Where the foot of
// the stair is in the bake is `anchor.door`, on the floor of the landing there; so the group stands
// at the height that landing is meant to be, less that anchor's height.
//
// In the sea (lib/layout.mjs `pirateTavernSeaSite`), the landing is where the gangway arrives, at the
// docks' deck height (QUAY_DECK). On the beach it is the lowest ground along its front edge: the foot
// of the stair meets the sand, and the rock runs into the rise behind it. Never below the sea, so a
// front edge with a corner in the water does not sink the rock into it. A pub from before either,
// still on the three by three it was first given, stands on the middle of its lot.
import { SEA_LEVEL } from 'shared/terrain.mjs';
import { pubGangway } from 'shared/kraken.mjs';
import { turnLocal } from './shipyard.js';
import { QUAY_DECK } from './buildings.js';

export const isPirateTavern = (spec) => !!spec && spec.kind === 'civic' && spec.civicType === 'piratetavern';

// PUB_LOT in lib/layout.mjs, as the model has it: eleven across its front (x), six deep (z).
const ACROSS = 11, DEEP = 6;
const onLot = (plot) => Math.max(plot.w, plot.d) === ACROSS && Math.min(plot.w, plot.d) === DEEP;

// The gangway of a Kraken in the sea, from the terrain it stands on (`terrain.isWater` on grid
// cells): shared/kraken.mjs `pubGangway`, the sum the layout made when it placed it. Null on the beach.
export function pirateGangway(plot, terrain) {
  if (!plot || !onLot(plot)) return null;
  return pubGangway(plot, (gx, gz) => gx >= 0 && gz >= 0 && gx < terrain.size && gz < terrain.size && terrain.isWater(gx, gz));
}

// The height the group stands at. `centre` is where it stands on the plane, `heightAt(x, z)` the
// ground under a point there, `built` what buildBuilding made (its `anchors.door` is the landing's
// floor) and `terrain` the island's own, for the gangway.
export function pirateTavernGround(plot, centre, heightAt, built, terrain) {
  const foot = (built && built.anchors && built.anchors.door && built.anchors.door[1]) || 0;
  if (!onLot(plot)) return heightAt(centre[0], centre[1]) - foot;
  if (terrain && pirateGangway(plot, terrain)) return QUAY_DECK - foot;
  let low = Infinity;
  for (let i = 0; i <= ACROSS; i++) {
    const [dx, dz] = turnLocal(plot.rot, i - ACROSS / 2, DEEP / 2);
    const h = heightAt(centre[0] + dx, centre[1] + dz);
    if (h < low) low = h;
  }
  return Math.max(SEA_LEVEL, low) - foot;
}
