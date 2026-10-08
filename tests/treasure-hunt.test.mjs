// The treasure hunt as one page plays it (web/js/treasure.js): the day's bottle, the X on an islet,
// the dig, the chest and the statue's voyage from the sand to the square, with the quest book, the
// finds in storage and the unlocks all real, and only the walker, the drawing and the island's
// answers faked. tests/treasure-walk.test.mjs runs the same hunt on the real walk mode; the rules
// of the map itself are tests/treasure.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// DOM-free on purpose, like the book it is built on: a stub needed here means the rules reached
// into the page.
assert.equal(globalThis.document, undefined);
const T = await import('../web/js/treasure.js');
const { createQuestLog, FINDS_KEY, QUESTS_KEY } = await import('../web/js/quest-log.js');
const U = await import('../web/js/unlocks.js');
const { isletsNear } = await import('../shared/islets.mjs');
const { worldTime } = await import('../shared/worldclock.mjs');
const { worldToScene } = await import('../shared/regions.mjs');
const { cardOf, FIRST_HUNT_SEED } = await import('../shared/treasure.mjs');

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
};

const ISLAND = 'a';
const HOME = [336, 0];
const FLEET = [
  { id: '0000000000000000', origin: [0, 0], gridSize: 192, reach: 96, volcano: true },
  { id: ISLAND, origin: HOME, gridSize: 64, reach: 192 },
];
const ISLETS = isletsNear(FLEET, [0, 0], { range: 1500 });
const NOON = Date.UTC(2026, 8, 29, 12, 0);
const DAY = 86400000;
const dayOf = (ms) => worldTime(ms, 0).day;

// A 200-cell island whose beach is the ring at 8 cells from the landing; the town's centre at 110.
const terrain = {
  inGrid: () => true,
  isBeach: (gx, gz) => Math.hypot(gx - 100, gz - 100) >= 3 && Math.hypot(gx - 100, gz - 100) <= 4,
  cellWorld: (gx, gz) => [gx - 100 + 0.5, gz - 100 + 0.5],
};
const villageOf = (over = {}) => ({
  island: { landing: [100, 100], town: { centre: [110, 110] } },
  buildings: [{ kind: 'house', lastAt: new Date(NOON).toISOString() }],
  treasure: { placed: false, found: 0 },
  ...over,
});

// A walker that keeps the books the hunt reads: hands, a dig that runs when told to.
function fakeWalk() {
  let carry = null, cargo = null, dig = null, flung = 0;
  const w = {
    state: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    calls: [],
    carrying: () => carry,
    cargo: () => cargo,
    // The hull we are in, as walk.js's `aboard()` says it; set by the test.
    vehicle: null,
    aboard: () => w.vehicle,
    setCargo(c) { cargo = c; },
    lift(item) { if (carry || cargo) return false; carry = item; return true; },
    putDown() { const c = carry; carry = null; return c; },
    putOnBoat(hull) { if (!carry) return false; cargo = { item: carry, hull }; carry = null; return true; },
    takeOffBoat() { if (!cargo) return false; carry = cargo.item; cargo = null; return true; },
    dig(seconds) { w.calls.push(['dig', seconds]); if (dig || carry) return false; dig = { t: 0, total: seconds }; return true; },
    digProgress: () => (dig ? dig.t / dig.total : null),
    digged() { const n = flung; flung = 0; return n; },
    // The test plays the walker's part: time passing, shovelfuls flung and the dig ending.
    tick(s) { if (dig) dig.t = Math.min(dig.total, dig.t + s); },
    fling() { flung++; },
    finish() { dig = null; },
  };
  return w;
}

function fakeView() {
  const log = { bottle: [], sites: [], mound: [], kept: 0, dust: [], updates: 0 };
  return {
    log,
    setBottle: (b) => log.bottle.push(b),
    setSites: (s) => log.sites.push(s.map((x) => ({ ...x }))),
    setMound: (at, k) => log.mound.push([at, k]),
    keepMound: () => { log.kept++; },
    dust: (...a) => log.dust.push(a),
    update: () => { log.updates++; },
    lastSites: () => log.sites[log.sites.length - 1] || [],
    lastBottle: () => log.bottle[log.bottle.length - 1] || null,
  };
}

