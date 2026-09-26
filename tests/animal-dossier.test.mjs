// What the page says about the story animals (web/js/animal-dossier.js; Plans/dierenverhalen.md,
// docs/next/animal-stories.md "What the player sees", docs/animals-wire.md).
//
// The promises: a relationship is a word and never its numbers; the mystery is found things and
// a hint, never a count; every name that reaches the page is escaped, the islander's own story
// lines included; a run of the same small thing is one line with a count, while anything that
// changed something stays its own line; the return card holds at most three developments,
// picked by what matters most and told in the order they happened; and the panels' ids are the
// ones index.html and ui.js agree on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// No document stub on purpose: the helpers are DOM-free, and nothing may reach for the page
// until createAnimalPanel is called. The moment this import needs a stub, that stopped being true.
assert.equal(globalThis.document, undefined);
const D = await import('../web/js/animal-dossier.js');
const { HABIT_OF, TRAITS } = await import('../shared/animals.mjs');

const NOW = Date.UTC(2026, 8, 26, 12, 0);
const HOUR = 3600e3;
const DAY = 24 * HOUR;

const nasty = '<img src=x onerror="alert(1)">';
const pip = {
  id: 'animal:1', species: 'chicken', name: 'Pip', traits: ['bold', 'curious'], arrivedAt: NOW - 3 * DAY,
  home: { x: 4.5, z: -2, r: 0.9, label: "Slate Mill's doorstep" }, favourite: { label: 'the nest by Nova\'s door', at: [5, -1.5] },
  habit: 'peck', encounters: 7, about: null,
  relationships: [
    { resident: 'house:aaa', name: 'Nova', label: 'bonded', fam: 73.25, trust: 64.5, irr: 3.75, visits: 6, since: NOW - DAY, lastAt: NOW - HOUR },
    { resident: 'house:bbb', name: nasty, label: 'suspicious', fam: 21.5, trust: 8.25, irr: 38.5, visits: 2, since: NOW - 2 * DAY, lastAt: NOW - 2 * HOUR },
    { resident: 'house:ccc', name: 'Max', label: 'tolerant', fam: 4.5, trust: 1.5, irr: 0, visits: 1, since: NOW - DAY, lastAt: NOW - 3 * HOUR },
  ],
};
const bram = {
  id: 'animal:2', species: 'goat', name: 'Bram', traits: ['stubborn', 'homebody'], arrivedAt: NOW - DAY,
  home: { x: -10, z: 8, r: 1.4, label: 'the high meadow' }, favourite: null, habit: 'nudge', about: 'A stubborn goat.',
  relationships: [{ resident: 'house:ccc', name: 'Max', label: 'nemesis', fam: 40, trust: 0, irr: 81.5, visits: 11, since: NOW - HOUR, lastAt: NOW - HOUR }],
};
const entry = (seq, over = {}) => ({ seq, at: NOW - (100 - seq) * HOUR, kind: 'encounter', animal: 'animal:1', line: `Pip pecked about on Nova's doorstep.`, where: [5, -1], big: false, major: false, ...over });

// The numbers that must never be drawn: every fam/trust/irr above, as the page would print them.
const RAW = ['73.25', '64.5', '3.75', '21.5', '8.25', '38.5', '81.5'];
const noRaw = (html) => { for (const n of RAW) assert.ok(!html.includes(n), `a raw relationship number (${n}) reached the page`); };

test('importing the dossier needs no document', () => {
  assert.equal(typeof D.createAnimalPanel, 'function');
  assert.equal(globalThis.document, undefined);
});

