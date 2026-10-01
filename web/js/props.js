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
import { box, cylinder, cone, sphere, dome, prismRoof, quad, meshAsset, buildPierGeometry, mergeParts as merge } from './buildings.js';
import * as models from './models.js';

const WOOD = 0x6b4a2f;
const PLANK = 0xa9855a;
const PLANK_DARK = 0x8a6a44;
const STONE = 0x8f8a80;
const LEAF = 0x5c9a3f;
const NEEDLE = 0x3f7d47;
const IRON = 0x4a4640;

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

// The shapes that are not drawn here at all. The barrel, the cart, the crate, the
// woodpile, the tent and the washing line are modelled in
// assets/props/promptholm-props.blend and baked into web/js/props-mesh.js, and what
// arrives is ordinary parts - the same sheets, the same one material, the same single
// draw call as a rock. The barrel is the tavern's own barrel to the millimetre, so one
// put down by hand beside the tavern door reads as one of the pair already standing
// there; the rest are the yard of the reference illustration.
//
// The fallback is the caller's, which is what buildings.js mesh() asks of everyone: a
// checkout where the set has never been baked still gets something on the ground. It is
// one line here because the answer is the same for all six - stand a labelled cairn where
// the model would have been, so a missing bake is plainly a missing bake.
//
// Note that this merges with buildings.js mergeParts() rather than a copy of it. A prop
// made of a Blender part, which carries a sheet, and a cylinder, which does not, came out
// of the copy with the sheet thrown away and the barrel untextured; see the note inside
// merge() over there.
const baked = (asset) => (p) => (models.hasAsset(asset) ? merge(meshAsset(asset)) : cairn(p));

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

// A round-backed arch bridge that a boat can sail under. The plank bridge above
// rides a hand over the water on a stringer at each end, which is a crossing for feet and
// a wall for a hull: the Benchy stands 0.92 above the waterline (1.045 keel to funnel,
// DRAUGHT 0.13 of it under) and is 0.67 across. So this one humps up, like a drum
// bridge: the deck is one full curve from bank to bank, the timber arch under it leaves
// an opening the boat just fits through, and it springs from a stone abutment on
// each bank, so nothing stands in the channel at all.
//
// The plank bridge's materials - boarded deck, dark-wood kerb, a rail on posts with a
// knob on each - so the two read as one carpenter's work. It runs along z like the
// bridge and --rot turns it; --length stretches it, never shorter than ARCH_MIN_LEN, so
// the opening never shrinks below what tests/archbridge.test.mjs measures.
// Sized to the rivers terrain.mjs carves: water 2 * (RIVER_W + 0.37) across, so 1.93 at a
// source and 2.63 at a mouth. The opening is ARCH_OPEN either side of the middle - a
// river two wide with a hand to spare - and the crown clears the Benchy (0.92 air draft)
// plus her swell and a small margin, no more: she just fits. The length is what keeps it
// walkable: walk.js STEP_UP is 0.45 per cell, and at 10 the steepest cell rises 0.41.
export const ARCH_MIN_LEN = 10;
export const ARCH_RISE = 1.35;          // the crown of the deck over its two ends
export const ARCH_OPEN = 1.3;           // half the opening, where the stone takes over
const ARCH_FULL = 1.25;                 // (1 - u^2)^FULL: fuller than a raised cosine
const ARCH_DEPTH = 0.2;                 // deck to the underside of the arch
const ARCH_HALF_W = 0.65;               // half the deck width
const ARCH_FOOT = 1.3;                  // how far down the abutments go into the bank
const ARCH_RAIL = 0.45;                 // taller than the plank bridge's: it is a long way down

const archLen = (p) => Math.max(ARCH_MIN_LEN, p.length || 10);

// The deck height at z along the run, over its two ends, in the prop's own frame.
export function archDeckY(p, z) {
  const half = archLen(p) / 2;
  const u = Math.min(1, Math.abs(z) / half);
  return ARCH_RISE * Math.pow(1 - u * u, ARCH_FULL);
}

// The underside of the timber. Past archSpring() the stone carries it and there is no
// opening under it; inside, everything below this is open water.
export function archSoffitY(p, z) {
  return archDeckY(p, z) - ARCH_DEPTH;
}
export function archSpring(p) {
  return Math.min(ARCH_OPEN, archLen(p) / 2 - 1);
}

