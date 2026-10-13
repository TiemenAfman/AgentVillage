// A loader hook that gives the pirate ship's bake the two moving parts the sloop is to have
// (Plans/DONE/nieuwe-sloep.md chip 3: `pirateship sail`, a regular grid hung from its yard with the
// part's origin on the yard's middle and every corner at or under it, and `pirateship flag`, its
// origin at the staff) - so tests/ship-sail-weld.test.mjs can weld and move them through the real
// web/js/boat.js before any bake carries them. Registered beside shared-loader.mjs, in a process of
// its own: every module in that process sees the extra parts, which is why tests/ship-sail.test.mjs
// (the "nothing welded" case) does not register it.
//
// The parts are appended to the generated module's source, in the export's own shape (triangles,
// a colour per corner, `sheet`, `emissive`, `at`), with the yard 6.2 above the keel so that after
// boat.js sinks the hull by SHIP_DRAUGHT the sail hangs clear of her deck.
export const SAIL = Object.freeze({ at: [0, 6.2, 0.3], w: 3.0, h: 2.6, cols: 10, rows: 14, belly: 0.12 });
export const FLAG = Object.freeze({ at: [0, 11.8, 0], len: 1.1, h: 0.45, cols: 11, rows: 3 });

function gridTriangles(corner) {
  // `corner(q, r)` gives [x, y, z] in the part's frame; the grid is cut into two triangles a cell.
  const { cols, rows } = corner;
  const pos = [];
  const push = (q, r) => pos.push(...corner.at(q, r));
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      push(q, r); push(q + 1, r); push(q, r + 1);
      push(q + 1, r); push(q + 1, r + 1); push(q, r + 1);
    }
  }
  return pos;
}

export function sailPart() {
  const { w, h, cols, rows, belly } = SAIL;
  const positions = gridTriangles({ cols, rows, at: (q, r) => {
    const k = r / rows;
    return [-w / 2 + (w * q) / cols, -h * k, -belly * Math.sin(Math.PI * k)];
  } });
  return { positions, colors: positions.map(() => 0.9), sheet: 'plain', emissive: 0, at: [...SAIL.at] };
}

export function flagPart() {
  const { len, h, cols, rows } = FLAG;
  // Flying aft (-z) from the staff, like the Batavia's.
  const positions = gridTriangles({ cols, rows, at: (q, r) => [0, -(h * r) / rows, -(len * q) / cols] });
  return { positions, colors: positions.map((_, i) => (i % 3 === 0 ? 0.1 : 0.8)), sheet: 'plain', emissive: 0, at: [...FLAG.at] };
}

export async function load(url, context, nextLoad) {
  const out = await nextLoad(url, context);
  if (!/\/web\/js\/pirateship-mesh\.js$/.test(url)) return out;
  const extra = `\nPIRATESHIP.parts['pirateship sail'] = ${JSON.stringify(sailPart())};\n`
    + `PIRATESHIP.parts['pirateship flag'] = ${JSON.stringify(flagPart())};\n`;
  return { ...out, source: String(out.source) + extra };
}