// One page: a book with the storage behind it, the unlocks, and a hunt on a fake walker.
function page({ keeper = true, now = NOON, village = villageOf(), answer = null, rowboat = null } = {}) {
  U.resetUnlocks();
  const storage = memory();
  const toasts = [], posts = [];
  const clockState = { now };
  const walk = fakeWalk();
  const view = fakeView();
  const changes = { n: 0 };
  let hunt;
  const log = createQuestLog({
    storage,
    unlock: U.unlock,
    cardFor: (name) => (name === 'first-hunt'
      ? cardOf(FIRST_HUNT_SEED(ISLAND), ISLAND, { candidates: ISLETS, berth: HOME }) : null),
    onChange: () => { if (hunt) hunt.refresh(); },
  });
  const events = {
    dug: (k) => log.onDug(k), lifted: (k) => log.onLifted(k), boarded: (k) => log.onBoarded(k), delivered: (k) => log.onDelivered(k),
  };
  const vil = { current: village };
  const fetches = { n: 0 };
  hunt = T.createTreasureHunt({
    quests: log, events, finds: T.createFinds(storage),
    unlocks: { isUnlocked: U.isUnlocked, unlocked: U.unlocked, unlock: U.unlock },
    walk, view,
    home: () => HOME, islandId: () => ISLAND, islets: () => ISLETS,
    village: () => vil.current, terrain: () => terrain,
    clock: () => worldTime(clockState.now, 0), dayOf,
    groundAt: () => 0.5,
    keeper: () => keeper,
    read: async () => (answer && answer.read) || { statue: 'buried' },
    post: async (action) => {
      posts.push(action);
      if (answer && answer.post === null) return null;
      return { ok: true, statue: action === 'placed' ? 'placed' : action === 'lifted' ? 'lifted' : 'buried' };
    },
    toast: (html) => toasts.push(html),
    onChange: () => { changes.n++; },
    refetchVillage: async () => { fetches.n++; vil.current = { ...vil.current, treasure: { placed: true, found: 0 } }; },
    rowboat,
  });
  return {
    hunt, log, storage, walk, view, toasts, posts, clockState, changes, fetches, village: vil,
    // E on whatever `kind` is within the list.
    press(kind) {
      const it = hunt.interactables().find((i) => i.kind === kind);
      assert.ok(it, `there is something to ${kind} (has: ${hunt.interactables().map((i) => i.kind).join(', ') || 'nothing'})`);
      hunt.interact(it);
      return it;
    },
    // The dig, played through: the walker stands `off` from the X on the side it is facing.
    async dig(site, off = 1.0) {
      const it = hunt.interactables().find((i) => i.kind === 'dig');
      assert.ok(it, 'there is an X to dig at');
      walk.state.pos.x = site.x - off; walk.state.pos.z = site.z;
      hunt.interact(it);
      assert.equal(walk.calls.at(-1)[0], 'dig');
      // Facing the X: (sin, cos) of the yaw points along +x from here.
      assert.ok(Math.abs(Math.sin(walk.state.yaw) - 1) < 1e-9);
      walk.fling(); walk.tick(2.5); hunt.frame(0.016, 0);
      walk.finish();
      hunt.onDigDone(walk.state.pos.x + Math.sin(walk.state.yaw) * 0.6, walk.state.pos.z + Math.cos(walk.state.yaw) * 0.6);
    },
  };
}
// The whole story up to the day's bottles: the pirate's two chapters and the Salty Kraken's three
// (Plans/piratenkroeg.md), the last of which counts three of the day's chests.
function storyTold(p) {
  p.log.applyEvent({ type: 'talked', with: 'pirate' });
  p.log.applyEvent({ type: 'dug', kind: 'statue' });
  p.log.clearCard();
  p.log.applyEvent({ type: 'lifted', kind: 'statue' });
  p.log.applyEvent({ type: 'boarded', kind: 'statue' });
  p.log.applyEvent({ type: 'delivered', kind: 'statue' });
  p.log.applyEvent({ type: 'talked', with: 'pirate' });
  for (const ev of [{ type: 'talked', with: 'captain' }, { type: 'drank', where: 'piratetavern' }, { type: 'talked', with: 'captain' },
    { type: 'talked', with: 'navigator' }, { type: 'dived', depth: 2 }, { type: 'talked', with: 'navigator' },
    { type: 'talked', with: 'bosun' }, { type: 'dug', kind: 'chest' }, { type: 'dug', kind: 'chest' }, { type: 'dug', kind: 'chest' },
    { type: 'talked', with: 'bosun' }]) p.log.applyEvent(ev);
  assert.equal(p.log.view().active.id, 'treasure-of-the-day');
  p.hunt.refresh();
}

// ---- the storage ---------------------------------------------------------------------------

