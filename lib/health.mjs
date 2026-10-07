// A player's health, held by the sea. Only the sea knows that somebody has been hit - a
// guard's blow, a lava cell, and later another player's swing, are all decided here - so
// only the sea may say how much health is left: a page that kept its own count could simply
// declare itself whole again. Plans/DONE/vulkaan-in-het-midden.md has the decisions.
//
// `hurt` is the one door for everything that harms a player. Guards (lib/hostility.mjs)
// and lava (lib/lava.mjs) call it; players will later, with nothing else to learn. A hit
// costs `amount`; the one that empties the bar sends you back (roster.evict), whole, and
// out of reach for IMMUNE_MS.
//
// In memory like everything else the sea holds, and per connection: a body is made on the
// first hit, dropped when the player goes (`tick`), and nothing reaches the disk. A
// reconnect is a new id and therefore a fresh, whole body, which is the right answer for
// somebody who closed the tab mid-fight.
import { skiffOf } from './boats.mjs';

export const MAX_HEALTH = 100;
// Health comes back by itself once nobody has hurt you for this long. Any hurt counts as
// combat and starts the wait again - lava as much as a guard - so standing in a lava
// stream is never a place to heal: lib/lava.mjs hurts on every beat you stand in it.
export const REGEN_AFTER_MS = 3000;
// How fast, once it does. Four seconds from nothing to whole, after the three of quiet.
export const REGEN_PER_S = 25;
// After being sent back, nothing may hurt you for this long - the same five seconds the
// capture has always given, so the guard that caught you cannot catch you again at the
// square before you have seen where you are.
// Counted from the moment you are home, not from the blow (Plans/vallen-en-verdrinken.md): a page
// plays the fall or the drowning where it was caught first (walk.die, up to ~4.7 s) and only then
// jumps, so five seconds from the evict were mostly spent lying in the grass. The sea knows only
// poses, so "home" is the first pose after the evict within ARRIVE_R of the refuge. Until it
// comes - a pose from somewhere else is a body still going down - you are out of reach, for at
// most ARRIVE_MAX_MS; a socket that sends no pose at all after the evict keeps the old five
// seconds from the blow.
export const IMMUNE_MS = 5000;
export const ARRIVE_R = 4;
export const ARRIVE_MAX_MS = 6000;
// How often one player may ask to be taken home (`respawn`, issue #74). A respawn is a whole
// evict - every board, tiller and conversation let go, a message to the page - so a page that
// sends one per frame would be all of that sixty times a second; the bucket in
// lib/players.mjs alone would allow 25.
export const RESPAWN_EVERY_MS = 2000;

