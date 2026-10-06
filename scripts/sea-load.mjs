// What a sea sends as it fills up: a local sea with K copies of a real island and V viewers,
// counting the bytes each viewer is sent per second. For Plans/zee-stuurt-wat-je-ziet.md.
//
//   node scripts/sea-load.mjs <bundle.json> [--islands=K] [--viewers=V] [--seconds=S]
//                             [--want=all|one|none] [--islanders=N]
//
// <bundle.json> is an island's bundle as a sea serves it (GET /island/:id on any sea). Each
// copy is published under a fresh id, so the sea berths and walks it like a separate island:
// K copies are K crowds of that size. `--want` is what every viewer says it draws: `all`
// says nothing (a page from before `want`), `one` names the first copy only, `none` an empty
// list. `--islanders` adds that many islander sockets (as lib/seaclient.mjs joins), which draw
// nothing. The sea is in this process, on loopback, and goes when the script ends.
import fs from 'node:fs';
import { createSea, SEA_V } from '../lib/sea.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('usage: node scripts/sea-load.mjs <bundle.json> [--islands=K] [--viewers=V] [--seconds=S] [--want=all|one|none] [--islanders=N]'); process.exit(2); }
const K = Number(opt('islands', 1)), V = Number(opt('viewers', 1)), S = Number(opt('seconds', 20));
const want = opt('want', 'all'), N = Number(opt('islanders', 0));
const source = JSON.parse(fs.readFileSync(file, 'utf8'));

const sea = createSea({ port: 0, name: 'load', starters: false, maxPlayers: 256 });
const addr = await sea.listen();
const base = `http://127.0.0.1:${addr.port}`;
const ids = [];
for (let k = 0; k < K; k++) {
  const id = (0xabc00000 + k).toString(16).padStart(16, '0');
  const bundle = structuredClone(source);
  bundle.island.id = id;
  const r = await fetch(`${base}/island/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Island-Token': 't'.repeat(32) + k }, body: JSON.stringify(bundle) });
  if (!r.ok) throw new Error(`publish ${k}: ${r.status} ${await r.text()}`);
  ids.push(id);
}
const settlers = sea.crowds.figures();

function socket(join, then = null) {
  const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
  const tally = { bytes: 0, steady: 0, msgs: 0, from: 0 };
  ws.addEventListener('open', () => { ws.send(JSON.stringify({ t: 'join', v: SEA_V, ...join })); if (then) ws.send(JSON.stringify(then)); });
  ws.addEventListener('message', (e) => {
    const n = Buffer.byteLength(e.data);
    tally.bytes += n;
    if (tally.from && Date.now() >= tally.from) { tally.steady += n; tally.msgs++; }
  });
  return { ws, tally };
}
const wantList = want === 'one' ? [ids[0]] : want === 'none' ? [] : null;
const viewers = [];
for (let v = 0; v < V; v++) viewers.push(socket({ as: 'client', ...(wantList ? { want: wantList } : {}) }, wantList ? { t: 'want', i: wantList } : null));
const islanders = [];
for (let n = 0; n < N && n < K; n++) islanders.push(socket({ as: 'islander', island: ids[n], token: 't'.repeat(32) + n }));

await new Promise((r) => setTimeout(r, 1500));
const from = Date.now();
for (const s of [...viewers, ...islanders]) s.tally.from = from;
await new Promise((r) => setTimeout(r, S * 1000));
const span = (Date.now() - from) / 1000;
const per = (list) => (list.length ? list.reduce((a, s) => a + s.tally.steady, 0) / list.length / span / 1024 : 0);
const health = await (await fetch(`${base}/health`)).json();
console.log(JSON.stringify({
  islands: K, settlers, viewers: V, want, islanders: N,
  perViewerKBs: +per(viewers).toFixed(2),
  perIslanderKBs: +per(islanders).toFixed(2),
  seaOutKBs: +((viewers.concat(islanders).reduce((a, s) => a + s.tally.steady, 0)) / span / 1024).toFixed(1),
  ...(health.wire ? { wire: health.wire } : {}),
}));
for (const s of [...viewers, ...islanders]) s.ws.close();
await sea.close();
process.exit(0);
