// How long you can keep Shift down, and how long it takes to get it back.
//
// Shift is one key with three meanings - a run on foot, a faster stroke in the water, the
// boat's turbo - but only two pools behind them (Plans/DONE/vulkaan-in-het-midden.md): the body,
// which running and swimming share because both are your own legs and lungs, and the boat.
// Both fill up in the background whichever one you are spending, so stepping off a hull you
// have just raced across the channel leaves you a full sprint, and the other way round.
//
// This lives on the page and nowhere else. Running used to be unlimited and the sea checks
// no speeds, so a pool somebody could empty in their devtools costs nothing a cheat did not
// already have; a speed check on the sea can come later without touching this.
//
// Kept DOM-free and clock-free - a pool is plain numbers, stepped by whatever dt its caller
// has - so tests/stamina.test.mjs can drain and refill one under bare Node, the same way
// boat.js keeps stepBoat clean of THREE.

// Seconds of full use that empty a pool, how long after letting go it starts to fill, and
// how long it then takes from empty to full. The one copy of each.
export const BODY = { drain: 6, delay: 1, refill: 5 };
export const BOAT = { drain: 4, delay: 1, refill: 6 };
// The horse's own pool (Plans/paard-in-plaats-van-fiets.md, "Het paard heeft zijn eigen adem"):
// forty seconds of gallop where a body has six - at HORSE_GALLOP 4.8 that is about 190 units, a
// gallop across a whole grown island rather than across the square - with a longer breath and
// twenty seconds to fill again at a walk or standing. A trot draws on it too, at
// mount.js's MOUNT_TROT_SHARE, so riding is not free for ever; how much each gait costs is
// mount.js's to say (`spendPool` below), the size of the lungs is here.
export const HORSE = { drain: 40, delay: 1.5, refill: 20 };

// Once a pool has run dry it stays shut until it is back to this. Without it an empty pool
// held on Shift flickers: a frame of regen buys a frame of turbo, which spends it, and the
// settler stutters between a run and a walk sixty times a second. A quarter is a
// noticeable pause (1.25 s of refill for the body, 1.5 s for the boat) and a sprint worth
// having when it comes back.
export const RECOVER_AT = 0.25;

export function createPool(spec) {
  // `spent` is the lock-out above; `rest` counts the seconds since the pool was last drawn
  // on, which is what the refill delay is measured against.
  return { spec, level: 1, spent: false, rest: Infinity };
}

// One step of one pool. `wants` is whether the player is asking for the boost this frame -
// Shift held and actually going somewhere - and the answer is whether they get it. Called
// every frame for both pools, the idle one with `wants` false, which is what fills it.
export function stepPool(pool, wants, dt) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return !!wants && canBoost(pool);
  const { drain, delay, refill } = pool.spec;
  if (wants && canBoost(pool)) {
    pool.level = Math.max(0, pool.level - dt / drain);
    pool.rest = 0;
    // The frame that empties it still gets its boost; the next one does not.
    if (pool.level === 0) pool.spent = true;
    return true;
  }
  // Held against an empty pool counts as resting: the lock-out is what refuses the boost,
  // and a pool that would not fill while you kept your finger on Shift would never open.
  const was = pool.rest;
  pool.rest = was + dt;
  // Only the part of this step that falls after the delay fills anything, so a long frame
  // straddling the moment it starts is not a whole frame's refill early.
  const filling = Math.min(dt, pool.rest - delay);
  if (filling > 0) pool.level = Math.min(1, pool.level + filling / refill);
  if (pool.spent && pool.level >= RECOVER_AT) pool.spent = false;
  return false;
}

// A pool drawn on by a share of its full drain - the horse's, whose trot costs a little and whose
// gallop costs all (mount.js) - rather than by a yes or no. `share` 0 is a rest and fills exactly
// as stepPool's does; any share above it spends `share * dt / drain`, holds the refill off and
// locks the pool at empty the same way. A share is spent even from a pool that is locked out:
// it is the gait being paid for, not a boost being asked for, and an empty horse at a trot
// does not get its breath back until it walks.
export function spendPool(pool, share, dt) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return;
  const s = typeof share === 'number' && Number.isFinite(share) ? Math.max(0, share) : 0;
  if (s > 0) {
    pool.level = Math.max(0, pool.level - s * dt / pool.spec.drain);
    pool.rest = 0;
    if (pool.level === 0) pool.spent = true;
    return;
  }
  stepPool(pool, false, dt);
}

export function canBoost(pool) {
  return !pool.spent && pool.level > 0;
}

// The pool the yellow bar is about: whatever Shift would spend right now. Aboard that is the
// boat's, in the saddle the horse's, and the body's quietly fills underneath where nobody needs
// to watch it.
export function shownPool(stamina, aboard, riding = false) {
  if (riding && stamina.horse) return stamina.horse;
  return aboard ? stamina.boat : stamina.body;
}
