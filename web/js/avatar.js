// The avatar you steer is the one settler on the island you get to compose yourself.
// Everyone else is dressed by their model (see PALETTE and figureGeometry); you pick
// your own skin, tunic, trim and hat here. It is kept in the browser, not on the
// island: village.json is rebuilt from transcripts every scan, so a look stored there
// would not survive - localStorage belongs to whoever is looking, which is exactly
// whose avatar this is.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SETTLER_EYE_Y } from './settler-mesh.js';
import { CHARACTERS, CHARACTER_PICKS, DEFAULT_CHARACTER, PART_COLORS, SEXES, GARMENTS, GARMENT_SETS, DEFAULT_WEAR, HAIR_STYLES, characterId, characterOf, bodyKey, drawnLook } from './player-bodies.js';
export { CHARACTERS, CHARACTER_PICKS, DEFAULT_CHARACTER, SEXES, GARMENTS, GARMENT_SETS, DEFAULT_WEAR, HAIR_STYLES, characterId, characterOf, bodyKey };
// The wardrobe moved to shared/ so the walk can ask how tall somebody is without
// dragging three.js into Node - see the header of shared/palette.mjs. Re-exported
// because composing an avatar is this file's subject and everyone asks here.
import { HAT_SHAPES, SWATCHES } from 'shared/palette.mjs';
import { liveOf } from 'shared/equipment.mjs';
export { HAT_SHAPES, SWATCHES };

const KEY = 'promptholm.avatar';

// Blender-authored figure, kept within the existing walking clearance.
export const PLAYER_SCALE = 1.12;
// The Traveller's; a body's own is eyeOf(spec).
export const PLAYER_EYE = SETTLER_EYE_Y * PLAYER_SCALE;
export const eyeOf = (spec) => characterOf(drawnLook(spec) || DEFAULT_CHARACTER).eyeY * PLAYER_SCALE;

// The hats are the same handful the settlers wear, freed from their styles: any of them
// can sit on any head now. 'wide' is the brim the player has always worn, which is why
// it is the one you start in.

// A curated swatch per part. Skin tones are named for materials rather than people, and
// the rest borrow the village's own palette so a settler you make still belongs here.

// The character editor's sliders (Plans/basislichamen-en-outfits.md, "Edit character"): each a
// number in -1..1, 0 being the body as baked. classic-avatar.js turns height, hips, head, hands and
// feet into the rig's own scale (the bones carry the clothes and the gear with them); bust and build
// are the shape itself, worked into the geometry here (shapeGeometry). Kept in the look like every
// other choice, so the sea hands them on (lib/players.mjs lookOf).
export const SHAPES = [
  { id: 'height', name: 'Height', low: 'Short', high: 'Tall' },
  { id: 'build', name: 'Build', low: 'Skinny', high: 'Heavy' },
  { id: 'hips', name: 'Hips', low: 'Narrow', high: 'Wide' },
  { id: 'bust', name: 'Bust', low: 'Flat', high: 'Full' },
  { id: 'head', name: 'Head', low: 'Small', high: 'Large' },
  { id: 'hands', name: 'Hands', low: 'Small', high: 'Large' },
  { id: 'feet', name: 'Feet', low: 'Small', high: 'Large' },
];
export const NO_SHAPE = Object.fromEntries(SHAPES.map((s) => [s.id, 0]));

