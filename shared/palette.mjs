// What everyone on the island is made of, in numbers: the colours a model's buildings and
// people wear, the hats there are, and the swatches an avatar is composed from.
//
// It lives in shared/ for one reason, and it is not tidiness. A settler's look is hashed
// off its building id, and the *height* that comes out of that hash decides its stride -
// how far it gets per step. So the thing that decides where a body is has to be able to
// ask the thing that decides what it looks like, and after the walk moved to Node the
// wardrobe had to be reachable from there too. It used to live in web/js/buildings.js,
// which imports three.js and builds a TextureLoader the moment it is imported, so Node
// could not touch it at all.
//
// Everything here is plain data and plain arithmetic - hex integers, names, and draws from
// shared/rng.mjs - so it obeys shared/'s rule without having to try: no Math.random, no
// transcendental functions, the same numbers in both runtimes.
import { makeRng, hash32, clamp } from './rng.mjs';

// One model, one palette. A settler on the square reads as belonging to the house behind
// it because they are cut from the same cloth.
export const PALETTE = {
  fable: { wall: 0xcfc4e6, trim: 0x6e5aa8, roof: 0xb8552f, accent: 0x7a4fb0, glow: 0xffd27f, name: 'Fable' },
  opus: { wall: 0xa8a59e, trim: 0x6f6b64, roof: 0x8f4a3a, accent: 0x5a3a24, glow: 0xffcf7a, name: 'Opus' },
  sonnet: { wall: 0xf0e2c8, trim: 0x6b4a2f, roof: 0xc4623a, accent: 0x8a4b2a, glow: 0xffd88a, name: 'Sonnet' },
  haiku: { wall: 0xd9b98c, trim: 0x7d5a3a, roof: 0xd08a4a, accent: 0x5a3c28, glow: 0xffe0a0, name: 'Haiku' },
  unknown: { wall: 0x9a9a9a, trim: 0x6f6f6f, roof: 0x8a6a5a, accent: 0x555555, glow: 0xffffff, name: 'Unknown' },
};

export const SKIN = 0xf1c9a5;      // the island's first and only skin tone, now just a default
const SAILOR_HAT = 0x2b4c7e;

// Which hat a model's people wore before anyone had a choice, and where its colour came
// from in that model's palette. It is still the likeliest hat on that model's heads.
const STYLE_HAT = {
  fable: ['wizard', 'accent'],
  opus: ['cap', 'roof'],
  sonnet: ['dome', 'roof'],
  haiku: ['wide', 'roof'],
  unknown: ['band', 'trim'],
};

export const HAT_SHAPES = [
  { id: 'wide', name: 'Wide brim' },
  { id: 'band', name: 'Head band' },
  { id: 'cap', name: 'Flat cap' },
  { id: 'sailor', name: 'Sailor cap' },
  { id: 'dome', name: 'Dome' },
  { id: 'wizard', name: 'Pointed' },
  { id: 'none', name: 'Bare-headed' },
];

// A sailor's cap is a uniform, not a preference: it is how the quay reads as a quay, so it
// stays off other heads and no landsman draws it.
export const CIVILIAN_HATS = HAT_SHAPES.map((h) => h.id).filter((id) => id !== 'sailor');

