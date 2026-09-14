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

export function createNet({ peers, walk, onStatus = () => {}, onPanels = () => {}, onSaid = () => {}, name = null } = {}) {
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

  const send = (obj) => {
    if (sock && sock.readyState === 1) { sock.send(JSON.stringify(obj)); return true; }
    return false;
  };

  function open() {
    if (closed) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    try { sock = new WebSocket(url); } catch { schedule(); return; }

    sock.addEventListener('open', () => {
      retry = RETRY_MIN;
      onStatus('on');
      if (name) send({ t: 'hello', name });
      send({ t: 'w', on: walking });
      last.f = -1;                      // force the first pose through
    });

    sock.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      switch (m.t) {
        case 'welcome':
          selfId = m.id;
          peers.setSelf(m.id);
          for (const p of m.players || []) peers.join(p);
          // Whatever the boards already said before we walked up.
          onPanels({ kind: 'all', boards: m.panels || [] });
          break;
        case 'join': peers.join(m.p); break;
        case 'leave': peers.leave(m.id); break;
        case 'roster': peers.roster(m.players); break;
        case 's': peers.snapshot(m.a); break;
        // The boards. `ui` is one field of one board; `drove` is who is standing at it.
        case 'ui': onPanels({ kind: 'ui', id: m.id, action: m.a, value: m.v }); break;
        case 'drove': onPanels({ kind: 'drove', id: m.id, driver: m.driver }); break;
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
  const beat = setInterval(() => {
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
