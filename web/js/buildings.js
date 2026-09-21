// Everything that stands on a plot. Each building is composed from a handful of
// vertex-coloured primitives and merged into a single geometry, so 300 houses cost
// 300 draw calls rather than 6000. Windows glow at night through a per-vertex
// emissive mask on the one shared material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, hash32 } from 'shared/rng.mjs';
// The palette moved to shared/ so Node can read it without importing this file -
// see the header of shared/palette.mjs. Re-exported because most of the tree asks
// here for it, and the colours of the island are this file's subject.
import { PALETTE } from 'shared/palette.mjs';
export { PALETTE };
import { SEA_LEVEL } from 'shared/terrain.mjs';
import * as models from './models.js';
import { textureUrl } from './assets.js';

// Four styles, and every one of them roofed in the same family of fired clay. The roofs
// used to be the loudest thing about a style - copper, blue-grey slate, green and gold,
// one to a district - and a hillside of them read as a colour chart rather than as a
// village. A real village roofs itself out of whatever the local kiln fires, so the
// difference between one house and the next is which batch it came from. Identity moved
// down into `wall`, `trim` and `accent`, where it is still perfectly legible from the
// ground and does not decide what the island looks like from the air.
//
// The four tints are one clay each: fable's is the tavern's own terracotta, opus fires
// darkest, sonnet brightest, haiku palest. They are also what the Blender roofs are
// painted with, so a gable off `roof_gable_a` and a `prismRoof` fallback are the same
// colour on the same street.

export const C = {
  foundation: 0x8d8577, wood: 0x8b5e3c, darkWood: 0x5a3c28, canvas: 0xe9d8b4,
  stripe: 0xc86b4a, anvil: 0x3a3a3f, copper: 0xb87333, stone: 0xa8a59e,
  slate: 0x4c5566, plank: 0xb07a4a, blueprint: 0x4d7ec9, paper: 0xf5efe0,
  thatch: 0xc9a75c, brick: 0x9c5a44, glass: 0xffd27f, white: 0xf5efe0,
  // Verdigris, for the one roof on the island that is allowed not to be clay. Now that
  // every house is terracotta the town hall needs to be the exception rather than one
  // more slate box, and weathered copper over a civic hall is what the dome in the
  // reference illustration is - the cool note the whole warm hillside is read against.
  patina: 0x5f8f7a,
  green: 0x6fb84a, red: 0xd94f3d, blue: 0x3d7ed9, gold: 0xd9a33d, iron: 0x3a3a3f,
};

export const TIER_INDEX = { tent: 0, hut: 1, cottage: 2, house: 3, manor: 4, keep: 5, shed: -1, civic: -2 };
export const TIER_LABEL = { tent: 'Tent', hut: 'Hut', cottage: 'Cottage', house: 'House', manor: 'Manor', keep: 'Keep' };

// The lighthouse's lamp: how many painted bands the tower is built of, and how high the
// lamp therefore stands over its own foot. Hoisted out of the `lighthouse` case below,
// where it is still the only arithmetic that decides it, because web/js/horizon.js has to
// put a light on a tower it never builds - a silhouette has no mesh to read an anchor off.
// A second, hand-copied 2.4 somewhere else is how a far island's lamp ends up buried in
// its own lantern room the first time the tower gains a band.
export const BEACON_BANDS = 4;
export const BEACON_RISE = BEACON_BANDS * 0.55 + 0.2;

// ---------------------------------------------------------------- sheets
// world.js keeps the same three lines for the ground and the trees and does not export
// them, so here they are again: fetch a sheet, wrap it, and if it never arrives say so
// once and leave the surface exactly as it was drawn before there were any sheets.
//
// Three of them serve every building on the island, and which one a face takes is a
// number carried on the vertex rather than a material of its own. That matters: the
// obvious way round - one material group per part and an array of materials on the mesh
// - turns a building from one draw call into one per part, and there are hundreds of
// buildings. It would also mean handing main.js an array where it passes a single
// material, and main.js hands that same material to the settlers, the crops, the boats
// and the bridges, none of which have groups to match it. So: one material, one draw
// call per building, and a branch in the fragment shader.
const texLoader = new THREE.TextureLoader();
// One white pixel until a sheet arrives, and for good if none ever does: white
// multiplies out, so a building with no textures is the building the island always drew.
const BLANK = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
BLANK.needsUpdate = true;
const SHEET_UNIFORM = { wall: 'uWall', roof: 'uRoof', stone: 'uStone', plank: 'uPlank' };
const sheetUsers = [];               // the uniform block of every material handed out
function loadSheet(name, slot) {
  texLoader.load(textureUrl(name), (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;              // the renderer clamps this to whatever the card allows
    for (const u of sheetUsers) u[SHEET_UNIFORM[slot]].value = tex;
  }, undefined, () => {
    console.warn(`[island] no texture at web/textures/${name}.png; that surface stays as it was`);
  });
}
loadSheet('wall-plaster', 'wall');
loadSheet('roof-tile', 'roof');
loadSheet('stone-stacked', 'stone');
loadSheet('plank', 'plank');

// What a part is drawn on. Zero - no sheet at all - is the default and stays the default:
// glass, ironwork, cloth, paper and every small painted thing are better flat.
// 'plank' and 'plankZ' are the same sheet read two ways. The boards on it run along
// the sheet's own x, so a deck that runs north-south wants them turned a quarter, and
// the shader does that by reading the position and the normal back to front rather than
// by carrying a second copy of the wood.
const SHEET = { wall: 1, roof: 2, stone: 3, plank: 4, plankZ: 5 };
const sheetOf = (o, dflt) => SHEET[o.sheet === undefined ? dflt : o.sheet] || 0;

// ---------------------------------------------------------------- material
export function createBuildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.0 });
  mat.userData.uniforms = {
    uNight: { value: 0 },
    uWall: { value: BLANK }, uRoof: { value: BLANK }, uStone: { value: BLANK }, uPlank: { value: BLANK },
  };
  sheetUsers.push(mat.userData.uniforms);
  mat.onBeforeCompile = (shader) => {
    const u = mat.userData.uniforms;
    shader.uniforms.uNight = u.uNight;
    shader.uniforms.uWall = u.uWall;
    shader.uniforms.uRoof = u.uRoof;
    shader.uniforms.uStone = u.uStone;
    shader.uniforms.uPlank = u.uPlank;
    const glsl = (...lines) => lines.join(String.fromCharCode(10));
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', glsl(
        '#include <common>',
        'attribute float aEmissive;',
        'attribute float aSheet;',
        'varying float vEmi;',
        'varying float vSheet;',
        'varying vec3 vSheetPos;',
        'varying vec3 vSheetNrm;'))
      .replace('#include <begin_vertex>', glsl(
        '#include <begin_vertex>',
        'vEmi = aEmissive;',
        'vSheet = aSheet;',
        'vSheetPos = position;',
        'vSheetNrm = normal;'));
    // There is no uv anywhere on a building - finish() throws it away so that parts built
    // at wildly different sizes can be merged into one loaf - so the sheet is projected on
    // instead, from the three axes at once, blended by how far the face turns towards each.
    // A box face takes one projection whole; a roof pitch, whose normal points between two
    // axes, cross-fades two, which is what lets a sheet lie flat over a ridge with no seam
    // along it. Projecting also makes the pattern the same size on a cottage and on a keep,
    // which is the one thing a per-face uv could never do.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', glsl(
        '#include <common>',
        'varying float vEmi;',
        'uniform float uNight;',
        'varying float vSheet;',
        'varying vec3 vSheetPos;',
        'varying vec3 vSheetNrm;',
        'uniform sampler2D uWall;',
        'uniform sampler2D uRoof;',
        'uniform sampler2D uStone;',
        'uniform sampler2D uPlank;',
        'vec3 islandSheet(sampler2D m, vec3 p, vec3 n, float s) {',
        '  vec3 w = n * n;',
        '  w /= max(1e-4, w.x + w.y + w.z);',
        '  return texture2D(m, p.zy * s).rgb * w.x',
        '       + texture2D(m, p.xz * s).rgb * w.y',
        '       + texture2D(m, p.xy * s).rgb * w.z;',
        '}'))
      .replace('#include <color_fragment>', glsl(
        '#include <color_fragment>',
        'if (vSheet > 0.5) {',
        '  vec3 sn = normalize(vSheetNrm);',
        '  vec3 sc = vec3(1.0);',
        // The stacked stone was drawn for a rubble wall and swings from a fifth of full
        // brightness to all of it. At that strength it would be the loudest thing on the
        // island, and the paving is meant to keep the deepest tone here, so a plinth takes
        // under two thirds of the sheet.
        '  float sk = 1.0;',
        '  if (vSheet > 4.5) { sc = islandSheet(uPlank, vSheetPos.zyx, sn.zyx, 1.3); }',
        '  else if (vSheet > 3.5) { sc = islandSheet(uPlank, vSheetPos, sn, 1.3); }',
        '  else if (vSheet > 2.5) { sc = islandSheet(uStone, vSheetPos, sn, 1.0); sk = 0.62; }',
        '  else if (vSheet > 1.5) { sc = islandSheet(uRoof, vSheetPos, sn, 1.0); }',
        '  else { sc = islandSheet(uWall, vSheetPos, sn, 1.7); }',
        '  diffuseColor.rgb *= mix(vec3(1.0), sc, sk);',
        '}'))
      .replace('#include <emissivemap_fragment>', glsl(
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance += vColor.rgb * vEmi * (0.25 + uNight * 1.7);'));
  };
  mat.customProgramCacheKey = () => 'settlers-emissive';
  return mat;
}

// ---------------------------------------------------------------- primitives
function finish(g, hex, emissive = 0, sheet = 0) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const flat = g.index ? g.toNonIndexed() : g;
  const n = flat.attributes.position.count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3), emi = new Float32Array(n), she = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    emi[i] = emissive;
    she[i] = sheet;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.setAttribute('aEmissive', new THREE.BufferAttribute(emi, 1));
  // Only the parts that are drawn on something carry the attribute; merge() fills in the
  // rest. See the note there - it is not an optimisation, it is what keeps the figures
  // buildable out of these same primitives.
  if (sheet) flat.setAttribute('aSheet', new THREE.BufferAttribute(she, 1));
  return flat;
}
function place(g, o = {}) {
  if (o.ry) g.rotateY(o.ry);
  if (o.rx) g.rotateX(o.rx);
  if (o.rz) g.rotateZ(o.rz);
  g.translate(o.x || 0, o.y || 0, o.z || 0);
  return g;
}

// ---------------------------------------------------------------- provenance
// A merged mesh can no longer say that one of its faces used to be
// `box(0.16, 0.26, 0.05, pal.accent, { z: 0.51 })`, and that is precisely what the model
// editor needs in order to show you a door, let you nudge it, and hand back the line to
// paste. So every primitive notes its own call on the geometry it returns. It costs one
// small object per part, nothing on the island reads it, and the merge drops it again.
let groupSeq = 0;
let openGroup = null;

// Some primitives only mean anything together: one box is a window, six are a bench.
// Wrapping them marks every part inside as a single pickable thing, so the editor moves
// the window and not the pane it happens to be made of.
export function group(kind, fn, args = null) {
  const outer = openGroup;
  openGroup = { kind, id: ++groupSeq, args };
  try { return fn(); } finally { openGroup = outer; }
}
function note(g, fn, args, hex, o) {
  // `o` is copied: the editor writes to it, and the call sites hand in literals they
  // reuse across a loop.
  g.userData.part = { fn, args, hex, o: { ...o }, group: openGroup };
  return g;
}
// Moves a finished part and keeps its note honest, for the one or two places that build
// a piece around the origin and hoist it afterwards.
function lift(g, dy) {
  g.translate(0, dy, 0);
  const p = g.userData.part;
  if (p) p.o = { ...p.o, y: (p.o.y || 0) + dy };
  return g;
}

// A Blender-baked part has the same attributes and placement contract as box().
// Material prefixes become existing sheet IDs; vertex colours stay in linear space.
//
// Which .blend it came out of is web/js/models.js's business, not the call site's: every
// baked set is in one register under one flat set of names. An unknown name throws rather
// than drawing nothing, because a part that has quietly gone missing from a building is
// far harder to notice than a page that says so. A caller that means "use the model if it
// has been made yet" asks models.has() first - see barrel() in props.js.
// `sx`/`sy`/`sz` scale it before it is turned and moved, which is what lets one gable
// modelled on a unit square roof every width of house on the island - the scale is the
// overhang and `sy` alone is the pitch. `repaint` is the other half of that: normally
// `hex` multiplies the colours Blender baked in, so white leaves a barrel exactly the
// barrel that was modelled, but a roof's colour belongs to the island rather than to the
// .blend - there is one gable and there are four styles - and multiplying two terracottas
// gives neither of them. So the slots the island owns say so, and the timber under them
// keeps the oak it was modelled in.
export function mesh(name, hex = 0xffffff, o = {}) {
  const part = models.part(name);
  if (!part) throw new Error(`Unknown Blender building part: ${name}`);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
  const options = { sheet: part.sheet, emissive: part.emissive, ...o };
  finish(g, hex, options.emissive, sheetOf(options));
  if (!options.repaint) {
    const colors = g.attributes.color.array;
    for (let i = 0; i < colors.length; i++) colors[i] *= part.colors[i];
  }
  if (options.sx !== undefined || options.sy !== undefined || options.sz !== undefined) {
    g.scale(options.sx ?? 1, options.sy ?? 1, options.sz ?? 1);
  }
  return note(place(g, options), 'mesh', [name], hex, options);
}

// Every part of one Blender asset, each where Blender had it, as parts to push. An asset
// is a whole building for a set that holds one - the tavern - or one roof out of a set
// that holds several. `o` shifts, turns and scales the lot, for a caller composing an
// asset into something bigger: meshAsset('roof_gable_a') sat on top of a house body.
//
// `hex` may be one colour for all of it, or a function of a part's name and sheet that
// answers with the colour the island wants there - or with null to keep the colour
// Blender gave it. A roof needs both in one asset: the island owns the tiles and the
// .blend owns the barge boards.
export function meshAsset(name, hex = 0xffffff, o = {}) {
  const sx = o.sx ?? 1, sy = o.sy ?? 1, sz = o.sz ?? 1;
  const c = Math.cos(o.ry || 0), s = Math.sin(o.ry || 0);
  // Only a caller that asks per part is repainting. A plain colour multiplies, the way it
  // always has: `meshAsset(name)` is white times what Blender baked, which is Blender's
  // own colours, and that is what the model sheet has to show.
  const per = typeof hex === 'function' ? hex : null;
  return models.assetParts(name).map((partName) => {
    const part = models.part(partName);
    // Where Blender had this part, scaled and turned with the asset rather than on its
    // own: an asset turned a quarter has to take its chimney round with it.
    const x = part.at[0] * sx, z = part.at[2] * sz;
    const paint = per ? per(partName, part.sheet) : hex;
    return mesh(partName, paint ?? 0xffffff, {
      ...o,
      repaint: o.repaint || (per !== null && paint != null),
      x: (o.x || 0) + x * c + z * s,
      y: (o.y || 0) + part.at[1] * sy,
      z: (o.z || 0) - x * s + z * c,
    });
  });
}

// Where an asset's anchors end up once meshAsset has put it somewhere. Same arithmetic,
// and it has to be the same arithmetic: a chimney whose smoke comes out half a unit from
// its pot is the kind of thing nobody sees until the island is running at dusk.
export function meshAnchors(name, o = {}) {
  const sx = o.sx ?? 1, sy = o.sy ?? 1, sz = o.sz ?? 1;
  const c = Math.cos(o.ry || 0), s = Math.sin(o.ry || 0);
  const out = {};
  for (const [kind, at] of Object.entries(models.anchorsOf(name))) {
    const x = at[0] * sx, z = at[2] * sz;
    out[kind] = [(o.x || 0) + x * c + z * s, (o.y || 0) + at[1] * sy, (o.z || 0) - x * s + z * c];
  }
  return out;
}

// A colour a shade lighter or darker, for the two places one surface has to read against
// another of the same material: the course of caps over its own ridge, and one house's
// batch of tiles against its neighbour's.
export function shade(hex, f) {
  return new THREE.Color(hex).multiplyScalar(f).getHex();
}

// How the island paints a Blender composable it has stood on a house. Three of the slots
// belong to the style rather than to the .blend - the plaster, the tiles, and a pane that
// has to light up with every other window at dusk - and everything else keeps what
// Blender gave it, because oak is oak and brick is brick whoever lives there.
//
// The rolls and courses - the caps along a ridge, the proud bottom row at the eaves - are
// tiles too, and they are lifted a shade so the lines they draw survive being repainted.
// Without that they come out the same number as the pitch they sit on and a roof goes
// back to being one flat triangle, which is the thing the .blend was modelled to stop.
const styleTint = (roofHex, pal) => (name, sheet) => (
  sheet === 'wall' ? pal.wall
    : sheet === 'roof' ? (/roll|course/.test(name) ? shade(roofHex, 1.16) : roofHex)
      : /pane/.test(name) ? pal.glow
        : null);

