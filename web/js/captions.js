// Where a hamlet's floating name goes. Kept apart from main.js and free of three.js and the
// DOM so tests/captions.test.mjs can hold the choice under Node without a stubbed document.
//
// A hamlet that grows is handed extra lobes (annexes: `district.lobes`, one parcel each,
// see `ensureParcel` in lib/layout.mjs), and the caption used to be drawn over every one of
// them - so from the air a grown island read "Claude", "Claude", "Claude" across three
// patches of ground, which looks like three places with one name rather than one place
// with some outskirts. The aerial caption answers "which hamlet is this", and a hamlet is
// one answer, so it goes up once.
//
// The wooden arch is the other half and deliberately stays one per lobe (`hamletSigns` in
// main.js): it stands over the road where it enters *that* piece of land, and you meet it
// on foot at each annex's own way in, never two in one view. The minimap already marks a
// hamlet once, at `d.center` (`islandFeatures` in minimap.js), so it needs nothing here.

// How many super-cells a lobe's parcel holds. The wire sends a parcel as a bounding box of
// '0'/'1' rows (`rleParcel` in scan.mjs), so this is a count of ones, not w * h.
export function lobeSupers(lobe) {
  const rows = lobe && lobe.parcel && lobe.parcel.rows;
  if (!Array.isArray(rows)) return 0;
  let n = 0;
  for (const row of rows) for (let c = 0; c < row.length; c++) if (row[c] === '1') n++;
  return n;
}

// The lobe the caption stands over: the biggest by land, because that is where the hamlet
// mostly is when you look down on it. A tie goes to the earlier lobe - index 0 is the
// founding one, the patch the hamlet started on - which also keeps the caption from hopping
// between two equal lobes as the island is rescanned. -1 when there is no lobe at all, which
// is the old behaviour too: a hamlet with no land has never had a caption.
export function captionLobe(d) {
  const lobes = (d && d.lobes) || [];
  let best = -1, most = -1;
  lobes.forEach((lobe, i) => {
    const n = lobeSupers(lobe);
    if (n > most) { best = i; most = n; }
  });
  return best;
}

// The ground cell to hang it over, in the district's own local grid, or null for none.
// `lobe.green` is the lobe's centre cell (scan.mjs sends `lo.centre` under that name, from
// when it was the village green), `d.center` the fallback the per-lobe loop always had.
export function captionCell(d) {
  if (!d || !d.center || d.tier === 'farmstead') return null;
  const li = captionLobe(d);
  if (li < 0) return null;
  return d.lobes[li].green || d.center;
}