test('the finds are our own keys beside the book\'s card, and neither loses the other\'s', () => {
  const storage = memory();
  const finds = T.createFinds(storage);
  const log = createQuestLog({ storage });
  const card = cardOf('bottle:a:1', ISLAND, { candidates: ISLETS, berth: HOME, day: 1 });
  log.setCard(card);
  finds.markBottle(20000);
  finds.markDug('bottle:a:1');
  finds.setStatue({ islandId: ISLAND, isletId: card.isletId, spot: card.spot, y: 0.5 });
  const raw = JSON.parse(storage.getItem(FINDS_KEY));
  assert.deepEqual(Object.keys(raw).sort(), ['bottleDay', 'card', 'dug', 'statue']);
  // The book writing its card again keeps ours; ours writing keeps the card.
  log.clearCard();
  const after = JSON.parse(storage.getItem(FINDS_KEY));
  assert.equal(after.card, undefined);
  assert.equal(after.bottleDay, 20000);
  assert.deepEqual(after.dug, ['bottle:a:1']);
  finds.markBottle(20001);
  log.setCard(card);
  assert.equal(JSON.parse(storage.getItem(FINDS_KEY)).bottleDay, 20001);
  assert.equal(JSON.parse(storage.getItem(FINDS_KEY)).card.seed, 'bottle:a:1');
});

test('the finds survive broken storage, keep what they cannot write in memory, and never throw', () => {
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('full'); }, removeItem() {} };
  const finds = T.createFinds(broken);
  assert.equal(finds.bottleDay(), null);
  assert.equal(finds.markBottle(5), false);
  assert.equal(finds.bottleDay(), 5, 'remembered for this page');
  finds.markDug('x');
  assert.equal(finds.hasDug('x'), true);
  finds.setStatue({ islandId: 'a', isletId: 'islet:1:1', spot: { x: 1, z: 2 }, y: 0.4 });
  assert.equal(finds.statue().isletId, 'islet:1:1');
  const junk = T.createFinds(memory({ [FINDS_KEY]: '{not json' }));
  assert.equal(junk.statue(), null);
  assert.equal(junk.hasDug('x'), false);
  // Edited by hand into nonsense: a statue with no place is no statue.
  const edited = T.createFinds(memory({ [FINDS_KEY]: JSON.stringify({ statue: { isletId: 'x', spot: { x: 'a' }, y: 1 }, dug: [1, 'ok'], bottleDay: 'today' }) }));
  assert.equal(edited.statue(), null);
  assert.equal(edited.hasDug('ok'), true);
  assert.equal(edited.bottleDay(), null);
});

test('only sand near the landing can hold a bottle, and only a working day brings one', () => {
  const cells = T.landingCells(terrain, [100, 100]);
  assert.ok(cells.length > 8);
  for (const [gx, gz] of cells) assert.ok(terrain.isBeach(gx, gz));
  assert.deepEqual(T.landingCells(terrain, null), []);
  assert.deepEqual(T.landingCells({ inGrid: () => true, isBeach: () => false }, [1, 1]), []);
  const days = T.workDays([
    { kind: 'house', lastAt: new Date(NOON).toISOString() },
    { kind: 'house', lastAt: new Date(NOON - 3 * DAY).toISOString() },
    { kind: 'civic', lastAt: new Date(NOON - 9 * DAY).toISOString() },
    { kind: 'house', lastAt: 'never' },
  ], dayOf);
  assert.deepEqual([...days].sort(), [dayOf(NOON - 3 * DAY), dayOf(NOON)].sort());
});

test('a map to nowhere may be replaced by a bottle, the first hunt\'s map may not, and no shovel is no bottle', () => {
  const awake = { status: 'awake', seed: 'bottle:a:1' };
  assert.equal(T.bottleAllowed({ card: null, active: { id: 'treasure-of-the-day' }, shovel: true }), true);
  assert.equal(T.bottleAllowed({ card: null, active: { id: 'treasure-of-the-day' }, shovel: false }), false);
  assert.equal(T.bottleAllowed({ card: null, active: { id: 'first-dig' }, shovel: true }), false, 'the pirate\'s map comes first');
  assert.equal(T.bottleAllowed({ card: awake, active: null, shovel: true }), false);
  assert.equal(T.bottleAllowed({ card: { ...awake, status: 'asleep' }, active: null, shovel: true }), true);
  assert.equal(T.bottleAllowed({ card: { status: 'asleep', seed: 'first-hunt:a' }, active: null, shovel: true }), false);
});

// ---- the bottle -------------------------------------------------------------------------------

