// The workbench: one model at a time, taken apart into the pieces it was written as, so
// a door can be moved half a step to the left without anyone doing arithmetic in their
// head. Every piece knows the call that made it - `buildings.js` notes that on the
// geometry as it goes - and that is what lets this page hand back a line of code rather
// than a mesh.
//
// Save writes those lines into `buildings.js`, and is careful about it: the page sends the
// line as it stands in the file and the line that takes its place, and the server refuses
// unless it finds the first exactly once. A line the file works out rather than writes down
// cannot be matched that way, and is named instead of guessed at - which is why Copy is
// still here.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  createBuildingMaterial, buildBuilding, PALETTE, TIER_LABEL, C, KIT,
  box, cylinder, cone, dome, sphere, prismRoof, pyramidRoof, quad,
} from './buildings.js';

// ---------------------------------------------------------------- the shapes
// Every primitive takes its dimensions, then a colour, then a placement, which is what
// makes one table enough to drive all eight. `args` are what the number fields get
// called, `make` is what a fresh one starts out as, `ints` count sides rather than
// measure them.
const PRIMS = {
  box: { fn: box, args: ['w', 'h', 'd'], make: [0.3, 0.25, 0.3] },
  cylinder: { fn: cylinder, args: ['r top', 'r base', 'h', 'sides'], make: [0.1, 0.12, 0.4, 8], ints: [3] },
  cone: { fn: cone, args: ['r', 'h', 'sides'], make: [0.18, 0.3, 6], ints: [2] },
  dome: { fn: dome, args: ['r'], make: [0.2] },
  sphere: { fn: sphere, args: ['r'], make: [0.08] },
  prismRoof: { fn: prismRoof, args: ['w', 'd', 'h'], make: [0.9, 0.8, 0.35] },
  pyramidRoof: { fn: pyramidRoof, args: ['w', 'd', 'h'], make: [0.5, 0.5, 0.35] },
  // A quad is a list of corners rather than a set of measurements, so its numbers are
  // shown but not offered for editing. Move it, colour it, or write the corners by hand.
  quad: { fn: quad, args: ['points'], make: [[[0, 0, 0], [0.4, 0, 0], [0.4, 0.4, 0], [0, 0.4, 0]]], freeform: true },
};

// Where a piece that came out of one of the shared helpers actually lives, so nobody
// pastes a nudged window into a house and wonders why the whole island moved.
const SHARED_FROM = {
  window: 'windowsOn(), which every house and most civic buildings call',
  door: 'door(), which every house calls',
  foundation: 'foundation(), which every building calls',
  frame: 'timberFrame(), which the houses and the town hall call',
};

// ---------------------------------------------------------------- the catalogue
// The same set the model sheet lays out on its field, minus the notes about what unlocks
// each one. Kept here rather than shared with `demo.js`, because that page wants the
// unlock notes and this one wants nothing but a name.
const TIERS = ['tent', 'hut', 'cottage', 'house', 'manor', 'keep'];
const STYLES = ['fable', 'opus', 'sonnet', 'haiku', 'unknown'];
const SHEDS = ['explore', 'plan', 'general', 'guide', 'other'];
const ORNAMENTS = ['forge', 'lumber', 'lantern', 'weathervane', 'pigeons', 'banner', 'lightningrod'];
const CIVIC = ['townhall', 'board', 'issues', 'well', 'market', 'tavern', 'clocktower', 'tables',
  'school', 'windmill', 'chapel', 'fountain', 'lighthouse', 'statue', 'castle', 'poldermill'];
const FURNITURE = ['planter', 'lamp', 'bench', 'terrace'];

const title = (s) => s[0].toUpperCase() + s.slice(1);
const civicSpec = (t) => ({ id: `c:${t}`, kind: 'civic', civicType: t, tier: 'civic', style: 'unknown', ornaments: [], cards: 6 });

const CATALOGUE = [
  ...CIVIC.map((t) => ({ group: 'Civic', label: title(t), spec: civicSpec(t) })),
  ...FURNITURE.map((t) => ({ group: 'On the square', label: title(t), spec: civicSpec(t) })),
  ...TIERS.flatMap((tier) => STYLES.map((style) => ({
    group: 'Houses',
    label: `${TIER_LABEL[tier]} · ${PALETTE[style].name}`,
    spec: { id: `h:${tier}:${style}`, kind: 'house', tier, style, ornaments: [] },
  }))),
  ...ORNAMENTS.map((o) => ({
    group: 'A house with an ornament',
    label: title(o),
    spec: { id: `o:${o}`, kind: 'house', tier: 'house', style: 'opus', ornaments: [o] },
  })),
  ...SHEDS.map((s) => ({
    group: 'Sheds',
    label: title(s),
    spec: { id: `s:${s}`, kind: 'shed', shedType: s, style: 'haiku', tier: 'shed', ornaments: [] },
  })),
  ...[10, 24, 50, 100].map((rooms) => ({
    group: 'Towers',
    label: `${rooms} rooms`,
    spec: {
      id: `t:${rooms}`, kind: 'house', tier: 'manor', style: 'opus', ornaments: [],
      hotel: { rooms, floors: Math.max(2, Math.min(14, Math.ceil(rooms / 5))) },
    },
  })),
  {
    group: 'Towers',
    label: 'Quay house',
    spec: { id: 'h:harbour', kind: 'house', tier: 'cottage', style: 'sonnet', harbour: true, ornaments: [] },
  },
];

// ---------------------------------------------------------------- numbers
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const deep = (v) => (Array.isArray(v) ? v.map(deep) : typeof v === 'number' ? r6(v) : v);
const num = (v) => String(r6(v));

// The placement, with everything the builders leave out left out: `place()` and
// `finish()` treat a missing key and a zero alike, so a zero is noise in the signature
// and in the code that comes out of it.
const PLACE_KEYS = ['x', 'y', 'z', 'rx', 'ry', 'rz', 'emissive'];
function canonO(o) {
  const out = {};
  for (const k of PLACE_KEYS) if (r6(o[k] || 0)) out[k] = r6(o[k]);
  return out;
}
const sig = (rec) => JSON.stringify([rec.fn, deep(rec.args), canonO(rec.o), rec.hex]);

