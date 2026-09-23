// The Codex settlers of every islander, housed on the volcano.
//
// Plans/vulkaan-in-het-midden.md, section 8, and the Besluiten rows "Huisjes op de vulkaan",
// "Id's over spelers heen", "Islander offline" and "Pool vol". An islander with Codex
// sessions used to publish a whole second island for them, hostile, on a berth of its own.
// Now it sends the sea a short list through POST /island/:id/codex (lib/islandbundle.mjs
// parseCodex), and this file puts them up on the one hostile island there is:
//
//   a house     on one of the plots on the flank (shared/volcano.mjs codexPlots), chosen by
//               a hash of the settler's full id `codex:<island>:<id>`, and when that plot is
//               taken the next free one after it, round the pool in a fixed order. So a new
//               house never moves one that is standing, and nor does one coming down: every
//               assignment is kept until its own settler goes. Houses of all islanders
//               stand mixed together, which is the point.
//   a lodging   in the guardhouse, for whoever the plots ran out for. They are residents all
//               the same - hostile, dressed from their own id - and move into a house as soon
//               as one comes free.
//   nothing     past CODEX.RESIDENTS bodies on the mountain. They wait in the list, in id
//               order, and come out when somebody leaves.
//
// Everything is in memory and follows from the lists, like the rest of the sea: a restart
// is an empty volcano until each islander reconnects and sends its list again. What it
// cannot promise across a restart is the same plots - which house got its first choice
// depends on who arrived first - and it does not have to: nobody can do anything with a
// house on the volcano, so "a house never moves" is a rule for islands, not for this one.
//
// The crowd is never rebuilt for any of it. One islander's list changing adds and removes
// that islander's residents in the running crowd (lib/crowd.mjs placeResident /
// removeResident), and `onChange` tells the sea to send the houses, the roster and everybody's
// position - see lib/sea.mjs. The volcano's `rev` does not move, which is what keeps every
// page from building its ground again (lib/fleet.mjs furnishVolcano).
//
// A resident can also fall (lib/combat.mjs, `died`): taken out of the running crowd as a
// hole, like a settler whose islander dropped it, but keeping its body and its plot in the
// books, and set down again at its own door - its house, or a place in front of the
// guardhouse for a lodger - RESPAWN_MS later. Nothing about a fall touches the houses.
import { VOLCANO, CODEX, GUARDS, codexId, codexPlots } from '../shared/volcano.mjs';
import { hash32 } from '../shared/rng.mjs';
import { codexHouse } from './islandbundle.mjs';

// How long a fallen resident stays down. The plan's twenty seconds for everybody on the
// volcano (Besluiten, "Respawn"), and the guards' number is the one copy of it.
export const RESPAWN_MS = GUARDS.RESPAWN_MS;

