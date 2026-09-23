// Two machines, and every call says which one it means.
//
// The page used to be served by the only server it ever spoke to, so every call in web/js
// was a bare relative string - `fetch('/api/garden')` - and that was correct forty times
// over. It stops being correct the moment the world lives somewhere else: an island's own
// business (its garden, its mail, its tickets, the folder it spawns an agent in) stays on
// the machine the sessions are on, while the world everybody shares moves to a sea that
// may be on another box entirely, or in front of a reverse proxy, or both.
//
// So there are two addresses, and nothing may reach either of them without naming it:
//
//   mine(path)   my own islander. The machine this island's files are on.
//   sea(path)    the world. Possibly the same origin, possibly a Docker box.
//
// Deliberately not a router. A table mapping paths to targets would be a second place to
// forget an entry, and `/api/island` sitting next to `/api/islands` is exactly the kind of
// near-miss that has cost this project time before. Every call site says it out loud, and
// tests/api-base.test.mjs asserts that no bare `fetch('/` survives under web/js/.
//
// Both bases are worked out from *this module's own URL* rather than from the document or
// from location. That is what makes the island survive being served at a subpath: a page
// at https://example/island/ loads this file from https://example/island/js/api.js, so
// `../` is the island root without anybody having to configure it. Resolving against the
// document would have given the right answer at / and the wrong one everywhere else - and
// it is the same bug the texture prefix had, see assets.js.

// A page with no islander behind it at all, and never one: the Android app, which carries
// web/ inside itself and joins one sea straight from the phone. scripts/pack-android.mjs
// writes `{ sea, key }` into that copy of index.html; a page served by an islander never
// has it, so everything below behaves exactly as it always did there.
export const STANDALONE = globalThis.PROMPTHOLM_STANDALONE || null;

// Where this island's own server is: the directory above web/js/, whatever that turns out
// to be. Every HTML page on this island lives there, so this is the same answer no matter
// which of them loaded the module.
const ROOT = new URL('../', import.meta.url);

// Where the world is. Until something says otherwise it is the same place - which is what
// single player is, and what every existing deployment is, so this file changes no
// behaviour until a sea address is handed to it.
let seaAt = ROOT;

function at(base, path) {
  // Call sites are written with a leading slash because that is what they have always
  // looked like and it reads as "a route, not a file beside me". Strip it, or new URL
  // would resolve it against the origin and throw the subpath away again.
  return new URL(String(path).replace(/^\/+/, ''), base).href;
}

// Point the world somewhere else. Called once at boot, from whatever /api/hello says, and
// with nothing at all in single player.
// A relative address is resolved against this island's own root rather than against
// location, so the answer is the same in a worker, in a test under Node, and on a page
// served from a subpath - all three of which have a different idea of what location means.
export function useSea(url) {
  seaAt = url ? new URL(url, ROOT) : ROOT;
}

export function mineUrl(path) { return at(ROOT, path); }
export function seaUrl(path) { return at(seaAt, path); }

// The socket, for createNet. A function rather than a constant because the sea's address
// is not known at import time - it arrives with /api/hello - and a constant computed here
// would be the page's own origin for ever.
export function seaSocket() {
  const u = new URL('ws', seaAt);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.href;
}

// My islander is not there. One error for both of the ways that happens - no server on
// this machine at all (a phone, a second screen) and a server that stopped - so that the
// forty call sites do not each have to invent their own opinion about which it was.
export class IslanderUnreachable extends Error {
  constructor(path, cause) {
    super(`no islander at ${path}`);
    this.name = 'IslanderUnreachable';
    this.path = path;
    this.cause = cause;
  }
}

// Whether the machine with the files on it is answering. This is a *mode*, not an error:
// a page with no islander is a perfectly good page that can look at the world and walk
// around in it, and the only thing it cannot do is touch somebody's disk. Kept here rather
// than discovered separately by forty catch blocks, because forty opinions about it is
// forty bugs.
let reachable = !STANDALONE;
const watchers = new Set();
export function islanderHere() { return reachable; }
export function onIslanderChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function verdict(ok) {
  if (ok === reachable) return;
  reachable = ok;
  for (const fn of watchers) { try { fn(ok); } catch { /* a listener's problem, not ours */ } }
}

// A refusal is not an absence. A 403 means the islander is right there and said no, which
// is the other axis entirely - who you are, not whether there is a machine - so it comes
// back as an ordinary Response for the caller to read, exactly as it always did.
export async function mine(path, init) {
  // Asked without asking. The app's own origin (http://tauri.localhost) answers every path
  // with *something*, so a fetch there would come back as an islander that said 404 - and
  // a 404 from an islander is "our own island, which will not say", the keeper's mode.
  if (STANDALONE) throw new IslanderUnreachable(path, null);
  let r;
  try {
    r = await fetch(mineUrl(path), { credentials: 'same-origin', ...init });
  } catch (e) {
    verdict(false);
    throw new IslanderUnreachable(path, e);
  }
  verdict(true);
  return r;
}

// The world. Never carries a cookie: the invite cookie is the islander's and must not ride
// along on a cross-origin request - lib/access.mjs says so at length, and answers no
// Access-Control-Allow-Credentials, so a request that forgot would be refused by the
// browser rather than quietly honoured.
export function sea(path, init) {
  return fetch(seaUrl(path), { credentials: 'omit', ...init });
}