// A turn written as the fraction of pi it almost certainly is, because that is how the
// rest of the file reads.
function angle(v) {
  if (!r6(v)) return '0';
  for (const d of [1, 2, 3, 4, 6, 8, 12]) {
    if (Math.abs(Math.abs(v) - Math.PI / d) < 1e-9) return `${v < 0 ? '-' : ''}Math.PI${d === 1 ? '' : ` / ${d}`}`;
  }
  return num(v);
}

// ---------------------------------------------------------------- the stage
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 200);
const orbit = new OrbitControls(camera, renderer.domElement);
Object.assign(orbit, { enableDamping: true, dampingFactor: 0.08, minDistance: 0.4, maxDistance: 40, maxPolarAngle: 1.5 });

const material = createBuildingMaterial();
const uniforms = material.userData.uniforms;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x8fae5a, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// A tenth of a unit to the square, which is the grain most of the models are drawn on.
const grid = new THREE.GridHelper(8, 80, 0x2f3d22, 0x2f3d22);
grid.position.y = 0.002;
grid.material.opacity = 0.35;
grid.material.transparent = true;
scene.add(grid);

const key = new THREE.DirectionalLight(0xfff3dd, 2.1);
key.position.set(3.5, 6, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 24 });
scene.add(key, new THREE.HemisphereLight(0xbdd7ff, 0x54622f, 1.0), new THREE.AmbientLight(0xffffff, 0.35));

const model = new THREE.Group();
scene.add(model);

const anchorDots = new THREE.Group();
anchorDots.visible = false;
scene.add(anchorDots);

// Two wire boxes: amber around what is picked, pale around whatever the pointer is over.
const unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const selBox = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: 0xffc247 }));
const hoverBox = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: 0xf2ede1, transparent: true, opacity: 0.45 }));
selBox.visible = false;
hoverBox.visible = false;
scene.add(selBox, hoverBox);

// The drag handles move an anchor, and the anchor's travel is handed on to every piece in
// the selection - which is how a whole bench moves without coming apart.
const anchor = new THREE.Object3D();
scene.add(anchor);
const anchorPrev = new THREE.Vector3();
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.7);
scene.add(gizmo.getHelper());

// ---------------------------------------------------------------- state
let spec = CATALOGUE[0].spec;
let pal = PALETTE[spec.style] || PALETTE.unknown;
let items = [];        // { rec, origRec, base, state, mesh, loaded, built, orphan, kit }
let sel = [];          // indices into items
let groupMode = true;
let step = 0.01;
let mode = 'diff';
const undoStack = [];
let saving = false;
let lastMark = { tag: null, at: 0 };

const el = (id) => document.getElementById(id);
// One line under the code panel, for the things that are worth saying once.
function say(text, kind = '') {
  const box = el('ed-say');
  if (!box) return;
  box.textContent = text || '';
  box.style.color = kind === 'bad' ? '#e58a80' : kind === 'good' ? '#8fd98f' : '';
}
const active = () => items.filter((it) => it.state !== 'removed');
// Where a piece came from, as opposed to what has become of it. Removing something
// overwrites its state, so the state cannot be asked whether it was ever in the file.
const fromFile = (it) => it.base !== null;
const clone = (v) => JSON.parse(JSON.stringify(v));

// Gives a piece its mesh and its place in the list.
function mount(it, geometry) {
  it.mesh = new THREE.Mesh(geometry, material);
  it.mesh.castShadow = true;
  it.mesh.receiveShadow = true;
  it.mesh.userData.item = it;
  it.mesh.visible = it.state !== 'removed';
  model.add(it.mesh);
  items.push(it);
  return it;
}

// ---------------------------------------------------------------- keeping your place
// The workbench has no file of its own, so what you have moved lives in this browser
// until you save it. That is enough to survive a reload or a stray Ctrl+R; it is not a
// substitute for Save, which is the only thing that puts it in buildings.js.
const STORE = 'promptholm.workbench';
const modelIndex = () => CATALOGUE.findIndex((e) => e.spec.id === spec.id);
const dirty = () => items.some((it) => it.state !== 'loaded' || sig(it.rec) !== it.base);

function remember() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      model: modelIndex(),
      loaded: items.filter(fromFile)
        .map((it) => ({ base: it.base, rec: it.rec, state: it.state, kit: it.kit })),
      added: items.filter((it) => !fromFile(it))
        .map((it) => ({ rec: it.rec, state: it.state, kit: it.kit })),
    }));
  } catch { /* a private window or a full store is not worth an error */ }
}
// Only ever throws away this model's own work. A clean model is the usual state of
// affairs, and it has no business wiping what was left unsaved on another one.
function forget() {
  try {
    const kept = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (kept && kept.model !== modelIndex()) return;
    localStorage.removeItem(STORE);
  } catch { /* then it stays, and does no harm */ }
}

// Puts back what was being worked on, but only if that model still builds the same pieces
// in the same order. Anything else - a buildings.js that has been saved since, a
// different model - and it is dropped rather than smeared over the wrong shape.
function recall(modelIndex) {
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { kept = null; }
  if (!kept || kept.model !== modelIndex) return false;
  const loaded = items.slice();
  if (!Array.isArray(kept.loaded) || kept.loaded.length !== loaded.length
      || kept.loaded.some((k, i) => k.base !== loaded[i].base)) { forget(); return false; }
  kept.loaded.forEach((k, i) => {
    loaded[i].rec = k.rec;
    loaded[i].kit = k.kit;
    loaded[i].state = k.state;
    loaded[i].mesh.visible = k.state !== 'removed';
    refresh(loaded[i]);
  });
  for (const a of kept.added || []) {
    const it = {
      rec: a.rec, origRec: null, base: null, state: a.state,
      loaded: null, built: null, orphan: false, kit: a.kit,
    };
    it.built = rebuild(a.rec);
    mount(it, it.built);
  }
  return true;
}

