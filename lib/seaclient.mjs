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
//         are rather than on the machine they would be leaking to. And beside it this
//         islander's Codex settlers, for the volcano (`codex` below): a short list through
//         a door of its own, packed and redacted here by the same file.
//   down  nothing this file acts on. The page holds its own socket to the sea for the
//         world; this one exists to publish and to be the thing whose closing tells the
//         sea that the keeper has gone quiet.
//
// Node 22 and later have a global WebSocket, so this is still a file with no dependency.
import crypto from 'node:crypto';
// The protocol this islander speaks is the sea's own number, not a copy of it: the islander
// and the sea ship in the same checkout, and a literal here stayed 1 when SEA_V went to 2,
// which made every islander a stranger to its own sea. serve.mjs loads lib/sea.mjs anyway to
// run the single-player sea, so importing it costs nothing extra.
import { SEA_V } from './sea.mjs';

const RETRY_MIN = 1000;
const RETRY_MAX = 30000;
// Refusals that end by themselves, and are therefore waited out rather than accepted.
const WAIT_OUT = new Set(['claimed', 'full']);
// How long the sea may say nothing at all before that is said out loud, once. Not the first
// failed attempt: a sea restarting is a second of blank water (CLAUDE.md), and a line in the
// log for every restart would teach whoever reads it to skip this one. Not every attempt
// either - the backoff below knocks a dozen times in the first ten minutes. On 26 September
// the open sea timed out and the log said nothing for twelve minutes while the island stood
// empty, because nothing here spoke unless the sea did.
export const QUIET_MS = 10000;

