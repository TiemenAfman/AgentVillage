// Where the island's boats are, held by the server.
//
// lib/panelstate.mjs broke "the server relays and nothing else" for a reason that applies
// here word for word, so its header is the long version of this one. A boat is shared in
// exactly the way a notice board is: somebody who walks down to the water five minutes
// late has to find the boat where the last person left it, and there is nowhere but the
// server for that to be remembered. This is the second piece of *world* state the server
// owns, and it is deliberately the same shape as the first.
//
// A boat is owned by nobody. It is not a settler's property and there is no key: a moored
// boat is visible to everybody and whoever gets to it first may sail. That is the whole of
// take/drop, which is the panels' claiming rule with the words changed - not a lock over
// the data (every write is "the boat is now here", which needs no locking), but a way for
// two people at one jetty to see whose hand is on the tiller.
//
// Not persisted, and here that is sharper than it is for a board. Boats go back to their
// moorings when the process restarts: a fleet scattered across the channel by whoever
// happened to be online last is a worse island to arrive on than one with a boat at the
// jetty, and the moorings are the one arrangement that is always readable. It also means
// nothing on disk can strand the crossing.
//
// One pilot per boat, and passengers are out of scope. A second body in the hull needs a
// seat drawn for it, a rule for where it is put down when the pilot moors, and an answer
// to what happens to it when the pilot's tab closes mid-channel - three rules the crossing
// does not need in order to work, and three ways to be left standing on water.

// How long a boat nobody is sailing sits where it was left before it drifts back to its
// mooring on its own. Without this, the one boat an island has could be marooned on the
// far shore for good by whoever stepped off and never came back - and unlike a restart,
// which nobody waits around for, this is the fix that reaches somebody standing at the
// jetty right now.
const IDLE_HOME_MS = 5 * 60 * 1000;

// The id shape a boat is known by. Narrow like PANEL_ID in lib/players.mjs and for the
// same reason: on a --public island this arrives from a stranger's socket.
const BOAT_ID = /^boat:[a-z0-9-]{1,32}$/;
// Whoever is sailing it: the twelve hex characters lib/ws.mjs hands a connection, with
// room for a uuid should that ever change.
const PILOT_ID = /^[0-9a-f-]{1,36}$/;

// How far from the middle of the world a boat may claim to be, and how far round. The same
// two ceilings lib/players.mjs puts on a pose, because a boat's position is one.
const BOUND = 200;
const YAW_LIMIT = 1e4;

// Insisting on an actual number, not something that merely converts to one. The copy is
// deliberate: this is lib/players.mjs:46-49, and it lives there for the same reason it
// lives here - JSON turns NaN and Infinity into null on the way out, and Number(null) is a
// perfectly finite zero, so a coercing check would quietly moor a boat in the middle of
// the island instead of rejecting the message. Importing it from players.mjs would point
// the dependency backwards: that file is the one that will be calling this.
function num(v, limit) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(-limit, Math.min(limit, v));
}

