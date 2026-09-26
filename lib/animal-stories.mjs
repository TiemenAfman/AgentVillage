// What happens to the island's story animals (Plans/dierenverhalen.md, docs/animal-stories.md).
//
// Story facts belong to the islander, and this file is the whole of how they are made: a
// reducer with no clock, no filesystem and no browser. `decide*` looks at the state and a
// command and returns the one event that command causes - or null - with every choice
// already made: which door, which of the twelve encounters, how much trust it bought, which
// words the diary says it in. `applyAnimalEvent` only applies such an event, and checks that
// it hangs together; it never chooses anything. That split is what makes replaying
// yesterday's journal give yesterday's story even after today's rules changed: an outcome is
// in the event, not re-derived from it (`rules` in the envelope says which rules chose it).
//
// Randomness is shared/rng.mjs seeded off the event's own sequence number, so the same state
// and the same command decide the same event on any machine, and a test can walk a hen
// through a month of encounters in a millisecond.
import { makeRng, hash32 } from '../shared/rng.mjs';
import {
  STORY_SPECIES, MAX_ANIMALS, ARRIVAL_ORDER, TRAITS, OPPOSITES, TRAIT_POOLS, NAMES, TRACE_KINDS, MOTION,
} from '../shared/animals.mjs';

export const STORY_VERSION = 1;
// The rule set new decisions are made under. Bump it when a balance change should apply to
// future choices only; old events keep the number they were decided with and replay as
// they were.
export const RULES = 1;
const RULE_SETS = new Set([1]);

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const ACTIVITY_WINDOW_MS = 20 * MINUTE_MS;

// The tuning, in real time. `pace` divides every duration, so a tester can play a week of an
// island in an afternoon (config `animals.pace`); tests pass explicit rules.
export function rulesFor(pace = 1) {
  const p = Number.isFinite(pace) && pace >= 1 ? pace : 1;
  return {
    window: ACTIVITY_WINDOW_MS / p,        // one notable encounter per animal per window
    hour: HOUR_MS / p,
    notablePerHour: 3,                     // across the whole island
    day: DAY_MS / p,                       // one major relationship change per animal per day
    arrivalGap: (20 * HOUR_MS) / p,        // between one arrival and the next
    arrivalEncounters: 4,                  // ... and this many encounters in between
    // An errand the sea never finished. Never shorter than ten real minutes, whatever the pace:
    // walking is not sped up with the story, and at pace 300 a hen was let go of on her way
    // to a door she would have reached in another twenty seconds.
    abandonAfter: Math.max(10 * MINUTE_MS, (3 * HOUR_MS) / p),
    vignetteAfter: (12 * HOUR_MS) / p,     // an absence long enough for one gentle line
    restEvery: 3,                          // windows between two rests at a quiet house
    quietAfter: (2 * HOUR_MS) / p,         // a house this long without activity is quiet
    maxRelations: 8,                       // tracked per animal
    mysteryAfter: 8,                       // island encounters before the first clue
    maxFeeders: 3,
  };
}
const DEFAULT_RULES = rulesFor(1);

const own = (o, k) => Object.hasOwn(o, k);
const fail = (message) => { throw new Error(`Animal story: ${message}`); };
const text = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const spot = (v) => Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]);
const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(v)));
// Keys are inserted as own properties: session ids are opaque, and even '__proto__' must
// remain an id rather than changing an object's prototype.
const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const sortedKeys = (o) => Object.keys(o).sort();
const dayOf = (at, rules) => Math.floor(at / rules.day);
const windowOf = (at, rules) => Math.floor(at / rules.window);

