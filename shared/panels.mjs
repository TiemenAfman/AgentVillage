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
