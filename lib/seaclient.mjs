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
//         And its story animals (`animals` below, Plans/dierenverhalen.md): who they are and
//         what each is on its way to do, through a third door of their own.
//   down  one thing this file acts on: the sea saying one of those errands is done
//         (`{t:'animal', a:'done'}`), handed to `onAnimal`. It comes over this socket,
//         which the islander opened - never through a route anybody could call - and only
//         to the islander that holds the island's token. Otherwise the page holds its own
//         socket to the sea for the world; this one exists to publish and to be the thing
//         whose closing tells the sea that the keeper has gone quiet.
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
  // The story animals' public state, packed (lib/animalbundle.mjs packAnimals) without its
  // `gen`, which is this file's to add; null while the island has none or keeps none.
  animals = () => null,
  name = null,
  log = () => {},
  v = SEA_V,
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
  // The animals': hashed like the Codex list, and said once when a sea has no door for them.
  let animalsHash = null;
  let animalsRefused = null;
  // Which connection this is, counted from 1 on every welcome. An errand is posted under the
  // generation it was sent on and the sea says `done` under the same number, so a completion
  // that belongs to a line that has since dropped - and was already re-posted on the new one
  // - is recognisably stale (docs/animals-wire.md, "Completion").
  let gen = 0;
  let onWorld = () => {};
  let onAnimal = () => {};

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
  // The animals, if anything about them is new to this sea. The same 404 repair as the Codex
  // list - the island first, then once more - and a sea from before the animals, which
  // answers 404 for ever, is said once and then left alone until the next welcome.
  async function sendAnimals({ force = false, again = true } = {}) {
    if (!islandId || !joined) return { sent: false, why: 'not joined' };
    const body = animals();
    if (!body) return { sent: false, why: 'nothing to send' };
    const text = JSON.stringify({ ...body, gen });
    const hash = crypto.createHash('sha1').update(text).digest('hex');
    if (!force && hash === animalsHash) return { sent: false, why: 'unchanged' };
    if (!force && animalsRefused === 'no door') return { sent: false, why: 'this sea keeps no animals' };
    const before = animalsHash;
    animalsHash = hash;
    try {
      const r = await fetch(at(`/island/${islandId}/animals`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Island-Token': token, ...keyHeader() },
        body: text,
      });
      if (!r.ok) {
        animalsHash = before;
        const said = await r.json().catch(() => ({}));
        // Two different 404s: an island this sea has not heard of yet (repaired by
        // publishing it), and a sea with no such door at all (`no route ...`, a sea older than
        // the animals), which no amount of publishing repairs.
        const noDoor = r.status === 404 && /^no route/.test(said.error || '');
        if (r.status === 404 && again && !noDoor) {
          const p = await publish({ force: true });
          if (p.sent) return sendAnimals({ force: true, again: false });
        }
        const why = noDoor ? 'no door' : said.error || String(r.status);
        if (why !== animalsRefused) {
          log(why === 'no door' ? 'this sea keeps no animals (it is older than they are); they wait here'
            : `the sea would not take this island's animals: ${why}`);
        }
        animalsRefused = why;
        return { sent: false, why, status: r.status };
      }
      animalsRefused = null;
      return { sent: true, ...(await r.json().catch(() => ({}))) };
    } catch (e) {
      animalsHash = before;
      return { sent: false, why: String(e.message || e) };
    }
  }

  function open() {
    if (closed) return;
    try { sock = new WebSocket(new URL('ws', ws).href); } catch { schedule(); return; }

    // The backoff is reset by a welcome, not by the socket opening: a sea that opens the
    // door and then refuses us would otherwise be asked again every second.
    sock.addEventListener('open', () => {
      send({ t: 'join', v, key, as: 'islander', island: islandId, token, name });
    });

    sock.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'refused') {
        // Said out loud once per reason, whatever happens next.
        if (m.why !== refusedFor) {
          log(`the sea turned this island away: ${m.why}${m.speaks ? ` (it speaks ${m.speaks}, we speak ${v})` : ''}`);
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
        try { sock.close(); } catch { /* already going */ }
        return;
      }
      if (m.t === 'animal') {
        // Bounded before it goes anywhere: an id-shaped action and a whole number, or nothing.
        if (m.a === 'done' && m.i === islandId && typeof m.action === 'string' && m.action.length <= 40 &&
            Number.isSafeInteger(m.gen)) {
          try { onAnimal({ action: m.action, gen: m.gen }); } catch (err) { log(`an animal's errand could not be taken in: ${err.message || err}`); }
        }
        return;
      }
      if (m.t === 'welcome') {
        joined = true;
        gen += 1;
        animalsRefused = null;
        retry = RETRY_MIN;
        refusedFor = null;
        log(`joined "${m.sea || 'the sea'}" with ${m.world ? m.world.islands.length : 0} island(s) in it`);
        // Publish as soon as we are known, and force it: a sea that has restarted has
        // never seen this island, however recently we sent it.
        // And its Codex settlers after it, forced for the same reason: a restarted sea has an
        // empty volcano, and a list unchanged since the last one it had is still news to it.
        publish({ force: true }).then((r) => {
          if (r.sent) log(`this island is at ${r.origin ? r.origin.join(',') : '?'}`);
          return sendCodex({ force: true });
        }).then(() => sendAnimals({ force: true })).catch(() => {});
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
      codexHash = null;
      animalsHash = null;
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
    patch,
    sendCodex,
    sendAnimals,
    token,
    generation: () => gen,
    onAnimal: (fn) => { onAnimal = fn; },
    url: http.href,
    connected: () => joined,
    onWorld: (fn) => { onWorld = fn; },
    close() {
      closed = true;
      try { sock && sock.close(); } catch { /* already gone */ }
    },
  };
}
