// The treasure hunt as this page plays it (Plans/schatkaarten.md): the bottle on the beach, the
// spot on the islet, the dig, the statue and the chest, and the statue's way home.
//
// This file is the rules and the bookkeeping and nothing that draws or touches the network:
// everything it needs comes in through `createTreasureHunt`'s arguments (the book, the walk, the
// view, the island's answers), which is what lets tests/treasure-hunt.test.mjs play a whole hunt
// with a Map for storage and a fake walker. web/js/treasure-site.js draws it; main.js wires it.
//
// What lives where (Plans/schatkaarten.md, "Twee lagen"):
//   this browser  promptholm.finds  - beside the book's `card`, and the book owns that key. The
//                                     keys here are `bottleDay` (the world day the bottle was
//                                     last opened), `dug` (map seeds already dug up: one chest
//                                     is never counted twice) and `statue` (where the statue
//                                     lies once it has been dug up, or wherever it was last set
//                                     down or let go of: Plans/schatkaarten.md, "Neerzetten en
//                                     laten vallen"). Every write reads the whole
//                                     object and writes it whole with only our own keys touched,
//                                     the way quest-log.js does for `card`, so neither loses
//                                     the other's.
//   the island    data/treasure.json - whether the statue stands in the town and how many chests
//                                     have been found; the keeper's page alone writes it.
import { hash32 } from 'shared/rng.mjs';
import { worldToScene, sceneToWorld } from 'shared/regions.mjs';
import { isletById, isletHeight } from 'shared/islets.mjs';
import {
  cardOf, bottleOf, bottleWashesUp, rewardOf, rowboatSpot, FIRST_HUNT_SEED, SHOVEL,
} from 'shared/treasure.mjs';
import { readFinds, FINDS_KEY, defaultStorage } from './quest-log.js';

// How long a dig takes, and how far from the X the shovel may land. The feet stand anywhere in
// `DIG_REACH` of the spot - walk.js puts the hole 0.6 ahead of them, and the body is turned to
// face the X first - so the hole is at most `DIG_REACH - 0.6` off it; the tolerance is that plus
// a little for a hole that was started from a step to one side.
export const DIG_SECONDS = 2.5;
export const DIG_REACH = 1.6;
export const DIG_TOLERANCE = 1.15;
// How near a bottle or a statue has to be for E.
export const PICKUP_REACH = 1.6;
// A spot within this of an islet's middle, past its radius, counts as on that islet: a statue set
// down or washed up on its beach.
export const ISLET_SLACK = 4;
// The radius round the town's centre where the statue may be set down: the square and the
// streets that leave it.
export const SQUARE_REACH = 5.5;
// A chest that has been opened stays in the sand this long before it is gone.
export const CHEST_LINGER_S = 4;
// Beach cells within this many cells of the landing may hold the day's bottle.
export const BOTTLE_RADIUS = 4;
const DUG_KEEP = 200;
// The rowing boat at the islet (Plans/roeiboot-en-schat.md). Coming within ROWBOAT_CALL of the
// islet's shore with a map for it (or its statue still on it) lays our own boat out there, unless
// it lies within ROWBOAT_NEAR of that shore already. A statue in the arms goes into any rowing boat
// we may take that the body walks into, within the hull's reach (main.js: her bow plus a hand).
export const ROWBOAT_CALL = 45;
export const ROWBOAT_NEAR = 12;
// How near a ship's ladder foot the rowing boat must lie for E to hoist the statue up it, and how
// near the statue on her deck the body must stand to lower it into the rowing boat again.
export const HOIST_REACH = 1.6;
export const LOWER_REACH = 1.8;

// ---- this browser's part of promptholm.finds -----------------------------------------------

const isDay = (n) => Number.isInteger(n) && Math.abs(n) < 1e9;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

// Where the statue lies once it has been dug up, as it comes back from storage: strict about
// every field the page reads, because it is a place anybody can edit. `spot` is in the world's
// frame - an islet never moves - except with `local`, set down on this page's own island, where it
// is in the island's own (scene) coordinates: the island keeps those whatever berth it is given.
// `isletId` is the islet she lies on, or null on an island (set down, or dropped, off every islet) -
// ours (`local`) or anybody's, a starter's or a neighbour's beach (the world's frame: islands never move).
// `afloat` is she floats there on water deep enough to dive in (walk.js letGo): `y` is then the still
// surface, and the view puts her on the swell.
export function parseStatue(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { islandId, isletId, spot, y } = raw;
  if (isletId !== null && (typeof isletId !== 'string' || !isletId || isletId.length > 200)) return null;
  if (!spot || !finite(spot.x) || !finite(spot.z) || !finite(y)) return null;
  const out = { islandId: typeof islandId === 'string' ? islandId : null, isletId, spot: { x: spot.x, z: spot.z }, y };
  if (raw.local === true) out.local = true;
  if (raw.afloat === true) out.afloat = true;
  return out;
}

