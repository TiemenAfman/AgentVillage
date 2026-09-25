// A crew on a boat, on the sea's side (lib/boats.mjs, lib/players.mjs - the groundwork for
// fase 4 to 6 of Plans/lopen-op-de-boot.md). No page sends any of this yet, and every boat is
// a Benchy with room for her pilot alone, so the first test holds that nothing a Benchy does
// has changed. The rest put a crew on a boat with room for five, handed in as `craftOf`
// because no island has one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoats, COAST_MS, frameOf } from '../lib/boats.mjs';
import { createRoster } from '../lib/players.mjs';
import { pilotsOf } from '../lib/hostility.mjs';
import { CRAFTS } from '../shared/crafts.mjs';
import { toWorld } from '../shared/deck.mjs';

const MOORINGS = [{ id: 'boat:home-jetty', x: 12, z: -30, yaw: 0.5 }];
const HULL = 'boat:home-jetty';
const ANN = 'a1b2c3d4e5f6', BEN = '0f0f0f0f0f0f', CAT = 'c0c0c0c0c0c0';
const SLOOP = {
  crew: 5, helm: [0, -1.5],
  deck: [{ x: 0, z: 0, hx: 1, hz: 2, y: 0 }],
  rails: [],
};
const sloop = () => SLOOP;
const beside = [12.5, -30];            // within reach of the mooring
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('a Benchy is still her pilot and nobody else, and says so in the shape it always did', () => {
  const boats = createBoats({ moorings: MOORINGS });
  const took = boats.take(HULL, ANN);
  assert.deepEqual(Object.keys(took).sort(), ['id', 'pilot', 'x', 'yaw', 'z'], 'a boat with no crew grew a field');
  assert.equal(boats.board(HULL, BEN, beside), null, 'a second body in a boat built for one');
  assert.equal(boats.take(HULL, BEN).pilot, ANN);
  // Nobody at the helm, somebody standing in her: the helm is on that deck, and it is full.
  boats.drop(HULL, ANN);
  assert.ok(boats.board(HULL, ANN, beside), 'aboard a boat nobody is steering');
  assert.equal(boats.take(HULL, BEN).pilot, null, 'took the helm of a full boat from the jetty');
  assert.equal(boats.take(HULL, ANN).pilot, ANN, 'the one aboard her can take her helm');
  assert.equal(CRAFTS.benchy.crew, 1);
});

test('a crew steps aboard from beside the hull, up to what the boat holds', () => {
  const boats = createBoats({ moorings: MOORINGS, craftOf: sloop });
  assert.equal(boats.board(HULL, ANN, [40, 40]), null, 'boarded a boat from across the island');
  const ids = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'].map((s) => s.padEnd(12, '0'));
  for (const id of ids.slice(0, 5)) assert.ok(boats.board(HULL, id, beside), `${id} could not board`);
  assert.equal(boats.board(HULL, ids[5], beside), null, 'a sixth aboard a boat for five');
  assert.equal(boats.snapshot()[0].crew.length, 5);
  assert.ok(boats.aboard(HULL, ids[0]) && !boats.aboard(HULL, ids[5]));
  // The helm is taken from the deck: aboard first, then the tiller.
  assert.equal(boats.take(HULL, ids[5]).pilot, null, 'took the helm from the jetty');
  assert.equal(boats.take(HULL, ids[0]).pilot, ids[0]);
  assert.equal(boats.snapshot()[0].crew.length, 4, 'the pilot is at the helm, not in the crew as well');
});

test('letting go of the tiller keeps you aboard, and the boat runs out its way under your hand', () => {
  const boats = createBoats({ moorings: MOORINGS, craftOf: sloop });
  boats.board(HULL, ANN, beside);
  boats.board(HULL, BEN, beside);
  boats.take(HULL, ANN);
  const t0 = 1_000_000;
  const let_ = boats.letGo(HULL, ANN, t0);
  assert.equal(let_.pilot, null);
  assert.ok(let_.crew.includes(ANN) && let_.crew.includes(BEN), 'letting go of the tiller put somebody ashore');
  assert.ok(boats.moved(HULL, ANN, 13, -30, 0.5, t0 + 1000), 'the hand that let go cannot bring her to a stop');
  assert.equal(boats.moved(HULL, BEN, 14, -30, 0.5, t0 + 1000), null, 'somebody who never had the tiller moved her');
  assert.equal(boats.moved(HULL, ANN, 15, -30, 0.5, t0 + COAST_MS + 1), null, 'still steering long after letting go');
  // Somebody else takes the helm, and the coast is theirs to end.
  assert.equal(boats.take(HULL, BEN).pilot, BEN);
  assert.equal(boats.moved(HULL, ANN, 16, -30, 0.5, t0 + 2000), null, 'two hands on one hull');
});

