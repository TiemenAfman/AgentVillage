// The sea owns pursuit. Coordinates in the roster are world-space; a crowd's paths and
// terrain remain island-local, including on a displaced home. What a guard's reach *does*
// is not decided here: contact is a `hurt` (lib/health.mjs), the one door for everything
// that harms a player, so the day a hit costs health instead of a trip home this file does
// not change.
import { findPath } from '../shared/settlerwalk.mjs';
import { SEA_LEVEL } from '../shared/terrain.mjs';

// Between walking (3.4) and running (6.6) in web/js/walk.js, on purpose: a sprint outruns
// them, and once the stamina is gone they catch you up. It was 2.4, which a walk left
// behind, so a guard was scenery you strolled away from.
export const GUARD_SPEED = 4.5;
// How far off the coast a guard will swim, in cells. Enough that ducking into the water
// right under the shore is no longer a safe way out; further out than this a swimmer is
// out of reach. Rivers are water too, so a river is now something a guard swims across.
export const GUARD_SWIM = 2;
// What one guard's reach costs. Irrelevant while every hit is fatal (see lib/health.mjs);
// the number the health bar will read once it counts.
export const GUARD_HIT = 34;

// Which cells a guard may stand in, per crowd: dry ground or a deck, and any water within
// GUARD_SWIM of one. Keyed by the crowd object, because a republish builds a new crowd with
// new decks and this must be worked out again for it - and it is gone with the old one.
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
  reaches.set(crowd, reach);
  return reach;
}

export function createHostility({ fleet, crowds, roster, health, now = () => Date.now() }) {
  const guards = new Map();
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
  function tick() {
    const time = now(), players = roster.all();
    const pilots = new Set(roster.boats.snapshot().map(b => b.pilot).filter(Boolean));
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
        if (!p.walking || p.room || pilots.has(p.id) || !health.vulnerable(p, time)) return false;
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
        if (distance < .65 && Math.abs(target.y - Math.max(f.y, SEA_LEVEL)) < 1.2) {
          health.hurt(target, GUARD_HIT, { kind: 'guard', island: island.bundle.island.name });
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
    for (const [f, record] of guards) {
      if (crowds.get(record.crowd.id) !== record.crowd || !fleet.get(record.crowd.id)?.bundle.island.hostile) free(f);
    }
  }
  return { tick };
}
