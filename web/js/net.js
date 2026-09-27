// The line to the island: one WebSocket, our own pose going up, everybody else's coming
// down. It reconnects on its own, because a laptop lid closing should not end the visit.
import { worldToScene, sceneToWorld } from 'shared/regions.mjs';

const RETRY_MIN = 1000;
const RETRY_MAX = 15000;
const POSE_MS = 100;
// How long no socket may open before onStatus says 'quiet' - once, however many attempts
// fail in the meantime, and not again until one has opened. The sea walks every crowd, this
// island's own included, so a sea that does not answer is an island with nobody on it and
// no word of why (26 September: twelve minutes of it). Ten seconds rides out a sea
// restarting, which is a second of blank water; lib/seaclient.mjs waits as long before its
// own line in the log.
export const QUIET_MS = 10000;

// What counts as having moved. Below this a standing player sends nothing but the slow
// keepalive, which costs one message a second instead of ten.
const MOVED = 0.02;
const TURNED = 0.05;
const KEEPALIVE_MS = 1000;

const FLAG_MOVING = 1;
const FLAG_SWIMMING = 2;
const FLAG_RUNNING = 4;
const FLAG_AIRBORNE = 8;
// A mouse button held on a hand that carries a shield (walk.js; Plans/aanvallen-en-blokkeren.md). The sea's copy is POSE in
// lib/players.mjs and web/js/peers.js mirrors it; lib/hostility.mjs is what reads it - a
// guard's blow that lands on a shield raised towards it costs less. Only ever set on foot:
// a swimmer's arms are busy and a pilot's are on the tiller, and the sea refuses a block
// from a swimmer anyway, so saying one would only be a lie it has to see through.
export const FLAG_BLOCKING = 16;
// Which hands carry a shield, raised or not: armour, each one taking SHIELD_ARMOR off every
// blow from an agent (lib/hostility.mjs armorOf). Walk mode's `shields`, off the avatar.
export const FLAG_SHIELD_LEFT = 32;
export const FLAG_SHIELD_RIGHT = 64;
// In the saddle (web/js/bicycle.js). The sea only relays it, and peers.js draws a bicycle
// under whoever carries it; lib/players.mjs's POSE.RIDING is the sea's copy.
export const FLAG_RIDING = 128;
// How the body is to be drawn by everybody else (Plans/andere-spelers-zoals-jij.md): on its
// back, crouched, on a seat. Relayed only, for peers.js; lib/players.mjs's POSE is the sea's
// copy, and a sea from before these masks them away and draws nobody wrong.
export const FLAG_LYING = 256;
export const FLAG_CROUCHING = 512;
export const FLAG_SITTING = 1024;

// How much health we have, from the last thing the sea said about it. The sea keeps the
// count (lib/health.mjs: only it knows that somebody has been hit, so only it may say what
// is left) and tells us privately - after a hit that leaves us standing, and after being
// sent back whole - with how long until it starts coming back and how fast. It sends
// nothing while it does come back: the page does the same sum from that one message and the
// bar fills smoothly on its own, which is the whole of why `regenIn` and `rate` are on the
// wire at all. A fraction of the bar, 1 when nothing has been said.
//
// `h` is { hp, max, regenIn, rate, at }: the message as it arrived, and `at` the moment it
// did on this page's own clock - relative times, because the sea's clock is somebody else's.
export function healthAt(h, t) {
  if (!h || !(h.max > 0)) return 1;
  const from = h.at + h.regenIn;
  const hp = t > from ? Math.min(h.max, h.hp + ((t - from) / 1000) * h.rate) : h.hp;
  return Math.min(1, Math.max(0, hp / h.max));
}

// What somebody does on a board goes out on this beat, coalesced: a field typed into or
// pressed repeatedly is one value every sixth of a second, not one per keystroke.
//
// That is not politeness, it is the budget. The bucket in lib/players.mjs does not
// throttle when it runs out - it closes the socket with 1008 - and it refills at 25 a
// second, of which the pose beat above already spends ten. Six beats a second carrying
// at most two fields each is 12.5, which leaves room to spare; without the cap a face
// with four fields waiting would send 24 on its own and take the line down.
const UI_MS = 160;
const UI_PER_BEAT = 2;

