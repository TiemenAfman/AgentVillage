// The avatar you steer is the one settler on the island you get to compose yourself.
// Everyone else is dressed by their model (see PALETTE and figureGeometry); you pick
// your own skin, tunic, trim and hat here. It is kept in the browser, not on the
// island: village.json is rebuilt from transcripts every scan, so a look stored there
// would not survive - localStorage belongs to whoever is looking, which is exactly
// whose avatar this is.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SETTLER_PARTS, SETTLER_COLORS, SETTLER_EYE_Y } from './settler-mesh.js';
// The wardrobe moved to shared/ so the walk can ask how tall somebody is without
// dragging three.js into Node - see the header of shared/palette.mjs. Re-exported
// because composing an avatar is this file's subject and everyone asks here.
import { HAT_SHAPES, SWATCHES } from 'shared/palette.mjs';
export { HAT_SHAPES, SWATCHES };

const KEY = 'promptholm.avatar';

// Blender-authored figure, kept within the existing walking clearance.
export const PLAYER_SCALE = 1.12;
export const PLAYER_EYE = SETTLER_EYE_Y * PLAYER_SCALE;

// The hats are the same handful the settlers wear, freed from their styles: any of them
// can sit on any head now. 'wide' is the brim the player has always worn, which is why
// it is the one you start in.

// A curated swatch per part. Skin tones are named for materials rather than people, and
// the rest borrow the village's own palette so a settler you make still belongs here.

// The wide-brimmed, straw-hatted settler the player has always been.
export const DEFAULT_AVATAR = {
  character: 'kenney',
  skin: 0xf1c9a5, tunic: 0xf0e2c8, trim: 0x6b4a2f, hat: 0xc9a75c, hatShape: 'wide',
  // Equipment: a real on/off state (Plans/uitrusting-en-vasthouden.md), not something
  // derived from the rest of the look. The backpack defaults on, so nobody's look changes
  // until they open the Equipment section themselves; both hands default empty.
  equip: { backpack: true, leftHandItem: null, rightHandItem: null },
};

// What a hand can hold. 'parasol' is the only one so far - see Plans/
// uitrusting-en-vasthouden.md for why the beach parasol was the first thing tried, and
// classic-avatar.js's parasolGeometry() for where its shape comes from.
export const HAND_ITEMS = [{ id: 'parasol', name: 'Parasol' }];

export function normalizeAvatar(spec = {}) {
  const d = DEFAULT_AVATAR;
  const num = (v, dv) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) & 0xffffff : dv);
  const shape = HAT_SHAPES.some((h) => h.id === spec.hatShape) ? spec.hatShape : d.hatShape;
  return {
    character: spec.character === 'classic' ? 'classic' : d.character,
    skin: num(spec.skin, d.skin),
    tunic: num(spec.tunic, d.tunic),
    trim: num(spec.trim, d.trim),
    hat: num(spec.hat, d.hat),
    hatShape: shape,
    equip: {
      backpack: spec.equip?.backpack !== false,
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

// Blender meshes carry wardrobe slots instead of fixed materials. Recolouring merges
// them into the same single vertex-coloured mesh used by the studio and walk mode.
function buildFigure(spec, gear, include = null) {
  const s = normalizeAvatar(spec);
  const parts = SETTLER_PARTS.filter((p) => p.variant === 'body'
    || (gear && p.variant === 'gear') || p.variant === s.hatShape)
    .filter((part) => !include || include.has(part.name)).map((part) => {
    const g = new THREE.BufferGeometry();
    const position = new Float32Array(part.positions);
    const count = position.length / 3;
    const color = new THREE.Color(s[part.slot] ?? SETTLER_COLORS[part.slot]);
    const colors = new Float32Array(position.length);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(count), 1));
    g.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(count), 1));
    return g;
  });
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  geometry.computeVertexNormals();
  return geometry;
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
