// A synthetic village for the layout tests, and the questions they all ask of a layout.
//
// Grown from `tests/polder-hash.test.mjs`'s `village()`: `settlers` spread over twelve
// projects, only the fields `placeAll` reads filled in. Every other project's house has a
// shed, and every second project is a git repository, so an office stands at each gate -
// the two kinds of plot a moved hamlet has to carry with it. Here rather than in one test
// because tests/plan-*.test.mjs all want the same island to start from.
import { outsideDoor } from '../../lib/layout.mjs';
import { reachableFromSquare } from '../../shared/roads.mjs';

export function village(settlers, { projects = 12 } = {}) {
  const districts = [], buildings = [];
  for (let d = 0; d < projects; d++) {
    const id = `proj:${d}`;
    const pop = Math.floor(settlers / projects) + (d < settlers % projects ? 1 : 0);
    districts.push({ id, name: `P${d}`, kind: 'project', firstSeenAt: 1000 + d, population: pop, gitRepo: d % 2 === 0 });
    for (let n = 0; n < pop; n++) {
      buildings.push({ id: `house:${id}:${n}`, kind: 'house', district: id, startedAt: 2000 + d * 1000 + n });
      if (n % 2 === 0) buildings.push({ id: `shed:${id}:${n}:a`, kind: 'shed', district: id, master: `house:${id}:${n}`, startedAt: 2500 + d * 1000 + n });
    }
  }
  return { stats: { settlers }, districts, buildings, furniture: [], milestones: [] };
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const key = (c) => `${c[0]},${c[1]}`;
// A plot's whole identity for this purpose: where it stands and which way it faces.
export const stands = (l) => Object.fromEntries(Object.entries(l.plots).map(([id, p]) => [id, `${p.gx},${p.gz},${p.rot}`]));
export const movedBetween = (a, b) => Object.keys(a).filter((id) => a[id] !== b[id]);

// Every cell a plot stands on.
export function plotCells(layout, filter = () => true) {
  const out = new Set();
  for (const [id, p] of Object.entries(layout.plots)) {
    if (!filter(id, p)) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.add(key([p.gx + x, p.gz + z]));
  }
  return out;
}

// The houses that cannot walk from their own door to the town square: the flood fill
// tests/layout-measure.test.mjs does, over the same graph the settlers walk
// (shared/roads.mjs), seeded from the town's paving. A door counts as joined if the cell
// it opens onto is on the network, or any cell of the house's own front path is.
export function cutOff(layout, size) {
  const v = { paths: layout.paths, bridges: layout.bridges || [], island: { town: layout.town }, districts: [] };
  const open = reachableFromSquare(v, size);
  const at = ([gx, gz]) => open.has(gx + gz * size);
  return Object.entries(layout.plots)
    .filter(([id]) => id.startsWith('house:'))
    .filter(([id, p]) => {
      if (at(outsideDoor(p.gx, p.gz, p.rot))) return false;
      const own = layout.paths.find((r) => r.id === `path:${id}`);
      return !(own && own.cells.some(at));
    })
    .map(([id]) => id);
}

// Two plots on one cell, unless one is the other's shed.
export function overlaps(layout) {
  const claims = new Map();
  for (const [id, p] of Object.entries(layout.plots)) {
    for (let z = 0; z < p.d; z++) {
      for (let x = 0; x < p.w; x++) {
        const k = key([p.gx + x, p.gz + z]);
        if (!claims.has(k)) claims.set(k, []);
        claims.get(k).push(id);
      }
    }
  }
  const bad = [];
  for (const [cell, ids] of claims) {
    if (ids.length < 2) continue;
    const shed = ids.find((id) => id.startsWith('shed:'));
    const other = ids.find((id) => id !== shed);
    if (ids.length !== 2 || !shed || (layout.shedOf || {})[shed] !== other) bad.push(`${cell}: ${ids.join(', ')}`);
  }
  return bad;
}
