// The islander's line to the sea.
//
// One socket out and one HTTP POST, and that is the whole of what an island owes the
// world. The direction matters: the islander reaches out, the sea never reaches in. That
// is what lets lib/access.mjs stay strict - the islander keeps listening on loopback only
// and needs no route open to anybody - and it is why there is no inbound half of this file
// to review.
//
// What crosses:
//
//   up    the bundle, on start and whenever a scan changes the island. Redacted on this
//         side by lib/islandbundle.mjs, because the redaction has to run where the secrets
//         are rather than on the machine they would be leaking to.
//   down  nothing this file acts on. The page holds its own socket to the sea for the
//         world; this one exists to publish and to be the thing whose closing tells the
//         sea that the keeper has gone quiet.
//
// Node 22 and later have a global WebSocket, so this is still a file with no dependency.
import crypto from 'node:crypto';

const RETRY_MIN = 1000;
const RETRY_MAX = 30000;

// Who we are to the sea. The island id is derived from a port and a hostname and is
// therefore guessable by anyone who can see either; this is not, and it is what actually
// holds the claim. Minted per process: an islander that restarts gets a new one, which is
// correct - the old socket is gone, so the old claim is nobody's.
export const mintToken = () => crypto.randomBytes(24).toString('hex');

export function createSeaClient({
  url,
  islandId,
  token = mintToken(),
  key = null,
  bundle = () => null,
  name = null,
  log = () => {},
  v = 1,
} = {}) {
  if (!url) throw new Error('an island cannot join a sea without knowing where it is');
  const http = new URL(url);
  const ws = new URL(url);
  ws.protocol = http.protocol === 'https:' ? 'wss:' : 'ws:';

  let sock = null;
  let retry = RETRY_MIN;
  let closed = false;
  let joined = false;
  // What was last accepted, so an unchanged island is not re-sent every minute. A bundle
  // is 200 kB; a scan runs every sixty seconds and usually changes nothing.
  let sentHash = null;
  let onWorld = () => {};

  const at = (p) => new URL(String(p).replace(/^\/+/, ''), http).href;

  function send(obj) {
    if (sock && sock.readyState === 1) { sock.send(JSON.stringify(obj)); return true; }
    return false;
  }

  // Publish, if there is anything new to publish. Returns what happened, so a caller that
  // wants to log it can, and a test can assert on it.
  async function publish({ force = false } = {}) {
    const body = bundle();
    if (!body) return { sent: false, why: 'nothing to send yet' };
    const text = JSON.stringify(body);
    const hash = crypto.createHash('sha1').update(text).digest('hex');
    if (!force && hash === sentHash) return { sent: false, why: 'unchanged' };
    try {
      const r = await fetch(at(`/island/${islandId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Island-Token': token },
        body: text,
      });
      if (!r.ok) {
        const said = await r.json().catch(() => ({}));
        log(`the sea would not take this island: ${said.error || r.status}`);
        return { sent: false, why: said.error || String(r.status), status: r.status };
      }
      sentHash = hash;
      const answer = await r.json().catch(() => ({}));
      return { sent: true, ...answer };
    } catch (e) {
      // The sea being down is not an error worth shouting about: the socket below is
      // already reconnecting, and the next attempt will carry the same island.
      return { sent: false, why: String(e.message || e) };
    }
  }

  function open() {
    if (closed) return;
    try { sock = new WebSocket(new URL('ws', ws).href); } catch { schedule(); return; }

    sock.addEventListener('open', () => {
      retry = RETRY_MIN;
      send({ t: 'join', v, key, as: 'islander', island: islandId, token, name });
    });

    sock.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'refused') {
        // A refusal is worth saying out loud once and not retrying into: a version or a
        // key is not going to fix itself, and a claim belongs to somebody who is still
        // holding it.
        log(`the sea turned this island away: ${m.why}${m.speaks ? ` (it speaks ${m.speaks}, we speak ${v})` : ''}`);
        closed = true;
        try { sock.close(); } catch { /* already going */ }
        return;
      }
      if (m.t === 'welcome') {
        joined = true;
        log(`joined "${m.sea || 'the sea'}" with ${m.world ? m.world.islands.length : 0} island(s) in it`);
        // Publish as soon as we are known, and force it: a sea that has restarted has
        // never seen this island, however recently we sent it.
        publish({ force: true }).then((r) => { if (r.sent) log(`this island is at ${r.origin ? r.origin.join(',') : '?'}`); });
        onWorld(m.world);
      }
    });

    const gone = () => {
      joined = false;
      sock = null;
      // Forget what the sea was told. It may have restarted and lost the fleet, and an
      // unchanged-since-last-time check against a sea that no longer has the island would
      // leave this island invisible until somebody happened to edit a file.
      sentHash = null;
      schedule();
    };
    sock.addEventListener('close', gone);
    sock.addEventListener('error', () => { try { sock && sock.close(); } catch { /* already gone */ } });
  }

  function schedule() {
    if (closed) return;
    const wait = retry * (0.85 + Math.random() * 0.3);
    retry = Math.min(RETRY_MAX, retry * 2);
    const t = setTimeout(open, wait);
    if (t.unref) t.unref();
  }

  open();

  return {
    publish,
    token,
    url: http.href,
    connected: () => joined,
    onWorld: (fn) => { onWorld = fn; },
    close() {
      closed = true;
      try { sock && sock.close(); } catch { /* already gone */ }
    },
  };
}
