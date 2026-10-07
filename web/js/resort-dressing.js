// Where the quay's resort on the sea gets its bathing raft and the parasols on its beach
// (Plans/quay-op-zee.md). Dressing, and the page's alone: nothing of it is in the layout, the
// bundle or on the wire, so it is worked out here from what every page already has - the quay
// district's deck, the houses on it and the ground - and a neighbour's resort is dressed the
// same way from its bundle. DOM-free and three-free, for tests/resort-dressing.test.mjs.
//
// The resort is the piece of the quay's deck that stands on the water with houses on it and meets
// a beach (the harbour's own boardwalk at the stone quay meets the quay, not the sand). Its foot is
// that beach cell; the raft floats three cells past the far end of the boardwalk furthest from it,
// where the preview put it (layout.resort.raft is the same rule on the server's side, and holds
// that water free); the parasols stand on the sand beside the foot, off the road.
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const RAFT_OUT = 3;
const PARASOLS = 3;
const key = (x, z) => `${x},${z}`;

export function resortDressing(district, buildings, terrain, paths = []) {
  const cells = (district && district.deck) || [];
  if (!cells.length || !terrain) return null;
  const deck = new Set(cells.map(([x, z]) => key(x, z)));
  const doors = new Set();
  const taken = new Set();
  for (const b of buildings || []) {
    const p = b.plot;
    if (!p) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) taken.add(key(p.gx + x, p.gz + z));
    if (b.district === district.id && p.quay && b.door) doors.add(key(b.door[0], b.door[1]));
  }
  const road = new Set();
  for (const p of paths || []) for (const [x, z] of p.cells || []) road.add(key(x, z));

  // The pieces of the deck, four-connected, and the one that is the resort.
  const seen = new Set();
  let best = null;
  for (const c of [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    if (seen.has(key(c[0], c[1]))) continue;
    const piece = [], q = [c];
    seen.add(key(c[0], c[1]));
    for (let h = 0; h < q.length; h++) {
      const [x, z] = q[h];
      piece.push([x, z]);
      for (const [dx, dz] of N4) {
        const k = key(x + dx, z + dz);
        if (deck.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, z + dz]); }
      }
    }
    const houses = piece.filter(([x, z]) => doors.has(key(x, z))).length;
    const wet = piece.filter(([x, z]) => terrain.isWater(x, z)).length;
    let foot = null, from = null;
    for (const [x, z] of piece) {
      if (!terrain.isWater(x, z)) continue;
      for (const [dx, dz] of N4) {
        const fx = x + dx, fz = z + dz;
        if (deck.has(key(fx, fz)) || !terrain.inGrid(fx, fz) || !terrain.isLand(fx, fz) || !terrain.isBeach(fx, fz)) continue;
        if (!foot) { foot = [fx, fz]; from = [x, z]; }
      }
    }
    if (!houses || !foot || wet < piece.length * 0.8) continue;
    if (!best || houses > best.houses) best = { piece, houses, foot, from };
  }
  if (!best) return null;
  const { piece, foot, from } = best;

  // The raft: past the tip of the boardwalk furthest from the foot, the way the boardwalk runs.
  const d2 = ([x, z]) => (x - foot[0]) ** 2 + (z - foot[1]) ** 2;
  // The boardwalk's own cells: a house's doorstep plank sticks out sideways, and past one of those
  // lies the house next door.
  const walk = piece.filter(([x, z]) => !doors.has(key(x, z)));
  const tip = walk.reduce((a, c) => (d2(c) > d2(a) || (d2(c) === d2(a) && (c[1] < a[1] || (c[1] === a[1] && c[0] < a[0]))) ? c : a));
  let raft = null;
  for (const [dx, dz] of N4) {
    if (deck.has(key(tip[0] + dx, tip[1] + dz)) || !deck.has(key(tip[0] - dx, tip[1] - dz))) continue;
    const r = [tip[0] + dx * RAFT_OUT, tip[1] + dz * RAFT_OUT];
    let clear = terrain.inGrid(r[0], r[1]) && terrain.isWater(r[0], r[1]);
    for (let oz = -1; oz <= 1 && clear; oz++) for (let ox = -1; ox <= 1; ox++) if (deck.has(key(r[0] + ox, r[1] + oz)) || taken.has(key(r[0] + ox, r[1] + oz))) { clear = false; break; }
    if (clear) { raft = r; break; }
  }

  // The parasols: sand within two of the foot, off the road and anything standing, nearest first,
  // never two side by side.
  const sand = [];
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const x = foot[0] + dx, z = foot[1] + dz;
    if (!(dx || dz) || !terrain.inGrid(x, z) || !terrain.isLand(x, z) || !terrain.isBeach(x, z)) continue;
    if (road.has(key(x, z)) || deck.has(key(x, z)) || taken.has(key(x, z))) continue;
    sand.push([x, z]);
  }
  sand.sort((a, b) => d2(a) - d2(b) || a[1] - b[1] || a[0] - b[0]);
  const parasols = [];
  for (const c of sand) {
    if (parasols.length >= PARASOLS) break;
    if (parasols.some((p) => Math.abs(p[0] - c[0]) <= 1 && Math.abs(p[1] - c[1]) <= 1)) continue;
    parasols.push(c);
  }
  return { foot, out: [from[0] - foot[0], from[1] - foot[1]], raft, parasols };
}