// The wide-brimmed, straw-hatted settler the player has always been.
export const DEFAULT_AVATAR = {
  // Which body (web/js/player-bodies.js). A look saved before there was a choice has none, and
  // opens on the Traveller it was made on.
  character: DEFAULT_CHARACTER,
  // A Wanderer's body (player-bodies.js SEXES), or null for the body `character` names; what it
  // wears over its underwear, a set or null per garment slot (GARMENTS); and its hairstyle
  // (HAIR_STYLES, null for the body's own first). Plans/basislichamen-en-outfits.md.
  body: null, wear: DEFAULT_WEAR, hairStyle: null, shape: NO_SHAPE,
  // The hair's colour: the Traveller's own brown, which is also what every other body's hair is
  // baked against (scripts/build-bodies.py DEFAULT_HAIR), so a look that never chose one is
  // drawn as it always was.
  hair: PART_COLORS.hair,
  skin: 0xf1c9a5, tunic: 0xf0e2c8, trim: 0x6b4a2f, hat: 0xc9a75c, hatShape: 'wide',
  // Equipment: a real on/off state (Plans/uitrusting-en-vasthouden.md), not something
  // derived from the rest of the look. The backpack defaults on, so nobody's look changes
  // until they open the Equipment section themselves; every other piece defaults off.
  equip: {
    backpack: true, chestplate: false, leggings: false, boots: false,
    leftHandItem: null, rightHandItem: null,
  },
};

// What a hand can hold. 'parasol' was the first thing tried (Plans/
// uitrusting-en-vasthouden.md); 'hammer' is the tool that used to be welded to the model's
// hip as a core part and is now the same kind of held state everything else here is; 'sword'
// and 'shield' are the first purely cosmetic pair, added the same way - see classic-
// avatar.js's HELD_ITEM_GEOMETRY for where each shape comes from. 'torch' is the first one
// that does something after dark: its flame glows (GLOWING below). 'beer' is the first one
// its hand's mouse button uses instead of fighting with (Plans/DONE/bier-en-dronken.md).
const BASE_HAND_ITEMS = [
  { id: 'parasol', name: 'Parasol', icon: '⛱️' },
  { id: 'hammer', name: 'Hammer', icon: '🔨' },
  { id: 'sword', name: 'Sword', icon: '⚔️' },
  { id: 'shield', name: 'Shield', icon: '🛡️' },
  { id: 'torch', name: 'Torch', icon: '🔥' },
  { id: 'beer', name: 'Beer', icon: '🍺' },
];
// The unlockable pieces (shared/equipment.mjs) follow the ones that were always there. Only
// the 'live' ones: a planned piece is data with nothing to draw, so it must not be an id the
// look accepts. Ownership is not checked here - normalizeAvatar stays wide, see below - the
// inventory's picker is what locks a tile (studio.js, unlocks.js).
export const HAND_ITEMS = [
  ...BASE_HAND_ITEMS,
  ...liveOf('hand').map(({ id, name, icon }) => ({ id, name, icon })),
];

// The seven hat shapes plus the one the player alone can wear. A helmet replaces a hat
// rather than sitting alongside one - the same hatShape slot, one at a time - but it is
// not baked into a Blender variant the way the other seven are (see classic-avatar.js's
// helmetGeometry()), and HAT_SHAPES itself feeds CIVILIAN_HATS in shared/palette.mjs,
// which is how NPCs get a hat at all: adding 'helmet' there would hand some villager a
// hatShape no baked mesh answers to. So it stays a player-only addition on top, used only
// for the studio's picker and for validating spec.hatShape below.
export const PLAYER_HAT_SHAPES = [
  ...HAT_SHAPES, { id: 'helmet', name: 'Helmet' },
  ...liveOf('head').map(({ id, name }) => ({ id, name })),
];

