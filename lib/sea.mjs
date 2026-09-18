// The open sea: a clock, a fleet, and a relay. No island of its own.
//
// It reads no transcripts, runs no scan, opens no folder and writes nothing to disk. That
// last one is the load-bearing property, not an omission: everything it holds is in
// memory, so there is no schema, no migration and no upgrade path, and a restart is a
// second of blank water while everybody reconnects and publishes again. lib/panelstate.mjs
// argues the same thing for boards and lib/boats.mjs for hulls; this is that argument
// applied to a whole world.
//
// The security posture is much weaker than an islander's, and that is only acceptable
// *because* it holds nothing. lib/access.mjs gets three signals - a loopback socket, a
// known Host, a matching Origin - and none of them transfer here: a sea on a Docker box
// has no loopback, no known Host and every Origin is foreign by design. What is left is
// LAN membership, and later a shared key. So be clear-eyed about the blast radius of a
// sea somebody has taken: they can shout in the world, park a fake island, and wear a
// name that is not theirs. They cannot read a file, spawn an agent, reach a transcript or
// write to anybody's disk, because none of those are here to reach.
//
// Single player is the same code with one island in it, bound to loopback. There is no
// offline mode to maintain and no second drawing path: the difference between being alone
// and being in company is how many rows are in `world.islands`.
import http from 'node:http';
import { createWsServer } from './ws.mjs';
import { createFleet, GRACE_MS } from './fleet.mjs';
import { createRoster } from './players.mjs';
import { createCrowds } from './crowd.mjs';
import { encodeCrowd, crowdRoster, sliceCount, walkerEvery } from '../shared/settlerwire.mjs';

// What this sea speaks. A client that does not speak it is turned away at the handshake
// with the number, rather than being let in to fail later in a way nobody can read.
export const SEA_V = 1;

// A bundle is measured in hundreds of kilobytes - 318 buildings on a 256 grid came to
// 206 kB - so two megabytes is generous. It is also the reason a bundle goes over HTTP:
// lib/ws.mjs caps a frame at 2048 bytes and refuses to reassemble fragments, on purpose.
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

const json = (res, status, body, { last = false } = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    // `last` closes the connection after this answer. Used when a body was cut off part
    // way through: the rest of it is still coming and nothing here is going to read it, so
    // the socket cannot be reused and saying so is the only way the sender gets to see the
    // status at all.
    ...(last ? { Connection: 'close' } : {}),
    // Every client is cross-origin here by construction: the page comes from an islander
    // and the world comes from this. Credentials are never allowed and never will be -
    // there is no cookie here to protect, and saying so keeps it that way.
    'Access-Control-Allow-Origin': '*',
    'Vary': 'Origin',
  });
  res.end(text);
};

// Read a body with a ceiling. Written out here rather than shared, because the sea must
// not import the islander.
//
// Over the limit it stops reading and refuses - but it does NOT destroy the socket, which
// is what the first version did and what made the sender see a dead connection instead of
// a status. `req.pause()` puts the backpressure on and leaves the response path intact,
// and the refusal carries `last` so the answer goes out with Connection: close: the rest
// of that body is still on its way, nobody here is going to read it, and the socket
// therefore cannot be reused. Getting this wrong is invisible until somebody's island
// grows past two megabytes and they are told nothing at all about why.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const parts = [];
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > limit) {
        over = true;
        parts.length = 0;
        req.pause();
        reject(Object.assign(new Error(`that island is larger than ${limit} bytes`), { status: 413, last: true }));
        return;
      }
      parts.push(c);
    });
    req.on('end', () => {
      if (over) return;
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { reject(Object.assign(new Error('that is not JSON'), { status: 400 })); }
    });
    req.on('error', (e) => { if (!over) reject(e); });
  });
}

