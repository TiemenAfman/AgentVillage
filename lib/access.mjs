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
// port forwarder on the host makes every visitor look local - see the README.
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
const PUBLIC_API = new Set(['/api/hello', '/api/props', '/api/crops']);

export function isPublicPath(p) {
  if (p.startsWith('/api/')) return PUBLIC_API.has(p);    // the API is deny-by-default. Always.
  if (PUBLIC_EXACT.has(p)) return true;
  return PUBLIC_PREFIX.some((q) => p.startsWith(q));
}

export function createAccess({ port, config }) {
  const net = config.network || {};
  const open = !!net.public;
  const invite = net.inviteCode || null;

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

  function originOk(req) {
    const origin = req.headers.origin;
    if (!origin) return true;                     // curl, the scheduled task, a same-origin GET
    try {
      return new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase();
    } catch { return false; }
  }

  function hasInvite(req, url) {
    if (!invite) return false;
    const q = url && url.searchParams ? url.searchParams.get('key') : null;
    return sameSecret(q, invite) || sameSecret(cookieValue(req, KEY_COOKIE), invite);
  }

  // 'islander' may do everything, 'guest' may look and walk, 'refused' gets a 403.
  function classify(req, url) {
    if (!hostAllowed(req.headers.host)) return { role: 'refused', why: `host ${req.headers.host}` };
    if (!originOk(req)) return { role: 'refused', why: `origin ${req.headers.origin}` };

    const addr = req.socket && req.socket.remoteAddress;
    if (isLoopback(addr)) return { role: 'islander', why: 'loopback' };
    if (!open) return { role: 'refused', why: 'the island is not open' };
    if (isLanAddress(addr)) return { role: 'guest', why: 'same network' };
    if (hasInvite(req, url)) return { role: 'guest', why: 'invited' };
    return { role: 'refused', why: invite ? 'no invite' : 'outside the network' };
  }

  return {
    classify,
    open,
    invite,
    // Whether a fresh ?key= should be remembered, so the page's own assets come along
    // without carrying the code in every URL.
    inviteInUrl: (req, url) => !!invite && sameSecret(url && url.searchParams && url.searchParams.get('key'), invite) && !sameSecret(cookieValue(req, KEY_COOKIE), invite),
    addresses: () => (open ? ownAddresses() : []),
  };
}
