// The planner: the island from straight above, and a hand to move hamlets with.
//
// A third mode beside orbit and walk. It renders the same scene through its own
// OrthographicCamera looking straight down, north up, so a screen rectangle is a world
// rectangle and a dragged distance is a world distance - which is what makes a rubber
// band and a snapped drag one line each. The orbit camera and its controls are never
// touched while planning; leaving restores the sky exactly as it was left.
//
// Nothing real moves before Apply. A hamlet being carried is drawn as ghosts - the real
// meshes' own geometry under the green or red of ghost.js - at where it would stand, and
// the real groups stay put, because `reportPlacements` in main.js reads their positions
// after every scan and a drag that straddled the sixty-second rescan would have posted a
// village standing in the wrong place to the sea. The draft is a list of ops; the server
// (`POST /api/plan`, lib/plan.mjs) is the authority on every one of them, asked for a dry
// run after each change and for the real thing on Apply; the page then follows the new
// village through its ordinary update, as every other open page does.
// What the page judges for itself - the green or red of a drag - comes from the survey
// the server bakes (`GET /api/plan/survey`), so it never carries a second copy of the rules.
//
// Keys are taken in the capture phase on window, the way ghost.js and buildmenu.js do,
// and only while planning: Escape backs out one level at a time, Ctrl+Z/Y undo and redo,
// 1-6 pick a tool, WASD and the arrows pan. Installed on enter, removed on exit.
//
// The Road tool draws in grid cells, not super-cells: a road is one cell wide and goes
// where the keeper drags it. What the browser does for itself is keep the stroke a string
// of neighbouring cells and hold it straight across ground a road cannot lie on - the
// river, its banks - because a deck has nowhere to turn and the server refuses one that
// bends (`opRoad` in lib/plan.mjs). Whether the road may be there at all, and how long
// the bridge is, is the server's answer, as with every other op.
//
// The town's own buildings - the hall, the tavern and the rest of the three by three lots -
// move one at a time and cell by cell, and turn (R) where they stand (`civic`,
// Plans/gebouwen-verplaatsen.md). Which ones may, and every corner each may be set down on,
// comes baked from the server like the rest: the survey's `civics` for the island as it
// stands, a dry run's for the island as the draft leaves it. With the town picked, the Land
// tool paints ground for the town (`commons`) instead of for a hamlet.
import * as THREE from 'three';
import { blockOf, superOf, superComplete } from 'shared/lattice.mjs';
import { DOOR_DIR } from 'shared/settlerwalk.mjs';
import { mine } from './api.js';

const DRAFT_KEY = 'promptholm.plan.draft';
const VIEW_KEY = 'promptholm.plan.view';
const DRAG_PX = 5;
const EYE = 300;                 // the camera's height; anything above the tallest thing
const PAN_KEYS = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
const TOWN = -2, NONE = -1;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const key = (i, j) => `${i},${j}`;
const lkey = (l) => `${l.district}#${l.lobe}`;

