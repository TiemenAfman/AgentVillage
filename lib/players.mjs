// Who is walking the island right now. The server relays and nothing else: it does not
// integrate movement, it does not test collisions, it never touches the terrain. Every
// client is authoritative over its own feet, which for a village is the right trade -
// the worst a liar can do here is hover.
//
// What the server does own is the limits, because a socket on an open port is a socket
// anyone can shout into.
import { seededName } from './village.mjs';

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
function clean(name) {
  let out = '';
  for (const ch of String(name || '')) {
    const c = ch.codePointAt(0);
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    const invisible = (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || c === 0xfeff;
    if (!control && !invisible) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 18);
}

// Insisting on an actual number, not something that merely converts to one. JSON turns
// NaN and Infinity into null on the way out, and Number(null) is a perfectly finite zero,
// so a coercing check would quietly teleport a player to the middle of the island instead
// of rejecting the message.
function num(v, limit) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(-limit, Math.min(limit, v));
}

const round = (v) => Math.round(v * 1000) / 1000;

export function createRoster({ maxPlayers = 16, bound = 200, log = () => {} } = {}) {
  const players = new Map();   // conn.id -> player
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
    }));
    sendAll({ t: 'join', p: identity(p) }, p);
    return p;
  }

  function detach(conn) {
    const p = players.get(conn.id);
    if (!p) return;
    players.delete(conn.id);
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
      p.walking = true;
      return;
    }
  }

  // One snapshot for everybody, carrying only the people actually on their feet.
  function tick() {
    if (!players.size) return;
    const a = [];
    for (const p of players.values()) {
      if (!p.walking) continue;
      a.push([p.id, round(p.x), round(p.y), round(p.z), round(p.yaw), p.f]);
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

  return { attach, detach, message, tick, count: () => players.size };
}
