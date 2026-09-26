// The island's story animals, packed for the sea and taken apart again there
// (docs/animals-wire.md, Plans/dierenverhalen.md).
//
// The fourth door in the hull, beside the bundle, the parcel and the Codex list, and built
// the way those are: two halves out of one set of rebuilders. `packAnimals` is the islander's
// and forgiving - it clamps a coordinate, drops an entry it cannot use and fills in what was
// left out, because the state it packs is its own and a hen with a stray field should still
// reach the sea. `parseAnimals` is the sea's and strict, stricter than parseParcel in the way
// parseCodex is: an unknown field, a duplicate, a number where a word belongs, a coordinate
// off the island, one entry too many, an action for an animal that is not in the list or two
// actions for one animal - each refuses the lot. A body that had to be repaired is one nobody
// can reason about afterwards, and every field here is named: there is nothing a newer
// islander could usefully add that an older sea should pretend it did not see.
//
// Both halves rebuild rather than check, so nothing that came off the wire is kept, spread or
// trusted - the rule at the top of lib/islandbundle.mjs, for the same reason. And because the
// packer's output is exactly what the parser accepts, `parseAnimals(packAnimals(s))` deep-
// equals `packAnimals(s)`; tests/animal-bundle.test.mjs holds that.
//
// What travels is the public half of an animal - the part a visitor may see: her name, her
// species, her traits, where her patch is, one sentence about her and her friends under the
// redacted names a bundle already uses (`house:s3`). The diary, the numbers behind a
// relationship and every real house id stay with the islander (GET /api/animals, never on
// PUBLIC_API). This file cannot redact - it never sees a real id - so it refuses anything that
// does not look like a redacted one.
//
// The sea goes in a box that copies sea.mjs, lib/ and shared/ by name (Dockerfile.sea,
// tests/sea-image.test.mjs), and nothing on the sea touches a disk (tests/sea-join.test.mjs):
// so this imports shared/animals.mjs and nothing else. In particular not lib/islandbundle.mjs,
// whose guard and text helpers are private to it and whose own imports reach node:crypto for
// a door that has no use for either. The few lines borrowed are written out again below.
import { STORY_SPECIES, MAX_ANIMALS, ACTS, TRAITS, TRACE_KINDS } from '../shared/animals.mjs';

export const ANIMALS_V = 1;
// The door's ceiling. Six animals with a full sentence and four friends each, and thirty-two
// traces with their names, come to about seven kilobytes; sixteen is room, and it is nothing
// like the bundle's two megabytes.
export const MAX_ANIMAL_BYTES = 16 * 1024;
export const MAX_TRACES = 32;
export const MAX_FRIENDS = 4;
export const MAX_TRAITS = 3;
export const NAME_MAX = 24;
export const ABOUT_MAX = 160;
export const TRACE_NAME_MAX = 120;
// A patch's radius, in island units: a doorstep at the smallest, a meadow at the largest.
export const R_MIN = 0.3;
export const R_MAX = 4;
// How long one errand's act lasts, in seconds.
export const DUR_MIN = 1;
export const DUR_MAX = 120;
// The four words a relationship can be (lib/animal-stories.mjs labelOf).
export const FRIEND_LABELS = ['bonded', 'tolerant', 'suspicious', 'nemesis'];

const ANIMAL_ID = /^animal:\d{1,2}$/;
const ACTION_ID = /^act:\d{1,9}:\d{1,2}$/;
const TRACE_ID = /^trace:[a-z]+(:[a-z0-9]+){0,4}$/;
const TRACE_ID_MAX = 60;
// What a redacted settler id looks like: a kind, a colon, and guestVillage's counter -
// `house:s3`, `shed:s3:x7`. The same shape parseCodex asks of a Codex settler.
const RESIDENT_ID = /^[a-z]+:[A-Za-z0-9:._-]{1,40}$/;
// And belt to guestVillage's braces: a real session id starts like this, and a friend who
// carries one was not redacted.
const UUID_START = /[0-9a-f]{8}-[0-9a-f]{4}-/i;
const SPECIES = new Set(STORY_SPECIES);
const ACT_SET = new Set(ACTS);
const KIND_SET = new Set(TRACE_KINDS);
const LABEL_SET = new Set(FRIEND_LABELS);

