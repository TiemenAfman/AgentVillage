// Who may do what. The island can start an unattended agent in any folder on this
// machine, so the rule is simple and blunt: only this computer gets the dangerous half.
//
// Three things have to agree before a request counts as coming from the keeper, and it
// is worth being precise about why none of them can be dropped:
//
//   the socket   - req.socket.remoteAddress is real, because TCP needs a handshake. It
//                  is the only unspoofable signal we have. But it is not enough on its
//                  own: a page on evil.com whose name resolves to 127.0.0.1 reaches us
//                  over loopback too.
//   the Host     - which is why the Host header still has to be one we recognise. That
//                  is the DNS rebinding defence: evil.com is not in the list.
//   the Origin   - and if a request carries one it must match the Host, so a page on
//                  another site cannot post here. A cross-origin JSON POST is stopped by
//                  CORS anyway, but a plain form post is not, and readBody does not care
//                  about the content type.
//
// X-Forwarded-For is never read. There is no trusted proxy in front of this, and any
// port forwarder on the host makes every visitor look local - see docs/manual.md.
//
// One of the three is now spendable, once, narrowly, behind a flag: see CROSS_ORIGIN_OK
// below for what the in-place join gives up and what is put in its place.
import crypto from 'node:crypto';
import os from 'node:os';

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

// Loopback arrives in three shapes. Bound to 127.0.0.1 you only ever see the first, but
// a dual-stack listener also hands you ::1 and the IPv4-mapped form - and forgetting the
// mapped one is exactly how you lock yourself out of your own island.
export function isLoopback(addr) {
  if (!addr) return false;
  let a = String(addr).toLowerCase();
  if (a === '::1') return true;
  if (a.startsWith('::ffff:')) a = a.slice(7);
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

// The private ranges: a guest from here is somebody on your own network.
export function isLanAddress(addr) {
  if (!addr) return false;
  let a = String(addr).toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (isLoopback(a)) return true;
  if (/^10\./.test(a)) return true;
  if (/^192\.168\./.test(a)) return true;
  if (/^169\.254\./.test(a)) return true;
  const m = /^172\.(\d{1,3})\./.exec(a);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true;   // fc00::/7, unique local
  if (/^fe[89ab][0-9a-f]:/.test(a)) return true;   // fe80::/10, link local
  return false;
}

// Host: 192.168.1.5:4747, [::1]:4747 or localhost:4747 - down to the bare name.
function hostName(header) {
  const h = String(header || '').trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) { const i = h.indexOf(']'); return i > 0 ? h.slice(1, i) : ''; }
  const i = h.lastIndexOf(':');
  return i > 0 ? h.slice(0, i) : h;
}

function ownAddresses() {
  const out = [];
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const nic of list || []) {
        if (!nic.internal && nic.address) out.push(String(nic.address).toLowerCase().split('%')[0]);
      }
    }
  } catch { /* no interfaces is not our problem to solve */ }
  return out;
}