// The sea counts at most one swing per SWING_MS from a player (SWING_MS in lib/combat.mjs)
// and drops the rest, so they are not sent: the avatar lets a second swing cut the
// first short once it is past its strike (classic-avatar.js, 0.27 s), and that quicker one
// would be a message the sea throws away. The same number as the sea's, and as the swing
// animation itself (SWING_S in classic-avatar.js); the sea may not import web/, so it is
// written out twice.
export const SWING_MS = 450;

// `url` is where the world is. It used to be worked out from location.host, which was
// right for as long as the page and the world came off the same server - and is the one
// line that made a page unable to look at a sea running anywhere else. The caller knows
// the answer (web/js/api.js does), so it passes it in and this file stops reading
// location at all.
//
// `url` and `join` may each be a function, and main.js passes functions for both. A value
// captured here is the address of the world this page booted into, and an island can be
// moved to another one while the page is open - so a reconnect that reopened the captured
// address sailed straight back into the sea we had just left. "On our own" was the worst
// of it: every region was dropped, the socket came back up on the old sea, and the whole
// foreign fleet arrived again on the next welcome. The key travels the same way, because
// the sea being joined may want a different one - or none.
export function createNet({ peers, walk, url, join = null, onStatus = () => {}, onPanels = () => {}, onSaid = () => {},
  onBoat = () => {}, onWorld = () => {}, onRefused = () => {}, onCrowd = () => {}, onWeather = () => {}, onEvicted = () => {},
  onWelcome = () => {}, onAgent = () => {}, onHerd = () => {}, name = null, look = null, frame = () => [0, 0], clock = () => performance.now(),
  quietMs = QUIET_MS } = {}) {
  const addressOf = typeof url === 'function' ? url : () => url;
  const joinWith = typeof join === 'function' ? join : () => join;
  // Where the sea says our island lies, in the sea's own frame. The page draws its own
  // island at the scene origin whatever berth it was given - see homeOrigin in main.js and
  // worldToScene in shared/regions.mjs - so this socket is the one place the two frames
  // meet: every position that goes out gains the berth, every position that comes in loses
  // it. Only positions: a heading is the same in both frames, a room name has none, and the
  // crowd travels island-local and is placed by the region, which has already been moved.
  // A function rather than a value because the berth changes when the island changes seas,
  // and the pose beat below notices the change and reports our body where it now is.
  const homeAt = () => { const h = frame(); return Array.isArray(h) ? h : [0, 0]; };
  // Whether the berth is known at all. `frame` answers null until the sea has said where our
  // island lies, and then [0, 0] above is a guess and not a place: our body and our hull are
  // not sent while it is, rather than being reported in the middle of the world - which is
  // the volcano, with guards on it. Incoming positions still use the guess: there is nothing
  // better to draw them against, and a rehome redraws everything once the berth arrives.
  const berthKnown = () => Array.isArray(frame());
  const outgoing = (x, z) => sceneToWorld([x, z], homeAt());
  const incoming = (x, z) => worldToScene([x, z], homeAt());
  // A boat's row, if it carries a position. `moved` does, and so does every boat in a
  // welcome; `take` and `drop` may or may not, so it is the fields that decide.
  const boatIn = (b) => {
    if (typeof b.x !== 'number' || typeof b.z !== 'number') return onBoat(b);
    const [x, z] = incoming(b.x, b.z);
    return onBoat({ ...b, x, z });
  };
  let sock = null;
  let retry = RETRY_MIN;
  let closed = false;
  let walking = false;
  let selfId = null;
  const last = { x: 0, y: 0, z: 0, yaw: 0, f: -1, r: null, d: null, at: 0 };
  // Whose feet to report. Walking the island it is the island's walk mode; indoors the
  // room owns one of its own, and reporting the wrong one would leave your body standing
  // wherever you last were outside.
  let here = walk;
  let room = null;
  // Where our own hand is on a board, riding along with the pose rather than costing a
  // message of its own.
  let cursor = null;
  // One pending value per board and field, so the last word wins and the ones it
  // overtook are never sent at all.
  const pending = new Map();
  // The hull under our own hands, waiting for the pose beat. Coalesced exactly as the
  // boards' fields are above, and for the same reason: where a boat has got to is the last
  // word and not a history, so a frame that overtakes another costs nothing.
  //
  // This is the whole of the fix for a boat that sailed ten metres and sprang five back.
  // main.js hands the hull over on every frame it moved - sixty a second at speed - and
  // this used to put each one on the wire. Sixty plus the pose beat's ten against a bucket
  // that holds forty and refills at twenty-five (lib/players.mjs) empties it in about a
  // second, and the server does not throttle when it runs dry: it closes the socket with
  // 1008. The page reconnects, gets a new id, and the boat it was sailing is released and
  // put back where the server last heard of it - which is the spring back, once a second,
  // for as long as you stayed at the tiller.
  //
  // One object, mutated. A boat position per frame is not worth an allocation per frame.
  const hull = { id: null, x: 0, z: 0, yaw: 0, live: false };
  const hullSent = { id: null, x: 0, z: 0, yaw: 0 };
  // The sea's last word on our health - see healthAt. Null is whole, which is what a body the
  // sea has never hurt is, and what a new connection is: a new socket is a new player id on
  // the sea and so a fresh body (lib/health.mjs), so a dropped line forgets it too.
  let health = null;
  // When the last swing went, on `clock`; see SWING_MS.
  let swungAt = -Infinity;
  // The sea not answering, said once: see QUIET_MS. Armed when the line drops or an attempt
  // starts without one, disarmed by a socket opening - a sea that opens and then refuses us
  // has answered, and onRefused says why.
  let quietTimer = null;
  let saidQuiet = false;
  const armQuiet = () => {
    if (quietTimer || saidQuiet || closed) return;
    quietTimer = setTimeout(() => {
      quietTimer = null;
      if (closed || (sock && sock.readyState === 1)) return;
      saidQuiet = true;
      onStatus('quiet');
    }, quietMs);
  };
  const disarmQuiet = () => { clearTimeout(quietTimer); quietTimer = null; saidQuiet = false; };

  const send = (obj) => {
    if (sock && sock.readyState === 1) { sock.send(JSON.stringify(obj)); return true; }
    return false;
  };

  function open() {
    if (closed) return;
    armQuiet();
    try { sock = new WebSocket(addressOf()); } catch { schedule(); return; }

    sock.addEventListener('open', () => {
      retry = RETRY_MIN;
      disarmQuiet();
      onStatus('on');
      // The handshake. A sea answers nothing else until it has had one - it has to know
      // which world you meant and which coast your body belongs over - and it is sent
      // here rather than by the caller so a reconnect repeats it without anybody
      // remembering to. An island with no sea ignores it, which is what makes this safe
      // to send either way.
      const hand = joinWith();
      if (hand) send({ t: 'join', ...hand });
      if (name) send({ t: 'hello', name });
      // What we look like, from our own wardrobe (web/js/avatar.js), on every connect: the
      // sea keeps it only as long as this socket, and a reconnect is a stranger until then.
      if (look) send({ t: 'look', ...look });
      send({ t: 'w', on: walking });
      last.f = -1;                      // force the first pose through
    });

    sock.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      switch (m.t) {
        // Turned away: a version, a key, or an island somebody else is still holding.
        // None of those fix themselves, so the page is told and the retry loop is left to
        // its own devices rather than hammering a door that has been answered.
        case 'refused': onRefused(m); break;
        case 'welcome':
          // The fleet, when the far end is a sea. An island on its own says nothing here
          // and the page draws what it always drew. The clock rides along: which moment it
          // is and whose afternoon that is, so two players in different time zones do not
          // see two different skies over the same water.
          if (m.world) onWorld(m.world, null, { now: m.now, tz: m.tz });
          // And what the sky over that world is doing. Silence here is clear weather and
          // nothing else: an island on its own says nothing, and so does a sea older than
          // the weather. Neither is a version mismatch and neither is worth a word to
          // anybody - see the note on `weather` in lib/sea.mjs's welcome.
          if (m.weather) onWeather(m.weather);
          selfId = m.id;
          peers.setSelf(m.id);
          for (const p of m.players || []) peers.join(p);
          // Whatever the boards already said before we walked up.
          onPanels({ kind: 'all', boards: m.panels || [] });
          // Wherever the boats have got to. An untouched one is not in here: both
          // sides derive its mooring from the island (shared/quay.mjs).
          for (const b of m.boats || []) boatIn(b);
          // Last, so everything the welcome carried is already in place. A new socket is
          // a new player id, and anything named after the old one - a skiff - is gone.
          onWelcome(m.id, m.build || null);
          break;
        case 'join': peers.join(m.p); break;
        // Somebody else's arm, on everybody else's screen (Plans/andere-spelers-zoals-jij.md):
        // a swing coming down, a glass going up. Events, like the agents' own `swing`.
        case 'swung': peers.act(m.id, 'attack', m.side); break;
        case 'drank': peers.act(m.id, 'drink', m.side); break;
        case 'leave': peers.leave(m.id); break;
        case 'roster': peers.roster(m.players); break;
        case 's': {
          // Rows are [id, x, y, z, yaw, ...] in the sea's frame - lib/players.mjs - and x
          // and z come into ours here, before anything draws them.
          const [hx, hz] = homeAt();
          if (hx || hz) for (const row of m.a || []) { row[1] -= hx; row[3] -= hz; }
          // `d` is who stands on which deck, in that hull's own frame, so it needs no
          // translating: the hull it is measured from already came in through boatIn.
          peers.snapshot(m.a, undefined, m.d);
          break;
        }
        // The boards. `ui` is one field of one board; `drove` is who is standing at it.
        case 'ui': onPanels({ kind: 'ui', id: m.id, action: m.a, value: m.v }); break;
        case 'drove': onPanels({ kind: 'drove', id: m.id, driver: m.driver }); break;
        // The fleet changing: an island arriving, going quiet, or going home.
        case 'island': onWorld(null, m); break;
        // The sky turning. One word every ten minutes or so, for the whole world at once.
        // Passed through as it arrived, exactly as the welcome's copy is, so there is one
        // shape for the page to understand rather than two.
        case 'weather': onWeather(m); break;
        // The clocks going forward or back, twice a year. The same two numbers the welcome
        // carries, handed to the same place, so a page connected across the switch does not
        // keep last week's offset until it next reconnects - see lib/seaclock.mjs.
        case 'clock': onWorld(null, null, { now: m.now, tz: m.tz }); break;
        // Somebody else's settlers. `fr` says who the numbers mean and comes once per
        // island; `f` is where they have got to and comes on the beat. Passed through as
        // they arrived - lib/settlerwire.mjs is the only thing that knows the shape, and
        // the page decodes it against the island's own half.
        case 'fr': onCrowd({ kind: 'roster', island: m.i, ids: m.ids || [] }); break;
        case 'f': onCrowd({ kind: 'where', island: m.i, a: m.a, k: m.k, b: m.b }); break;
        // And `fh`, who is being spoken to and where the talker stands: the whole set, sent
        // when it changes (shared/settlerwire.mjs encodeHeld).
        case 'fh': onCrowd({ kind: 'held', island: m.i, h: m.h }); break;
        // An island's story animals (docs/animals-wire.md): `herd` is who they are and the
        // marks they have left, `af` where they have got to, seven numbers a row. Their own
        // `t`s rather than an `island` message, because a page from before the animals reads
        // every unknown `island` as a fleet row.
        case 'herd': onHerd({ kind: 'herd', island: m.i, seq: m.seq, animals: m.animals || [], traces: m.traces || [] }); break;
        case 'af': onHerd({ kind: 'where', island: m.i, r: m.r || [] }); break;
        // A boat taken, dropped, moved, or unmoored because its island has gone.
        // Passed through as it arrived, and that matters: `moved` carries the position
        // and no pilot, because the tiller does not change ten times a second and a
        // message that repeated it would have the page re-deciding whose hand it is on
        // every beat. So "no pilot named" and "nobody at the tiller" are different things
        // and the page has to be able to tell them apart.
        case 'boat': boatIn(m); break;
        // Our health, privately. Replaced whole by each message rather than merged: every one
        // carries the count and the wait from scratch, so a hit halfway through a regen simply
        // starts the sum again from where the sea says we now are. A message that does not add
        // up is ignored rather than drawn - a bar at NaN is a bar that never fades.
        case 'health': {
          if (![m.hp, m.max].every(Number.isFinite) || m.max <= 0) break;
          health = {
            hp: Math.min(m.max, Math.max(0, m.hp)), max: m.max,
            regenIn: Number.isFinite(m.regenIn) ? Math.max(0, m.regenIn) : 0,
            rate: Number.isFinite(m.rate) ? Math.max(0, m.rate) : 0,
            at: clock(),
          };
          break;
        }
        // Something on an island was hit - a guard or a Codex resident on the volcano, by
        // whoever swung (lib/combat.mjs). Everybody who can see that island is told, so the
        // flinch is on every screen and not only the swinger's. Passed through: the ids are
        // the sea's crowd ids and main.js knows which crowd view holds them.
        case 'agent': onAgent(m); break;
        case 'evicted': {
          if (![m.x, m.y, m.z].every(Number.isFinite)) break;
          const [ox, oz] = frame();
          onEvicted({ ...m, x: m.x - ox, z: m.z - oz });
          break;
        }
        // Somebody talking. The server sends this to everybody including us, so our own
        // line comes back down this same wire and the page can show the conversation in
        // the order the island saw it instead of the order we typed it.
        case 'said': onSaid({ id: m.id, name: m.name, keeper: !!m.keeper, text: m.text, self: m.id === selfId }); break;
        default: break;
      }
    });

    const gone = () => {
      onStatus('off');
      armQuiet();                       // the grace counts from the line dropping, not the next knock
      // The server hands out a new id on every connection, so every peer we knew is now
      // a stale name for somebody who may not even be here. Start clean.
      peers.clear();
      selfId = null;
      health = null;
      sock = null;
      schedule();
    };
    sock.addEventListener('close', gone);
    sock.addEventListener('error', () => { try { sock && sock.close(); } catch { /* already gone */ } });
  }

  function schedule() {
    if (closed) return;
    const wait = retry * (0.85 + Math.random() * 0.3);   // jitter, so ten tabs do not knock together
    retry = Math.min(RETRY_MAX, retry * 2);
    setTimeout(open, wait);
  }

  // Driven by a timer rather than by the animation loop on purpose. A backgrounded tab
  // stops rendering entirely, and hanging this off the frame would freeze your body in
  // front of everyone else in a way they cannot tell from a crash. setInterval is clamped
  // to about a second in the background, which is exactly the right amount of alive.
  // Where the hull has got to, if it has got anywhere since the last beat. Its own thresholds
  // are the pose's: the pilot's body is the boat, so a hull that has moved enough to be worth
  // a message is exactly a pose that has.
  //
  // Sent before the pose rather than after, and outside every early return the pose has: a
  // pilot sitting at the tiller with the throttle shut is `still`, and the last metre of way
  // she carried before stopping still has to reach the server.
  function sendHull() {
    if (!hull.live || !berthKnown()) return;
    const [hx, hz] = homeAt();
    if (hull.id === hullSent.id
      && Math.abs(hull.x - hullSent.x) < MOVED
      && Math.abs(hull.z - hullSent.z) < MOVED
      && Math.abs(hull.yaw - hullSent.yaw) < TURNED
      && hx === hullSent.hx && hz === hullSent.hz) return;
    const [wx, wz] = outgoing(hull.x, hull.z);
    if (!send({ t: 'boat', a: 'moved', id: hull.id, x: wx, z: wz, yaw: hull.yaw })) return;
    hullSent.id = hull.id; hullSent.x = hull.x; hullSent.z = hull.z; hullSent.yaw = hull.yaw;
    hullSent.hx = hx; hullSent.hz = hz;
  }

  // Our body, if it has changed enough to be worth saying or the keepalive is due. On the
  // beat, and also straight before a swing (see swing()), so the sea measures the blow from
  // where we are and which way we face now, not a tenth of a second ago.
  function sendPose() {
    if (!walking || !here || !here.state.active || !berthKnown()) return;
    const s = here.state;
    const f = (s.moving ? FLAG_MOVING : 0)
      | (s.swimming ? FLAG_SWIMMING : 0)
      | (s.moving && !s.swimming && s.running ? FLAG_RUNNING : 0)
      | (s.grounded ? 0 : FLAG_AIRBORNE)
      | (s.blocking && !s.swimming && !s.vehicle && !s.bike ? FLAG_BLOCKING : 0)
      | (s.bike ? FLAG_RIDING : 0)
      | (s.shields && s.shields.left ? FLAG_SHIELD_LEFT : 0)
      | (s.shields && s.shields.right ? FLAG_SHIELD_RIGHT : 0)
      | (s.lying ? FLAG_LYING : 0)
      | (s.crouching && !s.lying ? FLAG_CROUCHING : 0)
      | (s.sitting ? FLAG_SITTING : 0);
    const now = Date.now();
    // A berth that moved is a body that moved, as far as the sea is concerned: our feet
    // did not stir but their world position did, so it goes out on this beat.
    const [hx, hz] = homeAt();
    // On a deck (Plans/lopen-op-de-boot.md): which boat, and where on it, in its own frame -
    // shared/deck.mjs. The world position still goes out beside it, for a sea from before
    // this. No walk mode sets `deck` yet: every boat is a Benchy with room for her pilot.
    const deck = s.deck || null;
    const deckSig = deck ? `${deck.boat}:${deck.x.toFixed(3)},${deck.y.toFixed(3)},${deck.z.toFixed(3)},${deck.yaw.toFixed(3)}` : null;
    const still = deckSig === last.d
      && Math.abs(s.pos.x - last.x) < MOVED
      && Math.abs(s.pos.z - last.z) < MOVED
      && Math.abs(s.pos.y - last.y) < MOVED
      && Math.abs(s.yaw - last.yaw) < TURNED
      && f === last.f
      && room === last.r
      && hx === last.hx && hz === last.hz;
    if (still && now - last.at < KEEPALIVE_MS) return;
    const [wx, wz] = outgoing(s.pos.x, s.pos.z);
    const pose = { t: 'p', x: wx, y: s.pos.y, z: wz, yaw: s.yaw, f, r: room || undefined };
    if (cursor) { pose.b = cursor.id; pose.u = cursor.u; pose.v = cursor.v; }
    if (deck) { pose.on = deck.boat; pose.d = [deck.x, deck.y, deck.z, deck.yaw]; }
    if (!send(pose)) return;
    last.x = s.pos.x; last.y = s.pos.y; last.z = s.pos.z; last.yaw = s.yaw; last.f = f; last.r = room; last.at = now;
    last.d = deckSig;
    last.hx = hx; last.hz = hz;
  }

  const beat = setInterval(() => {
    sendHull();
    sendPose();
  }, POSE_MS);

  // A standing player sends nothing but the slow keepalive, and a hand moving over a
  // board while the feet are still would be stuck in it. So the moment the cursor
  // changes the next beat is made to go out.
  function stirPose() { last.f = -1; }

  const uiBeat = setInterval(() => {
    let left = UI_PER_BEAT;
    for (const [key, msg] of pending) {
      if (left-- <= 0) return;             // the rest go out on the next beat
      if (!send(msg)) return;              // the line is down; keep them for when it is back
      pending.delete(key);
    }
  }, UI_MS);

  // A hidden tab is a player who has stepped away: say so, rather than leaving a statue
  // standing until the server times it out.
  const onVisibility = () => { if (document.visibilityState !== 'visible') send({ t: 'w', on: false }); else send({ t: 'w', on: walking }); };
  document.addEventListener('visibilitychange', onVisibility);

  open();

  return {
    setWalking(on) {
      walking = !!on;
      last.f = -1;
      send({ t: 'w', on: walking });
    },
    // Stepping into a room, or back out of it. Null is outdoors, and the walk mode that
    // comes with it is the one your pose is read from until you leave.
    setRoom(name, mode = null) {
      room = name || null;
      here = mode || walk;
      last.f = -1;                    // force the next pose through, wherever it is
    },
    setName(n) { if (n) send({ t: 'hello', name: n }); },
    // One swing of whatever we are holding, the moment it starts (walk.js, the left button).
    // Nothing else goes with it: the sea already has our position and heading off the pose
    // beat, and it believes nothing about the swing but that it happened - what it reaches and
    // what that costs is lib/combat.mjs's to decide. At once rather than on the beat, because a
    // hit that lands a tenth of a second after the arm came down reads as lag; and cheap on
    // the bucket in lib/players.mjs: at most one per SWING_MS, each with at most one pose
    // flushed ahead of it, is under five messages a second against a refill of 25.
    //
    // Only on foot on the sea: in walk mode, outdoors (a room is nobody's battlefield), with
    // our own feet under us and not a hull or the water, and with a berth the sea knows, since
    // the pose it measures the swing from is not sent before that either. Not while swimming -
    // the sea ignores that swing - and not sooner than SWING_MS after the last. A shield
    // raised in the other hand is no reason not to: the sea takes a swing from a blocker. Every one of those the sea
    // would drop on arrival, so none of them is worth a token from the bucket. Returns whether
    // it went.
    swing(side = null) {
      const s = here && here.state;
      if (!walking || room || here !== walk || !s || !s.active || s.vehicle || s.bike || s.swimming || !berthKnown()) return false;
      const t = clock();
      if (t - swungAt < SWING_MS) return false;
      sendPose();
      // Which hand, so everybody else sees that arm come down (the sea passes it on as
      // `swung`); the sea's own combat does not care.
      if (!send({ t: 'swing', side: side || undefined })) return false;
      swungAt = t;
      return true;
    },
    // Where the red bar stands now, regen included: a fraction, 1 when whole or never hurt.
    // Called every frame; it is one subtraction and a min.
    health: () => healthAt(health, clock()),
    // One field of one board. Queued rather than sent: see UI_MS.
    setPanelField(id, action, value) {
      pending.set(`${id}:${action}`, { t: 'ui', id, a: action, v: value });
    },
    // Standing at a board, and letting go of it. Both go out at once - they are one
    // press each, and waiting for the beat would make E feel slow.
    takePanel(id) { send({ t: 'take', id }); },
    // The tiller. Take and drop go out at once, like a board's - they are one press each.
    // Taking one forgets whatever the last hull's last word was, so the first beat under
    // way is always sent however near the old boat this one happens to lie.
    takeBoat(id) {
      hullSent.id = null;
      send({ t: 'boat', a: 'take', id });
    },
    // A skiff into the water, for a player with no island and so no mooring (the app on a
    // phone). The sea names it after this socket and hands us its tiller - lib/boats.mjs.
    launchBoat(id, x, z, yaw) {
      hullSent.id = null;
      const [wx, wz] = outgoing(x, z);
      send({ t: 'boat', a: 'launch', id, x: wx, z: wz, yaw });
    },
    // Mooring her. The pending position goes first: the last beat may be ninety
    // milliseconds old, which at nine and a half units a second is most of a boat's
    // length, and letting the drop overtake it leaves the hull short of where it stopped.
    dropBoat(id) {
      sendHull();
      hull.live = false;
      send({ t: 'boat', a: 'drop', id });
    },
    // A crew, for a boat with room for more than her pilot (Plans/lopen-op-de-boot.md, fase
    // 4 to 6; lib/boats.mjs has the rules). Nothing calls these yet. Letting go of the tiller
    // keeps the hull live: for a moment the sea still takes its position from us while it
    // runs out its way (COAST_MS there).
    boardBoat(id) { send({ t: 'boat', a: 'board', id }); },
    // A sip, for everybody else to see (the sea passes it on as `drank`). Indoors too: the
    // bar is where a beer is drunk.
    drink(side) { if (walking && here && here.state && here.state.active) send({ t: 'drink', side }); },
    // Our look, when the wardrobe changes it - and kept for the next connect.
    setLook(spec) { look = spec || null; if (look) send({ t: 'look', ...look }); },
    leaveBoat(id) { send({ t: 'boat', a: 'leave', id }); },
    letGoBoat(id) { sendHull(); send({ t: 'boat', a: 'letgo', id }); },
    // And where the hull has got to, on the pose beat rather than a beat of its own: the
    // pilot is already sending ten poses a second and the boat is under them, so this is
    // one more message on the same bucket and no new ceiling to reason about. Twenty a
    // second against a refill of twenty-five, and the board beat cannot be busy at the
    // same time - there is nothing to type at from the water.
    //
    // Called from the frame loop, so it only records. See `hull` above for what sending
    // each of those frames did.
    movedBoat(id, x, z, yaw) {
      hull.id = id; hull.x = x; hull.z = z; hull.yaw = yaw; hull.live = true;
    },
    // Standing in front of a settler, and walking off again. The sea walks the crowd, so
    // this is what makes them turn round and wait - and what makes everybody else watch
    // them do it, instead of only the person they are talking to. World coordinates, like
    // every other position on this line; the sea takes the island's origin off.
    // Where we are standing goes in the sea's frame: lib/sea.mjs takes that island's
    // origin off it to find the spot in the crowd's own coordinates.
    attend(id, x, z) { const [wx, wz] = outgoing(x, z); send({ t: 'attend', b: id, x: wx, z: wz }); },
    unattend(id) { send({ t: 'attend', b: id, on: false }); },
    dropPanel(id) { send({ t: 'drop', id }); cursor = null; stirPose(); },
    // One sentence out loud, to everybody on the island. Sent at once rather than on a
    // beat: a sixth of a second of waiting is nothing on a board, but on a conversation
    // it reads as a bad line. Returns false when the line is down, so the page can say
    // so instead of swallowing what somebody just typed.
    say(text) { return send({ t: 'say', text }); },
    // Where our hand is on the board we are at, or null when it is off it.
    setPanelCursor(at) {
      const had = cursor;
      cursor = at;
      if (!had !== !cursor || (cursor && had && (cursor.id !== had.id
        || Math.abs(cursor.u - had.u) > 0.004 || Math.abs(cursor.v - had.v) > 0.004))) stirPose();
    },
    id: () => selfId,
    // Drop the line and take it up again, at whatever address `url` now hands back. For
    // moving this island to another world: everything else here is written to survive a
    // socket going away, so the cheapest correct way to change seas is to make this one go
    // away on purpose. The retry is reset so it happens now rather than up to fifteen
    // seconds from now - this is somebody pressing a button, not a laptop lid.
    reconnect() {
      if (closed) return;
      retry = RETRY_MIN;
      // Another sea gets its own grace and its own 'quiet', under its own name: the caller
      // takes down whatever it put up for the old one (followSea in main.js).
      disarmQuiet();
      try { sock && sock.close(); } catch { /* already gone; the close handler still fires */ }
    },
    dispose() {
      closed = true;
      disarmQuiet();
      clearInterval(beat);
      clearInterval(uiBeat);
      document.removeEventListener('visibilitychange', onVisibility);
      try { sock && sock.close(); } catch { /* already gone */ }
    },
  };
}
