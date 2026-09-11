// Somebody else's website, served from an address of the island's own - and then worked
// through a small bridge, so a board carries a live site rather than a picture of one.
//
// Two problems meet here, and the shape of this file is the only answer that solves both.
//
//   A board has to be pressable. The island aims the mouse with a raycaster rather than
//   letting the browser hit-test the panels - see above aim() in web/js/panels.js for the
//   measurements that forced that - and a raycaster stops at the edge of a cross-origin
//   document. Framed straight off the far site, a billboard is a thing to look at and
//   nothing more.
//
//   And the site has to actually run. Plenty of pages are a blank white rectangle with
//   "JavaScript is disabled" on them, a video will not play without the player that
//   drives it, and the island's own /demo is nothing but script. Serving the page with
//   scripts turned off makes a board that presses beautifully and shows nothing worth
//   pressing.
//
// Doing both by serving the page at the island's own origin is the trap: a script in a
// same-origin frame reaches `parent.document`, and from there it has the island - every
// API path, every key, the lot. So the page is served from a *separate* origin instead,
// its own port, and scripts are let back on. Everything the far side does now happens
// somewhere that cannot see the island at all.
//
// That leaves the press, which the raycaster can no longer deliver, and the bridge below
// carries it: a few lines of ours injected into the page, listening for "there is a
// pointer at this spot" from the island and doing the pressing from the inside. The
// island never reads the page and the page never reads the island; they pass coordinates
// over postMessage, which is the one channel that crosses an origin on purpose.
//
// What is given up by letting scripts run is that the page is no longer inert. It is a
// real browser tab on a board, with whatever that site chooses to do in it. That is the
// bargain the separate origin is there to make safe, and it is the reason the port and
// the allowed parent are both pinned rather than left open.
//
// One rule survives all of it: this must never become an open proxy. Nothing here takes
// a URL from the caller. A request names a board, the board's address comes from
// props.json, and a link followed from that page is fetched only if it lands on the host
// the keeper already chose. The set of things this will ever fetch is exactly the set of
// sites standing on the island.
import path from 'node:path';
import fs from 'node:fs';
import { listProps } from './props.mjs';
import { DATA } from './paths.mjs';
import { boardSite, boardPage, BILLBOARD, isLoopbackHost } from '../shared/panels.mjs';

// Pages of the island's own, for a board to carry. A folder rather than a setting,
// because the thing people actually want from a billboard is to put something up for
// everybody here to read - and the shortest path to that is: write an .html, drop it in,
// name it on the prop.
//
// Served whole from the billboard port, assets and all, which is what makes this work
// where proxying somebody else's site does not: everything is one origin, so a module
// script loads, a fetch resolves, and a page built entirely by JavaScript comes up.
export const BOARDS = path.join(DATA, 'boards');

// Long enough for a slow site, short enough that a board does not hold a socket open all
// afternoon if the far end simply never answers.
const TIMEOUT_MS = 12000;

// A hoarding shows a page, not a download. Anything bigger than this is not a page.
const MAX_BYTES = 8 * 1024 * 1024;

// What a browser is told about the page we hand back.
//
// Short, now, and deliberately so. The old policy turned every script off, because the
// page was running at the island's own origin and a script there owned the island. On a
// port of its own there is nothing next to it to protect, so the page is allowed to be a
// page - and `frame-ancestors` does the one job left: only the island may hang this on a
// board. Anybody who finds the port and opens it in a tab gets the site, which is what
// they would have got by typing the address in the first place.
//
// `base-uri` is left out, and that was measured the hard way: the rewritten <base> below
// is what sends the page's own stylesheets and images back to the far side, so
// forbidding one blocks the other and the board comes up as unstyled text.
function policy(island) {
  return `frame-ancestors ${island || "'none'"}`;
}

// Headers the far end sent that are ours to decide instead. The framing ones are the
// whole point; the rest would either lie about what we are sending or let the page keep
// a grip on the browser after we have let go.
const DROP = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'strict-transport-security',
  'set-cookie',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
]);

// What the model sheet asks for, since it stands no props up.
export const DEMO = 'demo';


