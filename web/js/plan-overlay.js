// What the planner draws over the island: the super-grid, who owns which ground, the
// zones, the selection, and the ghosts of a hamlet being carried somewhere else.
//
// Every layer is one draw call, and every vertex sits on the ground's own corner lattice.
// The ground mesh in world.js is an (N x N) heightfield with a vertex at every cell corner
// - `pos = (i - half, terrain.corner(i, j), j - half)` - so a quad built on those same
// corners is exactly coplanar with the grass under it, and a small lift plus a polygon
// offset is enough to keep it from fighting the ground on a slope. road-debug.js draws its
// cells as flat squares at the cell's mean height, which steps on a hillside; that is fine
// for a debug outline and not for a fill you look at for minutes.
//
// Over water the vertices are floated to just above the sea, so the grid reads on the
// water for a future polder tool instead of sinking under it. Deep sea gets nothing: a
// super-cell whose every corner is well below the polder depth is drawn by nobody, which
// is what keeps this to roughly the land and its shallows rather than the whole square.
//
// The colour is a per-vertex RGBA (`color` with itemSize 4, which three r170 reads as
// USE_COLOR_ALPHA), recomposited in JS by `paint()` whenever something changed and never
// per frame. The positions are built once per terrain by `rebuildGround()`.
//
// `terrain`, `village` and `byId` are getters, not values, for the reason road-debug.js
// gives at its top: `state.terrain` is replaced by `layLandscape` and `state.village` by
// every scan, and a snapshot taken at construction would be a picture of a different day.
import * as THREE from 'three';
import { blockOf, superComplete, superRadius } from 'shared/lattice.mjs';
import { SEA_LEVEL } from 'shared/terrain.mjs';

// Corners all below this: sea, not drawn. Just under the waterline rather than the polder
// depth: the shallows around this island are wide, and a grid over all of them buried the
// coast under a net. The polder tool (phase 2) will want the shallows back, as its own layer.
const DEEP = -1.3;
const LAND = -0.35;           // a corner above this: the super-cell has land on it
const LIFT_GRID = 0.08;
const LIFT_FILL = 0.05;
const LIFT_MARK = 0.12;
const WATER_Y = SEA_LEVEL + 0.12;

// The palette. The accent is the UI's own gold (`--accent` in ui.css); the refusal red
// and the go-ahead green are ghost.js's two materials, so a red ghost here means what a
// red ghost means everywhere else on the island.
const C = {
  grid: new THREE.Color(0x2a3320),
  town: new THREE.Color(0xb8b2a4),
  zone: new THREE.Color(0xa0523a),
  zoneAdd: new THREE.Color(0xd06a48),
  zoneRemove: new THREE.Color(0x6f7f6a),
  select: new THREE.Color(0xe8b45c),
  ok: new THREE.Color(0x8fe0a8),
  bad: new THREE.Color(0xe0574a),
  hover: new THREE.Color(0xf4ece0),
  tether: new THREE.Color(0xe8b45c),
  polder: new THREE.Color(0xd8c48a),
  unpolder: new THREE.Color(0x3d7f9a),
  gridWater: new THREE.Color(0x24444a),
};

function ghostMaterial(hex) {
  return new THREE.MeshStandardMaterial({
    color: hex, transparent: true, opacity: 0.45, depthWrite: false, flatShading: true, roughness: 0.9, metalness: 0,
  });
}

