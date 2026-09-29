// What a building's moving parts hold on the GPU, given back when the building goes.
//
// main.js's attachExtras hangs them on a record - the clock's dial and hands, the fountain's
// water, the gold in the pit, the ore in the mine's bin, the goldsmith's furnace, the trades'
// working parts and their people - for our own island's records and a guest island's alike.
// They are taken down in three places: disposeRecord in main.js (a house of ours rebuilt or
// gone), and in guest-island.js both a whole region lowered and the volcano's Codex houses
// coming and going (applyBuildings). Each of those used to carry its own list, and each list
// had drifted from what attachExtras hangs: the guest's knew nothing of the clocks, the
// fountain, the ore pile or the furnace, applyBuildings knew only the ship, and main.js's own
// knew nothing of the clocks or the postbox flag. tests/guest-leak.test.mjs measured it: 11
// geometries, 2 InstancedMeshes and a material left behind by every raise of a region with
// a town like ours. So there is one list, here, beside nothing else.
//
// Only what is the record's own. The windmill's sails, the camp's fire and flame, the beacon's
// beam and the scaffold are geometry every record shares (module-level in main.js, beacon.js
// and scaffold.js) and the building material is every building's: disposing those would make
// the next raise upload them again, and the test checks that nothing shared is disposed.
import { disposeSawmill } from './sawmill.js';
import { disposeSmithy } from './smithy.js';
import { disposeStable } from './stable.js';
import { disposeBakery } from './countryside.js';
import { disposeBaker } from './bakery-keeper.js';
import { disposeButcher } from './butcher.js';
import { disposeFisher } from './fisher.js';
import { disposeQuarry } from './quarry.js';
import { disposeBatavia } from './batavia.js';
import { disposeClock } from './clock.js';

export function disposeExtras(rec) {
  if (rec.nameplate) rec.nameplate.dispose();
  if (rec.fountain) {
    rec.fountain.surface.geometry.dispose();
    rec.fountain.jets.geometry.dispose();
  }
  if (rec.clock) disposeClock(rec.clock);
  if (rec.resetClock) disposeClock(rec.resetClock);
  if (rec.mailFlag) rec.mailFlag.mesh.geometry.dispose();
  if (rec.goldPile) rec.goldPile.dispose();
  if (rec.orePile) rec.orePile.dispose();
  if (rec.furnace) rec.furnace.dispose();
  if (rec.sawmill) disposeSawmill(rec.sawmill);
  if (rec.smithy) disposeSmithy(rec.smithy);
  if (rec.stable) disposeStable(rec.stable);
  if (rec.bakery) disposeBakery(rec.bakery);
  if (rec.baker) disposeBaker(rec.baker);
  if (rec.butcher) disposeButcher(rec.butcher);
  if (rec.fisher) disposeFisher(rec.fisher);
  if (rec.quarry) disposeQuarry(rec.quarry);
  if (rec.ship) disposeBatavia(rec.ship);
}