// `onRoster(crowd)` is for a fall and a return, which change who is standing and nothing
// else: the roster and the positions go out again, the houses do not (lib/sea.mjs).
export function createResidents({ fleet, crowds, now = () => Date.now(), onChange = () => {}, onRoster = () => {} }) {
  const lists = new Map();      // island id -> Map(full id -> entry), what each islander said
  const fallen = new Map();     // full id -> when it gets up again
  const slotOf = new Map();     // full id -> index into the pool
  const takenBy = new Map();    // index into the pool -> full id
  const bodies = new Set();     // full ids with a body in the crowd
  let pool = null;              // the plots, once the volcano has been seen
  let crowd = null;             // the crowd those bodies were put into

  const volcano = () => fleet.get(VOLCANO.id);
  const entryOf = (fid) => {
    for (const l of lists.values()) { const e = l.get(fid); if (e) return e; }
    return null;
  };

  // A plot for a settler: its hash's own if free, otherwise the next free one round the
  // pool. Linear on purpose - it visits every plot, so "none" means the pool is full rather
  // than that a stride happened to miss the gap - and overflow lands next door, on the
  // lattice order codexPlots walks, which reads as a street filling up.
  function claim(fid) {
    const n = pool.length;
    if (!n) return -1;
    const start = hash32(fid) % n;
    for (let k = 0; k < n; k++) {
      const s = (start + k) % n;
      if (takenBy.has(s)) continue;
      takenBy.set(s, fid);
      slotOf.set(fid, s);
      return s;
    }
    return -1;
  }

  function vacate(fid) {
    const s = slotOf.get(fid);
    if (s === undefined) return false;
    slotOf.delete(fid);
    takenBy.delete(s);
    return true;
  }

  function houseOf(fid) {
    const s = slotOf.get(fid);
    const e = entryOf(fid);
    if (s === undefined || !e) return null;
    const { plot, door } = pool[s];
    return codexHouse({ id: fid, style: e.style, tier: e.tier, active: e.active, plot, door });
  }

  // Bodies first, then plots, both in id order and both only ever for somebody who has
  // neither yet - so settling never takes anything from anybody already standing. Run after
  // every change, because a departure anywhere may have freed a body or a plot for somebody
  // who was waiting on another islander's list.
  function settle() {
    const waiting = [];
    for (const l of lists.values()) for (const fid of l.keys()) {
      if (!bodies.has(fid) || !slotOf.has(fid)) waiting.push(fid);
    }
    waiting.sort();
    let moved = false;
    for (const fid of waiting) {
      if (!bodies.has(fid)) {
        if (bodies.size >= CODEX.RESIDENTS) continue;
        bodies.add(fid);
        moved = true;
      }
      if (!slotOf.has(fid) && claim(fid) >= 0) moved = true;
    }
    return moved;
  }

  // Everybody's house and body in the crowd as the books say, for the ids given (or all).
  function place(ids) {
    if (!crowd) return;
    for (const fid of ids) {
      // Down for the count: it keeps its hole until tick() stands it up at its door. A list
      // arriving meanwhile must not bring it back early - `set` touches every body whose
      // figure is dead, which is right for somebody settling has just given a body to and
      // wrong for somebody who was knocked over a second ago.
      if (bodies.has(fid) && fallen.has(fid)) continue;
      fallen.delete(fid);
      if (bodies.has(fid)) {
        const e = entryOf(fid);
        crowd.placeResident(fid, houseOf(fid), { active: !!(e && e.active) });
      } else {
        crowd.removeResident(fid);
      }
    }
  }

  function houses() {
    const out = [];
    for (const fid of [...slotOf.keys()].sort()) {
      const h = houseOf(fid);
      if (h) out.push(h);
    }
    return out;
  }

  function publish(touched) {
    // The houses go into the volcano's bundle (so a page that fetches it later has them) and
    // the crowd is brought into line, before anybody is told.
    const list = houses();
    fleet.furnishVolcano(list);
    place(touched);
    const renumbered = crowd ? crowd.compact() : false;
    if (crowd) onChange(crowd, list, { renumbered });
    return list;
  }

  // Take the volcano's crowd as the one the bodies live in. A crowd this has not seen has none
  // of them in it - the first call, or a crowd somebody rebuilt - so they all go in again.
  function adopt() {
    const island = volcano();
    const c = island ? crowds.get(island.id) : null;
    if (!island || !c) { crowd = null; return false; }
    if (!pool) pool = codexPlots(island.terrain);
    if (c === crowd) return false;
    crowd = c;
    return true;
  }

  // What one islander says its Codex settlers are now, replacing what it said before. The
  // entries are parseCodex's; `islandId` is the island the sea already vouched for with its
  // token. Returns the counts for the answer to the door.
  function set(islandId, entries = []) {
    const fresh = adopt();
    // A crowd this has not seen has nobody down in it: they all go in standing.
    if (fresh) fallen.clear();
    const before = lists.get(islandId) || new Map();
    const next = new Map();
    for (const e of entries || []) next.set(codexId(islandId, e.id), e);
    const touched = new Set();

    for (const fid of before.keys()) {
      if (next.has(fid)) continue;
      vacate(fid);
      bodies.delete(fid);
      touched.add(fid);
    }
    for (const [fid, e] of next) {
      const was = before.get(fid);
      if (!was || was.style !== e.style || was.tier !== e.tier || was.kind !== e.kind || was.active !== e.active) touched.add(fid);
    }
    if (next.size) lists.set(islandId, next); else lists.delete(islandId);
    if (pool) settle();
    // Whoever settling gave a body or a plot to is touched too, even on somebody else's list.
    for (const l of lists.values()) for (const fid of l.keys()) {
      if (bodies.has(fid) && (!crowd || !crowd.figures.get(fid) || crowd.figures.get(fid).dead)) touched.add(fid);
      else if (slotOf.has(fid) && crowd && crowd.figures.get(fid) && crowd.figures.get(fid).spec.id !== fid) touched.add(fid);
    }
    if (fresh) for (const fid of bodies) touched.add(fid);
    if (touched.size || fresh) publish(touched);
    return { residents: [...next.keys()].filter((f) => bodies.has(f)).length, houses: [...next.keys()].filter((f) => slotOf.has(f)).length };
  }

  // The islander has gone home and its island has been swept: its houses and its residents
  // go with it. The volcano and its guards stay.
  const drop = (islandId) => (lists.has(islandId) ? set(islandId, []) : null);

  // A resident has fallen (lib/combat.mjs). A hole in the running crowd at once; back after
  // RESPAWN_MS, see tick(). False for anybody who is not a standing resident with a body.
  function died(fid) {
    if (!crowd || !bodies.has(fid) || fallen.has(fid)) return false;
    if (!crowd.removeResident(fid)) return false;
    fallen.set(fid, now() + RESPAWN_MS);
    onRoster(crowd);
    return true;
  }

  // Once a beat, from the sea. Two things it catches that `set` cannot: a volcano crowd that
  // is not the one the bodies were put in, and a settler at work who has been let go by the
  // chase - `release` puts a body back to idle, and it should be hammering at its own door.
  function tick() {
    if (adopt()) {
      fallen.clear();
      settle();
      publish(new Set(bodies));
      return true;
    }
    if (!crowd) return false;
    // Whoever's twenty seconds are up gets up at their own door. The same placeResident a
    // list uses, which sets a dead figure down at the door of whatever it lives in now - so a
    // lodger who was given a house while it lay there gets up at the house.
    if (fallen.size) {
      const t = now();
      let up = false;
      for (const [fid, at] of fallen) {
        if (at > t) continue;
        fallen.delete(fid);
        if (!bodies.has(fid)) continue;
        const e = entryOf(fid);
        if (crowd.placeResident(fid, houseOf(fid), { active: !!(e && e.active) })) up = true;
      }
      if (up) onRoster(crowd);
    }
    for (const l of lists.values()) for (const [fid, e] of l) {
      if (!e.active) continue;
      const f = crowd.figures.get(fid);
      if (f && !f.dead && f.mode === 'idle' && !f.chartered && !f.attend) crowd.walk.setMode(fid, 'hammer');
    }
    return false;
  }

  return {
    set, drop, tick, died,
    houses,
    down: () => fallen.size,
    // For the tests and /health: who has a body, and who has a house.
    bodies: () => bodies.size,
    housed: () => slotOf.size,
    pool: () => (pool ? pool.length : 0),
    slot: (fid) => (slotOf.has(fid) ? slotOf.get(fid) : null),
  };
}