test('names are escaped, quotes included', () => {
  assert.equal(D.escapeHtml(nasty), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(D.escapeHtml("Nova's"), 'Nova&#39;s');
  assert.equal(D.escapeHtml(null), '');
});

test('a relationship is one of four words, and an unknown label reads as a beginning', () => {
  assert.equal(D.relationWord('bonded'), 'friends');
  assert.equal(D.relationWord('tolerant'), 'getting used to each other');
  assert.equal(D.relationWord('suspicious'), 'wary');
  assert.equal(D.relationWord('nemesis'), 'nemesis');
  assert.equal(D.relationWord('besotted'), 'getting used to each other');
  assert.equal(D.relationWord(undefined), 'getting used to each other');
  assert.equal(D.relationWord('__proto__'), 'getting used to each other');
  for (const w of Object.values(D.RELATION_WORD)) assert.doesNotMatch(w, /\d/);
  // Visits are a feeling too.
  for (const n of [0, 1, 2, 3, 5, 9, 10, 400]) assert.doesNotMatch(D.visitsWord(n), /\d/);
});

test('what an animal is doing is HABIT_OF, by word or by wire index', () => {
  assert.equal(D.habitWord('peck'), HABIT_OF.peck);
  assert.equal(D.habitWord(3), HABIT_OF.peck);                   // ACTS[3] is 'peck'
  assert.equal(D.habitWord(999), HABIT_OF.still);                // an index from newer code
  assert.equal(D.habitWord('pirouette'), HABIT_OF.still);        // a word from newer code
  assert.equal(D.habitWord('keeps to the square most days'), 'keeps to the square most days');
  assert.equal(D.habitWord(null), HABIT_OF.still);
  assert.equal(D.habitLine(pip, 'dust'), `Pip is ${HABIT_OF.dust}.`);
  // Without a live act the habit is what it usually does - as the act word, or as the
  // HABIT_OF phrase lib/animal-life.mjs habitOf actually sends.
  assert.equal(D.habitLine(pip), `Pip is usually ${HABIT_OF.peck}.`);
  assert.equal(D.habitLine({ name: 'Pip', habit: HABIT_OF.scratch }), `Pip is usually ${HABIT_OF.scratch}.`);
  assert.equal(D.habitLine({ name: 'Pip', habit: 'visits Nova most mornings' }), 'Visits Nova most mornings.');
  assert.equal(D.habitLine({ name: 'Pip' }), `Pip is ${HABIT_OF.still}.`);
  // The dossier says "Usually" only when the live act is something else.
  assert.match(D.renderAnimal({ ...pip, habit: HABIT_OF.peck }, { now: NOW, act: 'dust' }), new RegExp(`<dt>Usually</dt><dd>${HABIT_OF.peck[0].toUpperCase()}`));
  assert.doesNotMatch(D.renderAnimal({ ...pip, habit: HABIT_OF.peck }, { now: NOW, act: 'peck' }), /Usually/);
  assert.doesNotMatch(D.renderAnimal({ ...pip, habit: HABIT_OF.peck }, { now: NOW }), /<dt>Usually/);
});

test('traits read as TRAITS[..].line, and about builds a sentence when the islander wrote none', () => {
  assert.equal(D.traitsLine(['bold', 'curious']), 'bold and curious');
  assert.equal(D.traitsLine(['bold', 'curious', 'homebody']), `bold, curious and ${TRAITS.homebody.line}`);
  assert.equal(D.traitsLine(['bold', 'nonsense']), 'bold');
  assert.equal(D.aboutLine(pip), 'A bold, curious hen.');
  assert.equal(D.aboutLine({ species: 'goat', traits: ['shy', 'homebody'] }), 'A shy goat, and a homebody.');
  assert.equal(D.aboutLine({ species: 'sparrow', traits: ['homebody'] }), 'A sparrow, and a homebody.');
  assert.equal(D.aboutLine({ species: 'goat', traits: [] }), 'A goat.');
  assert.equal(D.aboutLine(bram), 'A stubborn goat.');
});

test('a run of the same small thing folds into one line with a count', () => {
  const story = [
    entry(10, { line: "Bram nudged at Max's door again, for the fourth time.", animal: 'animal:2' }),
    entry(9, { line: "Bram nudged at Max's door again.", animal: 'animal:2' }),
    entry(8, { line: "Bram nudged at Max's door.", animal: 'animal:2' }),
    entry(7, { line: "Bram nudged at Max's door.", animal: 'animal:1' }),     // another animal
    entry(6),
    entry(5),
    entry(4, { big: true, major: true, line: "Pip pecked about on Nova's doorstep. Pip and Nova are friends now." }),
    entry(3),
    entry(2, { line: 'Pip took a dust bath in the garden.' }),
    entry(1),
  ];
  const out = D.collapseStory(story);
  assert.deepEqual(out.map((e) => [e.seq, e.count]), [[10, 3], [7, 1], [6, 2], [4, 1], [3, 1], [2, 1], [1, 1]]);
  // The folded line keeps the newest words and knows where it ends, for "Earlier…".
  assert.equal(out[0].line, "Bram nudged at Max's door again, for the fourth time.");
  assert.equal(out[0].oldestSeq, 8);
  assert.deepEqual(out[0].seqs, [10, 9, 8]);
  // Big entries never fold, even two identical ones side by side.
  const bigs = D.collapseStory([entry(2, { big: true }), entry(1, { big: true })]);
  assert.equal(bigs.length, 2);
  // An arrival is big whatever `big` says.
  assert.equal(D.collapseStory([entry(2, { kind: 'arrival' }), entry(1, { kind: 'arrival' })]).length, 2);
  // The islander's template, when it sends one, is the pattern: two wordings of one visit fold.
  const t = D.collapseStory([
    entry(2, { template: 'peck', resident: 'house:aaa', line: "Pip came scratching round Nova's front step." }),
    entry(1, { template: 'peck', resident: 'house:aaa', line: "Pip pecked about on Nova's doorstep." }),
  ]);
  assert.equal(t.length, 1);
  assert.equal(t[0].count, 2);
  // ... and the same template at another door does not.
  assert.equal(D.collapseStory([entry(2, { template: 'peck', resident: 'house:aaa' }), entry(1, { template: 'peck', resident: 'house:bbb' })]).length, 2);
  assert.deepEqual(D.collapseStory(null), []);
});

test('the rendered story says (×n) and escapes the islander\'s lines', () => {
  const html = D.renderStory([entry(3), entry(2), entry(1, { line: `Pip met ${nasty}.` })], { now: NOW, names: new Map([['animal:1', 'Pip']]) });
  assert.match(html, /\(×2\)/);
  assert.ok(!html.includes('<img'), 'markup in a story line reached the page');
  assert.match(html, /<b>Pip<\/b>/);
  assert.match(html, /data-goto="5,-1"/);
  // A line that already counts ("for the fourth time") gets no "(×3)" beside it: the words
  // count every visit, the × only this run, and together they contradict each other.
  const counted = D.renderStory([
    entry(3, { line: "Bram nudged at Max's door again, for the fourth time." }),
    entry(2, { line: "Bram nudged at Max's door again." }),
    entry(1, { line: "Bram nudged at Max's door." }),
  ], { now: NOW });
  assert.equal((counted.match(/<li/g) || []).length, 1);
  assert.doesNotMatch(counted, /×/);
  // A name with a replacement pattern in it is not a pattern.
  const odd = D.renderStory([entry(1, { line: 'Mr $& pecked.' })], { names: new Map([['animal:1', 'Mr $&']]) });
  assert.match(odd, /<b>Mr \$&amp;<\/b> pecked\./);
});

test('the return card: at most three, the most meaningful, told in order', () => {
  const story = [
    entry(20),                                                             // ordinary: never
    entry(19, { kind: 'vignette', line: 'While the island was quiet, Pip found a warm patch.' }),
    entry(18, { major: true, big: true }),
    entry(17, { kind: 'arrival', animal: 'animal:2', line: 'Bram the goat wandered in.' }),
    entry(16, { traces: ['trace:nest:animal:1'], big: true }),
    entry(15, { discovery: 'disc:1', big: true }),
    entry(14, { mystery: 'print', big: true }),
    entry(3, { mystery: 'find', big: true }),                             // before `since`
  ];
  const got = D.summaryItems(story, 10);
  assert.equal(got.length, 3);
  assert.deepEqual(got.map((i) => [i.seq, i.kind]), [[14, 'mystery'], [15, 'discovery'], [16, 'trace']]);
  // Nothing new: an empty card.
  assert.deepEqual(D.summaryItems(story, 20), []);
  // Only the quiet line after a long absence: that is what the card is for.
  assert.deepEqual(D.summaryItems([entry(30), entry(29, { kind: 'vignette', line: 'x' })], 0).map((i) => i.kind), ['vignette']);
  // Never asked before: everything counts, still three at most.
  assert.equal(D.summaryItems(story, null).length, 3);
  // The SSE news vocabulary is understood as it stands.
  assert.deepEqual(D.summaryItems([{ seq: 5, kind: 'major', line: 'x', where: null }, { seq: 4, kind: 'arrival', line: 'y' }], 0).map((i) => i.kind), ['arrival', 'major']);
  // Where comes through only when it is a place.
  assert.equal(D.summaryItems([entry(40, { major: true, where: ['a', 1] })], 0)[0].where, null);

  const card = D.renderSummary([...got, { seq: 99, line: 'a fourth', kind: 'major' }], { names: new Map([['animal:1', 'Pip']]) });
  assert.equal((card.match(/<li/g) || []).length, 3);
  assert.equal((card.match(/data-goto=/g) || []).length, 3);
});

test('the keeper\'s dossier: words, not numbers; escaped names; a life story that pages', () => {
  const doors = ['Ada', 'Bo', 'Cas', 'Dirk', 'Eva', 'Fenna', 'Gijs', 'Hanna', 'Ids', 'Jet', 'Kees', 'Lot'];
  const entries = doors.map((who, i) => entry(12 - i, { line: `Pip called on ${who}.` }));
  const html = D.renderAnimal(pip, { now: NOW, act: 'dust', entries, more: false, canResident: true, here: [6, -2] });
  noRaw(html);
  assert.ok(!html.includes('<img'), 'a settler name reached the page as markup');
  assert.match(html, /friends/);
  assert.match(html, /wary/);
  assert.match(html, /getting used to each other/);
  // Friends first, then the wary one, then the rest.
  assert.ok(html.indexOf('Nova') < html.indexOf('&lt;img') && html.indexOf('&lt;img') < html.indexOf('Max'));
  assert.match(html, /data-resident="house:aaa"/);
  assert.match(html, new RegExp(`Pip is ${HABIT_OF.dust}`));
  // Show on the island goes to where it stands now, not home.
  assert.match(html, /class="btn primary" data-goto="6,-2"/);
  // Eight of twelve shown, and a way to the rest.
  assert.equal((html.match(/<li class="[^"]*"><time>/g) || []).length, 8);
  assert.match(html, /data-earlier/);
  // Everything shown and nothing older: no button.
  const all = D.renderAnimal(pip, { now: NOW, entries: entries.slice(0, 5), more: false });
  assert.doesNotMatch(all, /data-earlier/);
  // ... but an islander with more to give gets one even under a full page.
  assert.match(D.renderAnimal(pip, { now: NOW, entries: entries.slice(0, 5), more: true }), /data-earlier/);
  // No handler for settlers: their names are not links.
  assert.doesNotMatch(D.renderAnimal(pip, { now: NOW }), /data-resident/);
  // An animal's own name is escaped too (it is the islander's data).
  assert.ok(!D.renderAnimal({ ...pip, name: nasty }, { now: NOW }).includes('<img'));
});

test('a visitor sees the public card, friends by the name their own copy gives them', () => {
  const herdAnimal = { id: 'animal:1', species: 'goat', name: 'Guus', traits: ['bold'], home: [1, 2], r: 1, about: null,
    friends: [{ who: 'house:s3', label: 'bonded' }, { who: 'house:s9', label: 'nemesis' }] };
  const html = D.renderPublic(herdAnimal, { island: `Isle ${nasty}`, nameOf: (w) => (w === 'house:s3' ? 'Ada' : null), act: 'butt' });
  assert.match(html, /Ada/);
  assert.match(html, /a settler/);                      // an unresolved friend has no invented name
  assert.match(html, /friends/);
  assert.match(html, /nemesis/);
  assert.ok(!html.includes('<img'));
  assert.doesNotMatch(html, /an-story|data-earlier/);   // no diary for a visitor
  assert.match(html, new RegExp(HABIT_OF.butt));
  // A resolver that throws is a settler with no name, not a broken card.
  assert.match(D.renderPublic(herdAnimal, { nameOf: () => { throw new Error('x'); } }), /a settler/);
});

test('a settler\'s dossier gets up to three animals that know them, by the word', () => {
  const s = { animals: [pip, bram, { ...pip, id: 'animal:3', name: 'Tjilp', species: 'sparrow' }, { ...pip, id: 'animal:4', name: 'Henny' }] };
  const html = D.residentSection('house:ccc', s);
  noRaw(html);
  assert.equal((html.match(/data-animal=/g) || []).length, 3);
  // The nemesis first: the strongest feeling leads.
  assert.ok(html.indexOf('Bram') < html.indexOf('Pip'));
  assert.match(html, /nemesis/);
  assert.match(html, /the goat/);
  assert.equal(D.residentSection('house:zzz', s), '');
  assert.equal(D.residentSection('house:aaa', null), '');
  const evil = D.residentSection('house:aaa', { animals: [{ ...pip, name: nasty }] });
  assert.ok(!evil.includes('<img'));
});

test('the journal shows the mystery as found things and a hint, never how far along it is', () => {
  const state = {
    enabled: true, seq: 30, more: true,
    animals: [pip, bram],
    pending: [],
    traces: [
      { id: 'trace:print:signal', kind: 'print', name: 'A strange three-toed print', animal: 'animal:1', resident: 'house:aaa', at: NOW - 2 * DAY, placed: { x: 3, z: 3, rot: 0 } },
      { id: 'trace:find:signal:1', kind: 'find', name: 'A brass button stamped with a lamp', animal: 'animal:2', resident: 'house:bbb', at: NOW - DAY, placed: null },
      { id: 'trace:find:signal:2', kind: 'find', name: 'A scrap of oilcloth, stiff with salt', animal: 'animal:1', resident: 'house:ccc', at: NOW - HOUR, placed: { x: 1, z: -1, rot: 2 } },
      { id: 'trace:nest:animal:1', kind: 'nest', name: "Pip's nest by Nova's door", animal: 'animal:1', resident: 'house:aaa', at: NOW - DAY, placed: null },
    ],
    discoveries: [{ id: 'disc:1', name: 'The birds\' house', line: 'Somebody has put up a feeder.', at: NOW - DAY, resident: 'house:aaa' }],
    mystery: { stage: 1, hint: 'Something with three toes has been about.', finds: [{ k: 1 }, { k: 2 }], startedAt: NOW - 2 * DAY, resolvedAt: null },
    story: [entry(30), entry(29), entry(28, { big: true, mystery: 'find' })],
  };
  const html = D.renderJournal(state, { now: NOW });
  noRaw(html);
  assert.match(html, /Something odd/);
  assert.match(html, /three toes has been about/);
  assert.match(html, /A brass button stamped with a lamp/);
  assert.match(html, /A scrap of oilcloth/);
  // No count of any kind near the mystery: not "2 of 3", not "2/3", not "stage".
  const mystery = html.slice(html.indexOf('an-mystery'), html.indexOf('</div>', html.indexOf('an-mystery')));
  assert.doesNotMatch(mystery, /\d\s*(of|\/)\s*\d|stage|clue \d/i);
  // The nest is an ordinary mark, not a clue, and says it has no spot yet.
  assert.ok(html.indexOf("Pip&#39;s nest") > html.indexOf('an-mystery'));
  assert.match(html, /still looking for a spot/);
  assert.match(html, /Somebody has put up a feeder/);
  // The cast, each a way into its dossier.
  assert.match(html, /data-animal="animal:1"/);
  assert.match(html, /data-animal="animal:2"/);
  // The diary folds, and the islander's `more` offers Earlier.
  assert.match(html, /\(×2\)/);
  assert.match(html, /data-earlier/);
  // Solved says so.
  assert.match(D.renderJournal({ ...state, mystery: { ...state.mystery, stage: 3, resolvedAt: NOW } }, { now: NOW }), /A mystery, solved/);
  // An island with no animals, one with the stories switched off, one not answered yet.
  assert.match(D.renderJournal({ enabled: true, animals: [] }), /No animal has made this island its home yet/);
  assert.match(D.renderJournal({ enabled: false }), /switched off/);
  assert.match(D.renderJournal(null), /Asking the island/);
});

test('a toast carries the islander\'s line, escaped, with a Show only where there is a place', () => {
  const t = D.toastHtml({ kind: 'arrival', line: `Pip met ${nasty}.`, where: [1, 2], animal: 'animal:1' }, { names: new Map([['animal:1', 'Pip']]) });
  assert.ok(!t.includes('<img'));
  assert.match(t, /New on the island/);
  assert.match(t, /data-show/);
  assert.doesNotMatch(D.toastHtml({ kind: 'major', line: 'x', where: null }), /data-show/);
});

test('dates are words for a villager, and a story merges by seq', () => {
  assert.equal(D.dayLabel(NOW - HOUR, NOW), 'today');
  assert.equal(D.dayLabel(NOW - DAY, NOW), 'yesterday');
  assert.match(D.dayLabel(NOW - 3 * DAY, NOW), /^on [A-Z][a-z]+day$/);
  assert.match(D.dayLabel(NOW - 30 * DAY, NOW), /^\d{1,2} [A-Z][a-z]{2}/);
  assert.equal(D.dayLabel(null, NOW), '');
  assert.equal(D.dayLabel('not a date', NOW), '');
  assert.match(D.timeLabel(NOW - HOUR, NOW), /^\d\d:\d\d$/);
  assert.equal(D.timeLabel(NOW - DAY, NOW), 'yesterday');
  assert.deepEqual(D.mergeStory([entry(3), entry(1)], [entry(2), entry(3)], null).map((e) => e.seq), [3, 2, 1]);
  assert.deepEqual(D.hoverOf(pip, 'fly'), { name: 'Pip', sub: `hen · ${HABIT_OF.fly}` });
});

test('the page and ui.js agree on the ids', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const id of ['animal-dossier', 'animal-dossier-name', 'animal-dossier-body', 'animal-journal', 'animal-journal-body',
    'animals-btn', 'animal-summary', 'animal-summary-list']) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html has no #${id}`);
  }
  // Each panel's ✕ names its own panel, so ui.js's generic data-close wiring shuts it.
  assert.match(html, /data-close="animal-dossier"/);
  assert.match(html, /data-close="animal-journal"/);
  // The chip starts hidden: an island with no animals offers no journal.
  assert.match(html, /id="animals-btn"[^>]*hidden/);
  const ui = readFileSync(new URL('../web/js/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /const SIDE = \[[^\]]*'animal-dossier'[^\]]*'animal-journal'[^\]]*\]/);
  assert.match(ui, /openSide, closeSide: close, syncPanels: syncSidebar/);
});
