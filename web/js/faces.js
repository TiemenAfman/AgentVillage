// What a panel says. A face is one page of HTML, built once and handed to panels.js,
// which hangs it on a board somewhere on the island.
//
// A face is plain DOM and nothing else: no canvas, no iframe, no shadow root. That is
// deliberate. It is same-origin and scriptable, which is what makes a click on a button
// in here a small message everybody else's copy replays.
//
// One face breaks that rule on purpose - see billboard() at the bottom - and what it
// gives up is exactly what the rule was buying: a cross-origin page cannot be aimed at,
// read or shared. It is a thing to look at from a distance rather than a board to work.
//
// A face holds no state of its own. It gets `send(field, value)` to say what somebody
// asked for, and `draw(state)` to be told what the island now holds - and the two are
// never the same press: an intent goes to the server and the answer comes back to every
// copy of the board at once, ours included. What a face may store is declared in
// shared/panels.mjs, which the server reads too.
//
// Adding a face: write a builder, key it into FACES under a name that would pass for a
// kind, give it a rule or two in web/css/panels.css, and - if it remembers anything -
// declare its fields in shared/panels.mjs. A name nobody has written a face for falls
// back to the notice board, so a panel never comes up blank.
import { BILLBOARD, siteUrl, boardSite } from 'shared/panels.mjs';

// Re-exported because web/js/buildmenu.js asks this face what a usable address looks
// like before it hands a board over. The rule itself is shared with the server.
export { BILLBOARD, siteUrl };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SEASON_MARK = { spring: '🌱', summer: '☀️', autumn: '🍂', winter: '❄️' };

// A notice nailed to a board: whatever was written on the prop when it was put there.
// The default face, and the reason a panel with nothing said about it still reads as
// something somebody put up rather than as a bug.
function notice({ prop }) {
  const el = document.createElement('div');
  el.className = 'face face-notice';
  el.innerHTML = `
    <h1>${esc(prop.label || 'A notice')}</h1>
    <p>${esc(prop.note || 'Nothing is written on this one yet.')}</p>
    <footer>${prop.by ? `put up by ${esc(prop.by)}` : 'put up by hand'}</footer>`;
  return { el };
}

// The island's own clock, which is the cheapest possible proof that this is living DOM
// and not a picture of it: stand in front of it and the minutes go by.
function clock({ island }) {
  const el = document.createElement('div');
  el.className = 'face face-clock';
  el.innerHTML = `
    <h1></h1>
    <div class="clock-time">--:--</div>
    <div class="clock-season"></div>
    <ul class="clock-building"></ul>`;
  const head = el.querySelector('h1');
  const time = el.querySelector('.clock-time');
  const season = el.querySelector('.clock-season');
  const list = el.querySelector('.clock-building');

  let since = 1;   // redrawn on the first frame rather than after the first half second
  return {
    el,
    update(dt) {
      since += dt;
      if (since < 0.5) return;    // twice a second is as often as a clock has news
      since = 0;
      const hour = island.hour();
      const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
      head.textContent = island.name();
      time.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const s = island.season();
      season.textContent = `${SEASON_MARK[s] || ''} ${s.charAt(0).toUpperCase()}${s.slice(1)}`;
      const names = island.building();
      list.innerHTML = names.length
        ? `<li class="head">Building right now</li>${names.slice(0, 6).map((n) => `<li>${esc(n)}</li>`).join('')}`
          + (names.length > 6 ? `<li class="more">and ${names.length - 6} more</li>` : '')
        : '<li class="head">Nobody is building right now</li>';
    },
  };
}

// A hand tally on a board, and the reason it exists: it has a button to press, a field
// to type in and two sides to switch between, which between them are everything a panel
// has to survive. Stand at it and try to type "quit" - nothing gets planted, nothing is
// thought out loud, and no settler is spoken to.
//
// Its state is its own and goes no further than this screen. Somebody standing next to
// you sees a settler at a board and nothing on it.
function tally({ prop, send }) {
  const el = document.createElement('div');
  el.className = 'face face-tally';
  el.innerHTML = `
    <h1>${esc(prop.label || 'Tally')}</h1>
    <nav class="tabs">
      <button type="button" class="tab" data-tab="count">Count</button>
      <button type="button" class="tab" data-tab="note">Note</button>
    </nav>
    <section class="tab-body" data-body="count">
      <output class="tally-n">0</output>
      <div class="tally-keys">
        <button type="button" class="btn" data-step="-1">−1</button>
        <button type="button" class="btn" data-step="1">+1</button>
        <button type="button" class="btn quiet" data-reset>Reset</button>
      </div>
    </section>
    <section class="tab-body" data-body="note" hidden>
      <label>What is being counted<input class="tally-what" type="text" maxlength="40" placeholder="sheep, say"></label>
      <textarea class="tally-note" rows="3" maxlength="200" placeholder="Anything worth remembering about it."></textarea>
    </section>`;

  const out = el.querySelector('.tally-n');
  const what = el.querySelector('.tally-what');
  const note = el.querySelector('.tally-note');
  let held = { count: 0, what: '', note: '', tab: 'count' };

  el.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) { send('count', held.count + Number(step.dataset.step)); return; }
    if (e.target.closest('[data-reset]')) { send('count', 0); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) send('tab', tab.dataset.tab);
  });
  what.addEventListener('input', () => send('what', what.value));
  note.addEventListener('input', () => send('note', note.value));

  return {
    el,
    draw(state) {
      held = state;
      const name = String(state.what || '').trim();
      out.textContent = name ? `${state.count} ${name}` : String(state.count);
      // A field somebody is typing into is left alone. Writing the server's value back
      // under their hands would jump the caret to the end on every keystroke.
      if (document.activeElement !== what) what.value = state.what;
      if (document.activeElement !== note) note.value = state.note;
      for (const b of el.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === state.tab);
      for (const body of el.querySelectorAll('[data-body]')) body.hidden = body.dataset.body !== state.tab;
    },
  };
}

