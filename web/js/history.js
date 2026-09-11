// The village as it stood at a moment, for the chronicle to draw.
//
// Buildings have always known how to rewind: each carries its own `startedAt` and the
// viewer hides the ones that had not been built. Land knew nothing. Scrub back to the
// founding day and the houses went, but the roads still ran between the empty plots, the
// plaza was still paved to its full width, and every hamlet still had its hedges, its
// fields, its green and its name sign - a finished countryside laid out for a village
// that did not exist yet, with roads leading to nothing.
//
// Nothing here draws anything. It projects the village onto an earlier moment and hands
// the result to the same functions that already build the landscape from a village -
// `setOwnership`, `buildPaths`, `syncHamlets` - so there is one description of what a
// hamlet looks like, and the past is drawn by the code that draws the present.
//
// How exact each part is differs, and which is which is worth stating:
//
//   The roads   are exact. A path id names the building it serves, so it can be dated by
//               that building to the minute.
//   The square  is exact in its steps: the scanner puts the moment it reached each width
//               on the wire. Which of its cells were paved first is not recorded, so the
//               plaza is trimmed by distance from its middle - which is how it grew.
//   The land    is an approximation, deliberately. A parcel is re-planned from demand on
//               every scan and nothing records when a given cell was claimed, so land is
//               revealed nearest-the-green-first in proportion to the settlers a project
//               had by then. That is the order `growParcel` really claims in, which is
//               what makes the guess a fair one.