// The bridge. A handful of our lines inside somebody else's page, and the only reason a
// board on a separate origin can still be worked.
//
// It answers three things, all of them coordinates and none of them content: where the
// pointer is, that it has been pressed, and how far to scroll. Nothing about the page
// ever travels back - the island does not learn what the page says, which is the same
// bargain in the other direction and keeps this honest.
//
// `island` is pinned into the listener rather than trusted from the event, so a third
// party who gets a message in cannot drive somebody's board.
//
// Coordinates arrive in the page's own viewport pixels. web/js/faces.js does the folding
// from board to page before it sends them, because it is the side that knows how big the
// board is drawn.
function bridgeScript(island) {
  return `<script>(function(){
var ISLAND=${JSON.stringify(island)};
var under=null;
function mark(el){
  if(under===el)return;
  if(under&&under.classList)under.classList.remove('under');
  under=el;
  if(under&&under.classList)under.classList.add('under');
}
addEventListener('message',function(e){
  if(e.origin!==ISLAND)return;
  var m=e.data;
  if(!m||typeof m!=='object')return;
  if(m.k==='hover'){ mark(document.elementFromPoint(m.x,m.y)); return; }
  if(m.k==='press'){
    var el=document.elementFromPoint(m.x,m.y);
    if(!el)return;
    if(el.focus)el.focus();
    if(el.click)el.click();
    return;
  }
  if(m.k==='scroll'){ scrollBy(0,m.dy); return; }
});
})();<\/script>`;
}

// The board a request is about, and the address it was put up with. A request naming no
// board, or one that is not a billboard, is answered with nothing - which is what keeps
// this from being a way to fetch whatever a caller likes.
function boardOf(id) {
  const want = String(id || '');
  // The model sheet has no island behind it - see web/js/demo.js, which builds its specs
  // by hand - so it names this instead of a prop. It is not a hole in the rule above: the
  // address is the one constant in shared/panels.mjs, not something a caller chose.
  // The model sheet gets a page of the island's own rather than a site off the web: it
  // is the case worth having in front of you while working on boards, and it needs no
  // network to come up.
  if (want === DEMO) return { prop: { id: DEMO }, page: 'welkom.html' };
  const prop = listProps().find((p) => p.id === want);
  if (!prop || prop.face !== 'billboard') return null;
  const page = boardPage(prop.note);
  if (page) return { prop, page };
  return { prop, home: boardSite(prop) };
}

// Where a request actually points. `to` is how a link followed inside the page comes
// back to us, and it is only honoured when it lands on the same host the keeper chose.
// Anything else and the board goes back to its own front page rather than fetching a
// stranger, because an off-site link is exactly the shape an open proxy would take.
// The same rule siteUrl() applies in shared/panels.mjs, and it has to be the same rule:
// a board the keeper may put up is a board a link on it may reach. Written once here so
// the two cannot drift, since a mismatch reads as a link that silently does nothing.
function fetchable(u) {
  return u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname));
}

function target(home, to) {
  if (!to) return home;
  try {
    const u = new URL(String(to));
    if (!fetchable(u) || u.host !== home.host) return null;
    return u;
  } catch { return null; }
}

// Every URL in the page that the browser would otherwise resolve against *our* address.
// A <base> handles the ones we leave alone - stylesheets, images, fonts - by sending
// them straight to the far side, which is both less work and less of our origin lent
// out. Links are the exception: those have to come back through here, or the first one
// followed would drop the board back to being a cross-origin picture.
function rewrite(html, home, here, id, island) {
  const base = `<base href="${home.href.replace(/"/g, '&quot;')}">`;

  // Into <head> if there is one, and at the very front if there is not: a page without
  // a head still resolves its assets, and getting that wrong shows up as a site with no
  // styling at all rather than as an error.
  // The bridge goes in beside the <base>, at the top, so it is listening before the page
  // has finished arriving - a board pressed while the site is still loading should do
  // nothing rather than miss.
  const head = base + bridgeScript(island);
  let out = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => m + head)
    : head + html;

  out = out.replace(/(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi, (whole, lead, q, href) => {
    const raw = String(href).trim();
    // Left alone on purpose: an anchor stays on the page we are already showing, and
    // mail and telephone links are not ours to rewrite into a page fetch.
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) return whole;
    let abs;
    try { abs = new URL(raw, home); } catch { return whole; }
    // Off-site links are left pointing where they point. Following one takes the board
    // out of our origin and back to being unpressable, which is worth knowing about, but
    // fetching a stranger's site on the keeper's behalf is worse.
    if (!fetchable(abs) || abs.host !== home.host) return whole;
    // Absolute, against our own address. A relative one would be resolved against the
    // <base> just added - which points at the far side - so every rewritten link would
    // quietly lead back off the island, taking the board off our origin with it. That is
    // exactly the failure this rewrite exists to prevent, and it cost an afternoon.
    const through = `${here}?of=${encodeURIComponent(id)}&to=${encodeURIComponent(abs.href)}`;
    return `${lead}${q}${through}${q}`;
  });

  return out;
}