test('the bottle: none before the story is told, one on a working day after it, one per day', () => {
  const p = page();
  assert.equal(p.hunt.bottle(), null, 'no shovel, no bottle');
  p.log.applyEvent({ type: 'talked', with: 'pirate' });
  p.hunt.refresh();
  assert.ok(p.log.card().seed.startsWith('first-hunt'), 'the pirate\'s map is in hand');
  assert.equal(p.hunt.bottle(), null, 'and it is not to be replaced');
  storyTold(p);
  const b = p.hunt.bottle();
  assert.ok(b, 'a bottle on the beach');
  const [x, z] = terrain.cellWorld(b.cell[0], b.cell[1]);
  assert.deepEqual([b.x, b.z], [x, z]);
  assert.ok(terrain.isBeach(b.cell[0], b.cell[1]));
  assert.deepEqual(p.view.lastBottle().id, b.id);
  assert.ok(p.hunt.interactables().some((i) => i.kind === 'bottle'));

  p.press('bottle');
  assert.equal(p.hunt.bottle(), null, 'the bottle is gone once opened');
  const card = p.log.card();
  assert.equal(card.seed, b.seed);
  assert.equal(card.day, b.day);
  assert.ok(p.toasts.at(-1).includes(card.grid));
  // Not again today, and a bottle is not a second map while the first is in hand.
  p.hunt.refresh();
  assert.equal(p.hunt.bottle(), null);
  // The next working day brings the next one - once the first map is dealt with.
  p.log.clearCard();
  p.clockState.now = NOON + DAY;
  p.village.current = villageOf({ buildings: [{ kind: 'house', lastAt: new Date(NOON + DAY).toISOString() }] });
  p.hunt.refresh();
  assert.ok(p.hunt.bottle(), 'tomorrow, a new bottle');
  assert.notEqual(p.hunt.bottle().id, b.id);
});

test('no bottle on a day nobody worked, and none where there is no beach', () => {
  const p = page({ village: villageOf({ buildings: [{ kind: 'house', lastAt: new Date(NOON - 2 * DAY).toISOString() }] }) });
  storyTold(p);
  assert.equal(p.hunt.bottle(), null);
  const q = page({ village: villageOf({ island: { landing: null, town: null } }) });
  storyTold(q);
  assert.equal(q.hunt.bottle(), null);
});

test('the day turning over brings the bottle without anybody asking', () => {
  const p = page();
  storyTold(p);
  p.press('bottle');
  p.log.clearCard();
  p.hunt.frame(0.016, 0);
  assert.equal(p.hunt.bottle(), null);
  p.clockState.now = NOON + DAY;
  p.village.current = villageOf({ buildings: [{ kind: 'house', lastAt: new Date(NOON + DAY).toISOString() }] });
  p.hunt.frame(0.016, 1);
  assert.ok(p.hunt.bottle());
});

// ---- a chest ----------------------------------------------------------------------------------

function chestPage(opts = {}) {
  const p = page(opts);
  storyTold(p);
  p.press('bottle');
  p.log.card();
  return p;
}

test('a map draws an X on its islet, in scene coordinates, and E there digs', () => {
  const p = chestPage();
  const site = p.hunt.sites().find((s) => s.kind === 'chest');
  assert.ok(site, 'the map\'s X');
  const card = p.log.card();
  assert.deepEqual([site.x, site.z], worldToScene([card.spot.x, card.spot.z], HOME));
  assert.equal(site.stage, 'buried');
  const it = p.hunt.interactables().find((i) => i.kind === 'dig');
  assert.equal(it.prompt, 'dig here');
  assert.equal(it.r, T.DIG_REACH);
});

test('the dig: the walker turns to the X, and a chest opens with its find in the bag and on the plinth', async () => {
  const p = chestPage();
  const site = p.hunt.sites()[0];
  const seed = p.log.card().seed;
  assert.equal(U.isUnlocked('captain-red') || U.isUnlocked('sea-green'), true, 'the story\'s own reward is in already');
  const before = U.unlocked().length;
  await p.dig(site);
  assert.ok(p.view.log.dust.length >= 1, 'a shovelful was flung');
  assert.equal(p.view.log.kept, 1, 'the heap stays beside the hole');
  assert.equal(p.log.card(), null, 'the map is spent');
  const now = p.hunt.sites();
  assert.equal(now.length, 1);
  assert.equal(now[0].stage, 'open', 'the chest is lying open in the sand');
  assert.equal(now[0].id, site.id, 'the same chest, so the view lifts it out instead of drawing another');
  assert.deepEqual(p.posts, ['found'], 'the island counts one');
  assert.ok(U.unlocked().length >= before, 'a find never takes anything away');
  assert.ok(p.toasts.some((t) => /chest/i.test(t)));
  // The chest leaves after a moment; the map does not come back and there is nothing to dig.
  p.hunt.frame(0.016, T.CHEST_LINGER_S + 1);
  assert.equal(p.hunt.sites().length, 0);
  assert.equal(p.hunt.interactables().some((i) => i.kind === 'dig'), false);
  // The same seed could not be dug again even if the map were put back.
  p.log.setCard(cardOf(seed, ISLAND, { candidates: ISLETS, berth: HOME }));
  p.hunt.refresh();
  assert.equal(p.hunt.sites().length, 0, 'a dug chest is never dug twice');
});

