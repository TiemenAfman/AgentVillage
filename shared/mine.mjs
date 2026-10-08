// The gold mine's floors (Plans/goudmijn-zoektocht.md): a field of GRID by GRID spots to dig, some
// under a rock, one hiding the stair down - and on the bottom floor, the key instead of a stair.
// Dug blind, by the keeper's wish: nothing tells you where the stair is, and a floor is the same all
// day, so what you remember of a failed attempt is what gets you deeper on the next.
//
// Everything about a floor follows from a seed string and the floor's number, so nothing of it is
// stored or sent: the page seeds today's mine from the island and the world's day, and keeps only
// which spots it has dug (web/js/mine.js, `promptholm.mine`). Pure and under shared/'s rule - no sin,
// cos or pow (tests/mine.test.mjs reads the file) - so a test seeds the same floors the page does.
//
// The one copy of every number of the mine: its size, its depth, what a dig costs, what a stone and
// a draught are worth. Tune them here.
import { makeRng } from './rng.mjs';

// The field: GRID by GRID spots, CELL apart, in a room whose middle is the field's middle. The way
// in is at the south (+z) edge, in the middle, and the first ENTRY_CLEAR rows from it are never a
// rock, a stair or the key, so the first steps in are onto open earth.
// Seven by seven: the keeper asked for 25 by 25 first and for a smaller field once the digging was
// blind. About forty spots of earth a floor is some twenty digs to find the stair on average - a
// bar and a half for the first floors, less once you remember.
export const GRID = 7;
export const CELL = 0.6;
export const SPOTS = GRID * GRID;
export const ENTRY_CLEAR = 1;

// How deep: the stair on every floor but the last, the key on the last.
export const FLOORS = 7;

// The share of spots under a rock, by floor (1 the top): more the deeper.
export const rockShare = (floor) => 0.12 + 0.02 * (floor - 1);

// The digging pool (a bar of its own, web/js/mine.js): a whole bar is DIGS_PER_BAR digs. It fills by
// itself outside the mine, from empty to full in REFILL_S, and never inside it: down there only a
// draught fills it, and with none left that is the end of the attempt.
export const DIGS_PER_BAR = 30;
export const DIG_COST = 1 / DIGS_PER_BAR;
export const REFILL_S = 600;
// How long one dig takes, in seconds (walk.dig): a quick spade of earth, not the treasure's 2.5.
export const MINE_DIG_SECONDS = 1.1;

// The draught the tavern sells, which fills the bar (lib/garden.mjs `buyPotion`).
export const POTION_PRICE = 12;
export const POTION_MAX = 9;

// The stones. `from` is the first floor a stone may lie on, `weight` how common it is there, and
// `price` what the goldsmith pays for one (lib/garden.mjs `sellGems`). GEM_SHARE is the chance a
// dug spot holds a stone at all, by floor.
export const GEMS = [
  { id: 'quartz', name: 'Quartz', plural: 'quartz', price: 3, from: 1, weight: 6, hex: 0xe8e4f0 },
  { id: 'amethyst', name: 'Amethyst', plural: 'amethysts', price: 8, from: 1, weight: 3, hex: 0x8a5cc4 },
  { id: 'garnet', name: 'Garnet', plural: 'garnets', price: 14, from: 3, weight: 2, hex: 0x9c2236 },
  { id: 'diamond', name: 'Diamond', plural: 'diamonds', price: 40, from: 5, weight: 1, hex: 0xbfeaff },
];
export const GEM_IDS = GEMS.map((g) => g.id);
export const gemById = (id) => GEMS.find((g) => g.id === id) || null;
export const gemShare = (floor) => 0.1 + 0.01 * (floor - 1);
// The most stones the island takes in one world day (lib/garden.mjs `findGem`): far past what a day
// in the mine can dig, and a stop for a page stuck in a loop.
export const GEMS_A_DAY = 400;

// Which floor (1..FLOORS) is the bottom.
export const isBottom = (floor) => floor >= FLOORS;

