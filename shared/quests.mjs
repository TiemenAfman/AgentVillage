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
import { UNLOCK_IDS, SHOVEL, MINE_KEY } from './treasure.mjs';

export const QUEST_STATE_V = 1;

// What the page reports, as `{ type, ...detail }` (a bare string is `{ type }`):
//   talked     spoke to a person: { with: 'pirate' }
//   dug        finished digging:  { kind: 'statue' | 'chest' }
//   lifted     picked the statue up: { kind: 'statue' }
//   boarded    put it on the boat:   { kind: 'statue' }
//   delivered  stood it in the town: { kind: 'statue' }
//   drank      had a drink:          { where: 'piratetavern' } (the room it was ordered in)
//   dived      went under:           { depth } - units under the surface, once a dive
// The gold mine's (Plans/goudmijn-zoektocht.md), and `dug { kind: 'gem' }`:
//   entered    went into a place:    { where: 'goldmine' }
//   descended  took the stair down:  { floor } - the floor arrived on, 1 the top
//   found      took something up:    { kind: 'key' } (the gold mine's bottom floor)
//   sold       sold at a counter:    { what: 'gems' }
//   bought     bought at a counter:  { what: 'potion' }
// `with` in a talked event is who was spoken to: 'pirate' at his sea chest, one of the
// Salty Kraken's CREW ids below, or 'goldsmith' at his shop.
export const QUEST_EVENTS = ['talked', 'dug', 'lifted', 'boarded', 'delivered', 'drank', 'dived',
  'entered', 'descended', 'found', 'sold', 'bought'];