const FIELDS = {
  body: new Set(['v', 'seq', 'gen', 'animals', 'actions', 'traces']),
  animal: new Set(['id', 'species', 'name', 'traits', 'home', 'r', 'about', 'friends']),
  friend: new Set(['who', 'label']),
  action: new Set(['id', 'animal', 'act', 'dur', 'to', 'look']),
  trace: new Set(['id', 'kind', 'x', 'z', 'rot', 'name', 'at']),
};

// ---- refusing, or clamping ------------------------------------------------------------
// One context decides which: strict is the sea reading the wire, forgiving the islander
// packing its own. `half` is the island's, the yardstick for every coordinate.
function context(strict, half) {
  return {
    strict,
    half,
    bad(what) {
      if (strict) throw refuse(what);
      return null;
    },
  };
}

function refuse(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// __proto__ and friends cannot reach an output object - every key written below is a literal
// - and this is the belt to that: a body carrying one was written by somebody probing, and a
// refusal says so. An animals body is four levels deep at its deepest (an animal's friend's
// label), so eight is generous and still stops a body that is nothing but brackets.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 8;
const MAX_NODES = 20000;
function refuseDangerousKeys(node, state = { n: 0 }, depth = 0) {
  if (depth > MAX_DEPTH) throw refuse('these animals are nested deeper than animals can be');
  if (++state.n > MAX_NODES) throw refuse('these animals have more pieces in them than a herd has');
  if (Array.isArray(node)) {
    for (const item of node) refuseDangerousKeys(item, state, depth + 1);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (FORBIDDEN_KEYS.has(key)) throw refuse(`a body carrying a "${key}" key is not a herd`);
    refuseDangerousKeys(node[key], state, depth + 1);
  }
}

// Strict only: every key must be one this record has. The forgiving side simply never reads
// what it does not know.
function onlyKnown(raw, fields, ctx, what) {
  if (!ctx.strict) return true;
  for (const k of Object.keys(raw)) {
    if (!fields.has(k)) { ctx.bad(`${what} arrived carrying "${k.slice(0, 24)}", which is not something one carries`); return false; }
  }
  return true;
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The same cleaning lib/islandbundle.mjs gives a name (its `strip`): no control characters,
// none of the invisible ones, runs of white space folded. A name is drawn onto a canvas on
// the page, and one control character wrecks the metrics of the whole label.
function strip(s, max) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    const invisible = (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || c === 0xfeff;
    if (!control && !invisible) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

// Text the sea is handed has been through strip() on the islander already; text that would
// still change is text that did not come out of packAnimals, and is refused, not repaired.
function text(v, max, ctx, what) {
  if (typeof v !== 'string') return ctx.bad(`${what} arrived as something that is not text`);
  const out = strip(v, max);
  if (ctx.strict && (out !== v || !out)) return ctx.bad(`${what} arrived empty, too long or with characters that do not belong in one`);
  return out || null;
}

// A real number, never something that merely converts to one (the reason `whole` in
// lib/islandbundle.mjs insists too: Number(null) is a perfectly finite zero).
function num(v, lo, hi, ctx, what, { whole = false } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ctx.bad(`${what} arrived as something that is not a number`);
  let n = whole ? Math.round(v) : Math.round(v * 1000) / 1000;
  if (whole && ctx.strict && n !== v) return ctx.bad(`${what} was meant to be a whole number`);
  if (n < lo || n > hi) {
    if (ctx.strict) return ctx.bad(`${what} ${n} is outside ${lo}..${hi}`);
    n = Math.min(hi, Math.max(lo, n));
  }
  return n;
}

// A spot on the island, [x, z] in its own frame. Off the island is refused by the sea and
// pulled back onto the edge by the islander - which only ever happens to a hen whose home
// was worked out on a grid the island has since outgrown, and the edge is where she was.
function point(v, ctx, what) {
  if (!Array.isArray(v) || v.length !== 2) return ctx.bad(`${what} arrived that is not a pair`);
  const lim = ctx.half;
  const x = num(v[0], -lim, lim, ctx, what);
  const z = num(v[1], -lim, lim, ctx, what);
  if (x === null || z === null) return null;
  return [x, z];
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---- the records ------------------------------------------------------------------------

function friend(raw, ctx) {
  if (!isObject(raw)) return ctx.bad('a friend arrived that is not an object');
  if (!onlyKnown(raw, FIELDS.friend, ctx, 'a friend')) return null;
  if (typeof raw.who !== 'string' || !RESIDENT_ID.test(raw.who) || UUID_START.test(raw.who)) {
    return ctx.bad('a friend arrived under a name that is not a redacted one');
  }
  if (typeof raw.label !== 'string' || !LABEL_SET.has(raw.label)) {
    if (ctx.strict) return ctx.bad(`"${String(raw.label).slice(0, 24)}" is not what an animal can be to somebody`);
    return { who: raw.who, label: 'tolerant' };
  }
  return { who: raw.who, label: raw.label };
}

function animal(raw, ctx) {
  if (!isObject(raw)) return ctx.bad('an animal arrived that is not an object');
  if (!onlyKnown(raw, FIELDS.animal, ctx, 'an animal')) return null;
  if (typeof raw.id !== 'string' || !ANIMAL_ID.test(raw.id)) return ctx.bad('an animal arrived without an id that is one');
  if (typeof raw.species !== 'string' || !SPECIES.has(raw.species)) return ctx.bad(`"${String(raw.species).slice(0, 24)}" is not an animal with a story`);

  let name = text(raw.name, NAME_MAX, ctx, 'an animal\'s name');
  if (name === null) name = raw.species[0].toUpperCase() + raw.species.slice(1);

  // One to three of TRAITS, each once. The forgiving side keeps the ones it knows and, if
  // none are left, gives her the one trait every species' pool has - a hen with no character
  // at all would be an islander bug, and the sea walking her as `curious` is the gentlest
  // way of carrying it.
  let traits = [];
  if (!Array.isArray(raw.traits)) {
    if (ctx.strict) return ctx.bad('an animal\'s traits arrived as something that is not a list');
  } else {
    if (ctx.strict && (raw.traits.length < 1 || raw.traits.length > MAX_TRAITS)) return ctx.bad(`an animal has ${raw.traits.length} traits and may have 1..${MAX_TRAITS}`);
    for (const t of raw.traits) {
      if (typeof t !== 'string' || !Object.hasOwn(TRAITS, t)) { if (ctx.strict) return ctx.bad(`"${String(t).slice(0, 24)}" is not a trait`); continue; }
      if (traits.includes(t)) { if (ctx.strict) return ctx.bad(`an animal is ${t} twice`); continue; }
      traits.push(t);
    }
  }
  traits = traits.slice(0, MAX_TRAITS);
  if (!traits.length) traits = ['curious'];

  const home = point(raw.home, ctx, 'an animal\'s home');
  if (home === null) return null;
  let r = raw.r === undefined && !ctx.strict ? 0.9 : num(raw.r, R_MIN, R_MAX, ctx, 'an animal\'s patch');
  if (r === null) r = 0.9;

  let about = null;
  if (raw.about !== null && raw.about !== undefined) about = text(raw.about, ABOUT_MAX, ctx, 'what is said about an animal');

  let friends = [];
  if (raw.friends !== null && raw.friends !== undefined) {
    if (!Array.isArray(raw.friends)) {
      if (ctx.strict) return ctx.bad('an animal\'s friends arrived as something that is not a list');
    } else {
      if (ctx.strict && raw.friends.length > MAX_FRIENDS) return ctx.bad(`an animal has ${raw.friends.length} friends on the wire and may show ${MAX_FRIENDS}`);
      for (const fr of raw.friends) {
        const built = friend(fr, ctx);
        if (!built) continue;
        if (friends.some((o) => o.who === built.who)) { if (ctx.strict) return ctx.bad(`${built.who} is one friend, listed twice`); continue; }
        friends.push(built);
      }
      friends = friends.slice(0, MAX_FRIENDS);
    }
  }

  return { id: raw.id, species: raw.species, name, traits, home, r, about, friends };
}

function action(raw, ctx) {
  if (!isObject(raw)) return ctx.bad('an action arrived that is not an object');
  if (!onlyKnown(raw, FIELDS.action, ctx, 'an action')) return null;
  if (typeof raw.id !== 'string' || !ACTION_ID.test(raw.id)) return ctx.bad('an action arrived without an id that is one');
  if (typeof raw.animal !== 'string' || !ANIMAL_ID.test(raw.animal)) return ctx.bad('an action arrived for something that is not an animal');
  if (typeof raw.act !== 'string' || !ACT_SET.has(raw.act)) return ctx.bad(`"${String(raw.act).slice(0, 24)}" is not something an animal does`);
  let dur = num(raw.dur, DUR_MIN, DUR_MAX, ctx, 'how long an action lasts');
  if (dur === null) dur = DUR_MIN;
  const to = point(raw.to, ctx, 'where an action happens');
  if (to === null) return null;
  let look = null;
  if (raw.look !== null && raw.look !== undefined) look = point(raw.look, ctx, 'what an animal faces');
  return { id: raw.id, animal: raw.animal, act: raw.act, dur, to, look };
}

function trace(raw, ctx) {
  if (!isObject(raw)) return ctx.bad('a trace arrived that is not an object');
  if (!onlyKnown(raw, FIELDS.trace, ctx, 'a trace')) return null;
  if (typeof raw.id !== 'string' || raw.id.length > TRACE_ID_MAX || !TRACE_ID.test(raw.id)) return ctx.bad('a trace arrived without an id that is one');
  if (typeof raw.kind !== 'string' || !KIND_SET.has(raw.kind)) return ctx.bad(`"${String(raw.kind).slice(0, 24)}" is not a mark an animal leaves`);
  const lim = ctx.half;
  const x = num(raw.x, -lim, lim, ctx, 'where a trace is');
  const z = num(raw.z, -lim, lim, ctx, 'where a trace is');
  if (x === null || z === null) return null;
  let rot = raw.rot;
  if (ctx.strict) {
    rot = num(raw.rot, 0, 3, ctx, 'which way a trace faces', { whole: true });
  } else {
    rot = typeof rot === 'number' && Number.isFinite(rot) ? ((Math.round(rot) % 4) + 4) % 4 : 0;
  }
  const name = text(raw.name, TRACE_NAME_MAX, ctx, 'a trace\'s name');
  if (name === null) return null;
  let at = raw.at === undefined && !ctx.strict ? 0 : num(raw.at, 0, 1e15, ctx, 'when a trace was left', { whole: true });
  if (at === null) at = 0;
  return { id: raw.id, kind: raw.kind, x, z, rot, name, at };
}

function list(raw, cap, build, ctx, what) {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) { ctx.bad(`${what} arrived as something that is not a list`); return []; }
  if (raw.length > cap && ctx.strict) ctx.bad(`${raw.length} ${what} is more than the ${cap} an island keeps`);
  const out = [];
  for (const item of raw) {
    const built = build(item, ctx);
    if (built !== null && built !== undefined) out.push(built);
  }
  return out;
}

const sequence = (v, ctx, what) => {
  if (v === undefined && !ctx.strict) return 0;
  const n = num(v, 0, Number.MAX_SAFE_INTEGER, ctx, what, { whole: true });
  return n === null ? 0 : n;
};

// ---- the two halves -------------------------------------------------------------------

// The islander's: whatever its own state says, as the body the door will take. `half` is the
// island's (terrain.half; gridSize / 2) - every coordinate is pulled onto it. Without one it
// is the largest island there is, so a caller that forgot is still sent something the sea
// can refuse with a reason.
//
// Sorted by id, so the same state is the same bytes and a caller can tell "unchanged" by
// hashing it; and the order of `animals` is the order the sea's `af` rows are indexed in, so
// it had better not depend on the order a Map happened to be filled in.
export function packAnimals({ seq = 0, gen = 0, animals = [], actions = [], traces = [] } = {}, { half = 256 } = {}) {
  const ctx = context(false, Number.isFinite(half) && half > 0 ? half : 256);
  const herd = [];
  for (const a of list(animals, Infinity, animal, ctx, 'animals').sort(byId)) {
    if (herd.length >= MAX_ANIMALS) break;
    if (herd.some((h) => h.id === a.id)) continue;
    herd.push(a);
  }
  const who = new Set(herd.map((a) => a.id));
  const doing = [];
  for (const act of list(actions, Infinity, action, ctx, 'actions').sort(byId)) {
    if (!who.has(act.animal)) continue;
    if (doing.some((d) => d.animal === act.animal || d.id === act.id)) continue;
    doing.push(act);
  }
  // Over the cap, the newest marks are the ones kept: a trace is permanent on the island, but
  // what the sea draws is what a visitor sees, and the latest is the story being told now.
  let marks = [];
  for (const t of list(traces, Infinity, trace, ctx, 'traces')) {
    if (!marks.some((m) => m.id === t.id)) marks.push(t);
  }
  marks.sort((a, b) => b.at - a.at || byId(a, b));
  marks = marks.slice(0, MAX_TRACES).sort(byId);

  const body = { v: ANIMALS_V, seq: sequence(seq, ctx, 'the story\'s sequence'), gen: sequence(gen, ctx, 'the generation'), animals: herd, actions: doing, traces: marks };
  // And under the door's ceiling, oldest trace first, then the sentences - which only a
  // herd with very long names and a year of marks would ever need.
  while (JSON.stringify(body).length > MAX_ANIMAL_BYTES && body.traces.length) {
    let oldest = 0;
    for (let i = 1; i < body.traces.length; i++) if (body.traces[i].at < body.traces[oldest].at) oldest = i;
    body.traces.splice(oldest, 1);
  }
  for (const a of body.animals) {
    if (JSON.stringify(body).length <= MAX_ANIMAL_BYTES) break;
    a.about = null;
  }
  return body;
}

// The sea's: the whole herd or nothing. `half` is the island's own (the fleet's `half`), the
// yardstick for every coordinate - the island has been vouched for by then (fleet.vouch), so
// the body cannot choose its own.
export function parseAnimals(body, { half } = {}) {
  if (!isObject(body)) throw refuse('that is not a herd');
  if (typeof half !== 'number' || !Number.isFinite(half) || half <= 0) throw refuse('there is no island to measure these animals against');
  refuseDangerousKeys(body);
  const ctx = context(true, half);
  onlyKnown(body, FIELDS.body, ctx, 'a herd');
  if (body.v !== ANIMALS_V) throw refuse(`these animals speak version ${JSON.stringify(body.v)} and this sea speaks ${ANIMALS_V}`);
  const seq = sequence(body.seq, ctx, 'the story\'s sequence');
  const gen = sequence(body.gen, ctx, 'the generation');
  for (const k of ['animals', 'actions', 'traces']) {
    if (body[k] !== undefined && !Array.isArray(body[k])) throw refuse(`the ${k} arrived as something that is not a list`);
  }

  const animals = list(body.animals, MAX_ANIMALS, animal, ctx, 'animals');
  const seen = new Set();
  for (const a of animals) {
    if (seen.has(a.id)) throw refuse(`${a.id} arrived twice`);
    seen.add(a.id);
  }
  animals.sort(byId);

  const actions = list(body.actions, MAX_ANIMALS, action, ctx, 'actions');
  const acting = new Set();
  const ids = new Set();
  for (const a of actions) {
    if (ids.has(a.id)) throw refuse(`${a.id} arrived twice`);
    ids.add(a.id);
    if (!seen.has(a.animal)) throw refuse(`${a.id} is for ${a.animal}, who is not in the herd`);
    if (acting.has(a.animal)) throw refuse(`${a.animal} was given two things to do at once`);
    acting.add(a.animal);
  }
  actions.sort(byId);

  const traces = list(body.traces, MAX_TRACES, trace, ctx, 'traces');
  const marks = new Set();
  for (const t of traces) {
    if (marks.has(t.id)) throw refuse(`${t.id} arrived twice`);
    marks.add(t.id);
  }
  traces.sort(byId);

  return { v: ANIMALS_V, seq, gen, animals, actions, traces };
}
