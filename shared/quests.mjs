// The pirate's quests: a short story chain that leads a player to the treasure statue and
// then keeps handing out a chest a day (Plans/schatkaarten.md, "De piraat: quests bij de
// tavern").
//
// It is data first. A quest is a row of QUESTS - id, title, the pirate's words, steps, what
// it grants - and `advance` is the one reducer that walks a player through them, so a new
// quest is a new row and no code. Deliberately not a generic quest generator
// (Ideas.MD wants none): a story, told in order.
//
// The state is plain JSON, meant for localStorage (`promptholm.quests`, per browser like the
// look): quest progress belongs to whoever is playing, while the statue and the count of
// found treasures belong to the island (data/treasure.json) and are not in here. Everything
// derivable is derived - which quest is active, what has been unlocked - so that a state can
// never disagree with itself, and a state from somewhere else is repaired rather than trusted.
//
// Pure, and under shared/'s rule (no sin, cos or pow; tests/quests.test.mjs reads the file).
import { UNLOCK_IDS, SHOVEL } from './treasure.mjs';

export const QUEST_STATE_V = 1;

// What the page reports, as `{ type, ...detail }` (a bare string is `{ type }`):
//   talked     spoke to a person: { with: 'pirate' }
//   dug        finished digging:  { kind: 'statue' | 'chest' }
//   lifted     picked the statue up: { kind: 'statue' }
//   boarded    put it on the boat:   { kind: 'statue' }
//   delivered  stood it in the town: { kind: 'statue' }
export const QUEST_EVENTS = ['talked', 'dug', 'lifted', 'boarded', 'delivered'];

// A step waits for one event whose type is `on` and that carries every key of `match`.
// `grant` (unlock ids, and `card` for a map to hand over) is given when the step is done,
// `reward` when the whole quest is: the shovel has to come with the first step, since the
// next one is digging. `text` is what the pirate says while the step is current, `goal` the
// line in the log. Repeatable quests go last: they never finish, they start over.
export const QUESTS = [
  {
    id: 'first-dig',
    title: 'The First Dig',
    text: "Ye want a share o' the plunder? Take me shovel, matey. The map be marked, and somethin' big lies buried out there.",
    steps: [
      { on: 'talked', match: { with: 'pirate' }, goal: 'Talk to the pirate at the tavern',
        text: "Aye, ye look like a digger. Here be me shovel and a map. Go on, dig!",
        grant: { unlock: [SHOVEL], card: 'first-hunt' } },
      { on: 'dug', match: { kind: 'statue' }, goal: 'Dig up the buried treasure',
        text: "Sail to the islet on yer map, find the X and dig. Ye'll know it when the shovel rings." },
    ],
    reward: { unlock: [SHOVEL] },
  },
  {
    id: 'bring-it-home',
    title: 'Bring It Home',
    text: "A treasure like that belongs in a town square, not in the sand. Carry it home.",
    steps: [
      { on: 'lifted', match: { kind: 'statue' }, goal: 'Lift the statue',
        text: "Two hands, and slow! She be heavy, that one." },
      { on: 'boarded', match: { kind: 'statue' }, goal: 'Put the statue on your boat',
        text: "Lay her on the boat, gentle now, and sail her home." },
      { on: 'delivered', match: { kind: 'statue' }, goal: 'Stand the statue in your town',
        text: "Set her down on the square where all can see." },
      { on: 'talked', match: { with: 'pirate' }, goal: 'Tell the pirate it is done',
        text: "Ha! Now that be a sight. Here, a colour fit for a captain." },
    ],
    reward: { unlock: ['sea-green'] },
  },
  {
    id: 'treasure-of-the-day',
    title: 'Treasure of the Day',
    repeat: true,
    text: "The sea brings a bottle when the village has been busy. Read the map, dig up the chest.",
    steps: [
      { on: 'dug', match: { kind: 'chest' }, goal: 'Dig up the chest on the map',
        text: "A bottle, a map, a chest. That be the whole trade." },
    ],
    reward: {},
  },
];

const questById = new Map(QUESTS.map((q) => [q.id, q]));
const ONCE = QUESTS.filter((q) => !q.repeat);
const KNOWN_UNLOCK = new Set(UNLOCK_IDS);

const emptyState = () => ({ v: QUEST_STATE_V, done: [], step: 0, repeats: {} });

// The quest a state is on: the first that is not finished, or the repeatable one once the
// story is told. Null when there is nothing left at all.
function activeOf(done) {
  return QUESTS.find((q) => q.repeat || !done.includes(q.id)) || null;
}