test('a visitor digs the same chest but the island is told nothing', async () => {
  const p = chestPage({ keeper: false });
  await p.dig(p.hunt.sites()[0]);
  assert.deepEqual(p.posts, []);
  assert.equal(p.hunt.sites()[0].stage, 'open');
});

test('a hole beside the X finds nothing, keeps the map and can be tried again', async () => {
  const p = chestPage();
  const site = p.hunt.sites()[0];
  const it = p.hunt.interactables().find((i) => i.kind === 'dig');
  p.walk.state.pos.x = site.x - 1; p.walk.state.pos.z = site.z;
  p.hunt.interact(it);
  p.walk.finish();
  p.hunt.onDigDone(site.x + 3, site.z);   // the shovel went in three cells off
  assert.ok(p.toasts.at(-1).includes('Nothing here'));
  assert.ok(p.log.card(), 'the map is still in hand');
  assert.deepEqual(p.posts, []);
  assert.equal(p.view.log.kept, 0);
  await p.dig(site);
  assert.deepEqual(p.posts, ['found']);
});

test('a cancelled dig takes the heap away and nothing else', () => {
  const p = chestPage();
  const site = p.hunt.sites()[0];
  p.walk.state.pos.x = site.x - 1; p.walk.state.pos.z = site.z;
  p.hunt.interact(p.hunt.interactables().find((i) => i.kind === 'dig'));
  assert.equal(p.hunt.digging(), true);
  p.walk.tick(1); p.hunt.frame(0.016, 0);
  assert.ok(p.view.log.mound.some(([at, k]) => at && k > 0 && k < 1), 'the heap grows with the dig');
  p.hunt.onDigCancelled('moved');
  assert.equal(p.hunt.digging(), false);
  assert.equal(p.view.log.mound.at(-1)[0], null);
  assert.ok(p.log.card());
  assert.deepEqual(p.posts, []);
});

test('without the shovel the X says where to get one and E only says so', () => {
  const p = page();
  // A map in hand from somewhere, but no shovel yet.
  p.log.setCard(cardOf('bottle:a:9', ISLAND, { candidates: ISLETS, berth: HOME, day: 9 }));
  p.hunt.refresh();
  const it = p.hunt.interactables().find((i) => i.kind === 'dig');
  assert.match(it.prompt, /shovel/);
  p.hunt.interact(it);
  assert.equal(p.walk.calls.length, 0, 'the walker was not asked to dig');
  assert.match(p.toasts.at(-1), /shovel/);
});

test('a dig the walker refuses says why, unless the refusal already spoke', () => {
  const p = chestPage();
  const site = p.hunt.sites()[0];
  const it = p.hunt.interactables().find((i) => i.kind === 'dig');
  p.walk.dig = () => false;   // in the water, moving, crouching...
  p.hunt.interact(it);
  assert.match(p.toasts.at(-1), /Stand still on dry sand/);
  assert.equal(p.hunt.digging(), false);
  const n = p.toasts.length;
  p.walk.lift('statue');      // both hands full: walk.js says so itself
  p.hunt.interact(it);
  assert.equal(p.toasts.length, n);
});

test('an islet under somebody\'s island has no X: the map sleeps', () => {
  const p = page();
  storyTold(p);
  p.press('bottle');
  assert.equal(p.hunt.sites().length, 1);
  p.log.setStatus('asleep');
  assert.equal(p.hunt.sites().length, 0);
  p.log.setStatus('awake');
  assert.equal(p.hunt.sites().length, 1);
});

// ---- the statue -------------------------------------------------------------------------------

function firstHunt(opts) {
  const p = page(opts);
  p.log.applyEvent({ type: 'talked', with: 'pirate' });
  p.hunt.refresh();
  return p;
}

test('the first hunt buries the statue, and digging it up leaves it lying there to be lifted', async () => {
  const p = firstHunt();
  const site = p.hunt.sites()[0];
  const card = p.log.card();
  assert.equal(site.kind, 'statue');
  assert.equal(site.stage, 'buried');
  assert.equal(p.hunt.interactables().some((i) => i.kind === 'lift'), false);
  await p.dig(site);
  assert.equal(p.log.card(), null, 'the first map is spent');
  assert.equal(p.log.view().active.id, 'bring-it-home', 'the story moved on');
  const lying = p.hunt.sites()[0];
  assert.equal(lying.kind, 'statue');
  assert.equal(lying.stage, 'unearthed');
  assert.equal(lying.id, site.id, 'the same figure rises out of the sand');
  assert.deepEqual(p.posts, [], 'digging her up costs the island nothing yet');
  // It is remembered: a page reloaded now still has her on the sand, with no map in hand.
  const kept = T.createFinds(p.storage).statue();
  assert.equal(kept.isletId, card.isletId);
  assert.deepEqual(kept.spot, card.spot);
  assert.equal(kept.islandId, ISLAND);
});

