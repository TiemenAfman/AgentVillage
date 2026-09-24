// Who is walking the island right now. The server relays, and - since the boards went
// up - remembers one thing. It does not integrate movement, it does not test collisions,
// it never touches the terrain. Every client is authoritative over its own feet, which
// for a village is the right trade: the worst a liar can do here is hover.
//
// The one exception is what the boards say, which cannot be anybody's alone or a late
// arrival would look at a blank panel until somebody pressed something. That lives in
// lib/panelstate.mjs, with the reasoning for the break.
//
// What the server does own throughout is the limits, because a socket on an open port
// is a socket anyone can shout into.
import { seededName } from './words.mjs';
import { createPanelState } from './panelstate.mjs';
import { createBoats } from './boats.mjs';

const STYLES = ['fable', 'opus', 'sonnet', 'haiku', 'unknown'];

// The bits a pose's `f` may carry. web/js/net.js sets the first four and has since poses
// existed; BLOCKING is the right mouse button held (Plans/aanvallen-en-blokkeren.md), and
// it is the first of them the sea acts on rather than only relays: a guard's blow on a
// player who is blocking it costs a fraction (lib/hostility.mjs). SHIELD_LEFT and
// SHIELD_RIGHT say which hands carry a shield, raised or not: armour, each hand's worth
// taken off every blow from an agent (lib/hostility.mjs armorOf). RIDING is a bicycle under
// the player (web/js/bicycle.js, Plans/fiets.md): relayed only, for peers.js to draw. Anything
// above these is dropped here, so a client cannot smuggle a flag the next version might give a meaning to.
export const POSE = Object.freeze({ MOVING: 1, SWIMMING: 2, RUNNING: 4, AIRBORNE: 8, BLOCKING: 16, SHIELD_LEFT: 32, SHIELD_RIGHT: 64, RIDING: 128 });
const POSE_MASK = 255;

// A little over twice the ten poses a second a client should be sending, so a stutter in
// the browser never trips the limit but a flood still does.
const BUCKET_SIZE = 40;
const BUCKET_REFILL = 25;
const IDLE_MS = 60000;
const ROSTER_MS = 5000;