function archbridge(p) {
  const len = archLen(p);
  const half = len / 2;
  const spring = archSpring(p);
  const W = ARCH_HALF_W;
  const foot = -ARCH_FOOT;
  // Stops close enough that the curve reads as a curve, and one exactly at each springing
  // so the stone and the timber meet on a line.
  const zs = [];
  const n = Math.ceil(len / 0.25);
  for (let i = 0; i <= n; i++) zs.push(-half + (len * i) / n);
  zs.push(-spring, spring);
  zs.sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < zs.length - 1; i++) {
    const a = zs[i], b = zs[i + 1];
    if (b - a < 1e-6) continue;
    const ya = archDeckY(p, a), yb = archDeckY(p, b);
    const sa = archSoffitY(p, a), sb = archSoffitY(p, b);
    const open = Math.abs((a + b) / 2) < spring;
    // the deck, boarded across the run like the plank bridge's
    parts.push(quad([[-W, ya, a], [W, ya, a], [W, yb, b], [-W, yb, b]], PLANK, { sheet: 'plank' }));
    for (const x of [-W, W]) {
      // the kerb on the edge of the planking, and the timber face of the arch under it
      parts.push(quad([[x, ya, a], [x, yb, b], [x, yb + 0.09, b], [x, ya + 0.09, a]], PLANK_DARK, { sheet: 'plank' }));
      parts.push(quad([[x, sa, a], [x, sb, b], [x, yb, b], [x, ya, a]], PLANK_DARK, { sheet: 'plank' }));
      // a laminated rib along the bottom of that face, which is what makes it an arch
      // rather than a plank laid over a hump
      const o = x * 1.04;
      parts.push(quad([[o, sa, a], [o, sb, b], [o, sb + 0.12, b], [o, sa + 0.12, a]], WOOD));
      // the handrail, following the deck
      const r = x * 0.96;
      parts.push(quad([[r, ya + ARCH_RAIL - 0.07, a], [r, yb + ARCH_RAIL - 0.07, b], [r, yb + ARCH_RAIL, b], [r, ya + ARCH_RAIL, a]], WOOD));
      // and the abutment: stone under the timber from the springing out to the bank
      if (!open) parts.push(quad([[x, foot, a], [x, foot, b], [x, sb, b], [x, sa, a]], STONE));
    }
    if (open) parts.push(quad([[-W, sa, a], [W, sa, a], [W, sb, b], [-W, sb, b]], PLANK_DARK, { sheet: 'plank' }));
  }
  for (const s of [-1, 1]) {
    // the face of each abutment that looks into the channel, and its end under the road
    const z = s * spring, zy = archSoffitY(p, z);
    parts.push(quad([[-W, foot, z], [W, foot, z], [W, zy, z], [-W, zy, z]], STONE));
    parts.push(quad([[-W, foot, s * half], [W, foot, s * half], [W, 0, s * half], [-W, 0, s * half]], STONE));
    // a coping course where the arch springs, a hand proud of it, so it reads as masonry
    parts.push(box(W * 2 + 0.16, 0.12, 0.4, 0x7a756d, { y: zy - 0.12, z: s * (spring + 0.2) }));
  }
  // posts on the rail, about one a metre, with the plank bridge's knob on each
  const posts = Math.max(4, Math.round(len / 0.95));
  for (let i = 0; i <= posts; i++) {
    const z = -half + 0.12 + ((len - 0.24) * i) / posts;
    const y = archDeckY(p, z);
    for (const x of [-W + 0.04, W - 0.04]) {
      parts.push(box(0.08, ARCH_RAIL, 0.08, WOOD, { x, y, z }));
      parts.push(sphere(0.055, PLANK, { x, y: y + ARCH_RAIL + 0.02, z }));
    }
  }
  return merge(parts);
}

// Where the arch bridge sits: both ends on the higher bank, and never under the sea, so
// the opening measured up from y = 0 in its own frame is at least that far over the water.
function archDeck(p, terrain) {
  const half = archLen(p) / 2;
  const s = Math.sin(p.rot || 0), c = Math.cos(p.rot || 0);
  const a = terrain.worldHeight(p.x + s * half, p.z + c * half);
  const b = terrain.worldHeight(p.x - s * half, p.z - c * half);
  return Math.max(a, b, 0.1) + 0.02;
}
export const ARCH_LIFT_MIN = 0.12;      // the lowest archDeck() ever puts it over the sea

