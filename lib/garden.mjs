// Market gardening: a purse, a pouch of seed, a basket of vegetables, and every bed
// that has been sown on the island.
//
// The village is a picture of what Claude has been doing and is rebuilt from the
// transcripts on every scan, so nothing here could survive in village.json. Like the
// props it lives in its own file, which the scanner never touches.
//
// A bed grows in real time and nothing rots: the two timestamps it carries are all
// anyone needs to know how far along it is, so the page works the growing out for
// itself every frame and the island is only asked when something is actually done.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeTerrain } from '../shared/terrain.mjs';
import {
  CROPS, CROP_KINDS, STARTING_PURSE, BED_GAP, MAX_BEDS,
  knownCrop, growthOf, priceOf, ripeIn, dayNumber,
} from '../shared/crops.mjs';
import { DATA, readJson, writeJsonAtomic, loadConfig } from './paths.mjs';

export const GARDEN_FILE = path.join(DATA, 'garden.json');
const LAYOUT_FILE = path.join(DATA, 'layout.json');

// The same reach the props have: the land ends around ±40 on an 80-cell island and the
// slack past that is water anyway, which the ground check below refuses.
const REACH = 60;
const MOST_SEED_AT_ONCE = 50;
// Nothing here measures the distance to a house, a hedge or a tree, and it does not
// need to: a bed is sown where the gardener is standing, and walk mode will not let
// anyone stand in a wall. The page refuses a spot too close to something solid before
// it ever asks, which leaves this file to worry about the ground alone.

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function counts(on) {
  const out = {};
  if (!on || typeof on !== 'object') return out;
  for (const k of CROP_KINDS) {
    const n = Math.max(0, Math.floor(num(on[k])));
    if (n > 0) out[k] = n;
  }
  return out;
}

// Whatever is on disk, read back as something the rest of this file can trust. A
// garden nobody has opened yet is a purse with the town hall's coins in it.
export function readGarden() {
  const on = readJson(GARDEN_FILE, null);
  const g = {
    purse: on ? Math.max(0, Math.round(num(on.purse))) : STARTING_PURSE,
    seeds: counts(on && on.seeds),
    basket: counts(on && on.basket),
    held: on && knownCrop(on.held) ? on.held : null,
    beds: [],
    ledger: {
      sown: Math.max(0, Math.floor(num(on && on.ledger && on.ledger.sown))),
      pulled: Math.max(0, Math.floor(num(on && on.ledger && on.ledger.pulled))),
      earned: Math.max(0, Math.floor(num(on && on.ledger && on.ledger.earned))),
      spent: Math.max(0, Math.floor(num(on && on.ledger && on.ledger.spent))),
    },
  };
  for (const b of (on && Array.isArray(on.beds) ? on.beds : [])) {
    if (!knownCrop(b.kind)) continue;
    g.beds.push({
      id: String(b.id || `bed:${randomUUID().slice(0, 8)}`),
      kind: b.kind,
      x: num(b.x), z: num(b.z), rot: num(b.rot),
      plantedAt: num(b.plantedAt, Date.now()),
      ripeAt: num(b.ripeAt, Date.now()),
      crop: Math.max(1, Math.floor(num(b.crop, CROPS[b.kind].crop))),
      salt: !!b.salt,
    });
  }
  return holdSomethingSensible(g);
}

// The pouch decides what P plants, so it must never point at seed that has run out.
function holdSomethingSensible(g) {
  if (!g.held || !g.seeds[g.held]) {
    g.held = CROP_KINDS.find((k) => g.seeds[k]) || null;
  }
  return g;
}

function save(g) {
  holdSomethingSensible(g);
  writeJsonAtomic(GARDEN_FILE, { v: 1, savedAt: new Date().toISOString(), ...g }, { pretty: true });
  return g;
}

// ---------------------------------------------------------------- the ground
// A bed needs earth: land, off the sand, out of the rivers, off the flagstones and not
// on a slope the water would run straight off. Which is close to what the layout calls
// buildable, minus the height ceiling, because there is no reason not to farm up the
// hill.
//
// The ground and the paving are read together and kept until the land register changes
// underneath them, so sowing a bed does not rebuild the island every time.
let cached = null;
function ground() {
  const config = loadConfig();
  const layout = readJson(LAYOUT_FILE, null) || {};
  const polders = layout.polders || [];
  // Keyed on the polders themselves and not their number: reclaimed land is what turns
  // water into ground, and a bed sown on it must not be refused for standing in a sea
  // the picture no longer has.
  const key = `${config.seed}:${config.gridSize}:${JSON.stringify(polders)}:${layout.paths ? layout.paths.length : 0}`;
  if (!cached || cached.key !== key) {
    const t = makeTerrain(config.seed, { size: config.gridSize, polders });
    const paved = new Set();
    const town = layout.town || {};
    for (const c of town.paved || []) paved.add(c[0] + c[1] * t.size);
    for (const d of Object.values(layout.districts || {})) {
      for (const c of d.paved || []) paved.add(c[0] + c[1] * t.size);
    }
    for (const p of layout.paths || []) {
      for (const c of p.cells || []) paved.add(c[0] + c[1] * t.size);
    }
    cached = { key, t, paved };
  }
  return cached;
}

