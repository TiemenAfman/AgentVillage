// The four places a quest shows (Plans/schatkaarten.md, "Waar zie je je quests?"): the log
// panel's words, the pirate's window, the radar's ring and the mark over his head - and the wiring
// between the page, ui.js, keybinds.js and main.js that only a test reading the sources can hold.
// The logic is pure and runs under Node; nothing here needs a document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

assert.equal(globalThis.document, undefined);
const { createQuestLog } = await import('../web/js/quest-log.js');
const { renderLog, renderCard } = await import('../web/js/quest-panel.js');
const { pirateSpeech, pirateReply, giverSpeech, PIRATE_IDLE, CREW_NOT_YET } = await import('../web/js/pirate.js');
const { markScale, MARK_LIFT } = await import('../web/js/quest-mark.js');
const { questOnRadar, QUEST_RING, projectToRadar } = await import('../web/js/minimap.js');
const { ACTIONS, keysOf, canon } = await import('../web/js/keybinds.js');
const { cardOf, FIRST_HUNT_SEED } = await import('../shared/treasure.mjs');
const { isletsNear } = await import('../shared/islets.mjs');

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const FLEET = [{ id: '0000000000000000', origin: [0, 0], gridSize: 192, reach: 96, volcano: true }, { id: 'a', origin: [336, 0], gridSize: 64, reach: 192 }];
const CARD = cardOf(FIRST_HUNT_SEED('a'), 'a', { candidates: isletsNear(FLEET, [0, 0], { range: 1500 }), berth: [336, 0] });
const book = () => createQuestLog({ storage: memory(), cardFor: () => CARD });

// ---- the log ---------------------------------------------------------------------------

test('the log names the quest, its steps with the current one marked, and the pirate waiting', () => {
  const log = book();
  const html = renderLog(log.view());
  assert.match(html, /The First Dig/);
  assert.match(html, /<li class="now">Talk to the pirate at his sea chest<\/li>/);
  assert.match(html, /The pirate at his sea chest is waiting/);
  assert.match(html, /Reward: Shovel/);
  assert.match(html, /No map in your pocket/);
  log.onTalked('pirate');
  const later = renderLog(log.view());
  assert.match(later, /<li class="done">Talk to the pirate at his sea chest<\/li>/);
  assert.match(later, /<li class="now">Dig up the buried treasure<\/li>/);
  assert.doesNotMatch(later, /pirate at his sea chest is waiting/);
  // The gold mine's line stands beside it, its goldsmith waiting from the start.
  assert.match(later, /Into the Mine/);
  assert.match(later, /The goldsmith is waiting/);
  assert.match(later, new RegExp(`Square ${CARD.grid}`));
});

test('finished quests are listed with their rewards, and the repeatable one says how often', () => {
  const log = book();
  log.onTalked('pirate'); log.onDug('statue'); log.onLifted(); log.onBoarded(); log.onDelivered(); log.onTalked('pirate');
  const html = renderLog(log.view());
  assert.match(html, /<b>The First Dig<\/b>/);
  assert.match(html, /<b>Bring It Home<\/b>[^<]*<span class="muted">Sea green/);
  // The story goes into the Kraken; the day's chest counts beside it, under Also.
  assert.match(html, /A Round for the Crew/);
  assert.match(html, /Captain Spack Jarrow is waiting for you in the Salty Kraken/);
  assert.match(html, /<h3 class="ql-h">Also<\/h3>[\s\S]*Treasure of the Day/);
  log.onDug('chest');
  assert.match(renderLog(log.view()), /Treasure of the Day<\/b> <span class="muted">done 1×/);
  // Somebody the log has no words for is still somebody.
  assert.match(renderLog({ ...log.view(), active: { ...log.view().active, talk: 'cook' } }), /Somebody is waiting for you/);
});

