// A visit to the gold mine as this page plays it (Plans/goudmijn-zoektocht.md): which floor you are
// on, which spots you have dug on it, the digging bar, and what a dig turns up.
//
// The rules and the bookkeeping only: no DOM, no three.js, no network. The floors come from
// shared/mine.mjs, the purse from whatever `garden` is handed in (main.js: /api/garden), the quest
// book's events from `quests` - which is what lets tests/mine-run.test.mjs play a whole descent with a
// Map for storage. web/js/mine-room.js draws it.
//
// The keeper's rules: digging is blind; leaving the mine is starting again at the top; a floor is the
// same all (world) day, so a second attempt goes down by memory. Nothing of a visit is kept, then -
// only the bar, which fills by itself outside the mine (REFILL_S from empty) and never inside it:
// `promptholm.mine` holds its level and when that was true.
import {
  floorOf, digAt, mineSeed, DIG_COST, REFILL_S, FLOORS, SPOTS, gemById,
} from 'shared/mine.mjs';

export const MINE_KEY_STORE = 'promptholm.mine';

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

// The bar as stored: `{ level, at }`, at full for anything unreadable (a bar is a convenience, and a
// player is better off with a full one than a broken one).
export function readBar(storage) {
  try {
    const o = JSON.parse(storage.getItem(MINE_KEY_STORE) || 'null');
    if (o && finite(o.level) && finite(o.at)) return { level: Math.min(1, Math.max(0, o.level)), at: o.at };
  } catch { /* fall through */ }
  return { level: 1, at: 0 };
}
function writeBar(storage, level, at) {
  try { storage.setItem(MINE_KEY_STORE, JSON.stringify({ level, at })); } catch { /* this page only */ }
}
// What a bar left at `level` at `at` has come to by `now` outside the mine.
export const refilled = (bar, now) => Math.min(1, bar.level + Math.max(0, now - bar.at) / 1000 / REFILL_S);

// `storage`  getItem / setItem (localStorage, or a Map behind them)
// `island`   () => the island's seed (whose mine this is), `day` () => the world's day
// `garden`   { found(gem) -> promise, drink() -> promise (rejects with no draught), potions() -> n }
// `quests`   { entered(), descended(floor), dug(kind), found(kind) }: the book's events
// `now`      () => ms
export function createMineRun({ storage, island, day, garden = null, quests = null, now = () => Date.now() }) {
  let inside = false;
  let floor = 1;
  let f = null;
  let dug = new Set();
  let level = 1;
  let keyTaken = false;
  const tell = (name, ...a) => { try { if (quests && quests[name]) quests[name](...a); } catch { /* the book's */ } };

  function seedFloor() {
    f = floorOf(mineSeed(island(), day()), floor);
    dug = new Set();
  }

  const api = {
    // In at the top, with the bar as the time outside has filled it.
    enter() {
      inside = true;
      floor = 1;
      keyTaken = false;
      level = refilled(readBar(storage), now());
      writeBar(storage, level, now());
      seedFloor();
      tell('entered');
    },
    // Out: what was dug is forgotten, the bar starts filling from here.
    leave() {
      if (!inside) return;
      inside = false;
      writeBar(storage, level, now());
    },
    inside: () => inside,
    floor: () => floor,
    floors: FLOORS,
    plan: () => f,
    isDug: (i) => dug.has(i),
    dugSpots: () => [...dug],
    keyTaken: () => keyTaken,
    // The bar, 0..1: inside it is what is left, outside what the time has filled it to.
    level: () => (inside ? level : refilled(readBar(storage), now())),
    canAfford: () => level >= DIG_COST - 1e-9,
    // What E does at spot `i`, for the prompt and for the press:
    //   'dig'      loose earth, and the strength to dig it
    //   'drink'    loose earth, no strength left, a draught in the satchel
    //   'tired'    loose earth, no strength, no draught: the attempt is over (the keeper's "pech")
    //   'rock'     a rock: nothing digs it
    //   'down'     the stair, dug open
    //   'key'      the key, dug open and not yet taken
    //   null       nothing (off the field, or a hole already dug)
    actionAt(i) {
      if (!f || i < 0 || i >= SPOTS) return null;
      if (f.rock[i]) return 'rock';
      if (dug.has(i)) {
        if (i !== f.goal) return null;
        return f.bottom ? (keyTaken ? null : 'key') : 'down';
      }
      if (api.canAfford()) return 'dig';
      return garden && garden.potions() > 0 ? 'drink' : 'tired';
    },
    // A dig at `i` ran its whole time. What it turned up: 'earth', a gem id, 'stair', 'key' - or null
    // when it was no dig (a rock, a hole, no strength).
    dig(i) {
      if (api.actionAt(i) !== 'dig') return null;
      level = Math.max(0, level - DIG_COST);
      // Kept at once, so a reload in the mine is no fresh bar.
      writeBar(storage, level, now());
      dug.add(i);
      const what = digAt(f, i);
      if (gemById(what)) {
        if (garden) garden.found(what);
        tell('dug', 'gem');
      }
      return what;
    },
    // Down the stair: the next floor, nothing dug on it yet.
    descend() {
      if (!f || f.bottom || !dug.has(f.goal)) return false;
      floor += 1;
      seedFloor();
      tell('descended', floor);
      return true;
    },
    takeKey() {
      if (!f || !f.bottom || !dug.has(f.goal) || keyTaken) return false;
      keyTaken = true;
      tell('found', 'key');
      return true;
    },
    // A draught from the satchel: the bar full again. The garden says whether there was one.
    async drink() {
      if (!garden) return false;
      await garden.drink();
      level = 1;
      writeBar(storage, level, now());
      return true;
    },
  };
  return api;
}
