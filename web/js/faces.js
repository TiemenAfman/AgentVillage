// What a panel says. A face is one page of HTML, built once and handed to panels.js,
// which hangs it on a board somewhere on the island.
//
// A face is plain DOM and nothing else: no canvas, no iframe, no shadow root. That is
// deliberate. It is same-origin and scriptable, which is what makes a click on a button
// in here a small message everybody else's copy replays.
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

const FACES = { notice, clock, tally };

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
