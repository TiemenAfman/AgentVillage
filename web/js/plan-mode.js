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
// run after each change and for the real thing on Apply, after which the page reloads.
// What the page judges for itself - the green or red of a drag - comes from the survey
// the server bakes (`GET /api/plan/survey`), so it never carries a second copy of the rules.
//
// Keys are taken in the capture phase on window, the way ghost.js and buildmenu.js do,
// and only while planning: Escape backs out one level at a time, Ctrl+Z/Y undo and redo,
// 1-3 pick a tool, WASD and the arrows pan. Installed on enter, removed on exit.
import * as THREE from 'three';
import { blockOf, superOf, superComplete } from 'shared/lattice.mjs';
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

export function createPlanMode({ dom, terrain, village, byId, pickables, bounds, overlay, panel, toast, onExit }) {
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
  let survey = null;
  let snapshots = 0;
  const sel = new Set();           // lobe keys
  let ops = [], redo = [];
  let ptr = { x: 0, y: 0 };
  let press = null, drag = null, band = null, paint = null, pan = null;
  let dragOk = new Map();          // 'i,j' -> 'ok' | 'bad' during a drag
  const keys = new Set();
  let dry = { seq: 0, timer: null, state: 'idle', verdicts: null, error: null };
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
    // A draft may name a hamlet the island no longer has.
    const before = ops.length;
    ops = ops.filter((o) => o.op !== 'move' || o.lobes.every((l) => lobes.has(lkey(l))));
    for (const k of [...sel]) if (!lobes.has(k)) sel.delete(k);
    if (ops.length !== before) toast('A hamlet in your draft has left the island; that step was dropped.');
  }

  // The cumulative super-cell shift of a lobe in the draft.
  function deltaOf(k) {
    let di = 0, dj = 0;
    for (const o of ops) if (o.op === 'move' && o.lobes.some((l) => lkey(l) === k)) { di += o.di; dj += o.dj; }
    return [di, dj];
  }
  // Who owns (i, j) once the draft is applied: the moved lobes at their new place, the
  // rest where they are. A lobe's old ground is nobody's the moment it has been moved.
  let projAt = new Map();
  function project() {
    projAt = new Map();
    for (const rec of lobes.values()) {
      const [di, dj] = deltaOf(lkey(rec));
      for (const [i, j] of rec.supers) projAt.set(key(i + di, j + dj), rec);
    }
  }
  const ownerAt = (i, j) => (townAt.has(key(i, j)) ? TOWN : projAt.has(key(i, j)) ? projAt.get(key(i, j)).k : NONE);
  function zoneSets() {
    const z = ops.find((o) => o.op === 'zone');
    return { add: new Set((z ? z.add : []).map(([i, j]) => key(i, j))), remove: new Set((z ? z.remove : []).map(([i, j]) => key(i, j))) };
  }
  function polderSet() {
    const p = ops.find((o) => o.op === 'polder');
    return new Set((p ? p.supers : []).map(([i, j]) => key(i, j)));
  }
  // Water the ladder would take: the survey's own `polderCandidate` bit per super-cell.
  function reclaimable(i, j) {
    if (!survey) return false;
    const row = survey.water[j + survey.R];
    return !!row && row.charAt(i + survey.R) === '1';
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
      const rec = lobes.get(k);
      const [pi, pj] = deltaOf(k);
      for (const [i0, j0] of rec.supers) {
        const i = i0 + pi + di, j = j0 + pj + dj;
        let good = true;
        if (!superComplete(lat, t.size, i, j)) { good = false; why = why || 'off the island'; }
        else if (!usable(i, j)) { good = false; why = why || 'not ground to build on'; }
        else {
          // Ours if it is one of the moving lobes' ground (old or new), else nobody's.
          const at = projAt.get(key(i, j));
          const mine = at && ownKeys.has(lkey(at));
          if (townAt.has(key(i, j)) || (at && !mine)) { good = false; why = why || `${townAt.has(key(i, j)) ? 'the town' : at.name}'s land`; }
          else {
            for (let b = -1; b <= 1 && good; b++) {
              for (let a = -1; a <= 1 && good; a++) {
                const n = projAt.get(key(i + a, j + b));
                if (townAt.has(key(i + a, j + b)) || (n && !ownKeys.has(lkey(n)) && !ours.has(n.k))) { good = false; why = why || 'within the belt of a neighbour'; }
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
    for (const k of sel) {
      const rec = lobes.get(k);
      const [di, dj] = deltaOf(k);
      for (const [i, j] of rec.supers) selSupers.add(key(i + di, j + dj));
    }
    overlay.paint({
      owner: ownerAt,
      hueOf: (k) => ((village().districts[k] || {}).hue || 0),
      zones: islandZones, zoneAdd: add, zoneRemove: remove, polder: polderSet(),
      selected: (i, j) => selSupers.has(key(i, j)),
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
    overlay.setGhosts(ghosts);
    overlay.setMarks({ rects, lines, outlines: [...sel].map((k) => {
      const rec = lobes.get(k); const [di, dj] = deltaOf(k);
      return { supers: rec.supers.map(([i, j]) => [i + di, j + dj]), color: new THREE.Color(0xe8b45c) };
    }) });
    panel.setSelection({ count: sel.size, names: [...sel].map((k) => lobes.get(k).name) });
    ledger();
  }
  function centreSuper(rec) {
    let si = 0, sj = 0;
    for (const [i, j] of rec.supers) { si += i; sj += j; }
    return [Math.round(si / rec.supers.length), Math.round(sj / rec.supers.length)];
  }

  function sentence(o) {
    if (o.op === 'move') return `Move ${o.lobes.map((l) => (lobes.get(lkey(l)) || { name: l.district }).name).join(', ')} by [${o.di}, ${o.dj}]`;
    if (o.op === 'polder') return `Polder: ${o.supers.length} super-cell${o.supers.length === 1 ? '' : 's'} off the sea`;
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
    dry.verdicts = body.verdicts || null;
    dry.state = body.ok ? 'ok' : 'refused';
    dry.error = body.ok ? null : (body.error || (r.status === 423 ? 'The island is scanning; try again in a moment.' : `The island said no (${r.status}).`));
    ledger();
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
      toast(`Applied: ${body.diff.plots.moved.length} building(s) moved. The island is being redrawn.`);
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
      toast(`Restored ${esc(name)}. The island is being redrawn.`);
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
    const painting = tool === 'zone' || tool === 'polder';
    if (e.button === 1 || (e.button === 2 && !painting)) { pan = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz }; return; }
    if (painting && (e.button === 0 || e.button === 2)) {
      paint = { kind: tool, add: new Set(), remove: new Set(), mode: e.button === 2 || e.altKey ? 'remove' : 'add', last: null };
      paintStroke(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    const rec = lobeUnder(e.clientX, e.clientY);
    press = { x: e.clientX, y: e.clientY, rec, onSelected: !!(rec && sel.has(lkey(rec))), shift: e.shiftKey };
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
    if (paint.mode === 'add') { if (!islandZones.has(k) && !paint.add.has(k)) { paint.add.add(k); paintPreview(); } }
    else if (!paint.remove.has(k)) { paint.remove.add(k); paintPreview(); }
  }
  // The stroke so far, drawn as if it were already in the draft.
  function paintPreview() {
    const { add, remove } = zoneSets();
    const polder = polderSet();
    if (paint.kind === 'polder') {
      for (const k of paint.add) polder.add(k);
      for (const k of paint.remove) polder.delete(k);
    } else {
      for (const k of paint.add) add.add(k);
      for (const k of paint.remove) { if (add.has(k)) add.delete(k); else remove.add(k); }
    }
    overlay.paint({
      owner: ownerAt, hueOf: (k) => ((village().districts[k] || {}).hue || 0),
      zones: islandZones, zoneAdd: add, zoneRemove: remove, polder, selected: () => false, moving: () => null,
    });
  }
  function onMove(e) {
    if (!active) return;
    ptr = { x: e.clientX, y: e.clientY };
    if (pan) {
      const wpp = (2 * view.hh) / innerHeight;
      view.cx = pan.cx - (e.clientX - pan.x) * wpp;
      view.cz = pan.cz - (e.clientY - pan.y) * wpp;
      applyView();
      return;
    }
    if (paint) { paintStroke(e.clientX, e.clientY); return; }
    if (!press) return;
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX;
    if (!drag && !band && far) {
      const carry = sel.size && (tool === 'move' || (tool === 'select' && press.onSelected));
      if (carry) drag = { di: 0, dj: 0, ok: true, why: null };
      else band = { x0: press.x, y0: press.y };
    }
    if (drag) {
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
    if (paint) {
      const o = { op: paint.kind, kind: 'no-build', add: [...paint.add].map((k) => k.split(',').map(Number)), remove: [...paint.remove].map((k) => k.split(',').map(Number)) };
      paint = null;
      if (o.add.length || o.remove.length) pushOp(o); else redraw();
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
    if (press) {
      // A click.
      const rec = press.rec;
      if (!press.shift) sel.clear();
      if (rec) { if (press.shift && sel.has(lkey(rec))) sel.delete(lkey(rec)); else sel.add(lkey(rec)); }
      else if (pickBuilding(e.clientX, e.clientY)) toast('The town stays where it is; only hamlets move.');
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
      if (drag || band || paint || pan) cancelGesture();
      else if (sel.size) { sel.clear(); redraw(); }
      else exit();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') { take(); if (e.shiftKey) redoOp(); else undoOp(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { take(); redoOp(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { take(); removeForSelection(); return; }
    if (e.key === '1') { take(); setTool('select'); return; }
    if (e.key === '2') { take(); setTool('move'); return; }
    if (e.key === '3') { take(); setTool('zone'); return; }
    if (e.key === '4') { take(); setTool('polder'); return; }
    if (PAN_KEYS[e.code]) { take(); keys.add(e.code); }
  }
  function setTool(t) { tool = t; panel.setTool(t); cancelGesture(); }

  // ------------------------------------------------------------------ every frame
  function update(dt) {
    if (!active) return;
    if (village() !== indexed) { index(); changed(); }
    let mx = 0, mz = 0;
    for (const k of keys) { const d = PAN_KEYS[k]; if (d) { mx += d[0]; mz += d[1]; } }
    if (mx || mz) { view.cx += mx * view.hh * 1.5 * dt; view.cz += mz * view.hh * 1.5 * dt; applyView(); }
    const s = drag || band || pan ? null : superAt(ptr.x, ptr.y);
    overlay.setHover(s);
    panel.setHud(hud(s));
  }
  function hud(s) {
    const tip = tool === 'select' ? 'click a hamlet or drag a box; <kbd>Shift</kbd> adds; drag a selected hamlet to carry it'
      : tool === 'move' ? 'drag to carry the selected hamlets; snaps to the super-grid'
        : tool === 'polder' ? 'paint shallow water to take off the sea; it has to touch the shore'
          : 'paint ground nothing may be built on; right-drag releases it';
    let where = '';
    if (drag) where = `<span class="${drag.ok ? 'ok' : 'why'}">[${drag.di}, ${drag.dj}] ${drag.ok ? 'fits' : esc(drag.why || 'no')}</span>`;
    else if (s) {
      const k = key(s[0], s[1]);
      const rec = projAt.get(k);
      const what = townAt.has(k) ? 'the town' : rec ? esc(rec.name) : usable(s[0], s[1]) ? 'open ground' : reclaimable(s[0], s[1]) ? 'shallows, reclaimable' : 'not for building';
      where = `<span class="muted">[${s[0]}, ${s[1]}] · ${what}${islandZones.has(k) ? ' · zoned' : ''}</span>`;
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
    overlay.setVisible(true);
    if (!loadView()) frameIsland(); else applyView();
    loadDraft();
    panel.show();
    panel.setTool(tool);
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
  };
}