export function createPlanMode({ dom, terrain, village, byId, pickables, bounds, ghostPose, overlay, panel, toast, onExit }) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
  camera.up.set(0, 0, -1);
  const view = { cx: 0, cz: 0, hh: 60 };
  let active = false;
  let tool = 'select';
  let lat = null;
  let indexed = null;              // the village the index below was built from
  let lobes = new Map();           // 'district#lobe' -> { district, lobe, k, name, hue, supers, buildings }
  let lobeAt = new Map();          // 'i,j' -> lobe record, as the island stands
  let townAt = new Set();          // 'i,j' the town holds
  let islandZones = new Set();     // 'i,j' zoned on the island today
  let polderAt = new Map();        // 'i,j' -> index into village.polders, for the ones standing
  let selPolder = null;            // a standing polder picked with the Polder tool
  let selCivic = null;             // one of the town's own buildings, picked: its id
  let selTown = false;             // the town itself, picked, for the Land tool
  let groundSeen = null;           // the terrain the overlay was last laid on
  let survey = null;
  let snapshots = 0;
  const sel = new Set();           // lobe keys
  let ops = [], redo = [];
  let ptr = { x: 0, y: 0 };
  let press = null, drag = null, band = null, paint = null, pan = null, stroke = null;
  let dragOk = new Map();          // 'i,j' -> 'ok' | 'bad' during a drag
  const keys = new Set();
  let dry = { seq: 0, timer: null, state: 'idle', verdicts: null, error: null, civics: null };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // ------------------------------------------------------------------ the view
  const aspect = () => innerWidth / innerHeight;
  function applyView() {
    const t = terrain();
    const b = bounds();
    if (b) {
      view.cx = Math.min(b.maxX + 8, Math.max(b.minX - 8, view.cx));
      view.cz = Math.min(b.maxZ + 8, Math.max(b.minZ - 8, view.cz));
    }
    view.hh = Math.min(t ? t.half * 1.25 : 400, Math.max(6, view.hh));
    const hw = view.hh * aspect();
    camera.left = -hw; camera.right = hw; camera.top = view.hh; camera.bottom = -view.hh;
    camera.position.set(view.cx, EYE, view.cz);
    camera.lookAt(view.cx, 0, view.cz);
    camera.updateProjectionMatrix();
  }
  function toWorld(px, py) {
    const nx = (px / innerWidth) * 2 - 1, ny = -(py / innerHeight) * 2 + 1;
    return [view.cx + nx * view.hh * aspect(), view.cz - ny * view.hh];
  }
  function superAt(px, py) {
    const t = terrain();
    if (!t || !lat) return null;
    const [x, z] = toWorld(px, py);
    const gx = Math.floor(x + t.half), gz = Math.floor(z + t.half);
    if (!t.inGrid(gx, gz)) return null;
    return superOf(lat, gx, gz);
  }
  // The grid cell under a screen point, for the Road tool.
  function cellAt(px, py) {
    const t = terrain();
    if (!t) return null;
    const [x, z] = toWorld(px, py);
    const gx = Math.floor(x + t.half), gz = Math.floor(z + t.half);
    return t.inGrid(gx, gz) ? [gx, gz] : null;
  }
  // Ground a road cannot lie on, which is where it has to be a bridge: the same line the
  // server's grid draws (`isBuildable` is what makes a cell BLOCKED there). Close enough
  // to steer a stroke by; the dry run has the last word.
  const deckCell = (c) => { const t = terrain(); return !t.isBuildable(c[0], c[1]); };
  function frameIsland() {
    const t = terrain();
    if (!t) return;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const [gx, gz] of t.landCells) {
      const [x, z] = t.cellWorld(gx, gz);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    view.cx = (minX + maxX) / 2; view.cz = (minZ + maxZ) / 2;
    view.hh = 0.5 * Math.max((maxX - minX) / aspect(), maxZ - minZ) + 6;
    applyView();
  }

  // ------------------------------------------------------------------ the index
  // Who owns which super-cell and which buildings stand on it, read off the village the
  // way hamlets.js reads it: one bitstring per parcel row. A lobe's buildings are the
  // houses whose plot lies on its super-cells plus the sheds of those houses.
  function index() {
    const v = village();
    if (!v || v === indexed) return;
    indexed = v;
    lat = v.island && v.island.lattice;
    lobes = new Map(); lobeAt = new Map(); townAt = new Set(); islandZones = new Set();
    if (!lat) return;
    const stamp = (parcel, into) => {
      if (!parcel) return;
      for (let r = 0; r < parcel.h; r++) for (let c = 0; c < parcel.w; c++) if (parcel.rows[r][c] === '1') into([parcel.i0 + c, parcel.j0 + r]);
    };
    stamp(v.island.town && v.island.town.parcel, (s) => townAt.add(key(s[0], s[1])));
    v.districts.forEach((d, k) => {
      (d.lobes || []).forEach((lo, li) => {
        const rec = { district: d.id, lobe: li, k, name: d.name || d.id, hue: d.hue || 0, supers: [], buildings: [] };
        stamp(lo.parcel, (s) => { rec.supers.push(s); lobeAt.set(key(s[0], s[1]), rec); });
        lobes.set(lkey(rec), rec);
      });
    });
    const houseLobe = new Map();
    for (const b of v.buildings || []) {
      if (!b.plot || b.kind === 'civic' || b.kind === 'shed') continue;
      const s = superOf(lat, b.plot.gx, b.plot.gz);
      const rec = lobeAt.get(key(s[0], s[1]));
      if (rec && rec.district === b.district) { rec.buildings.push(b.id); houseLobe.set(b.id, rec); }
    }
    for (const b of v.buildings || []) {
      if (b.kind !== 'shed' || !b.master) continue;
      const rec = houseLobe.get(b.master);
      if (rec) rec.buildings.push(b.id);
    }
    for (const z of v.zones || []) for (const [i, j] of z.supers || []) islandZones.add(key(i, j));
    polderAt = new Map();
    (v.polders || []).forEach((p, idx) => {
      for (const [gx, gz] of [...(p.cells || []), ...(p.pools || []), ...(p.dike || [])]) {
        const s = superOf(lat, gx, gz);
        polderAt.set(key(s[0], s[1]), idx);
      }
    });
    if (selPolder !== null && !(v.polders || [])[selPolder]) selPolder = null;
    // A draft may name a hamlet the island no longer has.
    const before = ops.length;
    ops = ops.filter((o) => (o.op !== 'move' || o.lobes.every((l) => lobes.has(lkey(l))))
      && (o.op !== 'parcel' || lobes.has(lkey(o)))
      && (o.op !== 'civic' || !!specOf(o.id)));
    for (const k of [...sel]) if (!lobes.has(k)) sel.delete(k);
    if (selCivic && !specOf(selCivic)) selCivic = null;
    if (ops.length !== before) toast('Something in your draft has left the island; that step was dropped.');
  }

  // The cumulative super-cell shift of a lobe in the draft.
  function deltaOf(k) {
    let di = 0, dj = 0;
    for (const o of ops) if (o.op === 'move' && o.lobes.some((l) => lkey(l) === k)) { di += o.di; dj += o.dj; }
    return [di, dj];
  }
  // A lobe's land once the draft is applied, walked op by op in the order the server will
  // apply them: a move shifts it, a parcel op adds and takes away. In order, and not as one
  // summed delta, because land given and then moved is not the same land as land moved and
  // then given - the second is painted where the hamlet will be, the first where it was.
  function supersOf(k, list = ops) {
    const rec = lobes.get(k);
    if (!rec) return [];
    let cells = rec.supers.map(([i, j]) => [i, j]);
    for (const o of list) {
      if (o.op === 'move' && o.lobes.some((l) => lkey(l) === k)) cells = cells.map(([i, j]) => [i + o.di, j + o.dj]);
      else if (o.op === 'parcel' && lkey(o) === k) {
        const gone = new Set(o.remove.map(([i, j]) => key(i, j)));
        const have = new Set(cells.map(([i, j]) => key(i, j)));
        cells = cells.filter(([i, j]) => !gone.has(key(i, j)));
        for (const [i, j] of o.add) if (!have.has(key(i, j))) cells.push([i, j]);
      }
    }
    return cells;
  }
  // Who owns (i, j) once the draft is applied: the moved lobes at their new place, the
  // rest where they are. A lobe's old ground is nobody's the moment it has been moved.
  let projAt = new Map();
  let draftTown = new Set();       // 'i,j' the draft gives the town (`commons`)
  function project(list = ops) {
    projAt = new Map();
    for (const rec of lobes.values()) for (const [i, j] of supersOf(lkey(rec), list)) projAt.set(key(i, j), rec);
    draftTown = new Set();
    for (const o of list) if (o.op === 'commons') for (const [i, j] of o.add) draftTown.add(key(i, j));
  }
  const isTown = (i, j) => townAt.has(key(i, j)) || draftTown.has(key(i, j));
  const ownerAt = (i, j) => (isTown(i, j) ? TOWN : projAt.has(key(i, j)) ? projAt.get(key(i, j)).k : NONE);
  function zoneSets() {
    const z = ops.find((o) => o.op === 'zone');
    return { add: new Set((z ? z.add : []).map(([i, j]) => key(i, j))), remove: new Set((z ? z.remove : []).map(([i, j]) => key(i, j))) };
  }
  function polderSet() {
    const p = ops.find((o) => o.op === 'polder');
    return new Set((p ? p.supers : []).map(([i, j]) => key(i, j)));
  }
  // Water a keeper may reclaim: the survey's own `polderCandidate` bit per super-cell, in
  // its shore form - a super-cell the coastline runs through counts, its sand left as is.
  function reclaimable(i, j) {
    if (!survey) return false;
    const row = survey.water[j + survey.R];
    return !!row && row.charAt(i + survey.R) === '1';
  }

  // ------------------------------------------------------------------ the town's buildings
  // Where each may be set down is a bitmap per building from the server: the draft's own when
  // it moves one or gives the town ground (the dry run's), else the island's (the survey's).
  const FACING = ['north', 'east', 'south', 'west'];
  const hasCivicOps = () => ops.some((o) => o.op === 'civic' || o.op === 'commons');
  const sites = () => (hasCivicOps() && dry.civics) || (survey && survey.civics) || null;
  const movable = (id) => !!(id && survey && survey.civics && survey.civics.sites[id]);
  function specOf(id) {
    const v = village();
    return ((v && v.buildings) || []).find((b) => b.id === id) || null;
  }
  // "the town hall", "the tavern": its label, as it reads in the middle of a sentence.
  function civicName(id) {
    const b = specOf(id);
    const label = String((b && (b.label || b.name)) || id.slice('civic:'.length));
    return `the ${label.replace(/^the /i, '').toLowerCase()}`;
  }
  // Where a town building stands once the draft is applied: its plot, then every step that
  // names it, in order - each one says where it goes, so the last one wins.
  function civicPos(id, list = ops) {
    const b = specOf(id);
    if (!b || !b.plot) return null;
    let at = { gx: b.plot.gx, gz: b.plot.gz, rot: b.plot.rot || 0 };
    for (const o of list) if (o.op === 'civic' && o.id === id) at = { gx: o.gx, gz: o.gz, rot: o.rot };
    return at;
  }
  // A hex digit per corner, one bit per way the door may face (`civicSites`).
  function siteOk(id, gx, gz, rot) {
    const S = sites();
    const rows = S && S.sites[id];
    if (!rows) return false;
    const row = rows[gz - S.gz];
    const mask = row ? parseInt(row.charAt(gx - S.gx) || '0', 16) || 0 : 0;
    return !!((mask >> rot) & 1);
  }
  // The cell the door of a three by three opens onto (`outsideDoor` in lib/layout.mjs): two
  // steps out from the middle along the door's own direction, the table the settlers use.
  const doorstep = (gx, gz, rot) => [gx + 1 + 2 * DOOR_DIR[rot][0], gz + 1 + 2 * DOOR_DIR[rot][1]];
  function judgeCivic() {
    drag.ok = siteOk(drag.civic, drag.gx, drag.gz, drag.rot);
    drag.why = drag.ok ? null : siteOk(drag.civic, drag.gx, drag.gz, (drag.rot + 1) % 4) || siteOk(drag.civic, drag.gx, drag.gz, (drag.rot + 2) % 4) || siteOk(drag.civic, drag.gx, drag.gz, (drag.rot + 3) % 4)
      ? 'its door would face a wall; R turns it' : "no room there, or not the town's ground";
  }
  function turn(dir = 1) {
    if (!active) return;
    if (drag && drag.civic) { drag.rot = (drag.rot + dir + 4) % 4; judgeCivic(); redraw(); return; }
    if (!selCivic) { toast("Pick one of the town's buildings first (1), then turn it."); return; }
    const at = civicPos(selCivic);
    if (at) pushOp({ op: 'civic', id: selCivic, gx: at.gx, gz: at.gz, rot: (at.rot + dir + 4) % 4 });
  }

  // ------------------------------------------------------------------ judging a drop
  // The cheap answer for the colour under the cursor; the server's dry run is the truth.
  function usable(i, j) {
    if (!survey || !lat) return true;
    const R = survey.R;
    const row = survey.usable[j + R];
    return !!row && row.charAt(i + R) === '1' && survey.held[j + R].charAt(i + R) === '0';
  }
  function judge(lobeKeys, di, dj) {
    const t = terrain();
    const out = new Map();
    const ours = new Set([...lobeKeys].map((k) => lobes.get(k).k));
    const ownKeys = new Set(lobeKeys);
    let ok = true, why = null;
    for (const k of lobeKeys) {
      for (const [i0, j0] of supersOf(k)) {
        const i = i0 + di, j = j0 + dj;
        let good = true;
        if (!superComplete(lat, t.size, i, j)) { good = false; why = why || 'off the island'; }
        else if (!usable(i, j)) { good = false; why = why || 'not ground to build on'; }
        else {
          // Ours if it is one of the moving lobes' ground (old or new), else nobody's.
          const at = projAt.get(key(i, j));
          const mine = at && ownKeys.has(lkey(at));
          if (isTown(i, j) || (at && !mine)) { good = false; why = why || `${isTown(i, j) ? 'the town' : at.name}'s land`; }
          else {
            for (let b = -1; b <= 1 && good; b++) {
              for (let a = -1; a <= 1 && good; a++) {
                const n = projAt.get(key(i + a, j + b));
                if (isTown(i + a, j + b) || (n && !ownKeys.has(lkey(n)) && !ours.has(n.k))) { good = false; why = why || 'within the belt of a neighbour'; }
              }
            }
          }
        }
        out.set(key(i, j), good ? 'ok' : 'bad');
        if (!good) ok = false;
      }
    }
    return { cells: out, ok, why };
  }

  // ------------------------------------------------------------------ drawing
  function redraw() {
    project();
    const { add, remove } = zoneSets();
    const selSupers = new Set();
    for (const k of sel) for (const [i, j] of supersOf(k)) selSupers.add(key(i, j));
    const back = ops.find((o) => o.op === 'unpolder');
    overlay.paint({
      owner: ownerAt,
      hueOf: (k) => ((village().districts[k] || {}).hue || 0),
      zones: islandZones, zoneAdd: add, zoneRemove: remove, polder: polderSet(),
      selected: (i, j) => selSupers.has(key(i, j)) || (selPolder !== null && polderAt.get(key(i, j)) === selPolder),
      unpolder: (i, j) => !!back && polderAt.get(key(i, j)) === back.index,
      moving: (i, j) => dragOk.get(key(i, j)) || null,
    });
    // Ghosts and tethers for every lobe the draft has moved, the one being dragged included.
    const ghosts = [], lines = [], rects = [];
    const v = village();
    const specs = new Map((v.buildings || []).map((b) => [b.id, b]));
    const t = terrain();
    const P = lat.pitch;
    for (const rec of lobes.values()) {
      const k = lkey(rec);
      let [di, dj] = deltaOf(k);
      if (drag && sel.has(k)) { di += drag.di; dj += drag.dj; }
      const selected = sel.has(k);
      if (di || dj) {
        const ok = drag && sel.has(k) ? drag.ok : true;
        for (const id of rec.buildings) ghosts.push({ id, dx: di * P, dz: dj * P, ok });
        const c0 = blockOf(lat, ...centreSuper(rec));
        lines.push({ from: [c0[0] + P / 2 - t.half, c0[1] + P / 2 - t.half], to: [c0[0] + P / 2 - t.half + di * P, c0[1] + P / 2 - t.half + dj * P] });
      }
      if (selected) {
        for (const id of rec.buildings) {
          const b = specs.get(id);
          if (b && b.plot) rects.push({ gx: b.plot.gx + di * P, gz: b.plot.gz + dj * P, w: b.plot.w, d: b.plot.d, color: new THREE.Color(0xe8b45c) });
        }
      }
    }
    // The town's buildings the draft moves or turns, the one being dragged and the one picked:
    // a ghost where it will stand, facing the way it will face, its lot outlined, its doorstep
    // boxed so the keeper can see which way it looks, and a tether back to where it stands.
    const civicIds = new Set(ops.filter((o) => o.op === 'civic').map((o) => o.id));
    if (drag && drag.civic) civicIds.add(drag.civic);
    if (selCivic) civicIds.add(selCivic);
    for (const id of civicIds) {
      const b = specs.get(id);
      const at = drag && drag.civic === id ? drag : civicPos(id);
      if (!b || !b.plot || !at) continue;
      // Red while it is being dragged somewhere the map says no, and red after the dry run
      // refused its last step: the ledger says why, the island shows which one.
      let last = -1;
      for (let i = ops.length - 1; i >= 0 && last < 0; i--) if (ops[i].op === 'civic' && ops[i].id === id) last = i;
      const refused = last >= 0 && dry.verdicts && dry.verdicts[last] && !dry.verdicts[last].ok;
      const ok = drag && drag.civic === id ? drag.ok : !refused;
      const color = new THREE.Color(ok ? 0xe8b45c : 0xe0574a);
      if (at.gx !== b.plot.gx || at.gz !== b.plot.gz || at.rot !== (b.plot.rot || 0)) {
        const pose = ghostPose && ghostPose(id, { ...b.plot, gx: at.gx, gz: at.gz, rot: at.rot });
        if (pose) ghosts.push({ id, at: pose, ok });
        if (at.gx !== b.plot.gx || at.gz !== b.plot.gz) {
          lines.push({ from: [b.plot.gx + 1.5 - t.half, b.plot.gz + 1.5 - t.half], to: [at.gx + 1.5 - t.half, at.gz + 1.5 - t.half] });
        }
      }
      rects.push({ gx: at.gx, gz: at.gz, w: 3, d: 3, color });
      const [dx, dz] = doorstep(at.gx, at.gz, at.rot);
      rects.push({ gx: dx, gz: dz, w: 1, d: 1, color });
    }
    for (const o of ops) if (o.op === 'road') roadMarks(o.cells, lines, rects);
    if (stroke) roadMarks(stroke.cells, lines, rects);
    overlay.setGhosts(ghosts);
    const outlines = [...sel].map((k) => ({ supers: supersOf(k), color: new THREE.Color(0xe8b45c) }));
    if (selTown) outlines.push({ supers: [...townAt, ...draftTown].map((k) => k.split(',').map(Number)), color: new THREE.Color(0xe8b45c) });
    overlay.setMarks({ rects, lines, outlines });
    const picked = selCivic ? civicName(selCivic) : null;
    panel.setSelection({
      count: sel.size, names: [...sel].map((k) => lobes.get(k).name), polder: selPolder,
      civic: picked && picked[0].toUpperCase() + picked.slice(1), town: selTown,
    });
    ledger();
  }
  // A road as the overlay draws it: a line from cell middle to cell middle, the stretches
  // that will be a bridge in blue with every deck cell boxed, so the length of the bridge
  // can be read off before it is asked for.
  const ROAD_C = new THREE.Color(0xf0d9a0), DECK_C = new THREE.Color(0x7fd4ff);
  function roadMarks(cells, lines, rects) {
    const t = terrain();
    const mid = ([gx, gz]) => [gx + 0.5 - t.half, gz + 0.5 - t.half];
    for (let n = 1; n < cells.length; n++) {
      const deck = deckCell(cells[n - 1]) || deckCell(cells[n]);
      lines.push({ from: mid(cells[n - 1]), to: mid(cells[n]), color: deck ? DECK_C : ROAD_C });
    }
    for (const c of cells) if (deckCell(c)) rects.push({ gx: c[0], gz: c[1], w: 1, d: 1, color: DECK_C });
  }
  // The runs of a road that will be bridges, as the server cuts them: every stretch of
  // deck between two cells of ground.
  function deckRuns(cells) {
    const runs = [];
    let run = null;
    for (const c of cells) {
      if (deckCell(c)) { (run = run || []).push(c); continue; }
      if (run) { runs.push(run); run = null; }
    }
    return runs;
  }
  function centreSuper(rec) {
    let si = 0, sj = 0;
    for (const [i, j] of rec.supers) { si += i; sj += j; }
    return [Math.round(si / rec.supers.length), Math.round(sj / rec.supers.length)];
  }

  function sentence(o) {
    if (o.op === 'move') return `Move ${o.lobes.map((l) => (lobes.get(lkey(l)) || { name: l.district }).name).join(', ')} by [${o.di}, ${o.dj}]`;
    if (o.op === 'polder') return `Polder: ${o.supers.length} super-cell${o.supers.length === 1 ? '' : 's'} off the sea`;
    if (o.op === 'unpolder') return `Give polder ${o.index + 1} back to the sea`;
    if (o.op === 'grow') return 'Grow the island: one ring of new coast';
    if (o.op === 'road') {
      const spans = deckRuns(o.cells).map((r) => r.length);
      return `Road: ${o.cells.length} cells${spans.length ? `, ${spans.map((n) => `a bridge of ${n}`).join(', ')}` : ''}`;
    }
    if (o.op === 'civic') {
      const b = specOf(o.id);
      const still = b && b.plot && b.plot.gx === o.gx && b.plot.gz === o.gz;
      return still ? `Turn ${civicName(o.id)} to face ${FACING[o.rot]}` : `Move ${civicName(o.id)} to [${o.gx}, ${o.gz}], facing ${FACING[o.rot]}`;
    }
    if (o.op === 'commons') return `Ground for the town: +${o.add.length} super-cell${o.add.length === 1 ? '' : 's'}`;
    if (o.op === 'parcel') return `Land for ${(lobes.get(lkey(o)) || { name: o.district }).name}: ${[o.add.length ? `+${o.add.length}` : '', o.remove.length ? `−${o.remove.length}` : ''].filter(Boolean).join(' / ')}`;
    return `Zone: ${o.add.length ? `+${o.add.length}` : ''}${o.add.length && o.remove.length ? ' / ' : ''}${o.remove.length ? `−${o.remove.length}` : ''} super-cell${o.add.length + o.remove.length === 1 ? '' : 's'}`;
  }
  function ledger() {
    panel.setLedger({
      sentences: ops.map(sentence), verdicts: dry.verdicts, state: ops.length ? dry.state : 'idle', error: dry.error,
      canUndo: ops.length > 0, canRedo: redo.length > 0, snapshots,
    });
  }

  // Every change to the draft comes through here.
  function changed() {
    saveDraft();
    dry.verdicts = null;
    dry.state = ops.length ? 'checking' : 'idle';
    dry.error = null;
    redraw();
    scheduleDry();
  }

  // ------------------------------------------------------------------ the draft
  function pushOp(o) {
    redo = [];
    const last = ops[ops.length - 1];
    if (o.op === 'move' && last && last.op === 'move' && sameLobes(last.lobes, o.lobes)) {
      last.di += o.di; last.dj += o.dj;
      if (!last.di && !last.dj) ops.pop();
    } else if (o.op === 'zone') {
      const z = ops.find((x) => x.op === 'zone');
      const cur = z || { op: 'zone', kind: 'no-build', add: [], remove: [] };
      const add = new Set(cur.add.map(([i, j]) => key(i, j))), remove = new Set(cur.remove.map(([i, j]) => key(i, j)));
      for (const [i, j] of o.add) { const k = key(i, j); if (remove.has(k)) remove.delete(k); else if (!islandZones.has(k)) add.add(k); }
      for (const [i, j] of o.remove) { const k = key(i, j); if (add.has(k)) add.delete(k); else if (islandZones.has(k)) remove.add(k); }
      cur.add = [...add].map((k) => k.split(',').map(Number));
      cur.remove = [...remove].map((k) => k.split(',').map(Number));
      if (!z && (cur.add.length || cur.remove.length)) ops.push(cur);
      if (z && !cur.add.length && !cur.remove.length) ops = ops.filter((x) => x !== z);
    } else if (o.op === 'parcel') {
      // Merged into the op before it only when that is the same hamlet's land: a parcel op
      // that sits in front of a move is in the coordinates the hamlet had before it moved,
      // and a stroke painted since is in the ones it has now.
      if (last && last.op === 'parcel' && lkey(last) === lkey(o)) {
        const add = new Set(last.add.map(([i, j]) => key(i, j))), remove = new Set(last.remove.map(([i, j]) => key(i, j)));
        for (const [i, j] of o.add) { const k = key(i, j); if (remove.has(k)) remove.delete(k); else add.add(k); }
        for (const [i, j] of o.remove) { const k = key(i, j); if (add.has(k)) add.delete(k); else remove.add(k); }
        last.add = [...add].map((k) => k.split(',').map(Number));
        last.remove = [...remove].map((k) => k.split(',').map(Number));
        if (!last.add.length && !last.remove.length) ops.pop();
      } else ops.push(o);
    } else if (o.op === 'unpolder') {
      // One per plan (the server says so too: the list is indexed); asking again for the
      // same one is a no-op, for another one it replaces the first.
      ops = ops.filter((x) => x.op !== 'unpolder');
      ops.push(o);
    } else if (o.op === 'grow') {
      // First in the list, after any grow already there, for the polder's reason: the ground
      // it makes has to exist before a move later in the plan may be set down on it.
      let at = 0;
      while (at < ops.length && ops[at].op === 'grow') at++;
      ops.splice(at, 0, o);
    } else if (o.op === 'civic') {
      // A building's drags in a row fold into one, the way `move` does for a hamlet: the op
      // says where it goes, so the later one simply replaces the earlier - and a building put
      // back where it stood before that step is no step at all.
      const folding = last && last.op === 'civic' && last.id === o.id;
      const before = civicPos(o.id, folding ? ops.slice(0, -1) : ops);
      if (folding) ops.pop();
      if (!before || before.gx !== o.gx || before.gz !== o.gz || before.rot !== o.rot) ops.push({ op: 'civic', id: o.id, gx: o.gx, gz: o.gz, rot: o.rot });
    } else if (o.op === 'commons') {
      // One in a draft, early in it: ground has to be the town's before a building later in
      // the plan may be set down on it (lib/plan.mjs applies the ops in order).
      const c = ops.find((x) => x.op === 'commons');
      const have = new Set((c ? c.add : []).map(([i, j]) => key(i, j)));
      for (const [i, j] of o.add) have.add(key(i, j));
      const add = [...have].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      if (c) c.add = add;
      else {
        let at = 0;
        while (at < ops.length && (ops[at].op === 'grow' || ops[at].op === 'polder')) at++;
        ops.splice(at, 0, { op: 'commons', add });
      }
    } else if (o.op === 'polder') {
      // One polder in a draft, first in the list: the land it makes has to exist before a
      // move later in the plan may be set down on it (lib/plan.mjs applies ops in order).
      const p = ops.find((x) => x.op === 'polder');
      const have = new Set((p ? p.supers : []).map(([i, j]) => key(i, j)));
      for (const [i, j] of o.add) have.add(key(i, j));
      for (const [i, j] of o.remove) have.delete(key(i, j));
      const supers = [...have].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      if (p) { if (supers.length) p.supers = supers; else ops = ops.filter((x) => x !== p); }
      else if (supers.length) ops.unshift({ op: 'polder', supers });
    } else {
      ops.push(o);
    }
    changed();
  }
  const sameLobes = (a, b) => a.length === b.length && a.every((l) => b.some((m) => lkey(m) === lkey(l)));
  function undoOp() { if (!ops.length) return; redo.push(ops.pop()); changed(); }
  function redoOp() { if (!redo.length) return; ops.push(redo.pop()); changed(); }
  function clearOps() { if (!ops.length) return; redo = []; ops = []; changed(); }
  function removeForSelection() {
    // A standing polder picked with the Polder tool: Delete gives it back to the sea.
    if (selPolder !== null) { pushOp({ op: 'unpolder', index: selPolder }); return; }
    // A picked town building: its last step in the draft goes.
    if (selCivic) {
      for (let i = ops.length - 1; i >= 0; i--) if (ops[i].op === 'civic' && ops[i].id === selCivic) { redo.push(...ops.splice(i, 1)); changed(); return; }
      return;
    }
    if (!sel.size) return;
    for (let i = ops.length - 1; i >= 0; i--) {
      const o = ops[i];
      if (o.op === 'move' && o.lobes.some((l) => sel.has(lkey(l)))) { redo.push(...ops.splice(i, 1)); changed(); return; }
    }
  }
  function saveDraft() {
    try {
      const v = village();
      if (!ops.length) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, seed: v.island.seed, size: v.grid.size, ops }));
    } catch { /* no storage */ }
  }
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      const v = village();
      if (d && d.v === 1 && d.seed === v.island.seed && d.size === v.grid.size && Array.isArray(d.ops)) ops = d.ops;
    } catch { ops = []; }
  }
  function saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* fine */ } }
  function loadView() {
    try {
      const w = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      if (w && Number.isFinite(w.cx) && Number.isFinite(w.hh)) { Object.assign(view, w); return true; }
    } catch { /* fine */ }
    return false;
  }

  // ------------------------------------------------------------------ the island
  function scheduleDry() {
    clearTimeout(dry.timer);
    if (!ops.length) return;
    dry.timer = setTimeout(runDry, 350);
  }
  async function runDry() {
    const seq = ++dry.seq;
    let r, body;
    try {
      r = await mine('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops, dryRun: true }) });
      body = await r.json().catch(() => ({}));
    } catch { if (seq === dry.seq) { dry.state = 'unreachable'; ledger(); } return; }
    if (seq !== dry.seq) return;
    // Kept until the next one that has them: a refused draft bakes none, and the island's
    // own survey would colour the next drag as if the draft's earlier steps were not there.
    if (body.civics) dry.civics = body.civics;
    dry.verdicts = body.verdicts || null;
    dry.state = body.ok ? 'ok' : 'refused';
    dry.error = body.ok ? null : (body.error || (r.status === 423 ? 'The island is scanning; try again in a moment.' : `The island said no (${r.status}).`));
    // A town building's ghost is coloured by the verdict, so the island is drawn again.
    if (hasCivicOps()) redraw(); else ledger();
  }
  async function applyDraft() {
    if (!ops.length || dry.state !== 'ok') return;
    const draft = ops;
    ops = []; redo = []; saveDraft();        // gone before the reload the island will ask for
    ledger();
    try {
      const r = await mine('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: draft }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.ok) {
        ops = draft; saveDraft();
        dry.state = 'refused'; dry.verdicts = body.verdicts || null; dry.error = body.error || `The island said no (${r.status}).`;
        redraw();
        toast(esc(dry.error));
        return;
      }
      const moved = body.diff.plots.moved.length;
      toast(moved ? `Applied: ${moved} building(s) moved.` : 'Applied.');
    } catch { ops = draft; saveDraft(); dry.state = 'unreachable'; redraw(); toast('The island did not answer.'); }
  }
  async function restorePrevious() {
    try {
      const info = await mine('/api/plan').then((r) => r.json());
      const name = info.snapshots && info.snapshots[0];
      if (!name) { toast('There is no earlier layout to go back to.'); return; }
      const r = await mine('/api/plan/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshot: name }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.ok) { toast(esc(body.error || `The island said no (${r.status}).`)); return; }
      toast(`Restored ${esc(name)}.`);
    } catch { toast('The island did not answer.'); }
  }
  async function fetchIsland() {
    try {
      const info = await mine('/api/plan').then((r) => r.json());
      snapshots = (info.snapshots || []).length;
    } catch { snapshots = 0; }
    try { survey = await mine('/api/plan/survey').then((r) => (r.ok ? r.json() : null)); } catch { survey = null; }
    if (active) redraw();
  }

  // ------------------------------------------------------------------ pointer
  function pickBuilding(px, py) {
    ndc.set((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const recs = byId();
    const hits = ray.intersectObjects(pickables().filter((m) => m.parent && m.parent.visible && recs.has(m.userData.id)), false);
    return hits.length ? hits[0].object.userData.id : null;
  }
  function lobeUnder(px, py) {
    const id = pickBuilding(px, py);
    if (id) for (const rec of lobes.values()) if (rec.buildings.includes(id)) return rec;
    const s = superAt(px, py);
    return s ? projAt.get(key(s[0], s[1])) || null : null;
  }
  function onDown(e) {
    if (!active) return;
    dom.setPointerCapture(e.pointerId);
    ptr = { x: e.clientX, y: e.clientY };
    const painting = tool === 'zone' || tool === 'polder' || tool === 'land';
    if (e.button === 1 || (e.button === 2 && !painting)) { pan = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz }; return; }
    if (tool === 'polder' && e.button === 0) {
      const s = superAt(e.clientX, e.clientY);
      if (s && polderAt.has(key(s[0], s[1]))) { press = { x: e.clientX, y: e.clientY, polder: polderAt.get(key(s[0], s[1])) }; return; }
    }
    if (tool === 'road' && e.button === 0) {
      const c = cellAt(e.clientX, e.clientY);
      if (!c) return;
      if (deckCell(c)) { toast('A road starts on dry ground: begin it on a road that reaches the square.'); return; }
      stroke = { cells: [c] };
      redraw();
      return;
    }
    const forTown = tool === 'land' && sel.size !== 1 && selTown;
    if (tool === 'land' && sel.size !== 1 && !forTown) { toast('Land goes to one hamlet at a time, or to the town: select it first (1), then paint.'); return; }
    if (forTown && (e.button === 2 || e.altKey)) { toast("The town's ground is only ever given; there is nothing to take away here."); return; }
    if (painting && (e.button === 0 || e.button === 2)) {
      paint = { kind: tool === 'land' ? (forTown ? 'commons' : 'parcel') : tool, lobe: tool === 'land' && !forTown ? [...sel][0] : null, add: new Set(), remove: new Set(), mode: e.button === 2 || e.altKey ? 'remove' : 'add', last: null };
      paintStroke(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    // One of the town's buildings under the pointer is taken before the hamlet under it: it
    // is picked, or carried, on its own.
    const hit = pickBuilding(e.clientX, e.clientY);
    const civic = movable(hit) ? hit : null;
    const rec = civic ? null : lobeUnder(e.clientX, e.clientY);
    press = { x: e.clientX, y: e.clientY, rec, civic, onSelected: !!(rec && sel.has(lkey(rec))), shift: e.shiftKey };
  }
  // A fast stroke arrives as a handful of pointer positions a long way apart, and a polder
  // painted from them would be beads on a string - which the server rightly refuses as
  // several pieces. So every step is walked from the last one, a quarter super-cell at a time.
  function paintStroke(px, py) {
    const from = paint.last || { x: px, y: py };
    const wpp = (2 * view.hh) / innerHeight;
    const step = Math.max(1, (lat ? lat.pitch : 4) / 4 / wpp);
    const n = Math.max(1, Math.ceil(Math.hypot(px - from.x, py - from.y) / step));
    for (let k = 1; k <= n; k++) paintAt(from.x + (px - from.x) * (k / n), from.y + (py - from.y) * (k / n));
    paint.last = { x: px, y: py };
  }
  function paintAt(px, py) {
    const s = superAt(px, py);
    if (!s || !lat) return;
    const t = terrain();
    if (!superComplete(lat, t.size, s[0], s[1])) return;
    const k = key(s[0], s[1]);
    if (paint.kind === 'polder') {
      // Only water the ladder itself would take, and only joined to the polder so far: a
      // stroke along a coast of scattered shallows would otherwise leave beads on a string,
      // which the server refuses as several polders. So it grows from the first cell, four-
      // connected, the way `planPolder` grows one.
      if (paint.mode === 'add') {
        if (!reclaimable(s[0], s[1]) || paint.add.has(k)) return;
        const have = polderSet();
        for (const a of paint.add) have.add(a);
        for (const r of paint.remove) have.delete(r);
        const joined = !have.size || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => have.has(key(s[0] + a, s[1] + b)));
        if (!joined) return;
        paint.add.add(k); paintPreview();
      }
      else if (!paint.remove.has(k)) { paint.remove.add(k); paintPreview(); }
      return;
    }
    if (paint.kind === 'commons') {
      // Ground for the town grows from its edge, the way the commons grows by itself: nobody's,
      // good to build on, four-connected to what the town has. `opCommons` is the judge, the
      // belt round a hamlet included; this only keeps the stroke in one piece.
      if (isTown(s[0], s[1]) || paint.add.has(k) || !usable(s[0], s[1]) || projAt.has(k)) return;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => isTown(s[0] + a, s[1] + b) || paint.add.has(key(s[0] + a, s[1] + b)))) return;
      paint.add.add(k); paintPreview();
      return;
    }
    if (paint.kind === 'parcel') {
      // Land grows from the hamlet's edge, the way a scan grows it: ground nobody else holds,
      // good to build on, four-connected to what it has. Taking away is only its own.
      const have = new Set(supersOf(paint.lobe).map(([i, j]) => key(i, j)));
      for (const a of paint.add) have.add(a);
      for (const r of paint.remove) have.delete(r);
      if (paint.mode === 'add') {
        if (have.has(k) || isTown(s[0], s[1]) || !usable(s[0], s[1])) return;
        const at = projAt.get(k);
        if (at && lkey(at) !== paint.lobe) return;
        if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => have.has(key(s[0] + a, s[1] + b)))) return;
        paint.remove.delete(k); paint.add.add(k); paintPreview();
      } else if (have.has(k)) {
        paint.add.delete(k); paint.remove.add(k); paintPreview();
      }
      return;
    }
    if (paint.mode === 'add') { if (!islandZones.has(k) && !paint.add.has(k)) { paint.add.add(k); paintPreview(); } }
    else if (!paint.remove.has(k)) { paint.remove.add(k); paintPreview(); }
  }
  // The stroke so far as a parcel op, for the preview and for pushOp.
  function strokeOp() {
    if (paint.kind === 'commons') return { op: 'commons', add: [...paint.add].map((k) => k.split(',').map(Number)), remove: [] };
    const rec = lobes.get(paint.lobe);
    return { op: 'parcel', district: rec.district, lobe: rec.lobe, add: [...paint.add].map((k) => k.split(',').map(Number)), remove: [...paint.remove].map((k) => k.split(',').map(Number)) };
  }
  // The stroke so far, drawn as if it were already in the draft.
  function paintPreview() {
    const { add, remove } = zoneSets();
    const polder = polderSet();
    if (paint.kind === 'polder') {
      for (const k of paint.add) polder.add(k);
      for (const k of paint.remove) polder.delete(k);
    } else if (paint.kind !== 'commons') {
      for (const k of paint.add) add.add(k);
      for (const k of paint.remove) { if (add.has(k)) add.delete(k); else remove.add(k); }
    }
    let selected = () => false;
    if (paint.kind === 'parcel') {
      const list = [...ops, strokeOp()];
      project(list);
      const mine = new Set(supersOf(paint.lobe, list).map(([i, j]) => key(i, j)));
      selected = (i, j) => mine.has(key(i, j));
    }
    if (paint.kind === 'commons') {
      project([...ops, strokeOp()]);
      selected = (i, j) => isTown(i, j);
    }
    overlay.paint({
      owner: ownerAt, hueOf: (k) => ((village().districts[k] || {}).hue || 0),
      zones: islandZones, zoneAdd: add, zoneRemove: remove, polder, selected, moving: () => null,
    });
    if (paint.kind === 'parcel' || paint.kind === 'commons') project();
  }
  // Walk the stroke towards the cell under the pointer, one neighbouring cell at a time.
  // Dragging back over the road already drawn takes it back to there, which is how a
  // wrong turn is undone mid-stroke. On a deck the only way on is straight ahead, so a
  // bridge comes out as one straight run however the hand wobbles over the water.
  function extendStroke(px, py) {
    const goal = cellAt(px, py);
    if (!goal) return;
    const cells = stroke.cells;
    const was = `${cells.length}:${cells[cells.length - 1]}`;
    for (let guard = 0; guard < 600; guard++) {
      const last = cells[cells.length - 1];
      const dx = goal[0] - last[0], dz = goal[1] - last[1];
      if (!dx && !dz) break;
      let step;
      if (cells.length > 1 && deckCell(last)) {
        const prev = cells[cells.length - 2];
        step = [last[0] - prev[0], last[1] - prev[1]];
        // Only while the pointer is further out along that line; otherwise wait for it.
        if ((step[0] && Math.sign(dx) !== step[0]) || (step[1] && Math.sign(dz) !== step[1])) break;
      } else {
        step = Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
      }
      const next = [last[0] + step[0], last[1] + step[1]];
      const back = cells.findIndex((c) => c[0] === next[0] && c[1] === next[1]);
      if (back >= 0) cells.length = back + 1;
      else cells.push(next);
      if (cells.length >= 512) break;
    }
    if (`${cells.length}:${cells[cells.length - 1]}` !== was) redraw();
  }
  function onMove(e) {
    if (!active) return;
    ptr = { x: e.clientX, y: e.clientY };
    if (stroke) { extendStroke(e.clientX, e.clientY); return; }
    if (pan) {
      const wpp = (2 * view.hh) / innerHeight;
      view.cx = pan.cx - (e.clientX - pan.x) * wpp;
      view.cz = pan.cz - (e.clientY - pan.y) * wpp;
      applyView();
      return;
    }
    if (paint) { paintStroke(e.clientX, e.clientY); return; }
    if (!press || press.polder !== undefined) return;
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX;
    if (!drag && !band && far) {
      // A town building is carried by grabbing it, with either tool, or - with Move - by
      // dragging anywhere once it is picked.
      const civic = (tool === 'move' || tool === 'select') ? press.civic || (tool === 'move' && selCivic) || null : null;
      const at = civic && civicPos(civic);
      if (at) {
        selCivic = civic; sel.clear(); selTown = false;
        drag = { civic, base: at, gx: at.gx, gz: at.gz, rot: at.rot, ok: true, why: null };
      } else {
        const carry = sel.size && (tool === 'move' || (tool === 'select' && press.onSelected));
        if (carry) drag = { di: 0, dj: 0, ok: true, why: null };
        else band = { x0: press.x, y0: press.y };
      }
    }
    if (drag && drag.civic) {
      // Cell by cell: a world unit is a grid cell.
      const [x0, z0] = toWorld(press.x, press.y), [x1, z1] = toWorld(e.clientX, e.clientY);
      const gx = drag.base.gx + Math.round(x1 - x0), gz = drag.base.gz + Math.round(z1 - z0);
      if (gx !== drag.gx || gz !== drag.gz) { drag.gx = gx; drag.gz = gz; judgeCivic(); redraw(); }
    } else if (drag) {
      const [x0, z0] = toWorld(press.x, press.y), [x1, z1] = toWorld(e.clientX, e.clientY);
      const di = Math.round((x1 - x0) / lat.pitch), dj = Math.round((z1 - z0) / lat.pitch);
      if (di !== drag.di || dj !== drag.dj) {
        drag.di = di; drag.dj = dj;
        const j = judge(sel, di, dj);
        dragOk = j.cells; drag.ok = j.ok; drag.why = j.why;
        redraw();
      }
    } else if (band) {
      panel.setBand({ x0: band.x0, y0: band.y0, x1: e.clientX, y1: e.clientY });
    }
  }
  function onUp(e) {
    if (!active) return;
    try { dom.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
    if (pan) { pan = null; return; }
    if (stroke) {
      const cells = stroke.cells;
      stroke = null;
      // A road that ends out over the water is pulled back to its last dry cell: the
      // stroke let go of mid-river is a road to the bank, not a refusal.
      while (cells.length && deckCell(cells[cells.length - 1])) cells.pop();
      if (cells.length >= 2) pushOp({ op: 'road', cells }); else redraw();
      return;
    }
    if (paint) {
      const o = paint.kind === 'parcel' ? strokeOp()
        : { op: paint.kind, kind: 'no-build', add: [...paint.add].map((k) => k.split(',').map(Number)), remove: [...paint.remove].map((k) => k.split(',').map(Number)) };
      paint = null;
      if (o.add.length || o.remove.length) pushOp(o); else redraw();
      return;
    }
    if (drag && drag.civic) {
      const { civic, gx, gz, rot } = drag;
      drag = null; dragOk = new Map(); press = null;
      const at = civicPos(civic);
      if (at && (at.gx !== gx || at.gz !== gz || at.rot !== rot)) pushOp({ op: 'civic', id: civic, gx, gz, rot });
      else redraw();
      return;
    }
    if (drag) {
      const { di, dj } = drag;
      drag = null; dragOk = new Map();
      if (di || dj) pushOp({ op: 'move', lobes: [...sel].map((k) => ({ district: lobes.get(k).district, lobe: lobes.get(k).lobe })), di, dj });
      else redraw();
      press = null;
      return;
    }
    if (band) {
      const [ax, az] = toWorld(band.x0, band.y0), [bx, bz] = toWorld(e.clientX, e.clientY);
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
      band = null; panel.setBand(null);
      if (!press.shift) sel.clear();
      selCivic = null; selTown = false;
      const t = terrain();
      for (const rec of lobes.values()) {
        const [di, dj] = deltaOf(lkey(rec));
        const inside = rec.supers.some(([i, j]) => {
          const [gx, gz] = blockOf(lat, i + di, j + dj);
          const x = gx + lat.pitch / 2 - t.half, z = gz + lat.pitch / 2 - t.half;
          return x >= x0 && x <= x1 && z >= z0 && z <= z1;
        });
        if (inside) sel.add(lkey(rec));
      }
      press = null;
      redraw();
      return;
    }
    if (press && press.polder !== undefined) {
      selPolder = selPolder === press.polder ? null : press.polder;
      sel.clear(); selCivic = null; selTown = false;
      press = null;
      redraw();
      return;
    }
    if (press) {
      // A click.
      const rec = press.rec;
      selPolder = null;
      if (press.civic) {
        sel.clear(); selTown = false;
        selCivic = press.civic;
        press = null;
        redraw();
        return;
      }
      selCivic = null; selTown = false;
      if (!press.shift) sel.clear();
      if (rec) { if (press.shift && sel.has(lkey(rec))) sel.delete(lkey(rec)); else sel.add(lkey(rec)); }
      else if (pickBuilding(e.clientX, e.clientY)) toast('That one belongs where it stands; the buildings round the square and the hamlets move.');
      else {
        // The town's own ground: the town is picked, for the Land tool to give it more.
        const s = superAt(e.clientX, e.clientY);
        if (s && isTown(s[0], s[1]) && !press.shift) selTown = true;
      }
      press = null;
      redraw();
    }
  }
  function onWheel(e) {
    if (!active) return;
    e.preventDefault();
    const [wx, wz] = toWorld(e.clientX, e.clientY);
    const f = Math.exp((e.deltaY > 0 ? 1 : -1) * 0.12);
    const t = terrain();
    view.hh = Math.min(t ? t.half * 1.25 : 400, Math.max(6, view.hh * f));
    const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
    view.cx = wx - nx * view.hh * aspect();
    view.cz = wz + ny * view.hh;
    applyView();
  }
  function onContext(e) { if (active) e.preventDefault(); }
  function cancelGesture() {
    press = null; pan = null;
    if (drag) { drag = null; dragOk = new Map(); }
    if (band) { band = null; panel.setBand(null); }
    if (paint) paint = null;
    stroke = null;
    redraw();
  }

  // ------------------------------------------------------------------ keys
  function onKey(e) {
    if (!active) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.type === 'keyup') { keys.delete(e.code); return; }
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'Escape') {
      take();
      if (drag || band || paint || pan || stroke) cancelGesture();
      else if (sel.size || selPolder !== null || selCivic || selTown) { sel.clear(); selPolder = null; selCivic = null; selTown = false; redraw(); }
      else exit();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') { take(); if (e.shiftKey) redoOp(); else undoOp(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { take(); redoOp(); return; }
    if (!ctrl && e.code === 'KeyR' && (selCivic || (drag && drag.civic))) { take(); turn(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { take(); removeForSelection(); return; }
    if (e.key === '1') { take(); setTool('select'); return; }
    if (e.key === '2') { take(); setTool('move'); return; }
    if (e.key === '3') { take(); setTool('zone'); return; }
    if (e.key === '4') { take(); setTool('polder'); return; }
    if (e.key === '5') { take(); setTool('land'); return; }
    if (e.key === '6') { take(); setTool('road'); return; }
    if (PAN_KEYS[e.code]) { take(); keys.add(e.code); }
  }
  function setTool(t) { tool = t; panel.setTool(t); cancelGesture(); }

  // ------------------------------------------------------------------ every frame
  function update(dt) {
    if (!active) return;
    // A new village - a scan, or the one an Apply just wrote - is indexed again, and the
    // survey and the snapshot list with it: both describe the island as it was. A new
    // terrain (a polder dug or given back) needs the overlay's ground laid again, because
    // its vertices sit on the corners of the heightfield it was built from.
    if (village() !== indexed) { index(); dry.civics = null; changed(); fetchIsland(); }
    if (terrain() !== groundSeen) { groundSeen = terrain(); overlay.rebuildGround(); redraw(); }
    let mx = 0, mz = 0;
    for (const k of keys) { const d = PAN_KEYS[k]; if (d) { mx += d[0]; mz += d[1]; } }
    if (mx || mz) { view.cx += mx * view.hh * 1.5 * dt; view.cz += mz * view.hh * 1.5 * dt; applyView(); }
    const s = drag || band || pan || stroke ? null : superAt(ptr.x, ptr.y);
    overlay.setHover(s);
    panel.setHud(hud(s));
  }
  function hud(s) {
    const tip = tool === 'select' ? (selCivic ? 'drag it to carry it; <kbd>R</kbd> turns it; <kbd>Delete</kbd> takes its last step back'
      : "click a hamlet, a town building or the town's ground; drag a box; <kbd>Shift</kbd> adds")
      : tool === 'move' ? 'drag to carry the selected hamlets (super-grid) or town building (cell by cell); <kbd>R</kbd> turns it'
        : tool === 'polder' ? 'paint shallow water to take off the sea; click a standing polder to pick it'
          : tool === 'land' ? (sel.size === 1 ? 'paint land onto the edge of the selected hamlet; right-drag takes it away' : selTown ? 'paint more ground onto the edge of the town' : 'select one hamlet or the town first (1), then paint its land')
          : tool === 'road' ? 'drag a road out from one that reaches the square; over a river it is bridged to size'
          : 'paint ground nothing may be built on; right-drag releases it';
    let where = '';
    if (drag && drag.civic) where = `<span class="${drag.ok ? 'ok' : 'why'}">${esc(civicName(drag.civic))} at [${drag.gx}, ${drag.gz}], facing ${FACING[drag.rot]} · ${drag.ok ? 'fits' : esc(drag.why)}</span>`;
    else if (drag) where = `<span class="${drag.ok ? 'ok' : 'why'}">[${drag.di}, ${drag.dj}] ${drag.ok ? 'fits' : esc(drag.why || 'no')}</span>`;
    else if (stroke) {
      const spans = deckRuns(stroke.cells).map((r) => r.length);
      where = `<span class="muted">${stroke.cells.length} cells${spans.length ? ` · bridge ${spans.join(' + ')}` : ''}</span>`;
    }
    else if (s) {
      const k = key(s[0], s[1]);
      const rec = projAt.get(k);
      const onPolder = polderAt.has(k) ? ` · polder ${polderAt.get(k) + 1}` : '';
      const what = isTown(s[0], s[1]) ? 'the town' : rec ? esc(rec.name) : usable(s[0], s[1]) ? 'open ground' : reclaimable(s[0], s[1]) ? 'shallows, reclaimable' : 'not for building';
      where = `<span class="muted">[${s[0]}, ${s[1]}] · ${what}${onPolder}${islandZones.has(k) ? ' · zoned' : ''}</span>`;
      if (selPolder !== null) where += `<span>polder ${selPolder + 1} picked · <kbd>Delete</kbd> gives it back to the sea</span>`;
      if (selCivic) where = `<span class="muted">${esc(civicName(selCivic))} picked</span>`;
    }
    return `<b>${tool[0].toUpperCase()}${tool.slice(1)}</b><span>${tip}</span>${where}<span class="muted"><kbd>Esc</kbd> back</span>`;
  }

  // ------------------------------------------------------------------ in and out
  function enter() {
    if (active) return;
    active = true;
    index();
    if (!lat) { active = false; toast('The island has no lattice yet; scan first.'); return; }
    overlay.rebuildGround();
    groundSeen = terrain();
    overlay.setVisible(true);
    if (!loadView()) frameIsland(); else applyView();
    loadDraft();
    panel.show();
    panel.setTool(tool);
    panel.setGrowable && panel.setGrowable(!!(village() && village().grow));
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointercancel', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', onContext);
    addEventListener('keydown', onKey, { capture: true });
    addEventListener('keyup', onKey, { capture: true });
    changed();
    fetchIsland();
  }
  function exit() {
    if (!active) return;
    cancelGesture();
    active = false;
    keys.clear();
    dom.removeEventListener('pointerdown', onDown);
    dom.removeEventListener('pointermove', onMove);
    dom.removeEventListener('pointerup', onUp);
    dom.removeEventListener('pointercancel', onUp);
    dom.removeEventListener('wheel', onWheel);
    dom.removeEventListener('contextmenu', onContext);
    removeEventListener('keydown', onKey, { capture: true });
    removeEventListener('keyup', onKey, { capture: true });
    clearTimeout(dry.timer);
    overlay.setVisible(false);
    panel.hide();
    panel.setHud(null);
    saveView();
    saveDraft();
    if (ops.length) toast(`Your draft is kept (${ops.length} step${ops.length === 1 ? '' : 's'}). Clear throws it away.`);
    onExit();
  }

  return {
    camera, view, enter, exit, active: () => active, update, frameIsland, setTool,
    resize: () => { if (active) applyView(); },
    undo: undoOp, redo: redoOp, clear: clearOps, apply: applyDraft, restore: restorePrevious,
    grow: () => { if (active) pushOp({ op: 'grow' }); },
    turn: (dir = 1) => turn(dir),
  };
}
