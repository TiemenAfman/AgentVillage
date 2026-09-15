// A village model built by hand, so the layout tests can drive `placeAll` directly without
// scanning a single transcript. Everything here is a fixed number: `placeAll` sorts houses
// on `startedAt` and districts on `firstSeenAt`, so a clock would make the tests flap.
//
// Only the fields `lib/layout.mjs` actually reads are present. That is deliberate - if a
// future placement rule starts reading a new field, these fixtures fail loudly rather than
// silently placing everything on a default.

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const SEP = String.fromCharCode(92);      // a backslash, spelled out so no quoting eats it

/**
 * @param {Array<{name: string, houses: number, gitRepo?: boolean, sheds?: number}>} specs
 *        One entry per district, in the order they were first seen.
 * @param {{milestones?: string[], settlers?: number}} opts
 */
export function makeModel(specs, opts = {}) {
  const districts = [];
  const buildings = [];

  specs.forEach((spec, di) => {
    // A made-up path, never this machine's. Real district ids are absolute paths
    // (`p:d:\git\...`) and this repo is public, so a fixture must not carry them.
    const id = 'p:c:' + SEP + 'work' + SEP + spec.name;
    districts.push({
      id,
      kind: 'project',
      name: spec.name,
      firstSeenAt: T0 + di * 86400_000,           // one district per day
      population: spec.houses,
      gitRepo: spec.gitRepo !== false,
    });

    for (let h = 0; h < spec.houses; h++) {
      const houseId = `house:${spec.name}-${String(h).padStart(3, '0')}`;
      buildings.push({
        id: houseId,
        sessionId: `${spec.name}-${h}`,
        kind: 'house',
        district: id,
        // Keyed on (district, index), never on a running counter: adding a house to one
        // district must not renumber the arrival times of every district after it.
        startedAt: T0 + di * 3600_000 + h * 60_000,
        tier: 'cottage',
        harbour: false,
      });
      for (let s = 0; s < (spec.sheds || 0); s++) {
        buildings.push({
          id: `shed:${spec.name}-${String(h).padStart(3, '0')}:${s}`,
          kind: 'shed',
          district: id,
          master: houseId,
          startedAt: T0 + di * 3600_000 + h * 60_000 + (s + 1) * 1_000,
          tier: 'shed',
          roomed: false,
        });
      }
    }
  });

  const settlers = opts.settlers ?? buildings.filter((b) => b.kind !== 'shed').length;

  return {
    districts,
    buildings,
    milestones: (opts.milestones || []).map((civicType) => ({
      id: civicType, civicType, unlocked: true, at: 1, on: 'settlers',
    })),
    furniture: [],
    stats: { settlers, apprentices: buildings.filter((b) => b.kind === 'shed').length },
    arrivals: buildings.filter((b) => b.kind !== 'shed').map((b) => b.startedAt),
  };
}

/** The same districts with more houses in each - what a later scan looks like. */
export function grow(specs, extra) {
  return specs.map((s) => ({ ...s, houses: s.houses + extra }));
}

/** Every plot as a comparable snapshot, so a test can assert nothing moved. */
export function plotsOf(layout) {
  const out = {};
  for (const [id, p] of Object.entries(layout.plots)) {
    out[id] = { gx: p.gx, gz: p.gz, w: p.w, d: p.d, rot: p.rot };
  }
  return out;
}