test('the statue\'s whole voyage: lift, lay on a boat, set down in the square - the island told each time it matters', async () => {
  const p = firstHunt();
  await p.dig(p.hunt.sites()[0]);
  p.press('lift');
  assert.equal(p.walk.carrying(), 'statue');
  assert.deepEqual(p.posts, ['lifted']);
  assert.equal(p.hunt.sites().length, 0, 'gone from the sand once she is in your arms');
  assert.equal(p.log.view().active.goal, 'Put the statue in the rowing boat');
  assert.ok(p.hunt.interactables().some((i) => i.kind === 'deliver'), 'the square offers to take her');
  assert.equal(p.hunt.interactables().some((i) => i.kind === 'lift'), false);

  // A boat: the statue leaves the arms for the hull.
  const hull = { id: 'boat:a' };
  assert.equal(p.hunt.layOnBoat(hull), true);
  assert.equal(p.walk.carrying(), null);
  assert.equal(p.walk.cargo().hull, hull);
  assert.equal(p.log.view().active.goal, 'Stand the statue in your town');
  assert.equal(p.hunt.interactables().some((i) => i.kind === 'deliver'), false, 'nothing to set down while she is on the boat');
  // Ashore, walk.js hands her back into the arms (unboard) - the hunt notices by itself.
  p.walk.takeOffBoat();
  p.hunt.frame(0.016, 0);
  const deliver = p.hunt.interactables().find((i) => i.kind === 'deliver');
  assert.ok(deliver, 'in the arms again, the square offers again');
  // Out of the square it is nowhere; in it, it is wherever the walker stands (so no board or fountain
  // there is nearer than it is).
  assert.equal(deliver.x, Infinity);
  const [cx, cz] = terrain.cellWorld(110, 110);
  p.walk.state.pos.x = cx + 3; p.walk.state.pos.z = cz - 2;
  assert.deepEqual([deliver.x, deliver.z], [cx + 3, cz - 2]);

  p.hunt.interact(deliver);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.posts, ['lifted', 'placed']);
  assert.equal(p.walk.carrying(), null, 'her arms are empty');
  assert.equal(p.fetches.n, 1, 'the village is fetched so the statue\'s record appears');
  assert.equal(T.createFinds(p.storage).statue(), null, 'and she is not on the islet any more');
  assert.equal(p.log.view().active.goal, 'Tell the pirate it is done');
  assert.equal(p.hunt.sites().length, 0);
  // Nothing left to lift or set down; the spent first map makes room for the day's bottle.
  assert.deepEqual(p.hunt.interactables().map((i) => i.kind), ['bottle']);
});

test('a statue carried straight into a boat by the dock counts as laid on it', async () => {
  const p = firstHunt();
  await p.dig(p.hunt.sites()[0]);
  p.press('lift');
  // walk.board() does this itself for whoever steps aboard with her.
  p.walk.putOnBoat({ id: 'boat:a' });
  assert.equal(p.hunt.boardedWith(false), true);
  assert.equal(p.log.view().active.goal, 'Stand the statue in your town');
  assert.equal(p.hunt.boardedWith(true), false, 'already aboard is nothing new');
});

test('only the keeper can set her down; a visitor is told so and keeps her', async () => {
  const p = firstHunt({ keeper: false });
  await p.dig(p.hunt.sites()[0]);
  p.press('lift');
  assert.deepEqual(p.posts, [], 'a visitor tells the island nothing');
  p.press('deliver');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.posts, []);
  assert.equal(p.walk.carrying(), 'statue');
  assert.match(p.toasts.at(-1), /Only whoever lives on this island/);
});

test('an island that does not answer leaves her in your arms, and the story where it was', async () => {
  const p = firstHunt({ answer: { post: null } });
  await p.dig(p.hunt.sites()[0]);
  p.press('lift');
  p.press('deliver');
  await new Promise((r) => setImmediate(r));
  assert.equal(p.walk.carrying(), 'statue');
  assert.match(p.toasts.at(-1), /did not answer/);
  assert.equal(p.log.view().active.goal, 'Put the statue in the rowing boat', 'not delivered, not reported');
  assert.ok(T.createFinds(p.storage).statue(), 'and still remembered');
});