test('the crew stays where it stands when the pilot goes, and a crewed boat does not sail home', () => {
  const boats = createBoats({ moorings: MOORINGS, craftOf: sloop });
  boats.board(HULL, ANN, beside);
  boats.board(HULL, BEN, beside);
  boats.take(HULL, ANN);
  boats.moved(HULL, ANN, 40, -10, 1);
  const gone = boats.release(ANN);
  assert.equal(gone.length, 1);
  assert.deepEqual(gone[0].crew, [BEN], 'the crew went with the pilot');
  assert.equal(boats.driftHome(Date.now() + 60 * 60 * 1000).length, 0, 'sailed home with somebody standing on her');
  assert.ok(boats.leave(HULL, BEN));
  assert.equal(boats.driftHome(Date.now() + 60 * 60 * 1000).length, 1, 'an empty boat stayed away from home');
});

test('the guards and the lava leave a crew alone, as they leave a pilot', () => {
  const boats = createBoats({ moorings: MOORINGS, craftOf: sloop });
  boats.board(HULL, ANN, beside);
  boats.board(HULL, BEN, beside);
  boats.take(HULL, ANN);
  assert.deepEqual([...pilotsOf({ boats })].sort(), [BEN, ANN].sort());
});

// The roster, with a fake socket per player - the same shape tests/hostility.test.mjs uses.
function room() {
  const roster = createRoster({ moorings: MOORINGS, craftOf: sloop });
  const inbox = new Map();
  const join = (id) => {
    const conn = { id, send: (m) => inbox.get(id).push(JSON.parse(m)), close() {} };
    inbox.set(id, []);
    roster.attach(conn, {});
    return (msg) => roster.message(conn, JSON.stringify(msg));
  };
  return { roster, inbox, join };
}

test('a pose on a deck is taken from the crew only, held to the planks, and put in the world by the sea', () => {
  const { roster, inbox, join } = room();
  const ann = join(ANN), ben = join(BEN);
  // Ann walks up beside the hull and steps aboard.
  ann({ t: 'p', x: beside[0], y: 0, z: beside[1], yaw: 0, f: 0 });
  ann({ t: 'boat', a: 'board', id: HULL });
  // She says she is a little way up the deck - and her page's idea of where that is in the
  // world is well off, as a page a frame behind the hull's pilot always is.
  ann({ t: 'p', x: 999, y: 0.4, z: 999, yaw: 0, f: 0, on: HULL, d: [0.5, 0, 1, 0.2] });
  const a = roster.all().find((p) => p.id === ANN);
  const [wx, wz] = toWorld(frameOf(MOORINGS[0]), 0.5, 1);
  near(a.x, wx, 1e-9, 'the sea put her where the boat is');
  near(a.z, wz, 1e-9, 'the sea put her where the boat is');
  assert.deepEqual(a.deck, { boat: HULL, x: 0.5, y: 0, z: 1, yaw: 0.2 });
  // Standing a metre off the stern is standing at the stern.
  ann({ t: 'p', x: 0, y: 0, z: 0, yaw: 0, f: 0, on: HULL, d: [0, 0, -3, 0] });
  assert.equal(a.deck.z, -2, 'a deck position off the deck');
  // Ben is not aboard: his claim to be on the deck is a pose like any other.
  ben({ t: 'p', x: 50, y: 0, z: 50, yaw: 0, f: 0, on: HULL, d: [0, 0, 0, 0] });
  const b = roster.all().find((p) => p.id === BEN);
  assert.equal(b.deck, null, 'stood on a deck he never boarded');
  assert.deepEqual([b.x, b.z], [50, 50]);
  // The snapshot carries the deck beside the rows, and the rows as they always were.
  roster.tick();
  const snap = inbox.get(BEN).filter((m) => m.t === 's').at(-1);
  assert.deepEqual(snap.d, [[ANN, HULL, 0, 0, -2, 0]]);
  assert.equal(snap.a.find((r) => r[0] === ANN).length, 6, 'a deck made the row longer');
  // Off the boat, off the deck.
  ann({ t: 'boat', a: 'leave', id: HULL });
  assert.equal(a.deck, null);
  roster.tick();
  assert.equal(inbox.get(BEN).filter((m) => m.t === 's').at(-1).d, undefined, 'a snapshot with nobody on a deck carries a deck list');
});
