// Story facts belong to the islander. This reducer has no clock, filesystem or browser:
// replaying yesterday's outcomes must not ask today's rules to choose them again.
export const STORY_VERSION = 1;
export const ACTIVITY_WINDOW_MS = 20 * 60 * 1000;
const KINDS = new Set(['horse', 'cow', 'sheep', 'goat', 'chicken', 'duck', 'gull', 'pig', 'sparrow']);
const own = (o, k) => Object.hasOwn(o, k);
const fail = (message) => { throw new Error(`Animal story: ${message}`); };
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;
const count = (v) => Number.isSafeInteger(v) && v >= 0;

export function emptyAnimalStories() {
  return { version: STORY_VERSION, seq: 0, animals: {}, cursors: {}, pending: {} };
}

// Keys are inserted as own properties: session ids are opaque, and even '__proto__'
// must remain an id rather than changing an object's prototype.
const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

export function applyAnimalEvent(before, event) {
  if (!event || event.version !== STORY_VERSION || event.rules !== 1 ||
      event.seq !== before.seq + 1 || event.id !== `animal-event:${event.seq}` || !count(event.at)) {
    fail('invalid event envelope or unsupported version');
  }
  const s = structuredClone(before), d = event.data;
  if (!d || typeof d !== 'object') fail('missing event data');
  if (event.kind === 'arrival') {
    if (!text(d.id) || !text(d.name) || !KINDS.has(d.species) || own(s.animals, d.id)) fail('invalid arrival');
    put(s.animals, d.id, { id: d.id, name: d.name, species: d.species, arrivedAt: event.at,
      lastWindow: -1, relationships: {} });
  } else if (event.kind === 'activity') {
    if (!text(d.source) || !count(d.cursor) || (own(s.cursors, d.source) && d.cursor <= s.cursors[d.source])) {
      fail('activity cursor must advance');
    }
    const first = !own(s.cursors, d.source);
    put(s.cursors, d.source, d.cursor);
    if (d.action != null) {
      const a = d.action, animal = own(s.animals, a.animal) && s.animals[a.animal];
      if (first || !animal || animal.species !== 'chicken' || a.id !== `animal-action:${event.seq}` ||
          a.resident !== d.source || a.kind !== 'visit' || !count(a.window) ||
          a.window !== Math.floor(event.at / ACTIVITY_WINDOW_MS) || a.window <= animal.lastWindow ||
          Object.values(s.pending).some((p) => p.animal === a.animal)) fail('invalid visit intention');
      animal.lastWindow = a.window;
      put(s.pending, a.id, { id: a.id, animal: a.animal, resident: a.resident, kind: a.kind, window: a.window });
    }
  } else if (event.kind === 'encounter') {
    const a = own(s.pending, d.action) && s.pending[d.action];
    if (!a) fail('encounter has no pending intention');
    const animal = s.animals[a.animal];
    const previous = own(animal.relationships, a.resident) ? animal.relationships[a.resident].visits : 0;
    if (d.visits !== previous + 1 || !['tolerant', 'bonded'].includes(d.relationship)) fail('invalid encounter outcome');
    put(animal.relationships, a.resident, { visits: d.visits, label: d.relationship, changedAt: event.at });
    delete s.pending[d.action];
  } else fail('unknown event kind');
  s.seq = event.seq;
  return s;
}

// The first observation establishes a baseline. Lower counters (a rescan or corrected
// transcript) never move it backwards. One scan burst buys at most one visit intention.
export function decideAnimalEvent(s, command, at) {
  if (!count(at)) fail('invalid timestamp');
  if (!command || typeof command !== 'object') fail('invalid command');
  const seq = s.seq + 1;
  let kind, data;
  if (command.kind === 'arrive') {
    const { id, name, species } = command;
    if (!text(id) || !text(name) || !KINDS.has(species)) fail('invalid arrival');
    if (own(s.animals, id)) {
      if (s.animals[id].name !== name || s.animals[id].species !== species) fail('animal id already used');
      return null;
    }
    kind = 'arrival'; data = { id, name, species };
  } else if (command.kind === 'observe') {
    const { source, cursor, animal: id } = command;
    if (!text(source) || !count(cursor) || !text(id) || !own(s.animals, id)) fail('invalid activity');
    if (own(s.cursors, source) && cursor <= s.cursors[source]) return null;
    const animal = s.animals[id], window = Math.floor(at / ACTIVITY_WINDOW_MS);
    const canVisit = own(s.cursors, source) && animal.species === 'chicken' && window > animal.lastWindow &&
      !Object.values(s.pending).some((a) => a.animal === id);
    kind = 'activity';
    data = { source, cursor, action: canVisit ? { id: `animal-action:${seq}`, animal: id,
      resident: source, kind: 'visit', window } : null };
  } else if (command.kind === 'complete') {
    if (!text(command.action)) fail('invalid action id');
    if (!own(s.pending, command.action)) return null;
    const a = s.pending[command.action], animal = s.animals[a.animal];
    const visits = (own(animal.relationships, a.resident) ? animal.relationships[a.resident].visits : 0) + 1;
    kind = 'encounter'; data = { action: a.id, visits, relationship: visits >= 3 ? 'bonded' : 'tolerant' };
  } else fail('unknown command');
  return { version: STORY_VERSION, rules: 1, seq, id: `animal-event:${seq}`, at, kind, data };
}