// Somebody else's website, on a board the size of a hoarding - and the one face that is
// not ours, which is what the exception in the header above is about.
//
// It is framed through the island's own address rather than straight off the far site.
// lib/billboard.mjs is where that is argued; from this side what it buys is that the
// page is same-origin, so elementAt() in web/js/panels.js can ask it what is under the
// pointer and a press lands the way it does on any other board. Framed the obvious way,
// it could not: the island aims the mouse with a raycaster, and a raycaster stops at the
// edge of a cross-origin document.
//
// The frame carries no `allow-scripts`. The page is running at our origin now, and the
// response says `script-src 'none'` for the same reason - two locks on one door, the
// care shared/panels.mjs takes over text, for a bigger risk. A hoarding is for reading
// and for following a link.
//
// Nothing of ours is laid over the site at all: the board is the page and the frame
// around it is the woodwork. The one thing drawn on top is the host, and only until the
// page has painted - see .bb-wait in web/css/panels.css - so a board that is still on
// its way says whose it is instead of standing there white.

// How much bigger the page is laid out than the board it is folded onto - the 266.6667%
// and scale(.375) in web/css/panels.css, as one number. Here as well as there because
// this is what turns a point on the board into a point on the page, and the two drifting
// apart would put the pointer somewhere the reader is not looking.
const BB_ZOOM = 0.375;

// Where the boards are served from, which is a port of its own rather than this one.
// Handed over by /api/hello, because the island picks the port; the fallback is only for
// a page opened before that answer arrives, and a board would come up blank rather than
// wrong. See lib/billboard.mjs for why it must not be this origin.
let BILLBOARD_ORIGIN = '';
export function setBillboardOrigin(origin) { BILLBOARD_ORIGIN = String(origin || ''); }

function billboard({ prop }) {
  const url = boardSite(prop);
  const el = document.createElement('div');
  el.className = 'face face-billboard';
  el.innerHTML = `
    <iframe class="bb-glass" title="${esc(prop.label || url.host)}" tabindex="-1"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerpolicy="no-referrer"></iframe>
    <div class="bb-wait">${esc(url.host)}</div>`;
  const frame = el.querySelector('iframe');
  frame.addEventListener('load', () => el.classList.add('lit'));

  // `allow-scripts` with `allow-same-origin` is the pairing every warning is about, and
  // it is safe here for the one reason those warnings turn on: the frame's origin is not
  // ours. It keeps the billboard port's origin, which holds nothing, so the page can do
  // as it likes inside it and still be unable to reach the island. Served from this
  // origin the same two flags would hand a stranger `parent.document`.

  // Everything said to the page goes this way. It is one-directional on purpose: the
  // island tells the page where the pointer is and never asks it anything, so nothing
  // about somebody else's site ever comes back across.
  function tell(msg) {
    const win = frame.contentWindow;
    if (!win || !BILLBOARD_ORIGIN) return false;
    try { win.postMessage(msg, BILLBOARD_ORIGIN); return true; } catch { return false; }
  }

  // A point on the board, in the face's own pixels, as a point in the page. The page is
  // laid out larger and folded down - the 266.6667% and scale(.375) in
  // web/css/panels.css - and undoing that fold is the whole conversion.
  //
  // The scroll is deliberately not part of it. That looks wrong and is not: the bridge
  // calls elementFromPoint(), which takes viewport coordinates, and a point on the board
  // already is one - the board shows whatever the frame currently shows. Correcting for
  // the scroll aims at where the text used to be, so a scrolled board quietly stops
  // answering. It cost an afternoon once already.
  const onPage = (x, y) => ({ x: x / BB_ZOOM, y: y / BB_ZOOM });

  let asked = false;
  return {
    el,
    // panels.js hands the point over rather than asking what is there: across an origin
    // there is nothing to hand back, and the highlight is put on from inside the page.
    // Answering true means the board took it.
    aimAt(x, y) {
      const at = onPage(x, y);
      return tell({ k: 'hover', x: at.x, y: at.y });
    },
    pressAt(x, y) {
      const at = onPage(x, y);
      return tell({ k: 'press', x: at.x, y: at.y });
    },
    // A hoarding taller than the board it is on. The wheel never reaches the page by
    // itself - nothing on this layer takes a pointer event - so the island hands it down.
    scrollBy(dy) {
      return tell({ k: 'scroll', dy: dy / BB_ZOOM });
    },
    update() {
      // update() only runs while the board is in view, so an island that opens with a
      // billboard behind a hill fetches nothing off somebody else's server until a
      // person has walked round and looked at it. It also waits for the port: without it
      // the board would ask this origin, which serves no boards.
      if (asked || !BILLBOARD_ORIGIN) return;
      asked = true;
      frame.src = `${BILLBOARD_ORIGIN}/billboard?of=${encodeURIComponent(prop.id)}`;
    },
  };
}

const FACES = { notice, clock, tally, billboard };

// The faces a board can carry, in the order they are written above - for the build menu,
// which asks which one a new panel should show.
export const FACE_NAMES = Object.keys(FACES);

export function knownFace(name) {
  return Object.prototype.hasOwnProperty.call(FACES, String(name));
}

// ctx is { prop, island, send }: what was written on this particular board, a handful of
// getters onto the island for a face that wants to say something live, and the way to
// ask for a field to change.
export function createFace(name, ctx) {
  const build = FACES[name] || FACES.notice;
  return build(ctx);
}