// `moorings` is the deterministic starting set - [{ id, x, z, yaw }] worked out by the
// caller from the island itself, so that the server and every browser put an untouched
// boat in the same place without a message being sent about it.
export function createBoats({ moorings = [], bound = BOUND } = {}) {
  const home = new Map();     // boat id -> { x, z, yaw }, where it belongs
  for (const m of moorings) {
    const id = m && m.id;
    // A bad id off the wire is ignored in silence below; a bad id in the moorings is a
    // caller with a bug, and a fleet that quietly refuses every message is a long evening.
    if (typeof id !== 'string' || !BOAT_ID.test(id)) {
      throw new Error(`a mooring needs a boat:… id, not ${JSON.stringify(id)}`);
    }
    if (home.has(id)) throw new Error(`two moorings for ${id}`);
    const x = num(m.x, bound), z = num(m.z, bound), yaw = num(m.yaw === undefined ? 0 : m.yaw, YAW_LIMIT);
    if (x === null || z === null || yaw === null) throw new Error(`mooring ${id} is not a place`);
    home.set(id, { x, z, yaw });
  }

  const boats = new Map();    // boat id -> { x, z, yaw, pilot }

  // The fleet as it is now. An island arrives in the harbour and sails home again while the
  // server runs, so the moorings are not settled once: without this a boat would be held in
  // open water for an island that has gone, and an island that has just arrived would have
  // none at all.
  //
  // A boat somebody has a hand on is left exactly as it is - re-mooring it under a pilot
  // would snatch it back across the channel mid-crossing. One nobody is touching has not
  // been made yet, so there is nothing to move: it is at whatever its mooring now says.
  // Returns the boats that stopped existing, for the caller to tell everybody about.
  function moor(list) {
    const wanted = new Map();
    for (const m of list || []) {
      const id = m && m.id;
      if (typeof id !== 'string' || !BOAT_ID.test(id)) continue;
      const x = num(m.x, bound), z = num(m.z, bound), yaw = num(m.yaw === undefined ? 0 : m.yaw, YAW_LIMIT);
      if (x === null || z === null || yaw === null) continue;
      wanted.set(id, { x, z, yaw });
    }
    const gone = [];
    for (const id of [...home.keys()]) {
      if (wanted.has(id)) continue;
      home.delete(id);
      const had = boats.get(id);
      if (had) { boats.delete(id); gone.push({ id, x: had.x, z: had.z, yaw: had.yaw, pilot: null, gone: true }); }
    }
    for (const [id, at] of wanted) {
      if (!home.has(id)) home.set(id, at);
      // An existing mooring is left where it was: moving it would shift a boat nobody has
      // touched, which is the one thing both sides currently agree about for free.
    }
    return gone;
  }

  // A boat is made here the first time somebody touches it, not when the island puts it
  // out - exactly as a board is. Until then it is at its mooring, and the page works that
  // out from the same list the server was given. The set of ids that can ever get this far
  // is the moorings, so this map cannot outgrow the fleet however hard a socket is poked.
  function boat(id) {
    if (typeof id !== 'string' || !BOAT_ID.test(id)) return null;
    const have = boats.get(id);
    if (have) return have;
    const at = home.get(id);
    if (!at) return null;
    const made = { x: at.x, z: at.z, yaw: at.yaw, pilot: null, freedAt: null };
    boats.set(id, made);
    return made;
  }

  const pilot = (who) => (typeof who === 'string' && PILOT_ID.test(who) ? who : null);
  const state = (id, b) => ({ id, x: b.x, z: b.z, yaw: b.yaw, pilot: b.pilot });

  // Everything worth handing a new arrival: the boats somebody has moved or is sailing. A
  // boat nobody has touched is left out, because saying "it is at its mooring" tells a page
  // that already has the moorings nothing at all.
  function snapshot() {
    const out = [];
    for (const [id, b] of boats) out.push(state(id, b));
    return out;
  }

  // First hand on the tiller wins. A second claimant is not refused loudly - they are told
  // who has it, the way a board's driver is, and their own page steps back. The position
  // rides along: whoever is about to steer needs to know where they are steering from, and
  // whoever was refused gets a free correction out of the same message.
  //
  // Nothing here stops one person holding two boats. Neither does a panel, the client only
  // steers one, and both drop and release free every boat they hold - so the cost of the
  // rule would be more than the cost of the case.
  function take(id, who) {
    const by = pilot(who);
    if (!by) return null;
    const b = boat(id);
    if (!b) return null;
    if (b.pilot && b.pilot !== by) return state(id, b);
    b.pilot = by;
    b.freedAt = null;
    return state(id, b);
  }

  // Mooring it. The last position travels with the release so that every page puts the
  // boat where the server has it rather than wherever its own last snapshot left off.
  function drop(id, who) {
    const by = pilot(who);
    const b = by && boats.get(id);
    if (!b || b.pilot !== by) return null;
    b.pilot = null;
    b.freedAt = Date.now();
    return state(id, b);
  }

  // While a boat is taken, its pilot's position is the boat's. This is the one piece of
  // world state a client is allowed to write, so it is worth being exact about who is
  // writing it: anybody who is not the pilot is not read at all. A boat nobody has taken
  // cannot be moved either, which is why this asks the map rather than `boat()` - a stray
  // message about an untouched boat should not so much as create a row.
  function moved(id, by, x, z, yaw) {
    const who = pilot(by);
    const b = who && boats.get(id);
    if (!b || b.pilot !== who) return null;
    const nx = num(x, bound), nz = num(z, bound), ny = num(yaw, YAW_LIMIT);
    if (nx === null || nz === null || ny === null) return null;
    b.x = nx;
    b.z = nz;
    b.yaw = ny;
    return { id, x: nx, z: nz, yaw: ny };
  }

  // Somebody has gone - walked back up to the map, closed the tab, or lost the line. Every
  // boat they were sailing is free again, or the next person down to the water finds a
  // boat nobody is in that nobody can take. It is freed where it floats rather than sent
  // home: a boat whose pilot shut their laptop mid-channel is a boat mid-channel, and
  // pretending otherwise would teleport it out from under anybody watching. That it is
  // back at its mooring after a restart is the other half of the same answer.
  function release(playerId) {
    const who = pilot(playerId);
    if (!who) return [];
    const out = [];
    for (const [id, b] of boats) {
      if (b.pilot !== who) continue;
      b.pilot = null;
      b.freedAt = Date.now();
      out.push(state(id, b));
    }
    return out;
  }

  // A boat nobody has a hand on, and has not had one for a while, drifts back to its own
  // mooring - never one anybody is sailing, and never sooner than IDLE_HOME_MS, so putting
  // it down for a minute to have a look at the view is not mistaken for abandoning it. Only
  // boats away from home are worth a message; one already there has nothing to say.
  function driftHome(now = Date.now()) {
    const out = [];
    for (const [id, b] of boats) {
      if (b.pilot || b.freedAt == null || now - b.freedAt < IDLE_HOME_MS) continue;
      const at = home.get(id);
      if (!at) continue;
      b.freedAt = null;
      if (b.x === at.x && b.z === at.z && b.yaw === at.yaw) continue;
      b.x = at.x; b.z = at.z; b.yaw = at.yaw;
      out.push(state(id, b));
    }
    return out;
  }

  // A boat that has been taken off the island takes its position with it. The moorings are
  // left alone: they are the caller's list, fixed for the life of the process, which is
  // also exactly how long anything in here lives.
  function forget(ids) {
    const keep = new Set(ids);
    for (const id of [...boats.keys()]) if (!keep.has(id)) boats.delete(id);
  }

  return { snapshot, take, drop, moved, release, forget, moor, driftHome, count: () => boats.size };
}