// `storage` is getItem/setItem/removeItem, as quest-log.js takes it. What could not be written
// is kept in memory for this page, and read together with what could.
export function createFinds(storage = defaultStorage()) {
  const memory = { bottleDay: null, dug: new Set(), statue: undefined };
  function save(change) {
    const finds = readFinds(storage);
    change(finds);
    try { storage.setItem(FINDS_KEY, JSON.stringify(finds)); return true; } catch { return false; }
  }
  const dugList = () => {
    const list = readFinds(storage).dug;
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : [];
  };
  return {
    bottleDay() {
      const d = readFinds(storage).bottleDay;
      const stored = isDay(d) ? d : null;
      return stored != null && memory.bottleDay != null ? Math.max(stored, memory.bottleDay) : (stored ?? memory.bottleDay);
    },
    markBottle(day) {
      if (!isDay(day)) return false;
      memory.bottleDay = day;
      return save((f) => { f.bottleDay = day; });
    },
    hasDug: (seed) => memory.dug.has(seed) || dugList().includes(seed),
    markDug(seed) {
      if (typeof seed !== 'string' || !seed) return false;
      memory.dug.add(seed);
      return save((f) => {
        const list = Array.isArray(f.dug) ? f.dug.filter((s) => typeof s === 'string') : [];
        if (!list.includes(seed)) list.push(seed);
        f.dug = list.slice(-DUG_KEEP);
      });
    },
    statue() {
      if (memory.statue !== undefined) return memory.statue;
      return parseStatue(readFinds(storage).statue);
    },
    setStatue(record) {
      const clean = record ? parseStatue(record) : null;
      memory.statue = clean;
      return save((f) => { if (clean) f.statue = clean; else delete f.statue; });
    },
  };
}

// ---- the bottle ------------------------------------------------------------------------------

// The world days on which somebody worked: one per house with a last-active time. `dayOf` is the
// page's (ms) => world day, so it turns over at the world's midnight and not this machine's.
export function workDays(houses, dayOf) {
  const days = new Set();
  for (const h of houses || []) {
    if (!h || (h.kind !== 'house' && h.kind !== 'camp')) continue;
    const ms = Date.parse(h.lastAt);
    if (Number.isFinite(ms)) days.add(dayOf(ms));
  }
  return days;
}

// The beach cells near the landing that the day's bottle may lie on, as [gx, gz]. Sand only:
// a bottle on a plank or a lawn is a mistake, and a cell with no beach near the landing means
// no bottle rather than one in the water.
export function landingCells(terrain, landing, radius = BOTTLE_RADIUS) {
  const out = [];
  if (!terrain || !Array.isArray(landing) || landing.length < 2) return out;
  const [lx, lz] = landing;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const gx = lx + dx, gz = lz + dz;
      if (terrain.inGrid(gx, gz) && terrain.isBeach(gx, gz)) out.push([gx, gz]);
    }
  }
  return out;
}

// May a bottle be opened now? A map in hand blocks a second one - unless it is asleep, which is
// a map to nowhere - and so does the first hunt, whose map the pirate hands over and whose
// place a bottle's map would take. The shovel is the other condition: a map is no use without
// one, and the pirate is who gives it.
export function bottleAllowed({ card, active, shovel }) {
  if (!shovel) return false;
  if (active && active.id === 'first-dig') return false;
  if (!card) return true;
  return card.status === 'asleep' && !String(card.seed).startsWith('first-hunt');
}

// ---- where things are ------------------------------------------------------------------------

// A map's spot in scene coordinates, with the height of the ground there. The islet is worked
// out from the id alone, so it is found even while the fleet has taken it away.
export function pointOfCard(card, home) {
  const islet = isletById(card.isletId);
  if (!islet || !home) return null;
  const local = card.local || { x: card.spot.x - islet.x, z: card.spot.z - islet.z };
  const [x, z] = worldToScene([card.spot.x, card.spot.z], home);
  return { x, z, y: isletHeight(islet, local.x, local.z) };
}