// ---- the encounters --------------------------------------------------------------------
// Twelve and a rest, across three species. Each names where on somebody's plot it happens
// (`where`: the doorstep, the garden beside the house, the roof ridge, or the animal's own
// lookout), what the animal is seen doing there (`act`, shared/animals.mjs, which the sea
// plays for `dur` seconds), what it asks of the relationship first (`needs`), how long
// before the same animal does it to the same person again (`cool`, in windows), and what it
// does to familiarity, trust and irritation. `weight` is the base chance among whatever is
// eligible; `likes` multiplies it for a trait.
//
// Theft is of story objects only (STOLEN): never a file, a message, the purse or a prop.
export const TEMPLATES = {
  peck: {
    species: ['chicken'], act: 'peck', dur: 14, where: 'door', cool: 1, weight: 3,
    d: { fam: 8, trust: 3, irr: 0 },
    lines: ["{a} pecked about on {r}'s doorstep.", "{a} came scratching round {r}'s front step."],
    again: "{a} was back on {r}'s doorstep ({n} times now).",
  },
  wait: {
    species: ['chicken'], act: 'still', dur: 24, where: 'door', cool: 2, weight: 2,
    needs: (rel, res) => rel.fam >= 15 && res.active,
    d: { fam: 5, trust: 7, irr: 0 }, likes: { sociable: 2, gentle: 1.5 },
    lines: ["{a} waited by {r}'s door while they worked.", "{a} kept {r} company on the step, all through their work."],
    again: "{a} waited out {r}'s work by the door again.",
  },
  dust: {
    species: ['chicken'], act: 'dust', dur: 16, where: 'garden', cool: 3, weight: 1,
    d: { fam: 5, trust: 1, irr: 5 }, likes: { greedy: 1.5, bold: 1.5, gentle: 0.5 },
    lines: ["{a} took a dust bath in {r}'s garden and left the bed in a state."],
    again: "{a} dust-bathed in {r}'s garden again. The bed has given up.",
  },
  scratch: {
    species: ['chicken'], act: 'scratch', dur: 18, where: 'door', cool: 2, weight: 3,
    needs: (rel) => rel.trust >= 35 && rel.fam >= 30,
    d: { fam: 4, trust: 7, irr: 0 }, likes: { homebody: 2 },
    lines: ["{a} scratched out a hollow beside {r}'s door and sat in it for a while."],
    again: "{a} was in the hollow by {r}'s door again, fluffed up and content.",
  },
  rest: {
    species: ['chicken', 'goat'], act: 'rest', dur: 30, where: 'garden', cool: 3, weight: 1, quiet: true, notable: false,
    d: { fam: 3, trust: 3, irr: -2 }, likes: { shy: 2, homebody: 1.5 },
    lines: ["{a} dozed in the sun outside {r}'s quiet house.", "{a} found a warm spot by {r}'s empty garden and slept there."],
    again: "{a} dozed by {r}'s quiet house again.",
  },
  nudge: {
    species: ['goat'], act: 'nudge', dur: 14, where: 'door', cool: 1, weight: 3,
    d: { fam: 8, trust: 2, irr: 4 }, likes: { bold: 2, curious: 1.5 },
    lines: ["{a} nudged at {r}'s door, wanting to be let in.", "{a} leaned on {r}'s door until it creaked."],
    again: "{a} was at {r}'s door again ({n} times now).",
  },
  nibble: {
    species: ['goat'], act: 'nibble', dur: 18, where: 'garden', cool: 2, weight: 2,
    d: { fam: 4, trust: 0, irr: 10 }, likes: { greedy: 2.5, gentle: 0.5 },
    lines: ["{a} nibbled {r}'s hedge down to the stalks."],
    again: "{a} had another go at {r}'s hedge.",
  },
  butt: {
    species: ['goat'], act: 'butt', dur: 10, where: 'door', cool: 2, weight: 2,
    needs: (rel) => rel.irr >= 25,
    d: { fam: 3, trust: -3, irr: 12 }, likes: { stubborn: 2.5, gentle: 0.25, bold: 1.5 },
    lines: ["{a} butted {r}'s gate. Twice.", "{a} lowered its horns at {r}'s door and meant it."],
    again: "{a} butted {r}'s gate again. It is getting personal.",
  },
  watch: {
    species: ['goat'], act: 'watch', dur: 26, where: 'lookout', cool: 1, weight: 2,
    d: { fam: 6, trust: 3, irr: -1 }, likes: { curious: 2, shy: 1.5 },
    lines: ["{a} kept watch over {r}'s house from the high ground."],
    again: "{a} watched {r}'s house from up top again.",
  },
  truce: {
    species: ['goat'], act: 'rest', dur: 24, where: 'door', cool: 2, weight: 4,
    needs: (rel) => (rel.label === 'suspicious' || rel.label === 'nemesis') && rel.irr >= 30,
    d: { fam: 3, trust: 8, irr: -18 }, likes: { gentle: 2.5, stubborn: 0.5 },
    lines: ["{a} lay down by {r}'s door and chewed quietly. A truce, perhaps."],
    again: "{a} lay by {r}'s door again, chewing, keeping the peace.",
  },
  perch: {
    species: ['sparrow'], act: 'perch', dur: 20, where: 'roof', cool: 1, weight: 3,
    d: { fam: 7, trust: 2, irr: 0 }, likes: { vain: 2, bold: 1.5 },
    lines: ["{a} perched on the ridge of {r}'s roof.", "{a} sat on {r}'s chimney pot and looked down on everybody."],
    again: "{a} was up on {r}'s roof again ({n} times now).",
  },
  hop: {
    species: ['sparrow'], act: 'hop', dur: 16, where: 'garden', cool: 1, weight: 2,
    d: { fam: 4, trust: 6, irr: 0 }, likes: { greedy: 2, sociable: 1.5 },
    lines: ["{a} hopped about {r}'s garden, looking for crumbs."],
    again: "{a} went crumb-hunting in {r}'s garden again.",
  },
  chirp: {
    species: ['sparrow'], act: 'chirp', dur: 22, where: 'roof', cool: 2, weight: 2,
    needs: (rel, res) => rel.fam >= 25 && res.active,
    d: { fam: 4, trust: 5, irr: 1 }, likes: { vain: 2.5, sociable: 1.5 },
    lines: ["{a} sang from {r}'s chimney the whole time they worked."],
    again: "{a} sang {r} through their work again.",
  },
  steal: {
    species: ['sparrow'], act: 'steal', dur: 10, where: 'door', cool: 3, weight: 1,
    needs: (rel) => rel.trust < 30,
    d: { fam: 3, trust: -2, irr: 8 }, likes: { greedy: 2.5, bold: 1.5, shy: 0.5 },
    lines: ["{a} made off with {thing} from {r}'s step."],
    again: "{a} stole {thing} from {r}'s step. Again.",
  },
  // The mystery's last step, scheduled by decideObserve and never chosen by weight.
  point: {
    species: ['chicken', 'goat', 'sparrow'], act: 'point', dur: 20, where: 'landmark', cool: 0, weight: 0, mystery: true,
    d: { fam: 2, trust: 4, irr: 0 },
    lines: ['{a} kept going to the {l} and back, until somebody followed.'],
  },
};
const STOLEN = ['a bootlace', 'a shiny pebble', 'half a biscuit', 'a bit of red string', 'a brass curtain ring', 'a pencil stub'];

// The mystery (docs/animal-stories.md, "Permanent traces, combinations and mysteries").
// Three authored stages with stable ids: a print nobody's feet made, three finds in three
// places, and what they lead to at an existing landmark.
export const MYSTERY = {
  id: 'signal',
  finds: ['a brass button stamped with a lamp', 'a scrap of oilcloth, stiff with salt', 'a long grey feather no gull ever grew'],
  print: "{a} stopped dead at a strange three-toed print in the mud by {r}'s house. Nothing on this island has feet like that.",
  find: '{a} turned up {f} at {r}\'s door.',
  reveal: "Behind a loose stone at the foot of the {l}, {a} showed the way to the old keeper's cache: a signal lamp, still full of oil.",
  hints: [
    null,
    'Something with three toes has been about. The animals keep sniffing at doorsteps.',
    'The finds all smell of lamp oil, and the animals keep looking towards the {l}.',
    "The old keeper's lamp is found. Some nights, a light answers from far out at sea.",
  ],
};
const VIGNETTES = [
  'While the island was quiet, {a} found a warm patch of stones and made it theirs.',
  '{a} spent the quiet days watching the tide come in and go out again.',
  'Nobody was about, so {a} had the whole square to themselves for a while.',
];
const ARRIVAL_LINES = {
  chicken: '{a}, a {t} hen, turned up {p} and decided to stay.',
  goat: '{a} the goat wandered in, {t} as anything, and took to {p}.',
  sparrow: '{a}, a {t} little sparrow, moved in under the eaves {p}.',
};

const say = (line, words) => line.replace(/\{(\w)\}/g, (_, k) => (words[k] != null ? String(words[k]) : ''));
const ordinal = (n) => String(n);

