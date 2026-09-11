// What grows on the island, and what it is worth.
//
// The seed stall at the market sells from this list, the ground grows from it and the
// same stall buys the crop back. Node reads it to keep the purse honest; the browser
// reads it to draw the beds and to write the price list. One catalogue, so a turnip
// cannot be worth four coins in the ledger and six on the stall.
//
// `grow` is in real minutes. The island is meant to be left open beside your work, so
// the long crops pay better by the minute than the short ones: a pumpkin is an
// afternoon's patience, a turnip is a coffee.

export const CROPS = {
  turnip: {
    name: 'Turnip',
    plural: 'turnips',
    what: 'Sown by everyone first, and pulled before it can be regretted.',
    seed: 2, grow: 4, crop: 3, sell: 2,
    leaf: 0x6fa83f, flesh: 0xf1e6d8, ripeGlow: 0,
  },
  carrot: {
    name: 'Carrot',
    plural: 'carrots',
    what: 'Feathery on top and nothing to look at until it is out of the ground.',
    seed: 4, grow: 8, crop: 4, sell: 3,
    leaf: 0x5f9c46, flesh: 0xe08238, ripeGlow: 0,
  },
  beetroot: {
    name: 'Beetroot',
    plural: 'beetroot',
    what: 'Crimson to the stem. Stains the hands of whoever brings it in.',
    seed: 7, grow: 15, crop: 4, sell: 6,
    leaf: 0x7d4a63, flesh: 0x8e2f4a, ripeGlow: 0,
  },
  tidebean: {
    name: 'Tidebean',
    plural: 'tidebeans',
    what: 'Climbs a pole and likes salt in the air: a bed within four paces of the water sets two extra pods.',
    seed: 12, grow: 25, crop: 5, sell: 8,
    leaf: 0x4f8f55, flesh: 0x9ec96a, ripeGlow: 0,
    salt: 2,
  },
  moonleek: {
    name: 'Moonleek',
    plural: 'moonleeks',
    what: 'Pale, slow, and faintly lit once it is ready, so a ripe row can be found after dark.',
    seed: 20, grow: 45, crop: 5, sell: 15,
    leaf: 0xa8c9a0, flesh: 0xe8f2d8, ripeGlow: 1,
  },
  pumpkin: {
    name: 'Pumpkin',
    plural: 'pumpkins',
    what: 'One fruit to a bed, an afternoon of waiting, and the best price on the stall.',
    seed: 35, grow: 90, crop: 2, sell: 90,
    leaf: 0x4a7c37, flesh: 0xe07b23, ripeGlow: 0,
  },
};

export const CROP_KINDS = Object.keys(CROPS);

// What the town hall hands a new market gardener, which is seven beds of turnip or one
// look at the pumpkin seed and a change of plan.
export const STARTING_PURSE = 15;

// A bed is a square of tilled ground a little over a metre across. Beds are not solid:
// you walk through your own turnips rather than being fenced in by them.
export const BED_SIZE = 1.2;
export const BED_GAP = 1.35;      // how far apart two beds have to be sown
export const MAX_BEDS = 80;

// Sowing, then leaves, then the vegetable itself. The fractions are of the growing
// time, so every crop passes through the same four looks at its own pace.
export const STAGES = ['sown', 'sprout', 'leafy', 'ripe'];
const STAGE_FROM = { sown: 0, sprout: 0.2, leafy: 0.55, ripe: 1 };

export function knownCrop(kind) {
  return Object.prototype.hasOwnProperty.call(CROPS, String(kind));
}

export function stageAt(fraction) {
  const f = Number.isFinite(fraction) ? fraction : 0;
  if (f >= STAGE_FROM.ripe) return 'ripe';
  if (f >= STAGE_FROM.leafy) return 'leafy';
  if (f >= STAGE_FROM.sprout) return 'sprout';
  return 'sown';
}

// How far along a bed is, from the two timestamps that travel with it. The page works
// this out for itself every frame, which is why a bed can be watched growing without
// the island being asked anything.
export function growthOf(bed, now = Date.now()) {
  const from = Number(bed.plantedAt) || 0;
  const to = Number(bed.ripeAt) || from;
  const span = Math.max(1, to - from);
  const fraction = Math.max(0, Math.min(1, (now - from) / span));
  return { fraction, stage: stageAt(fraction), ripe: fraction >= 1, leftMs: Math.max(0, to - now) };
}

// "in 4 minutes", "in an hour and a half", "ready" - said the way a person would.
export function ripeIn(leftMs) {
  if (leftMs <= 0) return 'ready';
  const mins = Math.ceil(leftMs / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60), rest = mins % 60;
  if (!rest) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} h ${rest} min`;
}

// What a crop fetches today. The stall's mood is a day at a time and the same for
// everyone looking at the same island, so it is worked out from the date and the
// island's own seed rather than remembered anywhere: a quarter either way, which is
// enough to make holding a full basket over to tomorrow a real decision.
export function priceOf(kind, { seed = 0, day = dayNumber() } = {}) {
  const c = CROPS[kind];
  if (!c) return 0;
  const u = drift(`${seed}:${kind}:${day}`);
  return Math.max(1, Math.round(c.sell * (0.75 + 0.5 * u)));
}

export function dayNumber(now = Date.now()) {
  return Math.floor(now / 86400000);
}

// A number in [0, 1) from a string. Its own small hash rather than shared/rng.mjs's,
// so the price list does not shift the day that one is ever tuned.
function drift(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// How the stall describes today's price, for the line under it.
export function priceMood(kind, price) {
  const base = CROPS[kind] ? CROPS[kind].sell : price;
  if (price >= base * 1.15) return 'a good day for it';
  if (price <= base * 0.85) return 'the stall is not keen today';
  return 'the usual';
}

export function catalogueLines() {
  return CROP_KINDS.map((k) => {
    const c = CROPS[k];
    return `  ${k.padEnd(9)} ${String(c.seed).padStart(2)} coins a seed, ripe in ${String(c.grow).padStart(2)} min, `
      + `${c.crop} ${c.plural} at about ${c.sell} each`;
  });
}