// Names are drawn into a canvas, not into the page, so this is not an escaping problem -
// but a control character still wrecks the text metrics, and a name as wide as the screen
// is its own kind of nuisance.
//
// What somebody says goes through here too, at its own length. The same control and
// invisible characters are worth taking out of a sentence, and for the same reason that
// is not the escaping: that happens where it lands, in the page.
function clean(name, max = 18) {
  let out = '';
  for (const ch of String(name || '')) {
    const c = ch.codePointAt(0);
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    const invisible = (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || c === 0xfeff;
    if (!control && !invisible) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

// Insisting on an actual number, not something that merely converts to one. JSON turns
// NaN and Infinity into null on the way out, and Number(null) is a perfectly finite zero,
// so a coercing check would quietly teleport a player to the middle of the island instead
// of rejecting the message.
function num(v, limit) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(-limit, Math.min(limit, v));
}

// Which room a player is standing in, if any. It decides which scene everybody else draws
// them into, so it is worth being narrow about. Anything that does not fit is treated as
// outdoors rather than rejected -- a bad room is not worth dropping a pose over.
//
// A bare slug used to be enough, because there was one island and therefore one tavern.
// In a sea there are several, and `tavern` on its own would put a visitor to Tiemen's
// tavern inside ours on our screen. So a room may now be prefixed by the island it is on:
// `<islandId>:tavern`. The bare form still passes, which is what keeps a single-island
// island working unchanged and an older client from being dropped mid-pose.
const ROOM_SLUG = /^[a-z][a-z0-9-]{0,15}$/;
export function room(v) {
  if (typeof v !== 'string') return null;
  const i = v.lastIndexOf(':');
  if (i < 0) return ROOM_SLUG.test(v) ? v : null;
  const where = v.slice(0, i);
  const slug = v.slice(i + 1);
  return ISLAND_KEY.test(where) && ROOM_SLUG.test(slug) ? `${where}:${slug}` : null;
}

// An island id as it appears in a scoped key: the same shape lib/islandbundle.mjs insists
// on for an island, so a key cannot name something that could never be an island.
const ISLAND_KEY = /^[a-f0-9]{8,64}$/;

const round = (v) => Math.round(v * 1000) / 1000;

// A cursor on a board is carried by the pose beat rather than sent on its own. That
// stream is already rate limited and already arrives ten times a second, so a hand
// moving over a panel costs nothing extra and cannot trip the bucket - which does not
// throttle, it closes the socket.
// A board, optionally said to be on a particular island. Prop ids are eight hex digits
// drawn per island, so two islands colliding on one is unlikely rather than impossible -
// and "unlikely" is not a good enough reason for two keepers to share a noticeboard.
const PANEL_ID = /^(?:[a-f0-9]{8,64}:)?prop:[0-9a-f-]{1,36}$/;
const ACTION = /^[a-z][a-z0-9-]{0,15}$/;
// Long enough for the longest field any face has (see shared/panels.mjs, which cuts it
// again to that field's own length); short enough that a socket cannot be used to post
// a novel into somebody else's page.
const MAX_TEXT = 240;
// A sentence said out loud on the island. Shorter than a panel field on purpose: this one
// lands in everybody else's log, and a paragraph there is a way of taking the floor.
const MAX_SAY = 200;

export function createRoster({
  maxPlayers = 16, bound = 200, panelFaces = () => new Map(),
  // How long a body may stand without a word before it is taken for a statue - see the
  // idle sweep in tick(). An option only so a test does not have to wait a minute for it.
  idleMs = IDLE_MS,
  // The moorings every island's boat starts from, worked out by the caller from the islands
  // themselves (shared/quay.mjs). Handed in rather than computed here because this file
  // knows about people and not about coastlines.
  moorings = [],
  // Walking up to a settler and being looked back at. Handed in for the same reason
  // `moorings` is: this file knows about people, and which settler is standing where is
  // the crowd's business (lib/crowd.mjs), not this one's.
  attend = () => false,
  releaseAttention = () => false,
  // A swing of the player's own weapon (`{t:'swing'}`). Handed in for the same reason
  // `attend` is: who is standing in front of whom, and what a blow does to them, is the
  // sea's combat (lib/combat.mjs), not this file's. The message carries nothing - the
  // position and the heading are the player's last pose, which this file already holds.
  swing = () => false,
  log = () => {},
} = {}) {
  const players = new Map();   // conn.id -> player
  const panels = createPanelState({ faces: panelFaces });
  // The second piece of world state the server owns; lib/boats.mjs says why.
  const boats = createBoats({ moorings, bound });
  let lastRoster = 0;

  // `island` is which coast this body belongs over. A client says which island it came
  // from when it joins; a wanderer with no islander of its own says nothing and gets null,
  // which is a perfectly good answer - it just means nobody's nameplate claims them.
  const identity = (p) => ({ id: p.id, name: p.name, style: p.style, keeper: p.keeper, island: p.island || null });

  function sendAll(msg, except = null) {
    const text = JSON.stringify(msg);
    for (const p of players.values()) if (p !== except) p.conn.send(text);
  }

  function attach(conn, { keeper = false, island = null, announce = true } = {}) {
    if (players.size >= maxPlayers) { conn.close(1013, 'the island is full'); return null; }
    const p = {
      id: conn.id,
      conn,
      keeper,
      island: typeof island === 'string' && ISLAND_KEY.test(island) ? island : null,
      name: seededName(conn.id),
      // A visitor turns up looking like one of the island's own models, so the crowd
      // stays of a piece. The hat and satchel still tell a player from a settler.
      style: STYLES[parseInt(conn.id.slice(0, 4), 16) % STYLES.length],
      x: 0, y: 0, z: 0, yaw: 0, f: 0,
      room: null,
      walking: false,
      // Whether a pose has ever arrived. Until one does, x/z above are a default and not a
      // place: `{t:'w', on:true}` alone makes somebody walking at [0, 0], which on a sea is
      // the middle of the volcano. The sea's guards and its lava ask this before hurting
      // anybody (lib/hostility.mjs `afoot`).
      posed: false,
      tokens: BUCKET_SIZE,
      lastAt: Date.now(),
    };
    players.set(conn.id, p);
    // Sent here when this roster is the whole greeting, and handed back instead when it is
    // not. A sea says more in its welcome than a roster knows about - the fleet, the world
    // clock - and two welcomes arriving one after the other would leave the page deciding
    // which one counts. So the sea takes this and sends one message.
    if (announce) conn.send(JSON.stringify({ t: 'welcome', ...greeting(p) }));
    sendAll({ t: 'join', p: identity(p) }, p);
    return p;
  }

  function greeting(p) {
    return {
      id: p.id,
      you: identity(p),
      maxPlayers,
      players: [...players.values()].map(identity),
      // Whatever the boards already say, so somebody who walks up late reads the same
      // panel as everybody standing there.
      panels: panels.snapshot(),
      // And wherever the boats have got to. An untouched one is not in here: both sides
      // work its mooring out from the island, so there is nothing to send about it.
      boats: boats.snapshot(),
    };
  }

  function detach(conn) {
    const p = players.get(conn.id);
    if (!p) return;
    players.delete(conn.id);
    // Anything they were standing at is free again. Without this a board somebody
    // closed their laptop in front of stays theirs for as long as the server runs.
    for (const change of panels.released(p.id)) sendAll({ t: 'drove', ...change });
    // And the tiller. A boat somebody closed their laptop in the middle of the channel
    // with stays exactly where they left it - that is the point of the server holding it -
    // but it stops being theirs, so the next person down to the water may sail it.
    for (const b of boats.release(p.id)) sendAll({ t: 'boat', ...b });
    // Their own skiff, if they had one, sinks with them: nobody else may sail it.
    for (const b of boats.sink(p.id)) sendAll({ t: 'boat', ...b });
    // And whoever they were talking to. Without this a settler stands looking at the spot
    // somebody closed their laptop on, for as long as the sea runs - the walk has no owner
    // on its own attention slot, so this is the only thing that ever ends it.
    releaseAttention(p.id);
    sendAll({ t: 'leave', id: p.id });
  }

  function message(conn, text) {
    const p = players.get(conn.id);
    if (!p) return;

    const now = Date.now();
    p.tokens = Math.min(BUCKET_SIZE, p.tokens + ((now - p.lastAt) / 1000) * BUCKET_REFILL);
    p.lastAt = now;
    if (p.tokens < 1) { log(`player ${p.id} is shouting; closing`); conn.close(1008, 'too many messages'); return; }
    p.tokens -= 1;

    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'hello') {
      const name = clean(m.name);
      if (name) {
        p.name = name;
        sendAll({ t: 'join', p: identity(p) });   // a join for a known id doubles as a rename
      }
      return;
    }

    // Stepping back up to the map takes you out of the world. There is no second
    // mechanism for this: presence in the snapshot is the whole answer to who is visible.
    if (m.t === 'w') { p.walking = !!m.on; return; }

    if (m.t === 'p') {
      const x = num(m.x, bound), y = num(m.y, 60), z = num(m.z, bound), yaw = num(m.yaw, 1e4);
      if (x === null || y === null || z === null || yaw === null) return;
      p.x = x;
      p.y = Math.max(-4, y);
      p.z = z;
      p.yaw = yaw;
      p.f = (Number(m.f) | 0) & POSE_MASK;
      p.room = room(m.r);
      p.walking = true;
      p.posed = true;
      // Where their hand is on a board, if it is on one. Carried here rather than sent
      // on its own so that a cursor crossing a panel costs no messages at all.
      p.at = null;
      if (typeof m.b === 'string' && PANEL_ID.test(m.b)) {
        const u = num(m.u, 1), v = num(m.v, 1);
        if (u !== null && v !== null) p.at = [m.b, Math.max(0, u), Math.max(0, v)];
      }
      return;
    }

    // ---- the boards ------------------------------------------------------
    // One field of one board is now one value. Everything about the message is checked
    // here before it reaches the store: on a --public island this is a stranger's hand
    // reaching into everybody else's page.
    if (m.t === 'ui') {
      if (typeof m.id !== 'string' || !PANEL_ID.test(m.id)) return;
      if (typeof m.a !== 'string' || !ACTION.test(m.a)) return;
      let v = m.v;
      if (typeof v === 'string') v = v.slice(0, MAX_TEXT);
      else if (typeof v !== 'number' && typeof v !== 'boolean') return;
      const change = panels.apply(m.id, m.a, v);
      if (!change) return;
      // Sent to everybody including the sender, so every copy of the board is drawing
      // the value the server holds rather than the one it guessed.
      sendAll({ t: 'ui', ...change });
      return;
    }

    // Who is working which board. Not a lock - every write is idempotent and needs no
    // locking - but a way for two people at one panel to see whose hand it is.
    if (m.t === 'take' || m.t === 'drop') {
      if (typeof m.id !== 'string' || !PANEL_ID.test(m.id)) return;
      const change = m.t === 'take' ? panels.take(m.id, p.id) : panels.drop(m.id, p.id);
      if (!change) return;
      sendAll({ t: 'drove', ...change });
      return;
    }

    // Who has the tiller, and where the hull has got to. The same shape as a panel's
    // take/drop above, because a boat is claimed in the same way and for the same reason:
    // not a lock - "the boat is now here" needs none - but so that two people at one jetty
    // can see whose hand is on it.
    //
    // `moved` rides the pose budget rather than a beat of its own: a pilot is already
    // sending ten poses a second and the boat is under them, so this is one more message on
    // the same bucket and no new ceiling to reason about.
    if (m.t === 'boat') {
      if (typeof m.id !== 'string') return;
      let change = null;
      // `launch` is the one that names no boat: a skiff's id is its owner's, so the
      // only one this socket can ever put in the water is its own - see lib/boats.mjs.
      if (m.a === 'launch') change = boats.launch(p.id, m.x, m.z, m.yaw);
      else if (m.a === 'take') change = boats.take(m.id, p.id);
      else if (m.a === 'drop') change = boats.drop(m.id, p.id);
      else if (m.a === 'moved') change = boats.moved(m.id, p.id, m.x, m.z, m.yaw);
      if (!change) return;
      sendAll({ t: 'boat', ...change });
      return;
    }

    // Standing in front of somebody and being looked back at. It travels as a message now
    // that the sea walks the crowd: the settler you are speaking to is held on the sea's
    // side, so everybody watching sees them turn to you rather than only you.
    //
    // No room for a lie in it. A settler is named by building id and is held only if the
    // crowd of the island this player belongs to has one - a wanderer with no island of
    // their own (`p.island` null) can look at somebody but cannot stop them walking away.
    if (m.t === 'attend') {
      if (m.on === false) { releaseAttention(p.id); return; }
      if (typeof m.b !== 'string' || !p.island) return;
      if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
      if (Math.abs(m.x) > bound || Math.abs(m.z) > bound) return;
      attend(p.id, p.island, m.b, [m.x, m.z]);
      return;
    }

    // One swing of whatever the player holds. Nothing in it is believed but that it happened:
    // where it landed is worked out from the last pose, and whether it may happen at all -
    // how often, on foot or not - is lib/combat.mjs's to say. The bucket above has already
    // charged it a token like any other message.
    if (m.t === 'swing') { swing(p); return; }

    // ---- talking ---------------------------------------------------------
    // What one person says to everybody on the island, so a visitor and whoever lives
    // here can actually speak. Relayed and not kept: it is nobody's business to store a
    // guest's words, and the log on this machine is for the island's own troubles. The
    // cost of that is that somebody who walks up late starts on an empty page.
    //
    // No throttle of its own. The bucket above already spends one token on this, and it
    // refills at 25 a second while the pose beat takes ten - so a person cannot type fast
    // enough to feel it, and something that can is not typing.
    if (m.t === 'say') {
      if (typeof m.text !== 'string') return;
      const text = clean(m.text, MAX_SAY);
      if (!text) return;
      // Everybody including the sender, so every copy of the conversation is in the order
      // the server saw it rather than the order each page guessed at.
      sendAll({ t: 'said', id: p.id, name: p.name, keeper: p.keeper, text });
      return;
    }
  }

  // One snapshot for everybody, carrying only the people actually on their feet.
  function tick() {
    if (!players.size) return;
    const a = [];
    for (const p of players.values()) {
      if (!p.walking) continue;
      // Two things can hang off the end of a row, and both branches that added one
      // wanted the same seventh slot, so they are given fixed places instead. Outdoors
      // with no hand on a board the row is exactly the six fields it always was, which
      // is what an older client reads unchanged.
      //   [6]      the room somebody is standing in, or null for the island itself
      //   [7..9]   the board their hand is on, and where on it
      const row = [p.id, round(p.x), round(p.y), round(p.z), round(p.yaw), p.f];
      if (p.room || p.at) row.push(p.room || null);
      if (p.at) row.push(p.at[0], round(p.at[1]), round(p.at[2]));
      a.push(row);
    }
    const snap = JSON.stringify({ t: 's', a });
    const now = Date.now();
    const roster = now - lastRoster > ROSTER_MS;
    if (roster) lastRoster = now;
    const list = roster ? JSON.stringify({ t: 'roster', players: [...players.values()].map(identity) }) : null;
    for (const p of players.values()) {
      p.conn.send(snap);
      // Sent whether or not anything was missed: five seconds of a ghost is cheaper than
      // the sequence numbers it would take to notice one.
      if (list) p.conn.send(list);
      // The idle sweep is for statues: a body that is being drawn and whose tab has frozen
      // without closing the socket. Only somebody *walking* has a body on anybody's screen,
      // so only they can be one - and while they walk, net.js sends a pose at least every
      // KEEPALIVE_MS, so a live tab never trips this.
      //
      // It used to sweep every connection, and two kinds never say a word: a page in orbit
      // over its own island, which has nothing to report, and an islander, whose socket is
      // its whole presence (lib/seaclient.mjs sends one join and then listens). Both were
      // closed every sixty seconds as "idle" and reconnected a second later. For the page
      // that was a fresh welcome and the whole crowd sent again once a minute; for the
      // islander it was a forced republish, three `rev` bumps, and - because a republish
      // rebuilds the crowd (lib/crowd.mjs) - every settler on the island walked back to
      // their own door once a minute, on every screen in the world. Liveness of a socket
      // that says nothing is lib/ws.mjs's job, and it has protocol pings for it.
      if (p.walking && now - p.lastAt > idleMs) p.conn.close(1000, 'idle');
    }
  }

  function evict(p, at, islandName, boat = null) {
    releaseAttention(p.id);
    for (const change of panels.released(p.id)) sendAll({ t: 'drove', ...change });
    for (const b of boats.release(p.id)) sendAll({ t: 'boat', ...b });
    [p.x, p.y, p.z] = at;
    p.room = null; p.at = null; p.f = 0;
    p.conn.send(JSON.stringify({ t: 'evicted', x: p.x, y: p.y, z: p.z, island: islandName, ...(boat ? { boat } : {}) }));
  }

  return { attach, detach, message, tick, panels, boats, greeting, evict, all: () => [...players.values()], count: () => players.size,
    // Who has a body in the world, which is what "people aboard" means. `count` is every
    // socket: an islander's own line home and a page watching from above are in it too,
    // and a sea with nobody on it read "2 people aboard" because of them.
    walking: () => { let n = 0; for (const p of players.values()) if (p.walking) n++; return n; } };
}