// ---- state -----------------------------------------------------------------------------
export function emptyAnimalStories() {
  return {
    version: STORY_VERSION, seq: 0, lastAt: null,
    animals: {}, consumed: {}, pending: {}, traces: {}, discoveries: {},
    notable: [], encounters: 0, sinceArrival: 0, lastArrivalAt: null, vignetteAt: null,
    mystery: null, salt: null,
  };
}
const freshRel = () => ({ fam: 0, trust: 0, irr: 0, visits: 0, label: 'tolerant', since: null, lastAt: null, did: {}, lastDid: {} });

// The four words, from the three numbers, with hysteresis: a relationship crosses into a
// word at one threshold and only leaves it at a lower one, so the label does not flip on
// every encounter at the edge.
export function labelOf(prev, r) {
  const nemesis = prev === 'nemesis' ? r.irr >= 45 : r.irr >= 70;
  if (nemesis) return 'nemesis';
  const bonded = prev === 'bonded' ? r.trust >= 45 && r.irr < 45 : r.trust >= 60 && r.fam >= 40 && r.irr < 30;
  if (bonded) return 'bonded';
  const suspicious = prev === 'suspicious' || prev === 'nemesis' ? r.irr >= 20 : r.irr >= 35;
  if (suspicious) return 'suspicious';
  return 'tolerant';
}

// ---- applying --------------------------------------------------------------------------
export function applyAnimalEvent(before, event) {
  if (!event || event.version !== STORY_VERSION || !RULE_SETS.has(event.rules) ||
      event.seq !== before.seq + 1 || event.id !== `animal-event:${event.seq}` || !count(event.at)) {
    fail('invalid event envelope or unsupported version');
  }
  const s = structuredClone(before), d = event.data;
  if (!d || typeof d !== 'object') fail('missing event data');
  const at = event.at;
  switch (event.kind) {
    case 'arrival': applyArrival(s, d, at); break;
    case 'activity': applyActivity(s, d, event.seq, at); break;
    case 'encounter': applyEncounter(s, d, at); break;
    case 'abandon': applyAbandon(s, d); break;
    case 'placed': applyPlaced(s, d); break;
    case 'vignette': applyVignette(s, d, at); break;
    default: fail('unknown event kind');
  }
  s.seq = event.seq;
  s.lastAt = at;
  return s;
}

function checkHome(h) {
  return h && finite(h.x) && finite(h.z) && finite(h.r) && h.r > 0 && h.r <= 8 && (h.label == null || text(h.label, 80));
}

function applyArrival(s, d, at) {
  if (!text(d.id, 40) || !text(d.name, 40) || !STORY_SPECIES.includes(d.species) || own(s.animals, d.id)) fail('invalid arrival');
  if (Object.keys(s.animals).length >= MAX_ANIMALS) fail('the island already has its cast');
  if (!Array.isArray(d.traits) || d.traits.length < 1 || d.traits.length > 3 || !d.traits.every((t) => own(TRAITS, t))) fail('invalid traits');
  if (!checkHome(d.home)) fail('invalid home');
  if (d.lookout != null && !spot(d.lookout)) fail('invalid lookout');
  if (!text(d.line, 300)) fail('arrival needs its line');
  put(s.animals, d.id, {
    id: d.id, name: d.name, species: d.species, traits: [...d.traits], arrivedAt: at,
    home: { x: d.home.x, z: d.home.z, r: d.home.r, label: d.home.label || null },
    near: d.near ?? null, lookout: d.lookout ? [d.lookout[0], d.lookout[1]] : null,
    favourite: null, lastWindow: -1, lastRestWindow: -1, majorDay: -1, encounters: 0, rel: {},
  });
  // The baseline: whatever each settler had done before this animal existed is history, not
  // an opportunity. Kept island-wide - activity is consumed once, by whichever animal answers it.
  for (const [src, c] of Object.entries(d.baseline || {})) {
    if (!text(src) || !count(c)) fail('invalid baseline');
    if (!own(s.consumed, src) || c > s.consumed[src]) put(s.consumed, src, c);
  }
  if (d.salt != null) {
    if (!count(d.salt) || s.salt != null) fail('invalid salt');
    s.salt = d.salt;
  }
  s.lastArrivalAt = at;
  s.sinceArrival = 0;
}

function applyActivity(s, d, seq, at) {
  const cursors = d.cursors || {};
  for (const [src, c] of Object.entries(cursors)) {
    if (!text(src) || !count(c) || (own(s.consumed, src) && c <= s.consumed[src])) fail('activity cursor must advance');
    put(s.consumed, src, c);
  }
  const actions = Array.isArray(d.actions) ? d.actions : [];
  if (!Object.keys(cursors).length && !actions.length) fail('empty activity');
  actions.forEach((a, k) => {
    const animal = own(s.animals, a.animal) && s.animals[a.animal];
    const t = own(TEMPLATES, a.template) && TEMPLATES[a.template];
    if (!animal || !t || !t.species.includes(animal.species) || a.id !== `act:${seq}:${k}` ||
        !(a.resident === null || text(a.resident)) || !spot(a.to) || !(a.look == null || spot(a.look)) ||
        !count(a.window) || !count(a.dur) || a.act !== t.act || typeof a.notable !== 'boolean' ||
        Object.values(s.pending).some((p) => p.animal === a.animal)) fail('invalid intention');
    if (a.template === 'point' ? a.resident !== null : !text(a.resident)) fail('invalid intention');
    put(s.pending, a.id, {
      id: a.id, animal: a.animal, resident: a.resident, name: a.name ?? null, template: a.template,
      act: a.act, dur: a.dur, to: [a.to[0], a.to[1]], look: a.look ? [a.look[0], a.look[1]] : null,
      where: a.where, window: a.window, notable: a.notable, at, thing: a.thing ?? null,
    });
    if (a.notable) animal.lastWindow = Math.max(animal.lastWindow, a.window);
    else animal.lastRestWindow = a.window;
  });
}