test('skipping the boat does not strand the story: the late events are caught up', async () => {
  const p = firstHunt();
  await p.dig(p.hunt.sites()[0]);
  p.press('lift');
  p.press('deliver');
  await new Promise((r) => setImmediate(r));
  assert.equal(p.log.view().active.goal, 'Tell the pirate it is done');
});

test('once she stands in the town the spot holds an ordinary chest, and nothing is left to lift', () => {
  const p = firstHunt({ village: villageOf({ treasure: { placed: true, found: 3 } }) });
  const site = p.hunt.sites()[0];
  assert.equal(site.kind, 'chest');
  assert.ok(site.id.startsWith('chest:'));
});

test('boot: a statue left "lifted" by a page that closed goes back on its islet - the keeper\'s page only', async () => {
  const lifted = page({ answer: { read: { statue: 'lifted' } } });
  await lifted.hunt.boot();
  assert.deepEqual(lifted.posts, ['dropped']);
  const buried = page({ answer: { read: { statue: 'buried' } } });
  await buried.hunt.boot();
  assert.deepEqual(buried.posts, []);
  const visitor = page({ keeper: false, answer: { read: { statue: 'lifted' } } });
  await visitor.hunt.boot();
  assert.deepEqual(visitor.posts, []);
});

test('the interactables are rebuilt when the sand changes, and only then', () => {
  const p = page();
  p.hunt.refresh();
  const before = p.changes.n;
  p.hunt.refresh();
  p.hunt.refresh();
  assert.equal(p.changes.n, before, 'nothing changed');
  storyTold(p);
  assert.ok(p.changes.n > before, 'a bottle on the beach');
});

test('every stored map and note is read the way the book left it', () => {
  // The quest key holds the book; the hunt never writes it.
  const p = firstHunt();
  const book = p.storage.getItem(QUESTS_KEY);
  p.hunt.refresh();
  assert.equal(p.storage.getItem(QUESTS_KEY), book);
});

// ---- the rowing boat (Plans/roeiboot-en-schat.md) ------------------------------------------

const { isletById, isletHeight } = await import('../shared/islets.mjs');
const { rowboatSpot, ROW_DEPTH } = await import('../shared/treasure.mjs');

// The boats as main.js hands them over: our own rowing boat (null until laid out), what a statue in
// the arms walks into, one ship with a ladder foot wherever the test puts it.
function fakeBoats() {
  const b = {
    own: null, launched: [], hoisted: [], lowered: [], ladder: null, statueAt: null,
    mine: () => b.own,
    launch(x, z, yaw) { b.own = { id: 'boat:w-me', x, z, yaw, own: true }; b.launched.push([x, z, yaw]); return b.own; },
    hulls: () => (b.own ? [b.own] : []),
    reach: 1.2,
    ladders: () => (b.ladder ? [b.ladder] : []),
    cargoAt: () => b.statueAt,
    hoist(ship, ladder) { b.hoisted.push([ship, ladder]); return true; },
    lower(ship) { b.lowered.push(ship); return true; },
  };
  return b;
}
// The islet of the first map, in scene coordinates, and a point on it the walker can stand on.
function isletOf(p) {
  const card = p.log.card();
  const islet = isletById(card.isletId);
  const [x, z] = worldToScene([islet.x, islet.z], HOME);
  return { islet, card, x, z };
}

test('rowboatSpot lays her in water a body can wade to, bow to the X, the same on every page', () => {
  const islet = ISLETS[0];
  const from = { x: 0, z: 0 };
  const a = rowboatSpot(islet, from), b = rowboatSpot(islet, from);
  assert.deepEqual(a, b);
  assert.ok(isletHeight(islet, a.x, a.z) <= ROW_DEPTH, 'afloat');
  assert.ok(Math.hypot(a.x, a.z) < islet.r * 3, 'not out at sea');
  // The bow points back along the way out, at the X.
  const len = Math.hypot(a.x - from.x, a.z - from.z);
  assert.ok(Math.abs(a.bow[0] + (a.x - from.x) / len) < 1e-9 && Math.abs(a.bow[1] + (a.z - from.z) / len) < 1e-9);
});