// a box whose base sits at y = o.y
// Water and soil are modelled flush with the rim that holds them, which puts two faces
// on exactly the same plane and leaves the depth buffer to guess - the hatched surfaces
// on the well, the fountain and the flower beds. Lifting the inner surface by a hair
// settles it: far below anything the eye can see at this scale, far above the precision
// the depth buffer has to work with. Filled to the brim rather than a hair short of it,
// which is also the way a fountain should look.
const BRIM = 0.004;

export function box(w, h, d, hex, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return note(place(finish(g, hex, o.emissive || 0, sheetOf(o)), o), 'box', [w, h, d], hex, o);
}
export function cylinder(rt, rb, h, seg, hex, o = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(0, h / 2, 0);
  return note(place(finish(g, hex, o.emissive || 0, sheetOf(o)), o), 'cylinder', [rt, rb, h, seg], hex, o);
}
export function cone(r, h, seg, hex, o = {}) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, h / 2, 0);
  return note(place(finish(g, hex, o.emissive || 0, sheetOf(o)), o), 'cone', [r, h, seg], hex, o);
}
export function dome(r, hex, o = {}) {
  const g = new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  return note(place(finish(g, hex, o.emissive || 0, sheetOf(o)), o), 'dome', [r], hex, o);
}
export function sphere(r, hex, o = {}) {
  const g = new THREE.SphereGeometry(r, 7, 5);
  return note(place(finish(g, hex, o.emissive || 0, sheetOf(o)), o), 'sphere', [r], hex, o);
}
// gable roof: a triangular prism, base at y = o.y, ridge running along x
export function prismRoof(w, d, h, hex, o = {}) {
  const hw = w / 2, hd = d / 2;
  const v = [
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,   // 0..3 base
    -hw, h, 0, hw, h, 0,                               // 4,5 ridge
  ];
  // Wound counter-clockwise seen from outside, or the whole roof is back-face culled
  // and you look straight through the house.
  const f = [
    0, 5, 1, 0, 4, 5,   // the slope facing -z
    2, 4, 3, 2, 5, 4,   // the slope facing +z
    0, 3, 4, 1, 5, 2,   // the two gable ends
    0, 2, 3, 0, 1, 2,   // the underside
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(f);
  return note(place(finish(g, hex, 0, sheetOf(o, 'roof')), o), 'prismRoof', [w, d, h], hex, o);
}
export function pyramidRoof(w, d, h, hex, o = {}) {
  const g = new THREE.ConeGeometry(0.7071, h, 4);
  g.rotateY(Math.PI / 4);
  g.scale(w, 1, d);
  g.translate(0, h / 2, 0);
  return note(place(finish(g, hex, 0, sheetOf(o, 'roof')), o), 'pyramidRoof', [w, d, h], hex, o);
}
// A flat triangle or quad, given 3 or 4 points. Used for sails, fins and pennants.
export function quad(pts, hex, o = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  g.setIndex(pts.length === 3 ? [0, 1, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  return note(place(finish(g, hex, o.emissive || 0, sheetOf(o)), o), 'quad', [pts], hex, o);
}

function merge(parts) {
  const list = parts.filter(Boolean);
  // mergeGeometries will only weld shapes that agree on which attributes exist, and
  // settlers.js and avatar.js build their figures by merging a capsule of their own with
  // box() and sphere() from this file. Put `aSheet` on every primitive as it is made and
  // their merge stops dead, on a line in a file this one has no business breaking. So a
  // part says which sheet it wants only when it wants one, and the zeroes are filled in
  // here, where the loaf is a building and nothing else is in it.
  let n = 0;
  for (const g of list) if (g.attributes.aSheet) n++;
  if (n && n < list.length) {
    for (const g of list) {
      if (g.attributes.aSheet) continue;
      g.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    }
  }
  const g = mergeGeometries(list, false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// props.js builds its shapes out of these same primitives and needs the same filling in,
// so it merges with this rather than with a copy of it that had drifted: a prop made of a
// Blender part, which carries a sheet, and a cylinder, which does not, came out of the
// copy with the sheet thrown away. See the note inside merge() for why the zeroes are
// filled in here and not in finish().
export { merge as mergeParts };

// ---------------------------------------------------------------- the kit
// Places one piece inside a sub-assembly: its offset turns with the assembly, and so
// does the piece, which is what lets a bench stand against a wall at an angle without
// every number in it being rewritten by hand.
function inside(a, o = {}) {
  const c = Math.cos(a.ry || 0), s = Math.sin(a.ry || 0);
  const x = o.x || 0, z = o.z || 0;
  return {
    ...o,
    x: (a.x || 0) + x * c + z * s,
    y: (a.y || 0) + (o.y || 0),
    z: (a.z || 0) - x * s + z * c,
    ry: (o.ry || 0) + (a.ry || 0),
  };
}

// The pieces that keep coming back, each as one named thing rather than the boxes it
// happens to be: a window, a door, a bench. The builders below reach for them, and the
// model editor offers the same list when you want one more - which is the whole point
// of giving them names. `defaults` is what the editor puts in its number fields; every
// piece also takes the placement `{ x, y, z, ry }` that `inside` spreads over its parts.
export const KIT = {
  window: {
    label: 'Window',
    defaults: { w: 0.13, h: 0.17, d: 0.04, hex: C.glass },
    build: (parts, a) => group('window', () => {
      parts.push(box(a.w, a.h, a.d, a.hex, inside(a, { emissive: 1 })));
    }, a),
  },
  door: {
    label: 'Door',
    defaults: { w: 0.16, h: 0.26, d: 0.05, hex: C.darkWood },
    build: (parts, a) => group('door', () => {
      parts.push(box(a.w, a.h, a.d, a.hex, inside(a, {})));
    }, a),
  },
  bench: {
    label: 'Bench',
    defaults: { w: 0.46, hex: C.plank },
    build: (parts, a) => group('bench', () => {
      const lx = a.w / 2 - 0.05;
      for (const x of [-lx, lx]) {
        parts.push(box(0.04, 0.2, 0.04, C.iron, inside(a, { x, z: -0.05 })));
        parts.push(box(0.04, 0.2, 0.04, C.iron, inside(a, { x, z: 0.05 })));
      }
      parts.push(box(a.w, 0.035, 0.16, a.hex, inside(a, { y: 0.2 })));
      parts.push(box(a.w, 0.17, 0.03, a.hex, inside(a, { y: 0.22, z: -0.07, rx: -0.16 })));
    }, a),
  },
  table: {
    label: 'Table',
    defaults: { r: 0.13, h: 0.2, hex: C.plank },
    build: (parts, a) => group('table', () => {
      parts.push(cylinder(0.035, 0.045, a.h, 6, C.darkWood, inside(a, {})));
      parts.push(cylinder(a.r, a.r, 0.025, 8, a.hex, inside(a, { y: a.h })));
    }, a),
  },
  chair: {
    label: 'Chair',
    defaults: { w: 0.09, h: 0.12, hex: C.plank },
    build: (parts, a) => group('chair', () => {
      for (const [lx, lz] of [[-0.032, -0.032], [0.032, -0.032], [-0.032, 0.032], [0.032, 0.032]]) {
        parts.push(box(0.014, a.h, 0.014, C.darkWood, inside(a, { x: lx, z: lz })));
      }
      parts.push(box(a.w, 0.022, a.w, a.hex, inside(a, { y: a.h })));
      parts.push(box(a.w, 0.12, 0.018, C.darkWood, inside(a, { y: a.h + 0.022, z: -0.036 })));
    }, a),
  },
};

// ---------------------------------------------------------------- pieces
function windowsOn(parts, pal, { w, h, y0, count, ry = 0 }) {
  const hw = w / 2 + 0.005;
  const spots = [
    { x: -w * 0.22, z: hw, ry: 0 }, { x: w * 0.22, z: hw, ry: 0 },
    { x: hw, z: 0, ry: Math.PI / 2 }, { x: -hw, z: 0, ry: Math.PI / 2 },
    { x: -w * 0.22, z: -hw, ry: 0 }, { x: w * 0.22, z: -hw, ry: 0 },
  ];
  for (let i = 0; i < Math.min(count, spots.length); i++) {
    const s = spots[i];
    KIT.window.build(parts, { ...KIT.window.defaults, hex: pal.glow, x: s.x, y: y0, z: s.z, ry: s.ry });
  }
  void h; void ry;
}
function door(parts, pal, w) {
  KIT.door.build(parts, { ...KIT.door.defaults, hex: pal.accent, z: w / 2 + 0.01 });
}
function foundation(parts, w, d) {
  group('foundation', () => parts.push(box(w + 0.12, 0.34, d + 0.12, C.foundation, { y: -0.3, sheet: 'stone' })));
}

function timberFrame(parts, w, h, d, hex) {
  const t = 0.035;
  group('frame', () => {
    for (const [x, z, ry] of [[0, d / 2, 0], [0, -d / 2, 0], [w / 2, 0, Math.PI / 2], [-w / 2, 0, Math.PI / 2]]) {
      parts.push(box(t, h, t, hex, { x: x + (ry ? 0 : -w * 0.3), y: 0, z, ry }));
      parts.push(box(t, h, t, hex, { x: x + (ry ? 0 : w * 0.3), y: 0, z, ry }));
      parts.push(box(w * 0.9, t, t, hex, { x, y: h - t, z, ry }));
    }
  });
}

// ---------------------------------------------------------------- roofs
// How far a roof oversails the wall it stands on, all round. A Blender roof is modelled
// on a unit square, so this is also the number that scales it: `dims.w + ROOF_OVERHANG`
// is what `prismRoof(dims.w + 0.14, ...)` was passing by hand on every line before.
const ROOF_OVERHANG = 0.14;

// The top of a heap of parts. A Blender roof knows its own height and the caller has just
// scaled it by an amount the rng chose, so reading the answer back off the geometry is
// both cheaper than a table of model heights in this file and impossible to leave stale
// when the .blend changes.
function riseOf(parts) {
  let y = -Infinity;
  for (const g of parts) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > y) y = p.getY(i);
  }
  return Number.isFinite(y) ? y : 0;
}

// How tall an asset is at its own scale, straight off the baked arrays. Needed before
// anything is built: a chimney is stretched to clear the roof it comes out of, and that
// sum wants the stack's own height on one side of it. Measured once per name.
const assetRise = (() => {
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) {
      let y = 0;
      for (const p of models.assetParts(name)) {
        const part = models.part(p);
        for (let i = 1; i < part.positions.length; i += 3) {
          const v = part.positions[i] + part.at[1];
          if (v > y) y = v;
        }
      }
      cache.set(name, y);
    }
    return cache.get(name);
  };
})();

// The rng houseBody has been handed since the day it was written and had never once used.
// Every house on the island wore the same roof at the same pitch as every other house of
// its tier, and a hillside of them read as an estate rather than as the village in the
// reference illustration, whose charm is that no two roofs next door are quite the same.
//
// The roof is planned before a single part of it is built, and that order is the point of
// the card: a chimney may not come up through a dormer, and where a dormer can sit depends
// on which way the ridge runs. So every die is thrown here, the shapes are known before
// anything is placed, and the things that hang off the roof are put against the answer
// rather than each guessing for itself.
function planRoof(rng, style, tier, modest) {
  // Each style keeps the roof it was known for as its starting point - opus builds square
  // and hipped, haiku round - and the rng varies it from there, so a district still reads
  // as a district while no street in it repeats.
  const family = style === 'haiku' ? 'roof_cone'
    : style === 'opus' || (tier >= 2 && rng.chance(0.25)) ? 'roof_hip'
      : 'roof_gable';
  const variants = models.variants(family);
  return {
    family,
    asset: variants.length ? rng.pick(variants) : null,
    // A pitch a fifth either way is a generation of builders rather than a mistake, and
    // it multiplies the model's own height rather than replacing it, so the steep gable
    // and the shallow one stay a steep one and a shallow one.
    pitch: rng.range(0.9, 1.2),
    // Two of the three add-ons are luxuries. A modest GPU gets the roof and the chimney
    // it smokes from and nothing else, because these are drawn three hundred times.
    dormer: !modest && tier >= 2 && rng.chance(0.5),
    dormerSide: rng.chance(0.5) ? 1 : -1,
    turret: !modest && rng.chance(0.3),
  };
}

// How high the roof is over a point on the plan: what a dormer is set into, and what a
// chimney has to clear. A pitch falls away from its ridge at a constant rate and a cone
// falls away from its own middle; a hip falls away in both directions, and answering it
// as a pitch overstates it, which errs on the side of a chimney that is tall enough.
function surfaceOf(plan, span, rise) {
  const fall = (d) => Math.max(0, rise * (1 - 2 * d / span));
  return plan.family === 'roof_cone'
    ? (x, z) => fall(Math.hypot(x, z))
    : (x, z) => fall(Math.abs(z));
}

// The roof itself, and the fallback that is also the history: every shape in the second
// branch is the shape these houses wore before Blender, so a checkout with no
// village-mesh.js in it boots and looks like the island of a week ago rather than not at
// all. The two branches share the palette, which is what keeps a baked gable and a
// prismRoof the same colour when they end up on the same street.
function roofOn(parts, plan, dims, pal, roofHex, top) {
  const span = dims.w + ROOF_OVERHANG;
  let built;
  if (plan.asset) {
    // One uniform scale, with the pitch on top of it: the footprint has to be the wall's
    // and the proportions have to be the model's, or a wide house gets a flat roof.
    built = meshAsset(plan.asset, styleTint(roofHex, pal),
      { y: top, sx: span, sy: span * plan.pitch, sz: span });
  } else if (plan.family === 'roof_cone') {
    built = [cone(dims.w * 0.82, (dims.roof + 0.16) * plan.pitch, 8, roofHex, { y: top - 0.02, sheet: 'roof' })];
  } else if (plan.family === 'roof_hip') {
    built = [pyramidRoof(span, span, (dims.roof + 0.06) * plan.pitch, roofHex, { y: top })];
  } else {
    built = [prismRoof(span, span, dims.roof * plan.pitch, roofHex, { y: top })];
  }
  for (const g of built) parts.push(g);
  return riseOf(built) - top;
}

// ---------------------------------------------------------------- the yard
// What a house puts out around itself. The reference illustration's charm is as much the
// stuff lying about between the houses as the houses themselves: a handcart by the gable
// end, a crate against the wall, cordwood stacked under the eaves, a line of washing out
// the back. It is also the cheapest thing on the island - a yard piece is merged into the
// same geometry as the house it belongs to, so a street of them is still one draw call
// each - and all five of them are already modelled at true size in assets/props.
//
// What the yard is not free of. The door cell on +Z is where the path arrives and where a
// settler stands. The eight cells round the house are also where lib/layout.mjs seats an
// apprentice's shed. And the house reaches over the inner edge of all eight, by far more
// at a manor with a wing than at a hut. So nothing here is placed by a number measured
// once: a piece is offered a spot, its rectangle is worked out where it would stand, and
// it is put down only if walk mode would still see a way past it.
//
// That last test is the point of this block and not decoration. mergeRects() glues two
// rectangles together when the gap between them is too narrow to walk through, so a cart
// set close against its own house makes one blob with it - and a blob that reaches round
// the corner of the house covers the doorstep, which is the one cell the yard may not
// have. Keeping every piece a rectangle of its own makes that impossible rather than
// unlikely.
//
// Where a piece may stand, in the house's own frame, the door being +Z. Never [0, 1].
const YARD_SPOTS = [
  [-1, -1], [1, -1],                     // the back corners
  [-1, 0], [1, 0],                       // the flanks
  [0, -1],                               // straight out the back
  [-1, 1], [1, 1],                       // beside the door, on the lane
];

// The five, with how far each reaches across x and along z as it is modelled. Written
// down rather than measured off the geometry, because these are the numbers
// tests/models.test.mjs holds the models to - a figure that reads itself checks nothing.
const YARD_KIT = [
  { asset: 'prop_cart', hx: 0.16, hz: 0.43 },
  { asset: 'prop_crate', hx: 0.15, hz: 0.15 },
  { asset: 'prop_woodpile', hx: 0.23, hz: 0.15 },
  { asset: 'prop_barrel', hx: 0.12, hz: 0.12 },
  { asset: 'prop_washline', hx: 0.12, hz: 0.43 },
];

// A piece lies along the wall it stands beside - which is how a cart is actually parked,
// and what keeps its long side out of the lane. The wall runs along x behind the house and
// along z beside it, so a piece whose own long side is the other way round gets a quarter
// turn: the woodpile is stacked across x and the cart and the line run along z.
function yardLie(piece, [sx, sz]) {
  const wallAlongX = sx === 0;
  const turn = wallAlongX !== (piece.hx >= piece.hz);
  return { ry: turn ? Math.PI / 2 : 0, hx: turn ? piece.hz : piece.hx, hz: turn ? piece.hx : piece.hz };
}

// Two rectangles walk mode would glue into one. mergeRects()'s own condition, read the
// other way round: separated by more than the gap on either axis and they stay two things
// with a way between them.
function wouldMerge(a, b) {
  return !(a.x - a.hx - WALK_GAP > b.x + b.hx || b.x - b.hx - WALK_GAP > a.x + a.hx)
    && !(a.z - a.hz - WALK_GAP > b.z + b.hz || b.z - b.hz - WALK_GAP > a.z + a.hz);
}

// Up to two pieces, from the same rng the roof was chosen with. Two rather than three
// because a yard with three things in it stops reading as a yard and starts reading as a
// depot, and one fewer for every apprentice: a shed is standing in one of these cells too
// and nothing on this side knows which, so a yard filling up with sheds stops filling up
// with carts. A modest GPU gets one at most.
//
// The parts come back rather than going into the loaf, because the porch has not been
// built yet and porch() lifts everything it finds by the height of its own step. A cart
// standing on the grass beside the house is not standing on the step.
function yardOn(spec, rng, solids, modest) {
  let want = Math.min(rng.int(3), modest ? 1 : 2) - (spec.sheds || []).length;
  const kit = YARD_KIT.filter((k) => models.hasAsset(k.asset));
  if (want <= 0 || !kit.length) return [];
  const taken = [...solids];
  const spots = [...YARD_SPOTS];
  const out = [];
  // Counted rather than read off `out`, which holds a part per box and cone of the model
  // and would call one cart two pieces over.
  while (taken.length - solids.length < want && spots.length) {
    const spot = spots.splice(rng.int(spots.length), 1)[0];
    const piece = rng.pick(kit);
    const lie = yardLie(piece, spot);
    // As far out as the yard goes, cell-centred on the axis it does not stand off. Pushed
    // out rather than sat on the cell centre because the room is between the house and the
    // plot edge, and it is the house that varies.
    const at = {
      x: spot[0] ? spot[0] * (YARD_REACH - lie.hx) : 0,
      z: spot[1] ? spot[1] * (YARD_REACH - lie.hz) : 0,
      hx: lie.hx, hz: lie.hz,
    };
    if (taken.some((r) => wouldMerge(at, r))) continue;
    taken.push(at);
    for (const g of meshAsset(piece.asset, 0xffffff, { x: at.x, z: at.z, ry: lie.ry })) out.push(g);
  }
  return out;
}

// ---------------------------------------------------------------- houses
// A tent is the one dwelling with neither plaster nor tiles on it, so the slot the island
// owns is the band down its doorway: from the lane that is what tells you whose tent it
// is, the way the walls and the roof do on a house.
const tentTint = (pal) => (name) => (/band/.test(name) ? pal.trim : null);

function houseBody(parts, spec, pal, rng, ctx = {}) {
  const tier = TIER_INDEX[spec.tier] ?? 1;
  const anchors = {};
  const style = spec.style || 'unknown';
  // A house on stilts over the shoreline has no yard: there is nothing under it to leave
  // a cart on. Everything else gets one, a tent included - a tent with a woodpile and a
  // barrel beside it is exactly the corner of the reference this card is aiming at.
  const yard = (built) => (spec.harbour ? [] : yardOn(spec, rng, footprintOf(built, WALK_CLEARANCE), ctx.modest));

  if (tier === 0) {                                   // tent
    if (models.hasAsset('prop_tent')) {
      for (const g of meshAsset('prop_tent', tentTint(pal))) parts.push(g);
      return { anchors, height: assetRise('prop_tent'), w: 0.8, yard: yard(parts) };
    }
    // The tent the island drew before Blender, and what a checkout with no props-mesh.js
    // in it still gets.
    parts.push(prismRoof(0.8, 0.86, 0.58, C.canvas, { sheet: null }));
    parts.push(box(0.045, 0.64, 0.045, C.darkWood, { z: -0.41 }));
    parts.push(box(0.3, 0.025, 0.035, pal.trim, { y: 0.24, z: 0.44 }));
    return { anchors, height: 0.62, w: 0.84, yard: yard(parts) };
  }

  const dims = [
    null,
    { w: 0.88, h: 0.56, roof: 0.4, win: 2 },
    { w: 1.0, h: 0.68, roof: 0.46, win: 3 },
    { w: 1.08, h: 0.98, roof: 0.5, win: 4 },
    { w: 1.14, h: 1.12, roof: 0.52, win: 5 },
    { w: 1.18, h: 1.42, roof: 0.44, win: 6 },
  ][tier];

  const bodyAsset = 'house_' + spec.tier + '_a';
  const hasBody = models.hasAsset(bodyAsset);
  if (hasBody) {
    parts.push(...meshAsset(bodyAsset, styleTint(pal.roof, pal)));
    foundation(parts, dims.w, dims.w);
  } else {
  parts.push(box(dims.w, dims.h, dims.w, pal.wall, { sheet: 'wall' }));
  foundation(parts, dims.w, dims.w);
  door(parts, pal, dims.w);
  windowsOn(parts, pal, { w: dims.w, h: dims.h, y0: dims.h * 0.42, count: dims.win });
  if (tier >= 3) windowsOn(parts, pal, { w: dims.w, h: dims.h, y0: dims.h * 0.12, count: 2 });

  }

  // Every roof is now chosen rather than tabulated. What is left of a style here is the
  // detailing under it: opus keeps its stone string course, sonnet its timber frame, and
  // the district still reads from the ground.
  const plan = planRoof(rng, style, tier, ctx.modest);
  // One batch of tiles per house, within a twelfth of the style's clay. A street of them
  // is a street of kiln loads rather than one paint tin, and it is free.
  const roofHex = shade(pal.roof, rng.range(0.94, 1.06));
  if (style === 'opus') parts.push(box(dims.w + 0.06, 0.13, dims.w + 0.06, C.stone, { y: 0, sheet: 'stone' }));
  if (!hasBody && style === 'sonnet') timberFrame(parts, dims.w, dims.h, dims.w, pal.trim);

  let top = dims.h;
  const span = dims.w + ROOF_OVERHANG;
  const rise = roofOn(parts, plan, dims, pal, roofHex, top);
  const surface = surfaceOf(plan, span, rise);
  top += rise;

  // A chimney on every house from its first hut upward, and the point of it is the anchor:
  // main.js has known for a while how often a settler's chimney should puff and how far
  // away to stop bothering, and until now there was nowhere on a house to puff from.
  //
  // It stands behind the ridge and a little off the centre line - which is where a dormer
  // never is, and that is the rule this card exists to keep - and swaps to the other side
  // when the style has already built a tower into that corner. It is drawn from the eaves
  // plane up, the way a flue actually runs, and stretched so its pot clears the tiles
  // around it whatever pitch the rng just chose: a stack tall enough for a shallow roof
  // disappears into a steep one.
  const towered = style === 'fable' && tier >= 2;
  const cx = dims.w * (towered || tier === 5 ? 0.26 : -0.26);
  const cz = -dims.w * (plan.family === 'roof_cone' ? 0.26 : 0.12);
  if (models.hasAsset('addon_chimney_a')) {
    const o = { x: cx, y: dims.h, z: cz };
    o.sx = o.sz = Math.min(1.05, Math.max(0.8, dims.w / 1.08));
    o.sy = Math.max(o.sx, (surface(cx, cz) + 0.20) / assetRise('addon_chimney_a'));
    for (const g of meshAsset('addon_chimney_a', styleTint(roofHex, pal), o)) parts.push(g);
    Object.assign(anchors, meshAnchors('addon_chimney_a', o));
    top = Math.max(top, dims.h + assetRise('addon_chimney_a') * o.sy);
  } else {
    parts.push(box(0.12, 0.3, 0.12, C.brick, { x: cx, y: dims.h, z: cz }));
    anchors.smoke = [cx, dims.h + 0.3, cz];
  }

  // A dormer breaks the front pitch, which is the difference between a roof and a lid. It
  // is sized to the roof it sits in rather than given a height, because the same window
  // on a shallow roof would stand clean over the ridge.
  if (plan.dormer && models.hasAsset('addon_dormer_a')) {
    const s = Math.min(1, Math.max(0.6, rise * 1.5));
    const o = {
      x: dims.w * 0.22 * plan.dormerSide, y: top - rise + rise * 0.05, z: span * 0.20,
      sx: s, sy: s, sz: s,
    };
    for (const g of meshAsset('addon_dormer_a', styleTint(roofHex, pal), o)) parts.push(g);
  }
  // And a turret on the back corner the tower styles do not use, which is what the
  // reference's houses have instead of a second storey. Its flag only flies if nothing
  // else on the house has already claimed the one anchor main.js reads.
  if (plan.turret && models.hasAsset('addon_turret_a')) {
    const o = { x: dims.w * 0.42, z: -dims.w * 0.42 };
    o.sx = o.sz = 1;
    o.sy = Math.min(1.35, Math.max(0.75, (dims.h + 0.34) / assetRise('addon_turret_a')));
    for (const g of meshAsset('addon_turret_a', styleTint(roofHex, pal), o)) parts.push(g);
    const turretTop = assetRise('addon_turret_a') * o.sy;
    if (!anchors.flag) Object.assign(anchors, meshAnchors('addon_turret_a', o));
    top = Math.max(top, turretTop);
  }
  if (tier >= 4) {                                     // wing
    parts.push(box(0.44, dims.h * 0.72, 0.5, pal.wall, { x: dims.w * 0.62, z: -0.1, sheet: 'wall' }));
    parts.push(prismRoof(0.52, 0.58, 0.28, roofHex, { x: dims.w * 0.62, y: dims.h * 0.72, z: -0.1, ry: Math.PI / 2 }));
    // Two low fence sections leave a real opening in front of the door.
    for (const x of [-0.60, -0.27, 0.27, 0.60]) {
      parts.push(box(0.04, 0.18, 0.04, C.darkWood, { x, z: 0.62 }));
    }
    for (const x of [-0.435, 0.435]) {
      parts.push(box(0.33, 0.03, 0.03, C.darkWood, { x, y: 0.13, z: 0.62 }));
    }
  }
  if (tier === 5) {                                    // keep: corner tower + battlements
    parts.push(cylinder(0.2, 0.22, dims.h + 0.4, 8, pal.wall, { x: -dims.w * 0.42, z: -dims.w * 0.42, sheet: 'wall' }));
    parts.push(cone(0.26, 0.32, 8, roofHex, { x: -dims.w * 0.42, y: dims.h + 0.4, z: -dims.w * 0.42, sheet: 'roof' }));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push(box(0.1, 0.1, 0.1, pal.wall, { x: Math.cos(a) * dims.w * 0.42, y: dims.h, z: Math.sin(a) * dims.w * 0.42 }));
    }
    anchors.flag = [0, top + 0.34, 0];
    parts.push(box(0.025, 0.4, 0.025, C.darkWood, { y: top }));
  }

  // Fable builds upward: an observatory tower with a copper dome and a telescope.
  if (style === 'fable' && tier >= 2) {
    const tx = -dims.w * 0.36, tz = -dims.w * 0.36, th = dims.h + 0.45 + tier * 0.06;
    parts.push(cylinder(0.21, 0.23, th, 14, pal.wall, { x: tx, z: tz, sheet: 'wall' }));
    parts.push(dome(0.25, pal.accent, { x: tx, y: th, z: tz }));
    parts.push(cone(0.05, 0.24, 6, C.copper, { x: tx, y: th + 0.2, z: tz }));
    parts.push(box(0.09, 0.12, 0.03, pal.glow, { x: tx, y: th - 0.28, z: tz + 0.22, emissive: 1 }));
    parts.push(cylinder(0.028, 0.04, 0.3, 6, C.copper, { rz: -0.6, x: tx + 0.2, y: th + 0.12, z: tz + 0.06 }));
    top = Math.max(top, th + 0.42);
  }
  return { anchors, height: top, w: dims.w, yard: yard(parts) };
}

