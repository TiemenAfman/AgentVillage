// The story animals' lives, as the islander runs them (Plans/dierenverhalen.md).
//
// The reducer (lib/animal-stories.mjs) decides and the store (lib/animal-store.mjs) remembers;
// this file is when each of them is asked, and what is done with the answer. Three moments:
//
//   after a scan    who may arrive, which errands to let go of, which settlers' new activity
//                   the animals answer, and ground for any mark still waiting for some.
//   a completion    the sea says an errand happened, over the islander's own socket; only
//                   for an action still pending and the connection generation it was sent on.
//   a question      what the sea is to be told (the public state, packAnimals), what the
//                   keeper's page is shown (the private state), and a page of somebody's diary.
//
// It never throws at serve.mjs. A journal that will not open - damaged, or locked by a writer
// that is still running - leaves the animals off with the reason kept for /api/animals, and
// the rest of the island carries on: a hen is not worth an islander that will not start.
import { openAnimalStore } from './animal-store.mjs';
import { rulesFor, arrivalDue, TEMPLATES, HINT } from './animal-stories.mjs';
import { islandPlaces } from './animal-places.mjs';
import { packAnimals } from './animalbundle.mjs';
import { TRAITS, HABIT_OF } from '../shared/animals.mjs';
import { hash32 } from '../shared/rng.mjs';

const SPECIES_WORD = { chicken: 'hen', goat: 'goat', sparrow: 'sparrow' };
// Which diary entries are worth a place on the "while you were away" card, best first.
const PRIORITY = { mystery: 5, discovery: 4, trace: 3, major: 2, arrival: 1 };
const CHECKPOINT_EVERY = 25;

