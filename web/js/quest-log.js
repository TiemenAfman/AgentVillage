// The player's quest book: where the pirate's story stands and the treasure map they hold now
// (Plans/schatkaarten.md, "De piraat: quests bij de tavern"). shared/quests.mjs is the story and
// the reducer; this file is what a browser adds to it - keeping it, telling the rest of the
// page what an event unlocked, and saying it in words.
//
// No DOM and no three.js, on purpose: the storage is handed in, so the same code runs under a
// test with a Map behind it (tests/quest-log.test.mjs) and in the page with localStorage.
//
// Two keys, both per browser like the look they belong to:
//   promptholm.quests  the reducer's own state (parseQuestState reads it back, repairing it)
//   promptholm.finds   what the chests have given, and beside it `card`, the map in hand.
//                      The chest side owns the rest of that object; this file reads it whole
//                      and writes it whole with only `card` changed, so neither loses the
//                      other's keys. Broken contents are an empty object, never an error.
import {
  QUESTS, advance, parseQuestState, activeStep, completedQuests, unlocksOf, timesDone,
  pirateHasBusiness,
} from 'shared/quests.mjs';
import { REWARD_COLORS, REWARD_HATS, REWARD_ITEMS, SHOVEL } from 'shared/treasure.mjs';
import { WORLD_HALF } from 'shared/regions.mjs';

export const QUESTS_KEY = 'promptholm.quests';
export const FINDS_KEY = 'promptholm.finds';

// What the toast and the log call an unlock. The ids are the ones the inventory's tiles carry
// (shared/treasure.mjs UNLOCK_IDS); an id nobody named is shown as it is.
export const UNLOCK_NAMES = Object.fromEntries([
  [SHOVEL, 'Shovel'],
  ...[...REWARD_COLORS, ...REWARD_HATS, ...REWARD_ITEMS].map((u) => [u.id, u.name]),
]);
export const unlockName = (id) => UNLOCK_NAMES[id] || String(id);

// ---- storage -----------------------------------------------------------------------------

// localStorage where there is one that works (a private window, blocked site data or a
// thumbnail capture can make even touching it throw), a Map behind the same three calls where
// there is not: the book then lasts for this page and no longer, which is the honest thing.
export function defaultStorage() {
  try {
    const s = globalThis.localStorage;
    if (s) { s.getItem(QUESTS_KEY); return s; }
  } catch { /* fall through to memory */ }
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const GRID = /^[A-P](1[0-6]|[1-9])$/;

// A stored map, or null. Strict about every field the page reads, because it comes back from a
// place anybody can edit: a card with a NaN spot would put a cross at nothing and a cross with
// no islet cannot wake up. Extra keys are dropped.
export function parseCard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { seed, islandId, isletId, spot, local, grid, status, day } = raw;
  if (typeof seed !== 'string' || !seed || seed.length > 200) return null;
  if (typeof isletId !== 'string' || !isletId || isletId.length > 200) return null;
  if (!spot || !finite(spot.x) || !finite(spot.z)) return null;
  const reach = WORLD_HALF * 2;
  if (Math.abs(spot.x) > reach || Math.abs(spot.z) > reach) return null;
  if (typeof grid !== 'string' || !GRID.test(grid)) return null;
  if (status !== 'awake' && status !== 'asleep') return null;
  return {
    seed,
    islandId: typeof islandId === 'string' ? islandId : null,
    isletId,
    spot: { x: spot.x, z: spot.z },
    local: local && finite(local.x) && finite(local.z) ? { x: local.x, z: local.z } : null,
    grid,
    status,
    day: finite(day) ? day : null,
  };
}