function applyEncounter(s, d, at) {
  const a = own(s.pending, d.action) && s.pending[d.action];
  if (!a) fail('encounter has no pending intention');
  const animal = s.animals[a.animal];
  if (!text(d.line, 400)) fail('encounter needs its line');
  if (a.resident !== null) {
    const r = d.rel;
    if (!r || ![r.fam, r.trust, r.irr].every((v) => count(v) && v <= 100) || !count(r.visits) ||
        !['bonded', 'tolerant', 'suspicious', 'nemesis'].includes(r.label)) fail('invalid encounter outcome');
    const prev = own(animal.rel, a.resident) ? animal.rel[a.resident] : freshRel();
    if (r.visits !== prev.visits + 1) fail('invalid encounter outcome');
    const did = { ...prev.did, [a.template]: (prev.did[a.template] || 0) + 1 };
    const lastDid = { ...prev.lastDid, [a.template]: a.window };
    put(animal.rel, a.resident, {
      fam: r.fam, trust: r.trust, irr: r.irr, visits: r.visits, label: r.label,
      since: r.label !== prev.label ? at : prev.since ?? at, lastAt: at, did, lastDid,
    });
    if (d.forget != null) {
      if (!own(animal.rel, d.forget) || d.forget === a.resident) fail('invalid forget');
      delete animal.rel[d.forget];
    }
  }
  if (d.major) animal.majorDay = d.day;
  animal.encounters += 1;
  if (d.favourite) {
    if (!text(d.favourite.label, 120) || !spot(d.favourite.at)) fail('invalid favourite');
    animal.favourite = { label: d.favourite.label, at: [d.favourite.at[0], d.favourite.at[1]], kind: d.favourite.kind || null };
  }
  if (a.notable) { s.notable.push(at); if (s.notable.length > 12) s.notable.splice(0, s.notable.length - 12); }
  s.encounters += 1;
  s.sinceArrival += 1;
  for (const t of d.traces || []) addTrace(s, t, at);
  if (d.discovery) {
    const x = d.discovery;
    if (!text(x.id, 60) || own(s.discoveries, x.id) || !text(x.line, 400)) fail('invalid discovery');
    put(s.discoveries, x.id, { id: x.id, recipe: x.recipe, resident: x.resident ?? null, at, line: x.line, name: x.name });
  }
  if (d.mystery) applyMystery(s, d.mystery, at);
  delete s.pending[d.action];
}

function addTrace(s, t, at) {
  if (!t || !text(t.id, 60) || own(s.traces, t.id) || !TRACE_KINDS.includes(t.kind) || !text(t.name, 120) ||
      !['door', 'garden', 'roof', 'lookout', 'landmark', 'home'].includes(t.anchor) || !spot(t.near)) fail('invalid trace');
  put(s.traces, t.id, {
    id: t.id, kind: t.kind, animal: t.animal ?? null, resident: t.resident ?? null, name: t.name,
    anchor: t.anchor, near: [t.near[0], t.near[1]], at, placed: null,
  });
}

function applyMystery(s, m, at) {
  const cur = s.mystery;
  if (m.stage === 1) {
    if (cur) fail('the mystery has already begun');
    s.mystery = { id: MYSTERY.id, stage: 1, finds: [], dry: 0, startedAt: at, resolvedAt: null, landmark: m.landmark || null };
  } else if (!cur) {
    fail('no mystery to advance');
  } else if (m.dry != null) {
    if (!count(m.dry)) fail('invalid mystery');
    cur.dry = m.dry;
  } else if (m.find != null) {
    if (cur.stage !== 1 || m.find !== cur.finds.length + 1) fail('invalid find');
    cur.finds.push({ k: m.find, resident: m.resident ?? null, animal: m.animal ?? null, at });
    cur.dry = 0;
    if (cur.finds.length >= MYSTERY.finds.length) cur.stage = 2;
  } else if (m.stage === 3) {
    if (cur.stage !== 2) fail('nothing to reveal yet');
    cur.stage = 3;
    cur.resolvedAt = at;
  } else fail('invalid mystery');
  if (m.landmark && s.mystery && !s.mystery.landmark) s.mystery.landmark = m.landmark;
}

function applyAbandon(s, d) {
  const ids = Array.isArray(d.actions) ? d.actions : [];
  if (!ids.length) fail('nothing to abandon');
  for (const id of ids) {
    if (!own(s.pending, id)) fail('abandon of an unknown intention');
    delete s.pending[id];
  }
}

function applyPlaced(s, d) {
  const t = own(s.traces, d.trace) && s.traces[d.trace];
  if (!t || t.placed || !finite(d.x) || !finite(d.z) || ![0, 1, 2, 3].includes(d.rot)) fail('invalid placement');
  t.placed = { x: d.x, z: d.z, rot: d.rot };
}

function applyVignette(s, d, at) {
  if (!own(s.animals, d.animal) || !text(d.line, 300) || !count(d.away)) fail('invalid vignette');
  s.vignetteAt = at;
}

// ---- deciding --------------------------------------------------------------------------
function envelope(s, kind, data, at) {
  const seq = s.seq + 1;
  return { version: STORY_VERSION, rules: RULES, seq, id: `animal-event:${seq}`, at, kind, data };
}
// Seeded off the island (its salt, fixed at the first arrival from the island's own seed) as well
// as the sequence, so two islands that happen to have the same history still choose differently.
const rngFor = (s, purpose) => makeRng(hash32(`animal:${s.salt ?? 0}:${s.seq + 1}:${purpose}`));

// Weighted pick over [item, weight] pairs; null when nothing has any weight.
function pickWeighted(rng, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  if (!(total > 0)) return null;
  let r = rng.next() * total;
  for (const [item, w] of pairs) { r -= w; if (r < 0) return item; }
  return pairs[pairs.length - 1][0];
}

function drawTraits(rng, species) {
  const pool = [...TRAIT_POOLS[species]];
  const out = [];
  const want = rng.chance(0.4) ? 3 : 2;
  while (out.length < want && pool.length) {
    const t = pool.splice(rng.int(pool.length), 1)[0];
    if (OPPOSITES.some(([x, y]) => (t === x && out.includes(y)) || (t === y && out.includes(x)))) continue;
    out.push(t);
  }
  return out;
}

function drawName(rng, species, s) {
  const used = new Set(Object.values(s.animals).map((a) => a.name));
  const free = NAMES[species].filter((n) => !used.has(n));
  if (free.length) return free[rng.int(free.length)];
  return `${NAMES[species][0]} ${Object.keys(s.animals).length + 1}`;
}