export const SWATCHES = {
  skin: [
    { name: 'Porcelain', hex: 0xf6d5b8 }, { name: 'Sand', hex: 0xf1c9a5 },
    { name: 'Honey', hex: 0xe0aa7c }, { name: 'Amber', hex: 0xc68642 },
    { name: 'Umber', hex: 0xa9713b }, { name: 'Chestnut', hex: 0x8d5524 },
    { name: 'Cocoa', hex: 0x6b4326 }, { name: 'Espresso', hex: 0x4a2f1d },
  ],
  tunic: [
    { name: 'Cream', hex: 0xf0e2c8 }, { name: 'Lilac', hex: 0xcfc4e6 },
    { name: 'Ash', hex: 0xa8a59e }, { name: 'Wheat', hex: 0xd9b98c },
    { name: 'Meadow', hex: 0x6fb84a }, { name: 'Poppy', hex: 0xd94f3d },
    { name: 'Cornflower', hex: 0x3d7ed9 }, { name: 'Gold', hex: 0xd9a33d },
    { name: 'Teal', hex: 0x3aa899 }, { name: 'Plum', hex: 0x8a4b7a },
  ],
  trim: [
    { name: 'Leather', hex: 0x6b4a2f }, { name: 'Walnut', hex: 0x5a3c28 },
    { name: 'Charcoal', hex: 0x3a3a3f }, { name: 'Violet', hex: 0x6e5aa8 },
    { name: 'Navy', hex: 0x2b4c7e }, { name: 'Tan', hex: 0x7d5a3a },
    { name: 'Rust', hex: 0x8a4b2a }, { name: 'Slate', hex: 0x4c5566 },
  ],
  hat: [
    { name: 'Straw', hex: 0xc9a75c }, { name: 'Slate', hex: 0x4c5566 },
    { name: 'Copper', hex: 0xb87333 }, { name: 'Violet', hex: 0x7a4fb0 },
    { name: 'Red', hex: 0xd94f3d }, { name: 'Navy', hex: 0x2b4c7e },
    { name: 'Green', hex: 0x5c8a4a }, { name: 'White', hex: 0xf5efe0 },
    { name: 'Black', hex: 0x3a3a3f },
  ],
};

// The look every settler of a style used to have, and still the look of the figure that
// walk.js, interior.js and the model sheet ask for by style alone.
export function styleLook(style, sailor = false) {
  const pal = PALETTE[style] || PALETTE.unknown;
  const [shape, slot] = STYLE_HAT[style] || STYLE_HAT.unknown;
  return {
    skin: SKIN, tunic: pal.wall, trim: pal.trim,
    hat: sailor ? SAILOR_HAT : pal[slot],
    hatShape: sailor ? 'sailor' : shape,
    height: 1, build: 1, head: 1,
  };
}

// Cloth here is dyed in small batches: the same colour, never quite the same shade. Done
// on the bytes rather than through HSL so it is the plain arithmetic it looks like, and
// so a tunic can drift a little warm or a little cold without leaving its own colour.
function dye(hex, rng) {
  const mul = rng.range(0.86, 1.12);
  const warm = rng.range(-0.06, 0.06);
  const ch = (v, shift) => clamp(Math.round(v * mul * (1 + shift)), 0, 255);
  return (ch((hex >> 16) & 255, warm) << 16) | (ch((hex >> 8) & 255, 0) << 8) | ch(hex & 255, -warm);
}

// What one settler looks like. Everyone a model built wears that model's cloth - it is
// how a settler on the square reads as belonging to the house behind it - but trousers,
// hat, skin and build are their own, and no two bolts of the same cloth took the dye the
// same way. Everything here is hashed off one string the caller promises is the same on
// every scan: village.json is thrown away and rebuilt from the transcripts every minute,
// so a look drawn from Math.random, or from a slot number, or from anything the rebuild
// is free to reorder, would give the same person a new face every time.
//
// The draw order is load-bearing and must not be rearranged. Node and the browser both run
// this now, on the same ids, and have to arrive at the same person: one extra draw here
// and every settler in the world changes height, which changes their stride, which changes
// where they are standing.
export function settlerLook(seed, style, kind = 'adult') {
  const pal = PALETTE[style] || PALETTE.unknown;
  const base = styleLook(style, kind === 'sailor');
  const rng = makeRng(hash32(`${seed}:look`));
  const young = kind === 'apprentice';
  // Cosmetic identity has its own stream: inserting a draw into :look would change
  // everybody's height and therefore the sea's walking stride. These are fictional
  // resident designs, never genders inferred from the people behind their sessions.
  const appearance = makeRng(hash32(`${seed}:appearance`));
  const presentation = appearance.chance(0.5) ? 'woman' : 'man';
  const outfit = presentation === 'woman' && appearance.chance(0.65) ? 'skirt' : 'trousers';
  return {
    presentation, outfit,
    hatShape: kind === 'sailor' || rng.chance(0.45) ? base.hatShape : rng.pick(CIVILIAN_HATS),
    hat: kind === 'sailor' ? SAILOR_HAT : (rng.chance(0.35) ? pal.roof : rng.pick(SWATCHES.hat).hex),
    skin: rng.pick(SWATCHES.skin).hex,
    tunic: dye(pal.wall, rng),
    trim: rng.pick(SWATCHES.trim).hex,
    height: rng.range(0.9, 1.1),
    build: rng.range(0.9, 1.12),
    // An apprentice is scaled down as a whole, which would give a child an adult's head
    // in miniature. Keeping the head nearly full size is what makes small read as young
    // instead of far away.
    head: young ? rng.range(1.04, 1.16) : rng.range(0.93, 1.05),
  };
}

