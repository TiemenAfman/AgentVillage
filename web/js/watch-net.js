// The distillate's line to its sea: watching only. The island's web/js/net.js carries a body,
// a hull, the boards, the chat, health and air; nothing here has any of those, so what is left
// is the handshake, the clock, the sky, the fleet (which is where our own berth comes from) and
// the settlers - `fr` who they are, `f` where they are, `fh` who is being spoken to.
//
// Joined as a client that never walks (`w` stays off), so the sea counts nobody on foot and
// sends the crowd to us only as a watcher. Positions arrive island-local and are decoded by
// main.js against the island's own half, exactly as the island's page does.
import { SEA_PROTOCOL } from './update.js';

const RETRY_MIN = 1000;
const RETRY_MAX = 15000;

export function createWatchNet({ url, join, onWorld = () => {}, onCrowd = () => {}, onWeather = () => {}, onStatus = () => {} } = {}) {
  const addressOf = typeof url === 'function' ? url : () => url;
  let sock = null;
  let retry = RETRY_MIN;
  let closed = false;
  let wantList = null;

  const send = (obj) => {
    if (sock && sock.readyState === 1) { sock.send(JSON.stringify(obj)); return true; }
    return false;
  };

  function open() {
    if (closed) return;
    const address = addressOf();
    if (!address) { schedule(); return; }
    try { sock = new WebSocket(address); } catch { schedule(); return; }
    sock.addEventListener('open', () => {
      retry = RETRY_MIN;
      onStatus('on');
      send({ t: 'join', v: SEA_PROTOCOL, as: 'client', ...join(), ...(wantList ? { want: wantList } : {}) });
      send({ t: 'w', on: false });
    });
    sock.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      switch (m.t) {
        case 'welcome':
          if (m.world) onWorld(m.world, null, { now: m.now, tz: m.tz, shift: m.shift });
          if (m.weather) onWeather(m.weather);
          break;
        case 'island': onWorld(null, m); break;
        case 'weather': onWeather(m); break;
        case 'clock': onWorld(null, null, { now: m.now, tz: m.tz, shift: m.shift }); break;
        case 'fr': onCrowd({ kind: 'roster', island: m.i, ids: m.ids || [] }); break;
        case 'f': onCrowd({ kind: 'where', island: m.i, a: m.a, k: m.k, b: m.b }); break;
        case 'fh': onCrowd({ kind: 'held', island: m.i, h: m.h }); break;
        default: break;
      }
    });
    const gone = () => { onStatus('off'); sock = null; schedule(); };
    sock.addEventListener('close', gone);
    sock.addEventListener('error', () => { try { sock && sock.close(); } catch { /* already gone */ } });
  }

  function schedule() {
    if (closed) return;
    const wait = retry * (0.85 + Math.random() * 0.3);
    retry = Math.min(RETRY_MAX, retry * 2);
    setTimeout(open, wait);
  }

  open();

  return {
    // Which islands' people we draw (Plans/zee-stuurt-wat-je-ziet.md), kept for the next handshake.
    want(ids) {
      wantList = [...ids];
      send({ t: 'want', i: wantList });
    },
    reconnect() { try { sock && sock.close(); } catch { /* gone already */ } },
    close() { closed = true; try { sock && sock.close(); } catch { /* gone already */ } },
  };
}
