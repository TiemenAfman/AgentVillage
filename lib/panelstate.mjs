// What the boards on the island say, held by the server.
//
// This is a deliberate break with the line at the top of lib/players.mjs - "the server
// relays and nothing else". Until now every client was authoritative over itself and
// the server passed messages along without understanding any of them. A shared panel
// cannot work that way: somebody who walks up five minutes late has to see the board
// the others are looking at, and there is nowhere but here for that to be remembered.
//
// So this is the first piece of *world* state the server owns, and it is kept as small
// as it can be. It is not persisted: it lives as long as the process, because a tally
// on a board is a conversation, not a record. Nothing here knows what a field means -
// shared/panels.mjs says what may be stored, and that file is read by the browser too,
// so the two halves cannot drift.
//
// One driver at a time is part of the same idea. It is not a lock over the data, which
// would need no server at all when every write is "this field is now that value"; it is
// there so that two people at one board can see who is working it.
import { startState, applyUi, knownFace } from '../shared/panels.mjs';

export function createPanelState({ faces = () => new Map() } = {}) {
  const boards = new Map();   // panel id -> { face, state, driver }

  // A board is made the first time somebody touches it, not when it is put up: an
  // island with fifty notice boards on it should carry fifty empty objects only if
  // fifty of them have been used.
  function board(id) {
    const have = boards.get(id);
    if (have) return have;
    const face = faces().get(id);
    if (!face || !knownFace(face)) return null;
    const made = { face, state: startState(face), driver: null };
    boards.set(id, made);
    return made;
  }

  // Everything worth handing a new arrival: the boards somebody has already changed or
  // is standing at. An untouched board is left out - the browser starts it from the
  // same shared/panels.mjs the server did, so sending it would say nothing.
  function snapshot() {
    const out = [];
    for (const [id, b] of boards) out.push({ id, state: b.state, driver: b.driver });
    return out;
  }

  // Returns what changed, for relaying on, or null if the message was not one this
  // board will take. A refusal is silent on purpose: it is either an old page or
  // somebody poking at the socket, and neither is owed an explanation.
  function apply(id, action, value) {
    const b = board(id);
    if (!b) return null;
    const v = applyUi(b.face, b.state, action, value);
    if (v === null) return null;
    return { id, a: action, v };
  }

  // Whoever presses E has the board. Somebody else already holding it is not refused
  // loudly - they are simply told who has it, and their own page steps back.
  function take(id, who) {
    const b = board(id);
    if (!b) return null;
    if (b.driver && b.driver !== who) return { id, driver: b.driver };
    b.driver = who;
    return { id, driver: who };
  }

  function drop(id, who) {
    const b = boards.get(id);
    if (!b || b.driver !== who) return null;
    b.driver = null;
    return { id, driver: null };
  }

  // Somebody has gone - walked back up to the map, closed the tab, or lost the line.
  // Every board they were holding is free again, or the next person to come along finds
  // a board nobody is standing at that nobody can use.
  function released(who) {
    const out = [];
    for (const [id, b] of boards) {
      if (b.driver !== who) continue;
      b.driver = null;
      out.push({ id, driver: null });
    }
    return out;
  }

  // A board that has been taken off the island takes its state with it.
  function forget(ids) {
    const keep = new Set(ids);
    for (const id of [...boards.keys()]) if (!keep.has(id)) boards.delete(id);
  }

  return { snapshot, apply, take, drop, released, forget, count: () => boards.size };
}