function ornament(parts, name, pal, dims, anchors) {
  const w = dims.w;
  const tent = dims.tier === 0;
  switch (name) {
    case 'forge':
      if (tent) {   // no chimney on a tent: a brazier on the ground instead
        parts.push(cylinder(0.1, 0.13, 0.14, 7, C.brick, { x: -0.46, z: -0.4 }));
        parts.push(cylinder(0.09, 0.09, 0.03, 7, 0x3a2a22, { x: -0.46, y: 0.14, z: -0.4 }));
        anchors.smoke = [-0.46, 0.2, -0.4];
      } else {
        parts.push(box(0.15, 0.5, 0.15, C.brick, { x: -w * 0.34, y: dims.height * 0.55, z: -w * 0.34 }));
        anchors.smoke = [-w * 0.34, dims.height * 0.55 + 0.5, -w * 0.34];
      }
      break;
    case 'lumber': {
      const s = tent ? 0.72 : 1;
      for (let i = 0; i < 3; i++) parts.push(box(0.3 * s, 0.055, 0.1 * s, C.plank, { x: 0.44, y: 0.02 + i * 0.06, z: 0.42 - i * 0.02, ry: 0.2 }));
      parts.push(box(0.028, 0.17, 0.028, C.darkWood, { x: 0.34, z: 0.62, rz: 0.32 }));
      parts.push(box(0.028, 0.17, 0.028, C.darkWood, { x: 0.55, z: 0.62, rz: -0.32 }));
      parts.push(box(0.24, 0.025, 0.025, C.darkWood, { x: 0.445, y: 0.16, z: 0.62 }));
      break;
    }
    case 'lantern':
      parts.push(cylinder(0.02, 0.025, 0.5, 5, C.darkWood, { x: -0.46, z: 0.46 }));
      parts.push(box(0.1, 0.12, 0.1, 0xffb347, { x: -0.46, y: 0.5, z: 0.46, emissive: 1 }));
      parts.push(box(0.13, 0.02, 0.13, C.iron, { x: -0.46, y: 0.62, z: 0.46 }));
      break;
    case 'weathervane': {
      if (tent) {   // a pennant on the tent pole
        parts.push(quad([[0, 0.5, -0.34], [0, 0.62, -0.34], [0.26, 0.55, -0.34]], pal.trim, {}));
        break;
      }
      const y = dims.height + 0.04;
      parts.push(cylinder(0.012, 0.012, 0.26, 4, C.iron, { y }));
      parts.push(box(0.2, 0.02, 0.02, C.iron, { y: y + 0.24 }));
      parts.push(quad([[0.02, y + 0.16, 0], [0.02, y + 0.31, 0], [0.13, y + 0.235, 0]], C.copper, {}));
      break;
    }
    case 'pigeons': {
      const base = tent ? 0.0 : dims.height - 0.05;
      const px = tent ? 0.46 : w * 0.26, pz = tent ? 0.3 : w * 0.2;
      parts.push(cylinder(0.02, 0.024, tent ? 0.6 : 0.3, 4, C.darkWood, { x: px, y: base, z: pz }));
      const loftY = base + (tent ? 0.6 : 0.3);
      parts.push(box(0.19, 0.15, 0.15, C.wood, { x: px, y: loftY, z: pz }));
      parts.push(box(0.05, 0.05, 0.02, 0x2b2b2b, { x: px, y: loftY + 0.05, z: pz + 0.08 }));
      parts.push(sphere(0.035, 0xf4f4f4, { x: px + 0.11, y: loftY + 0.19, z: pz }));
      break;
    }
    case 'banner': {
      const y = tent ? 0.42 : dims.height - 0.04;
      parts.push(box(0.022, 0.34, 0.022, C.darkWood, { x: w * 0.36, y, z: w * 0.3 }));
      anchors.flag = [w * 0.36, y + 0.34, w * 0.3];
      break;
    }
    case 'lightningrod': {
      const y = tent ? 0.4 : dims.height;
      parts.push(cylinder(0.012, 0.012, 0.42, 4, C.iron, { x: -w * 0.3, y }));
      parts.push(sphere(0.028, C.copper, { x: -w * 0.3, y: y + 0.44 }));
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------- sheds
function shed(parts, spec, pal) {
  const t = spec.shedType || 'other';
  const anchors = {};
  if (t === 'explore') {
    parts.push(cone(0.3, 0.5, 6, C.canvas, {}));
    parts.push(box(0.03, 0.3, 0.03, C.darkWood, { x: 0.24, z: 0.1, rz: 0.28 }));
    parts.push(box(0.03, 0.3, 0.03, C.darkWood, { x: 0.32, z: -0.06, rz: -0.18 }));
    parts.push(cylinder(0.028, 0.042, 0.28, 6, C.copper, { rz: -0.55, x: 0.3, y: 0.34, z: 0.02 }));
    return { anchors, height: 0.55 };
  }
  if (t === 'plan') {
    parts.push(box(0.44, 0.3, 0.42, pal.wall, { sheet: 'wall' }));
    parts.push(box(0.1, 0.2, 0.03, pal.accent, { y: 0, z: 0.21 }));
    // a single pitch roof, clearly slanted
    const roof = prismRoof(0.54, 0.5, 0.22, pal.roof, { y: 0.3 });
    parts.push(roof);
    parts.push(box(0.5, 0.03, 0.03, pal.trim, { y: 0.3, z: 0.24 }));
    // the drawing board leaning against the wall
    const board = box(0.34, 0.32, 0.025, C.blueprint, { x: 0.28, y: 0.02, z: 0.1, ry: Math.PI / 2 });
    board.rotateZ(0);
    parts.push(board);
    parts.push(box(0.02, 0.02, 0.22, C.paper, { x: 0.295, y: 0.24, z: 0.1 }));
    parts.push(box(0.02, 0.02, 0.15, C.paper, { x: 0.295, y: 0.18, z: 0.13 }));
    parts.push(box(0.02, 0.02, 0.19, C.paper, { x: 0.295, y: 0.12, z: 0.09 }));
    return { anchors, height: 0.54 };
  }
  if (t === 'general') {
    parts.push(box(0.46, 0.32, 0.46, pal.wall, { sheet: 'wall' }));
    parts.push(prismRoof(0.54, 0.54, 0.2, pal.roof, { y: 0.32 }));
    parts.push(box(0.09, 0.1, 0.09, C.brick, { x: -0.15, y: 0.32, z: -0.15 }));
    parts.push(cylinder(0.07, 0.08, 0.12, 7, C.darkWood, { x: 0.3, z: 0.22 }));
    parts.push(box(0.17, 0.055, 0.07, C.anvil, { x: 0.3, y: 0.12, z: 0.22 }));
    return { anchors, height: 0.52 };
  }
  if (t === 'guide') {
    parts.push(box(0.44, 0.3, 0.4, pal.wall, { sheet: 'wall' }));
    parts.push(box(0.44, 0.05, 0.1, C.wood, { y: 0.3, z: 0.2 }));
    const awn = box(0.5, 0.04, 0.3, C.stripe, { y: 0.32, z: 0.28 });
    awn.rotateX(-0.3);
    parts.push(awn);
    parts.push(box(0.11, 0.03, 0.08, C.red, { y: 0.32, z: 0.16 }));
    parts.push(box(0.11, 0.03, 0.08, C.blue, { y: 0.355, z: 0.14 }));
    parts.push(box(0.11, 0.03, 0.08, C.gold, { y: 0.39, z: 0.17 }));
    return { anchors, height: 0.44 };
  }
  parts.push(box(0.42, 0.3, 0.42, C.wood));
  parts.push(prismRoof(0.5, 0.5, 0.18, C.darkWood, { y: 0.3 }));
  return { anchors, height: 0.48 };
}

// ---------------------------------------------------------------- civic
// Two boards stand on the square and they are the same piece of furniture in different
// paint: posts, a panel, a frame, a little roof and one pinned note per open card. The
// sprint board is cork under a plank roof; the island's own board is slate in an iron
// frame under copper, so which is which reads from across the green.
function noticeBoard(parts, spec, { panel, frame, roof, sign, note, pins }) {
  const W = 1.7, H = 1.0;
  parts.push(cylinder(0.06, 0.07, 1.05, 6, frame, { x: -W / 2 + 0.08, z: 0 }));
  parts.push(cylinder(0.06, 0.07, 1.05, 6, frame, { x: W / 2 - 0.08, z: 0 }));
  parts.push(box(W, H, 0.06, panel, { y: 0.62, z: 0.02 }));                     // the panel
  parts.push(box(W + 0.1, 0.07, 0.1, frame, { y: 0.58, z: 0.02 }));             // its frame
  parts.push(box(W + 0.1, 0.07, 0.1, frame, { y: 1.62, z: 0.02 }));
  parts.push(box(0.07, H + 0.14, 0.1, frame, { x: -W / 2 - 0.02, y: 0.58, z: 0.02 }));
  parts.push(box(0.07, H + 0.14, 0.1, frame, { x: W / 2 + 0.02, y: 0.58, z: 0.02 }));
  parts.push(prismRoof(W + 0.34, 0.44, 0.22, roof, { y: 1.69, z: 0.02 }));
  parts.push(box(0.62, 0.16, 0.03, sign, { y: 1.72, z: 0.2 }));                 // the sign
  // one pinned card per open issue, up to twelve, in three rows
  const cards = Math.max(1, Math.min(12, spec.cards == null ? 6 : spec.cards));
  for (let i = 0; i < cards; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const x = -0.6 + col * 0.4, y = 1.34 - row * 0.31;
    const tilt = ((i * 37) % 13 - 6) * 0.012;
    parts.push(box(0.3, 0.23, 0.012, note, { x, y, z: 0.06, rz: tilt }));
    parts.push(box(0.19, 0.018, 0.014, 0xb9b2a4, { x: x - 0.03, y: y + 0.06, z: 0.068, rz: tilt }));
    parts.push(box(0.13, 0.018, 0.014, 0xb9b2a4, { x: x - 0.06, y: y + 0.02, z: 0.068, rz: tilt }));
    parts.push(sphere(0.024, pins[i % pins.length], { x, y: y + 0.1, z: 0.078 }));
  }
  return 2.1;
}

function civic(parts, spec, rng) {
  const anchors = {};
  const animated = {};
  switch (spec.civicType) {
    case 'townhall': {
      // The tavern's plaster, oak and tile palette, with a civic cupola and facade.
      parts.push(...meshAsset('townhall'));
      Object.assign(anchors, meshAnchors('townhall'));
      return { anchors, animated, height: models.heightOf('townhall') };
    }
    case 'well':
      // Nine segments is a nonagon, and a nonagon standing on the town square next to a
      // round fountain reads as a mistake rather than as a well. Twenty-two is round at
      // every distance the island is ever looked at from, and costs a few dozen
      // triangles on one object that exists once per village.
      //
      // The drum is stacked stone, and it wears a coping that oversails it: the shadow
      // that overhang throws is what makes a low round thing read as a wall you could
      // sit on rather than as a barrel.
      parts.push(cylinder(0.3, 0.32, 0.32, 22, C.stone, { sheet: 'stone' }));
      parts.push(cylinder(0.345, 0.335, 0.07, 22, C.stone, { y: 0.32, sheet: 'stone' }));
      parts.push(cylinder(0.25, 0.25, 0.06, 22, 0x2a4a5a, { y: 0.33 + BRIM }));
      parts.push(box(0.04, 0.5, 0.04, C.darkWood, { x: -0.24, y: 0.39 }));
      parts.push(box(0.04, 0.5, 0.04, C.darkWood, { x: 0.24, y: 0.39 }));
      parts.push(prismRoof(0.62, 0.5, 0.2, C.plank, { y: 0.89, ry: Math.PI / 2, sheet: 'roof' }));
      parts.push(cylinder(0.05, 0.045, 0.09, 8, C.wood, { y: 0.65 }));
      return { anchors, animated, height: 1.13 };
    case 'watertower': {
      // The one thing in the reference illustration the island had no way of drawing: a
      // plank tank up on battered, braced legs, with a ladder up the front and a board
      // hanging under the deck. It arrives as a whole Blender asset rather than as a
      // composition, because what makes it read is forty rods of timber framing and forty
      // rods written out here would be unreadable and unmaintainable both.
      //
      // The branch below is a fallback and not a design - four posts, a drum and a lid -
      // so that a checkout with no baked set still boots and still puts one on its plot.
      if (models.hasAsset('civic_watertower')) {
        for (const g of meshAsset('civic_watertower')) parts.push(g);
        Object.assign(anchors, models.anchorsOf('civic_watertower'));
        return { anchors, animated, height: assetRise('civic_watertower') };
      }
      for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) {
        parts.push(cylinder(0.04, 0.05, 1.56, 6, C.darkWood, { x, z, sheet: 'plank' }));
      }
      parts.push(box(0.86, 0.05, 0.86, C.plank, { y: 1.56, sheet: 'plank' }));
      parts.push(cylinder(0.38, 0.38, 0.86, 12, C.wood, { y: 1.61, sheet: 'plank' }));
      parts.push(cone(0.44, 0.32, 12, C.darkWood, { y: 2.47, sheet: 'roof' }));
      anchors.sign = [0.28, 1.37, 0.68];
      return { anchors, animated, height: 2.9 };
    }
    case 'market': {
      // The seed merchant is authored as one Blender asset now: a timber shop with a
      // striped canopy, labelled drawers, open bins and sacks of stock. Keep the old
      // three-stall composition below as a fallback so an unbaked development checkout
      // can still open its market instead of leaving an empty square.
      if (models.hasAsset('civic_seed_stall')) {
        for (const g of meshAsset('civic_seed_stall')) parts.push(g);
        Object.assign(anchors, meshAnchors('civic_seed_stall'));
        return { anchors, animated, height: assetRise('civic_seed_stall') };
      }
      // Three stalls, and the point of them is that they are three different stalls. The
      // market is what the island puts up at ten settlers and it used to be four sticks, a
      // roof and two spheres, three times over - which reads as scaffolding rather than as
      // a morning on the square. Now each one has a trade: a fruiterer, a fishmonger and a
      // baker, told apart by the colour of the awning and by what is out on the counter.
      //
      // The awnings keep their own colour - they are painted canvas and the roof sheet
      // would make them tiled - and the timber takes the plank sheet, which is what the
      // deck of the bridge is drawn on.
      const STALLS = [
        { cloth: C.red, trade: 0 },
        { cloth: C.blue, trade: 1 },
        { cloth: C.gold, trade: 2 },
      ];
      const fruit = [0xe04a3a, 0xf2c53d, 0x6fb84a, 0xd96fa8];
      for (let i = 0; i < 3; i++) {
        const x = -0.74 + i * 0.74;
        const st = STALLS[i];
        group('stall', () => {
          for (const [dx, dz] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) {
            parts.push(cylinder(0.026, 0.032, 0.48, 6, C.darkWood, { x: x + dx, z: dz, sheet: 'plank' }));
          }
          // the counter: a board on a boarded front, with a crate stowed under it
          parts.push(box(0.66, 0.045, 0.36, C.plank, { x, y: 0.26, z: 0, sheet: 'plank' }));
          parts.push(box(0.64, 0.26, 0.03, C.wood, { x, y: 0, z: 0.185, sheet: 'plank' }));
          parts.push(box(0.22, 0.17, 0.17, C.wood, { x: x - 0.17, z: -0.08, sheet: 'plank' }));
          // the awning, and the scallops hanging off its front edge - little tabs with a
          // ball on the end of each, which is a valance at this size and at this distance
          parts.push(prismRoof(0.8, 0.66, 0.17, st.cloth, { x, y: 0.48, sheet: null }));
          for (let v = 0; v < 5; v++) {
            const vx = x - 0.28 + v * 0.14;
            const hue = v % 2 ? C.white : st.cloth;
            parts.push(box(0.115, 0.075, 0.022, hue, { x: vx, y: 0.405, z: 0.325 }));
            parts.push(sphere(0.031, hue, { x: vx, y: 0.405, z: 0.325 }));
          }
          // and a chalked price board leaning against the counter front
          parts.push(box(0.2, 0.15, 0.018, 0x2f3a33, { x: x + 0.2, y: 0.02, z: 0.2, rz: -0.08 }));
          parts.push(box(0.12, 0.016, 0.012, C.white, { x: x + 0.18, y: 0.12, z: 0.211 }));
          parts.push(box(0.08, 0.016, 0.012, C.white, { x: x + 0.16, y: 0.08, z: 0.211 }));

          if (st.trade === 0) {                       // the fruiterer: three open trays
            for (let b = 0; b < 3; b++) {
              const bx = x - 0.2 + b * 0.2;
              parts.push(cylinder(0.085, 0.07, 0.05, 9, C.wood, { x: bx, y: 0.305, z: -0.02, sheet: 'plank' }));
              for (let f = 0; f < 4; f++) {
                const a = (f / 4) * Math.PI * 2;
                parts.push(sphere(0.036, fruit[(b + f) % 4], { x: bx + Math.cos(a) * 0.035, y: 0.36, z: -0.02 + Math.sin(a) * 0.035 }));
              }
              parts.push(sphere(0.038, fruit[b % 4], { x: bx, y: 0.385, z: -0.02 }));
            }
          } else if (st.trade === 1) {                // the fishmonger: a slab and a catch
            parts.push(box(0.52, 0.03, 0.26, 0xbfd4d8, { x, y: 0.305, z: -0.01, sheet: null }));
            for (let fsh = 0; fsh < 3; fsh++) {
              const fx = x - 0.16 + fsh * 0.16, ry = 0.3 - fsh * 0.3;
              parts.push(sphere(0.055, 0x93a8b4, { x: fx, y: 0.35, z: -0.02 }));
              parts.push(cone(0.045, 0.09, 5, 0x93a8b4, { x: fx - 0.075, y: 0.35, z: -0.02, rz: 1.5708, ry }));
            }
            // one more hanging from the front rail, because a fishmonger always has one up
            parts.push(box(0.014, 0.1, 0.014, C.iron, { x: x + 0.24, y: 0.4, z: 0.2 }));
            parts.push(sphere(0.05, 0x93a8b4, { x: x + 0.24, y: 0.34, z: 0.2 }));
            parts.push(cone(0.042, 0.08, 5, 0x93a8b4, { x: x + 0.24, y: 0.27, z: 0.2, rx: Math.PI }));
          } else {                                    // the baker: loaves and a sack of flour
            parts.push(cylinder(0.14, 0.12, 0.055, 10, C.wood, { x: x - 0.12, y: 0.305, z: -0.02, sheet: 'plank' }));
            // Loaves are cylinders on their side with a domed end, because sphere() hands
            // back a shape already moved into place and scaling one afterwards scales its
            // distance from the origin along with it.
            for (let l = 0; l < 3; l++) {
              const lx = x - 0.17 + l * 0.05, lz = -0.05 + (l % 2) * 0.06;
              parts.push(cylinder(0.038, 0.038, 0.15, 7, 0xd2a15e, { x: lx, y: 0.37, z: lz, rz: Math.PI / 2, ry: 0.5 + l * 0.2 }));
            }
            parts.push(cylinder(0.075, 0.095, 0.17, 8, C.canvas, { x: x + 0.19, y: 0.305, z: -0.02 }));
            parts.push(sphere(0.06, C.canvas, { x: x + 0.19, y: 0.46, z: -0.02 }));
          }
        });
      }
      return { anchors, animated, height: 0.78 };
    }
    case 'clocktower':
      parts.push(box(0.56, 2.3, 0.56, C.stone, { sheet: 'stone' }));
      parts.push(box(0.6, 0.1, 0.6, 0x8f8a80, { y: 1.5, sheet: 'stone' }));
      parts.push(cylinder(0.17, 0.17, 0.04, 14, C.white, { y: 1.85, z: 0.29, rx: Math.PI / 2 }));
      parts.push(pyramidRoof(0.68, 0.68, 0.44, C.copper, { y: 2.3 }));
      parts.push(sphere(0.06, C.gold, { y: 2.78 }));
      for (let i = 0; i < 3; i++) parts.push(box(0.1, 0.16, 0.03, C.glass, { y: 0.5 + i * 0.45, z: 0.29, emissive: 1 }));
      animated.clock = { at: [0, 1.85, 0.32] };
      return { anchors, animated, height: 2.9 };
    case 'statue': {
      // A founder on a plinth, one arm out over the square. Bronze, so it reads warm
      // against all the grey stone around it.
      let y = 0;
      parts.push(box(0.52, 0.09, 0.52, C.foundation, { y })); y += 0.09;
      parts.push(box(0.42, 0.10, 0.42, C.stone, { y })); y += 0.10;
      parts.push(box(0.32, 0.46, 0.32, C.stone, { y }));
      parts.push(box(0.18, 0.12, 0.02, 0xcfc4a8, { y: y + 0.16, z: 0.161 }));   // the plaque
      y += 0.46;
      parts.push(box(0.38, 0.06, 0.38, C.stone, { y })); y += 0.06;
      const bronze = 0x9c7a3c;
      parts.push(box(0.05, 0.16, 0.05, bronze, { x: -0.045, y }));
      parts.push(box(0.05, 0.16, 0.05, bronze, { x: 0.045, y }));
      const hip = y + 0.14;
      parts.push(box(0.15, 0.26, 0.11, bronze, { y: hip }));
      parts.push(box(0.19, 0.08, 0.13, bronze, { y: hip + 0.2 }));
      parts.push(box(0.045, 0.22, 0.045, bronze, { x: -0.11, y: hip + 0.06, rz: 0.55 }));
      parts.push(box(0.045, 0.2, 0.045, bronze, { x: 0.1, y: hip + 0.05, rz: -0.15 }));
      parts.push(sphere(0.072, bronze, { y: hip + 0.35 }));
      parts.push(cylinder(0.016, 0.02, 0.34, 5, bronze, { x: 0.13, y: hip - 0.02 }));
      return { anchors, animated, height: hip + 0.45 };
    }
    case 'lamp': {
      // The glass is emissive, so the square lights itself once the sun is down.
      let y = 0;
      parts.push(cylinder(0.11, 0.14, 0.07, 8, C.stone, { y })); y += 0.07;
      parts.push(cylinder(0.032, 0.045, 0.78, 6, C.iron, { y })); y += 0.78;
      parts.push(box(0.16, 0.02, 0.02, C.iron, { y: y - 0.14 }));
      parts.push(box(0.02, 0.02, 0.16, C.iron, { y: y - 0.14 }));
      parts.push(cylinder(0.085, 0.06, 0.03, 4, C.iron, { y, ry: Math.PI / 4 })); y += 0.03;
      parts.push(box(0.1, 0.14, 0.1, C.glass, { y, emissive: 1 })); y += 0.14;
      parts.push(cone(0.095, 0.1, 4, C.iron, { y, ry: Math.PI / 4 })); y += 0.1;
      parts.push(sphere(0.026, C.iron, { y: y + 0.02 }));
      return { anchors, animated, height: y + 0.05 };
    }
    case 'mailbox': {
      // The postbox on the town hall's pavement: a pillar box on a cast post, with the
      // slot on the side you walk up to and a flag on its right cheek.
      //
      // The flag is the whole point of it and is not drawn here. A building is one merged
      // geometry that cannot move a piece of itself, and this piece has to go up when
      // there is mail waiting - so it is published as an anchor and hung on the group as
      // its own small mesh, exactly the way the clock tower's hands are. See
      // web/js/mailflag.js, and `animated.clock` above it for the older instance of the
      // same trick.
      parts.push(cylinder(0.15, 0.17, 0.05, 8, C.foundation, { sheet: 'stone' }));        // the pad it is set in
      parts.push(cylinder(0.045, 0.055, 0.6, 8, C.iron));                                 // the post
      parts.push(box(0.36, 0.035, 0.26, C.iron, { y: 0.6 }));                             // the collar under the box
      parts.push(box(0.34, 0.16, 0.24, C.red, { y: 0.635 }));
      parts.push(box(0.34, 0.16, 0.24, C.red, { y: 0.635 + 0.16 }));                      // two courses: the seam is the door
      parts.push(cylinder(0.12, 0.12, 0.34, 12, C.red, { x: 0.17, y: 0.955, rz: Math.PI / 2 }));
      parts.push(box(0.2, 0.028, 0.02, C.iron, { y: 0.9, z: 0.121 }));                    // the slot
      parts.push(box(0.26, 0.14, 0.012, 0xc05a49, { y: 0.645, z: 0.121 }));               // the door the postman opens
      parts.push(sphere(0.022, C.gold, { x: 0.09, y: 0.715, z: 0.13 }));                  // its handle
      parts.push(box(0.16, 0.038, 0.012, C.gold, { y: 0.815, z: 0.122 }));                // the plate with nothing on it
      animated.mailflag = { at: [0.185, 0.7, 0] };
      return { anchors, animated, height: 1.08 };
    }
    case 'planter': {
      // A stone trough with something flowering in it. The colour is drawn per plant so
      // a row of them is not four copies of the same red.
      const beds = [0xd94f3d, 0xe8a13a, 0xd96fa8, 0xf2e04a, 0x9a6fd9];
      parts.push(box(0.42, 0.18, 0.28, C.stone));
      parts.push(box(0.34, 0.04, 0.2, 0x53402e, { y: 0.14 + BRIM }));
      for (let i = 0; i < 5; i++) {
        const x = -0.13 + i * 0.065, z = rng.range(-0.05, 0.05);
        const h = 0.07 + rng.range(0, 0.05);
        parts.push(cylinder(0.012, 0.014, h, 4, C.green, { x, y: 0.18, z }));
        parts.push(sphere(0.034, beds[rng.int(beds.length)], { x, y: 0.18 + h + 0.02, z }));
      }
      return { anchors, animated, height: 0.36 };
    }
    case 'bench':
      KIT.bench.build(parts, { ...KIT.bench.defaults });
      return { anchors, animated, height: 0.42 };
    case 'terrace': {
      // Two little tables with a chair either side, and one parasol between them. Three
      // things were wrong before. The pole stood on the first table's own centre, so it
      // was coaxial with that table's pedestal and came up through the top. The chairs
      // sat left and right of each table, which put the right-hand chair of one table
      // 0.06 from the left-hand chair of the other - close enough that the seats
      // intersected. And the two backs faced opposite ways.
      //
      // So the chairs now sit in front of and behind their own table, where the
      // neighbouring one cannot reach them, and the parasol stands on its own spot
      // between the two and shades both.
      for (const [tx, tz] of [[-0.24, -0.02], [0.26, 0.06]]) {
        parts.push(cylinder(0.035, 0.045, 0.2, 6, C.darkWood, { x: tx, z: tz }));
        parts.push(cylinder(0.13, 0.13, 0.025, 8, C.plank, { x: tx, y: 0.2, z: tz }));
        for (const cz of [-0.23, 0.23]) {
          for (const [lx, lz] of [[-0.032, -0.032], [0.032, -0.032], [-0.032, 0.032], [0.032, 0.032]]) {
            parts.push(box(0.014, 0.12, 0.014, C.darkWood, { x: tx + lx, z: tz + cz + lz }));
          }
          parts.push(box(0.09, 0.022, 0.09, C.plank, { x: tx, y: 0.12, z: tz + cz }));
          // the back on the outer side, so both chairs face their table
          parts.push(box(0.09, 0.12, 0.018, C.darkWood, { x: tx, y: 0.142, z: tz + cz + (cz < 0 ? -0.036 : 0.036) }));
        }
      }
      parts.push(cylinder(0.02, 0.022, 0.62, 6, C.darkWood, { x: 0.01, z: 0.02 }));
      parts.push(cone(0.32, 0.18, 8, C.red, { x: 0.01, y: 0.62, z: 0.02 }));
      parts.push(sphere(0.03, C.gold, { x: 0.01, y: 0.84, z: 0.02 }));
      return { anchors, animated, height: 0.88 };
    }
    case 'fountain': {
      // The square's centrepiece is a complete Blender asset now: a carved basin, tiered
      // bowl, copper finial and four arcing streams. Keep the compact procedural version
      // below as a boot-safe fallback for a checkout whose baked village set is stale.
      if (models.hasAsset('civic_fountain')) {
        const names = models.assetParts('civic_fountain');
        const baked = meshAsset('civic_fountain');
        for (let i = 0; i < baked.length; i++) {
          // Water has to live in its own meshes: buildBuilding merges everything in
          // `parts`, and a vertex inside that loaf can no longer ripple independently.
          if (fountainWaterPart(names[i])) baked[i].dispose();
          else parts.push(baked[i]);
        }
        animated.fountain = { at: [0, 0, 0] };
        return { anchors, animated, height: assetRise('civic_fountain') };
      }
      // An eight sided basin with a tiered column standing in it. The water sits just
      // below the rim so it catches the light instead of hiding in the shadow.
      parts.push(cylinder(0.5, 0.54, 0.1, 8, C.foundation));                  // 0.00 - 0.10
      parts.push(cylinder(0.44, 0.46, 0.28, 16, C.stone, { y: 0.1, sheet: 'stone' }));        // 0.10 - 0.38
      parts.push(cylinder(0.38, 0.38, 0.16, 8, 0x2f6f8f, { y: 0.14 + BRIM })); // the water
      parts.push(cylinder(0.48, 0.48, 0.05, 8, C.stone, { y: 0.36 }));        // the rim
      parts.push(box(0.26, 0.14, 0.26, C.stone, { y: 0.3 }));                 // 0.30 - 0.44
      parts.push(cylinder(0.09, 0.13, 0.4, 8, C.stone, { y: 0.44 }));         // 0.44 - 0.84
      parts.push(cylinder(0.26, 0.12, 0.1, 8, C.stone, { y: 0.8 }));          // the bowl
      parts.push(cylinder(0.22, 0.22, 0.03, 8, 0x2f6f8f, { y: 0.87 + BRIM }));
      parts.push(cylinder(0.05, 0.08, 0.2, 8, C.stone, { y: 0.9 }));
      parts.push(sphere(0.07, C.copper, { y: 1.15 }));
      // four jets leaning out of the bowl and back down into the basin
      for (const [ax, az, rx, rz] of [[1, 0, 0, -0.95], [-1, 0, 0, 0.95], [0, 1, 0.95, 0], [0, -1, -0.95, 0]]) {
        parts.push(cylinder(0.014, 0.022, 0.3, 5, 0x8fc4dc, { x: ax * 0.11, y: 0.84, z: az * 0.11, rx, rz }));
      }
      return { anchors, animated, height: 1.25 };
    }
    case 'flowerbed': {
      // What keeps the middle of the square until the fountain is earned. It is laid on
      // the fountain's own footprint - the same eight sided kerb on the same foundation -
      // so the day the water arrives it reads as the basin having been built in the bed
      // that was holding the place for it, rather than as one prop swapped for another.
      //
      // The middle of a plaza is the one cell you cannot leave empty. Bare, it reads as a
      // gap somebody forgot; planted, the same emptiness reads as room.
      const blooms = [0xd94f3d, 0xe8a13a, 0xd96fa8, 0xf2e04a, 0x9a6fd9];
      parts.push(cylinder(0.5, 0.54, 0.1, 8, C.foundation));                  // 0.00 - 0.10
      parts.push(cylinder(0.47, 0.48, 0.13, 8, C.stone, { y: 0.1, sheet: 'stone' }));   // the kerb
      parts.push(cylinder(0.42, 0.42, 0.04, 8, 0x53402e, { y: 0.19 + BRIM }));          // the earth
      // Three rings rather than a scatter: a bed somebody planted, not a patch of weeds.
      // The tallest stand in the middle, which is also where the column will go.
      for (const [r, n, tall] of [[0, 1, 0.2], [0.17, 5, 0.15], [0.33, 9, 0.1]]) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r * 3;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          const h = tall + rng.range(0, 0.04);
          parts.push(cylinder(0.012, 0.015, h, 4, C.green, { x, y: 0.21, z }));
          parts.push(sphere(0.038, blooms[rng.int(blooms.length)], { x, y: 0.21 + h + 0.02, z }));
        }
      }
      return { anchors, animated, height: 0.48 };
    }
    case 'tavern': {
      // Authored in assets/tavern/agentvillage-tavern.blend, facing the street (+z).
      // The existing porch, footprint, shader and editor consume ordinary parts.
      parts.push(...meshAsset('tavern'));
      for (const [name, at] of Object.entries(models.anchorsOf('tavern'))) anchors[name] = [...at];
      return { anchors, animated, height: models.heightOf('tavern') };
    }
    case 'chapel': {
      // A brick village church with a saddleback tower, modelled in
      // scripts/build-village.py. The branch below is the chapel the island drew before
      // there was a bake of it, kept for the same reason the water tower keeps its four
      // posts and a drum: a checkout that has never run Blender still boots and still has
      // somewhere to ring a bell.
      if (models.hasAsset('civic_chapel')) {
        for (const g of meshAsset('civic_chapel')) parts.push(g);
        Object.assign(anchors, models.anchorsOf('civic_chapel'));
        return { anchors, animated, height: assetRise('civic_chapel') };
      }
      // A small stone chapel: a nave running front to back, a round window over the
      // door, an apse behind, and a tower carrying the bell.
      const f = 0.1;
      parts.push(box(0.86, 0.16, 1.24, C.foundation, { y: -0.06 }));
      parts.push(box(0.78, 0.76, 1.16, C.stone, { y: f, sheet: 'stone' }));
      parts.push(prismRoof(1.28, 0.9, 0.44, C.slate, { y: 0.86, ry: Math.PI / 2 }));
      parts.push(cylinder(0.36, 0.36, 0.76, 14, C.stone, { y: f, z: 0.66, sheet: 'stone' }));
      parts.push(dome(0.37, C.slate, { y: 0.86, z: 0.66 }));
      parts.push(cylinder(0.14, 0.14, 0.05, 12, C.glass, { y: 0.66, z: -0.62, rx: Math.PI / 2, emissive: 1 }));
      parts.push(box(0.28, 0.46, 0.04, C.darkWood, { y: f, z: -0.6 }));
      for (const z of [-0.2, 0.2]) {
        for (const x of [-0.4, 0.4]) parts.push(box(0.03, 0.36, 0.13, C.glass, { x, y: f + 0.24, z, emissive: 1 }));
      }
      // the tower
      const th = 1.5;
      parts.push(box(0.44, th, 0.44, C.stone, { y: f, z: -0.74 }));
      parts.push(box(0.1, 0.24, 0.05, C.glass, { y: f + 1.0, z: -0.96, emissive: 1 }));
      parts.push(box(0.52, 0.07, 0.52, 0x8f8a80, { y: f + th, z: -0.74 }));
      parts.push(cone(0.36, 0.8, 4, C.slate, { y: f + th + 0.07, z: -0.74, ry: Math.PI / 4 }));
      parts.push(sphere(0.05, C.gold, { y: f + th + 0.92, z: -0.74 }));
      parts.push(box(0.02, 0.2, 0.02, C.gold, { y: f + th + 0.96, z: -0.74 }));
      parts.push(box(0.13, 0.02, 0.02, C.gold, { y: f + th + 1.09, z: -0.74 }));
      return { anchors, animated, height: f + th + 1.2 };
    }
    case 'tables': {
      // Two trestle tables with a round of beer and a plate of bitterballen on them,
      // modelled in scripts/build-village.py. The branch below is the pair of tables the
      // island drew before there was a bake of them, kept for the same reason the water
      // tower keeps its four posts and a drum: a checkout that has never run Blender
      // still boots and still puts something on the square.
      if (models.hasAsset('civic_tables')) {
        for (const g of meshAsset('civic_tables')) parts.push(g);
        Object.assign(anchors, models.anchorsOf('civic_tables'));
        return { anchors, animated, height: assetRise('civic_tables') };
      }
      // Two trestle tables and their benches, on the corner of the square.
      for (const [tx, tz] of [[-0.16, -0.14], [0.2, 0.2]]) {
        for (const dx of [-0.16, 0.16]) {
          parts.push(box(0.03, 0.2, 0.03, C.darkWood, { x: tx + dx, z: tz - 0.08 }));
          parts.push(box(0.03, 0.2, 0.03, C.darkWood, { x: tx + dx, z: tz + 0.08 }));
        }
        parts.push(box(0.42, 0.035, 0.24, C.plank, { x: tx, y: 0.2, z: tz }));
        for (const dz of [-0.17, 0.17]) {
          parts.push(box(0.4, 0.03, 0.08, C.plank, { x: tx, y: 0.11, z: tz + dz }));
          for (const dx of [-0.14, 0.14]) parts.push(box(0.025, 0.11, 0.025, C.darkWood, { x: tx + dx, z: tz + dz }));
        }
      }
      parts.push(cylinder(0.035, 0.045, 0.34, 6, C.darkWood, { x: 0.42, z: -0.36 }));
      parts.push(sphere(0.09, C.green, { x: 0.42, y: 0.41, z: -0.36 }));
      return { anchors, animated, height: 0.52 };
    }
    case 'school': {
      parts.push(...meshAsset('school'));
      Object.assign(anchors, meshAnchors('school'));
      return { anchors, animated, height: models.heightOf('school') };
    }
    case 'windmill':
      parts.push(cylinder(0.34, 0.48, 1.5, 14, 0xd9b98c, { sheet: 'wall' }));
      // The door has to stand proud of a tower that tapers. The wall is 0.48 out at the
      // foot and the door was a five-centimetre board centred at 0.44, so the brickwork
      // came through it and what you saw was a tower with a dark smear on it. Centred at
      // 0.48 and thicker, its face clears the widest course and its back stays buried.
      parts.push(box(0.22, 0.36, 0.07, C.darkWood, { y: 0, z: 0.48 }));
      parts.push(cylinder(0.4, 0.4, 0.05, 9, C.plank, { y: 1.12 }));
      parts.push(dome(0.38, 0x5a3c28, { y: 1.5 }));
      // The windshaft, and it has to be a real length rather than a stub. The sails turn
      // in the one plane their hub sits in, and at z 0.42 that plane cut the tower: the
      // tower is 0.48 across at the foot and 0.34 at the head, so anything below about
      // two thirds of its height is wider than the sails were standing off, and every
      // turn swept the descending sail through the brickwork. At 0.56 the plane clears
      // the widest course there is, which is also why a real mill's shaft sticks out.
      parts.push(box(0.09, 0.09, 0.44, C.darkWood, { y: 1.575, z: 0.34 }));
      animated.blades = { at: [0, 1.62, 0.56], r: 0.6 };
      return { anchors, animated, height: 2.1 };
    case 'lighthouse': {
      const bands = BEACON_BANDS;
      for (let i = 0; i < bands; i++) {
        parts.push(cylinder(0.24 - i * 0.02, 0.3 - i * 0.02, 0.55, 16, i % 2 ? C.white : C.red, { y: i * 0.55, sheet: 'wall' }));
      }
      const top = bands * 0.55;
      parts.push(cylinder(0.3, 0.3, 0.06, 12, C.iron, { y: top }));
      parts.push(cylinder(0.19, 0.19, 0.3, 8, 0xfff2b0, { y: top + 0.06, emissive: 1 }));
      parts.push(cone(0.26, 0.28, 8, C.red, { y: top + 0.36 }));
      animated.beacon = { at: [0, BEACON_RISE, 0] };   // = top + 0.2, and the only copy of it
      return { anchors, animated, height: top + 0.7 };
    }
    case 'castle': {
      parts.push(box(1.3, 1.5, 1.3, C.stone, { sheet: 'stone' }));
      for (const [x, z] of [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]]) {
        parts.push(cylinder(0.22, 0.25, 2.1, 12, C.stone, { x, z, sheet: 'stone' }));
        parts.push(cone(0.3, 0.4, 12, C.slate, { x, y: 2.1, z, sheet: 'roof' }));
      }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        parts.push(box(0.14, 0.14, 0.14, C.stone, { x: Math.cos(a) * 0.62, y: 1.5, z: Math.sin(a) * 0.62 }));
      }
      parts.push(box(0.4, 0.6, 0.1, 0x3a2a20, { z: 0.66 }));
      anchors.flag = [0.72, 2.75, -0.72];
      parts.push(box(0.025, 0.5, 0.025, C.darkWood, { x: 0.72, y: 2.5, z: -0.72 }));
      return { anchors, animated, height: 2.9 };
    }
    case 'board': {
      // The sprint board: a cork panel under a little roof, with cards pinned to it.
      const height = noticeBoard(parts, spec, {
        panel: 0x8a6a44, frame: C.darkWood, roof: C.plank, sign: C.paper, note: C.paper,
        pins: [0xd94f3d, 0x3d7ed9, 0xd9a33d, 0x6fb84a, 0x9a6fd9],
      });
      return { anchors, animated, height };
    }
    case 'issues': {
      // The island's own board: the same furniture in slate and iron under a copper
      // roof, with a lamp over it, because the work on the island itself never stops.
      const height = noticeBoard(parts, spec, {
        panel: C.slate, frame: C.iron, roof: C.copper, sign: C.white, note: C.white,
        pins: [0xd9a33d, 0xb87333, 0xf5efe0, 0xd9a33d, 0x8a8a8a],
      });
      parts.push(cylinder(0.018, 0.018, 0.16, 4, C.iron, { y: 1.95, z: 0.22 }));
      parts.push(sphere(0.05, C.glass, { y: 1.99, z: 0.22, emissive: 1 }));
      return { anchors, animated, height };
    }
    case 'office': {
      // A clerk's office: brick, a tiled roof, a lamp by the door and a board with the
      // branch chalked on it. Small, because it is a village.
      parts.push(box(0.62, 0.44, 0.5, C.brick, { y: 0, sheet: 'wall' }));
      parts.push(box(0.64, 0.06, 0.52, C.stone, { y: 0.44 }));
      parts.push(prismRoof(0.72, 0.6, 0.26, C.slate, { y: 0.5 }));
      parts.push(box(0.09, 0.2, 0.03, C.darkWood, { z: 0.26 }));                       // door
      parts.push(box(0.12, 0.13, 0.03, C.glass, { x: -0.17, y: 0.2, z: 0.26, emissive: 1 }));
      parts.push(box(0.12, 0.13, 0.03, C.glass, { x: 0.17, y: 0.2, z: 0.26, emissive: 1 }));
      parts.push(cylinder(0.02, 0.02, 0.16, 4, C.iron, { x: 0.24, y: 0.3, z: 0.28 }));  // lamp bracket
      parts.push(sphere(0.045, C.glass, { x: 0.24, y: 0.44, z: 0.28, emissive: 1 }));
      parts.push(box(0.3, 0.16, 0.02, 0x2f3a33, { x: -0.02, y: 0.24, z: 0.28 }));       // the chalk board
      parts.push(box(0.2, 0.02, 0.014, C.white, { x: -0.05, y: 0.32, z: 0.292 }));
      parts.push(box(0.12, 0.02, 0.014, C.white, { x: -0.09, y: 0.28, z: 0.292 }));
      parts.push(box(0.07, 0.24, 0.07, C.brick, { x: 0.2, y: 0.5, z: -0.12 }));         // chimney
      anchors.smoke = [0.2, 0.78, -0.12];
      return { anchors, animated, height: 0.82 };
    }
    case 'bridge': {
      // The stone at the head of the plank bridge, and the only civic on the island whose
      // building is somewhere else: the crossing itself is drawn from `layout.bridges` by
      // `buildBridgeGeometry` further down this file, because a deck stands over water and
      // has no plot to be drawn on. What stands here is the record of it - a squared
      // waymarker on the bank where the road meets the planks, which is what a milestone
      // needs in order to have a dossier, a date and somewhere to send the camera.
      //
      // Deliberately small and deliberately not a building. A shelter, a toll house or a
      // keeper's hut would all read as something the village staffed, and nobody staffs
      // this; a waymarker reads as what it is, which is a date carved where you cross.
      let y = 0;
      parts.push(box(0.34, 0.06, 0.34, C.foundation, { y })); y += 0.06;
      parts.push(box(0.24, 0.50, 0.24, C.stone, { y, sheet: 'stone' })); y += 0.50;
      // The bronze plate faces +z, which is the front of every model on the island, and
      // lib/layout.mjs turns the stone to look at the bridge head - so the plate is
      // towards whoever is about to cross rather than out into the field behind it.
      parts.push(box(0.15, 0.18, 0.018, 0x9c7a3c, { y: y - 0.34, z: 0.129 }));
      parts.push(box(0.30, 0.05, 0.30, C.stone, { y, sheet: 'stone' })); y += 0.05;
      parts.push(pyramidRoof(0.30, 0.30, 0.09, C.stone, { y, sheet: 'stone' }));
      return { anchors, animated, height: y + 0.09 };
    }
    case 'poldermill':
      parts.push(cylinder(0.3, 0.42, 1.2, 14, 0xd9b98c, { sheet: 'wall' }));
      parts.push(dome(0.34, 0x5a3c28, { y: 1.2 }));
      animated.blades = { at: [0, 1.3, 0.38], r: 0.5 };
      return { anchors, animated, height: 1.8 };
    case 'crane': {
      // The harbour crane on the quayside, reaching out over the water. Every civic on
      // this island faces the town; this one faces the sea, which lib/layout.mjs arranges
      // by handing the plot the water beside it to look at instead of the town centre -
      // so here the jib simply reaches out along +z, the way every model on the island is
      // drawn facing, and the crate is over water wherever the plot ended up.
      //
      // A timber derrick rather than the treadwheel crane it would have been in life: a
      // wheelhouse is a building, and this stands on a single cell of quayside with the
      // planks alongside it. What has to read at fifty metres is a mast, an arm out over
      // the water and something hanging off it, so those are what it is made of and the
      // rest is the rigging that explains them.
      //
      // Everything here lies in the crane's own yz-plane, so one rotation about x places
      // a timber between two points - which is what `spar` is, and why it needs no second
      // angle. atan2 is safe in this file (it is not under shared/); the arithmetic is
      // the endpoints rather than the angles because the endpoints are what a drawing of
      // a crane is about, and an angle written out as a literal is a number nobody can
      // check against the shape.
      const spar = (a, b, t, hex, o = {}) => {
        const dy = b[1] - a[1], dz = b[2] - a[2];
        return box(t, Math.hypot(dy, dz), t, hex, { ...o, x: a[0], y: a[1], z: a[2], rx: Math.atan2(dz, dy) });
      };
      const HEAD = 1.78;                  // the top of the mast
      const TIP = [0, 1.30, 1.04];        // and the end of the jib, out over the water

      parts.push(box(0.56, 0.09, 0.56, C.stone, { sheet: 'stone' }));                 // the pad
      parts.push(cylinder(0.26, 0.30, 0.13, 8, C.darkWood, { y: 0.09, sheet: 'plank' }));  // the ring it turns on
      parts.push(cylinder(0.055, 0.085, HEAD - 0.22, 8, C.wood, { y: 0.22, sheet: 'plank' }));
      // A collar under the cap. Without it the eight-sided cone sits straight on the
      // eight-sided mast and the two read as one tapered spike a storey and a half tall -
      // a spear stuck in the quay rather than a mast with a hat on. The break is what
      // says where the timber stops.
      parts.push(cylinder(0.115, 0.115, 0.045, 8, C.iron, { y: HEAD - 0.045 }));
      parts.push(cone(0.145, 0.12, 8, C.darkWood, { y: HEAD, sheet: 'roof' }));       // a hat, so the end grain stays dry
      parts.push(spar([0, 0.48, 0.05], TIP, 0.08, C.darkWood, { sheet: 'plank' }));   // the jib
      parts.push(spar([0, HEAD - 0.04, 0], TIP, 0.032, C.iron));                      // the chain that holds it up
      parts.push(spar([0, HEAD - 0.10, -0.02], [0, 0.11, -0.24], 0.055, C.darkWood, { sheet: 'plank' }));  // and the strut that holds it back
      parts.push(box(0.17, 0.10, 0.11, C.iron, { y: 0.44, z: 0.05 }));                // the jib's shoe

      // The winch across the foot of the mast, with a crank on the near end. It is below
      // WALK_CLEARANCE, so it is part of what stops you walking into the crane - which is
      // right: it is the part of it that is in your way.
      group('winch', () => {
        parts.push(cylinder(0.075, 0.075, 0.32, 8, C.wood, { x: -0.16, y: 0.40, z: -0.06, rz: -Math.PI / 2, sheet: 'plank' }));
        parts.push(box(0.05, 0.15, 0.05, C.iron, { x: 0.20, y: 0.39, z: -0.06 }));
        parts.push(box(0.05, 0.05, 0.13, C.darkWood, { x: 0.20, y: 0.51, z: -0.06 }));
      });

      // The load, on a rope off the jib. It hangs clear of the planks it is being swung
      // over rather than resting on them: a crane with its crate on the deck is a crate
      // beside a mast, and the whole point of the shape is the thing in the air.
      group('load', () => {
        parts.push(cylinder(0.014, 0.014, TIP[1] - 0.90, 4, C.darkWood, { y: 0.90, z: TIP[2] }));
        parts.push(box(0.08, 0.08, 0.08, C.iron, { y: 0.83, z: TIP[2] }));
        parts.push(box(0.26, 0.24, 0.26, C.wood, { y: 0.59, z: TIP[2], sheet: 'plank' }));
        parts.push(box(0.28, 0.035, 0.28, C.darkWood, { y: 0.68, z: TIP[2] }));
        parts.push(box(0.28, 0.035, 0.28, C.darkWood, { y: 0.62, z: TIP[2] }));
      });
      return { anchors, animated, height: HEAD + 0.12 };
    }
    default:
      parts.push(box(0.5, 0.4, 0.5, C.stone, { sheet: 'stone' }));
      return { anchors, animated, height: 0.5 };
  }
  void rng;
}