// A dock: a ramp onto a run of decking with a wide head at the end of it, and the mooring
// posts down both sides. It runs along z like the bridge and the fence, so --rot turns it
// out to sea.
//
// Drawn by handing buildPierGeometry() a pier of its own rather than by laying the pieces
// out again here, which is the whole reason that function takes a terrain instead of
// reading the island's: a dock somebody puts down by hand and the dock a Cowork district
// arrives at are then the same dock, down to which bay is the _a and which the _b. The
// shim is the smallest terrain that answers the two questions it asks - where a cell is,
// and whether the next one over is water - and the answer to the second is yes, because
// somebody who asks for a dock has asked for the head as well.
//
// The cells are numbered from the shore, as the layout numbers them, so cell 0 carries the
// ramp and the run is 1..bays. Shifting them back by half the run centres the lot on the
// point it was asked for, ramp included: a prop is placed by its middle.
function dock(p) {
  const bays = Math.max(1, Math.round(p.length || 4));
  const cells = [];
  for (let i = 1; i <= bays; i++) cells.push([0, i]);
  const shim = { cellWorld: (gx, gz) => [gx, gz - bays / 2], isWater: () => true };
  return buildPierGeometry(cells, shim, [0, 0]) || cairn(p);
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

// A board is about the size of a large monitor by default, and that is not only taste:
// see READ_RATIO in web/js/panels.js for why a wide board stops being clickable.
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

// name -> how to draw it, how much of the ground it takes up, and where it sits.
const SHAPES = {
  tree: { build: tree, r: 0.42 },
  pine: { build: pine, r: 0.4 },
  bush: { build: bush, r: 0.3 },
  rock: { build: rock, r: 0.36 },
  cairn: { build: cairn, r: 0.3 },
  // `stretch` is the three shapes that are drawn to the length they were asked for. It
  // used to be read off `run`, which happened to be set on exactly those three - and then
  // the cart and the washing line arrived, which need a `run` to block along and have one
  // length each, being baked meshes.
  bridge: { build: bridge, r: 0, lift: bridgeDeck, run: 0.75, stretch: true },
  archbridge: { build: archbridge, r: 0, lift: archDeck, run: ARCH_HALF_W, stretch: true },
  // A dock stands in the sea at one height whatever is under it, and that height is
  // already in the geometry: buildPierGeometry works in world y so that the quay's own
  // pier comes out level whatever the district's centre happens to sit at. So this one
  // is not lifted at all, which is the only shape here that is true of.
  dock: { build: dock, r: 0, lift: () => 0, stretch: true },
  fence: { build: fence, r: 0, run: 0.22, stretch: true, wall: (p) => Math.max(1, p.length || 4) },
  bench: { build: bench, r: 0.45 },
  // 0.13 is the barrel itself: 0.23 across at the widest hoop, half of that and a hair.
  // It is knee high and you cannot walk through it, so it blocks like anything else.
  barrel: { build: baked('prop_barrel'), r: 0.13 },
  // The rest of the yard, measured off the models in scripts/build-props.py. Three of
  // them are round enough to block as a square of their own reach; the cart and the
  // washing line are long, and a square big enough to hold either would be a bollard
  // nobody could walk round - the cart's would be 0.85 across in a lane a unit wide. So
  // they block the way the fence does, as a line of small squares along the length they
  // actually take up, which leaves grass on both sides of them. That is not a detail:
  // anything below WALK_CLEARANCE stops a settler, and a cart you cannot get past in your
  // own yard is a bug you only find by walking into it.
  cart: { build: baked('prop_cart'), r: 0, run: 0.18, wall: () => 0.5 },
  crate: { build: baked('prop_crate'), r: 0.15 },
  woodpile: { build: baked('prop_woodpile'), r: 0.23 },
  // A tent is a dwelling rather than a thing standing in a yard, so it blocks like one.
  tent: { build: baked('prop_tent'), r: 0.45 },
  washline: { build: baked('prop_washline'), r: 0, run: 0.13, wall: () => 0.84 },
  lamp: { build: lamp, r: 0.2 },
  signpost: { build: signpost, r: 0.2 },
  well: { build: well, r: 0.7 },
  statue: { build: statue, r: 0.55 },
  campfire: { build: campfire, r: 0.45 },
  flag: { build: flag, r: 0.22 },
  panel: { build: panel, r: 0, run: 0.14, stretch: true, wall: (p) => panelFace(p).w },
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
    // Spread evenly over the length rather than strided from one end in halves of a unit.
    // A run of fence is a whole number of units long and comes out the same either way -
    // and it did, which is why it was written that way - but a cart is 0.50 and a washing
    // line 0.84, and striding from the end left the far end of each of them unblocked: the
    // last square landed short and the next one would have been past the end.
    const steps = Math.max(1, Math.round(len / 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = -len / 2 + (len * i) / steps;
      out.push({ x: p.x + s * t, z: p.z + c * t, hx: h, hz: h });
    }
    return out;
  }
  if (!shape.r) return out;
  const h = shape.r * scale;
  out.push({ x: p.x, z: p.z, hx: h, hz: h });
  return out;
}

// What walk mode bumps into and stands on, per shape (Plans/hitboxes-en-looppaden.md): the real
// shape in the prop's own frame at scale 1, measured off propGeometry (everything below a settler's
// head), rather than propFootprint's square of `r` - which made a bench a 0.9 square round a 1.3 by
// 0.42 seat, a well the box round a round stone, and a tree a 0.84 square round a 0.26 trunk.
// `h` is how high it stands; `top` makes that height a floor as well, which a jump (0.38) reaches
// on a crate, a barrel or a woodpile and not on a bench or a rock - they are only floors to somebody
// already up there. Bushes, bridges and docks are left out: a bush is walked through like the
// forest's, a bridge is a deck (deckCellsOf), and the docks belong to the quays' own walking.
const PROP_SOLIDS = {
  tree: () => [{ x: 0, z: 0, r: 0.15 }],
  // The lowest cone hangs down to 0.35, under a settler's head, all the way out to 0.46.
  pine: () => [{ x: 0, z: 0, r: 0.3 }],
  // Three stones, each its own height: the two small ones are a jump up, and from them the big one.
  rock: () => [
    { x: 0, z: 0, r: 0.34, h: 0.54, top: true },
    { x: 0.26, z: 0.1, r: 0.2, h: 0.31, top: true },
    { x: -0.18, z: -0.14, r: 0.15, h: 0.28, top: true },
  ],
  cairn: () => [{ x: 0, z: 0, r: 0.26 }, { x: 0.3, z: 0, r: 0.04 }],
  bench: () => [{ x: 0, z: 0, hx: 0.65, hz: 0.22, h: 0.41, top: true }],
  barrel: () => [{ x: 0, z: 0, r: 0.12, h: 0.3, top: true }],
  crate: () => [{ x: 0, z: 0, hx: 0.14, hz: 0.14, h: 0.23, top: true }],
  woodpile: () => [{ x: 0, z: 0, hx: 0.22, hz: 0.14, h: 0.33, top: true }],
  cart: () => [{ x: 0, z: 0.11, hx: 0.16, hz: 0.32, h: 0.27, top: true }],
  tent: () => [{ x: 0, z: 0, hx: 0.39, hz: 0.5 }],
  // Its line hangs at 0.45, under a settler's head, so the whole run between the posts blocks.
  washline: () => [{ x: 0, z: 0, hx: 0.11, hz: 0.42 }],
  lamp: () => [{ x: 0, z: 0, r: 0.15 }],
  signpost: () => [{ x: 0, z: 0, r: 0.07 }],
  well: () => [{ x: 0, z: 0, r: 0.62 }],
  statue: () => [{ x: 0, z: 0, hx: 0.45, hz: 0.45 }],
  campfire: () => [{ x: 0, z: 0, r: 0.44 }],
  flag: () => [{ x: 0, z: 0, r: 0.2 }],
  fence: (p) => [{ x: 0, z: 0, hx: 0.05, hz: Math.max(1, p.length || 4) / 2 + 0.05 }],
  // The board runs along the prop's x and hangs from 0.55, over a settler's head: only its two posts
  // are in the way. (propFootprint's line of squares runs along z, across the board.)
  panel: (p) => {
    const post = Math.max(0.1, panelFace(p).w / 2 - 0.12);
    return [{ x: -post, z: 0, hx: 0.06, hz: 0.06 }, { x: post, z: 0, hx: 0.06, hz: 0.06 }];
  },
};

// The solids of one prop, in the world: turned by its rot (the mesh's rotation.y, so `yaw`), scaled,
// and with a height over `base` - where the prop stands, propLift - when it has one.
export function propSolids(p, base = 0) {
  const make = PROP_SOLIDS[p.kind] || (SHAPES[p.kind] ? null : PROP_SOLIDS.cairn);
  if (!make) return [];
  const k = p.scale || 1, yaw = p.rot || 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return make(p).map((f) => {
    const out = { x: p.x + (f.x * c + f.z * s) * k, z: p.z + (-f.x * s + f.z * c) * k };
    if (f.r) out.r = f.r * k;
    else { out.hx = f.hx * k; out.hz = f.hz * k; if (yaw) out.yaw = yaw; }
    if (f.h != null) { out.y0 = base - 0.1; out.y1 = base + f.h * k; }
    if (f.top) out.top = true;
    return out;
  });
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
//
// A cell's height is the middle of what the deck does over it, not the top. The top made the
// arch a staircase whose steepest tread was the whole rise of its cell plus the cell's own
// share of the curve - 0.45 on a bridge of ten, exactly walk.js's STEP_UP, so the walker
// stood at the foot of the second step and went into the river. The middle keeps every step
// to the slope itself, the 0.41 the length was chosen for (tests/archbridge.test.mjs).
export function deckCellsOf(specs, terrain) {
  const out = new Map();
  for (const p of specs) {
    const arch = p.kind === 'archbridge';
    if (p.kind !== 'bridge' && !arch) continue;
    const seen = new Map();        // cell -> { lo, hi }: what this one deck does over it
    const scale = p.scale || 1;
    const len = (arch ? archLen(p) : Math.max(2, p.length || 6)) * scale;
    const wide = (arch ? ARCH_HALF_W : 0.75) * scale; // the plank deck is 1.5 across
    const y0 = arch ? archDeck(p, terrain) : bridgeDeck(p, terrain);
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
        // The arch climbs, so each cell takes the deck over it rather than one height.
        const y = arch ? y0 + archDeckY(p, t / scale) * scale : y0;
        const key = gx + gz * terrain.size;
        const have = seen.get(key);
        if (!have) seen.set(key, { lo: y, hi: y });
        else { have.lo = Math.min(have.lo, y); have.hi = Math.max(have.hi, y); }
      }
    }
    // Two decks over one cell: the higher one.
    for (const [key, { lo, hi }] of seen) out.set(key, Math.max(out.has(key) ? out.get(key) : -Infinity, (lo + hi) / 2));
  }
  return out;
}