// Which animal is due, if any: the first hen the first time somebody is watching a working
// island, and every later one only after a day and a few encounters since the one before.
// Pure: the caller works out where it will live, then dispatches `arrive`.
export function arrivalDue(s, at, { viewing = false, working = false } = {}, rules = DEFAULT_RULES) {
  const n = Object.keys(s.animals).length;
  if (n >= MAX_ANIMALS || !viewing) return null;
  if (n === 0) return working ? ARRIVAL_ORDER[0] : null;
  if (s.lastArrivalAt != null && at - s.lastArrivalAt < rules.arrivalGap) return null;
  if (s.sinceArrival < rules.arrivalEncounters) return null;
  return ARRIVAL_ORDER[n];
}

export function decideAnimalEvent(s, command, at, rules = DEFAULT_RULES) {
  if (!count(at)) fail('invalid timestamp');
  if (!command || typeof command !== 'object') fail('invalid command');
  switch (command.kind) {
    case 'arrive': return decideArrive(s, command, at);
    case 'observe': return decideObserve(s, command, at, rules);
    case 'complete': return decideComplete(s, command, at, rules);
    case 'abandon': return decideAbandon(s, command, at, rules);
    case 'place': return decidePlace(s, command, at);
    case 'return': return decideReturn(s, command, at, rules);
    default: fail('unknown command');
  }
}

// `arrive`: { species, home: {x, z, r, label}, near, lookout, baseline: {source: cursor}, seed }.
// The id is the island's own and stable - `animal:<n>` in arrival order - so a scene rebuilt
// or a sea restarted can never make a second identity of the same hen.
function decideArrive(s, c, at) {
  if (!STORY_SPECIES.includes(c.species)) fail('invalid arrival');
  if (Object.keys(s.animals).length >= MAX_ANIMALS) return null;
  if (!checkHome(c.home)) fail('invalid arrival home');
  const id = `animal:${Object.keys(s.animals).length + 1}`;
  if (own(s.animals, id)) fail('animal id already used');
  const rng = makeRng(hash32(`${c.seed ?? ''}:${id}:${c.species}`));
  const name = drawName(rng, c.species, s);
  const traits = drawTraits(rng, c.species);
  const baseline = {};
  for (const [src, cur] of Object.entries(c.baseline || {})) {
    if (!text(src) || !count(cur)) fail('invalid baseline');
    if (!own(s.consumed, src) || cur > s.consumed[src]) put(baseline, src, cur);
  }
  const line = say(ARRIVAL_LINES[c.species], { a: name, t: TRAITS[traits[0]].line, p: c.home.label || 'by the square' });
  const data = {
    id, species: c.species, name, traits, home: { x: c.home.x, z: c.home.z, r: c.home.r, label: c.home.label || null },
    near: c.near ?? null, lookout: c.lookout ?? null, baseline, line,
  };
  if (s.salt == null) data.salt = hash32(`salt:${c.seed ?? ''}`);
  return envelope(s, 'arrival', data, at);
}

// `observe`: { residents: [{ id, cursor, active, lastAt, name, spots: {door, garden, roof, look} }],
//              landmark: { at: [x, z], label } | null }.
//
// Newly observed activity is an opportunity, not a reward per message: a settler whose cursor
// has moved past what was last consumed is a candidate, and each animal answers at most one
// candidate per activity window, the island at most `notablePerHour` an hour. The cursor that
// buys a visit is written in the same event as the visit, so a crash cannot consume activity
// without remembering what it was spent on. A cursor that moved and bought nothing is not
// written at all: it stays an opportunity. A settler seen for the first time is a baseline.
function decideObserve(s, c, at, rules) {
  const residents = Array.isArray(c.residents) ? c.residents : [];
  // Nothing to answer with yet: the first arrival writes the baseline, and a journal line of
  // three hundred cursors for an island with no animals on it is a line nobody needed.
  if (!Object.keys(s.animals).length) {
    for (const r of residents) if (!r || !text(r.id) || !count(r.cursor)) fail('invalid activity');
    return null;
  }
  const cursors = {};
  const byId = new Map();
  for (const r of residents) {
    if (!r || !text(r.id) || !count(r.cursor)) fail('invalid activity');
    byId.set(r.id, r);
    if (!own(s.consumed, r.id)) put(cursors, r.id, r.cursor);
  }
  const actions = [];
  // Whoever has waited longest answers first. In plain id order the first hen took the one
  // working settler every window and the goat and the sparrow never met anybody at all.
  const animals = sortedKeys(s.animals).map((k) => s.animals[k])
    .sort((x, y) => x.lastWindow - y.lastWindow || (x.id < y.id ? -1 : 1));
  const busy = new Set(Object.values(s.pending).map((p) => p.animal));
  if (animals.length) {
    const window = windowOf(at, rules);
    const hourAgo = at - rules.hour;
    let lastHour = s.notable.filter((t) => t > hourAgo).length +
      Object.values(s.pending).filter((p) => p.notable && p.at > hourAgo).length;
    const taken = new Set(Object.values(s.pending).map((p) => p.resident).filter(Boolean));
    const rng = rngFor(s, 'observe');
    const seq = s.seq + 1;

    // The mystery's last step first: once the three finds are in, the first free animal (a
    // sparrow if there is one) leads the way to the landmark.
    if (s.mystery && s.mystery.stage === 2 && c.landmark && spot(c.landmark.at) &&
        !Object.values(s.pending).some((p) => p.template === 'point')) {
      // A sparrow flies it in a minute; otherwise whoever lives nearest walks it.
      const [lx, lz] = c.landmark.at;
      const far = (a) => (a.home.x - lx) * (a.home.x - lx) + (a.home.z - lz) * (a.home.z - lz);
      const free = animals.filter((a) => !busy.has(a.id)).sort((x, y) => far(x) - far(y) || (x.id < y.id ? -1 : 1));
      const guide = free.find((a) => a.species === 'sparrow') || free[0];
      if (guide) {
        actions.push({
          id: `act:${seq}:${actions.length}`, animal: guide.id, resident: null, name: null, template: 'point',
          act: 'point', dur: TEMPLATES.point.dur, to: [c.landmark.at[0], c.landmark.at[1]], look: null,
          where: 'landmark', window, notable: true, landmark: c.landmark.label || 'lighthouse',
        });
        busy.add(guide.id);
        lastHour++;
      }
    }

    for (const animal of animals) {
      if (busy.has(animal.id)) continue;
      // A notable encounter, answering somebody's new activity.
      if (animal.lastWindow < window && lastHour < rules.notablePerHour) {
        const pairs = [];
        for (const r of residents) {
          if (taken.has(r.id) || !own(s.consumed, r.id) || !(r.cursor > s.consumed[r.id])) continue;
          if (own(cursors, r.id) && cursors[r.id] >= r.cursor) continue;
          for (const [name, t] of Object.entries(TEMPLATES)) {
            if (t.quiet || t.mystery || !t.species.includes(animal.species)) continue;
            const w = weightOf(animal, r, name, t, window);
            if (w > 0 && spotFor(t, r, animal)) pairs.push([[r, name], w]);
          }
        }
        const chosen = pickWeighted(rng, pairs);
        if (chosen) {
          const [r, name] = chosen;
          actions.push(intention(seq, actions.length, animal, r, name, window, true, rng));
          put(cursors, r.id, r.cursor);
          taken.add(r.id);
          busy.add(animal.id);
          lastHour++;
          continue;
        }
      }
      // Otherwise, now and then, a rest at a quiet house: a different kind of life, not a
      // punishment for using an agent less. Not notable, and never at somebody working.
      if (animal.lastRestWindow + rules.restEvery <= window) {
        const pairs = [];
        for (const r of residents) {
          if (taken.has(r.id) || r.active || !(r.lastAt != null && at - r.lastAt >= rules.quietAfter)) continue;
          for (const [name, t] of Object.entries(TEMPLATES)) {
            if (!t.quiet || !t.species.includes(animal.species)) continue;
            const w = weightOf(animal, r, name, t, window);
            if (w > 0 && spotFor(t, r, animal)) pairs.push([[r, name], w]);
          }
        }
        // Sparrows rest on a roof: a perch at a quiet house is theirs.
        if (animal.species === 'sparrow') {
          for (const r of residents) {
            if (taken.has(r.id) || r.active || !(r.lastAt != null && at - r.lastAt >= rules.quietAfter)) continue;
            const w = weightOf(animal, r, 'perch', TEMPLATES.perch, window);
            if (w > 0 && spotFor(TEMPLATES.perch, r, animal)) pairs.push([[r, 'perch'], w * 0.5]);
          }
        }
        if (pairs.length && rng.chance(0.5)) {
          const [r, name] = pickWeighted(rng, pairs);
          actions.push(intention(seq, actions.length, animal, r, name, window, false, rng));
          taken.add(r.id);
          busy.add(animal.id);
        }
      }
    }
  }
  if (!Object.keys(cursors).length && !actions.length) return null;
  return envelope(s, 'activity', { cursors, actions }, at);
}

