// How many guards the volcano has, and when they come out of the guardhouse.
//
// The rule is Plans/vulkaan-in-het-midden.md's (section 7 and the Besluiten rows "Agents"
// and "Islander disconnect"): the target is guardTarget(islanders) - BASE plus PER_ISLANDER
// for every islander online, capped (shared/volcano.mjs has the numbers). Only a *rise* acts
// at once: the missing guards come out of the guardhouse on the same beat. A fall kills
// nobody and hides nobody - a guard does not vanish out of the middle of a chase because
// somebody on the far side of the world closed their laptop - and the number drifts down on
// its own instead, because a guard who falls while there are at least as many as the target
// does not come back. Falling is guardDied(id); nothing calls it yet (players cannot strike
// until step 7 of the plan), and it is here now so that step only has to call it.
//
// In memory, like every other thing the sea holds: the respawn timers are a list of
// timestamps, polled on the beat, and a restarted sea starts with BASE guards and an empty
// list, which is the whole migration story.
import { VOLCANO, GUARDS, guardTarget } from '../shared/volcano.mjs';

// Who counts as an islander online: an island in the fleet with its islander on the line
// (`live` - lib/fleet.mjs sets it from the islander's own socket, on publish and on claim,
// and clears it when that socket goes), that is not the sea's own, and is not hostile.
//
// The last one is what stops one islander counting twice - in a world of mixed versions. An
// islander from before step 6 of the plan still publishes its Codex village as an island of
// its own, over a socket of its own, under its own id and token, and the fleet has no way to
// tell that the two sockets are one machine: the name on them is chosen by the islander and
// two people may share one. But that island is always hostile (the old serve.mjs set it, and
// nothing else can: an islander's own bundle never carries it), and no islander's home island
// ever is. So: islands, minus the hostile ones, is islanders. A current islander sends its
// Codex settlers to the volcano instead (lib/residents.mjs) and has nothing here to exclude.
export function countIslanders(fleet) {
  let n = 0;
  for (const i of fleet.all()) if (!i.sea && i.live && !i.bundle.island.hostile) n++;
  return n;
}

// `onRoster(crowd)` is called whenever the guards changed - somebody came out, somebody
// fell - so the sea can send the roster again and the new positions with it (lib/sea.mjs).
export function createGuards({ fleet, crowds, now = () => Date.now(), onRoster = () => {} }) {
  let crowd = null;     // the volcano's crowd these numbers are about
  let target = 0;       // the target as of the last beat, so a rise can be told from a hold
  let pending = [];     // [{ id, at }]: fallen guards due back out of the guardhouse

  // The number that matters for both rules: guards standing plus guards already on their
  // way back. Counting the pending ones is what stops a rise and a respawn both filling the
  // same gap - the rise fills what is missing now, the timer brings back the one that fell.
  const accounted = () => crowd.guardsStanding() + pending.length;

  function tick() {
    const c = crowds.get(VOLCANO.id);
    if (!c || !c.guardhouse) { crowd = null; return false; }
    // A crowd this controller has not seen has no guards in it: the sea's first beat, or -
    // if anything ever rebuilds the volcano's crowd - a crowd made from scratch. Either way
    // the target is a rise from nothing.
    if (c !== crowd) { crowd = c; target = 0; pending = []; }
    const t = now();
    const want = guardTarget(countIslanders(fleet));
    let changed = false;

    if (want > target) {
      // Out at once. A fallen guard who was not due back (he fell while there were enough)
      // is the first to come out again, so the roster stays as short as it can be; after
      // them, new ones.
      let missing = want - accounted();
      if (missing > 0) {
        const due = new Set(pending.map((p) => p.id));
        for (const f of crowd.guards()) {
          if (missing <= 0) break;
          if (f.dead && !due.has(f.id) && crowd.guardUp(f.id)) { missing--; changed = true; }
        }
        for (; missing > 0; missing--) { if (!crowd.addGuard()) break; changed = true; }
      }
    }
    // Down at once too, as a number - but nobody standing is touched by it.
    target = want;

    // The ones whose twenty seconds are up come back if there is still room for them under
    // the target, and are forgotten if there is not: the island emptied while they waited.
    if (pending.length) {
      const still = [];
      for (const p of pending) {
        if (p.at > t) { still.push(p); continue; }
        if (crowd.guardsStanding() < target && crowd.guardUp(p.id)) changed = true;
      }
      pending = still;
    }

    if (changed) onRoster(crowd);
    return changed;
  }

  // A guard has fallen. He goes at once; he comes back after RESPAWN_MS only if, as he
  // falls, there are fewer standing than the target - so a surplus left behind by islanders
  // who went home thins out one fall at a time and is never topped up again.
  function guardDied(id) {
    if (!crowd || !crowd.guardDown(id)) return false;
    if (crowd.guardsStanding() + pending.length < target) pending.push({ id, at: now() + GUARDS.RESPAWN_MS });
    onRoster(crowd);
    return true;
  }

  return {
    tick,
    guardDied,
    target: () => target,
    standing: () => (crowd ? crowd.guardsStanding() : 0),
    pending: () => pending.length,
  };
}
