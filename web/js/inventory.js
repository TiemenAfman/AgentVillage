// The inventory's table of contents: which slot owns which piece of the look, and what each
// slot draws. It is kept apart from studio.js so it can be read under Node -
// tests/inventory.test.mjs holds every equip key to exactly one slot and every swatch to
// exactly one dye button, which is how a piece added to DEFAULT_AVATAR tomorrow cannot
// quietly miss the screen. It cannot live in avatar.js either: it needs classic-avatar.js's
// part lists, and that file imports avatar.js.
import { PLAYER_HAT_SHAPES, HAND_ITEMS, CHARACTERS, avatarPlayerComponentGeometry, characterOf } from './avatar.js';
import { PIECE_PARTS, HELD_ITEM_PARTS, heldItemGeometry } from './classic-avatar.js';

const SETTLER_PARTS = characterOf().parts;
// Every body's parts: the gear shares its names (and slots) across bodies, the bodies' own parts
// are named apart, so one table answers for all of them.
const PART_SLOT = Object.fromEntries(CHARACTERS.flatMap((c) => c.parts.map((p) => [p.name, p.slot])));
// The four spec fields that are colours - the same four SWATCHES has rows for. Every other
// slot a part can carry (steel, brass, pack...) is fixed, so a part on one of those never
// goes stale when the wearer changes their mind.
const DYEABLE = ['skin', 'tunic', 'trim', 'hat'];

// Hat parts are baked under variant === hatShape (see buildFigure in avatar.js).
export const hatParts = (shape) => SETTLER_PARTS.filter((p) => p.variant === shape).map((p) => p.name);
// What the head slot shows with nothing on it: the head itself, so "bare-headed" reads as a
// choice made rather than a slot nobody has filled.
const HEAD_PARTS = SETTLER_PARTS.filter((p) => p.group === 'head' && p.variant === 'body').map((p) => p.name);
// The selected traveller's whole outfit: linen shirt, fitted vest, belt and pouch.
const TUNIC_PARTS = SETTLER_PARTS.filter((p) => p.group === 'outfit' || (p.group?.endsWith('Arm') && p.slot !== 'skin')).map((p) => p.name);
// The same three lists for every other body (Plans/tweede-avonturier.md), keyed by character
// id. The Traveller's are the ones on the slots themselves (and in the tests); another body's
// pieces have other names - the Adventurer has gloves where the Traveller has bare hands.
const BODY_PARTS = Object.fromEntries(CHARACTERS.map(({ id, parts }) => {
  const body = parts.filter((p) => p.variant === 'body');
  const names = (pred) => body.filter(pred).map((p) => p.name);
  const hand = (side) => names((p) => p.group === side && /hand|thumb|glove/i.test(p.name));
  return [id, {
    head: names((p) => p.group === 'head'),
    tunic: id === 'traveller' ? TUNIC_PARTS
      : names((p) => p.group === 'outfit' || (p.group?.endsWith('Arm') && !/skin|glove/i.test(p.name))),
    lefthand: hand('leftArm'), righthand: hand('rightArm'),
    // Which colour slots any of this body's parts read: a dye nothing reads (the Adventurer's
    // skin and cloth are sampled from its texture, not dyed) is hidden while it is worn.
    dyes: new Set(parts.map((p) => p.slot)),
  }];
}));
export const dyeApplies = (dye, character) => BODY_PARTS[characterOf(character).id].dyes.has(dye);
export const NO_ITEM = { id: '', name: 'Empty' };   // short: a tile's label is one line wide

// A held item lies diagonal in its slot the way an RPG icon does, rather than standing on
// its grip: a blade drawn upright is a thin line down the middle of the well. Chosen by eye
// in the browser, Euler angles in the icon's own frame.
// A pint stands upright - it is the one item that is drawn the way it is held - turned so its
// ear shows beside the glass.
const ITEM_POSE = { sword: [0, 0, -0.55], hammer: [0, 0, -0.55], parasol: [0, 0, 0.45], torch: [0, 0, -0.55], shield: [0, -0.9, 0], beer: [0.25, -0.5, 0] };

// Left column top to bottom, then right. `equip` names a key in spec.equip, `field` a key on
// spec itself; `dye` is the SWATCHES part the slot's dye button paints; `parts` (or `ghost`,
// for a slot with nothing in it) is what the icon renders; `options` are the picker's tiles.
export const INVENTORY_SLOTS = [
  { id: 'head', side: 'left', label: 'Head', kind: 'pick', field: 'hatShape', options: PLAYER_HAT_SHAPES, dye: 'hat' },
  { id: 'chest', side: 'left', label: 'Chest', kind: 'toggle', equip: 'chestplate', parts: PIECE_PARTS.chestplate },
  { id: 'legs', side: 'left', label: 'Legs', kind: 'toggle', equip: 'leggings', parts: PIECE_PARTS.leggings },
  { id: 'lefthand', side: 'left', label: 'Left hand', kind: 'pick', equip: 'leftHandItem', options: [NO_ITEM, ...HAND_ITEMS], ghost: ['Left hand', 'Left thumb'] },
  { id: 'back', side: 'right', label: 'Back', kind: 'toggle', equip: 'backpack', parts: PIECE_PARTS.backpack },
  { id: 'tunic', side: 'right', label: 'Outfit', kind: 'dye', dye: 'tunic', parts: TUNIC_PARTS },
  { id: 'feet', side: 'right', label: 'Feet', kind: 'toggle', equip: 'boots', parts: PIECE_PARTS.boots },
  { id: 'righthand', side: 'right', label: 'Right hand', kind: 'pick', equip: 'rightHandItem', options: [NO_ITEM, ...HAND_ITEMS], ghost: ['Right hand', 'Right thumb'] },
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
// `character` is whose body the icon is drawn on; every icon of a body piece carries it in its
// id, because a hat fitted to the Adventurer is not the Traveller's hat in the same well.
export function optionIcon(slot, optionId, character) {
  const c = characterOf(character).id, own = BODY_PARTS[c];
  if (slot.field === 'hatShape') {
    return optionId === 'none'
      ? { id: `${c}:${slot.id}:none`, parts: c === 'traveller' ? HEAD_PARTS : own.head, character: c }
      : { id: `${c}:${slot.id}:${optionId}`, parts: hatParts(optionId), shape: optionId, character: c };
  }
  if (!optionId) return { id: `${c}:${slot.id}:ghost`, parts: c === 'traveller' ? slot.ghost : own[slot.id], character: c };
  return { id: `${slot.id}:${optionId}`, item: optionId, pose: ITEM_POSE[optionId] };
}

// A body's portrait for the inventory's choice of character: the bare head - the whole figure
// in a well that size was a matchstick, and a face is what tells the two apart.
export function characterIcon(character) {
  const c = characterOf(character).id;
  return { id: `character:${c}`, parts: BODY_PARTS[c].head, character: c };
}

// What a slot draws right now.
export function slotIcon(slot, spec) {
  const c = characterOf(spec.character).id;
  if (slot.field) return optionIcon(slot, spec[slot.field], c);
  if (slot.options) return optionIcon(slot, spec.equip?.[slot.equip] || '', c);
  const parts = slot.id === 'tunic' ? BODY_PARTS[c].tunic : slot.parts;
  return { id: `${c}:${slot.id}`, parts, character: c };
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
  const on = icon.character ? { ...spec, character: icon.character } : spec;
  return avatarPlayerComponentGeometry(icon.shape ? { ...on, hatShape: icon.shape } : on, icon.parts);
}