// How much this animal wants to do this to this settler, now. Zero means not at all: the
// template's own prerequisite failed, or the same thing happened too recently.
function weightOf(animal, r, name, t, window) {
  const rel = own(animal.rel, r.id) ? animal.rel[r.id] : freshRel();
  if (t.needs && !t.needs(rel, r)) return 0;
  const last = rel.lastDid[name];
  if (last != null && last + (t.cool || 0) > window) return 0;
  let w = t.weight;
  for (const trait of animal.traits) {
    if (t.likes && t.likes[trait]) w *= t.likes[trait];
    const k = TRAITS[trait];
    if (k.busy && r.active) w *= k.busy;
    if (k.known && rel.visits > 0) w *= k.known;
  }
  // Whoever it already has feelings about is on its mind: a bonded friend a little more, a
  // nemesis for a stubborn goat a lot more.
  if (rel.label === 'bonded') w *= 1.6;
  if (rel.label === 'nemesis') w *= animal.traits.includes('stubborn') ? 2 : 0.6;
  return w;
}

// Where on this settler's plot the encounter happens, or null when there is no such spot -
// or when it is further from the animal's home than its species goes (MOTION.reach).
function spotFor(t, r, animal) {
  if (t.where === 'lookout') return animal.lookout || null;
  const sp = r.spots || {};
  const at = spot(sp[t.where]) ? sp[t.where] : null;
  if (!at) return null;
  const reach = (MOTION[animal.species] && MOTION[animal.species].reach) || Infinity;
  const dx = at[0] - animal.home.x, dz = at[1] - animal.home.z;
  return dx * dx + dz * dz <= reach * reach ? at : null;
}

function intention(seq, k, animal, r, name, window, notable, rng) {
  const t = TEMPLATES[name];
  const to = spotFor(t, r, animal);
  return {
    id: `act:${seq}:${k}`, animal: animal.id, resident: r.id, name: text(r.name, 60) ? r.name : null,
    template: name, act: t.act, dur: t.dur, to: [to[0], to[1]],
    look: spot(r.spots && r.spots.look) ? r.spots.look : null,
    where: t.where, window, notable, thing: name === 'steal' ? STOLEN[rng.int(STOLEN.length)] : null,
  };
}

