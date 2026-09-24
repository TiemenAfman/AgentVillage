// The sea owns pursuit. Coordinates in the roster are world-space; a crowd's paths and
// terrain remain island-local, including on a displaced home. What a guard's blow *does*
// is not decided here: it is a `hurt` (lib/health.mjs), the one door for everything that
// harms a player. What is decided here is when a blow falls - within reach, once per
// GUARD_SWING_MS per guard - how hard, and how much of it a raised shield takes.
import { findPath } from '../shared/settlerwalk.mjs';
import { SEA_LEVEL } from '../shared/terrain.mjs';
import { isCodex } from '../shared/volcano.mjs';
import { POSE } from './players.mjs';

// Between walking (3.4) and running (6.6) in web/js/walk.js, on purpose: a sprint outruns
// them, and once the stamina is gone they catch you up. It was 2.4, which a walk left
// behind, so a guard was scenery you strolled away from.
export const GUARD_SPEED = 4.5;
// How far off the coast a guard will swim, in cells. Enough that ducking into the water
// right under the shore is no longer a safe way out; further out than this a swimmer is
// out of reach. Rivers are water too, so a river is now something a guard swims across.
export const GUARD_SWIM = 2;
// A floor this far above the terrain is something built over it - a bridge, a deck. The one
// copy: lib/lava.mjs lets whoever stands on one off by it, and the reach mask below keeps a
// bridged lava cell walkable by it, so the two agree about where the planks are.
export const DECK_CLEAR = 0.05;
// What one guard's blow costs: ten of them empty a whole bar (lib/health.mjs MAX_HEALTH
// 100). It was 34 - three blows - and three guards arriving together each swung on their
// first beat in reach, so a bar went in one instant with no swing on the screen at all:
// "nearly dead in one blow". Low enough now that a fight is something you can read and
// answer, with the wind-up below as the moment to raise a shield or step back.
export const GUARD_HIT = 10;
// A Codex settler's blow. They chase like a guard - they are residents of the same hostile
// crowd - but they are somebody's sessions housed on a mountain, not its garrison, so they
// hit for a little over half of a guard. Lower rather than equal
// so the guardhouse stays the dangerous part of the volcano and a street of huts is not a
// second one with no warning.
export const RESIDENT_HIT = 6;
// How close a guard has to be to land one: the contact distance the chase always used.
export const GUARD_REACH = 0.65;
// And how often one guard may swing. A blow per beat (66 ms) would take a whole bar in
// three beats - a fifth of a second, less than a page can even draw the first one - so
// each guard has a cooldown of its own, a little longer than a player's swing (0.45 s in
// lib/combat.mjs) so a player who stands and fights trades more blows than they take from
// any one guard. Two guards on you are two cooldowns, which is the point of numbers.
export const GUARD_SWING_MS = 1400;
// A blow is announced before it lands: the sea says `{t:'agent', a:'swing'}` the moment a
// guard starts one, every page plays the attack (the imp's `attack` clip, a settler's
// sword arm), and the damage follows this much later - the strike frame of that clip,
// measured on the real GLB (the claws sweep forward between 0.45 and 0.6 s of its 1.25 s).
// Before this the blow was instant and the page's attack was its own guess, so what hurt you
// and what you saw were two unrelated things. The wait is also the fairness: a shield raised,
// or a step back out of reach, during it counts.
export const GUARD_WINDUP_MS = 550;
// How far out of GUARD_REACH a target may have got by the time a blow lands and still be
// hit: a claw's sweep is longer than the contact distance a chase stops at, and without
// any slack a player merely turning round walked out of every blow.
export const REACH_SLACK = 0.35;
// How many agents may swing at one player at once. The chase still sends everybody - a
// crowd round you is the point of numbers - but past this the rest wait their turn in
// reach, the way a crowd in a game takes turns: measured before this, four guards on one
// player emptied a whole bar in two and a half seconds, before anybody could read the
// fight let alone answer it. A place is held for a swing and ENGAGE_GRACE_MS more, so the
// same three keep at it rather than the whole ring trading places blow by blow.
export const MAX_ATTACKERS = 3;
const ENGAGE_GRACE_MS = 300;
// What a blocked blow still costs, as a fraction: a shield takes the edge off, it does not
// make you a wall. Lava is not blocked at all (lib/lava.mjs never asks).
export const BLOCK_FRACTION = 0.3;
// A shield carried is armour whether or not it is raised: each hand holding one takes this
// fraction off every blow from an agent, and a shield in both hands stacks to twice it. The
// page says which hands hold one in the pose (POSE.SHIELD_LEFT / SHIELD_RIGHT) - the sea has
// no other way to know what somebody carries, and a client claiming two shields it does not
// have wins itself what a client claiming BLOCKING already could. Lava ignores armour.
export const SHIELD_ARMOR = 0.25;
// The front of a player, as a cosine: 0.5 is sixty degrees either side of the way they
// face. The same arc for the two things that need one - which blows a shield catches, and
// which agent a swing can reach (lib/combat.mjs) - so what you can hit is what you can block.
export const FRONT_ARC_COS = 0.5;