// "12 s", "4 min" - how long the island went without, in the line that says it is back.
const lasted = (ms) => (ms < 90000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60000)} min`);

// Who we are to the sea. The island id is derived from a port and a hostname and is
// therefore guessable by anyone who can see either; this is not, and it is what actually
// holds the claim. serve.mjs keeps it on disk (data/sea-token.json) so a restarted
// islander is the same claimant and rejoins its own island at once; minted here only when
// a caller hands none in.
export const mintToken = () => crypto.randomBytes(24).toString('hex');

export function createSeaClient({
  url,
  islandId,
  token = mintToken(),
  key = null,
  bundle = () => null,
  // This islander's Codex settlers, packed (lib/islandbundle.mjs packCodex), or null when it
  // has none to speak of - config.codexIsland off, or no Codex scan yet. Asked for after
  // every publish and on every (re)join; an empty list is a real answer and is sent.
  codex = () => null,
  name = null,
  log = () => {},
  v = SEA_V,
  quietMs = QUIET_MS,
} = {}) {
  if (!url) throw new Error('an island cannot join a sea without knowing where it is');
  const http = new URL(url);
  const ws = new URL(url);
  ws.protocol = http.protocol === 'https:' ? 'wss:' : 'ws:';

  let sock = null;
  let retry = RETRY_MIN;
  let closed = false;
  let joined = false;
  let refusedFor = null;
  // What was last accepted, so an unchanged island is not re-sent every minute. A bundle
  // is 200 kB; a scan runs every sixty seconds and usually changes nothing.
  let sentHash = null;
  // The same, for the Codex list: a scan a minute and a list that is the same bytes whenever
  // nobody has started or finished a Codex session.
  let codexHash = null;
  let codexRefused = null;
  let onWorld = () => {};
  // Since when no socket has had a word out of the sea - a welcome or a refusal - or null
  // while it is talking to us. A refusal counts as a word: `claimed` is waited out with the
  // backoff, and those quiet stretches between knocks are the sea having answered.
  let quietSince = null;
  let quietTimer = null;
  let saidQuiet = false;

  const at = (p) => new URL(String(p).replace(/^\/+/, ''), http).href;
  // The sea's key rides on the HTTP side too. It used to go only on the socket's join, and
  // a keyed sea checked it only there - so an islander turned away at the handshake still
  // parked its island over HTTP on the next scan, and that copy outlived the islander.
  const keyHeader = () => (key ? { 'X-Sea-Key': key } : {});

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
        headers: { 'Content-Type': 'application/json', 'X-Island-Token': token, ...keyHeader() },
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

  // A tree, a jetty, a sown bed. The island has not changed shape, so this goes through the
  // parcel door rather than republishing two hundred kilobytes and making every settler on
  // the island walk back to their own front door.
  //
  // Not hashed the way publish() is. A patch is sent because something happened, not on a
  // timer, so there is no repeat to suppress - and suppressing one would mean a bed dug
  // back to exactly how it was earlier never reaching anybody.
  // `parcel` is already packed - see packParcel in lib/islandbundle.mjs, and pack it there
  // rather than here: this file does not know how big the island is, and the caller owns
  // the props anyway.
  async function patch(parcel) {
    if (!islandId || !parcel) return { sent: false, why: 'nothing to send' };
    try {
      const r = await fetch(at(`/island/${islandId}/parcel`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Island-Token': token, ...keyHeader() },
        body: JSON.stringify({ props: parcel.props || [], crops: parcel.crops || [] }),
      });
      if (!r.ok) {
        const said = await r.json().catch(() => ({}));
        // A sea that has never heard of this island wants the whole thing, not a corner of
        // it - which is the ordinary state of affairs for the first seconds after a
        // restart, so it is repaired rather than reported.
        if (r.status === 404) return publish({ force: true });
        return { sent: false, why: said.error || String(r.status), status: r.status };
      }
      return { sent: true, ...(await r.json().catch(() => ({}))) };
    } catch (e) {
      return { sent: false, why: String(e.message || e) };
    }
  }

  // The Codex settlers, if there is anything new to say about them. Not part of publish():
  // they do not live on this island (the sea houses them on the volcano), so a republish of
  // it is not when they change and they must not ride in a bundle that the sea reads as
  // "this island is not what we drew".
  //
  // A sea that has never heard of this island refuses them (404) - the list is spoken on the
  // island's behalf, with its token - so that is repaired the way a parcel repairs it: the
  // island first, then the list once more.
  async function sendCodex({ force = false, again = true } = {}) {
    if (!islandId) return { sent: false, why: 'nothing to send' };
    const list = codex();
    if (!list) return { sent: false, why: 'nothing to send' };
    const text = JSON.stringify({ settlers: list.settlers || [] });
    const hash = crypto.createHash('sha1').update(text).digest('hex');
    if (!force && hash === codexHash) return { sent: false, why: 'unchanged' };
    // Claimed before the request rather than after the answer, and put back if it does not
    // land: the welcome's forced send and the next scan's send can overlap, and with the hash
    // only set on the answer the second one saw the list as new and sent it twice - harmless
    // on the wire, but tests/sea-codex.test.mjs caught it under load as an unchanged list
    // being sent.
    const before = codexHash;
    codexHash = hash;
    try {
      const r = await fetch(at(`/island/${islandId}/codex`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Island-Token': token, ...keyHeader() },
        body: text,
      });
      if (!r.ok) {
        codexHash = before;
        const said = await r.json().catch(() => ({}));
        if (r.status === 404 && again) {
          const p = await publish({ force: true });
          if (p.sent) return sendCodex({ force: true, again: false });
        }
        // Said once per reason, like a refusal at the handshake: the list goes again after
        // the next scan, and a sea that will not take it (an older one with no such door
        // answers 404 for ever) is not news every minute.
        if (said.error !== codexRefused) log(`the sea would not take this island's Codex settlers: ${said.error || r.status}`);
        codexRefused = said.error;
        return { sent: false, why: said.error || String(r.status), status: r.status };
      }
      codexRefused = null;
      return { sent: true, ...(await r.json().catch(() => ({}))) };
    } catch (e) {
      codexHash = before;
      return { sent: false, why: String(e.message || e) };
    }
  }
  // The sea has said nothing for quietMs: said once, naming where we are knocking, and not
  // again until it has answered. The next line about it is the join (or a refusal), which
  // says how long the island went without.
  function armQuiet() {
    if (quietSince === null) quietSince = Date.now();
    if (quietTimer || saidQuiet || closed) return;
    quietTimer = setTimeout(() => {
      quietTimer = null;
      if (closed || joined || quietSince === null) return;
      saidQuiet = true;
      // Any refusal after the gap is news again, even one already said before it.
      refusedFor = null;
      log(`the sea at ${http.href} is not answering, so nobody walks on this island. `
        + 'Still trying; the next line about it will be the join.');
    }, Math.max(0, quietSince + quietMs - Date.now()));
    if (quietTimer.unref) quietTimer.unref();
  }

  // The sea said something. What it said is handled by whoever called this; the quiet is over.
  function answered() {
    clearTimeout(quietTimer);
    quietTimer = null;
    const back = saidQuiet && quietSince !== null ? ` - back after ${lasted(Date.now() - quietSince)} without an answer` : '';
    quietSince = null;
    saidQuiet = false;
    return back;
  }

  function open() {
    if (closed) return;
    armQuiet();
    let s;
    try { s = new WebSocket(new URL('ws', ws).href); } catch { schedule(); return; }
    sock = s;
    // Whether this socket has been let go of (see `gone`).
    let done = false;

    // The backoff is reset by a welcome, not by the socket opening: a sea that opens the
    // door and then refuses us would otherwise be asked again every second.
    s.addEventListener('open', () => {
      send({ t: 'join', v, key, as: 'islander', island: islandId, token, name });
    });

    s.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'refused') {
        // Said out loud once per reason, whatever happens next. A quiet stretch that was said
        // cleared refusedFor, so a sea that comes back only to refuse says both in one line.
        const back = answered();
        if (m.why !== refusedFor) {
          log(`the sea turned this island away: ${m.why}${m.speaks ? ` (it speaks ${m.speaks}, we speak ${v})` : ''}${back}`);
        }
        refusedFor = m.why;
        // A version or a key is not going to fix itself, so those are not retried into. A
        // claim and a full sea are different: they end on their own. `claimed` is what
        // every islander restart meets - the previous process's claim sits out
        // fleet.GRACE_MS after its socket drops - and giving up on it left this island
        // with no socket for good: published over HTTP only, so the sea kept it as
        // "keeper away" and swept it 45 s later, back on the next scan that changed
        // anything, gone again - an island that blinked in and out while the tray ran.
        if (!WAIT_OUT.has(m.why)) closed = true;
        try { s.close(); } catch { /* already going */ }
        return;
      }
      if (m.t === 'welcome') {
        const back = answered();
        joined = true;
        retry = RETRY_MIN;
        refusedFor = null;
        log(`joined "${m.sea || 'the sea'}" with ${m.world ? m.world.islands.length : 0} island(s) in it${back}`);
        // Publish as soon as we are known, and force it: a sea that has restarted has
        // never seen this island, however recently we sent it.
        // And its Codex settlers after it, forced for the same reason: a restarted sea has an
        // empty volcano, and a list unchanged since the last one it had is still news to it.
        publish({ force: true }).then((r) => {
          if (r.sent) log(`this island is at ${r.origin ? r.origin.join(',') : '?'}`);
          return sendCodex({ force: true });
        });
        onWorld(m.world);
      }
    });

    // Once per socket, from whichever of its two last words arrives first.
    const gone = () => {
      if (done) return;
      done = true;
      if (sock === s) sock = null;
      joined = false;
      // Forget what the sea was told. It may have restarted and lost the fleet, and an
      // unchanged-since-last-time check against a sea that no longer has the island would
      // leave this island invisible until somebody happened to edit a file.
      sentHash = null;
      codexHash = null;
      schedule();
    };
    s.addEventListener('close', gone);
    // An error ends the attempt by itself, and close() is only for a socket that opened.
    // Node's own WebSocket (undici 6.21, Node 22.16) fires `error` and then never `close` for
    // a socket that failed before it opened - a sea timing out, a name that does not resolve,
    // nothing listening - and close() on that socket fires `error` again, synchronously,
    // until the stack runs out. The handler used to be only that close(), with `gone` hung on
    // `close`: the first failed attempt ended in a swallowed RangeError, nothing was ever
    // scheduled, and the island never knocked again. That is the other half of 26 September:
    // the island was not retrying quietly, it had stopped, and only switching seas (which
    // makes a new client) brought it back.
    s.addEventListener('error', () => {
      gone();
      if (s.readyState === 1) { try { s.close(); } catch { /* already going */ } }
    });
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
    patch,
    sendCodex,
    token,
    url: http.href,
    connected: () => joined,
    onWorld: (fn) => { onWorld = fn; },
    close() {
      closed = true;
      clearTimeout(quietTimer);
      quietTimer = null;
      try { sock && sock.close(); } catch { /* already gone */ }
    },
  };
}