// ---------------------------------------------------------------- entry point
// A session that ran a dozen or more apprentices builds upward instead of filling its
// yard with sheds. One window per room, lit while that apprentice was working, and the
// session itself takes the penthouse: set back from the parapet, with a terrace on the
// roof and a light that stays on.
function tower(parts, spec, pal, rng) {
  const h = spec.hotel || { rooms: 10, floors: 2, busy: 0 };
  const floors = Math.max(2, Math.min(14, h.floors | 0));
  const FLOOR = 0.42;
  const W = 1.06;

  parts.push(box(W + 0.16, 0.14, W + 0.16, C.foundation));
  parts.push(box(W + 0.06, 0.2, W + 0.06, C.stone, { y: 0.14, sheet: 'stone' }));       // the plinth
  parts.push(box(0.3, 0.34, 0.04, C.darkWood, { y: 0.34, z: W / 2 + 0.04 }));

  // The rooms: four to a floor, one window each, and they light up after dark like
  // every other window on the island. A finished run is not a dark building; what says
  // a session is running is the scaffolding and the hammering, the same as anywhere.
  // The top floor is short if the last apprentices do not fill it, which is the only
  // thing the room count changes about the shape.
  let room = 0;
  for (let f = 0; f < floors; f++) {
    const y = 0.34 + f * FLOOR;
    parts.push(box(W, FLOOR - 0.04, W, pal.wall, { y, sheet: 'wall' }));
    parts.push(box(W + 0.04, 0.045, W + 0.04, pal.trim, { y: y + FLOOR - 0.045 }));
    for (const [dx, dz, ry] of [[0, W / 2, 0], [0, -W / 2, 0], [W / 2, 0, 1], [-W / 2, 0, 1]]) {
      if (room++ >= h.rooms) continue;
      const w = ry ? 0.03 : 0.26, d = ry ? 0.26 : 0.03;
      parts.push(box(w, 0.2, d, C.glass, { x: dx * 1.02, y: y + 0.09, z: dz * 1.02, emissive: 1 }));
    }
  }

  // the penthouse, and the parapet it stands behind
  const top = 0.34 + floors * FLOOR;
  parts.push(box(W + 0.1, 0.07, W + 0.1, pal.trim, { y: top }));
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    parts.push(box(dx ? 0.05 : W, 0.1, dz ? 0.05 : W, pal.trim, { x: dx * W / 2, y: top + 0.07, z: dz * W / 2 }));
  }
  const pw = W - 0.34;
  parts.push(box(pw, 0.34, pw, pal.wall, { y: top + 0.07, sheet: 'wall' }));
  for (const [dx, dz, ry] of [[0, 1, 0], [1, 0, 1], [-1, 0, 1]]) {
    parts.push(box(ry ? 0.03 : pw - 0.12, 0.19, ry ? pw - 0.12 : 0.03, C.glass, { x: dx * pw / 2, y: top + 0.14, z: dz * pw / 2, emissive: 1 }));
  }
  parts.push(pyramidRoof(pw + 0.22, pw + 0.22, 0.24, pal.roof, { y: top + 0.41 }));
  parts.push(cylinder(0.02, 0.02, 0.34, 5, C.iron, { y: top + 0.65 }));
  parts.push(sphere(0.05, C.gold, { y: top + 1.02 }));
  // a chair and a table out on the roof terrace, because someone lives up here
  parts.push(cylinder(0.02, 0.026, 0.1, 6, C.darkWood, { x: 0.3, y: top + 0.07, z: 0.28 }));
  parts.push(cylinder(0.08, 0.08, 0.02, 8, C.plank, { x: 0.3, y: top + 0.17, z: 0.28 }));

  const anchors = { flag: [0, top + 0.72, 0], roof: [0, top + 0.41, 0] };
  void rng;
  return { anchors, height: top + 1.0, w: W };
}