// The spot number of (col, row), and back. Row 0 is the north (far) edge, row GRID - 1 the entry.
export const spotOf = (col, row) => row * GRID + col;
export const colRow = (i) => [i % GRID, (i - (i % GRID)) / GRID];
export const ENTRY_SPOT = spotOf((GRID - 1) / 2, GRID - 1);

// Where a spot's middle lies in the room, with the field's middle at (0, 0) and +z towards the way in.
export function spotCentre(i) {
  const [c, r] = colRow(i);
  return { x: (c - (GRID - 1) / 2) * CELL, z: (r - (GRID - 1) / 2) * CELL };
}
// The spot under (x, z), or -1 off the field.
export function spotAt(x, z) {
  const c = Math.round(x / CELL + (GRID - 1) / 2);
  const r = Math.round(z / CELL + (GRID - 1) / 2);
  return c >= 0 && c < GRID && r >= 0 && r < GRID ? spotOf(c, r) : -1;
}

// The seed of one day's mine on one island. The world's day, never this machine's (worldTime).
export const mineSeed = (islandSeed, day) => `mine:${islandSeed}:${day}`;

const neighbours = (i) => {
  const [c, r] = colRow(i);
  const out = [];
  if (c > 0) out.push(i - 1);
  if (c < GRID - 1) out.push(i + 1);
  if (r > 0) out.push(i - GRID);
  if (r < GRID - 1) out.push(i + GRID);
  return out;
};

// One floor: `{ floor, rock, gem, goal, bottom }`.
//   rock    Uint8Array(SPOTS), 1 under a rock (not dug, and stood round)
//   gem     Map spot -> gem id: what a dig turns up there
//   goal    the spot of the stair down, or of the key on the bottom floor
//   bottom  whether `goal` is the key
// The goal is drawn only from spots a body can reach from the way in without crossing a rock, so
// rocks may wall off a corner of the field but never the way down.
export function floorOf(seed, floor) {
  const rng = makeRng(`${seed}:floor:${floor}`);
  const rock = new Uint8Array(SPOTS);
  const share = rockShare(floor);
  for (let i = 0; i < SPOTS; i++) {
    const r = colRow(i)[1];
    if (r >= GRID - ENTRY_CLEAR) { rng.next(); continue; }
    rock[i] = rng.next() < share ? 1 : 0;
  }
  // Every spot reachable from the way in, over earth.
  const reach = new Uint8Array(SPOTS);
  const queue = [ENTRY_SPOT];
  reach[ENTRY_SPOT] = 1;
  for (let h = 0; h < queue.length; h++) {
    for (const n of neighbours(queue[h])) {
      if (!reach[n] && !rock[n]) { reach[n] = 1; queue.push(n); }
    }
  }
  // The goal: never on the row by the way in, so it is never a step from the door.
  const goals = [];
  for (let i = 0; i < SPOTS; i++) if (reach[i] && colRow(i)[1] < GRID - ENTRY_CLEAR) goals.push(i);
  const goal = goals.length ? goals[rng.int(goals.length)] : queue[queue.length - 1];
  // The stones: a draw for every earth spot, the goal's own included and then dropped.
  const gem = new Map();
  const g = rng.fork('gems');
  const can = GEMS.filter((x) => x.from <= floor);
  const total = can.reduce((s, x) => s + x.weight, 0);
  const share2 = gemShare(floor);
  for (let i = 0; i < SPOTS; i++) {
    const hit = g.next() < share2;
    const pick = g.next() * total;
    if (rock[i] || i === goal || !hit) continue;
    let acc = 0;
    for (const x of can) { acc += x.weight; if (pick < acc) { gem.set(i, x.id); break; } }
  }
  return { floor, rock, gem, goal, bottom: isBottom(floor) };
}

// What a dig at spot `i` of floor `f` turns up: 'rock' (no dig), 'stair', 'key', a gem id, or
// 'earth'.
export function digAt(f, i) {
  if (i < 0 || i >= SPOTS) return null;
  if (f.rock[i]) return 'rock';
  if (i === f.goal) return f.bottom ? 'key' : 'stair';
  return f.gem.get(i) || 'earth';
}
