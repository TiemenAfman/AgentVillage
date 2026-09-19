// The line to the island: one WebSocket, our own pose going up, everybody else's coming
// down. It reconnects on its own, because a laptop lid closing should not end the visit.
const RETRY_MIN = 1000;
const RETRY_MAX = 15000;
const POSE_MS = 100;

// What counts as having moved. Below this a standing player sends nothing but the slow
// keepalive, which costs one message a second instead of ten.
const MOVED = 0.02;
const TURNED = 0.05;
const KEEPALIVE_MS = 1000;

const FLAG_MOVING = 1;
const FLAG_SWIMMING = 2;
const FLAG_RUNNING = 4;
const FLAG_AIRBORNE = 8;

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

// `url` is where the world is. It used to be worked out from location.host, which was
// right for as long as the page and the world came off the same server - and is the one
// line that made a page unable to look at a sea running anywhere else. The caller knows
// the answer (web/js/api.js does), so it passes it in and this file stops reading
// location at all.
export function createNet({ peers, walk, url, join = null, onStatus = () => {}, onPanels = () => {}, onSaid = () => {},
  onBoat = () => {}, onWorld = () => {}, onRefused = () => {}, onCrowd = () => {}, name = null } = {}) {
  let sock = null;
  let retry = RETRY_MIN;
  let closed = false;
  let walking = false;
  let selfId = null;
  const last = { x: 0, y: 0, z: 0, yaw: 0, f: -1, r: null, at: 0 };
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

  const send = (obj) => {
    if (sock && sock.readyState === 1) { sock.send(JSON.stringify(obj)); return true; }
    return false;
  };

  function open() {
    if (closed) return;
    try { sock = new WebSocket(url); } catch { schedule(); return; }

    sock.addEventListener('open', () => {
      retry = RETRY_MIN;
      onStatus('on');
      // The handshake. A sea answers nothing else until it has had one - it has to know
      // which world you meant and which coast your body belongs over - and it is sent
      // here rather than by the caller so a reconnect repeats it without anybody
      // remembering to. An island with no sea ignores it, which is what makes this safe
      // to send either way.
      if (join) send({ t: 'join', ...join });
      if (name) send({ t: 'hello', name });
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
          selfId = m.id;
          peers.setSelf(m.id);
          for (const p of m.players || []) peers.join(p);
          // Whatever the boards already said before we walked up.
          onPanels({ kind: 'all', boards: m.panels || [] });
          // Wherever the boats have got to. An untouched one is not in here: both
          // sides derive its mooring from the island (shared/quay.mjs).
          for (const b of m.boats || []) onBoat(b);
          break;
        case 'join': peers.join(m.p); break;
        case 'leave': peers.leave(m.id); break;
        case 'roster': peers.roster(m.players); break;
        case 's': peers.snapshot(m.a); break;
        // The boards. `ui` is one field of one board; `drove` is who is standing at it.
        case 'ui': onPanels({ kind: 'ui', id: m.id, action: m.a, value: m.v }); break;
        case 'drove': onPanels({ kind: 'drove', id: m.id, driver: m.driver }); break;
        // The fleet changing: an island arriving, going quiet, or going home.
        case 'island': onWorld(null, m); break;
        // Somebody else's settlers. `fr` says who the numbers mean and comes once per
        // island; `f` is where they have got to and comes on the beat. Passed through as
        // they arrived - lib/settlerwire.mjs is the only thing that knows the shape, and
        // the page decodes it against the island's own half.
        case 'fr': onCrowd({ kind: 'roster', island: m.i, ids: m.ids || [] }); break;
        case 'f': onCrowd({ kind: 'where', island: m.i, a: m.a, k: m.k, b: m.b }); break;
        // A boat taken, dropped, moved, or unmoored because its island has gone.
        // Passed through as it arrived, and that matters: `moved` carries the position
        // and no pilot, because the tiller does not change ten times a second and a
        // message that repeated it would have the page re-deciding whose hand it is on
        // every beat. So "no pilot named" and "nobody at the tiller" are different things
        // and the page has to be able to tell them apart.
        case 'boat': onBoat(m); break;
        // Somebody talking. The server sends this to everybody including us, so our own
        // line comes back down this same wire and the page can show the conversation in
        // the order the island saw it instead of the order we typed it.
        case 'said': onSaid({ id: m.id, name: m.name, keeper: !!m.keeper, text: m.text, self: m.id === selfId }); break;
        default: break;
      }
    });

    const gone = () => {
      onStatus('off');
      // The server hands out a new id on every connection, so every peer we knew is now
      // a stale name for somebody who may not even be here. Start clean.
      peers.clear();
      selfId = null;
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
    if (!hull.live) return;
    if (hull.id === hullSent.id
      && Math.abs(hull.x - hullSent.x) < MOVED
      && Math.abs(hull.z - hullSent.z) < MOVED
      && Math.abs(hull.yaw - hullSent.yaw) < TURNED) return;
    if (!send({ t: 'boat', a: 'moved', id: hull.id, x: hull.x, z: hull.z, yaw: hull.yaw })) return;
    hullSent.id = hull.id; hullSent.x = hull.x; hullSent.z = hull.z; hullSent.yaw = hull.yaw;
  }

  const beat = setInterval(() => {
    sendHull();
    if (!walking || !here || !here.state.active) return;
    const s = here.state;
    const f = (s.moving ? FLAG_MOVING : 0)
      | (s.swimming ? FLAG_SWIMMING : 0)
      | (s.moving && !s.swimming && s.running ? FLAG_RUNNING : 0)
      | (s.grounded ? 0 : FLAG_AIRBORNE);
    const now = Date.now();
    const still = Math.abs(s.pos.x - last.x) < MOVED
      && Math.abs(s.pos.z - last.z) < MOVED
      && Math.abs(s.pos.y - last.y) < MOVED
      && Math.abs(s.yaw - last.yaw) < TURNED
      && f === last.f
      && room === last.r;
    if (still && now - last.at < KEEPALIVE_MS) return;
    const pose = { t: 'p', x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw, f, r: room || undefined };
    if (cursor) { pose.b = cursor.id; pose.u = cursor.u; pose.v = cursor.v; }
    if (!send(pose)) return;
    last.x = s.pos.x; last.y = s.pos.y; last.z = s.pos.z; last.yaw = s.yaw; last.f = f; last.r = room; last.at = now;
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
    // Mooring her. The pending position goes first: the last beat may be ninety
    // milliseconds old, which at nine and a half units a second is most of a boat's
    // length, and letting the drop overtake it leaves the hull short of where it stopped.
    dropBoat(id) {
      sendHull();
      hull.live = false;
      send({ t: 'boat', a: 'drop', id });
    },
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
    attend(id, x, z) { send({ t: 'attend', b: id, x, z }); },
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
    dispose() {
      closed = true;
      clearInterval(beat);
      clearInterval(uiBeat);
      document.removeEventListener('visibilitychange', onVisibility);
      try { sock && sock.close(); } catch { /* already gone */ }
    },
  };
}