// The names this machine answers to on the network. Nobody types an IP address at a
// phone: they type http://msi:4747/, so the machine's own name has to be acceptable too,
// or the island turns away the very visitor it was opened for. Still an allowlist and not
// a free-for-all, because that is what keeps a stranger's domain from pointing itself
// here and talking to us as though it were local.
function ownNames() {
  const out = [];
  try {
    const h = String(os.hostname() || '').toLowerCase();
    if (!h) return out;
    out.push(h);
    const short = h.split('.')[0];
    if (short && short !== h) out.push(short);
    if (short) out.push(`${short}.local`);   // what Bonjour and Android hand you
  } catch { /* a machine without a name is still an island */ }
  return out;
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (!x.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export const KEY_COOKIE = 'promptholm_key';

// The public set. Written so the /api/ line returns first and by itself, which is what
// makes a route added later local-only without its author having to think about it. The
// only implicitly public thing is the static fallback, and that is a file out of web/,
// which is what public means here anyway.
const PUBLIC_EXACT = new Set([
  '/', '/index.html', '/village.json', '/events', '/api/hello',
  '/favicon.ico', '/manifest.webmanifest', '/robots.txt', '/sw.js',
]);
const PUBLIC_PREFIX = ['/js/', '/css/', '/vendor/', '/icons/', '/shared/', '/fonts/'];

// The API paths a visitor may reach. Everything a visitor is shown has to be listed
// here by hand, one at a time, and /api/props earns its place by being scenery: shapes,
// places and sizes, naming no file and no folder. /api/crops is the same thing for the
// vegetable beds - what is growing and how far along, and nothing about the purse,
// which is why the farming is done at /api/garden and that is not on this list.
//
// POST /api/island is the carve-out, and it is written down because it breaks a rule this
// file was built around: CLAUDE.md says to put any new write route behind the same
// loopback check, and until now every single one was. It is the first write route a
// visitor can reach. The decision is deliberate - membership of the LAN (or an invite
// code) is the whole gate for this one - and what it buys is narrow: a visiting island is
// parsed field by field by lib/islandbundle.mjs and parked in lib/guests.mjs under
// data/guests/, where nothing merges it and a restart sweeps it. It cannot reach
// layout.json, village.json or any other file this island keeps.
//
// The consequence to be clear-eyed about: an inviteCode used to buy a read-only look at
// the island from outside the network, and now it buys writes as well - four berths of
// two megabytes, rate limited to one upload per ten seconds per address. Anyone handing
// out a code is handing out that much disk.
const PUBLIC_API = new Set(['/api/hello', '/api/props', '/api/crops', '/api/island', '/api/islands']);

// The in-place join, and the one signal it spends.
//
// Visiting a neighbour used to mean leaving: `cross()` in web/js/main.js navigates the
// whole page to their server, so everything that followed was same-origin and all three
// checks at the top of this file still held. That way stays. The second way keeps the
// page on the visitor's own origin (http://localhost:4747) and opens a WebSocket plus a
// handful of reads to the host instead - and a browser always sends Origin on a WebSocket
// handshake, so today that is refused by the third check, correctly.
//
// So the Origin is the signal this spends, and it is spent as narrowly as it can be:
//
//   - only an Origin whose host is a loopback NAME (localhost, 127.0.0.1, [::1], with or
//     without a port). A page on evil.example never clears this bar, which keeps the
//     whole CSRF property of the Origin check intact for everything off this machine.
//   - only the paths below, listed by hand, one at a time.
//   - only while the island is open.
//   - and the role that comes back is capped at 'guest', even over a loopback socket.
//     That clause is the reason this is not a one-line change: a page on this machine
//     under somebody else's control has exactly the loopback socket and the recognised
//     Host the keeper has, so the Origin was the only thing left telling them apart.
//     Without the cap, classify() would hand an islander's rights - /api/assign, which
//     spawns real Claude Code sessions unattended with full permissions in any folder -
//     to any localhost page a browser can be pointed at.
//
// The residual risk after this change, plainly: with joinInPlace on and the island open,
// any page served from a loopback name on this machine (another project's dev server, a
// stray static server, a page an extension opens) can read this island's scenery, join
// the WebSocket roster as a guest and walk a body around, and POST an island bundle into
// a berth within the size, count and rate limits lib/guests.mjs already imposes. It
// cannot reach /api/assign, /api/garden, the transcripts or the mail: those are not on
// this list, and 'guest' is refused anything not public anyway. With the flag off -- the
// default -- this file behaves exactly as it did before any of it was written.
//
// Two things left unsolved on purpose:
//   - /events is not here and cannot be. EventSource has no way to omit credentials, so
//     a cross-origin SSE stream would carry the invite cookie, which is the one thing
//     these requests must not do. The in-place mode takes its world updates over the
//     WebSocket, or by polling the reads below.
//   - the client fetches these with `{ credentials: 'omit' }`, and corsHeadersFor() never
//     answers Access-Control-Allow-Credentials, so a client that forgot is refused by the
//     browser rather than quietly honoured. That is why the invite-cookie path is not
//     considered anywhere in this allowance: on these requests there is no cookie.
export const CROSS_ORIGIN_OK = new Set([
  '/ws',
  '/village.json',
  '/api/hello',
  '/api/islands',
  '/api/island',
  '/api/island-journal',
  '/api/props',
  '/api/crops',
]);

// The verdict originOk() returns when a request cleared only by the allowance above. A
// truthy string rather than a second return value, so `if (!originOk(req))` keeps meaning
// exactly what it meant; only a caller that asks about the difference sees one.
export const CROSS_ORIGIN = 'cross-origin';

// Is this Origin an http(s) URL naming loopback? The name has to be loopback, not the
// address it resolves to: 'null' (a file:// or sandboxed document), an extension scheme
// and evil.example-pointed-at-127.0.0.1 all fail here, and the last of those is the
// whole point - it is the same rebinding case the Host check exists for.
function isLoopbackOrigin(origin) {
  let u;
  try { u = new URL(String(origin)); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return LOCAL_NAMES.has(hostName(u.host));
}

export function isPublicPath(p) {
  if (p.startsWith('/api/')) return PUBLIC_API.has(p);    // the API is deny-by-default. Always.
  if (PUBLIC_EXACT.has(p)) return true;
  return PUBLIC_PREFIX.some((q) => p.startsWith(q));
}

export function createAccess({ port, config }) {
  const net = config.network || {};
  const open = !!net.public;
  const invite = net.inviteCode || null;
  // Read the way the rest of the multiplayer block is read - loadConfig() in
  // lib/paths.mjs deep-merges that object key by key, so a config naming only this one
  // keeps every other default. Absent means false, and false means this whole file
  // behaves as it did before the in-place join existed.
  const joinInPlace = !!(config.multiplayer || {}).joinInPlace;

  // Only in public mode does anything beyond loopback become an acceptable Host: the
  // machine's own addresses, plus whatever name the keeper put in the config for a
  // dynamic-DNS entry or the WAN address behind a port forward.
  const allowedHosts = new Set(LOCAL_NAMES);
  if (open) {
    for (const a of ownAddresses()) allowedHosts.add(a);
    for (const n of ownNames()) allowedHosts.add(n);
    for (const h of net.hosts || []) allowedHosts.add(String(h).toLowerCase());
  }

  function hostAllowed(header) {
    const h = hostName(header);
    return !!h && allowedHosts.has(h);
  }

  // true when the Origin is absent or matches the Host, CROSS_ORIGIN when it cleared only
  // by the allowance above, false otherwise. `opts.path` is the request's pathname;
  // without one the allowance cannot apply at all, which leaves a caller that forgets to
  // pass it on the strict rule rather than on the loose one.
  function originOk(req, opts = {}) {
    const origin = req.headers.origin;
    if (!origin) return true;                     // curl, the scheduled task, a same-origin GET
    let host;
    try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
    if (host === String(req.headers.host || '').toLowerCase()) return true;
    if (!joinInPlace || !open) return false;
    if (!CROSS_ORIGIN_OK.has(opts.path ? String(opts.path) : '')) return false;
    return isLoopbackOrigin(origin) ? CROSS_ORIGIN : false;
  }

  // What a cross-origin read needs before a browser will let the page see the answer at
  // all. It lives here rather than in serve.mjs because deciding which origin and which
  // path is the same decision originOk() makes, and two copies of that would drift apart.
  // Returns the headers to set, or null - and null for a same-origin request, so an
  // ordinary response is byte-for-byte what it was.
  //
  // Access-Control-Allow-Credentials is deliberately absent and must stay absent: it is
  // what stops the invite cookie riding along on any of this.
  function corsHeadersFor(req, url) {
    const origin = req.headers.origin;
    if (!origin || !joinInPlace || !open) return null;
    if (!hostAllowed(req.headers.host)) return null;
    // A same-origin request needs none of this, and answering it with CORS headers anyway
    // would change every ordinary response the moment the flag went on.
    try { if (new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase()) return null; } catch { return null; }
    if (!CROSS_ORIGIN_OK.has(url && url.pathname ? String(url.pathname) : '')) return null;
    if (!isLoopbackOrigin(origin)) return null;
    return {
      // Echoed rather than '*', because '*' would also open the island to every page on
      // the internet the day somebody puts a proxy in front of this; Vary keeps a cache
      // from handing one origin's answer to another.
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    };
  }

  function hasInvite(req, url) {
    if (!invite) return false;
    const q = url && url.searchParams ? url.searchParams.get('key') : null;
    return sameSecret(q, invite) || sameSecret(cookieValue(req, KEY_COOKIE), invite);
  }

  // What the socket alone says, once the Host and the Origin have been settled.
  function bySocket(req, url) {
    const addr = req.socket && req.socket.remoteAddress;
    if (isLoopback(addr)) return { role: 'islander', why: 'loopback' };
    if (!open) return { role: 'refused', why: 'the island is not open' };
    if (isLanAddress(addr)) return { role: 'guest', why: 'same network' };
    if (hasInvite(req, url)) return { role: 'guest', why: 'invited' };
    return { role: 'refused', why: invite ? 'no invite' : 'outside the network' };
  }

  // 'islander' may do everything, 'guest' may look and walk, 'refused' gets a 403.
  function classify(req, url) {
    if (!hostAllowed(req.headers.host)) return { role: 'refused', why: `host ${req.headers.host}` };
    const verdict = originOk(req, { path: url && url.pathname });
    if (!verdict) return { role: 'refused', why: `origin ${req.headers.origin}` };

    const who = bySocket(req, url);
    // The cap. A request that only got past the Origin check by the in-place allowance
    // never comes back 'islander', however local its socket looks - see CROSS_ORIGIN_OK.
    // The `why` says so, because this is the one line a reader of the log has to be able
    // to tell apart from a real keeper.
    if (verdict !== CROSS_ORIGIN || who.role === 'refused') return who;
    return { role: 'guest', why: `${who.why}, ${CROSS_ORIGIN}` };
  }

  return {
    classify,
    corsHeadersFor,
    open,
    invite,
    joinInPlace,
    // Whether a fresh ?key= should be remembered, so the page's own assets come along
    // without carrying the code in every URL.
    inviteInUrl: (req, url) => !!invite && sameSecret(url && url.searchParams && url.searchParams.get('key'), invite) && !sameSecret(cookieValue(req, KEY_COOKIE), invite),
    addresses: () => (open ? ownAddresses() : []),
  };
}
