// Where on the island a story animal can be (Plans/dierenverhalen.md): the doorstep, the
// garden and the roof of every settler's house, a patch for a newcomer to live in, a lookout
// for a goat, the landmark the mystery ends at, and a spot of honest ground for a mark.
//
// All of it island-local, the frame of shared/terrain.mjs and layout.json, and all of it
// worked out from village.json alone: the islander's scan has just written it, and the plots,
// doors and paving in it are exactly what the page draws and the sea walks around. Nothing
// here chooses between candidates by chance - the reducer does the choosing, off its own
// seeded stream; this file only says what the ground allows.
import { groundCheck } from './garden.mjs';
import { DOOR_DIR } from '../shared/settlerwalk.mjs';
import { hash32 } from '../shared/rng.mjs';

// How far outside the front wall a doorstep visitor stands, and how far to the side of the
// doorway: a settler stands in the middle of it (settlerwalk's `reach`), and a hen on
// exactly the same spot would be standing inside them.
const STEP_OUT = 0.45;
const STEP_ASIDE = 0.42;
// A garden spot is beside the house, this far out from its side wall.
const GARDEN_OUT = 0.7;
// Two marks never stand closer than this.
const TRACE_GAP = 0.7;
// How far the lookout search looks from a goat's home, in cells, and how steep is still a
// goat's kind of ground.
const LOOKOUT_REACH = 9;
const LOOKOUT_SLOPE = 2.4;

const round3 = (v) => Math.round(v * 1000) / 1000;
const HOUSED = new Set(['house', 'camp']);

// Everything paved: the square, the hamlets' own paving, every path and bridge. A mark is
// never put on flagstones (the bed check refuses them), and needs the list to know.
function pavedOf(village) {
  const out = [];
  const add = (cells) => { for (const c of cells || []) if (Array.isArray(c)) out.push([c[0], c[1]]); };
  add(village.island?.town?.paved);
  for (const d of village.districts || []) add(d.paved);
  for (const p of village.paths || []) add(p.cells);
  for (const b of village.bridges || []) add(b.cells);
  return out;
}