// ---------------------------------------------------------------- loading a model
function load(entry) {
  spec = clone(entry.spec);
  pal = PALETTE[spec.style] || PALETTE.unknown;
  for (const it of items) {
    model.remove(it.mesh);
    if (it.built) it.built.dispose();
    if (it.loaded) it.loaded.dispose();
  }
  items = [];
  sel = [];
  undoStack.length = 0;
  gizmo.detach();
  selBox.visible = false;
  hoverBox.visible = false;

  const built = buildBuilding(spec, { keepParts: true });
  for (const g of built.parts || []) {
    const rec = g.userData.part;
    if (!rec) continue;   // a piece some builder made by hand; there is nothing to say about it
    const it = {
      rec: clone(rec),
      origRec: clone(rec),
      base: sig(rec),
      state: 'loaded',
      loaded: g,
      built: null,
      // Two or three places in `buildings.js` turn a piece after placing it, which
      // `place()` cannot express and the note therefore does not carry. Rebuilding such a
      // piece would quietly straighten it, so it is flagged and left as it arrived.
      orphan: !sameShape(g, rebuild(rec)),
      kit: rec.group && rec.group.args ? { kind: rec.group.kind, id: rec.group.id, args: clone(rec.group.args) } : null,
      origKit: rec.group && rec.group.args ? { kind: rec.group.kind, id: rec.group.id, args: clone(rec.group.args) } : null,
      mesh: null,
    };
    mount(it, g);
  }

  const back = recall(CATALOGUE.indexOf(entry));

  anchorDots.clear();
  for (const at of Object.values(built.anchors || {})) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0x4d7ec9 }));
    dot.position.set(at[0], at[1], at[2]);
    anchorDots.add(dot);
  }

  frame();
  renderParts();
  renderProps();
  renderCode();
  if (back) say('Picked up where you left off. Save writes it into buildings.js.');
}

// Does a rebuilt piece land where the loaded one sits? Bounding boxes settle it: were the
// note wrong about a measurement, a turn or a position, the box would have moved.
function sameShape(a, b) {
  a.computeBoundingBox();
  b.computeBoundingBox();
  const d = a.boundingBox.min.distanceTo(b.boundingBox.min) + a.boundingBox.max.distanceTo(b.boundingBox.max);
  b.dispose();
  return d < 1e-6;
}

function rebuild(rec) {
  return PRIMS[rec.fn].fn(...clone(rec.args), rec.hex, clone(rec.o));
}

// The geometry a piece ought to be showing: the one it arrived with for as long as it is
// untouched, a fresh one the moment it is not.
function refresh(it) {
  if (sig(it.rec) === it.base && it.loaded) {
    if (it.built) { it.built.dispose(); it.built = null; }
    it.mesh.geometry = it.loaded;
    return;
  }
  const g = rebuild(it.rec);
  if (it.built) it.built.dispose();
  it.built = g;
  it.mesh.geometry = g;
}

function frame() {
  const b = new THREE.Box3();
  for (const it of active()) b.expandByObject(it.mesh);
  if (b.isEmpty()) b.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  const c = b.getCenter(new THREE.Vector3());
  const r = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 0.3);
  orbit.target.copy(c);
  camera.position.set(c.x + r * 1.6, c.y + r * 1.25, c.z + r * 1.9);
  orbit.update();
}

// ---------------------------------------------------------------- selection
function boxOf(list) {
  const b = new THREE.Box3();
  for (const i of list) b.expandByObject(items[i].mesh);
  return b;
}

function fitBox(wire, b) {
  if (b.isEmpty()) { wire.visible = false; return; }
  const s = b.getSize(new THREE.Vector3());
  wire.position.copy(b.getCenter(new THREE.Vector3()));
  wire.scale.set(Math.max(s.x, 0.004), Math.max(s.y, 0.004), Math.max(s.z, 0.004));
  wire.visible = true;
}

function select(indices) {
  sel = indices.filter((i) => items[i] && items[i].state !== 'removed');
  if (!sel.length) {
    selBox.visible = false;
    gizmo.detach();
  } else {
    const b = boxOf(sel);
    fitBox(selBox, b);
    anchor.position.copy(b.getCenter(new THREE.Vector3()));
    anchorPrev.copy(anchor.position);
    gizmo.attach(anchor);
  }
  renderParts();
  renderProps();
}

// One click picks a whole window rather than the pane it happens to be, unless the Groups
// chip says otherwise.
function pickSet(i) {
  const g = items[i].rec.group;
  if (!groupMode || !g) return [i];
  const out = [];
  items.forEach((it, k) => {
    if (it.state !== 'removed' && it.rec.group && it.rec.group.id === g.id) out.push(k);
  });
  return out;
}

// ---------------------------------------------------------------- editing
function mark(tag) {
  const now = performance.now();
  if (tag && lastMark.tag === tag && now - lastMark.at < 800) { lastMark.at = now; return; }
  lastMark = { tag, at: now };
  undoStack.push(items.map((it) => ({ rec: clone(it.rec), state: it.state, kit: it.kit ? clone(it.kit) : null })));
  if (undoStack.length > 60) undoStack.shift();
}

function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  // Whatever was added after the snapshot was taken has to go with it, or undoing "add a
  // bench" would leave the bench standing there.
  for (const it of items.slice(snap.length)) {
    model.remove(it.mesh);
    if (it.built) it.built.dispose();
  }
  items.length = snap.length;
  sel = sel.filter((i) => i < items.length);
  snap.forEach((s, i) => {
    const it = items[i];
    it.rec = s.rec;
    it.kit = s.kit;
    it.state = s.state;
    it.mesh.visible = s.state !== 'removed';
    refresh(it);
  });
  lastMark = { tag: null, at: 0 };
  select(sel);
  renderParts();
  renderCode();
}