// Why this spot will not do, or null if it will. A sentence either way: every one of
// these is read by whoever is standing there.
function whyNot({ t, paved }, x, z) {
  const gx = Math.floor(x + t.half), gz = Math.floor(z + t.half);
  if (!t.inGrid(gx, gz)) return 'that is off the island';
  // The river before the sea: a cut river cell is under water as far as isLand is
  // concerned, and "nothing grows in the sea" is a puzzling thing to be told while
  // standing on a bank ten paces inland.
  if (t.isRiver(gx, gz)) return 'that is the river';
  if (!t.isLand(gx, gz)) return 'nothing grows in the sea';
  if (t.isBeach(gx, gz)) return 'sand grows nothing; try the grass';
  if (paved.has(gx + gz * t.size)) return 'nothing grows through flagstones; try the grass';
  if (t.slope(gx, gz) > 1.1) return 'too steep to hold a bed';
  return null;
}

// Salt air, for the tidebeans: is the water within four paces? Measured off the same
// cells the ground is drawn from, so the shoreline in the picture is the shoreline the
// stall pays for.
function bythesea(t, x, z, paces = 4) {
  const gx = Math.floor(x + t.half), gz = Math.floor(z + t.half);
  const r = Math.ceil(paces);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > paces * paces) continue;
      if (t.isWater(gx + dx, gz + dz) && !t.isRiver(gx + dx, gz + dz)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- what to show
// The beds as they stand, which is all a visitor is ever told: shapes and places,
// naming no file, no folder and nobody's purse.
export function cropsView() {
  const beds = readGarden().beds;
  return beds.map((b) => ({
    id: b.id, kind: b.kind, x: b.x, z: b.z, rot: b.rot,
    plantedAt: b.plantedAt, ripeAt: b.ripeAt, crop: b.crop, salt: b.salt,
  }));
}

// Everything, for whoever is doing the farming: what is in the purse, what is in the
// pouch, what is in the basket, and today's prices on the stall.
export function gardenView() {
  const g = readGarden();
  const now = Date.now();
  const { seed } = loadConfig();
  const day = dayNumber(now);
  const prices = {};
  for (const k of CROP_KINDS) prices[k] = priceOf(k, { seed, day });
  return {
    purse: g.purse,
    seeds: g.seeds,
    basket: g.basket,
    held: g.held,
    ledger: g.ledger,
    prices,
    day,
    beds: g.beds.map((b) => ({ ...b, ...growthOf(b, now) })),
    ripe: g.beds.filter((b) => growthOf(b, now).ripe).length,
    worth: Object.entries(g.basket).reduce((sum, [k, n]) => sum + n * prices[k], 0),
  };
}

// ---------------------------------------------------------------- the stall
export function buySeed(kind, count = 1) {
  if (!knownCrop(kind)) throw new Error(`the stall has no ${String(kind).slice(0, 20)} seed`);
  const n = Math.max(1, Math.min(MOST_SEED_AT_ONCE, Math.floor(num(count, 1))));
  const g = readGarden();
  const price = CROPS[kind].seed * n;
  if (g.purse < price) {
    const afford = Math.floor(g.purse / CROPS[kind].seed);
    throw new Error(afford > 0
      ? `that is ${price} coins and the purse holds ${g.purse}; it would run to ${afford}`
      : `that is ${price} coins and the purse holds ${g.purse}`);
  }
  g.purse -= price;
  g.seeds[kind] = (g.seeds[kind] || 0) + n;
  g.ledger.spent += price;
  g.held = kind;                      // you bought it to sow it
  save(g);
  return { kind, count: n, paid: price, purse: g.purse, seeds: g.seeds, held: g.held };
}

export function sellCrop(kind, count = 'all') {
  if (!knownCrop(kind)) throw new Error(`the stall does not buy ${String(kind).slice(0, 20)}`);
  const g = readGarden();
  const have = g.basket[kind] || 0;
  if (!have) throw new Error(`there is no ${CROPS[kind].plural} in the basket`);
  const n = count === 'all' || count == null ? have : Math.max(1, Math.min(have, Math.floor(num(count, 1))));
  const { seed } = loadConfig();
  const price = priceOf(kind, { seed });
  const paid = price * n;
  g.basket[kind] = have - n;
  if (!g.basket[kind]) delete g.basket[kind];
  g.purse += paid;
  g.ledger.earned += paid;
  save(g);
  return { kind, count: n, price, paid, purse: g.purse, basket: g.basket };
}

export function sellEverything() {
  const g = readGarden();
  const kinds = Object.keys(g.basket);
  if (!kinds.length) throw new Error('the basket is empty');
  const { seed } = loadConfig();
  let paid = 0, count = 0;
  const sold = [];
  for (const k of kinds) {
    const n = g.basket[k];
    const price = priceOf(k, { seed });
    paid += price * n;
    count += n;
    sold.push({ kind: k, count: n, price });
    delete g.basket[k];
  }
  g.purse += paid;
  g.ledger.earned += paid;
  save(g);
  return { sold, count, paid, purse: g.purse, basket: g.basket };
}

// Which seed is in hand. The only thing P needs to know.
export function holdSeed(kind) {
  const g = readGarden();
  if (kind === null) { g.held = null; save(g); return { held: g.held }; }
  if (!knownCrop(kind)) throw new Error('no such seed');
  if (!g.seeds[kind]) throw new Error(`there is no ${CROPS[kind].name.toLowerCase()} seed in the pouch`);
  g.held = kind;
  save(g);
  return { held: g.held, seeds: g.seeds };
}

// ---------------------------------------------------------------- the ground work
export function plantBed({ kind, x, z, rot } = {}) {
  const g = readGarden();
  const seedKind = knownCrop(kind) ? kind : g.held;
  if (!seedKind) throw new Error('there is no seed in the pouch; the stall at the market sells it');
  if (!g.seeds[seedKind]) throw new Error(`there is no ${CROPS[seedKind].name.toLowerCase()} seed left`);

  const px = num(x, NaN), pz = num(z, NaN);
  if (!Number.isFinite(px) || !Number.isFinite(pz)) throw new Error('say where it goes: x and z, in world units');
  if (Math.abs(px) > REACH || Math.abs(pz) > REACH) throw new Error('that is off the map');
  if (g.beds.length >= MAX_BEDS) throw new Error(`${g.beds.length} beds is as many as one gardener can keep up with`);

  const here = ground();
  const no = whyNot(here, px, pz);
  if (no) throw new Error(no);
  for (const b of g.beds) {
    if (Math.hypot(b.x - px, b.z - pz) < BED_GAP) throw new Error('there is a bed here already; sow a pace further off');
  }

  const c = CROPS[seedKind];
  const salt = !!(c.salt && bythesea(here.t, px, pz));
  const now = Date.now();
  const bed = {
    id: `bed:${randomUUID().slice(0, 8)}`,
    kind: seedKind,
    x: Math.round(px * 1000) / 1000,
    z: Math.round(pz * 1000) / 1000,
    rot: num(rot, 0),
    plantedAt: now,
    ripeAt: now + c.grow * 60000,
    crop: c.crop + (salt ? c.salt : 0),
    salt,
  };
  g.seeds[seedKind] -= 1;
  if (!g.seeds[seedKind]) delete g.seeds[seedKind];
  g.beds.push(bed);
  g.ledger.sown += 1;
  save(g);
  return { bed, seeds: g.seeds, held: g.held, salt };
}

export function harvestBed(id) {
  const g = readGarden();
  const i = g.beds.findIndex((b) => b.id === String(id));
  if (i < 0) throw new Error('there is no bed there');
  const bed = g.beds[i];
  const grown = growthOf(bed, Date.now());
  if (!grown.ripe) throw new Error(`the ${CROPS[bed.kind].plural} need another ${ripeIn(grown.leftMs)}`);
  g.beds.splice(i, 1);
  g.basket[bed.kind] = (g.basket[bed.kind] || 0) + bed.crop;
  g.ledger.pulled += bed.crop;
  save(g);
  return { kind: bed.kind, count: bed.crop, salt: bed.salt, basket: g.basket, id: bed.id };
}

// Second thoughts about where a bed went. Nothing comes back, so a ripe one is pulled
// rather than dug: losing a full bed to a mistyped key is not a game.
export function digUpBed(id) {
  const g = readGarden();
  const i = g.beds.findIndex((b) => b.id === String(id));
  if (i < 0) throw new Error('there is no bed there');
  const bed = g.beds[i];
  if (growthOf(bed, Date.now()).ripe) throw new Error(`those ${CROPS[bed.kind].plural} are ready; pull them instead`);
  g.beds.splice(i, 1);
  save(g);
  return { kind: bed.kind, id: bed.id };
}
