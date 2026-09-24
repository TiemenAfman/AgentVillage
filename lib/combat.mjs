// A player hitting back. Step 7 of Plans/vulkaan-in-het-midden.md (Besluiten: "Levens van
// agents", "Respawn") and the swing of Plans/aanvallen-en-blokkeren.md, on the sea's side.
//
// The page sends `{t:'swing'}` and nothing else: no target, no position, no damage. Where the
// blow lands is worked out here from the player's last pose - its position and its `yaw`,
// the heading web/js/walk.js sends with every pose - so a client can claim to have swung and
// nothing more. Whatever it says, it cannot hit what is not in front of it, cannot hit more
// often than SWING_MS, and cannot hit for more than PLAYER_HIT.
//
// Agents - the volcano's guards and the Codex settlers housed on it - have AGENT_HEALTH each,
// held here per figure in memory, like everything else the sea holds. At nothing they fall
// through the controller that owns them: a guard through lib/guards.mjs `guardDied` (back
// out of the guardhouse after twenty seconds, if the count is still under the target then),
// a resident through lib/residents.mjs `died` (back at its own door after twenty seconds).
// Both take the figure out of the running crowd as a hole in the roster and put it back the
// same way - never a rebuild, which would walk everybody else back to their doors.
//
// No regeneration for agents, on purpose: a guard left at a quarter is a guard somebody can
// come back and finish, and the page can draw what it was last told without a clock to keep.
// A fall is the only thing that makes one whole again.
import { isGuard, isCodex } from '../shared/volcano.mjs';
import { SEA_LEVEL } from '../shared/terrain.mjs';
import { afoot, pilotsOf, inFront } from './hostility.mjs';
import { POSE } from './players.mjs';

// Four blows of a player's to fell an agent (PLAYER_HIT 25).
export const AGENT_HEALTH = 100;
// A player's blow. Flat: the sword, the hammer and the bare fist all hit for the same,
// because nothing about what somebody holds reaches the sea (the avatar's look is the
// page's) and a number the client picks is a number the client lies about.
export const PLAYER_HIT = 25;
// How often one player may land one: the length of the swing the page animates (0.45 s,
// web/js/classic-avatar.js), so a blow the sea accepts is one the page could have drawn.
export const SWING_MS = 450;
// How far a swing reaches, from the player's middle to the agent's: an arm and a sword.
// A little past a guard's own reach (0.65, lib/hostility.mjs) so a player who has turned to
// face a guard in reach of them can always answer it.
export const SWING_REACH = 0.9;
// And how far above or below: the same slack the guard's blow is given, measured from the
// water's surface for somebody swimming (see lib/hostility.mjs).
const SWING_RISE = 1.2;

export function createCombat({ fleet, crowds, roster, guards, residents, broadcast = () => {}, now = () => Date.now() }) {
  // Health per agent, by figure object. A figure that falls is forgotten, so whatever
  // stands up in its place - the same object for a guard, maybe a new one for a resident -
  // starts whole; a republished crowd has new figures and starts whole too.
  const hp = new WeakMap();
  const lastSwing = new Map();   // player id -> when their last swing was accepted

  // Who can be hit: somebody standing (not a hole, not aboard an outing) who is a guard or a
  // Codex resident, on an island that is hostile. The residents of an old islander's own
  // hostile Codex island (a world of mixed versions) carry building ids and are not in it:
  // there is nobody to bring them back, since a republish is their only respawn.
  const hittable = (f) => f && f.visible && !f.dead && !f.aboard && (isGuard(f.id) || isCodex(f.id));

  // The agent in front of `p` and nearest to them, if any is in reach: { island, crowd, f }.
  function targetOf(p) {
    let best = null, bestD = SWING_REACH;
    for (const island of fleet.all()) {
      if (!island.bundle.island.hostile) continue;
      const crowd = crowds.get(island.id);
      if (!crowd) continue;
      const [ox, oz] = island.origin;
      for (const f of crowd.figures.values()) {
        if (!hittable(f)) continue;
        const x = f.pos[0] + ox, z = f.pos[1] + oz;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d > bestD) continue;
        if (Math.abs(p.y - Math.max(f.y, SEA_LEVEL)) > SWING_RISE) continue;
        if (!inFront(p, x, z)) continue;
        best = { island, crowd, f };
        bestD = d;
      }
    }
    return best;
  }

  // `amount` off one agent, said to everybody, and a fall if that was the last of it.
  // Returns the health left, or null for a figure nobody can hit.
  function strike(island, f, amount) {
    if (!hittable(f)) return null;
    const left = Math.max(0, (hp.has(f) ? hp.get(f) : AGENT_HEALTH) - amount);
    // Everybody watching that island, the fatal blow included: the page shows the bar from
    // this and nothing else. The fall itself travels the roster's way (a hole) right after.
    broadcast({ t: 'agent', a: 'hit', i: island.id, id: f.id, hp: Math.round(left), max: AGENT_HEALTH });
    if (left > 0) { hp.set(f, left); return left; }
    hp.delete(f);
    if (isGuard(f.id)) guards.guardDied(f.id);
    else residents.died(f.id);
    return 0;
  }

  // `{t:'swing'}` from `p`. On foot, outdoors, not at a tiller (hostility's `afoot`, the same
  // filter that decides who can be hurt), and not in the water - no swing there, as the page
  // has none. A raised shield no longer stops it: each mouse button is one hand now
  // (web/js/walk.js), so a sword in one and a shield in the other attack and block at once,
  // which is the whole point of carrying both. A swing that finds nobody costs the player
  // their cooldown all the same (it was a swing) and sends nothing to anybody.
  function swing(p) {
    const t = now();
    if (!p || !afoot(p, pilotsOf(roster))) return false;
    if (p.f & POSE.SWIMMING) return false;
    const last = lastSwing.get(p.id);
    if (last !== undefined && t - last < SWING_MS) return false;
    lastSwing.set(p.id, t);
    const hit = targetOf(p);
    if (!hit) return false;
    strike(hit.island, hit.f, PLAYER_HIT);
    return true;
  }

  // Forget the cooldowns of whoever has gone, so the map is the size of the fight.
  function tick() {
    if (!lastSwing.size) return;
    const here = new Set(roster.all().map((p) => p.id)), t = now();
    for (const [id, at] of lastSwing) if (!here.has(id) || t - at >= SWING_MS) lastSwing.delete(id);
  }

  return { swing, strike, tick, health: (f) => (hp.has(f) ? hp.get(f) : AGENT_HEALTH) };
}
