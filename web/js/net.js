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

export function createNet({ peers, walk, onStatus = () => {}, name = null } = {}) {
  let sock = null;
  let retry = RETRY_MIN;
  let closed = false;
  let walking = false;
  let selfId = null;
  const last = { x: 0, y: 0, z: 0, yaw: 0, f: -1, at: 0 };

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
          break;
        case 'join': peers.join(m.p); break;
        case 'leave': peers.leave(m.id); break;
        case 'roster': peers.roster(m.players); break;
        case 's': peers.snapshot(m.a); break;
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
    if (!walking || !walk || !walk.state.active) return;
    const s = walk.state;
    const f = (s.moving ? FLAG_MOVING : 0)
      | (s.swimming ? FLAG_SWIMMING : 0)
      | (s.moving && !s.swimming && s.running ? FLAG_RUNNING : 0)
      | (s.grounded ? 0 : FLAG_AIRBORNE);
    const now = Date.now();
    const still = Math.abs(s.pos.x - last.x) < MOVED
      && Math.abs(s.pos.z - last.z) < MOVED
      && Math.abs(s.pos.y - last.y) < MOVED
      && Math.abs(s.yaw - last.yaw) < TURNED
      && f === last.f;
    if (still && now - last.at < KEEPALIVE_MS) return;
    if (!send({ t: 'p', x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw, f })) return;
    last.x = s.pos.x; last.y = s.pos.y; last.z = s.pos.z; last.yaw = s.yaw; last.f = f; last.at = now;
  }, POSE_MS);

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
    setName(n) { if (n) send({ t: 'hello', name: n }); },
    id: () => selfId,
    dispose() {
      closed = true;
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisibility);
      try { sock && sock.close(); } catch { /* already gone */ }
    },
  };
}
