// The inventory's table of contents: which slot owns which piece of the look, and what each
// slot draws. It is kept apart from studio.js so it can be read under Node -
// tests/inventory.test.mjs holds every equip key to exactly one slot and every swatch to
// exactly one dye button, which is how a piece added to DEFAULT_AVATAR tomorrow cannot
// quietly miss the screen. It cannot live in avatar.js either: it needs classic-avatar.js's
// part lists, and that file imports avatar.js.
import { SETTLER_PARTS } from './settler-mesh.js';
import { PLAYER_HAT_SHAPES, HAND_ITEMS, avatarPlayerComponentGeometry } from './avatar.js';
import { PIECE_PARTS, HELD_ITEM_PARTS, heldItemGeometry } from './classic-avatar.js';

const PART_SLOT = Object.fromEntries(SETTLER_PARTS.map((p) => [p.name, p.slot]));
// The four spec fields that are colours - the same four SWATCHES has rows for. Every other
// slot a part can carry (steel, brass, pack...) is fixed, so a part on one of those never
// goes stale when the wearer changes their mind.
const DYEABLE = ['skin', 'tunic', 'trim', 'hat'];

// Hat parts are baked under variant === hatShape (see buildFigure in avatar.js).
export const hatParts = (shape) => SETTLER_PARTS.filter((p) => p.variant === shape).map((p) => p.name);
// What the head slot shows with nothing on it: the head itself, so "bare-headed" reads as a
// choice made rather than a slot nobody has filled.
const HEAD_PARTS = [
  'Head', 'Hair cap', 'Face', 'Left ear', 'Right ear', 'Round nose', 'Left eye', 'Right eye',
  'Left eyebrow', 'Right eyebrow', 'Left sideburn', 'Right sideburn', 'Smile left', 'Smile right',
];
// The garment that is always worn, belt included: the tunic slot is the one slot with a
// colour and no on/off, because there is no taking it off.
const TUNIC_PARTS = ['Full tunic', 'Tunic hem', 'Belt', 'Belt buckle'];
export const NO_ITEM = { id: '', name: 'Empty' };   // short: a tile's label is one line wide

// A held item lies diagonal in its slot the way an RPG icon does, rather than standing on
// its grip: a blade drawn upright is a thin line down the middle of the well. Chosen by eye
// in the browser, Euler angles in the icon's own frame.
const ITEM_POSE = { sword: [0, 0, -0.55], hammer: [0, 0, -0.55], parasol: [0, 0, 0.45], shield: [0, -0.9, 0] };

// Left column top to bottom, then right. `equip` names a key in spec.equip, `field` a key on
// spec itself; `dye` is the SWATCHES part the slot's dye button paints; `parts` (or `ghost`,
// for a slot with nothing in it) is what the icon renders; `options` are the picker's tiles.
export const INVENTORY_SLOTS = [
  { id: 'head', side: 'left', label: 'Head', kind: 'pick', field: 'hatShape', options: PLAYER_HAT_SHAPES, dye: 'hat' },
  { id: 'chest', side: 'left', label: 'Chest', kind: 'toggle', equip: 'chestplate', parts: PIECE_PARTS.chestplate },
  { id: 'legs', side: 'left', label: 'Legs', kind: 'toggle', equip: 'leggings', parts: PIECE_PARTS.leggings },
  { id: 'lefthand', side: 'left', label: 'Left hand', kind: 'pick', equip: 'leftHandItem', options: [NO_ITEM, ...HAND_ITEMS], ghost: ['Left hand'] },
  { id: 'back', side: 'right', label: 'Back', kind: 'toggle', equip: 'backpack', parts: PIECE_PARTS.backpack },
  { id: 'tunic', side: 'right', label: 'Tunic', kind: 'dye', dye: 'tunic', parts: TUNIC_PARTS },
  { id: 'feet', side: 'right', label: 'Feet', kind: 'toggle', equip: 'boots', parts: PIECE_PARTS.boots },
  { id: 'righthand', side: 'right', label: 'Right hand', kind: 'pick', equip: 'rightHandItem', options: [NO_ITEM, ...HAND_ITEMS], ghost: ['Right hand'] },
];
// The two flasks at the foot of the alcove, where an RPG keeps its potions: the dyes that
// belong to no piece you can take off. First is drawn bottom-left, second bottom-right.
export const INVENTORY_FLASKS = [
  { id: 'skin', label: 'Skin', dye: 'skin' },
  { id: 'leather', label: 'Leather', dye: 'trim' },
];

// One tile of a slot's picker: the look of choosing `optionId` for it. An icon is either a
// list of baked parts (plus the hat shape they belong to, when they are a hat) or a hand
// item; `id` names it for the staleness key below.
export function optionIcon(slot, optionId) {
  if (slot.field === 'hatShape') {
    return optionId === 'none'
      ? { id: `${slot.id}:none`, parts: HEAD_PARTS }
      : { id: `${slot.id}:${optionId}`, parts: hatParts(optionId), shape: optionId };
  }
  if (!optionId) return { id: `${slot.id}:ghost`, parts: slot.ghost };
  return { id: `${slot.id}:${optionId}`, item: optionId, pose: ITEM_POSE[optionId] };
}

// What a slot draws right now.
export function slotIcon(slot, spec) {
  if (slot.field) return optionIcon(slot, spec[slot.field]);
  if (slot.options) return optionIcon(slot, spec.equip?.[slot.equip] || '');
  return { id: slot.id, parts: slot.parts };
}

// Which spec colours an icon's geometry actually reads - derived from the parts' own colour
// slots, so the renderer knows exactly which change makes a thumbnail stale and repaints
// nothing else. The procedural hand items (parasol, hammer) carry their own fixed colours
// and are in no part list, so they read none.
export function iconDyes(icon) {
  const parts = icon.item ? (HELD_ITEM_PARTS[icon.item] || []) : icon.parts;
  return DYEABLE.filter((d) => parts.some((name) => PART_SLOT[name] === d));
}

export function iconKey(icon, spec) {
  return `${icon.id}|${iconDyes(icon).map((d) => spec[d]).join(',')}`;
}

// The geometry with the same colours the rig would wear. A hat part only comes out of
// buildFigure when spec.hatShape names its variant, so the shape is forced onto the spec
// here: without that, a tile for a hat you are not wearing has no parts to merge at all.
export function iconGeometry(icon, spec) {
  if (icon.item) return heldItemGeometry(icon.item, spec);
  return avatarPlayerComponentGeometry(icon.shape ? { ...spec, hatShape: icon.shape } : spec, icon.parts);
}