// Moves the selection without touching the anchor, so it can be called from the middle of
// a drag as well as from the keyboard.
function shift(dx, dy, dz) {
  for (const i of sel) {
    const it = items[i];
    const o = it.rec.o;
    o.x = r6((o.x || 0) + dx);
    o.y = r6((o.y || 0) + dy);
    o.z = r6((o.z || 0) + dz);
    if (it.kit) {
      it.kit.args.x = r6((it.kit.args.x || 0) + dx);
      it.kit.args.y = r6((it.kit.args.y || 0) + dy);
      it.kit.args.z = r6((it.kit.args.z || 0) + dz);
    }
    refresh(it);
  }
  fitBox(selBox, boxOf(sel));
  renderCode();
}

function nudge(dx, dy, dz) {
  if (!sel.length) return;
  mark('nudge');
  shift(dx, dy, dz);
  anchor.position.copy(boxOf(sel).getCenter(new THREE.Vector3()));
  anchorPrev.copy(anchor.position);
  renderProps();   // the number fields are meant to keep up with the keyboard
}

function addParts(recs, kitInfo = null) {
  mark(null);
  const added = [];
  for (const rec of recs) {
    const it = {
      rec, origRec: null, base: null, state: 'added',
      loaded: null, built: null, orphan: false,
      kit: kitInfo ? clone(kitInfo) : null,
      mesh: null,
    };
    it.built = rebuild(rec);
    added.push(items.length);
    mount(it, it.built);
  }
  select(added);
  renderParts();
  renderCode();
}

// Where a new piece lands: beside whatever is picked, so it arrives in view and in
// context, or on the ground at the middle of the model when nothing is.
function dropSpot() {
  const b = sel.length ? boxOf(sel) : new THREE.Box3().setFromObject(model);
  if (b.isEmpty()) return { x: 0, y: 0, z: 0 };
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3());
  return sel.length
    ? { x: r6(c.x + s.x + 0.06), y: r6(b.min.y), z: r6(c.z) }
    : { x: r6(c.x), y: 0, z: r6(c.z) };
}

function addPrim(name) {
  addParts([{ fn: name, args: clone(PRIMS[name].make), hex: C.plank, o: dropSpot(), group: null }]);
}

function addKit(name) {
  const a = { ...clone(KIT[name].defaults), ...dropSpot(), ry: 0 };
  const { recs, id } = buildKit(name, a);
  addParts(recs, { kind: name, id, args: a });
}

// Runs a kit piece and keeps nothing but the notes: the geometries were only ever there to
// carry them.
function buildKit(kind, args, id = null) {
  const made = [];
  KIT[kind].build(made, args);
  const recs = made.map((g) => clone(g.userData.part));
  for (const g of made) g.dispose();
  const gid = id != null ? id : (recs[0] && recs[0].group ? recs[0].group.id : Math.floor(Math.random() * 1e9));
  for (const rec of recs) rec.group = { kind, id: gid, args };
  return { recs, id: gid };
}

// Re-runs a kit piece from its own numbers, which is how a bench stays a bench while its
// width or its corner changes. Returns false if the kit no longer makes the same number of
// pieces, in which case the pieces on screen are left alone.
function rerunKit(indices) {
  const kit = items[indices[0]].kit;
  const { recs } = buildKit(kit.kind, kit.args, kit.id);
  if (recs.length !== indices.length) return false;
  indices.forEach((i, n) => {
    items[i].rec = recs[n];
    items[i].kit = { kind: kit.kind, id: kit.id, args: kit.args };
    refresh(items[i]);
  });
  return true;
}

function duplicate() {
  if (!sel.length) return;
  const kit = items[sel[0]].kit;
  // A copy of a kit piece is another kit piece, not a loose heap of its parts.
  if (kit && sel.length === pickSet(sel[0]).length) {
    const a = clone(kit.args);
    a.x = r6((a.x || 0) + 0.1);
    a.z = r6((a.z || 0) + 0.1);
    const { recs, id } = buildKit(kit.kind, a);
    addParts(recs, { kind: kit.kind, id, args: a });
    return;
  }
  addParts(sel.map((i) => {
    const rec = clone(items[i].rec);
    rec.group = null;
    rec.o.x = r6((rec.o.x || 0) + 0.1);
    rec.o.z = r6((rec.o.z || 0) + 0.1);
    return rec;
  }));
}

function remove() {
  if (!sel.length) return;
  mark(null);
  for (const i of sel) {
    items[i].state = 'removed';
    items[i].mesh.visible = false;
  }
  select([]);
  renderParts();
  renderCode();
}

// ---------------------------------------------------------------- the code that comes out
// Every name the palette has for one colour. C holds two pairs that are the same value -
// anvil and iron, paper and white - so a line written from a number alone can name the
// wrong half of a pair and then be nowhere to be found in the file. All of them are
// offered, and the source settles which one is really there.
function hexNames(h) {
  const out = [];
  for (const [k, v] of Object.entries(C)) if (v === h) out.push(`C.${k}`);
  for (const [k, v] of Object.entries(pal)) if (typeof v === 'number' && v === h) out.push(`pal.${k}`);
  if (!out.length) out.push(`0x${(h & 0xffffff).toString(16).padStart(6, '0')}`);
  return out;
}
const hexName = (h) => hexNames(h)[0];

const argLit = (v) => (Array.isArray(v) ? `[${v.map(argLit).join(', ')}]` : num(v));

function oLit(o) {
  const bits = [];
  for (const k of PLACE_KEYS) {
    const v = r6(o[k] || 0);
    if (!v) continue;
    bits.push(`${k}: ${k.length === 2 && k[0] === 'r' ? angle(v) : num(v)}`);
  }
  return bits.length ? `, { ${bits.join(', ')} }` : '';
}

function partLine(rec, name = hexName(rec.hex)) {
  return `parts.push(${rec.fn}(${rec.args.map(argLit).join(', ')}, ${name}${oLit(rec.o)}));`;
}