// A step waits for one event whose type is `on` and that carries every key of `match`, and, if
// it says so, at least `least` (`{ depth: 2 }`: ev.depth >= 2) and `times` of it altogether (a
// repeatable quest's one step that the same event completes has come round that often - how
// Three Chests counts the daily chests).
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
      { on: 'talked', match: { with: 'pirate' }, goal: 'Talk to the pirate at his sea chest',
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
      { on: 'boarded', match: { kind: 'statue' }, goal: 'Put the statue in the rowing boat',
        text: "There be a rowing boat by the islet. Walk her into it, gentle now, and row her home - or up to yer ship." },
      { on: 'delivered', match: { kind: 'statue' }, goal: 'Stand the statue in your town',
        text: "Set her down on the square where all can see." },
      { on: 'talked', match: { with: 'pirate' }, goal: 'Tell the pirate it is done',
        text: "Ha! Now that be a sight. Here, a colour fit for a captain." },
    ],
    reward: { unlock: ['sea-green'] },
  },
  // The Salty Kraken's chapters (Plans/piratenkroeg.md): each is one pirate's, and the mark hangs
  // over whoever the current step names.
  {
    id: 'a-round-for-the-crew',
    title: 'A Round for the Crew',
    text: "So ye found the Kraken. A crew drinks together or it be no crew at all. Get one in at the bar, and then we'll talk.",
    steps: [
      { on: 'talked', match: { with: 'captain' }, goal: 'Speak to Captain Spack Jarrow in the Salty Kraken',
        text: "Sit ye down. Old Meg pours the best grog this side o' the reef - go on, order one. For me, savvy?" },
      { on: 'drank', match: { where: 'piratetavern' }, goal: 'Order a drink at the bar of the Salty Kraken',
        text: "Dry work, talkin'. The bar be that way, and Meg don't bite. Much." },
      { on: 'talked', match: { with: 'captain' }, goal: 'Tell the Captain you have had your drink',
        text: "Ha! Now ye smell like one o' us. Purple as a drowned man's lips - wear it well." },
    ],
    reward: { unlock: ['kraken-purple'] },
  },
  {
    id: 'the-drowned-chart',
    title: 'The Drowned Chart',
    text: "I lost a chart overboard off the harbour mouth, where the water runs deep. Too deep for these old lungs. Not for yours.",
    steps: [
      { on: 'talked', match: { with: 'navigator' }, goal: 'Speak to Quill the navigator in the Salty Kraken',
        text: "Off the coast where the water turns dark. Swim out, hold C, and go down - two fathoms, no less." },
      { on: 'dived', least: { depth: 2 }, goal: 'Dive two fathoms under off the coast',
        text: "Deeper, matey. The chart lies where the light gives out." },
      { on: 'talked', match: { with: 'navigator' }, goal: 'Tell Quill what you found down there',
        text: "No chart? Aye - there never was one. I wanted to know ye'd go. Gold leaf, for a diver's coat." },
    ],
    reward: { unlock: ['gold-leaf'] },
  },
  {
    id: 'three-chests',
    title: 'Three Chests',
    text: "The bottles keep comin' and the chests keep waitin'. Dig three of 'em and I'll call ye crew.",
    steps: [
      { on: 'talked', match: { with: 'bosun' }, goal: 'Speak to Bosun Tarr in the Salty Kraken',
        text: "Every day this village works, the sea sends a bottle to the beach. Read the map, dig the chest. Three, mind." },
      { on: 'dug', match: { kind: 'chest' }, times: 3, goal: 'Have three chests dug up to your name',
        text: "Keep diggin'. The sea ain't done with ye yet." },
      { on: 'talked', match: { with: 'bosun' }, goal: 'Report to Bosun Tarr',
        text: "Three chests! Captain's red, that is - and don't let the Captain see ye in it before he's had his grog." },
    ],
    reward: { unlock: ['captain-red'] },
  },
  // The gold mine's line (Plans/goudmijn-zoektocht.md): the goldsmith's, open from the start and
  // told beside the pirate's story rather than after it - the keeper's wish. The shovel comes with
  // the first word, as the pirate's does, for a player who went to the mine before the beach.
  {
    id: 'into-the-mine',
    line: 'mine',
    title: 'Into the Mine',
    text: "That mine eats my ore faster than I can melt it, and the men down there keep the pretty stones for themselves. Dig me some, and I'll pay honest coin.",
    steps: [
      { on: 'talked', match: { with: 'goldsmith' }, goal: 'Speak to the goldsmith at his shop',
        text: "Here, take a shovel. E at the mine's mouth, and mind the rocks - nothing digs through those.",
        grant: { unlock: [SHOVEL] } },
      { on: 'entered', match: { where: 'goldmine' }, goal: 'Go into the gold mine',
        text: 'The mine is up the hill. Walk in at its mouth.' },
      { on: 'dug', match: { kind: 'gem' }, goal: 'Dig up a gemstone',
        text: 'Every spot of loose earth can hide a stone. Keep digging.' },
      { on: 'sold', match: { what: 'gems' }, goal: 'Sell your gems to the goldsmith',
        text: 'Bring them to my counter. I weigh fair.' },
      { on: 'talked', match: { with: 'goldsmith' }, goal: 'Talk to the goldsmith',
        text: "A natural! Here - a dye the colour of good ore, for a miner's coat." },
    ],
    reward: { unlock: ['miners-ochre'] },
  },
  {
    id: 'deeper-still',
    line: 'mine',
    title: 'Deeper Still',
    text: "The best stones lie deep. Somewhere under that earth is a shaft down - find it, and the next, and the next.",
    steps: [
      { on: 'talked', match: { with: 'goldsmith' }, goal: 'Speak to the goldsmith',
        text: "Three floors down the garnets start. You'll tire before that - the tavern sells a draught that puts the strength back in your arms." },
      { on: 'bought', match: { what: 'potion' }, goal: 'Buy a stamina potion at the tavern',
        text: 'Ask at the bar of the tavern. It costs, mind.' },
      { on: 'descended', least: { floor: 3 }, goal: 'Reach the third floor of the mine',
        text: "Nothing tells you where the shaft is - you dig until you hit it. Come out and you start at the top again, so remember where it was." },
      { on: 'talked', match: { with: 'goldsmith' }, goal: 'Tell the goldsmith how deep you went',
        text: 'Three floors! Then this garnet dye is yours - deep as the stones it comes from.' },
    ],
    reward: { unlock: ['deep-garnet'] },
  },
  {
    id: 'heart-of-the-mountain',
    line: 'mine',
    title: 'The Heart of the Mountain',
    text: "The old miners swore there was something at the very bottom, seven floors down. Not gold - older than gold. Bring it up and I'll tell you what it is.",
    steps: [
      { on: 'talked', match: { with: 'goldsmith' }, goal: 'Speak to the goldsmith',
        text: 'Go all the way down. Whatever lies on the last floor, bring it to me.' },
      { on: 'found', match: { kind: 'key' }, goal: 'Find what lies on the bottom floor',
        text: 'The bottom floor. Dig until there is no shaft left to find.' },
      { on: 'talked', match: { with: 'goldsmith' }, goal: 'Bring it to the goldsmith',
        text: "A key. Old iron, and no lock on this island it fits. Keep it - one day we will find the door." },
    ],
    // The key's door is not built yet (the keeper's: "nader te bepalen"): a quest that wants it asks
    // unlocks.js for MINE_KEY.
    reward: { unlock: [MINE_KEY] },
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

// The Salty Kraken's crew (Plans/piratenkroeg.md): who they are, what they are called and what
// they say when there is nothing in the story for them to say. Their seats and their looks are
// the room's (web/js/pirate-tavern.js); this is the part a quest step names in `with`.
export const CREW = [
  { id: 'captain', name: 'Captain Spack Jarrow', idle: [
    "Why is the rum always gone? ... Ah. That's why.",
    'This is the day ye will always remember as the day ye almost bought me a drink.',
    'Savvy?',
  ] },
  { id: 'navigator', name: 'Quill', idle: [
    'Charts lie, matey. The water never does.',
    'I can read the stars. Reading the Captain is harder.',
  ] },
  { id: 'bosun', name: 'Bosun Tarr', idle: [
    'Rope, tar and a strong back. That be a ship.',
    'Ye dig like a landsman. Slower.',
  ] },
  { id: 'gunner', name: 'Powder Annie', idle: [
    "Don't touch the cannon. She's loaded. Probably.",
    "Meg waters the rum. I've measured it.",
  ] },
  { id: 'lookout', name: 'Sparrow', idle: [
    'I saw yer boat come in. Ye steer like a drunk gull.',
    "Nothin' on the horizon but weather, matey.",
  ] },
  { id: 'cook', name: 'Salt Pete', idle: [
    "Fish stew. It's always fish stew.",
    "The bitterballen are Meg's. The rest is mine, and ye'll eat it.",
  ] },
];
export const CREW_IDS = CREW.map((c) => c.id);
// Everybody a step may name in `with`: the pirate, the crew, and the goldsmith whose line the gold
// mine is.
export const GIVERS = ['pirate', ...CREW_IDS, 'goldsmith'];

const questById = new Map(QUESTS.map((q) => [q.id, q]));
// The quest lines (Plans/goudmijn-zoektocht.md): a quest's `line` says which story it is part of,
// 'story' when it says nothing - the pirate's, then the Kraken's. Every line runs at once and on its
// own: the gold mine's does not wait for the Kraken, and the Kraken does not wait for the mine. In
// order of the table, the story first.
export const STORY = 'story';
export const lineOf = (q) => (q && q.line) || STORY;
const ONCE = QUESTS.filter((q) => !q.repeat);
export const LINES = [...new Set(ONCE.map(lineOf))];
const onceOf = new Map(LINES.map((l) => [l, ONCE.filter((q) => lineOf(q) === l)]));
// The repeatable quests: one step each (tests/quests.test.mjs holds that), counted whatever the
// story is doing - or an island with no Salty Kraken would stop the chest of the day for good as
// soon as the story waited on somebody in it.
const REPEATS = QUESTS.filter((q) => q.repeat);
const KNOWN_UNLOCK = new Set(UNLOCK_IDS);

// `step` is the story's step, as it always was; `lines` the step of every other line, by name -
// absent for a line on its first step, so a state with no other line in it reads as it did.
const emptyState = () => ({ v: QUEST_STATE_V, done: [], step: 0, repeats: {}, lines: {} });

// The quest of `line` a state is on: its first that is not finished, or null once it is told.
function lineQuest(done, line) {
  return (onceOf.get(line) || []).find((q) => !done.includes(q.id)) || null;
}
// The quest a state is on: the story's first that is not finished, or the repeatable one once
// the story is told. Null when there is nothing left at all. The story's alone: every other line
// is asked by name (activeStep(state, line)).
function activeOf(done) {
  return lineQuest(done, STORY) || REPEATS[0] || null;
}
const stepOf = (s, line) => (line === STORY ? s.step : (s.lines[line] || 0));

// Anything into a valid state, never throwing: a JSON string, an object from storage, or
// junk. Empty for junk and for a state from a newer version (an older page must not read a
// newer page's progress as its own and then save it back). Repaired for the rest: unknown
// quests dropped, `done` cut back to an unbroken run from the start of each line, every step
// held inside its line's active quest. Always a fresh object, so the caller may keep it.
// A page from before the lines reads a state with a mine in it as the story alone - the mine's
// ids are no quests it knows, and `lines` no key it keeps - which costs that browser its mine
// progress on a downgrade, and nothing else.
export function parseQuestState(raw) {
  try {
    let s = raw;
    if (typeof s === 'string') s = JSON.parse(s);
    if (!s || typeof s !== 'object' || Array.isArray(s)) return emptyState();
    if (s.v !== QUEST_STATE_V) return emptyState();
    const said = new Set(Array.isArray(s.done) ? s.done : []);
    const done = [];
    for (const line of LINES) {
      for (const q of onceOf.get(line)) { if (!said.has(q.id)) break; done.push(q.id); }
    }
    const fit = (n, q) => (Number.isInteger(n) && q && n >= 0 && n < q.steps.length ? n : 0);
    const story = activeOf(done);
    const step = fit(s.step, story);
    const lines = {};
    const said2 = s.lines && typeof s.lines === 'object' && !Array.isArray(s.lines) ? s.lines : {};
    for (const line of LINES) {
      if (line === STORY) continue;
      const n = fit(said2[line], lineQuest(done, line));
      if (n) lines[line] = n;
    }
    const repeats = {};
    if (s.repeats && typeof s.repeats === 'object' && !Array.isArray(s.repeats)) {
      for (const q of QUESTS) {
        const n = s.repeats[q.id];
        if (q.repeat && Number.isInteger(n) && n > 0 && n < 1e9) repeats[q.id] = n;
      }
    }
    return { v: QUEST_STATE_V, done, step, repeats, lines };
  } catch {
    return emptyState();
  }
}

// The quest definition the player is on now in `line` (the story's, or the repeatable one once
// it is told), or null.
export function activeQuest(state, line = STORY) {
  const s = parseQuestState(state);
  return line === STORY ? activeOf(s.done) : lineQuest(s.done, line);
}

// `{ quest, step, index }` - the quest, its current step and that step's number - or null.
export function activeStep(state, line = STORY) {
  const s = parseQuestState(state);
  const quest = line === STORY ? activeOf(s.done) : lineQuest(s.done, line);
  if (!quest) return null;
  const index = quest.repeat ? 0 : stepOf(s, line);
  return { quest, step: quest.steps[index], index };
}

// Every line's current step, the story first: `[{ line, quest, step, index }]`, a told line left out.
export function activeSteps(state) {
  const out = [];
  for (const line of LINES) {
    const a = activeStep(state, line);
    if (a) out.push({ line, ...a });
  }
  return out;
}

// The quests finished, in the order of the table (the log's "done" list), and how many times
// each repeatable one has been.
export function completedQuests(state) {
  const s = parseQuestState(state);
  return QUESTS.filter((q) => s.done.includes(q.id));
}
export function timesDone(state, questId) {
  return parseQuestState(state).repeats[questId] || 0;
}

const unlocksIn = (g) => (g && Array.isArray(g.unlock) ? g.unlock : []);

// Every id this progress has unlocked, in no particular order: the grants of finished steps
// (of each line's active quest, the ones before its current step) and the rewards of finished
// quests. Derived every time, so it can only say what the state supports.
export function unlocksOf(state) {
  const s = parseQuestState(state);
  const out = new Set();
  for (const id of s.done) {
    const q = questById.get(id);
    for (const st of q.steps) for (const u of unlocksIn(st.grant)) out.add(u);
    for (const u of unlocksIn(q.reward)) out.add(u);
  }
  for (const line of LINES) {
    const q = line === STORY ? activeOf(s.done) : lineQuest(s.done, line);
    if (q && !q.repeat) for (let i = 0; i < stepOf(s, line); i++) for (const u of unlocksIn(q.steps[i].grant)) out.add(u);
  }
  return [...out].filter((u) => KNOWN_UNLOCK.has(u));
}

const talkOf = (step) => (step && step.on === 'talked' && step.match && step.match.with ? step.match.with : null);

// Who has something for the player right now in the story - the `with` of a step waiting on a
// word - or null: what the exclamation mark over a head asks, outside at the chest and inside the
// Kraken. `hasBusiness(state, who)` asks every line: the goldsmith's mark is the mine's.
export function businessWith(state) {
  const cur = activeStep(state);
  return cur ? talkOf(cur.step) : null;
}
export function hasBusiness(state, who) {
  return activeSteps(state).some((a) => talkOf(a.step) === who);
}
export function pirateHasBusiness(state) {
  return businessWith(state) === 'pirate';
}
// Whose quest it is: the one the first word in it is with.
export function giverOf(quest) {
  const s = quest && quest.steps.find((st) => st.on === 'talked' && st.match && st.match.with);
  return s ? s.match.with : null;
}

// Whether `ev` does `step`. `after` is the state with this event's repeats already counted, for
// a `times` step to read.
const matches = (step, ev, after = null) => {
  if (step.on !== ev.type) return false;
  for (const k of Object.keys(step.match || {})) if (ev[k] !== step.match[k]) return false;
  for (const k of Object.keys(step.least || {})) {
    if (typeof ev[k] !== 'number' || !(ev[k] >= step.least[k])) return false;
  }
  if (step.times != null) {
    const q = REPEATS.find((r) => matches(r.steps[0], ev));
    if (!q || !after || !((after.repeats[q.id] || 0) >= step.times)) return false;
  }
  return true;
};

// Feed one event to a state. Returns `{ state, gained }`; the state is a new object and the
// input is never touched. An event that is not what a current step waits for changes nothing -
// saying it early is not remembered, and saying it late is not needed - except that a
// repeatable quest counts whenever its step is done, whatever the story is waiting for. Every
// line is offered the event, so one event may move two of them.
//
//   gained.unlocks     ids newly unlocked by this event (the toast, and the tile to open)
//   gained.cards       maps to hand over ('first-hunt'), from a step's `grant.card`
//   gained.stepDone    { quest, index } of the step this event completed, or null; a repeatable
//                      that was all this event moved reads as its step 0 done. The first of
//                      `gained.steps`, which has every one (story first).
//   gained.questDone   id of the quest it finished, or null (a repeatable, likewise); the first
//                      of `gained.quests`
//   gained.repeated    ids of the repeatable quests this event counted once more
//   gained.next        the story's quest that is active now, or null
export function advance(state, event) {
  const before = parseQuestState(state);
  const gained = {
    unlocks: [], cards: [], stepDone: null, questDone: null, steps: [], quests: [], repeated: [], next: null,
  };
  const ev = typeof event === 'string' ? { type: event } : event;
  const story = activeOf(before.done);
  gained.next = story ? story.id : null;
  if (!ev || typeof ev !== 'object' || !QUEST_EVENTS.includes(ev.type)) return { state: before, gained };

  const after = { ...before, done: [...before.done], repeats: { ...before.repeats }, lines: { ...before.lines } };
  for (const q of REPEATS) {
    if (!matches(q.steps[0], ev)) continue;
    after.repeats[q.id] = (after.repeats[q.id] || 0) + 1;
    gained.repeated.push(q.id);
  }
  for (const line of LINES) {
    const q = lineQuest(before.done, line);
    if (!q) continue;
    const at = stepOf(before, line);
    const step = q.steps[at];
    if (!matches(step, ev, after)) continue;
    let next = at + 1;
    gained.steps.push({ quest: q.id, index: at });
    if (step.grant && step.grant.card) gained.cards.push(step.grant.card);
    if (next >= q.steps.length) {
      next = 0;
      gained.quests.push(q.id);
      after.done.push(q.id);
    }
    if (line === STORY) after.step = next;
    else if (next) after.lines[line] = next;
    else delete after.lines[line];
  }
  if (!gained.steps.length && !gained.repeated.length) return { state: before, gained };
  if (!gained.steps.length) {
    gained.steps.push({ quest: gained.repeated[0], index: 0 });
    gained.quests.push(gained.repeated[0]);
  }
  gained.stepDone = gained.steps[0];
  gained.questDone = gained.quests[0] || null;
  // Kept in the table's order whatever order the lines finished in, as parseQuestState would.
  after.done = QUESTS.filter((q) => after.done.includes(q.id)).map((q) => q.id);
  const was = new Set(unlocksOf(before));
  gained.unlocks = unlocksOf(after).filter((u) => !was.has(u));
  const next = activeOf(after.done);
  gained.next = next ? next.id : null;
  return { state: after, gained };
}