// The same bridges as walk mode stands on them (walk.js `setDecks`): the deck's own shape, along
// its own turned axis, instead of a height per cell. Per cell the arch bridge was a staircase of
// steps up to 0.41 high, the middle of each cell's slope: half a cell either way the drawn planks
// stood 0.2 over the feet or under them, so a walker climbed through the boards and came down
// floating over them, and every step down past walk.js STEP_DOWN was a fall. And the deck was
// every cell it touched, wider than the planks, out past the rails. `deckCellsOf` stays what the
// settlers stand on and what the router reads; this is for the feet alone.
//   o, d    where the run starts and its direction (unit), in the world
//   w       half the deck's width; `rail` the rails' height over it, along both edges
//   stops   [t, y] along the run: the deck is straight between two
//   open    [t0, t1], the arch's opening: under it the soffit, `soffit` under the deck, is a
//           ceiling; outside it the abutments' stone is solid up to the soffit
export function deckShapesOf(specs, terrain) {
  const out = [];
  for (const p of specs) {
    const arch = p.kind === 'archbridge';
    if (p.kind !== 'bridge' && !arch) continue;
    const scale = p.scale || 1;
    const len = (arch ? archLen(p) : Math.max(2, p.length || 6)) * scale;
    const half = len / 2;
    const s = Math.sin(p.rot || 0), c = Math.cos(p.rot || 0);
    const o = [p.x - s * half, p.z - c * half];
    if (!arch) {
      // The planks lie on the deck board, 0.045 over the height the prop is lifted to.
      const y = bridgeDeck(p, terrain) + 0.045 * scale;
      out.push({ o, d: [s, c], w: 0.72 * scale, rail: 0.5 * scale, stops: [[0, y], [len, y]] });
      continue;
    }
    const y0 = archDeck(p, terrain);
    // The stops archbridge() draws the deck with, so the feet are on the drawn planks exactly.
    const zs = [];
    const n = Math.ceil(archLen(p) / 0.25);
    for (let i = 0; i <= n; i++) zs.push(-archLen(p) / 2 + (archLen(p) * i) / n);
    const spring = archSpring(p);
    zs.push(-spring, spring);
    zs.sort((a, b) => a - b);
    const stops = zs.map((z) => [(z + archLen(p) / 2) * scale, y0 + archDeckY(p, z) * scale]);
    out.push({
      o, d: [s, c], w: ARCH_HALF_W * scale, rail: ARCH_RAIL * scale, stops,
      open: [(archLen(p) / 2 - spring) * scale, (archLen(p) / 2 + spring) * scale], soffit: ARCH_DEPTH * scale,
    });
  }
  return out;
}