// Whether the point (x, z), in world coordinates, is inside `p`'s front arc. The heading is
// the pose's own `yaw`, which web/js/walk.js sets from the direction of travel as
// atan2(vx, vz) - so facing is (sin yaw, cos yaw) - and web/js/net.js sends with every pose
// (and again whenever it turns past TURNED). A point right on top of them is in front: at
// no distance there is no direction to be wrong about.
export function inFront(p, x, z, cos = FRONT_ARC_COS) {
  const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  const yaw = Number.isFinite(p.yaw) ? p.yaw : 0;
  return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d >= cos;
}

// Whether `p` is holding a shield up in the way of a blow from (x, z). Not while swimming:
// the page raises no shield in the water (Plans/aanvallen-en-blokkeren.md), and a flag that
// says otherwise is a client that is not to be believed about it.
export const blocking = (p, x, z) => !!p && (p.f & POSE.BLOCKING) !== 0 && (p.f & POSE.SWIMMING) === 0 && inFront(p, x, z);

// The fraction of an agent's blow `p`'s shields take off: SHIELD_ARMOR per hand holding one.
export const armorOf = (p) => (!p ? 0 : ((p.f & POSE.SHIELD_LEFT) ? SHIELD_ARMOR : 0) + ((p.f & POSE.SHIELD_RIGHT) ? SHIELD_ARMOR : 0));

// What a blow of `full` from (x, z) costs `p`: armour first, then a raised shield on top.
export function blowOn(p, full, x, z) {
  const worn = full * (1 - armorOf(p));
  return blocking(p, x, z) ? worn * BLOCK_FRACTION : worn;
}

// Which cells a guard may stand in, per crowd: dry ground or a deck, and any water within
// GUARD_SWIM of one - but never lava (shared/terrain.mjs `isLava`, the volcano's flows and
// its crater pool), which is taken out after the swim strip is grown, so a flow is not
// "water beside land" either. That is what makes a lava stream something a player can
// shake a guard off across: the search goes round it or gives up. Keyed by the crowd object,
// because a republish builds a new crowd with new decks and this must be worked out again
// for it - and it is gone with the old one.
const reaches = new WeakMap();
function reachOf(crowd, t) {
  let reach = reaches.get(crowd);
  if (reach) return reach;
  const n = t.size, land = new Uint8Array(n * n);
  reach = new Uint8Array(n * n);
  // Through the same floor as the feet: the physical terrain stays as it is, and only this
  // query sees boardwalk cells as land.
  for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
    land[gx + gz * n] = crowd.walk.groundOrDeck(...t.cellWorld(gx, gz)) >= SEA_LEVEL ? 1 : 0;
  }
  const r = GUARD_SWIM;
  for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
    if (!land[gx + gz * n]) continue;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = gx + dx, z = gz + dz;
      if (dx * dx + dz * dz <= r * r && x >= 0 && z >= 0 && x < n && z < n) reach[x + z * n] = 1;
    }
  }
  // Every terrain carries isLava (empty on an ordinary island); a hand-built one in a test
  // may not, and has no lava to leave out. A lava cell with a bridge over it stays in: the
  // deck is ground, by the same rule lib/lava.mjs lets somebody standing on it off by - a
  // floor more than DECK_CLEAR over the terrain - so the bridges are the one way across a
  // flow, for a guard as for anybody.
  if (t.isLava) {
    for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
      if (!t.isLava(gx, gz)) continue;
      const [x, z] = t.cellWorld(gx, gz);
      if (crowd.walk.groundOrDeck(x, z) > t.worldHeight(x, z) + DECK_CLEAR) continue;
      reach[gx + gz * n] = 0;
    }
  }
  reaches.set(crowd, reach);
  return reach;
}

