// What a panel says. A face is one page of HTML, built once and handed to panels.js,
// which hangs it on a board somewhere on the island.
//
// A face is plain DOM and nothing else: no canvas, no iframe, no shadow root. That is
// deliberate. It is same-origin and scriptable, which is what makes a panel readable
// now and workable later - a click on a button in here can become a small message
// everybody else's copy replays.
//
// Adding a face: write a builder, key it into FACES under a name that would pass for a
// kind, and give it a rule or two in web/css/panels.css. A name nobody has written a
// face for falls back to the notice board, so a panel never comes up blank.
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

const FACES = { notice, clock };

export function knownFace(name) {
  return Object.prototype.hasOwnProperty.call(FACES, String(name));
}

// ctx is { prop, island }: what was written on this particular board, and a handful of
// getters onto the island for a face that wants to say something live.
export function createFace(name, ctx) {
  const build = FACES[name] || FACES.notice;
  return build(ctx);
}