// The finds object as stored: whatever object is there, `{}` for nothing or junk. A bare list
// (a first version of the chest side might keep just the finds) is read as `found`, so it is
// carried along instead of thrown away.
export function readFinds(storage) {
  try {
    const raw = storage.getItem(FINDS_KEY);
    if (raw == null) return {};
    const o = JSON.parse(raw);
    if (Array.isArray(o)) return { found: o };
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function writeFinds(storage, finds) {
  try { storage.setItem(FINDS_KEY, JSON.stringify(finds)); return true; } catch { return false; }
}

// ---- words -------------------------------------------------------------------------------

const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

// The lines an event's outcome deserves, as plain text (the page escapes them where it puts
// them in): the step done or the quest finished, what was unlocked, a map handed over.
// `gained` is advance()'s.
export function linesFor(gained, after) {
  const out = [];
  if (!gained) return out;
  if (gained.questDone) {
    const q = activeQuestById(gained.questDone);
    out.push(q ? `Quest done: ${q.title}` : 'Quest done');
  } else if (gained.stepDone) {
    const cur = activeStep(after);
    if (cur) out.push(`${cur.quest.title}: ${cur.step.goal}`);
  }
  if (gained.cards && gained.cards.length) out.push(gained.cards.length === 1 ? 'The pirate gave you a treasure map' : 'The pirate gave you treasure maps');
  if (gained.unlocks && gained.unlocks.length) out.push(`Unlocked: ${list(gained.unlocks.map(unlockName))}`);
  if (gained.questDone && gained.next) {
    const n = activeQuestById(gained.next);
    if (n && !n.repeat) out.push(`New quest: ${n.title}`);
  }
  return out;
}
const questById = new Map(QUESTS.map((q) => [q.id, q]));
const activeQuestById = (id) => questById.get(id) || null;

// ---- the book ----------------------------------------------------------------------------

// `unlock`   (id) => void, unlocks.js's: told about every id a finished step or quest grants.
//            Called again for everything the state supports on `sync()`, so an unlock store
//            that was cleared (or a book carried over from another browser) heals itself.
// `cardFor`  (name) => card | null: makes the map the pirate hands over ('first-hunt'), off the
//            fleet, which only main.js knows. Null when it cannot yet (no fleet); `ensureCard`
//            asks again whenever something changes, so the map is owed rather than lost.
// `onChange` () => void after anything the book keeps changed (the log panel redraws).
export function createQuestLog({ storage = defaultStorage(), unlock = null, cardFor = null, onChange = null } = {}) {
  let state = parseQuestState(read(QUESTS_KEY));
  let held = parseCard(readFinds(storage).card);

  function read(key) {
    try { return storage.getItem(key); } catch { return null; }
  }
  const changed = () => { if (onChange) { try { onChange(); } catch { /* the panel's problem */ } } };
  function save() {
    try { storage.setItem(QUESTS_KEY, JSON.stringify(state)); } catch { /* kept for this page only */ }
  }
  function saveCard() {
    const finds = readFinds(storage);
    if (held) finds.card = held; else delete finds.card;
    writeFinds(storage, finds);
  }
  const grant = (ids) => {
    if (!unlock) return;
    for (const id of ids) { try { unlock(id); } catch { /* one bad tile is not the story's end */ } }
  };

  // Everything the state has earned, given again: unlock() is idempotent, so this only ever
  // fills a gap.
  function sync() { grant(unlocksOf(state)); }

  // Whether the map in hand is the one the current step needs and none is held: the first step
  // after the pirate's, digging for the statue, needs the first hunt's map. Derived from the
  // state rather than remembered as "owed", so a reload, a missing fleet or a cleared finds
  // key all lead to the same place - the map turns up as soon as it can be made.
  function ensureCard() {
    if (held) return false;
    const cur = activeStep(state);
    if (!cur || cur.step.on !== 'dug' || !cur.step.match || cur.step.match.kind !== 'statue') return false;
    const made = cardFor ? parseCard(safe(cardFor, 'first-hunt')) : null;
    if (!made) return false;
    held = made;
    saveCard();
    changed();
    return true;
  }

  // Report one thing that happened. `{ gained, lines, cardMade }`: what advance() says, the
  // toast lines it deserves (empty when nothing moved), and whether a map was handed over.
  function applyEvent(event) {
    const { state: next, gained } = advance(state, event);
    if (!gained.stepDone) return { gained, lines: [], cardMade: false };
    state = next;
    save();
    grant(gained.unlocks);
    const cardMade = gained.cards.length ? ensureCard() : false;
    const lines = linesFor(gained, state);
    changed();
    return { gained, lines, cardMade };
  }

  // The map in hand goes when it has done its job.
  function clearCard() {
    if (!held) return false;
    held = null;
    saveCard();
    changed();
    return true;
  }

  // What the page reports about the treasure. Each is `applyEvent` with the right words, and
  // digging also takes the map that led to the spot (a dug-up chest is not dug up twice).
  const api = {
    state: () => state,
    card: () => held,
    setCard(card) {
      const c = parseCard(card);
      held = c;
      saveCard();
      changed();
      return c;
    },
    clearCard,
    ensureCard,
    sync,
    applyEvent,
    onTalked: (who) => api.applyEvent({ type: 'talked', with: who }),
    onDug(kind) { const r = api.applyEvent({ type: 'dug', kind }); clearCard(); return r; },
    onLifted: (kind = 'statue') => api.applyEvent({ type: 'lifted', kind }),
    onBoarded: (kind = 'statue') => api.applyEvent({ type: 'boarded', kind }),
    onDelivered: (kind = 'statue') => api.applyEvent({ type: 'delivered', kind }),
    // Replace the map's status ('awake' / 'asleep') without touching the rest: the islet may
    // have gone under somebody's island, or come back. Kept, so a reload shows the same grey.
    setStatus(status) {
      if (!held || held.status === status || (status !== 'awake' && status !== 'asleep')) return false;
      held = { ...held, status };
      saveCard();
      changed();
      return true;
    },
    pirateHasBusiness: () => pirateHasBusiness(state),
    // Everything the log panel and the pirate's window draw, in one plain object.
    view: () => viewOf(state, held),
    // Forget everything (a debug reset). The unlocks stay: they belong to the look.
    reset() { state = parseQuestState(null); held = null; save(); saveCard(); changed(); },
  };
  return api;
}

function safe(fn, ...a) { try { return fn(...a); } catch { return null; } }

// ---- what is drawn -----------------------------------------------------------------------

const rewardsOf = (q) => ((q.reward && q.reward.unlock) || []).map(unlockName);

// The state as the panels want it. `active` is null when the whole story is told and nothing
// repeats; `done` is the finished quests in story order with what they gave.
export function viewOf(state, card) {
  const cur = activeStep(state);
  return {
    active: cur ? {
      id: cur.quest.id,
      title: cur.quest.title,
      text: cur.quest.text,
      repeat: !!cur.quest.repeat,
      times: timesDone(state, cur.quest.id),
      index: cur.index,
      count: cur.quest.steps.length,
      goal: cur.step.goal,
      say: cur.step.text,
      steps: cur.quest.steps.map((s, i) => ({ goal: s.goal, done: i < cur.index, current: i === cur.index })),
      rewards: rewardsOf(cur.quest),
      // Waiting on a word with the pirate: what the exclamation mark over him asks.
      talk: pirateHasBusiness(state),
    } : null,
    done: completedQuests(state).map((q) => ({ id: q.id, title: q.title, text: q.text, rewards: rewardsOf(q) })),
    card: card ? {
      grid: card.grid,
      asleep: card.status === 'asleep',
      spot: card.spot,
    } : null,
  };
}