// The road a built bridge is, for whoever asks where roads enter a hamlet (hamlet-sign-placement.js):
// the cells along its axis, and three beyond each end on the bank. The bank cells are what lets a
// crossing be found - a hand-built bridge lands on grass, with no paving for the road network to
// meet it - and only the axis, never the deck's whole width, so the cells beside it stay free.
export function bridgeRoadCellsOf(specs, terrain) {
  const seen = new Map();
  for (const p of specs) {
    const arch = p.kind === 'archbridge';
    if (p.kind !== 'bridge' && !arch) continue;
    const len = (arch ? archLen(p) : Math.max(2, p.length || 6)) * (p.scale || 1);
    const s = Math.sin(p.rot || 0), c = Math.cos(p.rot || 0);
    for (let t = -len / 2 - 3.5; t <= len / 2 + 3.5; t += 0.25) {
      const gx = Math.round(p.x + s * t + terrain.half - 0.5);
      const gz = Math.round(p.z + c * t + terrain.half - 0.5);
      if (gx < 0 || gz < 0 || gx >= terrain.size || gz >= terrain.size) continue;
      seen.set(gx + gz * terrain.size, [gx, gz]);
    }
  }
  return [...seen.values()];
}

export function createProps({ scene, terrain, material }) {
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);

  const records = new Map();     // id -> { spec, mesh, grow }
  const growing = [];
  const cache = new Map();       // a shape drawn twice shares its geometry

  function geometryFor(p) {
    const shape = SHAPES[p.kind] || SHAPES.cairn;
    // Only the shapes that read a number off the prop need their own geometry; the
    // rest are the same every time and are worth keeping.
    const key = shape.stretch ? `${p.kind}:${p.length || 0}:${p.label ? 1 : 0}` : `${p.kind}:${p.label ? 1 : 0}`;
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
    records.set(p.id, rec);
    if (animate) growing.push({ rec, t: 0 });
    return rec;
  }

  function remove(id) {
    const rec = records.get(id);
    if (!rec) return;
    group.remove(rec.mesh);
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
  }

  // What the walker cannot step into, and can climb onto: propSolids, standing where the mesh
  // stands. `origin` moves them into the world for a guest island, whose props hang in an offset
  // group (guest-island.js) while walk mode reads world coordinates.
  function blockers([ox, oz] = [0, 0]) {
    const out = [];
    for (const rec of records.values()) {
      for (const b of propSolids(rec.spec, rec.mesh.position.y)) out.push({ ...b, x: b.x + ox, z: b.z + oz, id: rec.spec.id });
    }
    return out;
  }

  function deckCells(terrain) {
    return deckCellsOf([...records.values()].map((rec) => rec.spec), terrain);
  }
  function deckShapes(terrain) {
    return deckShapesOf([...records.values()].map((rec) => rec.spec), terrain);
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
    for (const g of cache.values()) g.dispose();
    cache.clear();
    records.clear();
  }

  function roadCells(terrain) {
    return bridgeRoadCellsOf([...records.values()].map((rec) => rec.spec), terrain);
  }

  return { group, apply, update, blockers, deckCells, deckShapes, roadCells, nearest, count: () => records.size, dispose };
}