// `complete`: { action, context: { animals: {id: [x, z]}, residents: {id: spots}, landmark } }.
// The sea says the errand happened; this decides what it came to. Unknown or already
// finished actions are nothing at all - a completion is safe to hear twice.
function decideComplete(s, c, at, rules) {
  if (!text(c.action)) fail('invalid action id');
  if (!own(s.pending, c.action)) return null;
  const a = s.pending[c.action];
  const animal = s.animals[a.animal];
  const t = TEMPLATES[a.template];
  const rng = rngFor(s, `complete:${a.id}`);
  const day = dayOf(at, rules);
  const data = { action: a.id, day, line: null, major: false, traces: [] };

  if (a.template === 'point') {
    data.line = say(MYSTERY.reveal, { a: animal.name, l: a.landmark || 'lighthouse' });
    if (s.mystery && s.mystery.stage === 2) {
      data.mystery = { stage: 3 };
      data.traces.push({ id: `trace:cache:${MYSTERY.id}`, kind: 'cache', animal: animal.id, resident: null,
        name: "The old keeper's cache", anchor: 'landmark', near: a.to });
    }
    return envelope(s, 'encounter', data, at);
  }

  const prev = own(animal.rel, a.resident) ? animal.rel[a.resident] : freshRel();
  // Irritation cools with time apart, six points a day.
  const apart = prev.lastAt != null ? Math.floor((at - prev.lastAt) / rules.day) : 0;
  const base = { fam: prev.fam, trust: prev.trust, irr: Math.max(0, prev.irr - 6 * apart) };
  const mod = traitMods(animal.traits);
  const jitter = (v) => (v === 0 ? 0 : v + rng.int(3) - 1);
  const next = {
    fam: clamp100(base.fam + jitter(t.d.fam) * mod.fam),
    trust: clamp100(base.trust + jitter(t.d.trust) * mod.trust),
    irr: clamp100(base.irr + jitter(t.d.irr) * (t.d.irr > 0 ? mod.irr : 1)),
  };
  let label = labelOf(prev.label, next);
  // One major change per animal per day: the numbers still move, the word waits.
  if (label !== prev.label && animal.majorDay === day) label = prev.label;
  const major = label !== prev.label;
  const visits = prev.visits + 1;
  data.rel = { ...next, visits, label };
  data.major = major;
  if (major) data.was = prev.label;

  const times = (prev.did[a.template] || 0) + 1;
  const words = { a: animal.name, r: a.name || 'somebody', n: ordinal(times), thing: a.thing || 'something' };
  data.line = times >= 3 && t.again ? say(t.again.replace('{thing}', '{T}'), { ...words, T: words.thing })
    : say(t.lines[rng.int(t.lines.length)].replace('{thing}', '{T}'), { ...words, T: words.thing });
  if (major) data.line += ' ' + majorLine(animal, a, prev.label, label);

  // Keep the relationships that mean something: past the cap, the faintest goes, never a
  // bonded friend or a nemesis.
  const tracked = Object.keys(animal.rel).filter((k) => k !== a.resident);
  if (!own(animal.rel, a.resident) && tracked.length >= rules.maxRelations) {
    const faint = tracked
      .filter((k) => !['bonded', 'nemesis'].includes(animal.rel[k].label))
      .sort((x, y) => weightOfRel(animal.rel[x]) - weightOfRel(animal.rel[y]) || (x < y ? -1 : 1))[0];
    if (faint) data.forget = faint;
  }

  const after = { ...prev, ...data.rel, did: { ...prev.did, [a.template]: times } };
  traceChecks(s, animal, a, after, label, data);
  discoveryCheck(s, animal, a, label, data, rules);
  mysteryCheck(s, animal, a, data, rng, rules, c.landmark);
  if (label === 'bonded' && animal.species === 'chicken' && !animal.favourite) {
    data.favourite = { label: `${a.name || 'somebody'}'s doorstep`, at: a.to, kind: 'door' };
  }
  return envelope(s, 'encounter', data, at);
}

const weightOfRel = (r) => r.fam + r.trust + r.irr + r.visits * 2;

function traitMods(traits) {
  const m = { fam: 1, trust: 1, irr: 1 };
  if (traits.includes('gentle')) m.irr *= 0.6;
  if (traits.includes('stubborn')) { m.irr *= 1.3; m.trust *= 0.8; }
  if (traits.includes('sociable')) m.fam *= 1.2;
  if (traits.includes('shy')) { m.trust *= 1.2; m.fam *= 0.8; }
  if (traits.includes('bold')) m.fam *= 1.1;
  return m;
}

function majorLine(animal, a, was, now) {
  const r = a.name || 'somebody';
  if (now === 'bonded') return `${animal.name} and ${r} are friends now.`;
  if (now === 'nemesis') return `${animal.name} has decided ${r} is the enemy.`;
  if (now === 'suspicious') return `${animal.name} keeps a wary eye on ${r} these days.`;
  if (was === 'nemesis' || was === 'suspicious') return `${animal.name} and ${r} have made their peace.`;
  return `${animal.name} and ${r} have cooled off a little.`;
}

const hasTrace = (s, id) => own(s.traces, id);

// History leaves a place. Each of the three first marks has more than one road to it, and
// every one runs through a relationship at a particular spot, never through a count alone.
function traceChecks(s, animal, a, rel, label, data) {
  const id = animal.id;
  if (animal.species === 'chicken' && label === 'bonded' && (rel.did.scratch || 0) >= 1 && !hasTrace(s, `trace:nest:${id}`)) {
    data.traces.push({ id: `trace:nest:${id}`, kind: 'nest', animal: id, resident: a.resident,
      name: `${animal.name}'s nest by ${a.name || 'somebody'}'s door`, anchor: 'door', near: a.to });
    data.favourite = { label: `the nest by ${a.name || 'somebody'}'s door`, at: a.to, kind: 'nest' };
  }
  if (animal.species === 'goat' && a.template === 'watch' && !hasTrace(s, `trace:lookout:${id}`)) {
    const watched = Object.values(animal.rel).reduce((n, r) => n + (r.did.watch || 0), 0) + 1;
    if (watched >= 3 && animal.lookout) {
      data.traces.push({ id: `trace:lookout:${id}`, kind: 'lookout', animal: id, resident: null,
        name: `${animal.name}'s lookout`, anchor: 'lookout', near: animal.lookout });
      data.favourite = { label: `${animal.name}'s lookout`, at: animal.lookout, kind: 'lookout' };
    }
  }
  if (animal.species === 'sparrow' && a.template === 'perch' && (rel.did.perch || 0) >= 3 && !hasTrace(s, `trace:perch:${id}`)) {
    data.traces.push({ id: `trace:perch:${id}`, kind: 'perch', animal: id, resident: a.resident,
      name: `${animal.name}'s perch at ${a.name || 'somebody'}'s`, anchor: 'garden', near: a.to });
    data.favourite = { label: `${a.name || 'somebody'}'s roof`, at: a.to, kind: 'roof' };
  }
}

// The one combination: a settler whose house the feathered animals have both claimed.
// Several ways in - a nest and a perch at the same house; a friend of a hen and of a
// sparrow; a nest or a perch there and a friend of another species - so it is found by
// living rather than by following a recipe.
function discoveryCheck(s, animal, a, label, data, rules) {
  if (!a.resident) return;
  const made = Object.keys(s.discoveries).filter((k) => k.startsWith('discovery:feeder:')).length;
  if (made >= rules.maxFeeders) return;
  if (Object.values(s.discoveries).some((d) => d.resident === a.resident)) return;
  const traces = [...Object.values(s.traces), ...data.traces];
  const at = (kind) => traces.some((t) => t.kind === kind && t.resident === a.resident);
  const friends = new Set();
  for (const other of Object.values(s.animals)) {
    const rel = other.id === animal.id ? { label } : other.rel[a.resident];
    if (rel && rel.label === 'bonded') friends.add(other.species);
  }
  const qualifies = (at('nest') && at('perch')) || friends.size >= 2 ||
    ((at('nest') || at('perch')) && [...friends].some((sp) => sp !== (at('nest') ? 'chicken' : 'sparrow')));
  if (!qualifies) return;
  const n = made + 1;
  const name = `The Feathered Corner at ${a.name || 'somebody'}'s`;
  data.discovery = {
    id: `discovery:feeder:${n}`, recipe: 'feathered-corner', resident: a.resident, name,
    line: `${name}: the birds of the island have made ${a.name || 'somebody'}'s house their own, and somebody has put up a feeder.`,
  };
  data.traces.push({ id: `trace:feeder:${n}`, kind: 'feeder', animal: null, resident: a.resident, name, anchor: 'garden', near: a.to });
}