// `check` replaces the garden's ground check (lib/animal-places.mjs) - for tests, which must
// not have loadConfig found an island in the checkout they run in.
export function createAnimalLife({ dir, pace = 1, log = () => {}, now = () => Date.now(), onChange = () => {}, onNews = () => {}, check = null } = {}) {
  const rules = rulesFor(pace);
  let store = null;
  let broken = null;
  let village = null;
  let places = null;
  let placesFor = null;
  let sinceCheckpoint = 0;

  function open() {
    if (store || broken) return !!store;
    try {
      store = openAnimalStore(dir, { rules, recoverStale: true });
      const back = run({ kind: 'return' });
      if (back) log(`the animals: ${back.data.line}`);
      return true;
    } catch (e) {
      broken = String(e.message || e);
      log(`the animals stay away: ${broken}`);
      return false;
    }
  }

  function close() {
    if (!store) return;
    try { store.checkpoint(); } catch { /* the checkpoint is disposable */ }
    store.close();
    store = null;
  }

  // One command through the store, with the news it makes told to whoever listens.
  function run(command) {
    const e = store.dispatch(command, now());
    if (!e) return null;
    if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
      sinceCheckpoint = 0;
      try { store.checkpoint(); } catch { /* disposable */ }
    }
    const n = newsOf(e);
    if (n) onNews(n);
    return e;
  }

  // What deserves a toast: an arrival, a big change, a mark, a discovery, a step of the
  // mystery - one per event, the most important. Everything else is quiet diary.
  function newsOf(e) {
    const d = e.data;
    if (e.kind === 'arrival') return { kind: 'arrival', line: d.line, where: [d.home.x, d.home.z], animal: d.id, seq: e.seq };
    if (e.kind !== 'encounter') return null;
    const where = (d.traces && d.traces[0] && d.traces[0].near) || null;
    if (d.mystery && (d.mystery.stage || d.mystery.find)) return { kind: 'mystery', line: d.line, where, seq: e.seq };
    if (d.discovery) return { kind: 'discovery', line: d.discovery.line, where, seq: e.seq };
    if (d.traces && d.traces.length) return { kind: 'trace', line: `New on the island: ${d.traces[0].name}.`, where, seq: e.seq };
    if (d.major) return { kind: 'major', line: d.line, where: null, seq: e.seq };
    return null;
  }

  function placesOf(v) {
    if (placesFor !== v) { places = islandPlaces(v, { check: check ? check(v) : null }); placesFor = v; }
    return places;
  }

  // After every scan. `viewing` is whether the keeper has the island open, which is when the
  // first hen may turn up: an arrival nobody sees is a line in a diary nobody reads.
  function afterScan(v, { viewing = false } = {}) {
    if (!open() || !v || !v.buildings) return false;
    village = v;
    let changed = false;
    try {
      const p = placesOf(v);
      const residents = p.residents();
      const s = store.peek();
      const due = arrivalDue(s, now(), { viewing, working: residents.some((r) => r.active) }, rules);
      if (due) changed = arrive(due, residents, p) || changed;
      if (run({ kind: 'abandon', residents: residents.map((r) => r.id) })) changed = true;
      if (run({ kind: 'observe', residents, landmark: p.landmark() })) changed = true;
      if (placeTraces(p)) changed = true;
    } catch (e) {
      log(`the animals stumbled over a scan: ${e.message || e}`);
    }
    if (changed) onChange();
    return changed;
  }

  // Somewhere for a newcomer to live: a house nobody else's animal already lives by - the
  // most recently busy one for a hen, whose first sight of the island is somebody at work; a
  // goat anywhere its hash lands; a sparrow on the busiest roof.
  function arrive(species, residents, p) {
    const s = store.peek();
    const taken = new Set(Object.values(s.animals).map((a) => a.near).filter(Boolean));
    const houses = (village.buildings || []).filter((b) => (b.kind === 'house' || b.kind === 'camp') && b.plot && !taken.has(b.id));
    const cursor = new Map(residents.map((r) => [r.id, r.cursor]));
    const last = (b) => (b.lastAt ? Date.parse(b.lastAt) || 0 : 0);
    const order = species === 'chicken' ? [...houses].sort((a, b) => (b.active - a.active) || last(b) - last(a) || (a.id < b.id ? -1 : 1))
      : species === 'sparrow' ? [...houses].sort((a, b) => (cursor.get(b.id) || 0) - (cursor.get(a.id) || 0) || (a.id < b.id ? -1 : 1))
        : [...houses].sort((a, b) => hash32(`goat:${a.id}`) - hash32(`goat:${b.id}`));
    for (const b of order) {
      const home = p.homeFor(species, b);
      if (!home || !p.standable(home.x, home.z)) continue;
      const lookout = species === 'goat' ? p.lookoutNear(home) : null;
      if (species === 'goat' && !lookout) continue;
      const baseline = {};
      for (const r of residents) baseline[r.id] = r.cursor;
      const e = run({ kind: 'arrive', species, home, near: b.id, lookout, baseline, seed: village.island.seed });
      if (e) { log(`the animals: ${e.data.line}`); return true; }
      return false;
    }
    return false;
  }

  // Ground for every mark still waiting for some, near where the story put it.
  function placeTraces(p) {
    const s = store.peek();
    const placed = Object.values(s.traces).filter((t) => t.placed).map((t) => t.placed);
    let any = false;
    for (const t of Object.values(s.traces)) {
      if (t.placed) continue;
      const at = p.traceSpot(t.near, placed);
      if (!at) continue;
      if (run({ kind: 'place', trace: t.id, ...at })) { placed.push(at); any = true; }
    }
    return any;
  }

  // The sea says an errand happened. `current` is the generation of the socket we have now;
  // a completion from an older one is a line that dropped and was already re-posted.
  function complete({ action, gen }, current) {
    if (!store || gen !== current) return false;
    const s = store.peek();
    if (!Object.hasOwn(s.pending, action)) return false;
    let e = null;
    try {
      e = run({ kind: 'complete', action, landmark: village ? placesOf(village).landmark() : null });
      if (e && village) placeTraces(placesOf(village));
    } catch (err) {
      log(`the animals could not take in an errand: ${err.message || err}`);
    }
    if (e) onChange();
    return !!e;
  }

  // ---- what is shown -------------------------------------------------------------------
  function habitOf(id) {
    const recent = store.story(id, { limit: 12 }).entries.filter((x) => x.template);
    const counts = new Map();
    for (const x of recent) counts.set(x.template, (counts.get(x.template) || 0) + 1);
    let best = null, n = 0;
    for (const [tpl, c] of counts) if (c > n) { best = tpl; n = c; }
    const act = best && TEMPLATES[best] ? TEMPLATES[best].act : 'still';
    return HABIT_OF[act] || HABIT_OF.still;
  }

  function aboutOf(a) {
    const words = a.traits.map((t) => TRAITS[t].line).slice(0, 2).join(', ');
    const where = a.favourite ? `fond of ${a.favourite.label}` : `living ${a.home.label || 'by the square'}`;
    return `${a.name} is a ${words} ${SPECIES_WORD[a.species]}, ${where}.`.slice(0, 160);
  }

  const relWeight = (r) => r.fam + r.trust + r.irr + r.visits * 2;

  // For the sea: who the animals are, where each errand goes, and every mark that has
  // ground under it - with every settler named by the redacted id the bundle gave them
  // (`shownOf`, real -> shown), and anybody the bundle does not carry left out.
  function publicState(shownOf = () => null) {
    if (!store) return null;
    const s = store.peek();
    const animals = Object.values(s.animals).sort(byId).map((a) => ({
      id: a.id, species: a.species, name: a.name, traits: a.traits, home: [a.home.x, a.home.z], r: a.home.r,
      about: aboutOf(a),
      friends: Object.entries(a.rel).sort(([, x], [, y]) => relWeight(y) - relWeight(x)).slice(0, 4)
        .map(([who, r]) => ({ who: shownOf(who), label: r.label })).filter((f) => f.who),
    }));
    if (!animals.length) return null;
    const actions = Object.values(s.pending).map((p) => ({ id: p.id, animal: p.animal, act: p.act, dur: p.dur, to: p.to, look: p.look }));
    const traces = Object.values(s.traces).filter((t) => t.placed).map((t) => ({
      id: t.id, kind: t.kind, x: t.placed.x, z: t.placed.z, rot: t.placed.rot, name: t.name, at: t.at,
    }));
    // Clamped to this island's own half, which is what the sea parses it against: packed to
    // the default 256, one coordinate past a small island's edge refused the whole herd.
    const half = village && village.grid && village.grid.size ? village.grid.size / 2 : undefined;
    return packAnimals({ v: 1, seq: s.seq, animals, actions, traces }, half ? { half } : {});
  }

  // For the keeper's own page: everything, under the real ids, with settler names.
  function privateState() {
    if (!store) return { enabled: false, error: broken };
    const s = store.peek();
    const nameOf = new Map((village && village.buildings ? village.buildings : []).map((b) => [b.id, b.name || null]));
    const animals = Object.values(s.animals).sort(byId).map((a) => ({
      id: a.id, species: a.species, name: a.name, traits: a.traits, arrivedAt: a.arrivedAt,
      home: a.home, favourite: a.favourite, habit: habitOf(a.id), encounters: a.encounters, about: aboutOf(a),
      relationships: Object.entries(a.rel).sort(([, x], [, y]) => relWeight(y) - relWeight(x)).map(([resident, r]) => ({
        resident, name: nameOf.get(resident) || null, label: r.label, fam: r.fam, trust: r.trust, irr: r.irr,
        visits: r.visits, since: r.since, lastAt: r.lastAt,
      })),
    }));
    const story = store.story(null, { limit: 60 });
    const m = s.mystery;
    return {
      enabled: true, seq: s.seq, animals,
      pending: Object.values(s.pending).map((p) => ({ animal: p.animal, resident: p.resident, template: p.template, act: p.act, at: p.at })),
      traces: Object.values(s.traces).map((t) => ({ id: t.id, kind: t.kind, name: t.name, animal: t.animal, resident: t.resident, at: t.at, placed: t.placed })),
      discoveries: Object.values(s.discoveries).map((d) => ({ id: d.id, name: d.name, line: d.line, at: d.at, resident: d.resident })),
      mystery: m ? { stage: m.stage, hint: HINT(m), finds: m.finds.map((f) => ({ k: f.k, resident: f.resident, at: f.at })), startedAt: m.startedAt, resolvedAt: m.resolvedAt } : null,
      story: story.entries.map(shown), more: story.more,
    };
  }

  // `template` rides along so the dossier can fold two wordings of the same visit into one
  // line (collapseStory in web/js/animal-dossier.js); it names an encounter, never a person.
  const shown = (x) => ({ seq: x.seq, at: x.at, kind: x.kind, animal: x.animal, resident: x.resident, template: x.template || null, line: x.line, where: x.where, big: !!x.big, major: !!x.major });

  function story(animal, { before = Infinity, limit = 30 } = {}) {
    if (!store) return { entries: [], more: false };
    const page = store.story(animal || null, { before, limit });
    return { entries: page.entries.map(shown), more: page.more };
  }

  // At most three developments since `since`, most important first.
  function summary(since = 0) {
    if (!store) return { seq: 0, items: [] };
    const s = store.peek();
    const all = store.story(null, { limit: 200 }).entries.filter((x) => x.seq > since);
    const rank = (x) => (x.kind === 'arrival' ? PRIORITY.arrival : x.mystery ? PRIORITY.mystery : x.discovery ? PRIORITY.discovery
      : (x.traces && x.traces.length) ? PRIORITY.trace : x.major ? PRIORITY.major : 0);
    const items = all.filter((x) => rank(x) > 0).sort((a, b) => rank(b) - rank(a) || b.seq - a.seq).slice(0, 3)
      .map((x) => ({ seq: x.seq, at: x.at, line: x.line, where: x.where, animal: x.animal }));
    return { seq: s.seq, items };
  }

  return {
    open, close, afterScan, complete, publicState, privateState, story, summary,
    enabled: () => !!store, error: () => broken,
    seq: () => (store ? store.peek().seq : 0),
    // Tests and a console: the store's own state.
    state: () => (store ? store.snapshot() : null),
  };
}

const byId = (a, b) => {
  const n = (x) => Number(String(x.id).split(':')[1]) || 0;
  return n(a) - n(b);
};