// Which of the three kinds of resident a plot houses, and whose palette they wear. Both
// halves of the settlers need to agree about this - the walk sizes a shed-dweller's wander
// radius by it and the wardrobe dresses them by it - so it is worked out in one place.
export function kindOf(spec) {
  return spec.kind === 'shed' ? 'apprentice' : (spec.harbour ? 'sailor' : 'adult');
}
export function styleOf(spec) {
  return PALETTE[spec.style] ? spec.style : 'unknown';
}

// ---- those who keep a building rather than a house --------------------------------
// The innkeeper stands at the tavern, the mayor at the town hall, the gold clerk at the
// gold pit, the headmistress at the school and the priest at the chapel
// (Plans/kroegbaas-en-burgemeester.md). They go by the building's own id - `civic:tavern`,
// `civic:townhall` - which is never redacted, so the roster, /api/crowd-ids and the page
// all know them already. This table is the one list of which buildings have somebody.
//
// `post` is who they are, and two flags say how they behave on the sea
// (shared/settlerwalk.mjs): `serves` brings the drinks round the square while the village
// is gathered instead of joining it, `tours` walks a round of the square now and then.
// Neither is staying at the door and going along when everybody else goes. `aside` stands
// them that far to one side of the doorway: the gold pit's open end is where the barrows
// go in. `dress` is what they wear
// over their own hashed face and height: everybody's height sets their stride, so the sea
// and the page both call residentLook below and arrive at the same person.
export const KEEPERS = {
  tavern: {
    post: 'innkeeper', name: 'The innkeeper', serves: true,
    dress: { hatShape: 'none', tunic: 0xe9e2d2, trim: 0x6a4526, build: 1.18 },
  },
  townhall: {
    post: 'mayor', name: 'The mayor', tours: true,
    dress: { hatShape: 'dome', hat: 0x1d1c22, tunic: 0x28304a, trim: 0xb8923e, build: 1.04 },
  },
  goldpit: {
    post: 'clerk', name: 'The gold clerk', aside: 1.2,
    dress: { hatShape: 'cap', hat: 0x3b3a36, tunic: 0x6e7a5a, trim: 0x2e2a24 },
  },
  // Asked for as a woman, so the dress says so rather than leaving it to the id's hash.
  school: {
    post: 'headmistress', name: 'The headmistress',
    dress: { presentation: 'woman', outfit: 'skirt', hatShape: 'none', tunic: 0x7a2f3a, trim: 0x2b2530 },
  },
  // A black cassock with the white of the collar in the trim.
  chapel: {
    post: 'priest', name: 'The priest', tours: true,
    dress: { presentation: 'man', outfit: 'trousers', hatShape: 'none', tunic: 0x18181c, trim: 0xe8e4da },
  },
};

export function keeperOf(spec) {
  if (!spec || spec.kind !== 'civic') return null;
  return Object.prototype.hasOwnProperty.call(KEEPERS, spec.civicType) ? KEEPERS[spec.civicType] : null;
}

export function keeperLook(spec) {
  const k = keeperOf(spec);
  const base = settlerLook(spec.id, 'unknown', 'adult');
  return k ? { ...base, ...k.dress } : base;
}

// Whoever lives at this spec, as they look. The one call both halves make.
export function residentLook(spec) {
  return keeperOf(spec) ? keeperLook(spec) : settlerLook(spec.id, styleOf(spec), kindOf(spec));
}