// Who has feet anywhere for something on the ground to reach: walking, outdoors, not at a
// tiller, and with at least one pose behind them. The last is lib/players.mjs's `posed`:
// a socket that has said it is walking but not yet where is standing at [0, 0] as far as
// the roster knows - the middle of the volcano - and a page that has not learnt its berth
// yet would be caught there while its player stands on their own island. `=== false` so a
// hand-built player in a test, which has no such field, counts as posed.
//
// Shared by the chase below and the lava (lib/lava.mjs): the plan says they use the same
// filters, and two copies of this line would be two answers to who can be hurt.
export function afoot(p, pilots) {
  return !!p && p.walking && !p.room && p.posed !== false && !pilots.has(p.id);
}
export const pilotsOf = (roster) => new Set(roster.boats.snapshot().map(b => b.pilot).filter(Boolean));

export function createHostility({ fleet, crowds, roster, health, broadcast = () => {}, now = () => Date.now() }) {
  const guards = new Map();
  // When each figure may swing again. Keyed by the figure object, like `reaches` by the
  // crowd: a republished crowd has new figures, and a guard who falls and comes back is the
  // same object and keeps his cooldown, which is no advantage to anybody.
  const readyAt = new WeakMap();
  // Who is fighting whom: player id -> Map(figure -> until). A guard that swung at somebody
  // holds a place at them for a swing and a bit; see MAX_ATTACKERS.
  const engaged = new Map();
  function mayEngage(id, f, time) {
    let at = engaged.get(id);
    if (!at) engaged.set(id, (at = new Map()));
    for (const [g, until] of at) if (until <= time || g.dead) at.delete(g);
    if (!at.has(f) && at.size >= MAX_ATTACKERS) return false;
    at.set(f, time + GUARD_SWING_MS + ENGAGE_GRACE_MS);
    return true;
  }
  // Blows on their way: started, announced, and landing at `at`. Resolved on the beat, from
  // where the guard and the target are *then* - see GUARD_WINDUP_MS.
  let pending = [];
  let nextPlan = 0;
  const cell = (t, x, z) => [Math.floor(x + t.half), Math.floor(z + t.half)];
  function free(f) {
    const record = guards.get(f);
    record.crowd.walk.release(f.id);
    // Back to the pace they had before the chase. `release` does not touch the speed, and
    // a guard let go thirty cells from its door otherwise sprints the whole way home.
    f.speed = record.speed;
    guards.delete(f);
  }
  // The blows whose wind-up is over. A target who has gone, boarded, gone indoors or out of
  // reach meanwhile is missed; a guard who fell or whose crowd was rebuilt swings at nothing.
  function land(time, players, pilots) {
    if (!pending.length) return;
    const byId = new Map(players.map(p => [p.id, p]));
    pending = pending.filter((b) => {
      if (b.at > time) return true;
      const { f, crowd, island } = b, p = byId.get(b.target);
      if (f.dead || !f.visible || crowds.get(crowd.id) !== crowd || !afoot(p, pilots)) return false;
      const [ox, oz] = island.origin, wx = f.pos[0] + ox, wz = f.pos[1] + oz;
      if (Math.hypot(p.x - wx, p.z - wz) > GUARD_REACH + REACH_SLACK) return false;
      if (Math.abs(p.y - Math.max(f.y, SEA_LEVEL)) >= 1.2) return false;
      health.hurt(p, blowOn(p, b.full, wx, wz), { kind: 'guard', island: island.bundle.island.name });
      return false;
    });
  }
  function tick() {
    const time = now(), players = roster.all();
    const pilots = pilotsOf(roster);
    land(time, players, pilots);
    const plan = time >= nextPlan;
    if (plan) nextPlan = time + 650;
    // Limit path searches per beat, then rotate through the guards. A village of
    // hundreds must not run hundreds of A* searches when a visitor takes one step.
    let budget = 3;
    for (const island of fleet.all()) {
      if (!island.bundle.island.hostile) continue;
      const crowd = crowds.get(island.id);
      if (!crowd) continue;
      const t = island.terrain, [ox, oz] = island.origin, reach = reachOf(crowd, t);
      // Everybody is a target, their own island's people included: a hostile island is
      // nobody's, and the volcano it is becoming will be owned by nobody at all. A swimmer
      // counts too, as long as they are inside the strip a guard can swim - the swimming
      // flag no longer protects anyone, the distance from the shore does.
      const targets = players.filter(p => {
        if (!afoot(p, pilots) || !health.vulnerable(p, time)) return false;
        const [gx, gz] = cell(t, p.x - ox, p.z - oz);
        return gx >= 0 && gz >= 0 && gx < t.size && gz < t.size && reach[gx + gz * t.size] === 1;
      });
      const candidates = [...crowd.figures.values()].filter(f => f.visible && !f.aboard && (!f.chartered || guards.has(f)));
      // Oldest route first prevents the nearest three from consuming every replan.
      candidates.sort((a, b) => (guards.get(a)?.planned || 0) - (guards.get(b)?.planned || 0));
      for (const f of candidates) {
        let target = null, distance = Infinity;
        for (const p of targets) {
          // Somebody another guard sent home a moment ago in this same beat.
          if (health.immune(p.id, time)) continue;
          const d = Math.hypot(p.x - ox - f.pos[0], p.z - oz - f.pos[1]);
          if (d < distance) { target = p; distance = d; }
        }
        if (!target) { if (guards.has(f)) free(f); continue; }
        // A guard in the water is at the surface, swimming, not walking the sea bed where
        // the walk puts its feet - measured from there, a swimmer two cells out was a metre
        // and more "below" a guard right beside them and could not be reached at all.
        if (distance < GUARD_REACH && Math.abs(target.y - Math.max(f.y, SEA_LEVEL)) < 1.2) {
          // Within reach. A swing if this one's arm is ready - announced now, landing after
          // GUARD_WINDUP_MS (land() above) - and nothing new either way: a guard standing
          // on you has no route to plan.
          if ((readyAt.get(f) || 0) <= time && mayEngage(target.id, f, time)) {
            readyAt.set(f, time + GUARD_SWING_MS);
            const full = isCodex(f.id) ? RESIDENT_HIT : GUARD_HIT;
            pending.push({ f, crowd, island, target: target.id, full, at: time + GUARD_WINDUP_MS });
            broadcast({ t: 'agent', a: 'swing', i: island.id, id: f.id });
          }
          continue;
        }
        if (!plan || budget <= 0) continue;
        budget--;
        const x = target.x - ox, z = target.z - oz;
        const ground = { ...t, isLand: (gx, gz) => reach[gx + gz * t.size] === 1 };
        const route = findPath(ground, cell(t, ...f.pos), cell(t, x, z), null);
        guards.set(f, { crowd, planned: time, speed: guards.get(f)?.speed ?? f.speed });
        if (!route) continue;
        if (!f.chartered) crowd.walk.charter(f.id);
        crowd.walk.unattend(f.id);
        // A route through the strip is walked like any other: sendOut follows its points in
        // straight lines and never asks the ground whether it is dry, so a guard swims
        // exactly where the search said it may - and nowhere else, since the search is the
        // only thing that ever sends it into the water.
        crowd.walk.sendOut(f.id, [...route.slice(1), [x, z]], null);
        f.speed = GUARD_SPEED;
      }
    }
    // Re-publishing replaces figure objects; disconnected islands and old crowds
    // must not keep either their guards or their targets alive in this controller.
    // A guard who fell mid-chase (lib/combat.mjs) is let go too: his record would otherwise
    // hold the pace he had before the chase until he came back, and outlive him if he never did.
    // And the fights nobody is in any more, so the map is the size of the fighting.
    for (const [id, at] of engaged) {
      for (const [g, until] of at) if (until <= time || g.dead) at.delete(g);
      if (!at.size) engaged.delete(id);
    }
    for (const [f, record] of guards) {
      if (f.dead || crowds.get(record.crowd.id) !== record.crowd || !fleet.get(record.crowd.id)?.bundle.island.hostile) free(f);
    }
  }
  return { tick };
}