const nearFirst = (a, b, c) => {
  const da = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2;
  const db = (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2;
  return da - db || a[1] - b[1] || a[0] - b[0];
};

// Which super-cells a bitstring parcel covers.
function cellsOf(parcel) {
  const out = [];
  for (let r = 0; r < parcel.h; r++) {
    const row = parcel.rows[r] || '';
    for (let c = 0; c < parcel.w; c++) if (row[c] === '1') out.push([parcel.i0 + c, parcel.j0 + r]);
  }
  return out;
}

// The same parcel with only the `keep` cells nearest `near` still set. Re-encoded as rows
// rather than handed on as a list, so everything downstream keeps taking one shape.
function trimParcel(parcel, keep, near) {
  if (!parcel) return null;
  const cells = cellsOf(parcel);
  if (keep >= cells.length) return parcel;
  if (keep <= 0) return null;
  cells.sort((a, b) => nearFirst(a, b, near));
  const on = new Set(cells.slice(0, keep).map((c) => `${c[0]},${c[1]}`));
  const rows = [];
  for (let r = 0; r < parcel.h; r++) {
    let s = '';
    for (let c = 0; c < parcel.w; c++) s += on.has(`${parcel.i0 + c},${parcel.j0 + r}`) ? '1' : '0';
    rows.push(s);
  }
  return { ...parcel, rows };
}

const superOf = (lat, gx, gz) => [
  Math.floor((gx - lat.anchor[0]) / lat.pitch),
  Math.floor((gz - lat.anchor[1]) / lat.pitch),
];

// A path is named after what it serves - `path:house:<id>`, `path:civic:<type>`,
// `path:p:<district>` - so whatever dates it is already in the village.
function pathDates(village) {
  const at = new Map();
  for (const b of village.buildings || []) {
    if (b.startedAt) at.set(`path:${b.id}`, +new Date(b.startedAt));
  }
  for (const d of village.districts || []) {
    if (d.firstSeenAt) at.set(`path:${d.id}`, +new Date(d.firstSeenAt));
  }
  return at;
}

export function squareSizeAt(village, t) {
  const steps = (village.island.town && village.island.town.sizeSteps) || [];
  let size = 0;
  for (const s of steps) if (+new Date(s.unlockedAt) <= t) size = Math.max(size, s.size);
  return size;
}

export function poldersAt(village, t) {
  let n = 0;
  for (const p of village.polders || []) {
    if (p.unlockedAt && +new Date(p.unlockedAt) > t) break;
    n++;
  }
  return n;
}

// The projection, plus a short key saying what of the landscape it would draw - so the
// caller can skip a rebuild when dragging the slider by a few minutes changes nothing
// anyone could see.
export function projectVillage(village, t) {
  const lat = village.island && village.island.lattice;
  if (!Number.isFinite(t) || !lat) {
    return { key: 'live', polders: (village.polders || []).length, village };
  }

  // Who had arrived, per project.
  const pop = new Map();
  for (const b of village.buildings || []) {
    if (b.kind === 'shed' || b.kind === 'civic' || !b.district) continue;
    if (+new Date(b.startedAt) > t) continue;
    pop.set(b.district, (pop.get(b.district) || 0) + 1);
  }

  const hamletAt = village.hamletAt || 3;
  const parts = [];

  const districts = (village.districts || []).map((d) => {
    // The array keeps its length and its order: ownership is stamped by index, so a
    // project that did not exist yet is one with no land, not one that is missing.
    const had = pop.get(d.id) || 0;
    if (!had) { parts.push('0'); return { ...d, lobes: [], paved: [], tier: 'farmstead' }; }
    const grown = had >= hamletAt;
    const share = d.population > 0 ? had / d.population : 1;
    const lobes = (d.lobes || []).map((lobe) => {
      if (!lobe.parcel) return lobe;
      const total = cellsOf(lobe.parcel).length;
      const keep = Math.max(1, Math.round(total * share));
      const near = superOf(lat, (lobe.green || d.center)[0], (lobe.green || d.center)[1]);
      parts.push(String(keep));
      return {
        ...lobe,
        parcel: trimParcel(lobe.parcel, keep, near),
        // Below the threshold a project has a farmhouse and a field, not a green.
        size: grown ? lobe.size : 0,
        paved: grown ? lobe.paved : [],
      };
    });
    return { ...d, lobes, paved: grown ? d.paved : [], tier: grown ? d.tier : 'farmstead' };
  });

  // The plaza, at the width it had. Its cells are not dated, so they go by distance from
  // the middle, which is the way it grew - outward around its own centre.
  const town = village.island.town || {};
  const size = squareSizeAt(village, t);
  const centre = town.centre || [0, 0];
  const half = (size - 1) / 2;
  const paved = (town.paved || []).filter(([gx, gz]) =>
    Math.abs(gx - centre[0]) <= half && Math.abs(gz - centre[1]) <= half);

  // The town commons is owned land too, and forgetting it was visible: 59 super-cells of
  // it were stamped from the founding day on, which is what drew hedges around the
  // centre and planted fields inside them before anybody lived there. Its core - the
  // plaza and the civic lots, `coreR` across - was there from the start; everything
  // beyond that was grown a cell at a time as guests arrived, so that part is trimmed
  // like a hamlet's.
  const coreR = town.coreR == null ? 2 : town.coreR;
  const core = (2 * coreR + 1) * (2 * coreR + 1);
  const settlersNow = (village.stats && village.stats.settlers) || 0;
  let settlersThen = 0;
  for (const n of pop.values()) settlersThen += n;
  const townShare = settlersNow > 0 ? settlersThen / settlersNow : 1;
  const townTotal = town.parcel ? cellsOf(town.parcel).length : 0;
  const townKeep = Math.min(townTotal, core + Math.round(Math.max(0, townTotal - core) * townShare));
  const townParcel = trimParcel(town.parcel, townKeep, superOf(lat, centre[0], centre[1]));
  parts.push(`t${townKeep}`);

  const dates = pathDates(village);
  const paths = (village.paths || []).filter((p) => {
    const at = dates.get(p.id);
    return at === undefined ? false : at <= t;
  });

  const buildings = (village.buildings || []).filter((b) => +new Date(b.startedAt) <= t);
  const nP = poldersAt(village, t);


  // The countryside's ploughed strips and orchards are planned from the terrain seed on
  // land nobody owns, so they stood at full spread on the founding day - an island with
  // one house on it and every field already turned. They are the village's work as much
  // as its roads are, so their spread arrives with it. `planFields` keeps or drops a
  // field by comparing a per-cell hash against the coverage, so a lower one is a subset
  // of a higher one: fields appear where they will end up, rather than shuffling about.
  const farmShare = townShare;

  return {
    key: `${nP}|${size}|${paths.length}|${Math.round(farmShare * 50)}|${parts.join(',')}`,
    polders: nP,
    village: {
      ...village,
      buildings,
      districts,
      paths,
      farmShare,
      island: { ...village.island, town: { ...town, paved, parcel: townParcel } },
    },
  };
}