export function normalizeAvatar(spec = {}) {
  const d = DEFAULT_AVATAR;
  const num = (v, dv) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) & 0xffffff : dv);
  const shape = PLAYER_HAT_SHAPES.some((h) => h.id === spec.hatShape) ? spec.hatShape : d.hatShape;
  const body = SEXES.includes(spec.body) ? spec.body : null;
  return {
    // A Wanderer says it is the Adventurer, for whoever does not know `body` (player-bodies.js).
    character: body ? 'adventurer' : characterId(spec.character),
    body,
    wear: Object.fromEntries(GARMENTS.map(({ id }) => {
      const v = spec.wear && typeof spec.wear === 'object' ? spec.wear[id] : undefined;
      return [id, v === null ? null : GARMENT_SETS.some((g) => g.id === v) ? v : DEFAULT_WEAR[id]];
    })),
    hairStyle: HAIR_STYLES.some((h) => h.id === spec.hairStyle) ? spec.hairStyle : null,
    shape: Object.fromEntries(SHAPES.map(({ id }) => {
      const v = Number(spec.shape?.[id]);
      return [id, Number.isFinite(v) ? Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100 : 0];
    })),
    hair: num(spec.hair, d.hair),
    skin: num(spec.skin, d.skin),
    tunic: num(spec.tunic, d.tunic),
    trim: num(spec.trim, d.trim),
    hat: num(spec.hat, d.hat),
    hatShape: shape,
    equip: {
      backpack: spec.equip?.backpack !== false,
      chestplate: !!spec.equip?.chestplate,
      leggings: !!spec.equip?.leggings,
      boots: !!spec.equip?.boots,
      leftHandItem: HAND_ITEMS.some((h) => h.id === spec.equip?.leftHandItem) ? spec.equip.leftHandItem : null,
      rightHandItem: HAND_ITEMS.some((h) => h.id === spec.equip?.rightHandItem) ? spec.equip.rightHandItem : null,
    },
  };
}

export function loadAvatar() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeAvatar(JSON.parse(raw));
  } catch { /* no storage, or nonsense in it: fall back to the default look */ }
  // normalizeAvatar({}), not a spread of DEFAULT_AVATAR: a shallow spread would hand back
  // DEFAULT_AVATAR's own equip object, and the studio's equip toggles mutate that object
  // rather than replacing it - a settler with no saved look yet would edit the shared
  // default for every settler after them.
  return normalizeAvatar({});
}

export function saveAvatar(spec) {
  const s = normalizeAvatar(spec);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* the look is still applied for this session */ }
  return s;
}

// Which body you are is kept the moment it is picked, not only on Wear it: the rest of the look
// is a fitting that Never mind may undo, but the body you last played is the one you expect to
// find after a restart. Only `character` changes; the saved outfit stays as it was.
// `id` is one of CHARACTER_PICKS; a Wanderer keeps the body it had last, or `body` if given.
export function saveCharacter(id, body = null) {
  const was = loadAvatar();
  if (id === 'wanderer') {
    const sex = SEXES.includes(body) ? body : (was.body || lastBody() || 'female');
    rememberBody(sex);
    return saveAvatar({ ...was, character: 'adventurer', body: sex });
  }
  return saveAvatar({ ...was, character: characterId(id), body: null });
}
// Which Wanderer you were the last time you were one, so going back to the Wanderer from another
// body does not change it. Per browser, like the look.
const BODY_KEY = 'promptholm.avatar.body';
function lastBody() {
  try { const v = localStorage.getItem(BODY_KEY); return SEXES.includes(v) ? v : null; } catch { return null; }
}
function rememberBody(body) {
  try { localStorage.setItem(BODY_KEY, body); } catch { /* the look still has it */ }
}
// Which of CHARACTER_PICKS a look is.
export const pickOf = (spec) => (SEXES.includes(spec?.body) ? 'wanderer' : characterId(spec?.character));

// The colour slots that light up at night - the torch's two flame cones, and nothing else.
const GLOWING = new Set(['flame', 'ember']);

