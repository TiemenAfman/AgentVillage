// What the page says about the island's story animals (Plans/dierenverhalen.md,
// docs/next/animal-stories.md "What the player sees", docs/animals-wire.md for every shape
// read here): the dossier of one animal, the island's animal journal, the "while you were
// away" card and the few lines a settler's own dossier gets about the animals that know them.
//
// Two halves. The top of the file is DOM-free - words, folding, picking and HTML strings -
// so tests/animal-dossier.test.mjs can hold it under Node without a document; nothing here
// touches `document` until createAnimalPanel is called. The bottom is the one function that
// owns the two panels, the chip and the card.
//
// Three rules the words keep, all from the design:
//   - A relationship is a word, never its numbers. /api/animals carries fam, trust and irr
//     because the islander decides with them; the page draws `label` only (RELATION_WORD),
//     and visits as a feeling rather than a count (visitsWord).
//   - The mystery is found things and a hint, never "2 of 3". A clue is a trace of kind
//     print/find/cache, named by the islander; nothing here counts them out loud.
//   - Every name is somebody's data. Animal names come off the islander, settler names off
//     session titles, and a visitor's card off another machine entirely, so every one of them
//     goes through escapeHtml, including the ones inside the islander's own story lines.
//
// Dates are real dates (when something happened), not the world's calendar, so they are
// written with toLocale*String like ui.js's fmtDate - and never with the local getters, which
// tests/worldclock.test.mjs refuses anywhere in web/js/ outside its short exempt list.
import { TRAITS, HABIT_OF, ACTS } from 'shared/animals.mjs';

// How many life-story entries an animal's dossier shows before "Earlier…", and how many the
// island's journal does. Both grow by the same step each time the button is pressed.
export const STORY_PAGE = 8;
export const JOURNAL_PAGE = 20;
// The return card's ceiling, the design's "at most three meaningful developments".
export const SUMMARY_MAX = 3;
// The trace kinds that belong to the mystery (lib/animal-stories.mjs MYSTERY): the print,
// each find, the cache it leads to. They are shown as found things under the hint, never in
// the list of ordinary marks.
export const MYSTERY_TRACES = new Set(['print', 'find', 'cache']);
// This browser's memory of the last story sequence it showed the keeper, so the return card
// says only what happened since. Per viewer, like the sound and the collapsed menu.
export const SEEN_KEY = 'promptholm.animals.seen';

const DAY_MS = 24 * 60 * 60 * 1000;
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const esc = escapeHtml;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---- words --------------------------------------------------------------------------
// The species as a villager says it: a chicken on this island is a hen.
export const SPECIES_WORD = { chicken: 'hen', goat: 'goat', sparrow: 'sparrow' };
export function speciesWord(species) {
  return (own(SPECIES_WORD, species) && SPECIES_WORD[species]) || (typeof species === 'string' && species) || 'animal';
}

// The reducer's four labels (labelOf in lib/animal-stories.mjs) as the page says them.
// `tolerant` is also what every relationship starts as, which is why it reads as a
// beginning rather than as a verdict. A label a newer islander invents reads as that one.
export const RELATION_WORD = {
  bonded: 'friends',
  tolerant: 'getting used to each other',
  suspicious: 'wary',
  nemesis: 'nemesis',
};
export function relationWord(label) {
  return own(RELATION_WORD, label) ? RELATION_WORD[label] : RELATION_WORD.tolerant;
}
// Which relationships are worth showing first: the strong feelings either way, then the
// wary ones, then the rest. Only an order, never shown.
const RELATION_WEIGHT = { bonded: 3, nemesis: 3, suspicious: 2, tolerant: 1 };
const relClass = (label) => (own(RELATION_WORD, label) ? label : 'tolerant');

// How often an animal has come calling, as a feeling rather than a tally.
export function visitsWord(n) {
  if (!(n > 0)) return 'not yet visited';
  if (n === 1) return 'one visit';
  if (n <= 3) return 'a few visits';
  if (n <= 9) return 'many visits';
  return 'a regular';
}

// What an animal is doing: an act word or its wire index -> HABIT_OF's phrase. A single word
// nobody here has heard of is an act from newer code and reads as 'still', exactly as
// shared/animals.mjs says an unknown index does; anything longer is the islander's own
// sentence and is kept.
export function habitWord(x) {
  if (typeof x === 'number') x = ACTS[x] || 'still';
  if (typeof x !== 'string' || !x.trim()) return HABIT_OF.still;
  const w = x.trim();
  if (own(HABIT_OF, w)) return HABIT_OF[w];
  return /\s/.test(w) ? w : HABIT_OF.still;
}
const isActWord = (x) => typeof x === 'number' || (typeof x === 'string' && (own(HABIT_OF, x.trim()) || !/\s/.test(x.trim())));

// The islander sends `habit` as one of HABIT_OF's own phrases (habitOf in lib/animal-life.mjs:
// the act of its most frequent recent visit), which reads after "is" like a live act does.
const HABIT_PHRASES = new Set(Object.values(HABIT_OF));
const isPhrase = (h) => typeof h === 'string' && (HABIT_PHRASES.has(h.trim()) || isActWord(h));

