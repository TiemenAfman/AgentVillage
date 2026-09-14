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
import { seededName } from './village.mjs';
import { createPanelState } from './panelstate.mjs';

const STYLES = ['fable', 'opus', 'sonnet', 'haiku', 'unknown'];

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

// Which room a player is standing in, if any. A slug and nothing else: it decides which
// scene everybody else draws them into, so it is worth being narrow about. Anything
// that is not a plain lowercase name is treated as outdoors rather than rejected --
// a bad room is not worth dropping a pose over.
function room(v) {
  return typeof v === 'string' && /^[a-z][a-z0-9-]{0,15}$/.test(v) ? v : null;
}

const round = (v) => Math.round(v * 1000) / 1000;

// A cursor on a board is carried by the pose beat rather than sent on its own. That
// stream is already rate limited and already arrives ten times a second, so a hand
// moving over a panel costs nothing extra and cannot trip the bucket - which does not
// throttle, it closes the socket.
const PANEL_ID = /^prop:[0-9a-f-]{1,36}$/;
const ACTION = /^[a-z][a-z0-9-]{0,15}$/;
// Long enough for the longest field any face has (see shared/panels.mjs, which cuts it
// again to that field's own length); short enough that a socket cannot be used to post
// a novel into somebody else's page.
const MAX_TEXT = 240;
// A sentence said out loud on the island. Shorter than a panel field on purpose: this one
// lands in everybody else's log, and a paragraph there is a way of taking the floor.
const MAX_SAY = 200;

export function createRoster({ maxPlayers = 16, bound = 200, panelFaces = () => new Map(), log = () => {} } = {}) {
  const players = new Map();   // conn.id -> player
  const panels = createPanelState({ faces: panelFaces });
  let lastRoster = 0;

  const identity = (p) => ({ id: p.id, name: p.name, style: p.style, keeper: p.keeper });

  function sendAll(msg, except = null) {
    const text = JSON.stringify(msg);
    for (const p of players.values()) if (p !== except) p.conn.send(text);
  }

  function attach(conn, { keeper = false } = {}) {
    if (players.size >= maxPlayers) { conn.close(1013, 'the island is full'); return null; }
    const p = {
      id: conn.id,
      conn,
      keeper,
      name: seededName(conn.id),
      // A visitor turns up looking like one of the island's own models, so the crowd
      // stays of a piece. The hat and satchel still tell a player from a settler.
      style: STYLES[parseInt(conn.id.slice(0, 4), 16) % STYLES.length],
      x: 0, y: 0, z: 0, yaw: 0, f: 0,
      room: null,
      walking: false,
      tokens: BUCKET_SIZE,
      lastAt: Date.now(),
    };
    players.set(conn.id, p);
    conn.send(JSON.stringify({
      t: 'welcome',
      id: p.id,
      you: identity(p),
      maxPlayers,
      players: [...players.values()].map(identity),
      // Whatever the boards already say, so somebody who walks up late reads the same
      // panel as everybody standing there.
      panels: panels.snapshot(),
    }));
    sendAll({ t: 'join', p: identity(p) }, p);
    return p;
  }

  function detach(conn) {
    const p = players.get(conn.id);
    if (!p) return;
    players.delete(conn.id);
    // Anything they were standing at is free again. Without this a board somebody
    // closed their laptop in front of stays theirs for as long as the server runs.
    for (const change of panels.released(p.id)) sendAll({ t: 'drove', ...change });
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
      p.f = (Number(m.f) | 0) & 15;
      p.room = room(m.r);
      p.walking = true;
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
      if (now - p.lastAt > IDLE_MS) p.conn.close(1000, 'idle');
    }
  }

  return { attach, detach, message, tick, panels, count: () => players.size };
}