// The mystery moves on notable encounters only, and gives a slower way through to a single
// settler who keeps coming back: a newcomer to the story finds more often, an old hand now
// and then, and a run of empty-handed visits always ends in a find.
function mysteryCheck(s, animal, a, data, rng, rules, landmark) {
  if (!a.notable || !a.resident) return;
  const m = s.mystery;
  const words = { a: animal.name, r: a.name || 'somebody' };
  if (!m) {
    if (s.encounters + 1 < rules.mysteryAfter || Object.keys(s.animals).length < 2) return;
    data.mystery = { stage: 1, landmark: landmark && spot(landmark.at) ? { at: landmark.at, label: landmark.label || 'lighthouse' } : null };
    data.traces.push({ id: `trace:print:${MYSTERY.id}`, kind: 'print', animal: animal.id, resident: a.resident,
      name: 'A strange three-toed print', anchor: a.where === 'roof' ? 'garden' : a.where === 'lookout' ? 'lookout' : a.where, near: a.to });
    data.line += ' ' + say(MYSTERY.print, words);
    return;
  }
  if (m.stage !== 1) return;
  const found = new Set(m.finds.map((f) => f.resident));
  const p = m.dry >= 4 ? 1 : found.has(a.resident) ? 0.12 : 0.34;
  if (rng.next() < p) {
    const k = m.finds.length + 1;
    data.mystery = { find: k, resident: a.resident, animal: animal.id };
    data.traces.push({ id: `trace:find:${MYSTERY.id}:${k}`, kind: 'find', animal: animal.id, resident: a.resident,
      name: MYSTERY.finds[k - 1][0].toUpperCase() + MYSTERY.finds[k - 1].slice(1), anchor: 'door', near: a.to });
    data.line += ' ' + say(MYSTERY.find, { ...words, f: MYSTERY.finds[k - 1] });
  } else {
    data.mystery = { dry: m.dry + 1 };
  }
}

// `abandon`: { residents: [ids still on the island] }. An errand the sea never finished - a
// sea that does not keep animals, or a settler whose house is gone - is let go of, quietly:
// nobody's story is the worse for a visit that never happened.
function decideAbandon(s, c, at, rules) {
  const alive = c.residents ? new Set(c.residents) : null;
  const ids = sortedKeys(s.pending).filter((id) => {
    const a = s.pending[id];
    return at - a.at >= rules.abandonAfter || (alive && a.resident && !alive.has(a.resident));
  });
  if (!ids.length) return null;
  return envelope(s, 'abandon', { actions: ids }, at);
}

// `place`: { trace, x, z, rot } - where a mark was actually set down, once the islander has
// found ground for it that passes the same checks a garden bed does.
function decidePlace(s, c, at) {
  const t = own(s.traces, c.trace) && s.traces[c.trace];
  if (!t) fail('no such trace');
  if (t.placed) return null;
  if (!finite(c.x) || !finite(c.z) || ![0, 1, 2, 3].includes(c.rot)) fail('invalid placement');
  return envelope(s, 'placed', { trace: t.id, x: c.x, z: c.z, rot: c.rot }, at);
}

// `return`: the islander has just started. After a long absence, one gentle line, recorded
// now, about somebody who was here - not an invented week of happenings.
function decideReturn(s, c, at, rules) {
  const ids = sortedKeys(s.animals);
  if (!ids.length || s.lastAt == null) return null;
  const away = at - s.lastAt;
  if (away < rules.vignetteAfter) return null;
  const rng = rngFor(s, 'return');
  const animal = s.animals[ids[rng.int(ids.length)]];
  return envelope(s, 'vignette', { animal: animal.id, away: Math.round(away), line: say(VIGNETTES[rng.int(VIGNETTES.length)], { a: animal.name }) }, at);
}

// ---- reading ---------------------------------------------------------------------------
// The words an event says in the diary, and who and where it is about. `before` is the state
// the event was applied to: an encounter names only its action, and the action - which animal,
// which settler, where - is in the pending list the event then empties.
export function entryOf(e, before = null) {
  const d = e.data || {};
  const base = { seq: e.seq, at: e.at, kind: e.kind };
  if (e.kind === 'arrival') return { ...base, animal: d.id, resident: d.near ?? null, line: d.line, where: [d.home.x, d.home.z], big: true, major: false };
  if (e.kind === 'encounter') {
    const a = before && own(before.pending, d.action) ? before.pending[d.action] : null;
    const mystery = d.mystery ? (d.mystery.stage === 1 ? 'print' : d.mystery.find ? 'find' : d.mystery.stage === 3 ? 'reveal' : null) : null;
    return { ...base, animal: a ? a.animal : null, resident: a ? a.resident : null, template: a ? a.template : null,
      where: a ? a.to : null, line: d.line, major: !!d.major, was: d.was || null, label: d.rel ? d.rel.label : null,
      traces: (d.traces || []).map((t) => t.id), discovery: d.discovery ? d.discovery.id : null, mystery,
      big: !!(d.major || (d.traces && d.traces.length) || d.discovery || mystery) };
  }
  if (e.kind === 'vignette') {
    const an = before && own(before.animals, d.animal) ? before.animals[d.animal] : null;
    return { ...base, animal: d.animal, resident: null, line: d.line, where: an ? [an.home.x, an.home.z] : null, big: false, major: false };
  }
  return null;
}

export const HINT = (m, landmark) => (m ? say(MYSTERY.hints[m.stage] || '', { l: (m.landmark && m.landmark.label) || landmark || 'lighthouse' }) : null);
