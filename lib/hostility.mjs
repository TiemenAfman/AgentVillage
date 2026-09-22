// The sea owns pursuit and capture. Coordinates in the roster are world-space;
// a crowd's paths and terrain remain island-local, including on a displaced home.
import { findPath } from '../shared/settlerwalk.mjs';

export function createHostility({ fleet, crowds, roster, now = () => Date.now() }) {
  const guards = new Map();
  const immunity = new Map();
  let nextPlan = 0;
  const cell = (t, x, z) => [Math.floor(x + t.half), Math.floor(z + t.half)];
  function free(f, crowd) {
    crowd.walk.release(f.id);
    guards.delete(f);
  }
  function tick() {
    const time = now(), players = roster.all();
    for (const id of immunity.keys()) if (!players.some(p => p.id === id) || immunity.get(id) <= time) immunity.delete(id);
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
      const t = island.terrain, [ox, oz] = island.origin;
      const visitors = players.filter(p => {
        if (!p.walking || p.island === island.id || !fleet.get(p.island) || p.room || pilots.has(p.id) || (p.f & 2) || immunity.has(p.id)) return false;
        const x = p.x - ox, z = p.z - oz;
        return Math.abs(x) < t.half && Math.abs(z) < t.half && crowd.walk.groundOrDeck(x, z) >= 0;
      });
      const candidates = [...crowd.figures.values()].filter(f => f.visible && !f.aboard && (!f.chartered || guards.has(f)));
      // Oldest route first prevents the nearest three from consuming every replan.
      candidates.sort((a, b) => (guards.get(a)?.planned || 0) - (guards.get(b)?.planned || 0));
      for (const f of candidates) {
        let target = null, distance = Infinity;
        for (const p of visitors) {
          if (immunity.has(p.id)) continue;
          const d = Math.hypot(p.x - ox - f.pos[0], p.z - oz - f.pos[1]);
          if (d < distance) { target = p; distance = d; }
        }
        if (!target) { if (guards.has(f)) free(f, crowd); continue; }
        if (distance < .65 && Math.abs(target.y - f.y) < 1.2) {
          const home = fleet.get(target.island);
          const centre = home.bundle.island.town?.centre || home.bundle.island.landing;
          if (!centre) continue;
          const [hx, hz] = home.terrain.cellWorld(...centre);
          roster.evict(target, [hx + home.origin[0], home.terrain.worldHeight(hx, hz), hz + home.origin[1]], island.bundle.island.name);
          immunity.set(target.id, time + 5000);
          continue;
        }
        if (!plan || budget <= 0) continue;
        budget--;
        const x = target.x - ox, z = target.z - oz;
        // Decks are walkable too. Keep the physical terrain intact; only this path
        // query sees boardwalk cells as land, through the same floor as the feet.
        const ground = { ...t, isLand: (gx, gz) => crowd.walk.groundOrDeck(...t.cellWorld(gx, gz)) >= 0 };
        const route = findPath(ground, cell(t, ...f.pos), cell(t, x, z), null);
        guards.set(f, { crowd, planned: time });
        if (!route) continue;
        if (!f.chartered) crowd.walk.charter(f.id);
        crowd.walk.unattend(f.id);
        crowd.walk.sendOut(f.id, [...route.slice(1), [x, z]], null);
        f.speed = 2.4;
      }
    }
    // Re-publishing replaces figure objects; disconnected islands and old crowds
    // must not keep either their guards or their targets alive in this controller.
    for (const [f, record] of guards) {
      if (crowds.get(record.crowd.id) !== record.crowd || !fleet.get(record.crowd.id)?.bundle.island.hostile) free(f, record.crowd);
    }
  }
  return { tick };
}
