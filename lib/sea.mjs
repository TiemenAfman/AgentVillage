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
import { createWeather } from './weather.mjs';
import { encodeCrowd, encodeRides, crowdRoster, sliceCount, walkerEvery } from '../shared/settlerwire.mjs';

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

// ---- the harbour office ---------------------------------------------------------------
//
// One page, inline, because this file may not touch a disk (see the note on the route).
// It renders nothing here: it fetches /health and /world, which already say all of it, and
// a page rendered on the server would be stale the moment somebody left.
//
// Deliberately plain. This is not the island - the island is the island - it is the wall
// of the harbour office: who is moored, how long the clock has run, and one button.
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page(name) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 28px 20px 60px; background: #0e1418; color: #d8d2c6;
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font: 600 26px/1.2 ui-serif, Georgia, serif; margin: 0 0 2px; color: #f0e9dc; }
  .kicker { text-transform: uppercase; letter-spacing: .14em; font-size: 10.5px; color: #7d8a86; }
  .sub { color: #8d9691; margin: 6px 0 22px; }
  .tiles { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
  .tile { flex: 1 1 120px; padding: 10px 12px; border-radius: 9px; background: #161f24;
          border: 1px solid #22303700; }
  .tile b { display: block; font-size: 20px; font-weight: 600; color: #f0e9dc; }
  .tile span { font-size: 11px; color: #7d8a86; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li { display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
       padding: 10px 12px; border-radius: 9px; background: #161f24; }
  li.quiet { opacity: .5; }
  .who { font-size: 11px; color: #7d8a86; text-align: right; white-space: nowrap; }
  .empty { padding: 14px 12px; border-radius: 9px; background: #161f24; color: #8d9691; }
  form { display: flex; gap: 6px; margin: 26px 0 0; align-items: center; flex-wrap: wrap; }
  input, button { font: inherit; }
  input { flex: 0 0 200px; padding: 8px 10px; border-radius: 8px; border: 1px solid #2a3a41;
          background: #101a1f; color: #d8d2c6; }
  button { padding: 8px 14px; border-radius: 8px; border: 1px solid #2a3a41; cursor: pointer;
           background: #1d2a30; color: #e6dfd2; }
  button:hover:not([disabled]) { background: #26363e; }
  button[disabled] { opacity: .5; cursor: default; }
  .note { font-size: 11.5px; color: #7d8a86; margin: 8px 0 0; flex: 1 1 100%; }
  .bad { color: #e08a6a; }
  .good { color: #8fbf8f; }
</style>
</head><body><main>
  <div class="kicker">An open sea</div>
  <h1 id="name">${esc(name)}</h1>
  <p class="sub" id="clock">…</p>

  <div class="tiles">
    <div class="tile"><b id="n-islands">–</b><span>islands</span></div>
    <div class="tile"><b id="n-players">–</b><span>people aboard</span></div>
    <div class="tile"><b id="n-settlers">–</b><span>settlers walking</span></div>
  </div>

  <ul id="fleet"><li class="empty">Looking…</li></ul>

  <form id="up">
    <input id="key" type="password" placeholder="key" autocomplete="off">
    <button id="go">Pull and restart</button>
    <p class="note" id="said">This pulls the latest code and restarts the sea. Everybody
      moored here drops out and reconnects on their own, and the world is rebuilt as they
      do — it is held in memory and nowhere else, so nothing is lost but a few seconds.</p>
  </form>
</main>
<script type="module">
const el = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// How long the clock has run, in words. The tick count is the one number that says whether
// this sea has been up all week or came back thirty seconds ago.
function since(ms) {
  const s = Math.round(ms / 1000);
  if (s < 90) return \`up \${s} s\`;
  const m = Math.round(s / 60);
  if (m < 90) return \`up \${m} min\`;
  const h = m / 60;
  return h < 48 ? \`up \${h.toFixed(1)} h\` : \`up \${Math.round(h / 24)} days\`;
}

async function look() {
  try {
    const [h, w] = await Promise.all([
      fetch('health', { cache: 'no-store' }).then((r) => r.json()),
      fetch('world', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    el('name').textContent = h.sea || 'an open sea';
    document.title = h.sea || 'an open sea';
    el('clock').textContent = \`\${since((h.ticks || 0) * 66)} · protocol v\${h.v}\${h.keyed ? ' · keyed' : ''}\`;
    el('n-islands').textContent = h.islands ?? 0;
    el('n-players').textContent = h.players ?? 0;
    el('n-settlers').textContent = h.settlers ?? 0;

    const rows = (w.islands || []).slice().sort((a, b) => (a.name < b.name ? -1 : 1));
    el('fleet').innerHTML = rows.length ? rows.map((i) => \`<li class="\${i.live ? '' : 'quiet'}">
        <span><b>\${esc(i.name)}</b>\${i.live ? '' : ' — keeper away'}</span>
        <span class="who">\${esc(i.keeper || 'someone')} · \${i.buildings ?? 0} buildings · rev \${i.rev ?? 0}</span>
      </li>\`).join('')
      : '<li class="empty">Nobody is moored here. An island joins by pointing its keeper at this address.</li>';
  } catch (e) {
    el('fleet').innerHTML = '<li class="empty bad">The sea did not answer.</li>';
  }
}

el('up').addEventListener('submit', async (e) => {
  e.preventDefault();
  const go = el('go');
  const said = el('said');
  go.disabled = true;
  said.className = 'note';
  said.textContent = 'Asking…';
  try {
    const r = await fetch('update', { method: 'POST', headers: { 'X-Sea-Key': el('key').value } });
    const body = await r.json().catch(() => ({}));
    said.className = 'note ' + (r.ok ? 'good' : 'bad');
    said.textContent = r.ok
      ? 'On its way. This page will go quiet for a moment and the count will start again.'
      : (body.error || \`the sea answered \${r.status}\`);
  } catch (err) {
    said.className = 'note bad';
    said.textContent = String(err.message || err);
  }
  setTimeout(() => { go.disabled = false; }, 4000);
});

look();
setInterval(look, 4000);
</script>
</body></html>`;
}

export function createSea({
  port = 4750,
  host = '127.0.0.1',
  name = 'an open sea',
  tickMs = 66,
  maxPlayers = 32,
  key = null,
  // Where to ask for a redeploy, if anybody has told this sea how. A Portainer webhook, a
  // CI hook, anything that answers a bare POST. A secret of its own - whoever has it can
  // replace this container - so it is never sent to the page and never logged.
  updateHook = null,
  worldBound = 4000,
  // How long a walking body may go without a pose before the roster takes it for a
  // statue and closes its socket - lib/players.mjs. Threaded through only so a test can
  // shorten it; the default there is the number.
  idleMs = undefined,
  log = () => {},
  now = () => Date.now(),
  // Only so a test can hurry the sky along or pin what it will do. Everything about the
  // weather is in lib/weather.mjs; this is the one place in the sea that has to know it
  // exists at all.
  weather: weatherOpts = {},
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
    ...(idleMs != null ? { idleMs } : {}),
    moorings: [],
    // Somebody walking up to a settler. The one conversion in it is the one that matters:
    // a pose travels in WORLD coordinates and a crowd walks in its island's own frame, so
    // the origin comes off here. Doing it inside lib/crowd.mjs would give that file an
    // opinion about where its island is moored, which is the thing it has been kept
    // clear of - see the note on the outings there.
    attend: (who, islandId, buildingId, at) => {
      const i = fleet.get(islandId);
      if (!i) return false;
      return crowds.attend(who, islandId, buildingId, [at[0] - i.origin[0], at[1] - i.origin[1]]);
    },
    releaseAttention: (who) => crowds.release(who),
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

  // And the sky over all of it. One sky for the whole world rather than one per island:
  // that everybody is standing in the same rain at the same moment is the entire point,
  // and it is worth exactly one word on the wire. In memory like everything else here, so
  // a restart is a new sky - see lib/weather.mjs.
  const weather = createWeather({ now, ...weatherOpts });

  // ---- the wire ---------------------------------------------------------------------

  const send = (conn, obj) => { try { conn.send(JSON.stringify(obj)); } catch { /* it is going away */ } };
  // Whether an HTTP request carries this sea's key, when it has one. The same header the
  // harbour office uses for /update, so there is one way to say it.
  const keyOpens = (req) => !key || String(req.headers['x-sea-key'] || '') === key;
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
      // And what that afternoon looks like. It rides on the welcome rather than costing a
      // message of its own, because a joiner has to be standing in the right weather in the
      // frame it draws first - the next turn of the sky may be a quarter of an hour away.
      //
      // A client that gets no `weather` here draws clear skies and says nothing about it.
      // A missing field is a sea older than the sky, not two machines disagreeing, so it
      // must never reach the skew banner: that one is for a difference in shared/terrain.mjs
      // and means somebody's island is being drawn in the wrong shape.
      weather: weather.current(),
      world: fleet.manifest(),
    };
  }

  // The fleet changed, so the boats did. lib/boats.mjs keeps a hull that somebody left in
  // open water exactly where they left it and only re-moors the untouched ones, which is
  // what stops a new island arriving from yanking a boat out from under its pilot.
  // Every board in the world, across every island, so panelstate keeps only the ones that
  // are still standing somewhere. Cheap: it runs when an island publishes, which is once a
  // scan, and a fleet has a few hundred props in it at most.
  function forgetGoneBoards() {
    const here = [];
    for (const island of fleet.all()) {
      for (const prop of island.bundle.props || []) if (prop.kind === 'panel') here.push(prop.id);
    }
    roster.panels.forget(here);
  }

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
      // And who lives where, and where they are standing this second.
      //
      // Both after the welcome rather than in it: one message per island rather than one
      // enormous one, so a newcomer to a busy sea is not sent a single frame the size of
      // the whole world.
      //
      // The positions are the part that has to be here. The beat below pins one slice of
      // each crowd per tick and takes KEYFRAME_S to get round everybody, which is right
      // for keeping a crowd honest and quite wrong for somebody who has just walked in:
      // they would watch the village fill up over ten seconds. So a joiner gets everybody
      // at once, once, and then falls in with the rotation like everybody else.
      for (const crowd of crowds.all()) {
        const island = fleet.get(crowd.id);
        if (!island) continue;
        send(conn, { t: 'fr', i: crowd.id, ids: crowdRoster(crowd) });
        const { a, k } = encodeCrowd(crowd, { half: island.half, slices: 1, movers: true });
        const b = encodeRides(crowd.rides(), island.half);
        if (a.length || k.length || b.length) send(conn, { t: 'f', i: crowd.id, a, k, b });
      }
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

    // `keyed` says a key is wanted, never which one. Without it the picker cannot tell the
    // difference between a sea that will have you and one that will turn you away, and the
    // only way to find out is to move this island and watch it be refused.
    // The harbour office: who is moored here, and a button to bring the sea up to date.
    //
    // Inline HTML and not a file. `tests/sea-join.test.mjs` walks this file's import graph
    // and insists it can reach nothing but node:http, node:crypto and node:os - "the sea
    // writes nothing to disk" is structural rather than a promise, and reading a template
    // off disk would need node:fs and spend exactly that. It is also why this page fetches
    // its own numbers from /health and /world instead of being rendered here: those two
    // routes already say all of it, and a server-rendered page would go stale the moment
    // somebody left.
    if (p === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page(name));
      return;
    }

    // Pull the latest code and restart, by asking whatever deployed this to do it again.
    //
    // Behind the key, and that is the whole design of it. This address is public: a button
    // anybody could press is a restart button for everybody moored here, and a restart
    // empties the world for as long as it takes each islander to reconnect. The key is
    // shared by everybody *in* the world, which is the right circle - it is their sea too.
    //
    // The hook is a secret of its own (whoever has it can redeploy), so it is read from the
    // environment and never sent to the page. Without one this answers 501 rather than
    // pretending: a sea started by hand has nothing to ask.
    if (p === '/update' && req.method === 'POST') {
      // Who, before what. A sea with a hook and no key would be a redeploy button with no
      // lock on it, on an address anybody can reach - `if (key) …` reads as the protection
      // and silently is not one when there is no key to check against. And the order
      // matters for a second reason: answering 501 first would tell a stranger whether
      // this sea has a deploy hook at all.
      if (!key) return json(res, 403, { error: 'this sea has no key, so it will not restart itself for anybody' });
      if (String(req.headers['x-sea-key'] || '') !== key) {
        return json(res, 403, { error: 'that is not the key to this sea' });
      }
      if (!updateHook) return json(res, 501, { error: 'this sea was not told how to update itself' });
      try {
        // Fire and read the status, but do not wait for the deploy: the container this runs
        // in is what is about to be replaced, so the answer to this request has to be on
        // its way out before that happens.
        const r = await fetch(updateHook, { method: 'POST', signal: AbortSignal.timeout(20000) });
        log(`update asked for; the deploy hook answered ${r.status}`);
        return json(res, r.ok ? 200 : 502, r.ok
          ? { ok: true, note: 'pulling and restarting; everybody moored here will reconnect' }
          : { error: `the deploy hook answered ${r.status}` });
      } catch (e) {
        return json(res, 502, { error: String(e.message || e) });
      }
    }

    if (p === '/health') return json(res, 200, { ok: true, sea: name, v: SEA_V, keyed: !!key, islands: fleet.count(), players: roster.count(), settlers: crowds.figures(), ticks: crowds.ticks() });

    // The manifest: who is here and where. A few hundred bytes an island.
    if (p === '/world' && req.method === 'GET') return json(res, 200, { v: SEA_V, sea: name, now: now(), ...fleet.manifest() });

    // A tree planted, a jetty put up, a bed sown. The island is what it was; only what is
    // standing on it has changed, so this does not rebuild the crowd and does not move
    // `rev` - see lib/fleet.mjs. One message out, and everybody watching has the tree.
    if (p.startsWith('/island/') && p.endsWith('/parcel') && req.method === 'POST') {
      const id = decodeURIComponent(p.slice('/island/'.length, -'/parcel'.length));
      if (!keyOpens(req)) return json(res, 403, { error: 'key' });
      try {
        const body = await readBody(req, MAX_BUNDLE_BYTES);
        const token = String(req.headers['x-island-token'] || '') || null;
        const parcel = fleet.patch(id, body, { token });
        broadcast({ t: 'island', a: 'parcel', i: id, ...parcel });
        return json(res, 200, { ok: true, props: parcel.props.length, crops: parcel.crops.length });
      } catch (e) {
        return json(res, e.status || 400, { error: String(e.message || e) });
      }
    }

    if (p.startsWith('/island/')) {
      const id = decodeURIComponent(p.slice('/island/'.length));
      if (req.method === 'GET') {
        const i = fleet.get(id);
        if (!i) return json(res, 404, { error: 'no such island here' });
        return json(res, 200, i.bundle);
      }
      if (req.method === 'POST') {
        // The same door the socket has. The key used to be asked for at the handshake
        // only, so an islander that was turned away there could still park its island
        // here over HTTP - and did, by accident: lib/seaclient.mjs publishes on every scan
        // whether or not its socket was let in. That island then sat in a keyed sea for
        // ever (see `held` below), under a token its own islander lost at its next restart.
        if (!keyOpens(req)) return json(res, 403, { error: 'key' });
        try {
          const body = await readBody(req, MAX_BUNDLE_BYTES);
          const token = String(req.headers['x-island-token'] || '') || null;
          // Live means an islander is on the line for it. An island whose keeper's socket
          // is not here - refused, not yet connected, gone - is published into the grace
          // period instead, and is swept if nobody turns up to claim it. `live: true`
          // unconditionally was how a copy of somebody's island outlived its islander:
          // nothing ever dropped a socket that had never been there.
          const held = [...sockets].some((c) => c.joined && c.as === 'islander' && c.island === id && c.token === token);
          const island = fleet.publish(id, body, { token, live: held });
          // A republished island gets a fresh crowd: the village underneath may have grown
          // a house, founded a district or drained a polder, and reconciling that in place
          // is a machine nobody has asked for. What it costs is that everybody walks back
          // to their own doorstep, which is where they spend most of their lives anyway.
          const crowd = crowds.join(island);
          // A board taken off an island takes what it said with it. The islander used to
          // do this itself when it held the boards; they live here now, so the bundle's
          // own list of props is what settles which ones still exist.
          forgetGoneBoards();
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

    // The path that arrived, and not only the ones we have. Behind a reverse proxy those
    // are different questions: a proxy that rewrites - a forward path in Nginx Proxy
    // Manager, a location block with a trailing slash - turns every route into this 404,
    // and a message that lists the routes without naming what was asked reads as "the sea
    // is broken" when it means "your proxy is sending me somewhere else".
    json(res, 404, {
      error: `no route ${p} - the sea has: /, /world, /island/:id, /island/:id/parcel, /health, /update and /ws`,
      asked: p,
    });
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
  // Which islands had a dinghy out last beat. An empty `b` is a real statement - it is how
  // a hull is taken out of the water - so the one beat on which it goes from something to
  // nothing has to be sent even if nobody moved and no slice came up.
  const wasSailing = new Set();
  // And who each crowd has been sent as a walker, so the beat they stop can be said on
  // that beat rather than when their slice comes round - see `walking` in
  // shared/settlerwire.mjs. Keyed by the crowd object and not the island id, because a
  // republish builds a new crowd whose indices mean different people, and a set of the
  // old crowd's walkers read against the new one would send a beat of wrong rows.
  const onWire = new WeakMap();

  const beat = setInterval(() => {
    // The crowds first: the poses that go out on this beat should be of the world as it is
    // after this tick, not before it.
    crowds.tick(0);
    roster.tick();
    // A boat nobody has sailed for a while drifts back to its own mooring on this same
    // beat - see lib/boats.mjs. Cheap: it is a pass over however many boats exist, which
    // is one per island at most, against the crowd walk right below it.
    for (const b of roster.boats.driftHome()) broadcast({ t: 'boat', ...b });
    for (const crowd of crowds.all()) {
      const island = fleet.get(crowd.id);
      if (!island) continue;
      let walking = onWire.get(crowd);
      if (!walking) onWire.set(crowd, (walking = new Set()));
      const { a, k } = encodeCrowd(crowd, {
        half: island.half, slice, slices: SLICES, movers: beats % MOVERS_EVERY === 0, walking,
      });
      // The dinghies every beat, walkers' beat or not: a row's absence is how the far end
      // learns an outing is over, and a signal that only arrives on one beat in four is a
      // hull left floating for three of them.
      const b = encodeRides(crowd.rides(), island.half);
      // Nothing to say is worth not saying. An island where everybody happens to be
      // standing still, between two slices, costs no message at all.
      if (a.length || k.length || b.length || wasSailing.has(crowd.id)) {
        broadcast({ t: 'f', i: crowd.id, a, k, b });
      }
      if (b.length) wasSailing.add(crowd.id); else wasSailing.delete(crowd.id);
    }
    slice = (slice + 1) % SLICES;
    beats++;

    // And the sky, on the same beat rather than on a timer of its own. That looks like the
    // wrong place for something that changes once a quarter of an hour, and it is the right
    // one: `tick` is a single comparison against a stored timestamp and returns null every
    // time but one, so the cost is nothing measured against the crowd walk two lines up -
    // while a five-second interval beside it would be a second timer to shut down, a second
    // thing for `close` to forget, and five seconds of a world where two people standing
    // side by side are in different weather.
    const sky = weather.tick();
    if (sky) {
      broadcast({ t: 'weather', ...sky });
      log(`the sky over ${name} turns ${sky.sky}`);
    }
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
    weather,
    // Resolves with the address, or rejects with the reason. The first version only
    // listened for success, so a port already in use left the promise pending for ever and
    // sent the EADDRINUSE off to whatever uncaughtException handler the caller happened to
    // have - which in serve.mjs meant an island that served perfectly and had no world in
    // it. A `once` on each side, so neither handler outlives the answer.
    listen: () => new Promise((resolve, reject) => {
      const ok = () => { server.off('error', bad); resolve(server.address()); };
      const bad = (e) => { server.off('listening', ok); reject(e); };
      server.once('listening', ok);
      server.once('error', bad);
      server.listen(port, host);
    }),
    close: () => new Promise((resolve) => {
      clearInterval(sweep);
      clearInterval(beat);
      for (const c of sockets) { try { c.close(); } catch { /* going away */ } }
      if (ws && ws.close) ws.close();
      server.close(() => resolve());
      // And then hang up on whatever is still holding the door. `server.close` stops the
      // listener at once, but its callback waits for every connection still open, and a
      // sea's connections do not all end on their own: an upgraded websocket is asked to
      // close politely, which needs a reply the peer may never send, and `GET /world` and
      // `GET /island/:id` leave idle keep-alive sockets behind.
      //
      // What was measured: leaving a self-hosted sea with a browser attached took 62
      // seconds to come back - the ws reaper's own 25 s ping times 2.5 - and the islander
      // had no sea at all for that minute. What was NOT reproduced in isolation: neither
      // one idle keep-alive socket nor one live websocket delays close() by more than a
      // few milliseconds on their own, so the exact combination that held it is unproven.
      // The page letting go of the old sea (web/js/main.js, followSea) is the fix for the
      // cause; this is here because it is what closing a relay should mean anyway. A sea
      // holds nothing on disk - that is the whole of its design - so at this point there
      // is nothing to flush and nothing to be polite about.
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    }),
    players: () => roster.count(),
    address: () => server.address(),
  };
}