// One line for "what is it doing": the live act from the sea if the view knows it, otherwise
// the islander's habit, which is what it *usually* does. "Pip is pecking at a doorstep." /
// "Pip is usually pecking at a doorstep." / a sentence of the islander's own, capitalised.
export function habitLine(animal, act) {
  const name = (animal && animal.name) || 'It';
  if (act != null) return `${name} is ${habitWord(act)}.`;
  const h = animal && animal.habit;
  if (h == null || (typeof h === 'string' && !h.trim())) return `${name} is ${HABIT_OF.still}.`;
  if (isPhrase(h)) return `${name} is usually ${habitWord(h)}.`;
  const s = cap(String(h).trim());
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

// "bold and curious", "bold, curious and a homebody". Unknown traits are left out.
export function traitsLine(traits) {
  const words = (traits || []).filter((t) => own(TRAITS, t)).map((t) => TRAITS[t].line);
  if (words.length <= 1) return words[0] || '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

// A one-sentence description: the islander's public `about` when it wrote one, else built
// from the traits - "A bold, curious hen." / "A shy goat, and a homebody."
export function aboutLine(animal) {
  if (!animal) return '';
  if (typeof animal.about === 'string' && animal.about.trim()) return animal.about.trim();
  const lines = (animal.traits || []).filter((t) => own(TRAITS, t)).map((t) => TRAITS[t].line);
  const adjs = lines.filter((l) => !/^an? /.test(l));
  const nouns = lines.filter((l) => /^an? /.test(l));
  const noun = speciesWord(animal.species);
  const lead = adjs.length ? `${adjs.join(', ')} ${noun}` : noun;
  const article = /^[aeiou]/i.test(lead) ? 'An' : 'A';
  return `${article} ${lead}${nouns.length ? `, and ${nouns.join(' and ')}` : ''}.`;
}

// ---- dates ---------------------------------------------------------------------------
const toDate = (at) => {
  if (at == null || at === '') return null;
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d : null;
};
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function shortDate(d, now) {
  const withYear = d.toLocaleDateString('en-GB', { year: 'numeric' }) !== now.toLocaleDateString('en-GB', { year: 'numeric' });
  return d.toLocaleDateString('en-GB', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}
// A day as a villager says it: "today", "yesterday", "on Tuesday", "12 Sep".
export function dayLabel(at, now = Date.now()) {
  const d = toDate(at);
  if (!d) return '';
  const n = new Date(now);
  if (sameDay(d, n)) return 'today';
  if (sameDay(d, new Date(n.getTime() - DAY_MS))) return 'yesterday';
  if (n - d > 0 && n - d < 6 * DAY_MS) return `on ${d.toLocaleDateString('en-GB', { weekday: 'long' })}`;
  return shortDate(d, n);
}
// A diary entry's stamp: the time today, "yesterday", else the date.
export function timeLabel(at, now = Date.now()) {
  const d = toDate(at);
  if (!d) return '';
  const n = new Date(now);
  if (sameDay(d, n)) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, new Date(n.getTime() - DAY_MS))) return 'yesterday';
  return shortDate(d, n);
}
const sinceWords = (at, now) => {
  const w = dayLabel(at, now);
  return !w ? '' : w.startsWith('on ') ? `since ${w.slice(3)}` : `since ${w}`;
};

// ---- the story -------------------------------------------------------------------------
// What an ordinary entry "is", for folding: the template and who it was with when the
// islander says so, else the line with its repetition words taken out - so "Bram nudged at
// Max's door." and "Bram nudged at Max's door again, for the fourth time." are one pattern.
const REPEAT_WORDS = /\b(again|once more|twice|thrice|another time|for the \w+ time|\d+(st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/g;
export function patternOf(e) {
  if (!e) return '';
  if (e.template) return `t:${e.template}|${e.resident || ''}`;
  return String(e.line || '').toLowerCase().replace(REPEAT_WORDS, ' ').replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
const SAYS_HOW_OFTEN = /\b(for the \w+ time|\d+ times)\b/i;
const isBig = (e) => !!(e && (e.big || e.major || e.kind === 'arrival' || e.mystery || e.discovery || (e.traces && e.traces.length)));

// Folds runs of near-identical ordinary entries - the same animal, the same pattern, next to
// each other - into one line with a count, so a week of a goat nudging one door is one line
// "(×4)" rather than a page. A big entry (an arrival, a change of heart, a mark, a discovery,
// a clue) is its own line always: each is a development, and folding two would hide one.
// Order in is order out (the islander sends newest first); a folded line keeps the newest
// entry's words and seq, and `oldestSeq` is what "Earlier…" pages back from.
export function collapseStory(entries) {
  const out = [];
  for (const e of entries || []) {
    if (!e || typeof e !== 'object') continue;
    const key = isBig(e) ? null : `${e.animal || ''}\u0000${patternOf(e)}`;
    const prev = out[out.length - 1];
    if (key && prev && prev.key === key) {
      prev.count += 1;
      prev.seqs.push(e.seq);
      prev.oldestAt = e.at;
      prev.oldestSeq = e.seq;
      continue;
    }
    out.push({ ...e, key, count: 1, seqs: [e.seq], oldestAt: e.at, oldestSeq: e.seq });
  }
  return out;
}

// Which kind of development an entry is, for the return card and the toasts: the SSE news
// says it in `kind`; a diary entry says it through its fields (entryOf in
// lib/animal-stories.mjs). `vignette` is the one gentle line after a long absence, which is
// made for exactly this card; anything else is ordinary and never summarised.
export const NEWS_RANK = { mystery: 6, discovery: 5, trace: 4, major: 3, arrival: 2, vignette: 1 };
export function newsKind(e) {
  if (!e) return null;
  if (own(NEWS_RANK, e.kind) && e.kind !== 'arrival' && e.kind !== 'vignette') return e.kind;
  if (e.mystery) return 'mystery';
  if (e.discovery) return 'discovery';
  if (e.traces && e.traces.length) return 'trace';
  if (e.major) return 'major';
  if (e.kind === 'arrival') return 'arrival';
  if (e.kind === 'vignette') return 'vignette';
  return null;
}

// At most `max` developments since `sinceSeq`, picked by what matters most (a clue, then a
// discovery, a new mark, a change of heart, an arrival, the vignette; newest first within a
// kind) and handed back in the order they happened, so the card reads as a little story.
// The islander's /api/animals/summary already does this; this is the same rule for a page
// that has the diary and not the summary (and what the tests hold the words to).
export function summaryItems(story, sinceSeq = null, max = SUMMARY_MAX) {
  const since = Number.isFinite(sinceSeq) ? sinceSeq : -Infinity;
  const picked = (story || [])
    .filter((e) => e && Number.isFinite(e.seq) && e.seq > since && newsKind(e))
    .map((e) => ({ e, kind: newsKind(e) }))
    .sort((a, b) => NEWS_RANK[b.kind] - NEWS_RANK[a.kind] || b.e.seq - a.e.seq)
    .slice(0, Math.max(0, max));
  return picked
    .sort((a, b) => a.e.seq - b.e.seq)
    .map(({ e, kind }) => ({ seq: e.seq, at: e.at, line: e.line, where: validAt(e.where), animal: e.animal || null, kind }));
}

// ---- reading the state ---------------------------------------------------------------
const validAt = (w) => (Array.isArray(w) && w.length >= 2 && Number.isFinite(w[0]) && Number.isFinite(w[1]) ? [w[0], w[1]] : null);
const homeAt = (a) => (a && a.home && Number.isFinite(a.home.x) && Number.isFinite(a.home.z) ? [a.home.x, a.home.z] : validAt(a && a.home));
export function animalById(state, id) {
  return ((state && state.animals) || []).find((a) => a && a.id === id) || null;
}

// An animal's relationships, the ones worth reading first at the top.
export function relationsOf(animal) {
  return ((animal && animal.relationships) || []).filter(Boolean).slice().sort((a, b) =>
    (RELATION_WEIGHT[b.label] || 0) - (RELATION_WEIGHT[a.label] || 0)
    || (toDate(b.lastAt) || 0) - (toDate(a.lastAt) || 0));
}

// The animals that know one settler, and how - for the settler's own dossier.
export function animalsKnowing(state, residentId, max = 3) {
  const out = [];
  for (const a of (state && state.animals) || []) {
    const rel = ((a && a.relationships) || []).find((r) => r && r.resident === residentId);
    if (rel) out.push({ animal: a, rel });
  }
  return out.sort((x, y) => (RELATION_WEIGHT[y.rel.label] || 0) - (RELATION_WEIGHT[x.rel.label] || 0)
    || (toDate(y.rel.lastAt) || 0) - (toDate(x.rel.lastAt) || 0)).slice(0, max);
}

// ---- HTML ----------------------------------------------------------------------------
// Every clickable thing is a data attribute, wired in one place (wireIn below):
// data-goto="x,z" flies the camera, data-animal opens that animal, data-resident that settler.
const gotoAttr = (at) => (at ? ` data-goto="${esc(`${at[0]},${at[1]}`)}"` : '');
const showLink = (at, label = 'Show') => (at ? ` <button class="an-go"${gotoAttr(at)} title="Show on the island">${esc(label)}</button>` : '');

// The animal's name in bold inside its own line, both escaped first so the bold is the only
// markup there is.
function lineHtml(line, name) {
  const safe = esc(line || '');
  const n = name ? esc(name) : '';
  // A function, not a string: a name with a `$&` in it would otherwise be a pattern.
  return n && safe.includes(n) ? safe.replace(n, () => `<b>${n}</b>`) : safe;
}

// A list of diary entries, already folded. `names` maps an animal id to its name, for the bold.
export function renderStory(entries, { now = Date.now(), names = null } = {}) {
  const rows = collapseStory(entries);
  if (!rows.length) return '';
  return `<ol class="an-story">${rows.map((e) => {
    const name = names && e.animal ? names.get(e.animal) : null;
    // The islander's own repeat lines already count ("…again, for the fourth time"), and a
    // "(×3)" beside that reads as a contradiction: the words count every visit ever, the ×
    // only this run. So the × is said only when the line does not say how often itself.
    const counted = SAYS_HOW_OFTEN.test(e.line || '');
    const times = e.count > 1 && !counted ? ` <span class="an-times" title="${esc(`${e.count} times, ${timeLabel(e.oldestAt, now)} to ${timeLabel(e.at, now)}`)}">(×${e.count})</span>` : '';
    return `<li class="${isBig(e) ? 'big' : ''}"><time>${esc(timeLabel(e.at, now))}</time>${lineHtml(e.line, name)}${times}${showLink(validAt(e.where))}</li>`;
  }).join('')}</ol>`;
}

const earlierButton = (show, loading) => (show
  ? `<p class="an-earlier"><button class="btn" data-earlier="1"${loading ? ' disabled' : ''}>${loading ? 'Looking back…' : 'Earlier…'}</button></p>` : '');

// Where a relationship's settler name goes: clickable when the page can open that settler.
const whoHtml = (rel, canResident) => {
  const name = esc(rel.name || 'a settler who has moved on');
  return canResident && rel.resident ? `<span class="an-who clickable" data-resident="${esc(rel.resident)}">${name}</span>` : `<span class="an-who">${name}</span>`;
};

// The keeper's dossier of one animal. `entries` is its story as known so far (newest first);
// `limit` how many of them to show; `more` whether "Earlier…" has anything to offer.
export function renderAnimal(animal, {
  now = Date.now(), act = null, entries = null, limit = STORY_PAGE, more = false, loading = false,
  pending = null, canResident = false, here = null,
} = {}) {
  if (!animal) return '<p class="muted">This animal has left no trace.</p>';
  const traits = (animal.traits || []).filter((t) => own(TRAITS, t));
  let html = `<div class="tagrow"><span class="tag style an-species">${esc(cap(speciesWord(animal.species)))}</span>`
    + traits.map((t) => `<span class="tag">${esc(TRAITS[t].line)}</span>`).join('') + '</div>';
  html += `<p class="an-about">${esc(aboutLine(animal))}</p>`;
  html += `<p class="an-now"><i></i><span>${esc(habitLine(animal, act))}</span></p>`;

  const rows = [];
  // What it usually does, when the "now" line is saying something else. Without a live act
  // the "now" line is the habit, and a row repeating it is noise.
  if (act != null && animal.habit != null && String(animal.habit).trim() && habitWord(animal.habit) !== habitWord(act)) {
    rows.push(['Usually', esc(cap(habitWord(animal.habit)))]);
  }
  const home = homeAt(animal);
  if (animal.home && (animal.home.label || home)) rows.push(['Home', esc(cap(animal.home.label || 'near the square')) + showLink(home)]);
  if (animal.favourite && animal.favourite.label) rows.push(['Favourite', esc(cap(animal.favourite.label)) + showLink(validAt(animal.favourite.at))]);
  if (pending) rows.push(['Errand', esc(pending)]);
  if (animal.arrivedAt != null && toDate(animal.arrivedAt)) rows.push(['Arrived', esc(cap(dayLabel(animal.arrivedAt, now)))]);
  if (rows.length) html += `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

  const goAt = validAt(here) || home;
  if (goAt) html += `<p class="dossier-actions"><button class="btn primary"${gotoAttr(goAt)}>Show on the island</button></p>`;

  const rels = relationsOf(animal);
  html += '<h3 class="sec">Who they know</h3>';
  html += rels.length
    ? `<ul class="an-rels">${rels.map((r) => `<li>${whoHtml(r, canResident)}<span class="an-label ${relClass(r.label)}">${esc(relationWord(r.label))}</span>`
      + `<small>${esc([visitsWord(r.visits), sinceWords(r.since, now)].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>`
    : `<p class="muted">Nobody yet. ${esc(animal.name || 'It')} is still getting to know the place.</p>`;

  const all = (entries || []).filter(Boolean);
  const shown = all.slice(0, limit);
  html += '<h3 class="sec">Life story</h3>';
  html += shown.length ? renderStory(shown, { now, names: new Map([[animal.id, animal.name]]) }) : '<p class="muted">Nothing written down yet.</p>';
  html += earlierButton(all.length > limit || more, loading);
  return html;
}

// A visitor's card for somebody else's animal: what the herd message carries and no more -
// the name, the species, what it is doing, the public line and its friends under whatever
// name the visitor's own copy of that island gives them. The diary stays on its own island.
export function renderPublic(animal, { island = null, nameOf = null, act = null } = {}) {
  if (!animal) return '<p class="muted">This animal has left no trace.</p>';
  const traits = (animal.traits || []).filter((t) => own(TRAITS, t));
  let html = `<div class="tagrow"><span class="tag style an-species">${esc(cap(speciesWord(animal.species)))}</span>`
    + traits.map((t) => `<span class="tag">${esc(TRAITS[t].line)}</span>`).join('') + '</div>';
  html += `<p class="an-about">${esc(aboutLine(animal))}</p>`;
  html += `<p class="an-now"><i></i><span>${esc(habitLine(animal, act))}</span></p>`;
  const friends = (animal.friends || []).filter(Boolean).slice(0, 4);
  if (friends.length) {
    html += '<h3 class="sec">Who they know</h3><ul class="an-rels">'
      + friends.map((f) => {
        let name = null;
        try { name = nameOf ? nameOf(f.who) : null; } catch { name = null; }
        return `<li><span class="an-who">${esc(name || 'a settler')}</span><span class="an-label ${relClass(f.label)}">${esc(relationWord(f.label))}</span></li>`;
      }).join('') + '</ul>';
  }
  html += `<p class="muted an-foot">${island ? `${esc(island)} keeps` : 'Its island keeps'} the rest of ${esc(animal.name || 'its')}${animal.name ? '’s' : ''} story on its own machine.</p>`;
  return html;
}

// The lines a settler's dossier gets: up to three animals that know them, by the word. Empty
// when none do, so the dossier has no heading over nothing.
export function residentSection(residentId, state, { max = 3 } = {}) {
  const known = animalsKnowing(state, residentId, max);
  if (!known.length) return '';
  return '<section class="an-ties"><h3 class="sec">Animals who know them</h3><ul class="list">'
    + known.map(({ animal, rel }) => `<li><b class="clickable" data-animal="${esc(animal.id)}">${esc(animal.name)}</b>`
      + ` <small>— the ${esc(speciesWord(animal.species))}</small> <span class="an-label ${relClass(rel.label)}">${esc(relationWord(rel.label))}</span></li>`).join('')
    + '</ul></section>';
}

// The mystery, as the clues found and the islander's hint. Solved says so; nothing says how
// far along it is.
function mysteryHtml(state, now) {
  const m = state && state.mystery;
  if (!m) return '';
  const clues = ((state.traces || []).filter((t) => t && MYSTERY_TRACES.has(t.kind)))
    .sort((a, b) => (toDate(a.at) || 0) - (toDate(b.at) || 0));
  const solved = m.resolvedAt != null || m.stage >= 3;
  let html = `<div class="an-mystery${solved ? ' solved' : ''}"><h3 class="sec">${solved ? 'A mystery, solved' : 'Something odd'}</h3>`;
  if (m.hint) html += `<p class="an-hint">${esc(m.hint)}</p>`;
  if (clues.length) {
    html += `<ul class="an-finds">${clues.map((t) => `<li><b>${esc(cap(t.name || 'Something'))}</b>`
      + ` <small>${esc(dayLabel(t.at, now))}</small>${showLink(t.placed ? [t.placed.x, t.placed.z] : null)}</li>`).join('')}</ul>`;
  }
  return html + '</div>';
}

// The island's animal journal: the cast, the mystery, the marks and discoveries, the diary.
export function renderJournal(state, { now = Date.now(), acts = null, limit = JOURNAL_PAGE, more = null, loading = false, extra = null } = {}) {
  if (!state) return '<p class="muted">Asking the island…</p>';
  // Not told: the islander's own word on whether its latest page is all there is.
  if (more == null) more = !!state.more;
  if (state.enabled === false) return '<p class="muted">Animal stories are switched off on this island.</p>';
  const animals = (state.animals || []).filter(Boolean);
  if (!animals.length) {
    return '<p class="muted">No animal has made this island its home yet. They turn up when the village is busy and somebody is watching.</p>';
  }
  let html = '<ul class="an-cast">' + animals.map((a) => {
    const act = acts ? acts(a.id) : null;
    const bits = [speciesWord(a.species), traitsLine(a.traits), act != null ? habitWord(act) : (a.habit ? habitWord(a.habit) : null)].filter(Boolean);
    return `<li data-animal="${esc(a.id)}"><b>${esc(a.name)}</b><small>${esc(bits.join(' · '))}</small></li>`;
  }).join('') + '</ul>';

  html += mysteryHtml(state, now);

  const marks = (state.traces || []).filter((t) => t && !MYSTERY_TRACES.has(t.kind));
  const finds = (state.discoveries || []).filter(Boolean);
  if (marks.length || finds.length) {
    html += '<h3 class="sec">On the island</h3><ul class="an-marks">';
    html += finds.map((d) => `<li><b>${esc(cap(d.name || 'A discovery'))}</b> <small>${esc(dayLabel(d.at, now))}</small>${d.line ? `<p>${esc(d.line)}</p>` : ''}</li>`).join('');
    html += marks.map((t) => `<li><b>${esc(cap(t.name || 'A mark'))}</b> <small>${esc(dayLabel(t.at, now))}${t.placed ? '' : ' · still looking for a spot'}</small>`
      + `${showLink(t.placed ? [t.placed.x, t.placed.z] : null)}</li>`).join('');
    html += '</ul>';
  }

  const names = new Map(animals.map((a) => [a.id, a.name]));
  const all = mergeStory(state.story, extra);
  html += '<h3 class="sec">Diary</h3>';
  html += all.length ? renderStory(all.slice(0, limit), { now, names }) : '<p class="muted">Nothing written down yet.</p>';
  html += earlierButton(all.length > limit || more, loading);
  return html;
}

// The "while you were away" card's list. A line, and a Show where the islander said where.
export function renderSummary(items, { names = null } = {}) {
  const list = (items || []).filter((i) => i && i.line).slice(0, SUMMARY_MAX);
  return list.map((i) => `<li data-kind="${esc(i.kind || 'news')}"><span>${lineHtml(i.line, names && i.animal ? names.get(i.animal) : null)}</span>`
    + `${validAt(i.where) ? `<button class="chip an-show"${gotoAttr(validAt(i.where))}>Show</button>` : ''}</li>`).join('');
}

// The few words over a toast, by kind. The line under them is the islander's own.
const KICKER = { arrival: 'New on the island', major: 'A change of heart', trace: 'Left a mark', discovery: 'A discovery', mystery: 'Something odd' };
export function toastHtml(item, { names = null } = {}) {
  const kick = KICKER[item.kind] ? `<small class="an-kick">${esc(KICKER[item.kind])}</small>` : '';
  const go = validAt(item.where) ? ' <button class="act" data-show="1">Show</button>' : '';
  return `${kick}${lineHtml(item.line, names && item.animal ? names.get(item.animal) : null)}${go}`;
}

// A hover label for an animal under the mouse: its name, and what it is up to.
export function hoverOf(animal, act = null) {
  if (!animal) return null;
  return { name: animal.name || cap(speciesWord(animal.species)), sub: `${speciesWord(animal.species)} · ${habitWord(act != null ? act : animal.habit)}` };
}

// A story as known: what /api/animals carried plus the pages "Earlier…" fetched, by seq,
// newest first, no seq twice.
export function mergeStory(...lists) {
  const bySeq = new Map();
  for (const l of lists) for (const e of l || []) if (e && Number.isFinite(e.seq) && !bySeq.has(e.seq)) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq);
}

// What an errand of this animal's says, if one is on its way: "Heading over to Nova's."
function pendingLine(state, animal) {
  const p = ((state && state.pending) || []).find((x) => x && x.animal === animal.id);
  if (!p) return null;
  const rel = ((animal.relationships) || []).find((r) => r && r.resident === p.resident);
  return rel && rel.name ? `Heading over to ${rel.name}'s.` : 'Off on an errand.';
}

// ---- the panels ------------------------------------------------------------------------
// Owns #animal-dossier, #animal-journal, #animals-btn and #animal-summary (web/index.html).
// Everything it is handed is optional except `ui`:
//   ui           createUI()'s return: openSide / closeSide / syncPanels / toast
//   onGoto       ([x, z]) => fly the camera to that island-local spot
//   onResident   (houseId) => open that settler (their name in a relationship is clickable)
//   fetchState   () => Promise<GET /api/animals>
//   fetchStory   (animalId | null, beforeSeq, limit) => Promise<entries | { story|entries, more }>
//                (null asks for the whole island's diary - the journal's "Earlier…")
//   fetchSummary (sinceSeq) => Promise<GET /api/animals/summary>
//   liveAct      (animalId) => the act the sea last said (word or index), for "now"
//   whereOf      (animalId) => [x, z] where it stands now, for "Show on the island"
//   onClose      (panelId) => after one of the two panels closed, by whatever means
export function createAnimalPanel(opts = {}) {
  const { ui = null, onGoto = null, onResident = null, fetchState = null, fetchStory = null, fetchSummary = null,
    liveAct = null, whereOf = null, onClose = null } = opts;
  const $ = (id) => document.getElementById(id);
  const dossier = $('animal-dossier');
  const journal = $('animal-journal');
  const chip = $('animals-btn');
  const card = $('animal-summary');
  let state = null;
  // What is open: { panel: 'animal-dossier', kind: 'animal', id } | { panel: 'animal-dossier',
  // kind: 'public', animal, opts } | { panel: 'animal-journal', kind: 'journal' } | null.
  let current = null;
  // "Earlier…" per animal id, '*' for the journal: how many are shown, what was fetched,
  // whether the islander has anything older.
  const pages = new Map();
  const page = (key) => {
    if (!pages.has(key)) pages.set(key, { limit: key === '*' ? JOURNAL_PAGE : STORY_PAGE, extra: [], done: false, loading: false });
    return pages.get(key);
  };

  const safe = (fn, ...a) => { try { return fn ? fn(...a) : null; } catch { return null; } };
  const names = () => new Map(((state && state.animals) || []).map((a) => [a.id, a.name]));

  // ui.js knows which side panels there are and closes the others; without it (an older
  // ui.js) this does the same by hand for the ones it can see.
  function openSide(id) {
    if (ui && ui.openSide) { ui.openSide(id); return; }
    for (const other of ['dossier', 'legend', 'settings', 'animal-dossier', 'animal-journal']) {
      const n = $(other);
      if (n && other !== id) n.hidden = true;
    }
    $(id).hidden = false;
  }
  function closeSide(id) {
    if (ui && ui.closeSide) ui.closeSide(id);
    else { $(id).hidden = true; if (ui && ui.syncPanels) ui.syncPanels(); }
  }

  // However a panel closes - its ✕, Escape, another panel opening, walking, planning - it is
  // `hidden` that changes, so that is what is watched rather than every way there is to set it.
  function watch(node) {
    if (!node || typeof MutationObserver === 'undefined') return;
    new MutationObserver(() => {
      if (!node.hidden) return;
      if (current && current.panel === node.id) {
        current = null;
        safe(onClose, node.id);
      }
      syncChip();
    }).observe(node, { attributes: true, attributeFilter: ['hidden'] });
  }
  watch(dossier);
  watch(journal);

  function syncChip() {
    if (!chip) return;
    const has = !!(state && state.enabled !== false && (state.animals || []).length);
    chip.hidden = !has;
    chip.classList.toggle('on', !!(journal && !journal.hidden));
  }
  if (chip) chip.addEventListener('click', () => {
    if (journal && !journal.hidden) closeSide('animal-journal');
    else showJournal();
  });

  // Every click in anything this module drew. One listener per render of the panel body -
  // the body is replaced wholesale, so nothing is attached twice.
  function wireIn(root) {
    if (!root) return root;
    root.querySelectorAll('[data-goto]').forEach((n) => n.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const [x, z] = String(n.dataset.goto).split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(z)) safe(onGoto, [x, z]);
    }));
    root.querySelectorAll('[data-animal]').forEach((n) => n.addEventListener('click', () => show(n.dataset.animal)));
    root.querySelectorAll('[data-resident]').forEach((n) => n.addEventListener('click', () => safe(onResident, n.dataset.resident)));
    root.querySelectorAll('[data-earlier]').forEach((n) => n.addEventListener('click', () => earlier()));
    return root;
  }

  function knownFor(key) {
    const p = page(key);
    const base = ((state && state.story) || []).filter((e) => e && (key === '*' || e.animal === key));
    return mergeStory(base, p.extra);
  }
  function moreFor(key) {
    const p = page(key);
    if (p.done || !fetchStory) return false;
    // An islander that says it sent everything has nothing older for anybody.
    return !(state && state.more === false);
  }

  function render(keepScroll) {
    if (!current) return;
    const isJournal = current.kind === 'journal';
    const body = $(isJournal ? 'animal-journal-body' : 'animal-dossier-body');
    if (!body) return;
    const top = body.scrollTop;
    const now = Date.now();
    if (isJournal) {
      const p = page('*');
      body.innerHTML = renderJournal(state, { now, acts: liveAct ? (id) => safe(liveAct, id) : null,
        limit: p.limit, more: moreFor('*'), loading: p.loading, extra: p.extra });
    } else if (current.kind === 'public') {
      $('animal-dossier-name').textContent = current.animal.name || cap(speciesWord(current.animal.species));
      body.innerHTML = renderPublic(current.animal, { ...current.opts, act: current.opts.act != null ? current.opts.act : safe(liveAct, current.animal.id) });
    } else {
      const animal = animalById(state, current.id);
      $('animal-dossier-name').textContent = animal ? animal.name : '—';
      const p = page(current.id);
      body.innerHTML = renderAnimal(animal, { now, act: safe(liveAct, current.id), entries: knownFor(current.id),
        limit: p.limit, more: moreFor(current.id), loading: p.loading, pending: animal ? pendingLine(state, animal) : null,
        canResident: !!onResident, here: safe(whereOf, current.id) });
    }
    wireIn(body);
    body.scrollTop = keepScroll ? top : 0;
  }

  async function earlier() {
    if (!current || current.kind === 'public') return;
    const key = current.kind === 'journal' ? '*' : current.id;
    const p = page(key);
    if (p.loading) return;
    const step = key === '*' ? JOURNAL_PAGE : STORY_PAGE;
    p.limit += step;
    const known = knownFor(key);
    if (known.length < p.limit && moreFor(key)) {
      p.loading = true;
      render(true);
      try {
        const oldest = known.length ? known[known.length - 1].seq : null;
        const got = await fetchStory(key === '*' ? null : key, oldest, step);
        const list = Array.isArray(got) ? got : (got && (got.story || got.entries)) || [];
        p.extra.push(...list.filter((e) => e && Number.isFinite(e.seq)));
        if (!list.length || list.length < step || (got && got.more === false)) p.done = true;
      } catch { p.done = true; }
      p.loading = false;
    }
    render(true);
  }

  // The keeper's state, from GET /api/animals. An open panel follows it where it stands.
  function setState(next) {
    state = next || null;
    syncChip();
    if (current && current.kind !== 'public') render(true);
  }
  async function refresh() {
    if (!fetchState) return state;
    try { setState(await fetchState()); } catch { /* keep what we had */ }
    return state;
  }

  // One of our own animals, by id or by the record /api/animals gave.
  function show(animal, next) {
    if (next) setState(next);
    const id = typeof animal === 'string' ? animal : animal && animal.id;
    if (!animalById(state, id)) {
      // Clicked before /api/animals answered (or before it knew a newcomer): ask, then open.
      if (fetchState && id) refresh().then(() => { if (animalById(state, id)) show(id); });
      return false;
    }
    current = { panel: 'animal-dossier', kind: 'animal', id };
    openSide('animal-dossier');
    render(false);
    return true;
  }
  // Somebody else's animal, from their herd: { island, nameOf, act }.
  function showPublic(animal, o = {}) {
    if (!animal) return false;
    const opt = typeof o === 'string' ? { island: o } : o || {};
    current = { panel: 'animal-dossier', kind: 'public', animal, opts: { island: opt.island || null, nameOf: opt.nameOf || null, act: opt.act ?? null } };
    openSide('animal-dossier');
    render(false);
    return true;
  }
  function showJournal(next) {
    if (next) setState(next);
    current = { panel: 'animal-journal', kind: 'journal' };
    openSide('animal-journal');
    render(false);
    syncChip();
    // Always worth asking again: the journal is opened seldom and the diary moves on its own.
    if (!next && fetchState) refresh();
    return true;
  }
  function close() {
    if (dossier && !dossier.hidden) closeSide('animal-dossier');
    if (journal && !journal.hidden) closeSide('animal-journal');
  }
  function isOpen(which) {
    if (!current) return false;
    return which ? current.panel === which || current.kind === which : true;
  }

  // ---- the return card and the news ---------------------------------------------------
  function lastSeen() {
    try { const v = localStorage.getItem(SEEN_KEY); return v == null ? null : Number(v); } catch { return null; }
  }
  function markSeen(seq) {
    if (!Number.isFinite(seq)) return;
    const had = lastSeen();
    if (had != null && had >= seq) return;
    try { localStorage.setItem(SEEN_KEY, String(seq)); } catch { /* kept for this page only */ }
  }
  function syncCard() {
    if (!card) return;
    if (ui && ui.syncPanels) ui.syncPanels();
    else card.hidden = !card.querySelector('li');
  }
  if (card) card.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-dismiss]')) { $('animal-summary-list').innerHTML = ''; syncCard(); }
  });
  // Up to three items (the islander's /api/animals/summary, or summaryItems over a diary).
  // Showing it counts as having seen it: the card says each thing once.
  function summary(items, seq) {
    const list = $('animal-summary-list');
    if (!list) return;
    list.innerHTML = renderSummary(items, { names: names() });
    wireIn(list);
    const top = (items || []).reduce((m, i) => (i && Number.isFinite(i.seq) && i.seq > m ? i.seq : m), -Infinity);
    markSeen(Number.isFinite(seq) ? seq : top);
    syncCard();
  }

  // SSE `animals`: { seq, news: [{ kind, line, where, animal }] } - the islander sends only
  // the kinds that deserve a toast. Two at most per message; the rest wait in the journal.
  function news(msg) {
    if (!msg) return Promise.resolve(state);
    const n = names();
    for (const item of (msg.news || []).filter((i) => i && i.line).slice(0, 2)) {
      if (!ui || !ui.toast) break;
      ui.toast(toastHtml(item, { names: n }), (d) => {
        const b = d.querySelector('[data-show]');
        const at = validAt(item.where);
        if (b && at) b.addEventListener('click', () => safe(onGoto, at));
      });
    }
    markSeen(msg.seq);
    return refresh();
  }

  // Boot: the state (so the chip appears), then the card for whatever happened since this
  // browser last looked.
  async function boot() {
    await refresh();
    if (!fetchSummary) return state;
    try {
      const since = lastSeen();
      const r = await fetchSummary(since == null ? 0 : since);
      if (r) summary(r.items || [], r.seq);
    } catch { /* no card is fine */ }
    return state;
  }

  // The settler's dossier, after ui.showDossier has drawn it: the animals that know them go
  // under the first block of facts, before "The house".
  function decorateDossier(residentId) {
    const body = $('dossier-body');
    if (!body) return false;
    body.querySelectorAll('.an-ties').forEach((n) => n.remove());
    const html = residentSection(residentId, state);
    if (!html) return false;
    const anchor = body.querySelector('dl.kv');
    if (anchor) anchor.insertAdjacentHTML('afterend', html);
    else body.insertAdjacentHTML('beforeend', html);
    wireIn(body.querySelector('.an-ties'));
    return true;
  }

  syncChip();
  return {
    setState, refresh, boot, show, showPublic, showJournal, summary, news, close, isOpen,
    residentSection: (id, s) => residentSection(id, s || state), decorateDossier, wire: wireIn,
    hoverOf: (id, act) => hoverOf(typeof id === 'string' ? animalById(state, id) : id, act),
    lastSeen, markSeen, state: () => state,
  };
}