export function createPlanOverlay({ scene, terrain, village, byId }) {
  const group = new THREE.Group();
  group.name = 'plan-overlay';
  group.visible = false;
  scene.add(group);

  const OK = ghostMaterial(0x8fe0a8);
  const BAD = ghostMaterial(0xe0574a);

  let groundOf = null;       // the terrain the fills were built for
  let lat = null, R = 0, n = 0;
  let supers = [];           // [{ i, j, o }] - the drawn super-cells and their vertex offset
  let indexOf = new Map();   // 'i,j' -> position in `supers`
  let grid = null, gridWater = null, fills = null, marks = null, tethers = null, hover = null;
  const ghosts = new THREE.Group();
  group.add(ghosts);

  const key = (i, j) => `${i},${j}`;

  // Where a corner of the ground is, lifted, and never under the water.
  function cornerY(t, i, j) {
    return Math.max(t.corner(i, j), WATER_Y);
  }

  function dispose(o) {
    if (!o) return;
    group.remove(o);
    o.geometry.dispose();
    o.material.dispose();
  }

  // ---------------------------------------------------------------- the ground layers
  // Built once per terrain: every complete super-cell that is not open sea, as 25 vertices
  // (a 5x5 lattice of cell corners) for the fill and its north and west edges, cell by
  // cell, for the grid - plus a closing edge wherever the neighbour is not drawn.
  function rebuildGround() {
    const t = terrain();
    const v = village();
    lat = v && v.island && v.island.lattice;
    if (!t || !lat) return;
    if (groundOf === t && fills) return;
    groundOf = t;
    dispose(grid); dispose(gridWater); dispose(fills); dispose(marks); dispose(tethers); dispose(hover);
    R = superRadius(t.size, lat.pitch);
    n = 2 * R + 1;
    const P = lat.pitch;

    supers = [];
    indexOf = new Map();
    for (let j = -R; j <= R; j++) {
      for (let i = -R; i <= R; i++) {
        if (!superComplete(lat, t.size, i, j)) continue;
        const [gx, gz] = blockOf(lat, i, j);
        let shallow = false, land = false;
        for (let z = 0; z <= P; z++) for (let x = 0; x <= P; x++) { const h = t.corner(gx + x, gz + z); if (h > DEEP) shallow = true; if (h > LAND) land = true; }
        if (!shallow) continue;
        indexOf.set(key(i, j), supers.length);
        supers.push({ i, j, land, o: supers.length * (P + 1) * (P + 1) });
      }
    }
    const perSuper = (P + 1) * (P + 1);
    const pos = new Float32Array(supers.length * perSuper * 3);
    const col = new Float32Array(supers.length * perSuper * 4);
    const idx = new Uint32Array(supers.length * P * P * 6);
    let ii = 0;
    const gridPos = [], waterPos = [];
    for (const s of supers) {
      const [gx, gz] = blockOf(lat, s.i, s.j);
      for (let z = 0; z <= P; z++) {
        for (let x = 0; x <= P; x++) {
          const k = s.o + z * (P + 1) + x;
          pos[k * 3] = gx + x - t.half;
          pos[k * 3 + 1] = cornerY(t, gx + x, gz + z) + LIFT_FILL;
          pos[k * 3 + 2] = gz + z - t.half;
        }
      }
      for (let z = 0; z < P; z++) {
        for (let x = 0; x < P; x++) {
          const a = s.o + z * (P + 1) + x, b = a + 1, c = a + (P + 1), d = c + 1;
          idx[ii++] = a; idx[ii++] = c; idx[ii++] = b;
          idx[ii++] = b; idx[ii++] = c; idx[ii++] = d;
        }
      }
      // The grid: north edge and west edge, and the far edges where nobody continues them.
      // Two lists: the net over land, and a fainter one over the shallows for the polder
      // tool, so the coast is not buried under the sea's own squares.
      const into = s.land ? gridPos : waterPos;
      const edge = (x0, z0, x1, z1) => {
        into.push(gx + x0 - t.half, cornerY(t, gx + x0, gz + z0) + LIFT_GRID, gz + z0 - t.half,
          gx + x1 - t.half, cornerY(t, gx + x1, gz + z1) + LIFT_GRID, gz + z1 - t.half);
      };
      for (let x = 0; x < P; x++) edge(x, 0, x + 1, 0);
      for (let z = 0; z < P; z++) edge(0, z, 0, z + 1);
      if (!indexOf.has(key(s.i + 1, s.j))) for (let z = 0; z < P; z++) edge(P, z, P, z + 1);
      if (!indexOf.has(key(s.i, s.j + 1))) for (let x = 0; x < P; x++) edge(x, P, x + 1, P);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    fg.setAttribute('color', new THREE.BufferAttribute(col, 4));
    fg.setIndex(new THREE.BufferAttribute(idx, 1));
    fills = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    fills.renderOrder = 900;
    fills.frustumCulled = false;
    group.add(fills);

    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPos, 3));
    grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: C.grid, transparent: true, opacity: 0.4, depthWrite: false }));
    grid.renderOrder = 901;
    grid.frustumCulled = false;
    group.add(grid);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(waterPos, 3));
    gridWater = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: C.gridWater, transparent: true, opacity: 0.22, depthWrite: false }));
    gridWater.renderOrder = 901;
    gridWater.frustumCulled = false;
    group.add(gridWater);

    hover = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3)),
      new THREE.LineBasicMaterial({ color: C.hover, transparent: true, opacity: 0.9, depthTest: false }),
    );
    hover.renderOrder = 1002;
    hover.visible = false;
    group.add(hover);
  }

  // The fill of one super-cell, in place. Alpha 0 is "nothing here".
  function tint(i, j, color, alpha) {
    const s = supers[indexOf.get(key(i, j))];
    if (!s) return;
    const col = fills.geometry.attributes.color;
    const perSuper = (lat.pitch + 1) * (lat.pitch + 1);
    for (let k = 0; k < perSuper; k++) col.setXYZW(s.o + k, color.r, color.g, color.b, alpha);
  }

  // Recomposite every fill. `view` is what the planner knows:
  //   owner(i, j)       -> district index, -2 the town, -1 nobody   (from the survey)
  //   hueOf(k)          -> a district's hue in degrees
  //   zones             -> Set of 'i,j' on the island today
  //   zoneAdd/zoneRemove-> Sets of 'i,j' the draft paints / releases
  //   selected(i, j)    -> the super-cell belongs to a selected lobe
  //   moving(i, j)      -> 'ok' | 'bad' | null : a destination of the lobes being carried
  function paint(view) {
    if (!fills) return;
    const col = fills.geometry.attributes.color;
    col.array.fill(0);
    const tmp = new THREE.Color();
    for (const s of supers) {
      const { i, j } = s;
      const k = view.owner(i, j);
      if (k === -2) tint(i, j, C.town, 0.16);
      else if (k >= 0) tint(i, j, tmp.setHSL(((view.hueOf(k) % 360) + 360) / 360 % 1, 0.55, 0.5), 0.2);
      const kk = key(i, j);
      if (view.zones.has(kk) && !view.zoneRemove.has(kk)) tint(i, j, C.zone, 0.38);
      if (view.zoneRemove.has(kk)) tint(i, j, C.zoneRemove, 0.3);
      if (view.zoneAdd.has(kk)) tint(i, j, C.zoneAdd, 0.42);
      if (view.polder && view.polder.has(kk)) tint(i, j, C.polder, 0.5);
      if (view.unpolder && view.unpolder(i, j)) tint(i, j, C.unpolder, 0.5);
      if (view.selected(i, j)) tint(i, j, C.select, 0.34);
      const m = view.moving(i, j);
      if (m) tint(i, j, m === 'ok' ? C.ok : C.bad, 0.36);
    }
    col.needsUpdate = true;
  }

  // ---------------------------------------------------------------- the marks
  // Rectangles around plots and outlines around lobes, rebuilt whenever the selection or
  // the draft changes. `rects` is [{ gx, gz, w, d, color }], `outlines` is
  // [{ supers: [[i, j]], color }] - an outline is every super edge with no neighbour in the
  // same set - and `lines` is [{ from: [x, z], to: [x, z], color }] for the tethers.
  function setMarks({ rects = [], outlines = [], lines = [] } = {}) {
    dispose(marks); marks = null;
    dispose(tethers); tethers = null;
    const t = terrain();
    if (!t || !lat) return;
    const pos = [], col = [];
    const seg = (x0, z0, x1, z1, c, lift = LIFT_MARK) => {
      pos.push(x0, Math.max(t.worldHeight(x0, z0), WATER_Y) + lift, z0, x1, Math.max(t.worldHeight(x1, z1), WATER_Y) + lift, z1);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    for (const r of rects) {
      const x0 = r.gx - t.half, z0 = r.gz - t.half, x1 = x0 + r.w, z1 = z0 + r.d;
      seg(x0, z0, x1, z0, r.color); seg(x1, z0, x1, z1, r.color); seg(x1, z1, x0, z1, r.color); seg(x0, z1, x0, z0, r.color);
    }
    const P = lat.pitch;
    for (const o of outlines) {
      const own = new Set(o.supers.map(([i, j]) => key(i, j)));
      for (const [i, j] of o.supers) {
        const [gx, gz] = blockOf(lat, i, j);
        const x0 = gx - t.half, z0 = gz - t.half, x1 = x0 + P, z1 = z0 + P;
        if (!own.has(key(i, j - 1))) for (let x = 0; x < P; x++) seg(x0 + x, z0, x0 + x + 1, z0, o.color);
        if (!own.has(key(i, j + 1))) for (let x = 0; x < P; x++) seg(x0 + x, z1, x0 + x + 1, z1, o.color);
        if (!own.has(key(i - 1, j))) for (let z = 0; z < P; z++) seg(x0, z0 + z, x0, z0 + z + 1, o.color);
        if (!own.has(key(i + 1, j))) for (let z = 0; z < P; z++) seg(x1, z0 + z, x1, z0 + z + 1, o.color);
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      marks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
      marks.renderOrder = 1001;
      marks.frustumCulled = false;
      group.add(marks);
    }
    if (lines.length) {
      const lp = [], lc = [];
      for (const l of lines) {
        lp.push(l.from[0], Math.max(t.worldHeight(l.from[0], l.from[1]), WATER_Y) + 0.6, l.from[1],
          l.to[0], Math.max(t.worldHeight(l.to[0], l.to[1]), WATER_Y) + 0.6, l.to[1]);
        const c = l.color || C.tether;
        lc.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
      tethers = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthTest: false }));
      tethers.renderOrder = 1001;
      tethers.frustumCulled = false;
      group.add(tethers);
    }
  }

  // ---------------------------------------------------------------- the ghosts
  // A building being carried: the real mesh's own geometry, shared, under the translucent
  // green or red, at where it would stand. The real group never moves - see the top of
  // plan-mode.js for why - so this is the only picture of the move until Apply.
  // `list` is [{ id, dx, dz, ok }] in world units.
  function setGhosts(list) {
    for (const g of ghosts.children) g.geometry = null;   // shared with the real building
    ghosts.clear();
    const t = terrain();
    const recs = byId();
    if (!t || !recs) return;
    for (const { id, dx, dz, ok } of list) {
      const rec = recs.get(id);
      if (!rec || !rec.mesh) continue;
      rec.group.updateMatrixWorld(true);
      const m = new THREE.Mesh(rec.mesh.geometry, ok ? OK : BAD);
      m.matrixAutoUpdate = false;
      m.matrix.copy(rec.mesh.matrixWorld);
      const p = new THREE.Vector3().setFromMatrixPosition(m.matrix);
      const ground0 = t.worldHeight(p.x, p.z);
      const ground1 = t.worldHeight(p.x + dx, p.z + dz);
      m.matrix.setPosition(p.x + dx, p.y + (ground1 - ground0), p.z + dz);
      m.renderOrder = 3;
      m.castShadow = false;
      ghosts.add(m);
    }
  }

  function setHover(s) {
    if (!hover) return;
    if (!s) { hover.visible = false; return; }
    const t = terrain();
    const [gx, gz] = blockOf(lat, s[0], s[1]);
    const P = lat.pitch;
    const x0 = gx - t.half, z0 = gz - t.half, x1 = x0 + P, z1 = z0 + P;
    const y = (x, z) => Math.max(t.worldHeight(x, z), WATER_Y) + LIFT_MARK + 0.05;
    const a = hover.geometry.attributes.position;
    const pts = [[x0, z0], [x1, z0], [x1, z0], [x1, z1], [x1, z1], [x0, z1], [x0, z1], [x0, z0]];
    pts.forEach(([x, z], k) => a.setXYZ(k, x, y(x, z), z));
    a.needsUpdate = true;
    hover.visible = true;
  }

  function setVisible(on) {
    group.visible = !!on;
    if (!on) { setGhosts([]); setHover(null); }
  }

  function destroy() {
    dispose(grid); dispose(gridWater); dispose(fills); dispose(marks); dispose(tethers); dispose(hover);
    setGhosts([]);
    scene.remove(group);
    OK.dispose(); BAD.dispose();
  }

  return { group, rebuildGround, paint, setMarks, setGhosts, setHover, setVisible, dispose: destroy, hasGround: () => !!fills };
}