export function createSea({
  port = 4750,
  host = '127.0.0.1',
  name = 'an open sea',
  tickMs = 66,
  maxPlayers = 32,
  key = null,
  worldBound = 4000,
  log = () => {},
  now = () => Date.now(),
} = {}) {
  const fleet = createFleet({ now });
  const sockets = new Set();          // every live connection, island or client

  // Who is walking, what the boards say, and where the boats have got to. All three are
  // lib/players.mjs exactly as the islander ran it - the sea is where that code belongs
  // now, and moving it rather than rewriting it is the point.
  //
  // `bound` is the one number that had to grow. It clamps every pose, and at 200 it was
  // generous for one island and a silent trap for a world: your own body would look right
  // on your screen while everybody else watched you slide back to the edge of the clamp.
  // A fleet of sixteen 256-grids reaches a few thousand units out, so this is sized from
  // the world rather than from an island.
  const roster = createRoster({
    maxPlayers,
    bound: worldBound,
    moorings: [],
    log,
  });

  // Everybody who lives here. Built from each island's own bundle and stepped by the tick
  // below, so an island keeps living for the grace after its keeper closes their laptop -
  // which is the whole reason the walk had to leave the browser.
  //
  // Measured on a village of 274 on this machine: building a crowd costs 3 ms, an ordinary
  // tick 0.04, and the worst tick - the borrel, when everybody plans a route at once - 5.
  // That is 0.16% of a core per island in the steady state.
  const crowds = createCrowds({ now });

  // ---- the wire ---------------------------------------------------------------------

  const send = (conn, obj) => { try { conn.send(JSON.stringify(obj)); } catch { /* it is going away */ } };
  function broadcast(obj, except = null) {
    const text = JSON.stringify(obj);
    for (const c of sockets) if (c !== except) { try { c.send(text); } catch { /* going away */ } }
  }

  // What a newcomer needs to draw the world: the fleet, the clock, and who else is here.
  // Deliberately without any island's actual contents - those are 200 kB each and are
  // fetched over HTTP, once, by whoever turns out to need them.
  function welcome(conn) {
    return {
      t: 'welcome',
      v: SEA_V,
      sea: name,
      tickMs,
      // One clock for the whole world. Without this two players in different time zones
      // see one island in daylight and the other at night, in the same frame - and each
      // of them is sure the other one is wrong.
      //
      // Two numbers, because an epoch is not a time of day: `now` settles what moment it
      // is and `tz` settles whose afternoon that is. The sea's own wall clock is the
      // world's, which is arbitrary and is the point - somebody's had to be.
      now: now(),
      tz: -new Date().getTimezoneOffset(),
      world: fleet.manifest(),
    };
  }

  // The fleet changed, so the boats did. lib/boats.mjs keeps a hull that somebody left in
  // open water exactly where they left it and only re-moors the untouched ones, which is
  // what stops a new island arriving from yanking a boat out from under its pilot.
  function remoor() { roster.boats.moor(fleet.moorings()); }

  function onMessage(conn, text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;

    // Everything that is not the handshake belongs to the roster: poses, boards, the
    // tiller, talking. It has its own rate limit and its own validation, and the sea does
    // not second-guess either.
    if (m.t !== 'join') { if (conn.joined) roster.message(conn, text); return; }

    if (m.t === 'join') {
      if (conn.joined) return;                 // one handshake per socket
      if (m.v !== SEA_V) { send(conn, { t: 'refused', why: 'version', speaks: SEA_V }); conn.close(); return; }
      if (key && m.key !== key) { send(conn, { t: 'refused', why: 'key' }); conn.close(); return; }
      if (sockets.size > maxPlayers) { send(conn, { t: 'refused', why: 'full' }); conn.close(); return; }

      conn.as = m.as === 'islander' ? 'islander' : 'client';
      conn.island = typeof m.island === 'string' ? m.island : null;
      conn.token = typeof m.token === 'string' ? m.token : null;

      // An islander claims its island so that dropping its socket is what makes the
      // island go quiet. A client only says which island it belongs to, which is what
      // puts its name over the right coast - it claims nothing.
      if (conn.as === 'islander' && conn.island) {
        if (fleet.has(conn.island) && !fleet.claim(conn.island, conn.token)) {
          send(conn, { t: 'refused', why: 'claimed' });
          conn.close();
          return;
        }
        if (fleet.has(conn.island)) broadcast({ t: 'island', a: 'rev', ...fleet.row(fleet.get(conn.island)) });
      }

      // One welcome, carrying both halves: the world from here and the company from the
      // roster. Two messages would leave the page deciding which one counts.
      conn.joined = true;
      const p = roster.attach(conn, { island: conn.island, announce: false });
      if (!p) return;                          // the roster said full and closed the socket
      send(conn, { ...welcome(conn), ...roster.greeting(p) });
      // And who lives where. Sent after the welcome rather than in it: a roster is one
      // message per island and a welcome is one message, and a newcomer to a busy sea
      // would otherwise get a single frame too big for lib/ws.mjs to send.
      for (const crowd of crowds.all()) send(conn, { t: 'fr', i: crowd.id, ids: crowdRoster(crowd) });
      return;
    }
  }

  function onClose(conn) {
    sockets.delete(conn);
    if (conn.joined) roster.detach(conn);
    // An islander leaving does not sink its island: it goes quiet, keeps its berth, and
    // is swept only when the grace runs out. A page reload or a keeper restarting their
    // own server after saving a file must not take an island out from under the feet of
    // somebody standing on it.
    if (conn.as === 'islander' && conn.island && fleet.has(conn.island)) {
      const i = fleet.goneQuiet(conn.island);
      if (i) broadcast({ t: 'island', a: 'rev', ...fleet.row(i) });
    }
  }

  // ---- the routes -------------------------------------------------------------------

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'sea'}`);
    const p = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Island-Token',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }

    if (p === '/health') return json(res, 200, { ok: true, sea: name, v: SEA_V, islands: fleet.count(), players: sockets.size, settlers: crowds.figures(), ticks: crowds.ticks() });

    // The manifest: who is here and where. A few hundred bytes an island.
    if (p === '/world' && req.method === 'GET') return json(res, 200, { v: SEA_V, sea: name, now: now(), ...fleet.manifest() });

    if (p.startsWith('/island/')) {
      const id = decodeURIComponent(p.slice('/island/'.length));
      if (req.method === 'GET') {
        const i = fleet.get(id);
        if (!i) return json(res, 404, { error: 'no such island here' });
        return json(res, 200, i.bundle);
      }
      if (req.method === 'POST') {
        try {
          const body = await readBody(req, MAX_BUNDLE_BYTES);
          const token = String(req.headers['x-island-token'] || '') || null;
          const island = fleet.publish(id, body, { token });
          // A republished island gets a fresh crowd: the village underneath may have grown
          // a house, founded a district or drained a polder, and reconciling that in place
          // is a machine nobody has asked for. What it costs is that everybody walks back
          // to their own doorstep, which is where they spend most of their lives anyway.
          const crowd = crowds.join(island);
          remoor();
          broadcast({ t: 'island', a: 'joined', ...fleet.row(island) });
          // Who the numbers in a crowd message mean. Only the ids: the far end hashes a
          // face out of one, the same way this side does.
          broadcast({ t: 'fr', i: island.id, ids: crowdRoster(crowd) });
          log(`${island.id} (${island.bundle.island.name}) is at ${island.origin.join(',')}, rev ${island.rev}`);
          return json(res, 200, { ok: true, id: island.id, origin: island.origin, rev: island.rev });
        } catch (e) {
          return json(res, e.status || 400, { error: String(e.message || e) }, { last: !!e.last });
        }
      }
    }

    json(res, 404, { error: 'the sea has four routes: /world, /island/:id, /health and /ws' });
  });

  const ws = createWsServer(server, {
    path: '/ws',
    maxSockets: Math.max(8, maxPlayers * 2),
    onOpen: (conn) => { sockets.add(conn); },
    onMessage,
    onClose,
    log,
  });

  // The pose beat. One JSON.stringify per tick for the whole world, which is what makes
  // sixteen bodies at ten a second affordable - see lib/players.mjs's own note on it.
  // Which slice of each crowd gets pinned this beat. One full rotation per KEYFRAME_S, so
  // every settler is placed exactly once in that time however big the village is.
  const SLICES = sliceCount(tickMs);
  // And how often the ones actually going somewhere ride along - see WALKER_HZ.
  const MOVERS_EVERY = walkerEvery(tickMs);
  let slice = 0;
  let beats = 0;

  const beat = setInterval(() => {
    // The crowds first: the poses that go out on this beat should be of the world as it is
    // after this tick, not before it.
    crowds.tick(0);
    roster.tick();
    for (const crowd of crowds.all()) {
      const island = fleet.get(crowd.id);
      if (!island) continue;
      const { a, k } = encodeCrowd(crowd, {
        half: island.half, slice, slices: SLICES, movers: beats % MOVERS_EVERY === 0,
      });
      // Nothing to say is worth not saying. An island where everybody happens to be
      // standing still, between two slices, costs no message at all.
      if (a.length || k.length) broadcast({ t: 'f', i: crowd.id, a, k });
    }
    slice = (slice + 1) % SLICES;
    beats++;
  }, tickMs);
  if (beat.unref) beat.unref();

  // Sweep the islands whose grace has run out. Nothing else times anything: the fleet
  // decides, this only tells everybody.
  const sweep = setInterval(() => {
    for (const id of fleet.expired(GRACE_MS)) {
      fleet.drop(id);
      crowds.leave(id);
      remoor();
      broadcast({ t: 'island', a: 'gone', id });
      log(`${id} has gone home`);
    }
  }, 5000);
  if (sweep.unref) sweep.unref();

  return {
    server,
    fleet,
    roster,
    crowds,
    listen: () => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise((resolve) => {
      clearInterval(sweep);
      clearInterval(beat);
      for (const c of sockets) { try { c.close(); } catch { /* going away */ } }
      if (ws && ws.close) ws.close();
      server.close(() => resolve());
    }),
    players: () => sockets.size,
    address: () => server.address(),
  };
}
