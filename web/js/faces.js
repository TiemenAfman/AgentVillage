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

// Somebody else's website, framed, on a board the size of a hoarding. The one face that
// is not ours, and the one that needs the exception in the header above.
//
// What it costs is everything the same-origin rule was buying. A cross-origin page can
// be drawn and nothing more: press() in web/js/panels.js hands its click to the <iframe>
// element and gets no further in, we cannot read a line of it, and there is no state to
// send anybody - two people standing at this board see the same site and neither can
// press a thing on it. That is the whole bargain, and it is the right one here: a
// billboard is read from the road.
//
// Nothing of ours is laid over the site except the strip with the address on it, which
// earns its place twice: it is what a hoarding has, and it is the only part still
// standing if the site ever starts refusing to be framed. That refusal is invisible from
// this side - cross-origin, so there is no load error to catch - so the blank it would
// leave has to read as a board with nothing on it rather than as a hole.
// Exported because the build menu asks for this one before it hands a board over, and
// fills the field with it. One address and one idea of what a usable one looks like,
// read by both, so the menu can never accept something the board then quietly replaces.
export const BILLBOARD = 'https://www.boikon.nl/';

// A board carries the site it was put up with: `--note https://...` on the prop. A whole
// URL, http or https. A bare host or a typo would frame nothing and there would be no
// error to say so, so those are refused; and so is anything that is not one of those two
// schemes, because javascript: and data: are not addresses but a way to run something on
// this page. http is allowed because the things worth hanging on a board on a private
// island sit on the same network as the island - a camera in the hall, a machine on the
// line, a printer's own status page - and none of them speak https.
//
// Anything refused falls back to the address above, so a mistake shows the wrong
// billboard rather than a broken one. Only the keeper can put a prop up - /api/build is
// not a public path - so this is the keeper's own choice, not a visitor's.
export function siteUrl(note) {
  try {
    const u = new URL(String(note || '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch { return null; }
}

// Whether an address is a picture rather than a page: a still, or the endless run of
// JPEGs a camera answers with. A picture does not belong in the frame. A frame is laid
// out at desktop width and folded down to the board - see web/css/panels.css - which is
// what a page needs, and what leaves a camera as a stamp in the corner of the board.
//
// The address is all there is to go on, because what is really there is only known once
// it arrives. So this is a guess, and a guess of a picture that turns out to be a page
// falls through to the frame below.
const PICTURE = /\.(jpe?g|png|gif|webp|avif|bmp|svg|mjpe?g)($|[?#])|mjpe?g|snapshot|(video|image|cam|jpg)\.cgi/i;

function billboard({ prop }) {
  const url = siteUrl(prop.note) || new URL(BILLBOARD);
  const el = document.createElement('div');
  el.className = 'face face-billboard';
  el.innerHTML = `
    <div class="bb-wait">${esc(url.host)}</div>
    <div class="bb-strip">${esc(url.host)}</div>`;
  const wait = el.querySelector('.bb-wait');

  let shown = null;        // the one element the address is shown in
  let lit = false;         // whether anything has ever arrived in it
  let fellBack = false;    // whether the guess above has already been given up on
  let releasing = false;   // whether we are the ones ending the stream

  // Hangs the address in an <img> or an <iframe>, over the strip and under the waiting
  // host. Replaced rather than reused, because an element that has been pointed at one
  // kind of thing does not become the other.
  function put(picture) {
    if (shown) shown.remove();
    shown = document.createElement(picture ? 'img' : 'iframe');
    shown.className = picture ? 'bb-shot' : 'bb-glass';
    // Fires for a cross-origin page too, which is as much as we are ever told about one.
    shown.addEventListener('load', () => { lit = true; el.classList.add('lit'); });
    if (picture) {
      shown.alt = '';
      // An <img> is the one thing on this board that says when it failed. Before anything
      // has arrived, that means the guess was wrong and the frame gets its turn. After
      // something has, it means a camera that was working has stopped, and a board that
      // empties itself is the honest picture of that.
      shown.addEventListener('error', () => {
        if (releasing) { releasing = false; return; }
        el.classList.remove('lit');
        if (lit || fellBack) return;
        fellBack = true;
        put(false);
        shown.src = url.href;
      });
    } else {
      shown.title = prop.label || url.host;
      shown.tabIndex = -1;
      shown.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      shown.setAttribute('referrerpolicy', 'no-referrer');
    }
    el.insertBefore(shown, wait);
  }

  let asked = false;
  let seenAt = 0;

  // A stream has no end. Left alone, a board behind a hill would go on pulling twenty-five
  // frames a second off somebody's camera for as long as the island is open, with nobody in
  // front of it. update() runs only while the board is in view, so this watches for the
  // moment it stops running and lets the stream go; the next look asks for it again. Only a
  // picture is ever let go - a framed page costs nothing once it has painted.
  const idle = setInterval(() => {
    if (!asked || !(shown instanceof HTMLImageElement)) return;
    if (performance.now() - seenAt < 4000) return;
    asked = false;
    lit = false;
    releasing = true;
    shown.src = '';            // what actually ends a stream; detaching it need not
    shown.remove();
    shown = null;
    el.classList.remove('lit');
  }, 2000);

  return {
    el,
    update() {
      // update() only runs while the board is in view, so an island that opens with a
      // billboard behind a hill fetches nothing off somebody else's server until a
      // person has walked round and looked at it.
      seenAt = performance.now();
      if (asked) return;
      asked = true;
      releasing = false;
      if (!shown) put(!fellBack && PICTURE.test(url.pathname + url.search));
      shown.src = url.href;
    },
    dispose() {
      clearInterval(idle);
      if (shown) shown.src = '';
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