// Blender meshes carry wardrobe slots instead of fixed materials. Recolouring merges
// them into the same single vertex-coloured mesh used by the studio and walk mode.
function buildFigure(spec, gear, include = null) {
  // A Wanderer whose body has not loaded yet is drawn as the Adventurer (player-bodies.js drawnLook).
  const s = drawnLook(normalizeAvatar(spec));
  const c = characterOf(s);
  // The garments worn (`garment:<set>-<slot>`) and the hairstyle (`hair:<id>`, the body's own first
  // when it has no such style); the skin parts list what each garment hides (`hide`).
  const worn = new Set(Object.entries(s.wear).filter(([, set]) => set).map(([slot, set]) => `${set}-${slot}`));
  const style = c.hairStyles?.includes(s.hairStyle) || s.hairStyle === 'none' ? s.hairStyle : c.hair;
  const parts = c.parts.filter((p) => p.variant === 'body' || p.variant === `hair:${style}`
    || (p.variant.startsWith('garment:') && worn.has(p.variant.slice(8)))
    || (gear && p.variant === 'gear') || p.variant === s.hatShape
    // 'held' parts (the torch) are never part of an outfit, only drawn when named.
    || (include && p.variant === 'held'))
    .filter((part) => !include || include.has(part.name)).map((part) => {
    const g = new THREE.BufferGeometry();
    // The skin an outfit covers is left out (scripts/build-bodies.py `hide`): no skin under cloth to
    // poke through it when a limb bends.
    const hidden = part.hide ? Object.keys(part.hide).filter((g) => worn.has(g)) : [];
    const keep = hidden.length ? keptTriangles(hidden.flatMap((g) => part.hide[g]), part.positions.length / 9) : null;
    const pick = (array, per) => (keep ? pickCorners(array, per, keep) : array);
    const position = new Float32Array(pick(part.positions, 3));
    const count = position.length / 3;
    const color = new THREE.Color(s[part.slot] ?? PART_COLORS[part.slot]);
    // A body sampled from a texture (the Adventurer, the Wanderer) carries its colour per corner
    // and is not dyed - unless it is a `tint` part (skin, hair), whose corners are the texture
    // over the default colour, times the colour the look asks for. Every wardrobe piece is one
    // flat slot colour.
    const colors = part.colors ? new Float32Array(pick(part.colors, 3)) : new Float32Array(position.length);
    if (!part.colors) for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    else if (part.tint) for (let i = 0; i < count * 3; i += 3) { colors[i] *= color.r; colors[i + 1] *= color.g; colors[i + 2] *= color.b; }
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    // Blender's corner normals preserve soft faces and intentional hard equipment edges.
    if (part.normals) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pick(part.normals, 3)), 3));
    else g.computeVertexNormals();
    // Four skin slots per vertex, shared by every merged piece. Static pieces stay
    // on root bone zero; each limb uses its own three-bone Blender chain.
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    const skin = part.skin && pick(part.skin, 2);
    for (let i = 0; i < count; i++) {
      indices.set([0, 1, 2, 0], i * 4);
      const bend = skin?.[i * 2] || 0, end = skin?.[i * 2 + 1] || 0;
      weights.set([Math.max(0, 1 - bend - end), bend, end, 0], i * 4);
    }
    if (part.skinIndices) indices.set(pick(part.skinIndices, 4));
    if (part.skinWeights) weights.set(pick(part.skinWeights, 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // A torch's flame is the one part of a settler that lights up after dark, through the
    // same per-vertex night mask a window uses (buildings.js) - no material of its own.
    g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(count).fill(GLOWING.has(part.slot) ? 1 : 0), 1));
    g.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(count), 1));
    return g;
  });
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  shapeGeometry(geometry, s, c);
  return geometry;
}