// `oneHit` is what the island did before the bar counted (step 7 of the plan): every hit
// that lands is fatal and sends you back at once, whatever `amount` says. Off by default
// now; kept as an option because it is the quickest way back to the old island if the
// numbers turn out wrong in front of people, and because the chase's own tests are about
// who gets caught, not about how many blows it takes.
export function createHealth({ fleet, roster, now = () => Date.now(), oneHit = false }) {
  const bodies = new Map();   // player id -> { hp, hitAt, told: { hp, from } | null }
  // player id -> { from, at: [x, z], poses, arrived, away } after an evict (see IMMUNE_MS)
  const immunity = new Map();
  const respawned = new Map(); // player id -> when they last asked to be taken home

  // Health at `t`, the regeneration included. Worked out on read rather than stepped on a
  // timer: the sea does not have to touch a body every beat to heal it, and the page can do
  // the same sum from one message (see `tell`).
  const regen = (hp, from, t) => (t > from ? Math.min(MAX_HEALTH, hp + (t - from) / 1000 * REGEN_PER_S) : hp);
  const current = (b, t) => regen(b.hp, b.hitAt + REGEN_AFTER_MS, t);
  // What the page thinks, doing the same sum from the last thing it was told.
  const believed = (b, t) => (b.told ? regen(b.told.hp, b.told.from, t) : MAX_HEALTH);

  const untilOf = (s) => (s.arrived != null ? s.arrived + IMMUNE_MS
    : s.away ? s.from + ARRIVE_MAX_MS + IMMUNE_MS : s.from + IMMUNE_MS);
  // What the poses since the evict say: home (immunity starts now), or still away (going down).
  // `p.poses` is lib/players.mjs's count of the poses it has taken.
  function observe(p, t) {
    const s = p && immunity.get(p.id);
    if (!s || s.arrived != null || (p.poses | 0) <= s.poses) return;
    if (Math.hypot(p.x - s.at[0], p.z - s.at[1]) <= ARRIVE_R) s.arrived = Math.min(t, s.from + ARRIVE_MAX_MS);
    else s.away = true;
  }
  const immune = (id, t = now()) => { const s = immunity.get(id); return !!s && untilOf(s) > t; };

  // Somewhere to be sent back to. An islander's is their own town square; a wanderer's -
  // the app on a phone, with no island at all - is their skiff (lib/boats.mjs), named so the
  // page climbs straight in rather than being set down on the water beside it. A wanderer
  // who has not launched one has nowhere to go, and a hit that could never end anywhere is
  // refused rather than half-applied.
  function refuge(p) {
    const home = fleet.get(p.island);
    if (home) {
      const centre = home.bundle.island.town?.centre || home.bundle.island.landing;
      if (!centre) return null;
      const [hx, hz] = home.terrain.cellWorld(...centre);
      return { at: [hx + home.origin[0], home.terrain.worldHeight(hx, hz), hz + home.origin[1]], boat: null };
    }
    const skiff = roster.boats.snapshot().find(b => b.id === skiffOf(p.id));
    return skiff ? { at: [skiff.x, 0, skiff.z], boat: skiff.id } : null;
  }

  // Whether a hit on `p` would land right now. What a guard asks before it bothers to chase.
  const vulnerable = (p, t = now()) => { observe(p, t); return !!p && !immune(p.id, t) && !!refuge(p); };

  // Privately, to the one it concerns: how much is left and when it starts coming back.
  // Relative times, not the sea's clock - the page's clock is somebody else's - and the rate
  // rides along so the page can fill the bar smoothly on its own, without the sea sending a
  // message every frame. Only said when there is something to say: after every hit that
  // leaves you standing (the number went down), and after being sent back if the page was
  // last told less than whole. A body the page has never been told is hurt is whole as far
  // as it knows, which is why a one-hit capture sends nothing beyond the `evicted`.
  function tell(p, b, t) {
    const hp = current(b, t);
    if (hp >= MAX_HEALTH && believed(b, t) >= MAX_HEALTH) return;
    b.told = { hp, from: b.hitAt + REGEN_AFTER_MS };
    const regenIn = Math.max(0, b.told.from - t);
    p.conn?.send(JSON.stringify({ t: 'health', hp: Math.round(hp), max: MAX_HEALTH, regenIn, rate: REGEN_PER_S }));
  }

  // `amount` in health points (a fraction is kept: a beat of lava is four and a bit, a
  // blocked blow ten and a bit, and rounding each would make the rate depend on the beat),
  // `cause` = { kind, island }: what did it ('guard', 'lava', later
  // 'player'), and the name of the place, which the page shows as where you were
  // sent back from. Returns false when the hit did not land (immune, or nowhere to be sent),
  // 'hurt' when it cost health and left you standing, 'evicted' when it sent you back.
  function hurt(p, amount, cause = {}) {
    const t = now();
    if (!vulnerable(p, t)) return false;
    const back = refuge(p);
    let b = bodies.get(p.id);
    if (!b) bodies.set(p.id, (b = { hp: MAX_HEALTH, hitAt: -Infinity, told: null }));
    b.hp = oneHit ? 0 : Math.max(0, current(b, t) - Math.max(0, amount || 0));
    b.hitAt = t;
    if (b.hp > 0) { tell(p, b, t); return 'hurt'; }
    // A drowning says so on the wire (`why`), so the page can say "out of breath" and not the
    // generic "sent you home"; every other cause leaves it off and the message is unchanged.
    roster.evict(p, back.at, cause.island || null, back.boat, cause.kind === 'drown' ? 'drown' : null);
    // Whole again at the square, and out of reach for a moment.
    b.hp = MAX_HEALTH;
    b.hitAt = -Infinity;
    immunity.set(p.id, { from: t, at: [back.at[0], back.at[2]], poses: p.poses | 0, arrived: null, away: false });
    tell(p, b, t);
    return 'evicted';
  }

  // Asked for by the player (`{t:'respawn'}`, the menu's Respawn to town - issue #74): taken
  // home along the same road a capture takes, to the same `refuge`, so where you come out is
  // the sea's to say and never the page's. What it is not is a capture: no health is taken or
  // given back, and no immunity granted - a respawn mid-fight brings the bar you had along,
  // or it would be the quickest heal on the island. `why: 'respawn'` tells the page it was
  // asked for. False when there is nowhere to go (a wanderer with no skiff), when they are
  // not on their feet in the world, or too soon after the last one, which lib/players.mjs says
  // back as `{t:'respawn', ok:false}`.
  function respawn(p) {
    const t = now();
    if (!p || !p.walking) return false;
    if (t - (respawned.get(p.id) ?? -Infinity) < RESPAWN_EVERY_MS) return false;
    const back = refuge(p);
    if (!back) return false;
    respawned.set(p.id, t);
    const name = fleet.get(p.island)?.bundle.island.name || null;
    roster.evict(p, back.at, name, back.boat, 'respawn');
    return true;
  }

  // Forget whoever has gone, and whatever has run out. A healed body is indistinguishable
  // from none at all - the page has filled its own bar by the same sum - so it goes too, and
  // the map stays the size of the fight rather than of everybody ever hit.
  function tick() {
    const t = now(), here = new Set(roster.all().map(p => p.id));
    for (const p of roster.all()) observe(p, t);
    for (const [id, s] of immunity) if (!here.has(id) || untilOf(s) <= t) immunity.delete(id);
    for (const [id, at] of respawned) if (!here.has(id) || t - at >= RESPAWN_EVERY_MS) respawned.delete(id);
    for (const [id, b] of bodies) {
      if (!here.has(id) || current(b, t) >= MAX_HEALTH) bodies.delete(id);
    }
  }

  const health = (p, t = now()) => { const b = p && bodies.get(p.id); return b ? current(b, t) : MAX_HEALTH; };

  return { hurt, respawn, health, immune, vulnerable, refuge, tick };
}
