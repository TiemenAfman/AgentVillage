// The island as the land register sees it, one bit per super-cell, for the planner's own
// preview (web/js/plan-mode.js).
//
// The browser has to colour a hamlet green or red *while it is being dragged*, before the
// server has said anything, and the honest way to do that is not to teach it the rules.
// `Super.usable`, `polderCandidate` and the belt live in lib/layout.mjs beside the code
// that plans the island by them, and web/js/hamlets.js already carries one second copy of
// `blockOf` too many. So the server bakes the answers instead: every super-cell's
// buildable / beach / held / reclaimable bit and who owns it, as rows of characters, and
// the page reads a drop off that. The dry run on the server (POST /api/plan) stays the
// authority; this is what lets the page guess right first.
//
// Owners are given as an index into `village.districts`, which is the convention
// `decodeOwnership` in web/js/hamlets.js already paints by; -2 is the town and -1 nobody.
//
// `civics` is the same idea one grid cell at a time, for the town's own buildings: for each
// one the keeper may move, every corner it may be set down on (`civicSites` in
// lib/plan.mjs, which is also what the op asks). A dry run hands back the same thing for the
// island as the draft leaves it; this is the island as it stands.
import { makeTerrain } from '../shared/terrain.mjs';
import { Super, heldOf, zoneCells, polderCandidate, TOWN_CORE_R } from './layout.mjs';
import { civicSites } from './plan.mjs';

const TOWN = -2, NONE = -1;

export function buildSurvey({ layout, village, seed, size }) {
  const lat = layout && layout.lattice;
  if (!lat || !layout.town) return null;
  const terrain = makeTerrain(seed, { size, polders: layout.polders || [], fairway: layout.fairway || null, grow: layout.grow || null });
  const sup = new Super(terrain, lat, heldOf(layout));
  const R = sup.R, n = sup.n;

  const owner = new Int16Array(n * n).fill(NONE);
  const set = (i, j, k) => { if (sup.in(i, j)) owner[sup.di(i, j)] = k; };
  for (let j = -TOWN_CORE_R; j <= TOWN_CORE_R; j++) for (let i = -TOWN_CORE_R; i <= TOWN_CORE_R; i++) set(i, j, TOWN);
  for (const [i, j] of (layout.town.commons || [])) set(i, j, TOWN);
  const idx = new Map(((village && village.districts) || []).map((d, k) => [d.id, k]));
  for (const [id, rec] of Object.entries(layout.districts || {})) {
    const k = idx.has(id) ? idx.get(id) : TOWN;
    for (const lobe of rec.lobes || []) for (const [i, j] of lobe.cells) set(i, j, k);
  }

  const dredged = new Set([...(((layout.fairway || {}).cells) || []), ...zoneCells(layout)].map((c) => `${c[0]},${c[1]}`));
  const rows = (f) => {
    const out = [];
    for (let j = -R; j <= R; j++) {
      let s = '';
      for (let i = -R; i <= R; i++) s += f(i, j) ? '1' : '0';
      out.push(s);
    }
    return out;
  };
  const ownerRows = [];
  for (let j = -R; j <= R; j++) {
    const row = [];
    for (let i = -R; i <= R; i++) row.push(owner[sup.di(i, j)]);
    ownerRows.push(row);
  }
  return {
    lat, R, n, size,
    usable: rows((i, j) => sup.usable(i, j, false)),
    beach: rows((i, j) => sup.usable(i, j, true)),
    held: rows((i, j) => sup.heldBlock(i, j)),
    // The keeper's rule, not the ladder's: a super-cell the coast runs through may be painted.
    water: rows((i, j) => polderCandidate(terrain, lat, i, j, dredged, { shore: true })),
    owner: ownerRows,
    zones: layout.zones || [],
    civics: civicSites(layout, terrain),
    generatedAt: (village && village.generatedAt) || null,
  };
}
