// What a panel remembers, and the whole of what anybody may put into it.
//
// This is the contract between the two halves of a shared board. The browser reads it
// to know what a face may ask for; the server reads the same file to decide what it
// will accept, and neither can drift from the other. Node and the browser both import
// it, like shared/shapes.mjs and shared/terrain.mjs.
//
// Nothing here has any behaviour. A face's buttons and layout live in web/js/faces.js;
// what arrives over the wire is only ever "this field is now that value", which is why
// two people pressing at once settle rather than argue, and why a late arrival can be
// handed the whole state and draw the same board as everyone else.
//
// Adding a field: put it here, give it a start, and the face can send it. The server
// needs no further teaching.

// A field is one of three shapes. `start` is what a fresh board holds.
//   one-of   a name from a fixed list
//   number   a finite number, clamped
//   text     a line typed by a person, cleaned and cut to length
export const FACES = {
  notice: {},
  clock: {},
  // A billboard carries somebody else's site and so has nothing of its own to remember -
  // it is here rather than left out so that the server still knows the name, and E at one
  // reads as a board you may stand at and find nothing to press.
  billboard: {},
  tally: {
    tab: { kind: 'one-of', of: ['count', 'note'], start: 'count' },
    count: { kind: 'number', min: -9999, max: 9999, start: 0 },
    what: { kind: 'text', max: 40, start: '' },
    note: { kind: 'text', max: 200, start: '' },
  },
};

// Control and invisible characters out, one line, cut to length. The same care
// lib/players.mjs takes over a player's name, for a different reason: a name is drawn
// into a canvas, while this ends up in a page, so on a --public island it is what keeps
// a visitor from pushing anything of their own into somebody else's DOM. The faces
// escape on the way in as well - two locks on one door, deliberately.
export function plainText(v, max) {
  let out = '';
  for (const ch of String(v == null ? '' : v)) {
    const c = ch.codePointAt(0);
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    const invisible = (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || c === 0xfeff;
    if (!control && !invisible) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function knownFace(face) {
  return Object.prototype.hasOwnProperty.call(FACES, String(face));
}

// What a board holds before anybody has touched it.
export function startState(face) {
  const fields = FACES[face] || {};
  const out = {};
  for (const [name, f] of Object.entries(fields)) out[name] = f.start;
  return out;
}

// One field, one value. Returns the value actually stored, or null if the field is not
// one this face has or the value is not one it will take - and null is a refusal, never
// something to store.
//
// Insisting on an actual number rather than something that merely converts to one, for
// the reason num() gives in lib/players.mjs: JSON turns NaN into null on the way out and
// Number(null) is a perfectly finite zero, so a coercing check would quietly set a
// counter to nothing instead of rejecting the message.
export function applyUi(face, state, action, value) {
  const field = (FACES[face] || {})[String(action)];
  if (!field) return null;
  if (field.kind === 'one-of') {
    const v = String(value);
    if (!field.of.includes(v)) return null;
    state[action] = v;
    return v;
  }
  if (field.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const v = Math.max(field.min, Math.min(field.max, Math.round(value)));
    state[action] = v;
    return v;
  }
  if (field.kind === 'text') {
    if (typeof value !== 'string') return null;
    const v = plainText(value, field.max);
    state[action] = v;
    return v;
  }
  return null;
}

// ---------------------------------------------------------------- billboards
// Which site a billboard carries, and the whole of what counts as a usable address.
// Here rather than in web/js/faces.js because the server reads it too: it is what
// /billboard checks a request against before it will fetch anything, and a rule the two
// halves disagreed about would be a hole rather than a bug.
export const BILLBOARD = 'https://www.boikon.nl/';

// A board carries the site it was put up with: `--note https://...` on the prop. A whole
// URL, because a bare host or a typo would frame nothing and there would be no error to
// say so. Anything else falls back to the address above, so a mistake shows the wrong
// billboard rather than a broken one.
//
// https, or http when it is this machine talking to itself. That exception is not a
// loosening: plain http to anywhere else would be the island fetching over the open
// network in the clear, while http to loopback cannot leave the machine - and it is the
// only way to hang the island's own pages on a board, which is worth having.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(host) {
  return LOOPBACK.has(String(host || '').toLowerCase());
}

export function siteUrl(note) {
  try {
    const u = new URL(String(note || '').trim());
    if (u.protocol === 'https:') return u;
    if (u.protocol === 'http:' && isLoopbackHost(u.hostname)) return u;
    return null;
  } catch { return null; }
}

// A board can also carry a page of the island's own, written by hand and dropped in
// data/boards/. That is the thing a billboard turns out to be wanted for most: putting
// something up for the people on the island to read, without it having to exist on the
// web at all.
//
// Written as a plain name - `--note welcome` or `--note welcome.html` - because a name is
// what a person has in their head, and anything with a scheme in it is a site. Kept to
// one segment of safe characters, which is also what keeps it from walking out of the
// folder it lives in: no slashes, no dots doubling back, nothing to escape with.
const PAGE = /^[a-z0-9][a-z0-9_-]{0,63}(\.html?)?$/i;

export function boardPage(note) {
  const raw = String(note == null ? '' : note).trim();
  if (!raw || !PAGE.test(raw)) return null;
  return raw.replace(/\.html?$/i, '') + '.html';
}

// What a given board is actually pointed at: a page of ours, a site, or the default.
// Exactly one of `page` and `site` is ever set, so neither side has to guess.
export function boardSite(prop) {
  return siteUrl(prop && prop.note) || new URL(BILLBOARD);
}

export function boardTarget(prop) {
  const page = boardPage(prop && prop.note);
  if (page) return { page, label: page.replace(/\.html$/, '') };
  const site = siteUrl(prop && prop.note) || new URL(BILLBOARD);
  return { site, label: site.host };
}