// Anything into a valid state, never throwing: a JSON string, an object from storage, or
// junk. Empty for junk and for a state from a newer version (an older page must not read a
// newer page's progress as its own and then save it back). Repaired for the rest: unknown
// quests dropped, `done` cut back to an unbroken run from the start of the story, the step
// held inside the active quest. Always a fresh object, so the caller may keep it.
export function parseQuestState(raw) {
  try {
    let s = raw;
    if (typeof s === 'string') s = JSON.parse(s);
    if (!s || typeof s !== 'object' || Array.isArray(s)) return emptyState();
    if (s.v !== QUEST_STATE_V) return emptyState();
    const said = new Set(Array.isArray(s.done) ? s.done : []);
    const done = [];
    for (const q of ONCE) { if (!said.has(q.id)) break; done.push(q.id); }
    const active = activeOf(done);
    const step = Number.isInteger(s.step) && active && s.step >= 0 && s.step < active.steps.length ? s.step : 0;
    const repeats = {};
    if (s.repeats && typeof s.repeats === 'object' && !Array.isArray(s.repeats)) {
      for (const q of QUESTS) {
        const n = s.repeats[q.id];
        if (q.repeat && Number.isInteger(n) && n > 0 && n < 1e9) repeats[q.id] = n;
      }
    }
    return { v: QUEST_STATE_V, done, step, repeats };
  } catch {
    return emptyState();
  }
}

// The quest definition the player is on now, or null.
export function activeQuest(state) {
  const s = parseQuestState(state);
  return activeOf(s.done);
}

// `{ quest, step, index }` - the quest, its current step and that step's number - or null.
export function activeStep(state) {
  const s = parseQuestState(state);
  const quest = activeOf(s.done);
  return quest ? { quest, step: quest.steps[s.step], index: s.step } : null;
}

// The quests finished, in the order of the story (the log's "done" list), and how many times
// each repeatable one has been.
export function completedQuests(state) {
  const s = parseQuestState(state);
  return s.done.map((id) => questById.get(id));
}
export function timesDone(state, questId) {
  return parseQuestState(state).repeats[questId] || 0;
}

const unlocksIn = (g) => (g && Array.isArray(g.unlock) ? g.unlock : []);

// Every id this progress has unlocked, in no particular order: the grants of finished steps
// (of the active quest, the ones before the current step) and the rewards of finished quests.
// Derived every time, so it can only say what the state supports.
export function unlocksOf(state) {
  const s = parseQuestState(state);
  const out = new Set();
  for (const id of s.done) {
    const q = questById.get(id);
    for (const st of q.steps) for (const u of unlocksIn(st.grant)) out.add(u);
    for (const u of unlocksIn(q.reward)) out.add(u);
  }
  const q = activeOf(s.done);
  if (q) for (let i = 0; i < s.step; i++) for (const u of unlocksIn(q.steps[i].grant)) out.add(u);
  return [...out].filter((u) => KNOWN_UNLOCK.has(u));
}

// Whether the pirate has something for the player right now - a step waiting on a word with
// him - which is what the exclamation mark over his head asks.
export function pirateHasBusiness(state) {
  const cur = activeStep(state);
  return !!cur && cur.step.on === 'talked' && cur.step.match && cur.step.match.with === 'pirate';
}

const matches = (step, ev) => {
  if (step.on !== ev.type) return false;
  for (const k of Object.keys(step.match || {})) if (ev[k] !== step.match[k]) return false;
  return true;
};

// Feed one event to a state. Returns `{ state, gained }`; the state is a new object and the
// input is never touched. An event that is not what the current step waits for changes
// nothing - saying it early is not remembered, and saying it late is not needed.
//
//   gained.unlocks     ids newly unlocked by this event (the toast, and the tile to open)
//   gained.cards       maps to hand over ('first-hunt'), from a step's `grant.card`
//   gained.stepDone    { quest, index } of the step this event completed, or null
//   gained.questDone   id of the quest it finished, or null
//   gained.next        the quest that is active now, or null
export function advance(state, event) {
  const before = parseQuestState(state);
  const gained = { unlocks: [], cards: [], stepDone: null, questDone: null, next: null };
  const ev = typeof event === 'string' ? { type: event } : event;
  const quest = activeOf(before.done);
  gained.next = quest ? quest.id : null;
  if (!quest || !ev || typeof ev !== 'object' || !QUEST_EVENTS.includes(ev.type)) return { state: before, gained };
  const step = quest.steps[before.step];
  if (!matches(step, ev)) return { state: before, gained };

  const after = { ...before, done: [...before.done], repeats: { ...before.repeats }, step: before.step + 1 };
  gained.stepDone = { quest: quest.id, index: before.step };
  if (step.grant && step.grant.card) gained.cards.push(step.grant.card);
  if (after.step >= quest.steps.length) {
    after.step = 0;
    gained.questDone = quest.id;
    if (quest.repeat) after.repeats[quest.id] = (after.repeats[quest.id] || 0) + 1;
    else after.done.push(quest.id);
  }
  const was = new Set(unlocksOf(before));
  gained.unlocks = unlocksOf(after).filter((u) => !was.has(u));
  const next = activeOf(after.done);
  gained.next = next ? next.id : null;
  return { state: after, gained };
}