// ---------------------------------------------------------------- footprints
// What actually stops you walking. This used to be a circle around the widest part of
// the whole bounding box, which turned a row of market stalls into a fat bollard and
// left half the town square impassable. Instead: take every part low enough to bump
// into, keep its rectangle, and glue rectangles together when the gap between them is
// too narrow to walk through anyway. Anything above head height -- a roof overhang, a
// bell tower, a parasol -- does not block at all, because you walk under it.
export const WALK_CLEARANCE = 0.55;   // a settler stands about this tall
export const WALK_BODY_R = 0.16;      // and is about this wide, with a little skin
const WALK_GAP = 0.36;                // a gap narrower than this is not a gap

function partRect(g, clearance) {
  const p = g.attributes.position;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > clearance) continue;
    const x = p.getX(i), z = p.getZ(i);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
    n++;
  }
  return n ? { x0, x1, z0, z1 } : null;
}

// Greedy: a rectangle swallows every rectangle it already touches, and keeps swallowing
// until nothing is close enough, so the order the parts were built in does not matter.
function mergeRects(rects, gap) {
  const out = [];
  for (const r of rects) {
    let cur = r;
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < out.length; i++) {
        const o = out[i];
        if (cur.x0 - gap > o.x1 || o.x0 - gap > cur.x1) continue;
        if (cur.z0 - gap > o.z1 || o.z0 - gap > cur.z1) continue;
        cur = {
          x0: Math.min(cur.x0, o.x0), x1: Math.max(cur.x1, o.x1),
          z0: Math.min(cur.z0, o.z0), z1: Math.max(cur.z1, o.z1),
        };
        out.splice(i, 1);
        again = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

// The solid rectangles of a shape, in its own frame, as centre plus half extents.
export function footprintOf(parts, clearance = WALK_CLEARANCE) {
  const rects = [];
  for (const g of parts) {
    if (!g) continue;
    const r = partRect(g, clearance);
    if (r) rects.push(r);
  }
  return mergeRects(rects, WALK_GAP).map((r) => ({
    x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2,
    hx: (r.x1 - r.x0) / 2, hz: (r.z1 - r.z0) / 2,
  }));
}

function scaleSolids(solids, s) {
  return solids.map((r) => ({ x: r.x * s, z: r.z * s, hx: r.hx * s, hz: r.hz * s }));
}

// ---------------------------------------------------------------- the porch
// main.js sets a building down at the height of the middle of its plot and leaves it
// there. The plots are chosen for flat ground, but flat is a comparison and not a
// promise: measured over the island as it stands, the terrain under a building wanders
// by about 0.11 from end to end in the median case and by 0.29 at the ninetieth
// percentile, and the worst plot on the island moves 0.8. Half of that is above the
// middle and half below, so a house has one corner in the air and the opposite one in
// the grass - and a tent, which is 0.58 tall in total, can lose a third of itself.
//
// The other way out was to flatten the ground under each plot, and that was turned
// down: the island is hilly and should look it. So every building gets something to
// stand on instead. A step, wide enough to show past the walls all the way round - the
// showing is the point, it is what tells you the building is standing on something
// rather than growing out of the lawn - and with a skirt that reaches well below the
// ground so the downhill side never opens a gap you can see under.
const PORCH_RISE = 0.18;      // how far the building is lifted, and how tall the step reads
const PORCH_OVER = 0.12;      // how far it shows past the widest thing standing on it
const PORCH_TREAD = 0.11;     // and how much wider again the lower of its two courses is
const PORCH_SKIRT = 0.7;      // how far it reaches down; only ever seen on the downhill side
const PORCH_R = 0.14;         // corner radius: nothing on this island has a sharp corner
const PORCH_UPTO = 0.45;      // above this a part is a roof or a chimney, not a footprint
// Street furniture is not a building and a bench on a plinth is a monument. The boards
// stand on their own posts, the statue has a plinth already, and the well and the
// fountain are round - a square step under either would be the corner the well just
// stopped having.
const NO_PORCH = new Set(['bench', 'lamp', 'planter', 'terrace', 'tables', 'board', 'issues', 'statue', 'well', 'fountain',
  // The postbox stands in a stone pad of its own, on paving somebody already laid. A step
  // round it would be a plinth under a letter box.
  'mailbox',
  // The water tower came with four stone pads of its own and stands on open grass between
  // them. A step round the outside of that would be a plinth under a thing on stilts.
  'watertower',
  // The bridge stone has a footing course of its own and stands on the bank beside a
  // country road. A paved step round it would be a doorstep to a stone.
  'bridge']);
function wantsPorch(spec) {
  if (spec.harbour) return false;                 // it stands on its own stilts, over water
  if (spec.kind === 'civic') return !NO_PORCH.has(spec.civicType);
  return true;
}
// How far the step shows past what stands on it. The two numbers above were measured
// against a house 1.26 across, where 0.23 all round reads as a step. An apprentice's shed
// is 0.76 across and the same 0.23 made a terrace of it: the shed came out on a 1.00
// plinth, one whole grid cell edge to edge, so a yard with three apprentices had stone
// touching stone in every direction. A shed keeps the skirt - that is the half of the
// porch which stops the downhill side opening a gap you can see under - and gives up the
// tread it has no room for, because it does not stand on a plot of its own.
// The church is the third case, and it is the shed's for a different reason. It is long -
// nave, tower and a great buttress in front of them - and it needs the skirt badly: the
// buttress has no footing of its own, so the step is the only thing between its foot and
// whatever the ground does at the front of the lot. But 0.23 of tread all round is 0.46
// off the length it may be, and on a three cell lot that is the difference between a
// church and a chapel of ease. So it takes the step at exactly its own footprint: the
// skirt that holds the ground, and not a hand's width more.
const porchOverhang = (spec) => (spec.kind === 'shed' || spec.civicType === 'chapel' ? [0, 0]
  : spec.civicType === 'tavern' ? [0.06, 0.08] : [PORCH_OVER, PORCH_TREAD]);

// The widest a shape reaches from its own centre, at any height. Head height is the line
// that matters for walking into something, and a shed is knee high: all of it is down in
// the yard, so all of it has to fit in the yard.
function reachOf(parts) {
  let r = 0;
  for (const g of parts) {
    if (!g) continue;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const d = Math.max(Math.abs(p.getX(i)), Math.abs(p.getZ(i)));
      if (d > r) r = d;
    }
  }
  return r;
}
// What a shed may take of its yard cell, across. A shed has no plot: lib/layout.mjs gives
// it one cell of its master's 3x3, and the room actually left on that cell is the cell
// less what the master's house already reaches over it. Measured on this island: a house
// tier reaches 0.86 from the middle of its plot and the plot edge is 1.50 out, so the
// border an apprentice stands in is 0.64 wide. The sheds were being drawn 1.00 to 1.15
// across, which is why 37 of 39 of them in the yards with more than one apprentice had
// their master's doorstep drawn through them. Fitting the shed to the border instead
// leaves grass on both sides of it, and leaves it somewhere to be pushed to - see
// yardNudge in main.js.
const SHED_SPAN = 0.58;
// And how far out a thing standing in the yard may reach - a cart, a crate, a woodpile.
// The plot edge is 1.50 out and the lane is the cell beyond it, so this leaves a hand's
// width of grass inside the boundary, and enough of it that the four per cent a house may
// be scaled up by (see `s` in buildBuilding) cannot push a cart into the road. It is the
// third number on the same 3x3: a house reaches 1.15, a shed gets SHED_SPAN of a corner
// cell, and the yard has what is left. Nothing is placed by it alone - see yardOn().
const YARD_REACH = 1.40;

// Everything low enough to be part of the footprint, as one rectangle. One rectangle and
// not the walkable ones footprintOf() finds: a porch is a floor, and a floor with a
// notch cut out of it where the barrels stand is not a floor.
function groundRect(parts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const g of parts) {
    if (!g) continue;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > PORCH_UPTO) continue;
      const x = p.getX(i), z = p.getZ(i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
  }
  return Number.isFinite(x0) ? { x0, x1, z0, z1 } : null;
}