test('a sleeping map says why, and the grid square is on the card either way', () => {
  const asleep = renderCard({ grid: 'K7', asleep: true });
  assert.match(asleep, /Square K7/);
  assert.match(asleep, /somebody's now/);
  assert.match(asleep, /class="ql-card asleep"/);
  assert.match(renderCard({ grid: 'C12', asleep: false }), /Square C12/);
  assert.match(renderCard(null), /No map/);
});

test('whatever storage held is escaped on the way to the screen', () => {
  const nasty = '<img src=x onerror="alert(1)">';
  const html = renderLog({
    active: { id: 'x', title: nasty, text: nasty, repeat: true, times: nasty, index: 0, count: 1, goal: nasty, say: nasty, talk: true, rewards: [nasty], steps: [{ goal: nasty, done: false, current: true }] },
    done: [{ id: 'y', title: nasty, text: nasty, rewards: [nasty] }],
    card: { grid: nasty, asleep: false },
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.equal(renderLog(null), '');
});

test('with the whole story told and nothing repeating the log says so instead of throwing', () => {
  const html = renderLog({ active: null, done: [], card: null });
  assert.match(html, /Nothing left to ask/);
});

// ---- the pirate ------------------------------------------------------------------------

test('the pirate pitches the quest and offers Accept; later he asks and offers Hand it over', () => {
  const log = book();
  const first = pirateSpeech(log.view());
  assert.equal(first.button, 'Accept');
  assert.equal(first.title, 'The First Dig');
  assert.match(first.lines[0], /share o' the plunder/);
  assert.match(first.hint, /He offers: Shovel/);
  log.onTalked('pirate'); log.onDug('statue'); log.onLifted(); log.onBoarded(); log.onDelivered();
  const last = pirateSpeech(log.view());
  assert.equal(last.button, 'Hand it over');
  assert.equal(last.hint, 'Tell the pirate it is done');
  log.onTalked('pirate');
  // With the story in the Kraken he sends you in; the captain has the Accept now.
  const out = pirateSpeech(log.view());
  assert.equal(out.button, null);
  assert.equal(out.lines[0], PIRATE_IDLE);
  const cap = giverSpeech(log.view(), 'captain', 'Savvy?');
  assert.equal(cap.button, 'Accept');
  assert.match(cap.lines[0], /So ye found the Kraken/);
  const cook = giverSpeech(log.view(), 'cook', 'Fish stew.');
  assert.equal(cook.button, null);
  assert.deepEqual(cook.lines, ['Fish stew.']);
  log.onTalked('captain');
  // The captain's own quest on a step that is not a word with him: he reminds you.
  assert.match(giverSpeech(log.view(), 'captain', 'Savvy?').lines[0], /Dry work/);
});

test('while the story is still the pirate\'s the crew send you to him, not an idle line', () => {
  const log = book();
  const cap = giverSpeech(log.view(), 'captain', 'Savvy?');
  assert.equal(cap.button, null);
  assert.deepEqual(cap.lines, [CREW_NOT_YET]);
  log.onTalked('pirate'); log.onDug('statue');
  assert.deepEqual(giverSpeech(log.view(), 'cook', 'Fish stew.').lines, [CREW_NOT_YET]);
});

test('jumpTo puts the book at a quest with the story before it told', () => {
  const log = book();
  assert.equal(log.jumpTo('no-such-quest'), false);
  assert.equal(log.jumpTo('a-round-for-the-crew'), true);
  assert.deepEqual(log.state().done, ['first-dig', 'bring-it-home']);
  assert.equal(giverSpeech(log.view(), 'captain', 'Savvy?').button, 'Accept');
  log.jumpTo('the-drowned-chart', 1);
  assert.equal(log.view().active.index, 1);
  assert.equal(log.businessWith(), null);
});

test('with nothing to hand over he only reminds you, and has no button', () => {
  const log = book();
  log.onTalked('pirate');
  const s = pirateSpeech(log.view());
  assert.equal(s.button, null);
  assert.match(s.lines[0], /Sail to the islet/);
  assert.match(s.hint, /Dig up the buried treasure/);
  assert.equal(pirateSpeech({ active: null }).button, null);
  assert.equal(pirateSpeech(null).button, null);
});

test('his reply to the button is the step he just finished saying, with what it earned', () => {
  const log = book();
  const before = log.view().active;
  const result = log.onTalked('pirate');
  const reply = pirateReply(before, result);
  assert.match(reply.lines[0], /Here be me shovel and a map/);
  assert.ok(reply.earned.some((l) => /Unlocked: Shovel/.test(l)));
  assert.equal(reply.title, 'The First Dig');
  assert.deepEqual(pirateReply(null, null), { title: 'The pirate', lines: [], earned: [] });
});

// ---- the radar and the chart -----------------------------------------------------------

test('the radar rings the spot at its true size and puts the X in the middle when it is in reach', () => {
  const near = questOnRadar(40, -30, 130, 65);
  assert.equal(near.inside, true);
  assert.equal(near.centred, true);
  assert.ok(Math.abs(near.ring - QUEST_RING * 65 / 130) < 1e-9, 'a ring of ten units, whatever the radar scale');
  const p = projectToRadar(40, -30, 130, 65);
  assert.equal(near.x, p.x);
  assert.equal(near.y, p.y);
  assert.equal(QUEST_RING, 10);
});

test('a spot just past the radar edge still shows the edge of its ring, but no X', () => {
  const edge = questOnRadar(135, 0, 130, 65);
  assert.equal(edge.inside, true);
  assert.equal(edge.centred, false);
  const far = questOnRadar(500, 500, 130, 65);
  assert.equal(far.inside, false);
  assert.ok(Math.hypot(far.x, far.y) <= 65 + 1e-9, 'the pin stays on the rim');
});

test('standing on the spot is a ring round the middle', () => {
  const on = questOnRadar(0, 0, 130, 65);
  assert.deepEqual([on.x, on.y, on.inside, on.centred], [0, 0, true, true]);
});

test('the chart and the radar draw a quest mark only from data that carries one', () => {
  const map = src('web/js/minimap.js');
  assert.match(map, /if \(data\.quest\)/);
  assert.equal((map.match(/if \(data\.quest\)/g) || []).length, 2, 'once for the radar, once for the chart');
  const main = src('web/js/main.js');
  assert.equal((main.match(/quest: questMarkData\(\)/g) || []).length, 2, 'minimapData and worldMapData both carry it');
});

// ---- the mark over his head --------------------------------------------------------------

test('the mark grows with distance so it can be read from the sky, and is capped', () => {
  assert.ok(markScale(0) > 0);
  assert.ok(markScale(50) > markScale(5));
  assert.ok(markScale(1e6) <= 2.4);
  assert.equal(markScale(-3), markScale(0));
  assert.ok(MARK_LIFT > 0.62, 'above the hover label');
});

// ---- the wiring ------------------------------------------------------------------------

test('K is the quest log: a rebindable action, a chip, an orbit key, and it is in the help', () => {
  const action = ACTIONS.find(([a]) => a === 'quests');
  assert.ok(action, 'no quests action');
  assert.equal(action[1], 'k');
  assert.deepEqual(keysOf('quests'), ['k', null]);
  assert.equal(canon('k'), 'k');
  // Nothing else has K by default.
  assert.equal(ACTIONS.filter(([, key, , key2]) => key === 'k' || key2 === 'k').length, 1);
  const html = src('web/index.html');
  assert.match(html, /id="quests-btn"[^>]*data-key="K"/);
  assert.match(html, /<kbd>K<\/kbd> quests/);
  assert.doesNotMatch(html, /id="quests-btn"[^>]*\bhidden\b/, 'quests are per browser, so the chip is always there');
  assert.match(src('web/js/main.js'), /k: 'quests-btn'/);
});

test('the log panel is a side panel: in the page, in ui.js\'s list, with its own close', () => {
  const html = src('web/index.html');
  for (const id of ['quest-log', 'quest-log-body']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /data-close="quest-log"/);
  assert.match(html, /id="quest-log"[^>]*hidden/);
  assert.match(src('web/js/ui.js'), /const SIDE = \[[^\]]*'quest-log'[^\]]*\]/);
});

test('the pirate is one of the page\'s panels and a keeper who speaks through his window', () => {
  const main = src('web/js/main.js');
  assert.match(main, /const PANELS = \(\) => \[[^\]]*state\.pirate[^\]]*\]/);
  assert.match(main, /it\.post === 'pirate'/);
  assert.match(main, /createPirate\(document\.body/);
  assert.match(main, /talk: \(\) => state\.quests\.onTalked\('pirate'\)/);
  // And the Kraken's crew, through the same window opened on each of them.
  assert.match(main, /const PANELS = \(\) => \[[^\]]*state\.crewTalk[^\]]*\]/);
  assert.match(main, /createQuestGiver\(document\.body/);
  assert.match(main, /onTalk: \(it\) => openCrewTalk\(it\)/);
});

test('the book hands its unlocks to unlocks.js and the treasure side has one door to report through', () => {
  const main = src('web/js/main.js');
  assert.match(main, /import \{ unlock \} from '\.\/unlocks\.js'/);
  assert.match(main, /createQuestLog\(\{\s*unlock,/);
  for (const m of ['dug', 'lifted', 'boarded', 'delivered', 'drank', 'dived']) assert.match(main, new RegExp(`${m}: \\(`), m);
  assert.match(main, /state\.questEvents = questEvents/);
});

test('the pirate window, the log and the book do not reach the network or storage on their own', () => {
  for (const f of ['pirate', 'quest-panel', 'quest-mark']) {
    const code = src(`web/js/${f}.js`).replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bfetch\(|localStorage|mine\(|sea\(/, f);
  }
});
