// Things put on the island by hand, drawn on top of the village.
//
// The village is a picture of what Claude has been doing; this layer is a picture of
// what somebody asked for while walking around in it. Each shape is a handful of boxes
// and cones, merged into one geometry and stood on the ground where it was asked for.
//
// Adding a shape: write a builder here, key it into SHAPES under the same name you put
// in shared/shapes.mjs, and that is all. Anything the catalogue has no builder for
// stands as a cairn, so a name nobody has drawn yet still puts something on the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cylinder, cone, sphere, dome, prismRoof } from './buildings.js';

const WOOD = 0x6b4a2f;
const PLANK = 0xa9855a;
const PLANK_DARK = 0x8a6a44;
const STONE = 0x8f8a80;
const LEAF = 0x5c9a3f;
const NEEDLE = 0x3f7d47;
const IRON = 0x4a4640;

function merge(parts) {
  const g = mergeGeometries(parts.filter(Boolean), false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------- the shapes
// Each builder returns a geometry whose base sits at y = 0 and which faces +z, so the
// group can simply be dropped on the ground and turned by its rot.

function tree() {
  return merge([
    cylinder(0.09, 0.13, 0.62, 6, WOOD),
    sphere(0.52, LEAF, { y: 1.02 }),
    sphere(0.34, 0x6aa84a, { x: 0.26, y: 0.82 }),
    sphere(0.3, 0x4f8a37, { x: -0.24, y: 0.9, z: 0.16 }),
  ]);
}

function pine() {
  return merge([
    cylinder(0.07, 0.11, 0.5, 5, WOOD),
    cone(0.46, 0.85, 7, NEEDLE, { y: 0.35 }),
    cone(0.34, 0.72, 7, 0x478950, { y: 0.85 }),
    cone(0.22, 0.55, 7, 0x51955a, { y: 1.32 }),
  ]);
}

function bush() {
  return merge([
    sphere(0.3, 0x4f8a3f, { y: 0.24 }),
    sphere(0.22, 0x5fa04a, { x: 0.24, y: 0.18 }),
    sphere(0.2, 0x467d38, { x: -0.2, y: 0.2, z: 0.14 }),
  ]);
}

function rock() {
  return merge([
    sphere(0.34, STONE, { y: 0.2 }),
    sphere(0.2, 0x7a756d, { x: 0.26, y: 0.11, z: 0.1 }),
    sphere(0.15, 0x99938a, { x: -0.18, y: 0.13, z: -0.14 }),
  ]);
}

function cairn(p) {
  // What an unnamed shape becomes: a stack of stones with a stake beside it, so it is
  // plainly a placeholder and not a boulder somebody meant to put there.
  return merge([
    sphere(0.26, STONE, { y: 0.16 }),
    sphere(0.2, 0x7a756d, { y: 0.42 }),
    sphere(0.14, 0x99938a, { y: 0.62 }),
    sphere(0.09, 0xa8a29a, { y: 0.75 }),
    cylinder(0.025, 0.03, 0.9, 5, WOOD, { x: 0.3 }),
    box(0.3, 0.16, 0.03, PLANK, { x: 0.3, y: 0.72 }),
    p && p.label ? box(0.22, 0.04, 0.035, 0x50463a, { x: 0.3, y: 0.79 }) : null,
  ]);
}

// A deck long enough to cross whatever it was put over, with a rail down each side.
// It runs along z, so --rot turns it the way you want it to go.
function bridge(p) {
  const len = Math.max(2, p.length || 6);
  const half = len / 2;
  const parts = [
    box(1.5, 0.09, len, PLANK_DARK, { y: -0.09 }),                       // the deck
  ];
  // planks across it, one every third of a unit, so it reads as boards from above
  const step = 0.34;
  for (let t = -half + step / 2; t < half; t += step) {
    parts.push(box(1.44, 0.045, step * 0.72, PLANK, { y: 0, z: t }));
  }
  for (const side of [-0.72, 0.72]) {
    parts.push(box(0.07, 0.09, len, PLANK_DARK, { x: side, y: 0.48 }));  // the handrail
    for (let t = -half + 0.5; t <= half - 0.4; t += 1.1) {
      parts.push(box(0.07, 0.5, 0.07, WOOD, { x: side, y: 0.02, z: t }));
    }
  }
  // stringers under the ends, which is what makes it look carried rather than floating
  parts.push(box(0.16, 0.6, 0.16, WOOD, { x: -0.6, y: -0.68, z: -half + 0.3 }));
  parts.push(box(0.16, 0.6, 0.16, WOOD, { x: 0.6, y: -0.68, z: -half + 0.3 }));
  parts.push(box(0.16, 0.6, 0.16, WOOD, { x: -0.6, y: -0.68, z: half - 0.3 }));
  parts.push(box(0.16, 0.6, 0.16, WOOD, { x: 0.6, y: -0.68, z: half - 0.3 }));
  return merge(parts);
}

function fence(p) {
  const len = Math.max(1, p.length || 4);
  const half = len / 2;
  const parts = [];
  for (let t = -half; t <= half + 0.01; t += 1) {
    parts.push(box(0.09, 0.72, 0.09, WOOD, { z: t }));
  }
  parts.push(box(0.05, 0.08, len, PLANK, { y: 0.5 }));
  parts.push(box(0.05, 0.08, len, PLANK, { y: 0.24 }));
  return merge(parts);
}

function bench() {
  return merge([
    box(0.12, 0.34, 0.12, WOOD, { x: -0.5 }),
    box(0.12, 0.34, 0.12, WOOD, { x: 0.5 }),
    box(1.3, 0.07, 0.42, PLANK, { y: 0.34 }),
    box(1.3, 0.32, 0.07, PLANK, { y: 0.41, z: -0.18 }),
  ]);
}

function lamp() {
  return merge([
    cylinder(0.11, 0.15, 0.14, 8, STONE),
    cylinder(0.045, 0.06, 1.5, 6, IRON, { y: 0.12 }),
    box(0.22, 0.26, 0.22, IRON, { y: 1.6 }),
    box(0.16, 0.2, 0.16, 0xffd489, { y: 1.63, emissive: 1 }),   // the glass, lit after dark
    cone(0.19, 0.13, 4, IRON, { y: 1.86 }),
    sphere(0.035, IRON, { y: 1.99 }),
  ]);
}

function signpost() {
  return merge([
    cylinder(0.05, 0.07, 1.25, 6, WOOD),
    box(0.78, 0.26, 0.05, PLANK, { y: 0.9, z: 0.03 }),
    box(0.62, 0.04, 0.06, 0x50463a, { y: 1.0, z: 0.04 }),
    box(0.44, 0.04, 0.06, 0x50463a, { y: 0.94, z: 0.04 }),
    cone(0.09, 0.12, 5, PLANK_DARK, { y: 1.25 }),
  ]);
}

function well() {
  return merge([
    cylinder(0.58, 0.62, 0.52, 12, STONE),
    cylinder(0.5, 0.5, 0.06, 12, 0x2c3f52, { y: 0.46 }),        // the water in it
    box(0.09, 0.95, 0.09, WOOD, { x: -0.5, y: 0.5 }),
    box(0.09, 0.95, 0.09, WOOD, { x: 0.5, y: 0.5 }),
    cylinder(0.07, 0.07, 1.0, 7, WOOD, { y: 1.35, x: 0.5, rz: Math.PI / 2 }),   // the winch
    prismRoof(1.5, 1.0, 0.42, 0xa8503c, { y: 1.42 }),
    box(0.24, 0.2, 0.2, PLANK_DARK, { y: 1.0 }),                 // the bucket
  ]);
}

function statue() {
  return merge([
    box(0.9, 0.18, 0.9, STONE),
    box(0.72, 0.16, 0.72, 0x9c968c, { y: 0.18 }),
    box(0.56, 0.5, 0.56, STONE, { y: 0.34 }),
    cylinder(0.17, 0.23, 0.52, 7, 0xb0aaa0, { y: 0.84 }),        // a settler, roughly hewn
    sphere(0.16, 0xb8b2a8, { y: 1.5 }),
    cylinder(0.24, 0.24, 0.03, 9, 0xb0aaa0, { y: 1.56 }),        // the hat that gives them away
    box(0.1, 0.34, 0.1, 0xa8a29a, { x: 0.2, y: 1.02, rz: -0.4 }),
  ]);
}

function campfire() {
  return merge([
    cylinder(0.42, 0.44, 0.09, 10, STONE),
    box(0.7, 0.11, 0.11, WOOD, { y: 0.09, ry: 0.4 }),
    box(0.7, 0.11, 0.11, WOOD, { y: 0.09, ry: -0.5 }),
    box(0.7, 0.11, 0.11, WOOD, { y: 0.2, ry: 1.3 }),
    cone(0.2, 0.46, 6, 0xff9a3c, { y: 0.18, emissive: 1 }),
    cone(0.11, 0.28, 6, 0xffe07a, { y: 0.26, emissive: 1 }),
  ]);
}

function flag() {
  return merge([
    cylinder(0.16, 0.2, 0.12, 8, STONE),
    cylinder(0.035, 0.05, 2.1, 6, PLANK, { y: 0.1 }),
    box(0.7, 0.42, 0.03, 0xd94f3d, { x: 0.37, y: 1.62 }),
    box(0.7, 0.1, 0.035, 0xe8b45c, { x: 0.37, y: 1.72 }),
    sphere(0.055, 0xe8b45c, { y: 2.2 }),
  ]);
}

// A board on two posts with a page of the island on it. Only the woodwork is drawn
// here: what the board says is real HTML, hung in front of it by web/js/panels.js.
// Both sides have to agree on where that glass is, so the sums are in panelFace() and
// neither side does them twice.
const PANEL_RATIO = 0.625;     // 16:10, the shape every face is drawn at
const PANEL_LIFT = 0.62;       // how high the bottom edge stands off the ground
const PANEL_FRAME = 0.07;      // the lip of the frame around the glass
const PANEL_DEPTH = 0.06;

// A board is about the size of a large monitor by default, which is mostly taste: what
// a panel is for is standing in front of and reading. A wide one is still clickable -
// see the measurement above aim() in web/js/panels.js, which replaced the READ_RATIO
// this line used to point at.
export const PANEL_WIDE = 1.5;

// And as wide as a board goes: a hoarding along the road, which is what the billboard
// face is for. Exported because the build menu hands one out at exactly this width, and
// a menu that offered a size the board then quietly clamped would be lying.
export const PANEL_WIDEST = 8;

export function panelFace(p) {
  const w = Math.min(PANEL_WIDEST, Math.max(0.6, p.length || PANEL_WIDE));
  const h = w * PANEL_RATIO;
  // y is the middle of the glass and z is how far it stands in front of the board, both
  // in the prop's own space: panels.js turns and scales them with the rest of the prop.
  return { w, h, y: PANEL_LIFT + h / 2, z: PANEL_DEPTH / 2 + 0.005 };
}

function panel(p) {
  const { w, h } = panelFace(p);
  const post = Math.max(0.1, w / 2 - 0.12);
  const frameW = w + PANEL_FRAME * 2;
  return merge([
    box(0.12, PANEL_LIFT + 0.14, 0.12, WOOD, { x: -post }),
    box(0.12, PANEL_LIFT + 0.14, 0.12, WOOD, { x: post }),
    // The board behind the glass, dark, so the page reads as lit against it - and so
    // there is still a board to look at from behind, where the page is not drawn.
    box(w, h, PANEL_DEPTH, 0x1b1712, { y: PANEL_LIFT }),
    box(frameW, PANEL_FRAME, PANEL_DEPTH + 0.03, PLANK, { y: PANEL_LIFT + h }),
    box(frameW, PANEL_FRAME, PANEL_DEPTH + 0.03, PLANK, { y: PANEL_LIFT - PANEL_FRAME }),
    box(PANEL_FRAME, h + PANEL_FRAME * 2, PANEL_DEPTH + 0.03, PLANK_DARK, { x: -(w + PANEL_FRAME) / 2, y: PANEL_LIFT - PANEL_FRAME }),
    box(PANEL_FRAME, h + PANEL_FRAME * 2, PANEL_DEPTH + 0.03, PLANK_DARK, { x: (w + PANEL_FRAME) / 2, y: PANEL_LIFT - PANEL_FRAME }),
  ]);
}

// A wooden case with an LED matrix in the front of it, the way one of these sits on a
// shelf and tells you something from across the room. The case, the foot and the bezel
// are wood like everything else out here; the panel is the one thing on the island that
// is a picture rather than a colour.
//
// The picture is not part of this geometry and cannot be: everything merged here shares
// the island's one building material and has had its uvs deleted on the way in. So this
// leaves a dark recess where the matrix goes, and the `screen` in SHAPES below says where
// to hang the lit panel that actually carries the applet.
function deskdisplay() {
  return merge([
    box(1.2, 0.07, 0.34, PLANK_DARK),                                    // the foot
    box(1.12, 0.6, 0.26, WOOD, { y: 0.07 }),                             // the case
    box(1.14, 0.04, 0.29, PLANK, { y: 0.63 }),                           // a cap over the top
    box(1.06, 0.54, 0.03, PLANK, { y: 0.1, z: 0.12 }),                   // the bezel
    // the matrix itself, dark: this is what is seen before the applet has rendered, and
    // what a visitor - who is not allowed to run somebody's applet - sees for good.
    box(0.98, 0.5, 0.012, 0x0c0c10, { y: 0.12, z: 0.135 }),
    sphere(0.016, 0x6fb84a, { x: 0.47, y: 0.155, z: 0.15, emissive: 1 }),  // the power light
    cylinder(0.03, 0.03, 0.12, 6, IRON, { y: 0.3, z: -0.19, rx: Math.PI / 2 }),  // the lead out of the back
  ]);
}

// name -> how to draw it, how much of the ground it takes up, and where it sits.
const SHAPES = {
  tree: { build: tree, r: 0.42 },
  pine: { build: pine, r: 0.4 },
  bush: { build: bush, r: 0.3 },
  rock: { build: rock, r: 0.36 },
  cairn: { build: cairn, r: 0.3 },
  bridge: { build: bridge, r: 0, lift: bridgeDeck, run: 0.75 },
  fence: { build: fence, r: 0, run: 0.22, wall: (p) => Math.max(1, p.length || 4) },
  bench: { build: bench, r: 0.45 },
  lamp: { build: lamp, r: 0.2 },
  signpost: { build: signpost, r: 0.2 },
  // `screen` is the face the applet is shown on, in the geometry's own units: how big,
  // how far up, and how far forward of the middle. 0.96 by 0.48 is 64 by 32 exactly.
  deskdisplay: { build: deskdisplay, r: 0.55, screen: { w: 0.96, h: 0.48, y: 0.37, z: 0.148 } },
  well: { build: well, r: 0.7 },
  statue: { build: statue, r: 0.55 },
  campfire: { build: campfire, r: 0.45 },
  flag: { build: flag, r: 0.22 },
  panel: { build: panel, r: 0, run: 0.14, wall: (p) => panelFace(p).w },
};

// A bridge is the one shape that does not simply stand on the ground: it has to clear
// whatever it crosses. Take the higher of its two banks, and never dip below the sea.
function bridgeDeck(p, terrain) {
  const len = Math.max(2, p.length || 6);
  const half = len / 2;
  const s = Math.sin(p.rot || 0), c = Math.cos(p.rot || 0);
  const a = terrain.worldHeight(p.x + s * half, p.z + c * half);
  const b = terrain.worldHeight(p.x - s * half, p.z - c * half);
  return Math.max(a, b, 0.1) + 0.32;
}

// ---------------------------------------------------------------- the table, opened up
// What the table above knows about a shape, for anyone who needs to draw or measure one
// without a village behind them. The build menu holds a prop before it exists: there is
// no record, no id and nothing on the server yet, only a spec somebody is aiming.
//
// These are the single source of truth on purpose. createProps() below calls the same
// functions, so a thing you are about to put down cannot look or measure differently
// from the thing you get.

// The geometry for a spec, uncached. createProps keeps its own cache for the props that
// are standing; a ghost holds one geometry and throws it away when the shape changes.
export function propGeometry(p) {
  return (SHAPES[p.kind] || SHAPES.cairn).build(p);
}

// How high it sits. A bridge clears what it crosses; everything else stands on the
// ground, sunk three centimetres so it does not hover.
export function propLift(p, terrain) {
  const shape = SHAPES[p.kind] || SHAPES.cairn;
  return shape.lift ? shape.lift(p, terrain) : terrain.worldHeight(p.x, p.z) - 0.03;
}

// What it takes up, as the axis-aligned rectangles walk mode reads. A wall-like shape is
// a line of small squares rather than one blob; a bridge takes up nothing at all, because
// it is walked over rather than around.
export function propFootprint(p) {
  const shape = SHAPES[p.kind] || SHAPES.cairn;
  const scale = p.scale || 1;
  const out = [];
  if (shape.wall) {
    const len = shape.wall(p) * scale;
    const s = Math.sin(p.rot || 0), c = Math.cos(p.rot || 0);
    const h = shape.run * scale;
    for (let t = -len / 2; t <= len / 2 + 0.01; t += 0.5) {
      out.push({ x: p.x + s * t, z: p.z + c * t, hx: h, hz: h });
    }
    return out;
  }
  if (!shape.r) return out;
  const h = shape.r * scale;
  out.push({ x: p.x, z: p.z, hx: h, hz: h });
  return out;
}

// How far from its middle the thing reaches - for "am I standing in it" and for deciding
// what a demolish cursor is pointing at. The floor keeps a lamp post from being a target
// you have to hit dead centre.
export function propReach(p) {
  const shape = SHAPES[p.kind] || SHAPES.cairn;
  const scale = p.scale || 1;
  const wall = shape.wall ? (shape.wall(p) * scale) / 2 : 0;
  return Math.max(shape.r * scale, wall, 0.4);
}

// ---------------------------------------------------------------- the lit panel
// pixlet hands back an animated WebP, and an <img> is the only thing in a browser that
// will play one. So the image is kept in the page - a pixel across, behind everything,
// at no opacity - and copied onto a canvas that the texture reads from. It has to be
// painted rather than hidden: display:none stops the animation, and a still frame is
// exactly what this is not for.
//
// Nearest filtering both ways is the whole look. Without it a 64 by 32 panel blown up to
// the size of a door is a smear, and the point of an LED matrix is that you can count
// the pixels.
const PANEL_W = 64, PANEL_H = 32;
const PANEL_FPS = 12;              // it is 64 pixels across; nobody is going to miss the other 48 frames
const PANEL_RELOAD_MS = 60000;     // ask again for the applet; the server re-renders on its own schedule

// A display is the one prop whose label is what it shows rather than what it is called.
function appletOf(p) {
  return String(p.label || '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'promptholm';
}

function makePanel(p, shape) {
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_W;
  canvas.height = PANEL_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0c0c10';
  ctx.fillRect(0, 0, PANEL_W, PANEL_H);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;

  // Basic rather than standard, and untouched by tone mapping: a panel of lit diodes is
  // as bright at midnight as at noon, and takes no light from the island's own sun.
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(shape.screen.w, shape.screen.h), mat);
  mesh.position.set(0, shape.screen.y, shape.screen.z);

  const img = document.createElement('img');
  img.alt = '';
  img.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;z-index:-1;pointer-events:none';
  document.body.appendChild(img);
  let ready = false;
  img.addEventListener('load', () => { ready = true; });
  // A visitor is not allowed to render somebody's applet and gets a 404 here. That is
  // not a failure: the recess behind this panel is already dark, and dark is the answer.
  img.addEventListener('error', () => { ready = false; });

  const app = appletOf(p);
  let reloadAt = 0;
  let nextFrame = 0;

  return {
    mesh,
    tick() {
      const now = performance.now();
      if (now >= reloadAt) {
        reloadAt = now + PANEL_RELOAD_MS;
        img.src = `/api/star/${encodeURIComponent(app)}.webp?t=${Math.round(now)}`;
      }
      if (!ready || now < nextFrame) return;
      nextFrame = now + 1000 / PANEL_FPS;
      try {
        ctx.drawImage(img, 0, 0, PANEL_W, PANEL_H);
        tex.needsUpdate = true;
      } catch { /* caught mid-decode; the next frame is 80ms away */ }
    },
    dispose() {
      img.src = '';
      img.remove();
      mesh.geometry.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

export function createProps({ scene, terrain, material }) {
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);

  const records = new Map();     // id -> { spec, mesh, grow }
  const growing = [];
  const cache = new Map();       // a shape drawn twice shares its geometry
  const panels = new Set();      // the records carrying a lit face, ticked every frame

  function geometryFor(p) {
    const shape = SHAPES[p.kind] || SHAPES.cairn;
    // Only the shapes that read a number off the prop need their own geometry; the
    // rest are the same every time and are worth keeping.
    const key = shape.run ? `${p.kind}:${p.length || 0}:${p.label ? 1 : 0}` : `${p.kind}:${p.label ? 1 : 0}`;
    if (!cache.has(key)) cache.set(key, propGeometry(p));
    return cache.get(key);
  }

  function add(p, animate) {
    const mesh = new THREE.Mesh(geometryFor(p), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const y = propLift(p, terrain);
    mesh.position.set(p.x, y, p.z);
    mesh.rotation.y = p.rot || 0;
    mesh.userData.id = p.id;
    const scale = p.scale || 1;
    mesh.scale.setScalar(animate ? 0.001 : scale);
    group.add(mesh);
    const rec = { spec: p, mesh, scale };
    // A display carries its own lit face. It hangs off the body, so it grows out of the
    // ground, turns and scales with it without any of that having to be said twice.
    const shape = SHAPES[p.kind] || SHAPES.cairn;
    if (shape.screen) {
      rec.panel = makePanel(p, shape);
      mesh.add(rec.panel.mesh);
      panels.add(rec);
    }
    records.set(p.id, rec);
    if (animate) growing.push({ rec, t: 0 });
    return rec;
  }

  function remove(id) {
    const rec = records.get(id);
    if (!rec) return;
    group.remove(rec.mesh);
    if (rec.panel) { rec.panel.dispose(); panels.delete(rec); }
    records.delete(id);
    // the geometry is shared through the cache, so it is not disposed here
  }

  // Brings the scene in line with the list the server has. Anything new grows out of
  // the ground; anything gone simply goes.
  function apply(list, { animate = true } = {}) {
    const seen = new Set();
    for (const p of list || []) {
      seen.add(p.id);
      const rec = records.get(p.id);
      if (!rec) { add(p, animate); continue; }
      // A prop is never edited in place today, but if one ever is, redraw it.
      if (JSON.stringify(rec.spec) !== JSON.stringify(p)) { remove(p.id); add(p, false); }
    }
    for (const id of [...records.keys()]) if (!seen.has(id)) remove(id);
  }

  function update(dt) {
    for (let i = growing.length - 1; i >= 0; i--) {
      const g = growing[i];
      g.t += dt;
      const k = Math.min(1, g.t / 0.55);
      // a small overshoot, so it lands rather than merely arriving
      const e = k < 1 ? 1 - Math.pow(1 - k, 3) : 1;
      const wobble = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.12 : 1;
      g.rec.mesh.scale.setScalar(g.rec.scale * e * wobble);
      if (k >= 1) growing.splice(i, 1);
    }
    // Every lit face gets a look in; whether it is time to copy the next frame across
    // is the panel's own business.
    for (const rec of panels) rec.panel.tick();
  }

  // What the walker cannot step into, in the shape walk mode reads: axis aligned
  // rectangles, like the solids of a building. A round shape becomes a square of its own
  // radius, which at the size of a tree is a difference nobody walks into. A fence is a
  // line rather than a blob, so it gets one small square per post instead of a single
  // one swallowing the field.
  function blockers() {
    const out = [];
    for (const rec of records.values()) {
      for (const b of propFootprint(rec.spec)) out.push({ ...b, id: rec.spec.id });
    }
    return out;
  }

  // Which ground cells a built bridge carries, and how high its deck rides over them -
  // the same map syncBridges() makes for the crossings the layout lays, in the same
  // shape, so walk mode and the settlers can read one and not care where it came from.
  //
  // Without this a bridge put up by hand is drawn and not stood on: blockers() leaves it
  // out because a bridge is walked over rather than around, and nothing was making the
  // first half of that true, so groundAt() read the river underneath and you went in.
  //
  // Sampled rather than reasoned about: the deck is a rectangle turned by its rot, and
  // stepping across it in strides of less than a cell is what catches every cell it
  // covers, whatever angle it lies at.
  function deckCells(terrain) {
    const out = new Map();
    for (const rec of records.values()) {
      const p = rec.spec;
      if (p.kind !== 'bridge') continue;
      const scale = p.scale || 1;
      const len = Math.max(2, p.length || 6) * scale;
      const wide = 0.75 * scale;                       // the deck is 1.5 across
      const y = bridgeDeck(p, terrain);
      const s = Math.sin(p.rot || 0), c = Math.cos(p.rot || 0);
      for (let t = -len / 2; t <= len / 2 + 0.01; t += 0.4) {
        for (let w = -wide; w <= wide + 0.01; w += 0.4) {
          // The deck runs along the prop's own z and is `wide` across its x, both turned
          // by rot - the same sum bridgeDeck() uses to find the banks.
          const x = p.x + s * t + c * w;
          const z = p.z + c * t - s * w;
          const gx = Math.round(x + terrain.half - 0.5);
          const gz = Math.round(z + terrain.half - 0.5);
          if (gx < 0 || gz < 0 || gx >= terrain.size || gz >= terrain.size) continue;
          out.set(gx + gz * terrain.size, y);
        }
      }
    }
    return out;
  }

  function nearest(x, z, within = 4) {
    let best = null, bestD = within;
    for (const rec of records.values()) {
      const d = Math.hypot(rec.spec.x - x, rec.spec.z - z);
      if (d < bestD) { bestD = d; best = rec.spec; }
    }
    return best;
  }

  function dispose() {
    scene.remove(group);
    for (const rec of panels) rec.panel.dispose();
    panels.clear();
    for (const g of cache.values()) g.dispose();
    cache.clear();
    records.clear();
  }

  return { group, apply, update, blockers, deckCells, nearest, count: () => records.size, dispose };
}