// Most of the island builds its front on local +z: the town hall, the market, the clock
// tower, the castle and the office all put their door there, and the layout's rot is
// written expecting exactly that. The old chapel does not
// grew their doors on -z. The Blender tavern now faces +z; the remaining pair turn
// to match. Once main.js was turning buildings the way the layout actually asked, those
// three came out backwards.
//
// They are turned rather than rebuilt. Moving a door means moving everything that was
// composed around it, and a facade that was drawn as a whole is worth more than the
// satisfaction of having every case agree in the source. A half turn costs nothing: the
// footprint is measured afterwards, and it is symmetric about the centre anyway.
const BACKWARDS = new Set(['chapel']);

function turnAround(parts, anchors, animated) {
  for (const g of parts) g.rotateY(Math.PI);
  for (const k of Object.keys(anchors)) anchors[k] = [-anchors[k][0], anchors[k][1], -anchors[k][2]];
  for (const a of Object.values(animated)) if (a && a.at) a.at = [-a.at[0], a.at[1], -a.at[2]];
}

function porch(parts, anchors, animated, [over, tread] = [PORCH_OVER, PORCH_TREAD]) {
  const r = groundRect(parts);
  if (!r) return;
  for (const g of parts) lift(g, PORCH_RISE);
  for (const k of Object.keys(anchors)) anchors[k] = [anchors[k][0], anchors[k][1] + PORCH_RISE, anchors[k][2]];
  for (const a of Object.values(animated)) if (a && a.at) a.at = [a.at[0], a.at[1] + PORCH_RISE, a.at[2]];

  const x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2;
  // Two courses, not one: the lower is wider and comes up half way, so whichever side the
  // door is on there is something to step onto before the floor. One tall kerb all round
  // would have left every door on the island opening onto a drop.
  group('porch', () => {
    slab(parts, x, z, (r.x1 - r.x0) + (over + tread) * 2, (r.z1 - r.z0) + (over + tread) * 2, PORCH_SKIRT + PORCH_RISE * 0.45);
    slab(parts, x, z, (r.x1 - r.x0) + over * 2, (r.z1 - r.z0) + over * 2, PORCH_SKIRT + PORCH_RISE);
  });
}