// `check` replaces the bed check in tests: `{ terrain, refuse(x, z) }`.
export function islandPlaces(village, { check = null } = {}) {
  const size = village.grid?.size;
  const g = check || groundCheck({
    seed: village.island.seed, gridSize: size, polders: village.polders || [],
    fairway: village.fairway || null, grow: village.grow || null, paved: pavedOf(village),
  });
  const t = g.terrain;
  const half = t.half;
  const cellOf = (x, z) => [Math.floor(x + half), Math.floor(z + half)];
  const key = (gx, gz) => gx + gz * t.size;

  // Every cell a building stands on: an animal is never sent into a wall, and a mark is
  // never put down inside somebody's kitchen.
  const built = new Set();
  const plotOf = new Map();
  for (const b of village.buildings || []) {
    const p = b.plot;
    if (!p) continue;
    plotOf.set(b.id, p);
    for (let dz = 0; dz < (p.d || 1); dz++) for (let dx = 0; dx < (p.w || 1); dx++) built.add(key(p.gx + dx, p.gz + dz));
  }

  // Somewhere an animal can stand: on the grid, on land, not inside a building. Paving is
  // fine for standing - a doorstep is usually next to the street.
  const standable = (x, z) => {
    const [gx, gz] = cellOf(x, z);
    return t.inGrid(gx, gz) && t.isLand(gx, gz) && !built.has(key(gx, gz));
  };
  // Somewhere a mark can stay: the bed check, and not in a building.
  const honest = (x, z) => {
    const [gx, gz] = cellOf(x, z);
    return !g.refuse(x, z) && !built.has(key(gx, gz));
  };

  const middleOf = (p) => [p.gx + (p.w || 1) / 2 - half, p.gz + (p.d || 1) / 2 - half];

  // The three spots on one plot, and the point an animal there faces (the house itself).
  function spotsOf(b) {
    const p = plotOf.get(b.id);
    if (!p) return null;
    const [cx, cz] = middleOf(p);
    const rot = (p.rot | 0) & 3;
    const [fx, fz] = DOOR_DIR[rot];
    // Half the plot in the door's direction, and half across it.
    const deep = (rot === 1 || rot === 3 ? p.w : p.d) / 2;
    const wide = (rot === 1 || rot === 3 ? p.d : p.w) / 2;
    const sx = -fz, sz = fx;                       // the door direction turned a quarter
    const at = (along, across) => [round3(cx + fx * along + sx * across), round3(cz + fz * along + sz * across)];
    const pickFirst = (cands) => cands.find(([x, z]) => standable(x, z)) || null;
    const door = pickFirst([at(deep + STEP_OUT, STEP_ASIDE), at(deep + STEP_OUT, -STEP_ASIDE), at(deep + STEP_OUT + 0.4, 0)]);
    const garden = pickFirst([
      at(0, wide + GARDEN_OUT), at(0, -(wide + GARDEN_OUT)), at(-(deep + GARDEN_OUT), 0),
      at(deep * 0.3, wide + GARDEN_OUT + 0.6), at(deep * 0.3, -(wide + GARDEN_OUT + 0.6)),
    ]);
    return { door, garden, roof: [round3(cx), round3(cz)], look: [round3(cx), round3(cz)] };
  }

  // The settlers as the reducer's `observe` wants them.
  function residents() {
    const out = [];
    for (const b of village.buildings || []) {
      if (!HOUSED.has(b.kind) || !b.plot) continue;
      const st = b.stats || {};
      const cursor = (st.humanTurns | 0) + (st.assistantMsgs | 0) + (st.toolCalls | 0);
      const spots = spotsOf(b);
      out.push({
        id: b.id, name: b.name || null, cursor: Math.max(0, cursor), active: !!b.active,
        lastAt: b.lastAt ? Date.parse(b.lastAt) || null : null, spots,
      });
    }
    return out;
  }

  // A patch to live in, for a newcomer: the garden of somebody's house (a hen, a goat) or
  // its roof (a sparrow), and a line saying where that is.
  function homeFor(species, b) {
    const sp = spotsOf(b);
    if (!sp) return null;
    const name = b.name || 'somebody';
    if (species === 'sparrow') return { x: sp.roof[0], z: sp.roof[1], r: 1.1, label: `by ${name}'s house` };
    const at = sp.garden || sp.door;
    if (!at) return null;
    return species === 'goat'
      ? { x: at[0], z: at[1], r: 1.3, label: `the grass behind ${name}'s house` }
      : { x: at[0], z: at[1], r: 0.8, label: `by ${name}'s house` };
  }

  // A goat's lookout: the highest ground a goat would stand on near home.
  function lookoutNear(home) {
    const [hx, hz] = cellOf(home.x, home.z);
    let best = null, bestY = -Infinity;
    for (let dz = -LOOKOUT_REACH; dz <= LOOKOUT_REACH; dz++) {
      for (let dx = -LOOKOUT_REACH; dx <= LOOKOUT_REACH; dx++) {
        if (dx * dx + dz * dz > LOOKOUT_REACH * LOOKOUT_REACH) continue;
        const gx = hx + dx, gz = hz + dz;
        if (!t.inGrid(gx, gz) || !t.isLand(gx, gz) || t.isBeach(gx, gz) || built.has(key(gx, gz))) continue;
        if (t.slope(gx, gz) > LOOKOUT_SLOPE) continue;
        const y = t.heightAt(gx, gz);
        // Ties go to the nearer cell, so the answer does not depend on scan order.
        if (y > bestY + 1e-6 || (Math.abs(y - bestY) <= 1e-6 && best && dx * dx + dz * dz < best.d)) {
          bestY = y;
          best = { at: t.cellWorld(gx, gz), d: dx * dx + dz * dz };
        }
      }
    }
    return best ? [round3(best.at[0]), round3(best.at[1])] : null;
  }

  // Where the mystery ends: the lighthouse if the island has one, else the town hall, else
  // the square.
  function landmark() {
    const find = (type) => (village.buildings || []).find((b) => b.kind === 'civic' && b.civicType === type && b.plot);
    const lh = find('lighthouse');
    const hall = lh ? null : find('townhall');
    const b = lh || hall;
    if (b) {
      const sp = spotsOf(b);
      const at = (sp && sp.door) || middleOf(b.plot);
      return { at: [round3(at[0]), round3(at[1])], label: lh ? 'lighthouse' : 'town hall' };
    }
    const c = village.island?.town?.centre;
    return c ? { at: t.cellWorld(c[0], c[1]), label: 'square' } : null;
  }

  // Ground for a mark near `near`: the nearest honest spot, spiralling out a cell at a
  // time, a mark's width from every mark already down. Null when there is none - the
  // discovery is kept and this is asked again on the next scan.
  function traceSpot(near, placed = []) {
    if (!near) return null;
    const [nx, nz] = near;
    // Six rings of 0.6: a doorstep is usually against the street, and three rings (1.8 units)
    // left the first find of the mystery on the proof island waiting for ground for good.
    for (let ring = 0; ring <= 6; ring++) {
      const cands = [];
      const steps = ring === 0 ? [[0, 0]] : [];
      for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === ring && ring > 0) steps.push([dx, dz]);
      }
      for (const [dx, dz] of steps) cands.push([round3(nx + dx * 0.6), round3(nz + dz * 0.6)]);
      for (const [x, z] of cands) {
        if (!honest(x, z)) continue;
        if (placed.some((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < TRACE_GAP * TRACE_GAP)) continue;
        return { x, z, rot: hash32(`${x},${z}`) & 3 };
      }
    }
    return null;
  }

  return { terrain: t, half, residents, spotsOf, homeFor, lookoutNear, landmark, traceSpot, standable, honest };
}
