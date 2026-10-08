// The one list of everything a player can unlock to wear or hold (Plans/schatkaarten.md,
// "Modulaire uitrusting"). It is data only and touches nothing of the browser, so the tests,
// the quest table and the avatar can all ask it the same questions.
//
// Two statuses, and the difference is the whole point:
//   'live'     drawn: the piece has a tile in the inventory's picker and a drawing function
//              (`render` names it - for a hand item a key of HELD_ITEM_PROCEDURAL in
//              web/js/classic-avatar.js). A live piece with nothing to draw it fails a test.
//   'planned'  a line of data and nothing else: no tile, no rig, no id the look accepts. It is
//              here so the quests can already promise it and the slot it will need is known.
// Adding a piece later is therefore one line here plus one drawing function, never a change
// to the picker or to normalizeAvatar (avatar.js derives HAND_ITEMS and PLAYER_HAT_SHAPES from
// liveOf()).
//
// `unlock` is the id a quest hands out (shared/quests.mjs `grant.unlock`) and the browser
// remembers (web/js/unlocks.js). It is usually the piece's own id, but it is its own field so
// one reward can open several pieces one day. A piece without an `unlock` is simply owned by
// everybody - the pieces that existed before unlocking did (parasol, sword...) are not listed
// at all and count as owned: unlockOf() gives null for them.

// `boat` is the paint the dock's yard will offer (Plans/schatkaarten.md, "Idee: scheepsaanpassing");
// it has no live piece yet, but the slot is named here so its tiles arrive by the same road.
export const SLOTS = ['head', 'face', 'hand', 'leg', 'shoulder', 'back', 'boat'];

export const EQUIPMENT = [
  // `hint` is what a locked tile says under its silhouette: where the piece comes from.
  { id: 'shovel', slot: 'hand', name: 'Shovel', icon: '⛏️', unlock: 'shovel', status: 'live', render: 'shovel',
    hint: 'From the pirate' },

  { id: 'tricorn', slot: 'head', name: 'Tricorn', unlock: 'tricorn', status: 'planned' },
  { id: 'bandana', slot: 'head', name: 'Bandana', unlock: 'bandana', status: 'planned' },
  { id: 'eyepatch', slot: 'face', name: 'Eyepatch', unlock: 'eyepatch', status: 'planned' },
  { id: 'beard', slot: 'face', name: 'Beard', unlock: 'beard', status: 'planned' },
  // Replaces the hand instead of sitting in it, so it will need its own variant of the two
  // hand parts rather than a held item (`replaces` names what it takes the place of).
  { id: 'hook', slot: 'hand', name: 'Hook', unlock: 'hook', status: 'planned', replaces: 'hand' },
  { id: 'peg-leg', slot: 'leg', name: 'Peg leg', unlock: 'peg-leg', status: 'planned' },
  // A companion with an idle of its own, not a garment: the fauna system may move it later.
  { id: 'parrot', slot: 'shoulder', name: 'Parrot', unlock: 'parrot', status: 'planned' },
  { id: 'spyglass', slot: 'hand', name: 'Spyglass', unlock: 'spyglass', status: 'planned' },
  // The gold mine's key (Plans/goudmijn-zoektocht.md): owned once the bottom floor is reached, drawn
  // once there is a door for it.
  { id: 'mine-key', slot: 'hand', name: 'Old iron key', unlock: 'mine-key', status: 'planned' },
];

const BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

export const byId = (id) => BY_ID.get(id) || null;

// The pieces of `slot` that are drawn, in catalogue order - what the picker and the look accept.
export const liveOf = (slot) => EQUIPMENT.filter((e) => e.slot === slot && e.status === 'live');

// Every id a quest can unlock for a piece of equipment (planned ones included: the quest table
// may promise them before they are drawn), each once.
export const unlockIds = () => [...new Set(EQUIPMENT.map((e) => e.unlock).filter(Boolean))];

// The unlock id a piece needs, or null when everybody has it (also for an id not in the
// catalogue: the pieces from before unlocking are not listed).
export const unlockOf = (id) => BY_ID.get(id)?.unlock || null;
