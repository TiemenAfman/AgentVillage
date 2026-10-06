// Listen to a sea for a while as a page watching from above would, and count what it is sent:
// bytes and messages per message type, and per island for the crowd's own (`f`, `fr`, `fh`,
// `af`, `herd`). Measures the cost of one viewer; Plans/zee-stuurt-wat-je-ziet.md has the
// numbers it was written for.
//
//   node scripts/sea-listen.mjs [ws-url] [seconds] [--want=<id>,<id>|--want=none]
//
// Joins as a `client` with no island and never walks, so it has no body anywhere: nothing a
// guard can chase, no row in anybody's pose beat. It only says the handshake (and `want`, when
// asked to, to measure what a page that says what it draws is sent).
import { SEA_V } from '../lib/sea.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => /^wss?:/.test(a)) || 'wss://agentvillage.xeroxmsj.freeddns.org/ws';
const secs = Number(args.find((a) => /^\d+$/.test(a)) || 30);
const wantArg = args.find((a) => a.startsWith('--want='));
const want = wantArg ? (wantArg.slice(7) === 'none' ? [] : wantArg.slice(7).split(',')) : null;

const byType = new Map();
const byIsland = new Map();
let total = 0, msgs = 0, joined = 0, first = null;
const ws = new WebSocket(url);
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ t: 'join', v: SEA_V, as: 'client' }));
  if (want) ws.send(JSON.stringify({ t: 'want', i: want }));
});
ws.addEventListener('message', (e) => {
  const n = Buffer.byteLength(e.data);
  const m = JSON.parse(e.data);
  if (m.t === 'welcome') { joined = Date.now(); first = { islands: m.world.islands.length }; }
  // The join dump is the first second; the steady state is what the rest of the time says.
  const phase = joined && Date.now() - joined > 1500 ? 'steady' : 'join';
  const key = `${phase}:${m.t}`;
  const t = byType.get(key) || { msgs: 0, bytes: 0 };
  t.msgs++; t.bytes += n; byType.set(key, t);
  if (phase === 'steady') { total += n; msgs++; }
  if (m.i && phase === 'steady') {
    const k = `${m.i}:${m.t}`;
    const r = byIsland.get(k) || { msgs: 0, bytes: 0 };
    r.msgs++; r.bytes += n; byIsland.set(k, r);
  }
});
setTimeout(() => {
  ws.close();
  const span = (Date.now() - joined - 1500) / 1000;
  console.log(`${url} for ${span.toFixed(1)} s steady, ${first ? first.islands : '?'} islands`);
  console.log(`steady: ${(total / span / 1024).toFixed(2)} kB/s, ${(msgs / span).toFixed(1)} msg/s`);
  const rows = [...byType].sort((a, b) => b[1].bytes - a[1].bytes);
  for (const [k, v] of rows) {
    const rate = k.startsWith('steady') ? ` ${(v.bytes / span / 1024).toFixed(2)} kB/s` : '';
    console.log(`  ${k.padEnd(18)} ${String(v.msgs).padStart(6)} msgs ${String(v.bytes).padStart(9)} B${rate}`);
  }
  console.log('per island (steady):');
  for (const [k, v] of [...byIsland].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  ${k.padEnd(24)} ${(v.bytes / span / 1024).toFixed(2)} kB/s`);
  }
  process.exit(0);
}, secs * 1000);
