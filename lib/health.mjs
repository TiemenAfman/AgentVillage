// A player's health, held by the sea. Only the sea knows that somebody has been hit - a
// guard's blow, a lava cell, and later another player's swing, are all decided here - so
// only the sea may say how much health is left: a page that kept its own count could simply
// declare itself whole again. Plans/vulkaan-in-het-midden.md has the decisions.
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
export const IMMUNE_MS = 5000;

// `oneHit` is what the island did before the bar counted (step 7 of the plan): every hit
// that lands is fatal and sends you back at once, whatever `amount` says. Off by default
// now; kept as an option because it is the quickest way back to the old island if the
// numbers turn out wrong in front of people, and because the chase's own tests are about
// who gets caught, not about how many blows it takes.
export function createHealth({ fleet, roster, now = () => Date.now(), oneHit = false }) {
  const bodies = new Map();   // player id -> { hp, hitAt, told: { hp, from } | null }
  const immunity = new Map(); // player id -> until

  // Health at `t`, the regeneration included. Worked out on read rather than stepped on a
  // timer: the sea does not have to touch a body every beat to heal it, and the page can do
  // the same sum from one message (see `tell`).
  const regen = (hp, from, t) => (t > from ? Math.min(MAX_HEALTH, hp + (t - from) / 1000 * REGEN_PER_S) : hp);
  const current = (b, t) => regen(b.hp, b.hitAt + REGEN_AFTER_MS, t);
  // What the page thinks, doing the same sum from the last thing it was told.
  const believed = (b, t) => (b.told ? regen(b.told.hp, b.told.from, t) : MAX_HEALTH);

  const immune = (id, t = now()) => (immunity.get(id) || 0) > t;

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
  const vulnerable = (p, t = now()) => !!p && !immune(p.id, t) && !!refuge(p);

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
    roster.evict(p, back.at, cause.island || null, back.boat);
    // Whole again at the square, and out of reach for a moment.
    b.hp = MAX_HEALTH;
    b.hitAt = -Infinity;
    immunity.set(p.id, t + IMMUNE_MS);
    tell(p, b, t);
    return 'evicted';
  }

  // Forget whoever has gone, and whatever has run out. A healed body is indistinguishable
  // from none at all - the page has filled its own bar by the same sum - so it goes too, and
  // the map stays the size of the fight rather than of everybody ever hit.
  function tick() {
    const t = now(), here = new Set(roster.all().map(p => p.id));
    for (const [id, until] of immunity) if (!here.has(id) || until <= t) immunity.delete(id);
    for (const [id, b] of bodies) {
      if (!here.has(id) || current(b, t) >= MAX_HEALTH) bodies.delete(id);
    }
  }

  const health = (p, t = now()) => { const b = p && bodies.get(p.id); return b ? current(b, t) : MAX_HEALTH; };

  return { hurt, health, immune, vulnerable, tick };
}