// Bust and build (SHAPES), in the bake's own frame, before PLAYER_SCALE. Build moves every vertex
// along its normal - the body and whatever is worn on it alike, so the clothes stay on - except the
// head, the hands and the feet, which a heavier or skinnier body keeps (and a hand pushed in on its
// own normals loses its fingers). Bust moves the front of the chest forward round a centre found on
// the body itself (bustOf), fading out to nothing, the shirt and the chestplate with it.
const BUILD_REACH = 0.0045;
const BUST_REACH = 0.55;
function shapeGeometry(g, s, c) {
  const { build = 0, bust = 0 } = s.shape || {};
  if (!build && !bust) return;
  const p = g.attributes.position, n = g.attributes.normal, ix = g.attributes.skinIndex, w = g.attributes.skinWeight;
  const b = bust ? bustOf(c) : null;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // The weights say what a vertex is: a limb's end (index 2, the hand or the foot) or a finger
    // (8..) is left alone; the head is above the neck pivot.
    const top = w.getX(i) >= w.getY(i) && w.getX(i) >= w.getZ(i) ? ix.getX(i) : w.getY(i) >= w.getZ(i) ? ix.getY(i) : ix.getZ(i);
    const extremity = (top === 2 && Math.max(w.getX(i), w.getY(i), w.getZ(i)) > .5 && y < c.rig.head[1]) || top >= 8;
    if (build && !extremity && y < c.rig.head[1]) {
      x += n.getX(i) * build * BUILD_REACH; y += n.getY(i) * build * BUILD_REACH; z += n.getZ(i) * build * BUILD_REACH;
    }
    if (b && z > b.z - b.r) {
      for (const cx of [-b.x, b.x]) {
        const d2 = ((x - cx) ** 2 + ((y - b.y) * 1.2) ** 2) / (b.r * b.r);
        if (d2 < 1) z += bust * b.r * BUST_REACH * (1 - d2) * (1 - d2) * (bust < 0 ? .6 : 1);
      }
    }
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
}
// Where a body's chest stands out furthest, either side of the middle, between the hips and the
// shoulders - worked out once per body from its own skin.
const BUSTS = new Map();
function bustOf(c) {
  if (BUSTS.has(c.id)) return BUSTS.get(c.id);
  const hip = c.rig.leftLeg[1], shoulder = c.rig.leftArm[1], L = shoulder - hip;
  let best = { z: -Infinity, x: 0, y: hip + .75 * L };
  for (const part of c.parts) {
    if (part.variant !== 'body' || part.group !== 'outfit') continue;
    const q = part.positions;
    for (let i = 0; i < q.length; i += 3) {
      const [x, y, z] = [q[i], q[i + 1], q[i + 2]];
      if (y < hip + .55 * L || y > hip + .92 * L || Math.abs(x) < .004) continue;
      if (z > best.z) best = { x: Math.abs(x), y, z };
    }
  }
  const out = { x: Math.max(best.x, Math.abs(c.rig.leftArm[0]) * .38), y: best.y, z: best.z, r: Math.abs(c.rig.leftArm[0]) * .55 };
  BUSTS.set(c.id, out);
  return out;
}

// The triangles a hide list keeps: `runs` is [from, to, from, to...] in triangles.
function keptTriangles(runs, triangles) {
  const keep = new Uint8Array(triangles).fill(1);
  for (let i = 0; i < runs.length; i += 2) keep.fill(0, runs[i], runs[i + 1]);
  return keep;
}
// `per` values a corner, three corners a triangle.
function pickCorners(array, per, keep) {
  const out = [];
  for (let t = 0; t < keep.length; t++) {
    if (!keep[t]) continue;
    for (let k = t * 3 * per; k < (t + 1) * 3 * per; k++) out.push(array[k]);
  }
  return out;
}

// Feet at zero; forward is +Z. The unscaled figure is also available without gear.
export function avatarFigureGeometry(spec) {
  return buildFigure(spec, false);
}

export function avatarPlayerGeometry(spec) {
  const geometry = buildFigure(spec, true);
  geometry.scale(PLAYER_SCALE, PLAYER_SCALE, PLAYER_SCALE);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// The ordinary avatar is merged for one draw call. Walk mode can instead ask for named
// Blender pieces and put each piece under a small pivot, giving the original character
// articulated arms and legs without changing the saved wardrobe or adding a skeleton to
// the source file.
export function avatarPlayerComponentGeometry(spec, names) {
  const geometry = buildFigure(spec, true, new Set(names));
  geometry.scale(PLAYER_SCALE, PLAYER_SCALE, PLAYER_SCALE);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