// A rounded rectangle out of the primitives this file already has: two boxes crossed and
// a post in each corner. The cross piece and the posts stop a hair short of the top,
// because two faces on one plane is the single thing the depth buffer cannot be asked to
// decide - the same hair BRIM exists for, and far below anything the eye can see here.
function slab(parts, x, z, w, d, h) {
  const r = Math.min(PORCH_R, Math.min(w, d) / 3);
  const o = { x, y: -PORCH_SKIRT, z, sheet: 'stone' };
  parts.push(box(w, h, d - r * 2, C.stone, o));
  parts.push(box(w - r * 2, h - BRIM, d, C.stone, o));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(cylinder(r, r, h - BRIM, 7, C.stone, { ...o, x: x + sx * (w / 2 - r), z: z + sz * (d / 2 - r) }));
    }
  }
}

export function buildBuilding(spec, ctx = {}) {
  const pal = PALETTE[spec.style] || PALETTE.unknown;
  const rng = makeRng(hash32(spec.id));
  const parts = [];
  let anchors = {}, animated = {}, height = 1, w = 0.9, yard = [];

  if (spec.kind === 'civic') {
    const r = civic(parts, spec, rng);
    anchors = r.anchors; animated = r.animated; height = r.height; w = 1.4;
    if (BACKWARDS.has(spec.civicType)) turnAround(parts, anchors, animated);
  } else if (spec.kind === 'shed') {
    const r = shed(parts, spec, pal);
    anchors = r.anchors; height = r.height; w = 0.55;
  } else if (spec.harbour) {
    // a house on stilts over the shoreline
    const deck = 0.62;
    for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) {
      parts.push(cylinder(0.05, 0.055, deck + 0.7, 6, C.darkWood, { x, y: -0.7, z }));
    }
    parts.push(box(1.0, 0.08, 1.0, C.plank, { y: deck - 0.08 }));
    const inner = [];
    const r = houseBody(inner, { ...spec, tier: spec.tier === 'tent' ? 'hut' : spec.tier }, pal, rng, ctx);
    for (const g of inner) parts.push(lift(g, deck));
    parts.push(cylinder(0.05, 0.05, 0.36, 6, C.darkWood, { x: 0.44, y: deck, z: 0.44 }));
    parts.push(box(0.1, 0.12, 0.1, 0xffb347, { x: 0.44, y: deck + 0.36, z: 0.44, emissive: 1 }));
    anchors = r.anchors; height = deck + r.height; w = r.w;
    for (const [k, v] of Object.entries(anchors)) anchors[k] = [v[0], v[1] + deck, v[2]];
    for (const o of spec.ornaments || []) ornament(parts, o, pal, { w, height, tier: TIER_INDEX[spec.tier] ?? 1 }, anchors);
  } else if (spec.hotel) {
    const r = tower(parts, spec, pal, rng);
    anchors = r.anchors; height = r.height; w = r.w;
    for (const o of spec.ornaments || []) ornament(parts, o, pal, { w, height, tier: TIER_INDEX[spec.tier] ?? 1 }, anchors);
  } else {
    const r = houseBody(parts, spec, pal, rng, ctx);
    anchors = r.anchors; height = r.height; w = r.w; yard = r.yard || [];
    for (const o of spec.ornaments || []) ornament(parts, o, pal, { w, height, tier: TIER_INDEX[spec.tier] ?? 1 }, anchors);
  }

  // Both boards are built large for legibility and stand village sized; a house gets a
  // touch of variety so a street of identical sessions still looks hand-made.
  const boardish = spec.civicType === 'board' || spec.civicType === 'issues';
  let s = boardish ? 0.6
    : spec.kind !== 'civic' ? 0.96 + rng.next() * 0.08
      : 1;
  // A shed is fitted to the border of its master's yard rather than to its own idea of
  // how big a shed is - see SHED_SPAN. Only the two types that stand their tools outside
  // the walls are over it: the workshop's barrel and anvil and the lookout's spyglass
  // reach a third further than the hut they belong to, and it was always those that came
  // out through the master's doorstep first.
  if (spec.kind === 'shed') {
    const reach = reachOf(parts);
    if (reach > 0) s = Math.min(s, SHED_SPAN / 2 / reach);
  }
  // The footprint is measured before the scale, so head height is measured there too -
  // and before the porch, twice over. The porch is a step you walk onto rather than a
  // wall you walk into, and measuring the building where it stood before it was lifted
  // keeps every settler on the island walking the lines it already walks.
  const wallRects = footprintOf(parts, WALK_CLEARANCE / s);
  if (wantsPorch(spec)) {
    porch(parts, anchors, animated, porchOverhang(spec));
    height += PORCH_RISE;
  }
  // And the yard last of all, which is the whole reason houseBody() handed it back rather
  // than putting it in itself: porch() lifts everything already in the loaf onto its step
  // and grows the step to cover it, and a cart is neither on the step nor part of it.
  //
  // Its rectangles are kept as a list of their own as well as being walked into. Two
  // things read the footprint and they want different answers: walk mode wants everything
  // it can bump into, and the scaffold wants the walls - a builder's frame goes round the
  // house, not round the woodpile ten feet away.
  for (const g of yard) parts.push(g);
  const yardRects = yard.length ? footprintOf(yard, WALK_CLEARANCE / s) : [];

  const geometry = merge(parts);
  let walls = wallRects, solids = wallRects.concat(yardRects);
  if (s !== 1) {
    geometry.scale(s, s, s);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    walls = scaleSolids(walls, s);
    solids = scaleSolids(solids, s);
  }
  if (boardish) {
    height *= s;
    for (const k of Object.keys(anchors)) anchors[k] = anchors[k].map((v) => v * s);
  }
  // The editor asks for the pieces rather than the loaf: one geometry per primitive,
  // still in the space the code was written in, each carrying the call that made it.
  // Behind a flag, because the island builds hundreds of these and would sooner see the
  // parts collected than held onto.
  return {
    geometry, anchors, animated, height, width: w,
    bbox: geometry.boundingBox.clone(), solids, walls,
    ...(ctx.keepParts ? { parts, scale: s } : {}),
  };
}

// ---------------------------------------------------------------- extras
// The fountain's water is baked in Blender with the stone, but returned separately at
// runtime so its vertices can move. `surface` is the two filled bowls; `jets` is the four
// pairs of falling rods. Keeping those two meshes apart lets the surface ripple without
// bending a stream, and lets the streams pulse without lifting a whole basin of water.
function fountainWaterPart(name, kind = 'all') {
  if (!name || !name.startsWith('civic_fountain ')) return false;
  const jets = name.startsWith('civic_fountain water jet');
  const surface = name.endsWith('basin water') || name.endsWith('upper water');
  return kind === 'jets' ? jets : kind === 'surface' ? surface : jets || surface;
}

export function buildFountainWaterGeometry(kind = 'all') {
  if (!models.hasAsset('civic_fountain')) return new THREE.BufferGeometry();
  const names = models.assetParts('civic_fountain');
  const baked = meshAsset('civic_fountain');
  const picked = [];
  for (let i = 0; i < baked.length; i++) {
    if (fountainWaterPart(names[i], kind)) picked.push(baked[i]);
    else baked[i].dispose();
  }
  const geometry = merge(picked);
  for (const g of picked) g.dispose();
  return geometry;
}

export function buildScaffoldGeometry() {
  const parts = [];
  const h = 1;
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    parts.push(box(0.045, h, 0.045, C.plank, { x, z }));
  }
  for (const y of [h * 0.34, h * 0.72]) {
    parts.push(box(1.045, 0.035, 0.035, C.plank, { y, z: -0.5 }));
    parts.push(box(1.045, 0.035, 0.035, C.plank, { y, z: 0.5 }));
    parts.push(box(0.035, 0.035, 1.045, C.plank, { y, x: -0.5 }));
    parts.push(box(0.035, 0.035, 1.045, C.plank, { y, x: 0.5 }));
  }
  const d1 = box(0.03, 1.2, 0.03, C.plank, { x: 0, z: -0.5, rz: 0.7 });
  const d2 = box(0.03, 1.2, 0.03, C.plank, { x: 0, z: 0.5, rz: -0.7 });
  parts.push(d1, d2);
  parts.push(box(0.9, 0.03, 0.34, C.plank, { y: h * 0.56, z: 0.2 }));
  return merge(parts);
}

export function buildBoatGeometry() {
  const parts = [];
  const hull = new THREE.CylinderGeometry(0.19, 0.12, 0.8, 5);
  hull.rotateZ(Math.PI / 2);
  hull.rotateY(Math.PI / 2);
  parts.push(finish(hull, C.wood));
  parts.push(box(0.72, 0.035, 0.03, C.stripe, { y: 0.09, z: 0.15 }));
  parts.push(box(0.72, 0.035, 0.03, C.stripe, { y: 0.09, z: -0.15 }));
  parts.push(box(0.022, 0.62, 0.022, C.darkWood, { y: 0.08 }));
  parts.push(quad([[0.01, 0.16, 0], [0.01, 0.66, 0], [0.34, 0.24, 0]], C.paper, {}));
  return merge(parts);
}

export function buildCampfireGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(sphere(0.045, 0x7f7a72, { x: Math.cos(a) * 0.17, y: 0.02, z: Math.sin(a) * 0.17 }));
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const log = box(0.05, 0.26, 0.05, C.darkWood, { x: Math.cos(a) * 0.06, z: Math.sin(a) * 0.06, rz: 0.5, ry: a });
    parts.push(log);
  }
  return merge(parts);
}
export function buildFlameGeometry() {
  return merge([
    cone(0.085, 0.26, 5, 0xff8c3a, { y: 0.03, emissive: 1 }),
    cone(0.05, 0.16, 5, 0xffd23a, { y: 0.07, emissive: 1 }),
  ]);
}