// buildings.js as it stands on disk, read once when the page opens. It is what lets the
// panel show the line you will actually be looking for rather than a plausible guess at
// it, and what lets Save know beforehand whether there is anything to replace.
let source = '';
const timesInSource = (line) => (source && line ? source.split(line).length - 1 : 0);

// The line as it is written in the file, if it is in there exactly once.
function trueLine(rec) {
  for (const name of hexNames(rec.hex)) {
    const line = partLine(rec, name);
    if (timesInSource(line) === 1) return { line, name, exact: true };
  }
  return { line: partLine(rec), name: hexName(rec.hex), exact: false };
}

function kitLine(kit) {
  const d = KIT[kit.kind].defaults;
  const bits = [];
  for (const [k, v] of Object.entries(kit.args)) {
    if (k in d ? r6(v) === r6(d[k]) : !r6(v || 0)) continue;
    bits.push(`${k}: ${k === 'hex' ? hexName(v) : k === 'ry' ? angle(v) : num(v)}`);
  }
  return `KIT.${kit.kind}.build(parts, { ...KIT.${kit.kind}.defaults${bits.length ? `, ${bits.join(', ')}` : ''} });`;
}

// Is every piece of a kit group still exactly what the kit would make of those numbers? If
// one pane has been nudged on its own it is no longer a window, and the code has to say so
// piece by piece.
function kitIntact(kit) {
  const idx = items.map((it, i) => (it.rec.group && it.rec.group.id === kit.id ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return false;
  // Taken away as a whole it is still that piece, and its one line can go. Taken apart -
  // one pane of a window gone, the rest standing - it is not a window any more, and the
  // code has to speak of the boxes it has become.
  const gone = items[idx[0]].state === 'removed';
  if (idx.some((i) => (items[i].state === 'removed') !== gone)) return false;
  const { recs } = buildKit(kit.kind, kit.args, kit.id);
  return recs.length === idx.length && idx.every((i, n) => sig(items[i].rec) === sig(recs[n]));
}

// Walks the model once, handing back one entry per thing worth a line: a kit group that is
// still whole counts as one, everything else as itself.
function units() {
  const out = [];
  const done = new Set();
  items.forEach((it, i) => {
    if (it.kit && !done.has(it.kit.id) && kitIntact(it.kit)) {
      done.add(it.kit.id);
      const idx = items.map((x, k) => (x.rec.group && x.rec.group.id === it.kit.id ? k : -1)).filter((k) => k >= 0);
      out.push({ kit: it.kit, indices: idx, item: it });
      return;
    }
    if (it.kit && done.has(it.kit.id)) return;
    out.push({ kit: null, indices: [i], item: it });
  });
  return out;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Where a loaded piece's call actually sits, so nobody goes hunting for a line that is
// not in the file. A piece pushed straight into a builder can be found and replaced word
// for word; one that came out of the kit or out of a shared helper cannot, because the
// numbers in the file are worked out rather than written down.
function sourceNote(kind) {
  const hint = SHARED_FROM[kind] ? `, quite possibly ${SHARED_FROM[kind]}` : '';
  return `this ${kind} is a KIT.${kind}.build(...) call whose numbers are worked out${hint}`;
}

// The code panel is kept as lines rather than as markup, so Copy can hand over the part
// that is code and leave the part that is advice behind.
let codeLines = [];

function codeChanges() {
  const lines = [];
  const say = (cls, text, copy = null) => lines.push({ cls, text, copy });
  for (const u of units()) {
    const live = u.indices.filter((i) => items[i].state !== 'removed');
    const changed = u.indices.some((i) => items[i].state !== 'loaded' || sig(items[i].rec) !== items[i].base);
    if (!changed) continue;
    const loaded = fromFile(u.item);
    const grouped = loaded && u.item.origRec.group ? u.item.origRec.group.kind : null;
    // A kit call written out in the file is a line like any other, and can be shown as
    // itself. One whose numbers a helper works out has no line to point at.
    const wasKit = grouped && u.kit && u.item.origKit ? kitLine(u.item.origKit) : null;
    if (wasKit && timesInSource(wasKit) === 1) {
      say('del', `- ${wasKit}`);
      if (live.length) { const l = kitLine(u.kit); say('add', `+ ${l}`, l); }
      continue;
    }
    const from = grouped;
    if (from) {
      say('note', `// ${sourceNote(from)},`);
      say('note', '// so there is no line here to match. Find that call and change it there.');
    }
    if (!live.length) {
      // Added here and taken away again: it was never in the file, so there is nothing
      // to say about it.
      if (!loaded) continue;
      if (from) say('del', '- remove that call.');
      else for (const i of u.indices) say('del', `- ${trueLine(items[i].origRec).line}`);
      continue;
    }
    if (loaded && !from) {
      for (const i of u.indices) {
        const t = trueLine(items[i].origRec);
        say('del', `- ${t.line}`);
        if (!t.exact) {
          say('note', '// the file writes this one with a variable or inside a loop, so it will not');
          say('note', '// match word for word. Find it by its numbers and change it there.');
        }
        const l = partLine(items[i].rec, t.name);
        say('add', `+ ${l}`, l);
      }
      continue;
    }
    if (u.kit) { const l = kitLine(u.kit); say('add', `+ ${l}`, l); }
    else for (const i of live) { const l = partLine(items[i].rec); say('add', `+ ${l}`, l); }
  }
  if (!lines.length) {
    return [{ cls: 'dim', text: 'Nothing changed yet. Move a piece and the lines to paste turn up here.' }];
  }
  return [
    { cls: 'dim', text: '// Each - line is in web/js/buildings.js as it stands; the + line under it takes its place.' },
    { cls: 'dim', text: '// Copy hands you the + lines only.' },
    { cls: '', text: '' },
    ...lines,
  ];
}

function codeWhole() {
  const body = [];
  for (const u of units()) {
    if (u.indices.every((i) => items[i].state === 'removed')) continue;
    body.push(u.kit ? kitLine(u.kit) : partLine(u.item.rec));
  }
  const b = new THREE.Box3();
  for (const it of active()) b.expandByObject(it.mesh);
  const name = `${spec.civicType || spec.shedType || spec.tier || 'thing'}2`;
  const block = [
    `    case '${name}': {`,
    ...body.map((l) => `      ${l}`),
    `      return { anchors, animated, height: ${num(b.isEmpty() ? 1 : b.max.y)} };`,
    '    }',
  ];
  return [
    { cls: 'dim', text: `// A case of its own for civic(). Rename it, and add '${name}' to CIVIC in web/js/demo.js` },
    { cls: 'dim', text: '// to have the model sheet lay it out beside the rest.' },
    { cls: '', text: '' },
    ...block.map((t) => ({ cls: '', text: t, copy: t })),
  ];
}

// What Save can actually write, and what it cannot. A piece pushed straight into a
// builder is one line in the file, so it can be found and replaced word for word. A
// loaded piece out of the kit or out of a shared helper is not: the numbers there are
// worked out rather than written down, so those stay a copy-and-paste job and are named
// as such. Anything added is a new line, and hangs on the last untouched line of this
// model so that it lands inside the right case.
function saveable() {
  const edits = [];
  const byHand = [];
  let anchor = null;
  const news = [];
  for (const u of units()) {
    const it = u.item;
    const loaded = fromFile(it);
    const grouped = !!((it.origRec || it.rec).group);
    const live = u.indices.filter((i) => items[i].state !== 'removed');
    const changed = u.indices.some((i) => items[i].state !== 'loaded' || sig(items[i].rec) !== items[i].base);
    if (!changed) {
      if (loaded && !grouped) { const t = trueLine(it.origRec); if (t.exact) anchor = t.line; }
      continue;
    }
    if (!loaded) {
      if (live.length) news.push(u.kit ? kitLine(u.kit) : partLine(it.rec));
      continue;
    }
    if (grouped) {
      const kind = it.origRec.group.kind;
      // A kit call written out in the file - the kind Save itself puts there - can be
      // found and replaced like any other line. One whose numbers a helper works out
      // cannot, and windowsOn is the reason that distinction exists.
      const was = u.kit && it.origKit ? kitLine(it.origKit) : null;
      if (was && timesInSource(was) === 1) {
        if (!live.length) edits.push({ op: 'remove', find: was });
        else edits.push({ op: 'replace', find: was, line: kitLine(u.kit) });
        continue;
      }
      byHand.push(`the ${kind} (${SHARED_FROM[kind] ? 'drawn by a shared helper' : 'its numbers are worked out'})`);
      continue;
    }
    const t = trueLine(it.origRec);
    if (!t.exact) { byHand.push(`a ${it.rec.fn} (the file works that line out)`); continue; }
    if (!live.length) edits.push({ op: 'remove', find: t.line });
    else edits.push({ op: 'replace', find: t.line, line: partLine(it.rec, t.name) });
  }
  // The anchor is only known once the whole model has been walked, so the new pieces wait
  // until here. Without one there is no telling where in the file they belong.
  for (const line of news) {
    if (anchor) edits.push({ op: 'insertAfter', find: anchor, line });
    else byHand.push('a new piece');
  }
  return { edits, byHand: [...new Set(byHand)] };
}

function renderCode() {
  if (dirty()) remember(); else forget();
  codeLines = mode === 'diff' ? codeChanges() : codeWhole();
  el('ed-code').innerHTML = codeLines
    .map((l) => (l.cls ? `<span class="${l.cls}">${esc(l.text)}</span>` : esc(l.text)))
    .join('\n');
}

// ---------------------------------------------------------------- the panels
function renderParts() {
  const host = el('ed-parts');
  const rows = [];
  const done = new Set();
  items.forEach((it, i) => {
    const g = it.rec.group;
    if (groupMode && g) {
      if (done.has(g.id)) return;
      done.add(g.id);
      const idx = items.map((x, k) => (x.rec.group && x.rec.group.id === g.id ? k : -1)).filter((k) => k >= 0);
      rows.push({ indices: idx, label: title(g.kind), tail: idx.length > 1 ? `${idx.length} parts` : '', item: it });
      return;
    }
    rows.push({ indices: [i], label: it.rec.fn, tail: g ? title(g.kind) : '', item: it });
  });

  host.innerHTML = rows.map((r) => {
    const gone = r.indices.every((i) => items[i].state === 'removed');
    const on = r.indices.length === sel.length && r.indices.every((i) => sel.includes(i));
    const col = `#${(r.item.rec.hex & 0xffffff).toString(16).padStart(6, '0')}`;
    return `<button class="part${on ? ' on' : ''}${gone ? ' gone' : ''}" data-idx="${r.indices.join(',')}">
      <span class="dot" style="background:${col}"></span>${esc(r.label)}
      <span class="kind">${esc(r.tail)}</span></button>`;
  }).join('');

  for (const b of host.querySelectorAll('.part')) {
    const idx = b.dataset.idx.split(',').map(Number);
    b.onclick = () => select(idx);
    b.onmouseenter = () => fitBox(hoverBox, boxOf(idx.filter((i) => items[i].state !== 'removed')));
    b.onmouseleave = () => { hoverBox.visible = false; };
  }
}

function fieldRow(label, value, opts = {}) {
  const { key, kind, index, int } = opts;
  return `<div class="cell"><span>${esc(label)}</span>
    <input class="num" type="number" step="${int ? 1 : 0.005}" value="${num(value)}"
      data-kind="${kind}" ${key ? `data-key="${key}"` : ''} ${index != null ? `data-index="${index}"` : ''}></div>`;
}

function swatchGrid(current) {
  const list = [
    ...Object.entries(C).map(([k, v]) => [`C.${k}`, v]),
    ...Object.entries(pal).filter(([, v]) => typeof v === 'number').map(([k, v]) => [`pal.${k}`, v]),
  ];
  return `<div class="swatches">${list.map(([name, v]) => {
    const col = `#${(v & 0xffffff).toString(16).padStart(6, '0')}`;
    return `<button class="sw${v === current ? ' on' : ''}" style="--c:${col}" title="${esc(name)}" data-hex="${v}"></button>`;
  }).join('')}</div>`;
}

function renderProps() {
  const host = el('ed-props');
  if (!sel.length) {
    host.innerHTML = '<div class="muted">Nothing picked. Click a piece in the scene, or a row in the list.</div>';
    return;
  }
  const it = items[sel[0]];
  const kit = it.kit && sel.length === pickSet(sel[0]).length ? it.kit : null;
  const one = sel.length === 1 && !kit;
  const prim = PRIMS[it.rec.fn];
  const o = kit ? kit.args : it.rec.o;

  const head = kit
    ? `<b>${title(kit.kind)}</b> <span class="muted" style="display:inline">from the kit, ${sel.length} part${sel.length === 1 ? '' : 's'}</span>`
    : one
      ? `<b>${it.rec.fn}</b> <span class="muted" style="display:inline">${it.rec.group ? `inside a ${it.rec.group.kind}` : 'a piece of its own'}</span>`
      : `<b>${sel.length} pieces</b> <span class="muted" style="display:inline">move together</span>`;

  const warn = it.orphan
    ? '<div class="muted" style="color:#e5c07b">This piece is turned after it is placed, which its note cannot carry. Editing it here will straighten it.</div>'
    : '';

  const dims = kit
    ? `<h4>Size</h4><div class="nums">${Object.keys(KIT[kit.kind].defaults).filter((k) => k !== 'hex')
      .map((k) => fieldRow(k, kit.args[k], { kind: 'kit', key: k })).join('')}</div>`
    : one && !prim.freeform
      ? `<h4>Size</h4><div class="nums">${prim.args
        .map((a, n) => fieldRow(a, it.rec.args[n], { kind: 'arg', index: n, int: (prim.ints || []).includes(n) })).join('')}</div>`
      : one && prim.freeform
        ? `<h4>Size</h4><div class="muted">${esc(argLit(it.rec.args[0]))}</div>`
        : '';

  const turn = kit
    ? `<div class="nums">${fieldRow('ry', o.ry || 0, { kind: 'kit', key: 'ry' })}</div>`
    : one
      ? `<div class="nums">${['rx', 'ry', 'rz'].map((k) => fieldRow(k, it.rec.o[k] || 0, { kind: 'place', key: k })).join('')}</div>`
      : '';

  host.innerHTML = `
    <div style="font-size:12.5px">${head}</div>
    ${warn}
    <h4>Place</h4>
    <div class="nums">${['x', 'y', 'z'].map((k) => fieldRow(k, o[k] || 0, { kind: kit ? 'kit' : 'place', key: k })).join('')}</div>
    ${turn}
    ${dims}
    <h4>Colour</h4>
    ${swatchGrid(it.rec.hex)}
    ${one ? `<label class="row" style="margin-top:6px;font-size:11px">
      <input type="checkbox" id="ed-emissive" ${it.rec.o.emissive ? 'checked' : ''}> glows at night</label>` : ''}
    <div class="row" style="margin-top:8px">
      <label for="ed-step">Step</label>
      <input class="num" id="ed-step" type="number" step="0.005" value="${num(step)}" style="width:70px">
      <button class="btn" id="ed-dup" style="margin-left:auto">Copy</button>
      <button class="btn" id="ed-del">Remove</button>
    </div>`;

  // ---- wiring
  for (const input of host.querySelectorAll('.num[data-kind]')) {
    input.onchange = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      mark(`field:${input.dataset.kind}:${input.dataset.key || input.dataset.index}`);
      if (input.dataset.kind === 'kit') {
        kit.args[input.dataset.key] = v;
        if (!rerunKit(sel)) return;
      } else if (input.dataset.kind === 'arg') {
        it.rec.args[Number(input.dataset.index)] = v;
        refresh(it);
      } else {
        const k = input.dataset.key;
        if (['x', 'y', 'z'].includes(k) && sel.length > 1) {
          const d = v - (o[k] || 0);
          shift(k === 'x' ? d : 0, k === 'y' ? d : 0, k === 'z' ? d : 0);
        } else {
          it.rec.o[k] = v;
          refresh(it);
        }
      }
      select(sel);
      renderCode();
    };
  }
  for (const b of host.querySelectorAll('.sw')) {
    b.onclick = () => {
      mark(null);
      const hex = Number(b.dataset.hex);
      if (kit && 'hex' in kit.args) { kit.args.hex = hex; rerunKit(sel); }
      for (const i of sel) {
        if (!kit) { items[i].rec.hex = hex; refresh(items[i]); }
      }
      select(sel);
      renderParts();
      renderCode();
    };
  }
  const emi = el('ed-emissive');
  if (emi) emi.onchange = () => {
    mark(null);
    it.rec.o.emissive = emi.checked ? 1 : 0;
    refresh(it);
    renderCode();
  };
  el('ed-step').onchange = () => {
    step = Math.max(0.001, Number(el('ed-step').value) || 0.01);
    gizmo.setTranslationSnap(step);
  };
  el('ed-dup').onclick = duplicate;
  el('ed-del').onclick = remove;
}

// ---------------------------------------------------------------- pointer and keys
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(active().map((it) => it.mesh), false);
  return hits.length ? hits[0].object.userData.item : null;
}

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  const from = down;
  down = null;
  if (!from || gizmo.dragging) return;
  if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;   // that was an orbit, not a pick
  const hit = pick(e);
  if (!hit) { select([]); return; }
  select(pickSet(items.indexOf(hit)));
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (down || gizmo.dragging) { hoverBox.visible = false; return; }
  const hit = pick(e);
  if (!hit) { hoverBox.visible = false; return; }
  fitBox(hoverBox, boxOf(pickSet(items.indexOf(hit))));
});

gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (e.value) mark(null);
  else { anchor.position.copy(boxOf(sel).getCenter(new THREE.Vector3())); anchorPrev.copy(anchor.position); }
});
gizmo.addEventListener('objectChange', () => {
  if (!sel.length) return;
  const d = anchor.position.clone().sub(anchorPrev);
  anchorPrev.copy(anchor.position);
  shift(r6(d.x), r6(d.y), r6(d.z));
});

addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  const s = e.shiftKey ? step * 5 : step;
  const moves = {
    ArrowLeft: [-s, 0, 0], ArrowRight: [s, 0, 0],
    ArrowUp: e.altKey ? [0, s, 0] : [0, 0, -s], ArrowDown: e.altKey ? [0, -s, 0] : [0, 0, s],
    PageUp: [0, s, 0], PageDown: [0, -s, 0],
  };
  if (moves[e.key]) { e.preventDefault(); nudge(...moves[e.key]); return; }
  if (e.key === 'Escape') { select([]); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); return; }
  if (e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
});

// ---------------------------------------------------------------- wiring the chrome
const picker = el('ed-model');
let lastGroup = null;
let optionHost = picker;
CATALOGUE.forEach((entry, i) => {
  if (entry.group !== lastGroup) {
    lastGroup = entry.group;
    optionHost = document.createElement('optgroup');
    optionHost.label = entry.group;
    picker.appendChild(optionHost);
  }
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = entry.label;
  optionHost.appendChild(opt);
});
picker.onchange = () => {
  const here = modelIndex();
  if (dirty() && !confirm('You have moved things here that are not in buildings.js yet. Leave them behind?')) {
    picker.value = String(here);
    return;
  }
  forget();   // one model's work is remembered at a time, and you just chose another
  load(CATALOGUE[Number(picker.value)]);
};

el('ed-night').oninput = (e) => { uniforms.uNight.value = Number(e.target.value); };
el('ed-groups').onclick = (e) => {
  groupMode = !groupMode;
  e.target.classList.toggle('on', groupMode);
  select(sel.length ? pickSet(sel[0]) : []);
  renderParts();
};
el('ed-grid').onclick = (e) => { grid.visible = !grid.visible; e.target.classList.toggle('on', grid.visible); };
el('ed-anchors').onclick = (e) => { anchorDots.visible = !anchorDots.visible; e.target.classList.toggle('on', anchorDots.visible); };
el('ed-grid').classList.toggle('on', grid.visible);

el('ed-kit').innerHTML = Object.entries(KIT).map(([k, v]) => `<button class="chip" data-kit="${k}">${v.label}</button>`).join('');
for (const b of el('ed-kit').querySelectorAll('[data-kit]')) b.onclick = () => addKit(b.dataset.kit);
el('ed-prims').innerHTML = Object.keys(PRIMS).map((k) => `<button class="chip" data-prim="${k}">${k}</button>`).join('');
for (const b of el('ed-prims').querySelectorAll('[data-prim]')) b.onclick = () => addPrim(b.dataset.prim);

function setMode(next) {
  mode = next;
  el('ed-mode-diff').classList.toggle('on', mode === 'diff');
  el('ed-mode-all').classList.toggle('on', mode === 'all');
  renderCode();
}
el('ed-mode-diff').onclick = () => setMode('diff');
el('ed-mode-all').onclick = () => setMode('all');
el('ed-copy').onclick = async () => {
  const text = codeLines.filter((l) => l.copy != null).map((l) => l.copy).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    el('ed-copy').textContent = 'Copied';
  } catch {
    el('ed-copy').textContent = 'Select it';   // no clipboard without a secure context
  }
  setTimeout(() => { el('ed-copy').textContent = 'Copy'; }, 1200);
};

el('ed-save').onclick = async () => {
  const { edits, byHand } = saveable();
  const hands = byHand.length ? ` Still by hand: ${byHand.join(', ')}.` : '';
  if (!edits.length) {
    if (byHand.length) say(`Nothing here can be written for you.${hands}`, 'bad');
    else say('Nothing has changed.');
    return;
  }
  const btn = el('ed-save');
  btn.disabled = true;
  say('Writing into buildings.js...');
  try {
    const r = await fetch('/api/model-save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ edits }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out.ok) {
      say(out.error || `the island answered ${r.status}`, 'bad');
      btn.disabled = false;
      return;
    }
    // The file is the truth now, so the page is read again rather than pretending to
    // know what it says.
    saving = true;
    forget();
    say(`Saved ${out.saved} line${out.saved === 1 ? '' : 's'}.${hands} Reading it back.`, 'good');
    setTimeout(() => location.reload(), byHand.length ? 2600 : 800);
  } catch (e) {
    say(String(e.message || e), 'bad');
    btn.disabled = false;
  }
};

// Moving something and then closing the tab is the one way to lose work that the browser
// can warn about, so it does.
addEventListener('beforeunload', (e) => {
  if (!dirty() || saving) return;
  e.preventDefault();
  e.returnValue = '';
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

gizmo.setTranslationSnap(step);

// buildings.js is read once, before the first model goes up: it is what lets the panel
// name the line you will actually be looking for, and lets Save know in advance whether
// there is anything there to replace.
try {
  const r = await fetch('/js/buildings.js');
  source = r.ok ? await r.text() : '';
} catch { source = ''; }

// If the page went away with work still in it - a reload, a tab closed by accident -
// come back to that model rather than to the first one on the list.
let first = 0;
try {
  const kept = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (kept && CATALOGUE[kept.model]) first = kept.model;
} catch { /* then we start at the top, which is no disaster */ }
picker.value = String(first);
load(CATALOGUE[first]);
if (!source) say('Could not read buildings.js, so Save has nothing to match against.', 'bad');

(function loop() {
  requestAnimationFrame(loop);
  orbit.update();
  renderer.render(scene, camera);
}());