// Turned a different way at every spot, the same way on every screen.
const turnOf = (seed) => ((hash32(String(seed)) % 628) / 100);

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// ---- the hunt --------------------------------------------------------------------------------

// Everything it needs from the page, as functions so the page's state is read when it is used:
//   quests        the book (quest-log.js): card(), setCard(), view()
//   events        main.js's questEvents: dug / lifted / boarded / delivered (toasts included)
//   finds         createFinds()
//   unlocks       { isUnlocked, unlocked, unlock } (unlocks.js)
//   walk          the walker: state.pos/yaw, dig, digProgress, digged, carrying, cargo, lift,
//                 putDown, putOnBoat
//   view          treasure-site.js: setBottle, setSites, setMound, dust
//   home()        [x, z] the berth in the world's frame, or null while unknown
//   islandId()    the island this page shows
//   islets()      every islet in the world (isletsNear), or null while the fleet is unknown
//   village()     village.json: island.landing, island.town, buildings, treasure
//   terrain()     the island's terrain
//   clock()       { day } the world's today
//   dayOf(ms)     a moment's world day
//   groundAt(x,z) the ground under a point
//   keeper()      may this page write to the island (treasure.json)
//   read/post     GET the island's treasure state / POST an action; both resolve to the
//                 answer or null (a refusal, no islander, a broken answer)
//   toast(html)   a line for the player
//   onChange()    the interactables changed: rebuild the walker's list
//   refetchVillage() after the statue is placed, so its record appears
//   rowboat       optional, the boats (main.js): mine() our own rowing boat or null, launch(x, z,
//                 yaw) lays it in the water there, hulls() every rowing boat we may take, reach
//                 how near one has to be to walk the statue into it, ladders() every ship's
//                 ladder foot { ship, ladder, x, z }, cargoAt(ship) where the statue stands on her
//                 deck { x, z }, hoist(ship, ladder) and lower(ship) - true when it happened
export function createTreasureHunt(deps) {
  const {
    quests, events, finds, unlocks, walk, view, home, islandId, islets, village, terrain, clock,
    dayOf, groundAt, keeper, read, post, toast, onChange, refetchVillage, rowboat = null,
  } = deps;

  let bottle = null;          // { id, day, seed, cell, x, y, z } lying on the beach, or null
  let sites = [];             // what is in the sand on the islets: statue / chest, buried / unearthed
  let dragAt = null;           // where a harpoon's line has the loose statue this frame (drag), or null
  let signature = '';
  let digging = null;         // { site, hole } while the shovel is going
  let busy = false;           // a delivery is with the island
  const linger = [];          // chests opened a moment ago: { site, until }
  let daysCache = { houses: null, days: new Set() };
  let clockNow = 0;

  const say = (html) => { try { toast(html); } catch { /* the toast is not the hunt's */ } };
  const carried = () => !!(walk.carrying() || walk.cargo());
  const aboard = () => (walk.aboard ? walk.aboard() : null);
  // The statue on a hull, and which.
  const statueOn = () => { const c = walk.cargo(); return c && c.item === 'statue' ? c.hull : null; };
  const placedNow = () => !!(village() && village().treasure && village().treasure.placed);

  // ---- what stands where ----
  function computeBottle() {
    const v = village(), t = terrain();
    if (!v || !v.island || !v.island.landing || !t) return null;
    if (!islets()) return null;   // no fleet yet, no islet for the map to point at
    if (!bottleAllowed({ card: quests.card(), active: quests.view().active, shovel: unlocks.isUnlocked(SHOVEL) })) return null;
    const day = clock().day;
    if (finds.bottleDay() === day) return null;
    if (daysCache.houses !== v.buildings) daysCache = { houses: v.buildings, days: workDays(v.buildings, dayOf) };
    if (!bottleWashesUp(day, daysCache.days)) return null;
    const found = bottleOf(islandId() || 'open-sea', day, landingCells(t, v.island.landing));
    if (!found) return null;
    const [x, z] = t.cellWorld(found.cell[0], found.cell[1]);
    return { ...found, x, z, y: groundAt(x, z) };
  }

  function computeSites() {
    const h = home();
    if (!h) return [];
    const id = islandId() || 'open-sea';
    const list = islets();
    // A statue on an island (isletId null) is there for as long as the island is; one on an islet
    // only while the fleet still holds that islet.
    const has = (isletId) => isletId === null || (!!list && list.some((i) => i.id === isletId));
    const placed = placedNow();
    const out = [];

    // The statue, once dug up and until it is placed: lying on the sand, waiting to be lifted.
    // Gone from the ground while somebody carries it or it rides a boat.
    let rec = finds.statue();
    if (placed && rec) { finds.setStatue(null); rec = null; }
    if (rec && rec.islandId === id && has(rec.isletId) && !carried()) {
      const [x, z] = rec.local ? [rec.spot.x, rec.spot.z] : worldToScene([rec.spot.x, rec.spot.z], h);
      const site = { id: 'statue', kind: 'statue', stage: 'unearthed', x, y: rec.y, z, rot: turnOf('statue'), seed: null };
      if (rec.afloat) site.afloat = true;
      // On a harpoon's line: where the line has her this frame (drag).
      if (dragAt) { site.x = dragAt.x; site.y = dragAt.y; site.z = dragAt.z; if (dragAt.afloat) site.afloat = true; else delete site.afloat; }
      out.push(site);
    }

    // The map in hand.
    const card = quests.card();
    if (card && card.status === 'awake' && !finds.hasDug(card.seed) && has(card.isletId)) {
      const p = pointOfCard(card, h);
      if (p) {
        const first = String(card.seed).startsWith('first-hunt');
        // The unique statue lies under the first hunt's X until it is placed; after that the
        // spot holds an ordinary chest, so a second browser's map is not a hole in the ground.
        const kind = first && !placed && !rec ? 'statue' : 'chest';
        out.push({ id: kind === 'statue' ? 'statue' : `chest:${card.seed}`, kind, stage: 'buried', ...p, rot: turnOf(card.seed), seed: card.seed });
      }
    }
    for (const l of linger) out.push(l.site);
    return out;
  }

  function refresh() {
    bottle = computeBottle();
    sites = computeSites();
    view.setBottle(bottle);
    view.setSites(sites);
    const sig = JSON.stringify([bottle && bottle.id, sites.map((s) => [s.id, s.stage]), carried(), placedNow(), !!digging]);
    if (sig !== signature) { signature = sig; if (onChange) onChange(); }
  }

  // ---- the walker's list ----
  function interactables() {
    const out = [];
    if (bottle) {
      out.push({ id: 'treasure:bottle', kind: 'bottle', treasure: true, x: bottle.x, z: bottle.z, r: PICKUP_REACH, label: 'a bottle', prompt: 'open the bottle' });
    }
    for (const site of sites) {
      if (site.stage === 'buried') {
        if (digging) continue;   // the shovel is going: the prompt would only stand in the way
        out.push({
          id: `treasure:dig:${site.id}`, kind: 'dig', treasure: true, site, x: site.x, z: site.z, r: DIG_REACH,
          label: 'the X',
          get prompt() { return unlocks.isUnlocked(SHOVEL) ? 'dig here' : 'you need a shovel - ask the pirate'; },
        });
      } else if (site.kind === 'statue' && site.stage === 'unearthed' && !carried()) {
        out.push({ id: 'treasure:lift', kind: 'lift', treasure: true, site, x: site.x, z: site.z, r: PICKUP_REACH, label: 'the statue', prompt: 'lift the statue' });
      }
    }
    const v = village();
    if (walk.carrying() === 'statue' && !placedNow() && v && v.island && v.island.town && v.island.town.centre && terrain()) {
      // The square is crowded - a board, a fountain, the hall - and the walker takes the nearest thing
      // in reach. With a statue in the arms nothing else matters as much, so while the walker is
      // anywhere in the square this is where they stand: distance 0, and E sets her down.
      const [cx, cz] = terrain().cellWorld(v.island.town.centre[0], v.island.town.centre[1]);
      const inSquare = () => { const p = walk.state.pos; return dist(p.x, p.z, cx, cz) <= SQUARE_REACH; };
      out.push({
        id: 'treasure:deliver', kind: 'deliver', treasure: true, r: SQUARE_REACH, label: 'the square',
        prompt: 'set the statue down in the square',
        get x() { return inSquare() ? walk.state.pos.x : Infinity; },
        get z() { return inSquare() ? walk.state.pos.z : Infinity; },
      });
    }
    return out;
  }

  // ---- E ----
  function interact(it) {
    if (!it || !it.treasure) return false;
    if (it.kind === 'bottle') takeBottle();
    else if (it.kind === 'dig') startDig(it.site);
    else if (it.kind === 'lift') liftStatue();
    else if (it.kind === 'deliver') deliver();
    else if (it.kind === 'hoist') hoist(it);
    else if (it.kind === 'lower') lower(it);
    return true;
  }

  function takeBottle() {
    if (!bottle) return;
    const card = cardOf(bottle.seed, islandId() || 'open-sea', {
      candidates: islets() || undefined, berth: home() || [0, 0], day: bottle.day,
    });
    if (!card) { say('The bottle holds nothing but salt water. Not a single islet to point at.'); return; }
    finds.markBottle(bottle.day);
    quests.setCard(card);
    say(`A map in the bottle! It marks square <b>${card.grid}</b>. <b>M</b> shows the chart.`);
    refresh();
  }

  function startDig(site) {
    if (digging || !site) return;
    if (!unlocks.isUnlocked(SHOVEL)) { say('You need a shovel to dig. The pirate at the tavern has one.'); return; }
    const p = walk.state.pos;
    // Face the X, so the hole (walk.js puts it a step ahead of the feet) lands on it.
    if (dist(p.x, p.z, site.x, site.z) > 0.05) walk.state.yaw = Math.atan2(site.x - p.x, site.z - p.z);
    if (!walk.dig(DIG_SECONDS)) {
      // Both hands full is walk.js's own toast (onBlocked); the rest is a body that is not standing
      // still on dry ground, and the X is often a step from the water.
      if (!walk.carrying()) say('Stand still on dry sand to dig.');
      return;
    }
    digging = { site };
    refresh();
  }

  // Where the heap of sand goes: beside the hole, on the walker's right.
  function moundAt(yaw) {
    const p = walk.state.pos;
    const hx = p.x + Math.sin(yaw) * 0.6, hz = p.z + Math.cos(yaw) * 0.6;
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    return { x: hx + rx * 0.5, z: hz + rz * 0.5, y: groundAt(hx + rx * 0.5, hz + rz * 0.5), hole: [hx, hz] };
  }

  function onDigDone(x, z) {
    const d = digging;
    digging = null;
    if (!d) return;
    const site = d.site;
    // The last shovelful is thrown on the frame that finishes the dig, before frame() has looked.
    const m = moundAt(walk.state.yaw);
    for (let i = walk.digged(); i > 0; i--) view.dust(m.hole[0], groundAt(m.hole[0], m.hole[1]), m.hole[1], 10);
    if (dist(x, z, site.x, site.z) > DIG_TOLERANCE) {
      view.setMound(null, 0);
      say('Nothing here but sand. The X is a little further on.');
      refresh();
      return;
    }
    view.setMound({ x: m.x, y: m.y, z: m.z }, 1);
    view.keepMound();   // the heap beside the hole stays for a while
    if (site.kind === 'statue') unearthStatue(site);
    else openChest(site);
  }

  function onDigCancelled() {
    if (!digging) return;
    digging = null;
    view.setMound(null, 0);
    refresh();
  }

  function unearthStatue(site) {
    const id = islandId() || 'open-sea';
    finds.markDug(site.seed);
    const card = quests.card();
    const world = card ? { x: card.spot.x, z: card.spot.z } : null;
    if (world) finds.setStatue({ islandId: id, isletId: card.isletId, spot: world, y: site.y });
    events.dug('statue');   // takes the map that led here
    say('The shovel rings on gold! A <b>statue</b> lies in the sand. <b>E</b> lifts it.');
    refresh();
  }

  function openChest(site) {
    finds.markDug(site.seed);
    const reward = rewardOf(site.seed, unlocks.unlocked());
    if (reward.id) unlocks.unlock(reward.id);
    if (keeper()) Promise.resolve(post('found')).catch(() => null);
    if (String(site.seed).startsWith('first-hunt') && placedNow()) {
      // The first map of a second browser, on an island whose statue somebody already brought home:
      // the X holds a chest (computeSites), and the story this browser is on waits for a statue
      // that is not there to dig, lift or carry. It is told what happened instead - dug, and the
      // whole of Bring It Home up to the word with the pirate - so the book goes on (it skips the
      // carrying, Plans/roeiboot-en-schat.md). Late events are what reportDelivered already says.
      events.dug('statue');
      reportDelivered();
      say('The statue already stands in the square: somebody brought her home before you. Tell the pirate.');
    } else events.dug('chest');   // clears the map
    if (reward.kind === 'doubloons') say(`The chest holds ${reward.amount} doubloons and nothing else you do not have.`);
    else say(`A chest! Inside: <b>${reward.name}</b>. It is in your bag now.`);
    // The map is gone, so the site would go with it: keep the open chest in the sand a moment.
    // Same id, other stage: the view lifts it out of the sand instead of drawing a second chest.
    const shown = { ...site, stage: 'open' };
    linger.push({ site: shown, until: clockNow + CHEST_LINGER_S });
    refresh();
  }

  // The hands let go of her (walk.js onLetGo): set down with H, or slipped out of them in deep water,
  // a fall or a death. Wherever it was, `at` is dry ground (scene coordinates, the ground's height) or,
  // with `at.afloat`, deep water's surface where she floats, and that is where she lies now - kept in
  // the finds like the spot she was dug up at, so a reload
  // finds her there, and the island told she is not carried any more ('dropped': lifted -> buried,
  // lib/treasure.mjs). The quest does not move: the book waits at whichever step it was on, and the
  // next lift is a late 'lifted' it ignores.
  const LET_GO_WORDS = {
    set: 'You set the statue down. <b>E</b> lifts her again.',
    water: 'You go under, and the statue slips from your arms. She lies on the shore you came from.',
    fall: 'You land hard, and the statue tumbles out of your arms. <b>E</b> lifts her again.',
    die: 'The statue stays behind where you fell. She will wait for you.',
    home: 'The statue stays behind where you stood. She will wait for you.',
  };
  // The same, when she ended up afloat on deep water.
  const FLOAT_WORDS = {
    set: 'You let her go, and the statue <b>floats</b> on the swell. <b>E</b> beside her lifts her again.',
    water: 'You go under, and the statue slips from your arms. She <b>floats</b> where you went in.',
    fall: 'You land hard, and the statue tumbles out of your arms. She <b>floats</b> on the swell.',
    die: 'The statue floats where you went down. She will wait for you.',
    home: 'The statue floats where you left her. She will wait for you.',
  };
  function letGo(item, at) {
    if (item !== 'statue' || !at || !finite(at.x) || !finite(at.z) || !finite(at.y)) return false;
    const rec = recordAt(at);
    if (rec) finds.setStatue(rec);
    if (keeper()) Promise.resolve(post('dropped')).catch(() => null);
    if (rec) say((rec.afloat && FLOAT_WORDS[at.why]) || LET_GO_WORDS[at.why] || LET_GO_WORDS.set);
    else say('The statue slips from your arms, and goes back to where she lay.');
    refresh();
    return true;
  }
  // Where she lies, as the finds keep it: on our own island in its own frame, anywhere else (an islet,
  // a starter, a neighbour's beach) in the world's, with the islet she is on if any. With no berth
  // known there is no world frame: null, and her old spot stands - she goes back to where she lay,
  // never nowhere.
  function recordAt(at) {
    const id = islandId() || 'open-sea';
    const h = home();
    const t = terrain();
    const own = !!islandId() && t && finite(t.half) && Math.abs(at.x) <= t.half && Math.abs(at.z) <= t.half;
    let rec = null;
    if (own) rec = { islandId: id, isletId: null, spot: { x: at.x, z: at.z }, y: at.y, local: true };
    else if (h) {
      const [wx, wz] = sceneToWorld([at.x, at.z], h);
      const islet = (islets() || []).find((i) => dist(wx, wz, i.x, i.z) <= i.r + ISLET_SLACK);
      rec = { islandId: id, isletId: islet ? islet.id : null, spot: { x: wx, z: wz }, y: at.y };
    }
    if (rec && at.afloat === true) rec.afloat = true;
    return rec;
  }

  // ---- on a harpoon's line (Plans/harpoen.md) ----
  // The statue as she lies loose - not carried, not on a boat, not in the square - in the scene:
  // what a harpoon can hook. While a line drags her, `drag` moves her every frame without writing
  // anything (only the view and computeSites see it); `dragEnd` keeps the spot she ended at, as a
  // set-down would, and `reelAboard` lays her on the ship the line brought her to, as hoisting does.
  function loose() {
    if (carried() || placedNow()) return null;
    const s = sites.find((o) => o.id === 'statue' && o.stage === 'unearthed');
    return s ? { x: s.x, y: s.y, z: s.z, afloat: !!s.afloat } : null;
  }
  function drag(at) {
    if (!at || !finite(at.x) || !finite(at.z) || !finite(at.y)) return;
    dragAt = { x: at.x, y: at.y, z: at.z, afloat: !!at.afloat };
    sites = computeSites();
    view.setSites(sites);
  }
  function dragEnd() {
    if (!dragAt) return;
    const rec = recordAt(dragAt);
    dragAt = null;
    if (rec) finds.setStatue(rec);
    refresh();
  }
  function reelAboard(hull) {
    if (!hull || carried() || !walk.takeAsCargo || !walk.takeAsCargo('statue', hull)) return false;
    dragAt = null;
    if (keeper()) Promise.resolve(post('lifted')).catch(() => null);
    reportBoarded();
    say('Hauled aboard on the harpoon\'s line! The statue is on the deck. Now sail her home.');
    refresh();
    return true;
  }

  function liftStatue() {
    if (!walk.lift('statue')) return;
    if (keeper()) Promise.resolve(post('lifted')).catch(() => null);
    events.lifted('statue');
    say('Two hands, and slow. She is heavy. A boat, and home.');
    refresh();
  }

  // ---- the boat and the square ----
  // Late events are caught up on first: the book ignores one that is not the step it waits for,
  // so a statue carried straight into a boat (the dock's own E) must still be "lifted".
  function reportBoarded() { events.lifted('statue'); events.boarded('statue'); }
  function reportDelivered() { events.lifted('statue'); events.boarded('statue'); events.delivered('statue'); }

  // E at a boat with the statue in the arms, or walking into one with her (touchRowboat).
  function layOnBoat(hull) {
    if (walk.carrying() !== 'statue' || !hull) return false;
    if (!walk.putOnBoat(hull)) return false;
    reportBoarded();
    say('You lay the statue in the rowing boat. Steady now. <b>E</b> to climb in.');
    refresh();
    return true;
  }

  // ---- the rowing boat at the islet, and the ship's ladder ----
  // The islet the hunt is about: the one the statue lies on, else the one the map points at.
  function huntIslet() {
    const id = islandId() || 'open-sea';
    const rec = finds.statue();
    // Set down on an island she needs no rowing boat called to an islet.
    if (rec && rec.islandId === id && !placedNow()) return rec.isletId ? { isletId: rec.isletId, at: rec.spot } : null;
    const card = quests.card();
    if (card && card.status === 'awake' && !finds.hasDug(card.seed)) return { isletId: card.isletId, at: card.spot };
    return null;
  }
  let nextCall = 0;
  function callRowboat(seconds) {
    if (!rowboat || seconds < nextCall) return;
    nextCall = seconds + 1;
    const h = home(), hunt = huntIslet();
    if (!h || !hunt) return;
    const islet = isletById(hunt.isletId);
    if (!islet) return;
    const [cx, cz] = worldToScene([islet.x, islet.z], h);
    const p = walk.state.pos;
    if (dist(p.x, p.z, cx, cz) > islet.r + ROWBOAT_CALL) return;
    const mine = rowboat.mine();
    // Never from under somebody in it, nor with the statue in it: she goes where the boat goes.
    if (mine && (mine === aboard() || mine === statueOn())) return;
    if (mine && dist(mine.x, mine.z, cx, cz) < islet.r + ROWBOAT_NEAR) return;
    const spot = rowboatSpot(islet, { x: hunt.at.x - islet.x, z: hunt.at.z - islet.z });
    if (!spot) return;
    const [x, z] = worldToScene([spot.x + islet.x, spot.z + islet.z], h);
    if (rowboat.launch(x, z, Math.atan2(spot.bow[0], spot.bow[1]))) {
      say('A little <b>rowing boat</b> lies ready off the islet. Walk the statue into it.');
    }
  }
  // With the statue in the arms and the feet at a rowing boat: she goes into it, no key needed.
  function touchRowboat() {
    if (!rowboat || walk.carrying() !== 'statue' || aboard()) return;
    const p = walk.state.pos;
    for (const hull of rowboat.hulls()) {
      if (dist(p.x, p.z, hull.x, hull.z) <= rowboat.reach) { layOnBoat(hull); return; }
    }
  }
  // Afloat in a rowing boat with the statue in it, at a ship's ladder: E takes her up.
  function afloat() {
    const row = aboard();
    if (!rowboat || !row || statueOn() !== row) return [];
    let best = null;
    for (const l of rowboat.ladders()) {
      const d = dist(row.x, row.z, l.x, l.z);
      if (d <= HOIST_REACH && (!best || d < best.d)) best = { ...l, d };
    }
    if (!best) return [];
    return [{ id: 'treasure:hoist', kind: 'hoist', treasure: true, ship: best.ship, ladder: best.ladder,
      x: row.x, z: row.z, r: 99, label: 'the ship', prompt: 'hoist the statue aboard' }];
  }
  // On a ship's deck with the statue on it, beside her: E lowers her into the rowing boat.
  function onDeck(deck) {
    const ship = deck && deck.boat;
    if (!rowboat || !ship || statueOn() !== ship) return [];
    if (!rowboat.cargoAt(ship)) return [];
    // Read where she stands each time it is asked: the ship moves under the list.
    const at = () => rowboat.cargoAt(ship) || { x: Infinity, z: Infinity };
    return [{ id: 'treasure:lower', kind: 'lower', treasure: true, ship, r: LOWER_REACH,
      get x() { return at().x; }, get z() { return at().z; },
      label: 'the statue', prompt: 'lower the statue into the rowing boat' }];
  }
  function hoist(it) {
    if (!rowboat || !rowboat.hoist(it.ship, it.ladder)) return;
    say('Up she goes. The statue is on the deck; the rowing boat waits at the ladder.');
    refresh();
  }
  function lower(it) {
    if (!rowboat || !rowboat.lower(it.ship)) return;
    say('Down she goes, into the rowing boat. Row her ashore.');
    refresh();
  }

  // walk.board() puts the statue on the hull by itself for somebody who steps aboard with it.
  // main.js asks whether that just happened.
  function boardedWith(hadCargo) {
    if (!hadCargo && walk.cargo()) { reportBoarded(); refresh(); return true; }
    return false;
  }

  async function deliver() {
    if (!keeper()) { say('Only whoever lives on this island can set the statue down here.'); return; }
    if (busy) return;
    busy = true;
    let answer = null;
    try { answer = await post('placed'); } catch { answer = null; }
    busy = false;
    if (!answer || answer.ok === false || answer.statue !== 'placed') {
      say('The statue will not stay put: the island did not answer. Try again.');
      return;
    }
    walk.putDown();
    finds.setStatue(null);
    reportDelivered();
    say('The statue stands in the square. <b>Everyone</b> can see it now, and what you find is counted on its plinth.');
    try { await refetchVillage(); } catch { /* the next scan brings it */ }
    refresh();
  }

  // The statue is unique, so a page that closed mid-voyage must not have lost it: whatever was
  // 'lifted' when this page loads goes back on its islet (lib/treasure.mjs).
  async function boot() {
    if (!keeper()) return;
    let state = null;
    try { state = await read(); } catch { state = null; }
    if (state && state.statue === 'lifted') {
      try { await post('dropped'); } catch { /* the next load tries again */ }
    }
    refresh();
  }

  // ---- every frame ----
  let lastDay = null, lastHands = '';
  function frame(dt, seconds = 0) {
    clockNow = seconds;
    // The hands change under us as well (walk.js unboard() hands the statue back when a boat lands,
    // a swim or a fall may end it): the sand and the square follow what they hold.
    const hands = `${walk.carrying()}|${!!walk.cargo()}`;
    if (hands !== lastHands) { lastHands = hands; refresh(); }
    for (let i = linger.length - 1; i >= 0; i--) if (seconds >= linger[i].until) { linger.splice(i, 1); refresh(); }
    callRowboat(seconds);
    touchRowboat();
    // The day turning over brings the next bottle (or takes the old one out to sea).
    const day = clock().day;
    if (day !== lastDay) { lastDay = day; refresh(); }
    const progress = digging ? walk.digProgress() : null;
    if (progress != null) {
      const m = moundAt(walk.state.yaw);
      view.setMound({ x: m.x, y: m.y, z: m.z }, progress);
      for (let i = walk.digged(); i > 0; i--) view.dust(m.hole[0], groundAt(m.hole[0], m.hole[1]), m.hole[1], 10);
    }
    view.update(dt);
  }

  return {
    refresh, interactables, interact, onDigDone, onDigCancelled, frame, boot, layOnBoat, boardedWith, afloat, onDeck, letGo,
    loose, drag, dragEnd, reelAboard,
    // Read by tests and by main.js's boat prompt.
    bottle: () => bottle, sites: () => sites, digging: () => !!digging,
  };
}