export function buildBladesGeometry() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    // box() stands a shape on o.y rather than centring it there, so `y: 0.52` put the
    // foot of each arm half its own length out from the hub: four spars orbiting a gap,
    // with nothing joining them to the mill. They start at the hub and run outward.
    const arm = box(0.07, 1.05, 0.02, 0xd9c7a3, { y: 0 });
    arm.rotateZ(a);
    parts.push(arm);
    const spar = box(0.02, 1.05, 0.03, C.darkWood, { y: 0 });
    spar.rotateZ(a);
    parts.push(spar);
  }
  parts.push(cylinder(0.06, 0.06, 0.1, 8, C.darkWood, { rx: Math.PI / 2, y: 0 }));
  return merge(parts);
}

// ---------------------------------------------------------------- the quay
// How high the quay's planks ride over the sea, and how high they ride in the .blend they
// came out of. The island drops the whole dock by the difference, which is the one number
// that has to be got right about this set: every piece of it - decking, head, ramp and
// mooring post - is modelled in one frame, so one lift puts all four on the same plane and
// there is no seam anywhere along the run. See the note at the top of scripts/build-docks.py.
//
// 0.44 is a hand more clearance than DECK_MIN below, which is what a bridge over a river
// keeps. A pier stands in open water instead, where the swell is the whole sea rather than
// a channel, and 1.8 m of daylight is also what makes it read as something a boat comes
// alongside rather than as planks lying on the surface. The pier that was here before rode
// at 0.16, under the 0.09 its own waves reach: at any hour of the day the crests washed
// straight through the deck.
export const QUAY_DECK = SEA_LEVEL + 0.44;
const DOCK_DECK = 0.80;             // the plank surface over the pile feet, in the model
const DOCK_HEAD_HALF = 0.8;         // how far the wide head reaches across the run
const DOCK_POST_X = 0.4;            // and where a mooring post stands, outside the walkway

// The quay's planks: the pier the layout recorded, built out of the dock set.
//
// `cells` is the run of water cells pierCells() walked out from the shore, in order from
// the beach, and `from` is the world point the mesh will stand on - the district's own
// centre, because that is where main.js puts it.
//
// What goes where: a ramp on the shore cell behind the run, decking along it, and the wide
// head on the last cell - but only where there is water either side to take the wings,
// because the head is 1.6 across and a pier can perfectly well end in an inlet one cell
// wide. Mooring posts stand outside the walkway, in pairs down the run and at the four
// corners of the head. They carry nothing; they are what a dock is recognised by from the
// air, where the deck is one line on the water and the posts are the row of marks along it.
export function buildPierGeometry(cells, terrain, from) {
  if (!cells || !cells.length) return null;
  if (!models.hasAsset('prop_dock_deck_a')) return drawnPier(cells, terrain, from);
  const n = cells.length;
  // Which way the run goes, as a unit step over the cell grid. A pier is a straight line
  // out from one shore cell along one of the four axes, so the first two cells say it -
  // and a pier of a single cell has none to compare, so it takes its bearing from the
  // district it belongs to, which is inland of it by construction.
  let step = n > 1
    ? [Math.sign(cells[n - 1][0] - cells[0][0]), Math.sign(cells[n - 1][1] - cells[0][1])]
    : null;
  if (!step) {
    const [x, z] = terrain.cellWorld(cells[0][0], cells[0][1]);
    const [dx, dz] = [x - from[0], z - from[1]];
    step = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1];
  }
  // The set is modelled running along +z, like the fence and the bridge, so one rotation
  // turns the whole pier to face whichever way the sea is.
  const ry = Math.atan2(step[0], step[1]);
  const across = [step[1], -step[0]];
  const lift = QUAY_DECK - DOCK_DECK;

  const parts = [];
  const put = (asset, cell, along = 0, side = 0) => {
    const [x, z] = terrain.cellWorld(cell[0], cell[1]);
    parts.push(...meshAsset(asset, 0xffffff, {
      ry, y: lift,
      x: x - from[0] + step[0] * along + across[0] * side,
      z: z - from[1] + step[1] * along + across[1] * side,
    }));
  };
  const posts = (cell, along = 0, side = DOCK_POST_X) => {
    put('prop_dock_post', cell, along, side);
    put('prop_dock_post', cell, along, -side);
  };

  // The shore cell, which is not in the run: the layout records the water a pier covers
  // and the beach it leaves from is the cell behind the first of them.
  put('prop_dock_ramp', [cells[0][0] - step[0], cells[0][1] - step[1]]);

  const wide = (cell) => terrain.isWater(cell[0] + across[0], cell[1] + across[1])
    && terrain.isWater(cell[0] - across[0], cell[1] - across[1]);
  const head = wide(cells[n - 1]);
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    // Alternating bays, because four copies of one bay along a run is a corrugation. Off
    // the index rather than off a hash: a pier is a handful of cells and the point is that
    // no two neighbours match, which alternating does exactly and a hash does mostly.
    if (last && head) put('prop_dock_head', cells[i]);
    else put(i % 2 ? 'prop_dock_deck_b' : 'prop_dock_deck_a', cells[i]);
    // A pair of posts every second bay, and the run always ends in one: they mark where a
    // boat may lie, so the head - or the last bay, if the water was too narrow for one -
    // gets them at both corners.
    if (last && head) {
      for (const along of [-0.42, 0.42]) posts(cells[i], along, DOCK_HEAD_HALF + 0.1);
    } else if (last || i % 2 === 0) posts(cells[i], last ? 0.3 : 0);
  }
  return parts.length ? merge(parts) : null;
}

// What a pier was before there was a model of one, kept for a checkout where the set has
// never been baked - the same contract props.js keeps for the barrel. A slab and two pins
// per cell is not a dock, but it is plainly a pier, and it is better than a quay district
// with nothing on the water at all.
function drawnPier(cells, terrain, from) {
  const parts = [];
  for (const [gx, gz] of cells) {
    const [x, z] = terrain.cellWorld(gx, gz);
    parts.push(box(0.62, 0.07, 0.62, C.plank, { x: x - from[0], y: QUAY_DECK, z: z - from[1] }));
    parts.push(cylinder(0.04, 0.04, 0.7, 5, C.darkWood, { x: x - from[0] - 0.24, y: QUAY_DECK - 0.71, z: z - from[1] - 0.24 }));
    parts.push(cylinder(0.04, 0.04, 0.7, 5, C.darkWood, { x: x - from[0] + 0.24, y: QUAY_DECK - 0.71, z: z - from[1] + 0.24 }));
  }
  return parts.length ? merge(parts) : null;
}

// How high a rail stands over the deck, and how far a deck rides above the water when
// both its banks are at sea level. The settlers and the walk mode read the deck height
// so they cross a river rather than wade under it.
export const BRIDGE_RAIL = 0.3;
// There is one sheet of water on the island, at SEA_LEVEL, and its shader lifts the
// surface by up to WAVE (see the sea in web/js/world.js) - so a deck floored at the level
// it crosses is a deck the crests wash through, which is what the planks looked like.
// FREEBOARD is the daylight left under them at the ends of the run, where the arch below
// adds nothing. Together they come to about what a hand-placed bridge already keeps
// (`bridgeDeck` in web/js/props.js), which is the one crossing nobody complained about.
const WAVE = 0.09;
const FREEBOARD = 0.25;
export const DECK_MIN = SEA_LEVEL + WAVE + FREEBOARD;
// How far the crown of the deck rides over its two ends. A wooden footbridge humps, and
// a flat plank laid from bank to bank reads as a jetty that happens to have two ends.
const BRIDGE_ARCH = 0.34;

// Where a deck runs and how high it is along it. `cells` is the crossing the layout
// recorded, in order; the deck covers those cells and reaches a little way onto the bank
// at each end, so there is no seam where the road meets the planks. The height comes from
// the two banks alone - the ground between them is the riverbed - and ramps between them,
// which is what makes a deck meet the ground at both ends instead of standing proud of
// the lower one.
const DECK_LIP = 0.6;             // how far onto the bank each end reaches
const DECK_REACH = 8;             // and how far past the recorded run it may look for one

// The crossing as the ground under it actually is, rather than as it was written down.
// The layout measures its water on the server's own field - four metres to the lot, cut
// from the baked world - while the ground here is generated per cell from the seed, so the
// two do not agree on where the bank is. Measured on the live island: a crossing of four
// cells covers one cell of a channel four cells wide and ends over open water, which is a
// deck the river runs straight through. A deck is the one thing that cannot be a little
// out, because what is under it is a river, so the run is carried outward from both ends
// until it is on land - the question ghost.js already asks of a bridge somebody aims by
// hand: it needs a bank to land on.
function spanToBanks(cells, terrain, k) {
  const n = cells.length;
  const dir = n > 1 ? Math.sign(cells[n - 1][k] - cells[0][k]) || 1 : 1;
  const out = cells.map((c) => [...c]);
  const step = (end, sign) => { const c = [...end]; c[k] += sign; return c; };
  // `terrain.size` rather than inGrid(): the model sheet crosses a valley of its own with
  // a terrain of four functions, and this has to hold there too.
  const wet = (c) => c[0] >= 0 && c[1] >= 0 && c[0] < terrain.size && c[1] < terrain.size
    && !terrain.isLand(c[0], c[1]);
  for (let i = 0; i < DECK_REACH; i++) {
    const next = step(out[0], -dir);
    if (!wet(next)) break;
    out.unshift(next);
  }
  for (let i = 0; i < DECK_REACH; i++) {
    const next = step(out[out.length - 1], dir);
    if (!wet(next)) break;
    out.push(next);
  }
  return out;
}

function bridgeStops(cells, terrain, axis) {
  const k = axis === 'x' ? 0 : 1;                    // the coordinate the run moves along
  cells = spanToBanks(cells, terrain, k);
  const n = cells.length;
  const dir = n > 1 ? Math.sign(cells[n - 1][k] - cells[0][k]) : 1;
  const abut = (end, sign) => { const c = [...end]; c[k] += sign * dir; return c; };
  const at = (c) => terrain.cellWorld(c[0], c[1]);
  const a = at(abut(cells[0], -1)), b = at(abut(cells[n - 1], 1));
  const y0 = terrain.worldHeight(a[0], a[1]) + 0.08, y1 = terrain.worldHeight(b[0], b[1]) + 0.08;

  const centres = cells.map(at);
  const first = [...centres[0]], last = [...centres[n - 1]];
  first[k] -= DECK_LIP * dir;
  last[k] += DECK_LIP * dir;
  const world = [first, ...centres, last];
  // Height by where a stop actually is between the two banks, not by its index: the two
  // lip stops are closer to their neighbours than the cell centres are to each other.
  const t = (p) => (b[k] === a[k] ? 0 : (p[k] - a[k]) / (b[k] - a[k]));
  // And the hump. Measured from end to end of the deck itself rather than bank to bank,
  // so the arch is exactly flat where the planks meet the road - anywhere else and the
  // crossing would begin with a step. Raised cosine rather than a parabola or a sine:
  // all three peak in the middle, but only this one leaves the ends level as well as
  // at the right height, and level is the difference between walking onto a bridge and
  // climbing onto one.
  const s0 = world[0][k], s1 = world[world.length - 1][k];
  // A short crossing gets a shallower hump. Two cells over a ditch arched by the full
  // amount is not a bridge, it is a speed bump.
  const rise = BRIDGE_ARCH * Math.min(1, (n + 1) / 5);
  const arch = (p) => {
    if (s1 === s0) return 0;
    const u = Math.min(1, Math.max(0, (p[k] - s0) / (s1 - s0)));
    return rise * (0.5 - 0.5 * Math.cos(u * Math.PI * 2));
  };
  const deckYAt = (p) => Math.max(DECK_MIN, y0 + (y1 - y0) * t(p)) + arch(p);
  const deckY = (i) => deckYAt(world[i]);
  // `cells` goes back out because it is no longer the list that came in: whoever stands on
  // this deck has to be told about the part of it that was not written down.
  return { cells, world, centres, deckY, deckYAt, k };
}

// Which cell of the crossing carries its deck at what height, for standing figures on it.
// main.js keeps these in the map the settlers and walk mode read the ground from, so the
// arch is in here too: they climb it rather than walking through it.
export function bridgeDeckHeights(cells, terrain, axis) {
  if (!cells || !cells.length) return [];
  const { cells: run, deckY } = bridgeStops(cells, terrain, axis);
  return run.map((c, i) => [c[0], c[1], deckY(i + 1)]);
}

// A plank bridge: a decked arch, a post-and-rail down each side, a kerb board along each
// edge of the planking, and a trestle in the water under every cell of the crossing. The
// rail is posts and a beam rather than a solid parapet - a wall the right height for a
// settler to hold would hide the decking from every angle the island is looked at from.
export function buildBridgeGeometry(cells, terrain, from, axis) {
  if (!cells || !cells.length) return null;
  const { world, deckYAt, k } = bridgeStops(cells, terrain, axis);
  // The arch is a curve and the deck is drawn in flat pieces, so each span between two
  // stops is halved. At one piece per cell a three cell crossing comes out as a roof
  // with a ridge; at two it reads as a curve from every distance the island is seen at.
  const stops = [];
  for (let i = 0; i < world.length - 1; i++) {
    stops.push(world[i]);
    stops.push([(world[i][0] + world[i + 1][0]) / 2, (world[i][1] + world[i + 1][1]) / 2]);
  }
  stops.push(world[world.length - 1]);
  const ys = stops.map(deckYAt);
  const at = stops.map(([x, z]) => [x - from[0], z - from[1]]);
  const W = 0.44;                                    // half the deck width
  const parts = [];
  const across = (p, s) => (k === 0 ? [p[0], p[1] + s] : [p[0] + s, p[1]]);
  // The boards are laid across the run, so the grain lies across it too - which is the
  // sheet turned a quarter when the crossing runs along x.
  const deckSheet = k === 0 ? 'plankZ' : 'plank';

  for (let i = 0; i < at.length - 1; i++) {
    const p = at[i], q = at[i + 1];
    const yp = ys[i], yq = ys[i + 1];
    const pl = across(p, -W), pr = across(p, W), ql = across(q, -W), qr = across(q, W);
    parts.push(quad([[pl[0], yp, pl[1]], [pr[0], yp, pr[1]], [qr[0], yq, qr[1]], [ql[0], yq, ql[1]]], C.plank, { sheet: deckSheet }));
    for (const s of [-1, 1]) {
      const e0 = across(p, s * W), e1 = across(q, s * W);
      // A kerb standing on the edge of the planking, and the beam over it.
      parts.push(quad([
        [e0[0], yp, e0[1]], [e1[0], yq, e1[1]], [e1[0], yq + 0.075, e1[1]], [e0[0], yp + 0.075, e0[1]],
      ], C.plank, { sheet: deckSheet }));
      const t0 = yp + BRIDGE_RAIL, t1 = yq + BRIDGE_RAIL;
      parts.push(quad([
        [e0[0], t0 - 0.07, e0[1]], [e1[0], t1 - 0.07, e1[1]], [e1[0], t1, e1[1]], [e0[0], t0, e0[1]],
      ], C.darkWood, { sheet: deckSheet }));
    }
  }
  // Posts at the stops the cells gave, not at the halves the arch was drawn with: a post
  // every two metres is a railing, a post every metre is a fence.
  for (let i = 0; i < at.length; i += 2) {
    const y = ys[i];
    const inWater = i > 0 && i < at.length - 1;
    for (const s of [-1, 1]) {
      const c = across(at[i], s * (W - 0.03));
      parts.push(box(0.075, BRIDGE_RAIL, 0.075, C.darkWood, { x: c[0], y, z: c[1] }));
      parts.push(sphere(0.052, C.wood, { x: c[0], y: y + BRIDGE_RAIL + 0.02, z: c[1] }));
      if (!inWater) continue;
      const t = across(at[i], s * (W - 0.09));
      parts.push(cylinder(0.05, 0.05, y + 0.8, 6, C.darkWood, { x: t[0], y: -0.8, z: t[1], sheet: deckSheet }));
    }
  }
  return merge(parts);
}

export function buildPlaqueGeometry(hue) {
  const col = new THREE.Color().setHSL(hue / 360, 0.55, 0.55).getHex();
  return merge([
    box(0.05, 0.42, 0.05, C.darkWood, { x: -0.2 }),
    box(0.05, 0.42, 0.05, C.darkWood, { x: 0.2 }),
    box(0.52, 0.26, 0.035, 0xe6dcc2, { y: 0.26 }),
    box(0.52, 0.055, 0.045, col, { y: 0.24 }),
  ]);
}

// A flag cloth, waved in the vertex shader; one instanced mesh serves every flag.
export function createFlagMesh(count) {
  const geo = new THREE.PlaneGeometry(0.3, 0.19, 5, 2);
  geo.translate(0.15, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, flatShading: true, roughness: 0.9 });
  mat.userData.uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = mat.userData.uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(uTime * 6.0 + transformed.x * 9.0) * transformed.x * 0.6;');
  };
  mat.customProgramCacheKey = () => 'settlers-flag';
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}