// ---------------------------------------------------------------- pages of our own
// What a browser should call a file, by its extension. Short on purpose: a board holds a
// page and what a page is made of, not a download folder.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

// A path under data/boards/, or null if it is trying to leave. The check is on the
// resolved path rather than on the text, because that is the only version of it the file
// system will agree with - `a/../../b` reads as innocent and is not.
function underBoards(rel) {
  const full = path.resolve(BOARDS, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  const root = path.resolve(BOARDS);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

// One file out of data/boards/. HTML gets the bridge, so a page of our own is worked the
// same way a site is; everything else is handed over as it lies.
export function serveBoardFile(rel, res, { island = '' } = {}) {
  const full = underBoards(decodeURIComponent(rel));
  if (!full) return refuse(res, 403, 'that is not on the board', island);

  let body;
  try { body = fs.readFileSync(full); }
  catch { return refuse(res, 404, 'no such page on this board', island); }

  const type = TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
  const head = {
    'content-type': type,
    'content-security-policy': policy(island),
    // A page being written is a page being reloaded; nothing here is worth a stale copy.
    'cache-control': 'no-store',
  };

  if (type.startsWith('text/html')) {
    const html = String(body).replace(/<head[^>]*>/i, (m) => m + bridgeScript(island));
    const out = Buffer.from(/<head[^>]*>/i.test(String(body)) ? html : bridgeScript(island) + String(body), 'utf8');
    res.writeHead(200, { ...head, 'content-length': out.length });
    return res.end(out);
  }

  res.writeHead(200, { ...head, 'content-length': body.length });
  return res.end(body);
}

// Answers a /billboard request, or returns false if it is not one this can serve - the
// caller then falls through to whatever it would otherwise have done.
export async function serveBillboard(url, res, { path = '/billboard', origin = '', island = '' } = {}) {
  const here = origin + path;
  const board = boardOf(url.searchParams.get('of'));
  if (!board) return refuse(res, 404, 'no such board', island);

  // A page of ours is not fetched from anywhere - it is read off the disk beside the
  // island, whole, with its own assets served from this same origin.
  if (board.page) return serveBoardFile(board.page, res, { island });

  const want = target(board.home, url.searchParams.get('to'));
  if (!want) return refuse(res, 403, 'that link leaves the board', island);

  let far;
  try {
    far = await fetch(want.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Asked for as a browser, because a good many sites hand a blank page to
        // anything that does not look like one.
        'user-agent': 'Mozilla/5.0 (compatible; Promptholm billboard)',
        accept: 'text/html,application/xhtml+xml,image/*,*/*;q=0.8',
        'accept-language': 'nl,en;q=0.8',
      },
    });
  } catch (err) {
    return refuse(res, 502, err && err.name === 'TimeoutError' ? 'the site did not answer' : 'the site could not be reached', island);
  }

  const type = far.headers.get('content-type') || 'application/octet-stream';
  const head = {};
  for (const [k, v] of far.headers) if (!DROP.has(k.toLowerCase())) head[k] = v;
  head['content-security-policy'] = policy(island);
  // Nothing here is the island's own, so none of it should end up in a cache that a
  // later visitor reads, and a board that has changed hands should not show the old site.
  head['cache-control'] = 'no-store';

  const body = Buffer.from(await far.arrayBuffer());
  if (body.length > MAX_BYTES) return refuse(res, 502, 'that page is too big for a board', island);

  // Only HTML is rewritten. Everything else - the odd image or stylesheet that came
  // through here rather than off the <base> - is passed along as it arrived.
  if (/\btext\/html\b/i.test(type)) {
    const html = rewrite(body.toString('utf8'), new URL(far.url || want.href), here, board.prop.id, island);
    const out = Buffer.from(html, 'utf8');
    res.writeHead(far.status, { ...head, 'content-type': 'text/html; charset=utf-8', 'content-length': out.length });
    return res.end(out);
  }

  res.writeHead(far.status, { ...head, 'content-length': body.length });
  return res.end(body);
}

// A refusal a person standing at the board can read, since this is drawn at eight metres
// across and a blank white board would read as the island being broken.
function refuse(res, code, why, island = '') {
  const page = `<!doctype html><meta charset="utf-8"><title>${why}</title>`
    + '<style>html,body{margin:0;height:100%;display:grid;place-items:center;'
    + 'background:#fff;color:#8b8378;font:400 34px/1.4 system-ui,sans-serif;text-align:center}</style>'
    + `<p>${why}</p>`;
  const out = Buffer.from(page, 'utf8');
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': out.length,
    'content-security-policy': policy(island),
    'cache-control': 'no-store',
  });
  res.end(out);
}