test('coming to the islet with the map lays the rowing boat out there, once, and again if it was left far off', () => {
  const boats = fakeBoats();
  const p = firstHunt({ rowboat: boats });
  const { islet, card, x, z } = isletOf(p);
  // Far away: nothing.
  p.walk.state.pos.x = x + islet.r + 200; p.walk.state.pos.z = z;
  p.hunt.frame(0.016, 1);
  assert.equal(boats.launched.length, 0, 'not from across the sea');
  // Within reach of the shore: laid out at the spot the map's X gives, bow to the X.
  p.walk.state.pos.x = x + islet.r + 20;
  p.hunt.frame(0.016, 2);
  assert.equal(boats.launched.length, 1);
  const spot = rowboatSpot(islet, { x: card.spot.x - islet.x, z: card.spot.z - islet.z });
  const [sx, sz] = worldToScene([spot.x + islet.x, spot.z + islet.z], HOME);
  assert.ok(Math.abs(boats.own.x - sx) < 1e-9 && Math.abs(boats.own.z - sz) < 1e-9);
  assert.ok(Math.abs(boats.own.yaw - Math.atan2(spot.bow[0], spot.bow[1])) < 1e-9);
  assert.match(p.toasts.at(-1), /rowing boat/);
  // Lying there, it is not laid out again.
  p.hunt.frame(0.016, 4);
  assert.equal(boats.launched.length, 1);
  // Rowed off and left far away: back at the islet on the next visit.
  boats.own.x += 300;
  p.hunt.frame(0.016, 6);
  assert.equal(boats.launched.length, 2);
  // But never from under the oarsman, nor away with the statue in it.
  boats.own.x += 300;
  p.walk.vehicle = boats.own;
  p.hunt.frame(0.016, 8);
  assert.equal(boats.launched.length, 2, 'from under the oarsman');
  p.walk.vehicle = null;
  p.walk.setCargo({ item: 'statue', hull: boats.own });
  p.hunt.frame(0.016, 10);
  assert.equal(boats.launched.length, 2, 'away with the statue in it');
});

test('walking into the rowing boat with the statue lays her in it - no key - and E then boards', async () => {
  const boats = fakeBoats();
  const p = firstHunt({ rowboat: boats });
  await p.dig(p.hunt.sites()[0]);
  p.press('lift');
  boats.launch(p.walk.state.pos.x + 5, p.walk.state.pos.z, 0);
  p.hunt.frame(0.016, 20);
  assert.equal(p.walk.carrying(), 'statue', 'five off is not walking into it');
  p.walk.state.pos.x += 4.2;
  p.hunt.frame(0.016, 21);
  assert.equal(p.walk.carrying(), null);
  assert.equal(p.walk.cargo().hull, boats.own);
  assert.equal(p.log.view().active.goal, 'Stand the statue in your town');
  assert.match(p.toasts.at(-1), /rowing boat/);
});

test('at a ship\'s ladder E hoists the statue aboard, and beside her on the deck E lowers her again', async () => {
  const boats = fakeBoats();
  const p = firstHunt({ rowboat: boats });
  const ship = { id: 'boat:a' };
  const row = boats.launch(10, 10, 0);
  p.walk.vehicle = row;
  // No statue in the boat: nothing to hoist.
  boats.ladder = { ship, ladder: { x: 2.42 }, x: 10.5, z: 10 };
  assert.deepEqual(p.hunt.afloat(), []);
  p.walk.setCargo({ item: 'statue', hull: row });
  const [up] = p.hunt.afloat();
  assert.equal(up.kind, 'hoist');
  assert.equal(up.prompt, 'hoist the statue aboard');
  p.hunt.interact(up);
  assert.deepEqual(boats.hoisted, [[ship, boats.ladder.ladder]]);
  // Too far from the ladder: nothing.
  boats.ladder = { ship, ladder: { x: 2.42 }, x: 14, z: 10 };
  assert.deepEqual(p.hunt.afloat(), []);
  // On her deck with the statue on it: the offer stands where she does, and moves with the ship.
  p.walk.vehicle = null;
  p.walk.setCargo({ item: 'statue', hull: ship });
  boats.statueAt = { x: 3, z: 4 };
  const [down] = p.hunt.onDeck({ boat: ship });
  assert.equal(down.kind, 'lower');
  assert.deepEqual([down.x, down.z], [3, 4]);
  boats.statueAt = { x: 5, z: 4 };
  assert.equal(down.x, 5, 'read when asked');
  p.hunt.interact(down);
  assert.deepEqual(boats.lowered, [ship]);
  // Another ship's deck offers nothing.
  assert.deepEqual(p.hunt.onDeck({ boat: { id: 'boat:b' } }), []);
});

test('a second browser whose first map is dug after the statue stands goes on to the pirate', async () => {
  const p = firstHunt({ village: villageOf({ treasure: { placed: true, found: 1 } }) });
  assert.equal(p.log.view().active.id, 'first-dig');
  await p.dig(p.hunt.sites()[0]);
  assert.equal(p.log.view().active.id, 'bring-it-home', 'the first dig is done');
  assert.equal(p.log.view().active.goal, 'Tell the pirate it is done', 'nothing to carry: she is home already');
  assert.equal(p.walk.carrying(), null);
  assert.ok(p.toasts.some((t) => /already stands/.test(t)), 'and is told why');
});
