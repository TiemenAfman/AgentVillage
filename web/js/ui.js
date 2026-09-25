// Every pixel that is not the island: the title card, the dossier, the legend,
// the chronicle bar, the floating labels and the toasts.
import { PALETTE, TIER_LABEL } from './buildings.js';
import { CROPS, ripeIn } from 'shared/crops.mjs';
import { padKey } from './input.js';

const TIER_ORDER = ['tent', 'hut', 'cottage', 'house', 'manor', 'keep'];
const TIER_MIN = { tent: 1, hut: 3, cottage: 9, house: 21, manor: 51, keep: 121 };

const STYLE_BLURB = {
  fable: 'Fable — a tower with a copper observatory dome',
  opus: 'Opus — stone walls under a slate roof',
  sonnet: 'Sonnet — a timber-framed cottage with a green roof',
  haiku: 'Haiku — a small house under deep thatch',
  unknown: 'Model unknown — plain grey walls',
};

const ORNAMENTS = {
  forge: ['Forge', 'Heavy use of the shell'],
  lumber: ['Lumber pile', 'Wrote and edited many files'],
  lantern: ['Lantern', 'Spent its time reading and searching'],
  weathervane: ['Weathervane', 'Drove a browser'],
  pigeons: ['Pigeon loft', 'Fetched things from the web'],
  banner: ['Banner', 'Published an artifact'],
  lightningrod: ['Lightning rod', 'Weathered repeated API errors'],
};

const SHEDS = {
  explore: ['Lookout tent', 'Explore — searches the codebase'],
  plan: ['Drafting hut', 'Plan — designs the approach'],
  general: ['Workshop', 'general-purpose — does the legwork'],
  guide: ['Book kiosk', 'claude-code-guide — knows the manual'],
  other: ['Shed', 'Another kind of subagent'],
};

const fmtInt = (n) => (n || 0).toLocaleString('en-GB');
function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}
function fmtDuration(msv) {
  if (!msv || msv < 1000) return 'a moment';
  const s = Math.round(msv / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const el = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createUI(handlers) {
  const state = { filters: { code: true, cowork: true, apprentices: true }, open: null };

  // --- filters, legend, overview ------------------------------------------
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.filter;
      state.filters[k] = !state.filters[k];
      btn.classList.toggle('on', state.filters[k]);
      btn.setAttribute('aria-pressed', String(state.filters[k]));
      handlers.onFilters(state.filters);
    });
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(b.dataset.close)));
  el('legend-btn').addEventListener('click', () => (el('legend').hidden ? openLegend() : close('legend')));
  // Beside Legend rather than inside Settings, and it is the one chip that is not there
  // twice by accident: the Settings panel writes config.json on the machine the island
  // runs on and is hidden from everybody but the keeper (see setKeeper below), while how
  // loud somebody's own speakers are is theirs alone. So this is a chip, and what it
  // remembers lives in that browser's localStorage next to the avatar and the chat mode.
  el('sound-btn').addEventListener('click', () => handlers.onSound && handlers.onSound());
  el('settings-btn').addEventListener('click', () => (el('settings').hidden ? openSettings() : close('settings')));
  el('reset-btn').addEventListener('click', () => handlers.onOverview());
  el('clock-chip').addEventListener('click', () => handlers.onToggleTime());

  // Tucks the menu away - New settler through Overview - leaving the clock and the
  // Code/Cowork/Apprentices filters where they were. Remembered the same way the chat
  // mode and the avatar are: this browser's own localStorage, nothing sent anywhere.
  const NAV_KEY = 'promptholm.nav.collapsed';
  // With nothing remembered, a phone starts with it tucked away: at 390 wide the menu is
  // three rows over the top of the island. A choice somebody made either way still wins.
  let navCollapsed = matchMedia('(max-width: 480px)').matches;
  try { const kept = localStorage.getItem(NAV_KEY); if (kept !== null) navCollapsed = kept === '1'; } catch { /* no storage */ }
  function applyNavCollapsed() {
    el('nav-chips').hidden = navCollapsed;
    // The glyph itself stays '‹' - collapsed flips it 180deg in CSS rather than swapping
    // characters, so it keeps pointing at the menu it would bring back.
    el('nav-collapse-btn').classList.toggle('collapsed', navCollapsed);
    el('nav-collapse-btn').title = navCollapsed ? 'Show the menu' : 'Hide the menu';
  }
  applyNavCollapsed();
  el('nav-collapse-btn').addEventListener('click', () => {
    navCollapsed = !navCollapsed;
    try { localStorage.setItem(NAV_KEY, navCollapsed ? '1' : '0'); } catch { /* fine, just not remembered */ }
    applyNavCollapsed();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close('dossier'); close('legend'); close('settings'); }
    // Space belongs to the player on foot, where it jumps. Restarting the history from
    // under someone's feet is not what the key means down there.
    if (e.key === ' ' && e.target === document.body && !walking) { e.preventDefault(); el('play-btn').click(); }
  });

  function close(which) {
    el(which).hidden = true;
    if (which === 'dossier') { state.open = null; handlers.onSelect(null); }
    syncSidebar();
  }
  function openLegend() { el('dossier').hidden = true; el('settings').hidden = true; el('legend').hidden = false; syncSidebar(); }
  function openSettings() { el('dossier').hidden = true; el('legend').hidden = true; el('settings').hidden = false; syncSidebar(); handlers.onSettingsOpen && handlers.onSettingsOpen(); }
  // the right column holds one thing at a time, and on foot it holds nothing
  function syncSidebar() {
    const panelOpen = !el('dossier').hidden || !el('legend').hidden || !el('settings').hidden;
    el('building-now').hidden = walking || planning || panelOpen || !hasBuilders;
    const w = el('waiting-now');
    if (w) w.hidden = walking || planning || panelOpen || !w.querySelector('li');
    el('chronicle').hidden = walking || planning;
    el('legend-btn').classList.toggle('on', !el('legend').hidden);
    el('settings-btn').classList.toggle('on', !el('settings').hidden);
  }
  let hasBuilders = false;
  let walking = false;
  let planning = false;

  // --- chronicle -----------------------------------------------------------
  const range = el('chronicle-range');
  range.addEventListener('input', () => handlers.onScrub(Number(range.value) / 1000));
  el('play-btn').addEventListener('click', () => handlers.onPlay());
  el('live-btn').addEventListener('click', () => handlers.onLive());
  el('chronicle-speed').addEventListener('change', (e) => handlers.onSpeed(e.target.value));

  function setChronicle({ fraction, date, playing, live }) {
    if (fraction != null && document.activeElement !== range) range.value = String(Math.round(fraction * 1000));
    el('chronicle-date').textContent = date;
    el('play-btn').textContent = playing ? '❚❚' : '▶';
    el('live-btn').classList.toggle('on', !!live);
  }

  // --- header --------------------------------------------------------------
  function setVillage(v) {
    document.title = v.island.name;
    el('island-name').textContent = v.island.name;
    el('founded').textContent = `Founded ${new Date(v.island.foundedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const s = v.stats;
    const bits = [
      [s.settlers, s.settlers === 1 ? 'settler' : 'settlers'],
      [s.apprentices, s.apprentices === 1 ? 'apprentice' : 'apprentices'],
      [s.districts, s.districts === 1 ? 'district' : 'districts'],
    ];
    if (s.quayArrivals) bits.push([s.quayArrivals, 'at the quay']);
    let html = bits.map(([n, l]) => `<span><b>${fmtInt(n)}</b> ${l}</span>`).join('');
    if (s.nextMilestone) html += `<span title="Population milestone">${esc(s.nextMilestone.label)} in <b>${s.nextMilestone.remaining}</b></span>`;
    el('counts').innerHTML = html;
    for (const id of ['titlecard', 'topright']) el(id).hidden = false;
    el('chronicle').hidden = walking;
  }

  function setLive(mode) {
    const dot = el('live-dot');
    dot.classList.toggle('off', mode === 'off');
    dot.classList.toggle('replay', mode === 'replay');
    el('live-text').textContent = mode === 'off' ? 'Offline' : mode === 'replay' ? 'Replay' : 'Live';
  }

  function setClock(hour, seasonName) {
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    el('clock-chip').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${seasonName[0].toUpperCase()}${seasonName.slice(1)}`;
  }

  // --- now building --------------------------------------------------------
  function setBuilding(list, waiting = []) {
    const ul = el('building-list');
    renderWaiting(waiting);
    hasBuilders = list.length > 0;
    syncSidebar();
    if (!list.length) { ul.innerHTML = '<li class="empty">Nobody is building right now.</li>'; return; }
    ul.innerHTML = list.map((b) => `<li data-id="${esc(b.id)}"><span class="dot"></span>${esc(b.name)}<small>${esc(b.where)} · ${esc(b.since)}</small></li>`).join('');
    ul.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => handlers.onFocus(li.dataset.id)));
  }

  // --- who is waiting on you -----------------------------------------------
  // The flags on the island say where; this says who, and what they asked. It sits
  // above everything else because it is the one list with something owed in it.
  function renderWaiting(waiting) {
    const box = el('waiting-now');
    if (!box) return;
    box.hidden = !waiting.length;
    if (!waiting.length) return;
    const asked = waiting.filter((w) => w.asked).length;
    el('waiting-head').textContent = asked
      ? `${asked} question${asked > 1 ? 's' : ''} for you`
      : `Waiting for you · ${waiting.length}`;
    el('waiting-list').innerHTML = waiting.map((w) => `
      <li data-id="${esc(w.id)}" class="${w.asked ? 'asked' : ''}">
        <span class="pennant"></span>${esc(w.name)}
        <small>${esc(w.since)} · ${esc(w.question || '')}</small>
      </li>`).join('');
    el('waiting-list').querySelectorAll('li[data-id]').forEach((li) =>
      li.addEventListener('click', () => handlers.onFocus(li.dataset.id)));
  }

  // --- dossier -------------------------------------------------------------
  function showDossier(b, ctx) {
    state.open = b.id;
    el('legend').hidden = true;
    el('settings').hidden = true;
    el('dossier').hidden = false;
    syncSidebar();
    el('dossier-name').textContent = b.name;
    const pal = PALETTE[b.style] || PALETTE.unknown;
    const kindChip = b.kind === 'shed' ? `Apprentice · ${esc(b.agentType || 'Agent')}`
      : b.kind === 'civic' ? 'Village'
        : b.visitor ? 'Visiting'
          : b.harbour ? 'Cowork' : 'Code';
    const rows = [];
    if (b.visitor) rows.push(['Here for', 'One job. This settler packs up when the work is done.']);
    if (b.title && b.kind !== 'civic') rows.push(['Session', esc(b.title)]);
    if (b.model) rows.push(['Model', esc(STYLE_BLURB[b.style] || b.model)]);
    if (b.kind !== 'civic') {
      rows.push(['Project', b.districtName
        ? `<span title="${esc(b.cwd || '')}">${esc(b.districtName)}</span>`
          + (b.subPath ? ` <small>/ ${esc(b.subPath)}</small>` : '')
          + (b.outpost ? ` <small>(outpost ${esc(b.outpost.name)})</small>` : '')
        : '—']);
      if (b.gitBranch) rows.push(['Branch', esc(b.gitBranch)]);
    }
    rows.push([b.kind === 'civic' ? 'Built' : 'Started', fmtDate(b.startedAt)]);
    if (b.kind !== 'civic') {
      rows.push([b.active ? 'Running for' : 'Lasted', fmtDuration(b.active ? Date.now() - new Date(b.startedAt).getTime() : b.stats.durationMs)]);
    }

    let html = `<div class="tagrow"><span class="tag style" style="background:${cssHex(pal.trim)}">${kindChip}</span>`;
    if (b.founder) html += '<span class="tag">Founder</span>';
    if (b.active) html += '<span class="tag">Building now</span>';
    if (b.archived) html += '<span class="tag">Archived</span>';
    html += '</div>';
    // What they are waiting on you for, and the way to answer, before anything else. The
    // "question for you" list is how most people arrive here, and the question itself used
    // to be nowhere in the dossier, with Talk below the fold - on a phone, five screens down.
    const w = b.waiting;
    if (w && w.question) {
      html += `<div class="ask${w.asked ? ' asked' : ''}"><h3 class="sec">${w.asked ? 'Asks you' : 'Waiting for you'}</h3>`
        + `<p>${esc(w.question)}</p></div>`;
    }
    html += `<p class="dossier-actions">
      ${b.kind === 'civic' || !b.sessionId ? '' : `<button class="btn primary" id="talk-btn">${w ? 'Answer' : 'Talk to them'}</button>`}
      ${b.civicType === 'market' ? '<button class="btn primary" id="stall-btn">The seed stall</button>' : ''}
      <button class="btn" id="focus-btn">Focus camera</button>
    </p>`;
    html += `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

    if (b.kind !== 'civic') {
      const tierIdx = TIER_ORDER.indexOf(b.tier);
      const next = TIER_ORDER[tierIdx + 1];
      html += '<h3 class="sec">The house</h3>';
      html += `<p style="margin:0 0 10px">${esc(TIER_LABEL[b.tier] || 'Shed')} · ${fmtInt(b.stats.humanTurns)} ${b.stats.humanTurns === 1 ? 'turn' : 'turns'}`;
      if (next) html += `<br><small style="color:var(--ink-dim)">Grows into a ${TIER_LABEL[next].toLowerCase()} at ${TIER_MIN[next]} turns</small>`;
      html += '</p>';

      const stats = [
        ['Tool calls', fmtInt(b.stats.toolCalls)],
        ['Files touched', fmtInt(b.stats.filesTouched)],
        ['Tokens out', fmtTokens(b.stats.tokens.output)],
        ['Cache read', fmtTokens(b.stats.tokens.cacheRead)],
      ];
      if (b.stats.apiErrors) stats.push(['API errors', fmtInt(b.stats.apiErrors)]);
      if (b.stats.publishes) stats.push(['Artifacts', fmtInt(b.stats.publishes)]);
      html += `<dl class="kv">${stats.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

      const tools = Object.entries(b.tools || {}).slice(0, 6);
      if (tools.length) {
        const max = Math.max(...tools.map((t) => t[1]));
        html += '<h3 class="sec">Tools</h3><div class="bars">';
        for (const [name, n] of tools) {
          html += `<div class="bar"><span title="${esc(name)}">${esc(name)}</span><i style="width:${Math.max(6, (n / max) * 100)}%"></i><b>${fmtInt(n)}</b></div>`;
        }
        html += '</div>';
      }

      if ((b.ornaments || []).length) {
        html += '<h3 class="sec">On the plot</h3><ul class="list">';
        for (const o of b.ornaments) {
          const [n, why] = ORNAMENTS[o] || [o, ''];
          html += `<li><b>${esc(n)}</b> <small>— ${esc(why)}</small></li>`;
        }
        html += '</ul>';
      }

      if ((b.sheds || []).length) {
        html += `<h3 class="sec">Apprentices (${b.sheds.length})</h3><ul class="list">`;
        for (const sid of b.sheds) {
          const s = ctx.get(sid);
          if (!s) continue;
          const [label] = SHEDS[s.shedType] || SHEDS.other;
          html += `<li><b class="clickable" data-goto="${esc(sid)}">${esc(s.agentType)}</b> <small>— ${esc(label)}${s.description ? `: ${esc(s.description)}` : ''}</small></li>`;
        }
        html += '</ul>';
      }
      if (b.master) {
        const m = ctx.get(b.master);
        if (m) html += `<h3 class="sec">Serves</h3><p style="margin:0"><span class="clickable" data-goto="${esc(b.master)}">${esc(m.name)}</span></p>`;
      }
      if (b.models && Object.keys(b.models).length > 1) {
        html += '<h3 class="sec">Models used</h3><ul class="list">';
        for (const [m, n] of Object.entries(b.models)) html += `<li>${esc(m)} <small>— ${fmtInt(n)} messages</small></li>`;
        html += '</ul>';
      }
      html += `<h3 class="sec">Session</h3><p class="mono">${esc(b.sessionId || '')}</p>`;
    } else if (b.title) {
      html += `<p style="margin:0 0 12px">${esc(b.title)}</p>`;
    }
    // The one destructive button stays down here, a long way from Answer.
    if (b.kind !== 'civic') html += '<p class="dossier-actions end"><button class="btn danger" id="exile-btn">Send off the island</button></p>';

    const body = el('dossier-body');
    body.innerHTML = html;
    body.scrollTop = 0;
    body.querySelector('#focus-btn').addEventListener('click', () => handlers.onFocus(b.id));
    const talk = body.querySelector('#talk-btn');
    if (talk) talk.addEventListener('click', () => handlers.onTalk(b.id));
    const stall = body.querySelector('#stall-btn');
    if (stall) stall.addEventListener('click', () => handlers.onMarket());
    const exile = body.querySelector('#exile-btn');
    if (exile) exile.addEventListener('click', () => handlers.onSendAway(b.id));
    body.querySelectorAll('[data-goto]').forEach((n) => n.addEventListener('click', () => handlers.onFocus(n.dataset.goto)));
  }

  function buildLegend(village) {
    let html = '<h3 class="sec" style="margin-top:0">Who lives where</h3>';
    for (const k of ['fable', 'opus', 'sonnet', 'haiku', 'unknown']) {
      html += legendItem(PALETTE[k].wall, PALETTE[k].name, STYLE_BLURB[k].replace(/^[^—]*— /, ''));
    }
    html += '<h3 class="sec">Houses grow with the session</h3><ul class="list">';
    for (const t of TIER_ORDER) html += `<li><b>${TIER_LABEL[t]}</b> <small>— from ${TIER_MIN[t]} ${TIER_MIN[t] === 1 ? 'turn' : 'turns'}</small></li>`;
    html += '</ul>';
    html += '<h3 class="sec">What a session leaves behind</h3><ul class="list">';
    for (const [k, [n, why]] of Object.entries(ORNAMENTS)) html += `<li><b>${n}</b> <small>— ${why}</small></li>`;
    html += '</ul>';
    html += '<h3 class="sec">Apprentices</h3><ul class="list">';
    for (const [, [n, why]] of Object.entries(SHEDS)) html += `<li><b>${n}</b> <small>— ${why}</small></li>`;
    html += '</ul>';
    html += '<h3 class="sec">The village grows</h3><ul class="list">';
    for (const m of village.milestones) {
      html += `<li>${m.unlocked ? '✓' : '○'} <b>${esc(m.label)}</b> <small>— at ${m.at} settlers</small></li>`;
    }
    html += '</ul>';
    html += '<h3 class="sec">Also on the island</h3><ul class="list">'
      + '<li><b>Scaffolding</b> <small>— that session is running right now</small></li>'
      + '<li><b>Campfire</b> <small>— a settler just arrived, no transcript yet</small></li>'
      + '<li><b>Quay houses on stilts</b> <small>— Cowork tasks from when they still ran on this machine</small></li>'
      + '<li><b>A fenced green with a sign</b> <small>— one hamlet per git repository, from its third session</small></li>'
      + '<li><b>A lone farmhouse in the fields</b> <small>— a project with one or two sessions</small></li>'
      + '<li><b>Ploughed fields and orchards</b> <small>— countryside nobody has claimed</small></li>'
      + '<li><b>A kitchen garden</b> <small>— land inside a hamlet nobody has built on</small></li>'
      + '<li><b>Outposts</b> <small>— sessions in a git worktree; named on the house itself</small></li>'
      + '</ul>';
    el('legend-body').innerHTML = html;
  }
  function legendItem(hex, name, blurb) {
    return `<div class="legend-item"><span class="sw" style="background:${cssHex(hex)}"></span><div><b>${esc(name)}</b><small>${esc(blurb)}</small></div></div>`;
  }

  // --- settings ------------------------------------------------------------
  // Only ever shown to the keeper: every setting in here is written into config.json on
  // the machine the island runs on, and the server refuses a visitor the route anyway.
  // So the chip stays hidden rather than offering a panel that cannot do anything.
  const NAMEPLATES = [
    ['everyone', 'Everyone', 'Visitors read the signs too.'],
    ['keeper', 'Only me', 'A visitor walks past empty front yards, and is never sent the lettering.'],
    ['nobody', 'Nobody', 'No signs at all, here or for a visitor.'],
  ];
  let signMode = null;

  // Building by hand - the Build chip, the B key, the catalogue and the ghost - is off
  // unless somebody switches it on under Debug. The planner is how the town is kept now;
  // the old way stays reachable for trying things, not as a second way of doing the same
  // job. Per browser, like the sound: it changes nothing on the island, only what this
  // page offers, so it is not a config.json setting the islander has to write down.
  const BUILD_KEY = 'promptholm.debug.build';
  let buildOn = false;
  try { buildOn = localStorage.getItem(BUILD_KEY) === '1'; } catch { /* private window: off */ }
  function applyBuild() { el('build-btn').hidden = !buildOn; }
  applyBuild();

  // The planner moves hamlets on this machine's layout, so like Settings it is the keeper's.
  function setKeeper(keeper) { el('settings-btn').hidden = !keeper; el('plan-btn').hidden = !keeper; }

  // The app on a phone: on foot for good, so the ways up to the sky and into the planner
  // go, and so does building. A class on body rather than `hidden`, because other setters
  // (setWalking among them) hand some of these chips their `hidden` back later.
  function setStandalone() { document.body.classList.add('standalone'); }

  // The Sound chip. `on` is what the person asked for, which is not the same as whether a
  // note is playing: a browser will not start an AudioContext until the page has been
  // touched, so somebody who left it on last time sees a lit chip a moment before they
  // hear anything. Drawing the intent rather than the graph is what stops the first click
  // on the chip from meaning "off" to a page that had already restored it.
  function setSound(on, possible = true) {
    const b = el('sound-btn');
    if (!b) return;
    b.hidden = !possible;
    b.classList.toggle('on', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on
      ? 'The sea, the wind and the village — click to silence'
      : 'The sea, the wind and the village — off';
  }

  // The server owns this setting, so the panel never decides for itself what is on:
  // it draws whatever came back, and a click only asks.
  function setSigns(mode) {
    signMode = mode;
    renderSettings();
  }

  // Which world this island is in. Only ever offered here, to the keeper, because all
  // three answers are things the *islander* does: single player and hosting both start a
  // sea in its process, and joining points it at somebody else's. A page with no islander
  // of its own - a phone, a second screen - has nothing to choose and is shown nothing.
  const MODES = [
    ['single', 'On my own', 'A sea of one, on this machine. Nobody else can reach it.'],
    ['host', 'Host', 'The same sea, open to the network, for other islands to join.'],
    ['join', 'Join', 'Somebody else’s sea. Pick one below.'],
  ];
  let seas = null;

  function setSeas(data) { seas = data; renderSettings(); }

  // How big the island may grow (Plans/eiland-laten-groeien.md): `maxGridSize`, asked of the
  // islander when Settings opens. The island grows by itself when its village needs room and
  // never shrinks, so a size below the one it already has is offered but cannot be chosen.
  let islandSize = null;
  function setIslandSize(data) { islandSize = data; renderSettings(); }

  function sizeSection() {
    if (!islandSize) return '';
    const { size, max, choices = [] } = islandSize;
    const km = (n) => `${(n * 4 / 1000).toFixed(1).replace(/.0$/, '')} km`;   // a cell is 4 m
    return '<h3 class="sec">Island size</h3>'
      + `<p class="muted" style="margin:0 0 9px">The island grows by itself when its village needs room: a ring of new coast, with the quay and the harbours moving out to it. It never shrinks. This is how far it may go.</p>`
      + `<div class="chips wrap">${choices.map((n) => `<button class="chip${n === max ? ' on' : ''}" data-islandsize="${n}"${n < size ? ' disabled title="Smaller than the island already is"' : `title="${n} × ${n} cells, ${km(n)} across"`}>${n}</button>`).join('')}</div>`
      + `<p class="muted" style="margin-top:9px">Now ${size} × ${size} cells (${km(size)} across), may grow to ${max} × ${max}. Bigger islands cost more to draw, for you and for everybody sailing past.</p>`;
  }

  function seaSection() {
    if (!seas) return '<h3 class="sec">The sea</h3><p class="muted">Asking around…</p>';
    const chosen = MODES.find(([k]) => k === seas.mode) || MODES[0];
    // One row per sea: a dot for whether it answers, the name, and underneath where it came
    // from and what is in it. The count used to read "2 islands, 1 here" beside a separate
    // "here" meaning *you* are here, and an address with no name ran over two lines.
    const rows = (seas.seas || []).map((o) => {
      const here = o.url === seas.current || (o.mine && seas.mode !== 'join');
      const said = o.up
        ? `${o.islands ?? 0} island${o.islands === 1 ? '' : 's'} · ${o.players ?? 0} online`
        : esc(o.why || 'no answer');
      // 'open' is the always-on sea; 'known' used to be labelled that way from before it
      // had its own entry, and called every saved address "always on".
      const from = o.from === 'network' ? 'on this network' : o.from === 'open' ? 'always on' : o.mine ? 'mine' : 'saved';
      const name = o.name || String(o.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      return `<div class="sea-row${here ? ' here' : ''}${o.up ? '' : ' down'}">`
        + `<i class="sea-dot" title="${o.up ? 'Answering' : 'Not answering'}"></i>`
        + `<span class="sea-what"><b title="${esc(o.url || '')}">${esc(name)}</b><small>${esc(from)} · ${said}</small></span>`
        + (here ? '<span class="tag here">You are here</span>'
          : `<button class="chip" data-sea="${esc(o.url)}"${o.up ? '' : ' disabled'}>Join</button>`)
        + '</div>';
    }).join('') || '<p class="muted">No seas found yet.</p>';
    return '<h3 class="sec">The sea</h3>'
      + `<p class="muted" style="margin:0 0 9px">Which world this island lives in. Everyone in one sea sees each other's coasts, settlers and boats.</p>`
      + `<div class="chips wrap">${MODES
        .map(([k, label]) => `<button class="chip${k === seas.mode ? ' on' : ''}" data-seamode="${k}">${label}</button>`).join('')}</div>`
      + `<p class="muted" style="margin:9px 0">${esc(chosen[2])}</p>`
      + rows
      + `<div style="display:flex;gap:6px;margin-top:8px"><input id="sea-url" class="field" placeholder="http://address:4750/" style="flex:1"><button class="chip" id="sea-add">Add</button></div>`;
  }

  function renderSettings() {
    const chosen = NAMEPLATES.find(([k]) => k === signMode);
    el('settings-body').innerHTML = '<h3 class="sec" style="margin-top:0">House signs</h3>'
      + `<p class="muted" style="margin:0 0 9px">The board in a settler's front yard carries the session's own title — which is the prompt it opened with.</p>`
      + `<div class="chips wrap">${NAMEPLATES
        .map(([k, label]) => `<button class="chip${k === signMode ? ' on' : ''}" data-signs="${k}">${label}</button>`).join('')}</div>`
      + `<p class="muted" style="margin-top:9px">${esc(chosen ? chosen[2] : 'Asking the island…')}</p>`
      + sizeSection()
      + seaSection()
      + '<h3 class="sec">Debug</h3>'
      + `<div class="chips wrap"><button class="chip${buildOn ? ' on' : ''}" data-buildmode="1" aria-pressed="${buildOn}">Build mode</button></div>`
      + `<p class="muted" style="margin-top:9px">${buildOn
        ? 'Building by hand is on: the Build chip and <kbd>B</kbd> put shapes in your hand.'
        : 'Off. The town is kept from the planner now (<b>Plan</b>); this brings back the old Build chip and <kbd>B</kbd>.'}</p>`;
    el('settings-body').querySelectorAll('[data-signs]')
      .forEach((b) => b.addEventListener('click', () => handlers.onSigns(b.dataset.signs)));
    el('settings-body').querySelectorAll('[data-buildmode]').forEach((b) => b.addEventListener('click', () => {
      buildOn = !buildOn;
      try { if (buildOn) localStorage.setItem(BUILD_KEY, '1'); else localStorage.removeItem(BUILD_KEY); } catch { /* kept for this page only */ }
      applyBuild();
      renderWalkKeys();       // the B in the key row comes and goes with it
      renderSettings();
      if (handlers.onBuildMode) handlers.onBuildMode(buildOn);
    }));
    el('settings-body').querySelectorAll('[data-islandsize]')
      .forEach((b) => b.addEventListener('click', () => handlers.onIslandSize && handlers.onIslandSize(Number(b.dataset.islandsize))));
    el('settings-body').querySelectorAll('[data-seamode]')
      .forEach((b) => b.addEventListener('click', () => handlers.onSeaMode(b.dataset.seamode)));
    el('settings-body').querySelectorAll('[data-sea]')
      .forEach((b) => b.addEventListener('click', () => handlers.onJoinSea(b.dataset.sea)));
    const add = el('settings-body').querySelector('#sea-add');
    if (add) add.addEventListener('click', () => {
      const field = el('settings-body').querySelector('#sea-url');
      if (field && field.value.trim()) handlers.onJoinSea(field.value.trim());
    });
  }
  renderSettings();

  // --- labels & toasts -----------------------------------------------------
  const labelRoot = el('labels');
  const labelPool = [];
  function labels(items) {
    while (labelPool.length < items.length) {
      const d = document.createElement('div');
      d.className = 'label';
      labelRoot.appendChild(d);
      labelPool.push(d);
    }
    labelPool.forEach((d, i) => {
      const it = items[i];
      if (!it) { d.style.display = 'none'; return; }
      d.style.display = '';
      d.textContent = it.text;
      // `above` arrives from a beacon on the network, so it is written as an attribute and
      // drawn by the stylesheet: attr() puts text on the page, never markup.
      if (it.above) d.dataset.above = it.above; else delete d.dataset.above;
      d.className = `label${it.build ? ' build' : ''}${it.above ? ' over' : ''}`;
      d.style.transform = `translate(${it.x}px, ${it.y}px) translate(-50%, -100%)`;
    });
  }

  // Hamlet names, as map captions rather than tooltips. On a wooden board at overview
  // distance the lettering is about four pixels tall, so the world sign alone cannot make
  // the island read as a set of named settlements - these can, and they fade out again as
  // soon as you are close enough to read the boards.
  const hamletPool = [];
  function hamletLabels(items) {
    while (hamletPool.length < items.length) {
      const d = document.createElement('div');
      d.className = 'hamlet-label';
      labelRoot.appendChild(d);
      hamletPool.push(d);
    }
    hamletPool.forEach((d, i) => {
      const it = items[i];
      if (!it) { d.style.display = 'none'; return; }
      d.style.display = '';
      // Measured once per name rather than per frame: offsetWidth after a write is a layout,
      // and twenty of those a frame is a stall. A zero means it was measured while hidden.
      if (d._text !== it.text) { d.textContent = it.text; d._text = it.text; d._w = 0; }
      if (!d._w) d._w = d.offsetWidth;
      // A caption the screen edge cuts through read as a fragment of another word - "PLC",
      // "CU COMPLETEPROJECT", a lone "-A" under the title card. It fades out over the last
      // 24 px before its end would leave the screen, and is gone once it does.
      const room = Math.min(it.x - d._w / 2, innerWidth - (it.x + d._w / 2));
      const edge = room >= 24 ? 1 : room <= 0 ? 0 : room / 24;
      d.style.opacity = String(it.opacity * edge);
      d.style.color = `hsl(${it.hue} 60% 82%)`;
      d.style.transform = `translate(${it.x}px, ${it.y}px) translate(-50%, -100%)`;
    });
  }

  const hover = el('hover-label');
  function setHover(item) {
    if (!item) { hover.hidden = true; return; }
    hover.hidden = false;
    hover.innerHTML = `${esc(item.name)}${item.sub ? `<small>${esc(item.sub)}</small>` : ''}`;
    hover.style.left = `${item.x}px`;
    hover.style.top = `${item.y}px`;
  }

  function toast(html, wire) {
    const d = document.createElement('div');
    d.className = 'card toast';
    d.innerHTML = html;
    el('toasts').appendChild(d);
    if (wire) wire(d);
    setTimeout(() => { d.classList.add('fade'); setTimeout(() => d.remove(), 600); }, wire ? 11000 : 5600);
    const kids = el('toasts').children;
    while (kids.length > 4) kids[0].remove();
  }

  // Somebody in this world is running different code.
  //
  // A toast is wrong for this and a console warning is worse. Three machines make a world
  // now - this page, the islander that packed a bundle, and whichever islander packed
  // somebody else's - and when their shared/terrain.mjs disagree, an island is drawn in
  // the wrong shape: houses in the sea, a coast where a field was. Nothing crashes and
  // nothing is logged where anybody looks, so it gets reported as "the island looks
  // strange" weeks later.
  //
  // So it stays on screen, and it names who is out of step rather than saying that
  // somebody is. One line per island, because two out of date is a different conversation
  // from one.
  const skewed = new Map();
  function setSkew(id, name) {
    if (name) skewed.set(id, name); else skewed.delete(id);
    const box = el('skew');
    if (!skewed.size) { box.hidden = true; box.innerHTML = ''; return; }
    const who = [...skewed.values()];
    box.hidden = false;
    box.innerHTML = `<b>Out of step.</b> ${esc(who.join(', '))} ${who.length === 1 ? 'is' : 'are'} `
      + 'running a different version of the island, so their land is drawn from numbers this '
      + 'page disagrees with. Pull and restart on both sides.';
  }

  // Who is behind, this page or the sea (web/js/update.js builds the words). Closed by
  // hand it stays closed for the rest of the visit: it says the same thing until somebody
  // installs something, and that is not going to happen mid-walk.
  let updateClosed = false;
  el('update-close').addEventListener('click', () => { updateClosed = true; el('update').hidden = true; });
  function setUpdate(html) {
    const box = el('update');
    el('update-text').innerHTML = html || '';
    box.hidden = !html || updateClosed;
  }

  // The app's update gate (web/js/update.js, updateGate). Blocking means no Later: a refused
  // app has nothing behind the card to go back to. A Later is kept for the visit, like the
  // banner's ×, so the next welcome does not put the same card back up.
  let gateLater = false;
  el('update-gate-later').addEventListener('click', () => { gateLater = true; el('update-gate').hidden = true; });
  function setGate(gate) {
    const box = el('update-gate');
    if (!gate || (!gate.blocking && gateLater)) { box.hidden = true; return; }
    el('update-gate-title').textContent = gate.title;
    el('update-gate-body').textContent = gate.body;
    el('update-gate-steps').textContent = gate.steps;
    el('update-gate-download').href = gate.download;
    el('update-gate-notes').href = gate.notes;
    el('update-gate-later').hidden = !!gate.blocking;
    // The small banner says the same thing in fewer words; with the card up it is noise.
    el('update').hidden = true;
    box.hidden = false;
  }

  // Getting out of the app, for the two links on that card and the one in the banner.
  //
  // In the phone app the page is Tauri's own (tauri.localhost), so it can ask the opener
  // plugin itself over IPC - the documented way, and the one that does not depend on
  // src-android/src/lib.rs's on_navigation being handed the click by the webview. That is
  // what the download button did up to v0.5.0, and what it did was nothing at all: the
  // navigation was cancelled, `open_url` failed for want of "opener:default" in
  // src-android/capabilities/default.json, and the error went into a `let _ =`.
  //
  // Nowhere else does this run. A browser tab has no __TAURI_INTERNALS__, and neither does
  // the desktop window: its page is remote (http://localhost:4747), so no IPC is opened to
  // it on purpose and src-tauri/src/lib.rs hands links to the system browser instead.
  const ipc = globalThis.__TAURI_INTERNALS__;
  if (ipc && typeof ipc.invoke === 'function') {
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href^="http"]');
      if (!a) return;
      e.preventDefault();
      // Said out loud when it fails. A button that quietly does nothing is exactly the bug
      // this replaces, and on a phone there is no console anybody is going to look at.
      ipc.invoke('plugin:opener|open_url', { url: a.href })
        .catch(() => toast(`Could not open <b>${esc(a.href)}</b>. Copy it into your browser.`));
    });
  }

  // The two-step confirmation shown while walking, before anyone is sent away.
  function setConfirm(item) {
    const p = el('walk-confirm');
    if (!item) { p.hidden = true; return; }
    p.hidden = false;
    // On the pad there is no cancel to offer - B crouches - so the way out is to wait:
    // the confirmation lapses on its own.
    const key = padConnected ? padKey('walk', 'secondary') : 'X';
    p.innerHTML = `Send <b>${esc(item.name)}</b> off the island? `
      + `<span class="muted">Press ${key} again to confirm${padConnected ? '' : ', Esc to leave them be'}</span>`;
  }

  // --- walking -------------------------------------------------------------
  let padConnected = false;
  // Indoors most of the keys mean nothing - there is nothing to sow in a tavern and nobody
  // to send off the island from a bar stool - so the row says what there is instead.
  let indoors = false;
  // What each mouse button does now - one button per hand (walk.js): 'attack', 'block' for a
  // shield, 'drink' for a beer (Plans/bier-en-dronken.md). main.js asks the walk every frame,
  // so only a change - something else picked up in the inventory, a room entered - redraws
  // the row.
  let lmbDoes = 'attack', rmbDoes = 'attack';
  function setMouse(lmb, rmb) {
    if (lmb === lmbDoes && rmb === rmbDoes) return;
    lmbDoes = lmb; rmbDoes = rmb;
    renderWalkKeys();
  }
  const MOUSE_SAYS = { attack: 'attack', block: 'hold to block', drink: 'drink' };
  const mouseKey = (button, does) => `<span><kbd>${button}</kbd> ${MOUSE_SAYS[does] || MOUSE_SAYS.attack}</span>`;
  function setPad(on) { padConnected = on; renderWalkKeys(); }
  function setIndoors(on) { indoors = !!on; renderWalkKeys(); }
  function renderWalkKeys() {
    // Indoors the room's row has no fight in it, but a pint at the bar is the point of the
    // place, so a button that drinks is still said.
    const drinks = (lmbDoes === 'drink' ? mouseKey('LMB', 'drink') : '') + (rmbDoes === 'drink' ? mouseKey('RMB', 'drink') : '');
    if (indoors) {
      el('walk-keys').innerHTML = padConnected
        ? `<span class="pad-dot"><i></i>Controller</span><span>Left stick walk</span><span>Right stick look</span>`
          + `<span class="lit"><kbd>${padKey('inside', 'interact')}</kbd> sit down</span>`
          + `<span><kbd>${padKey('inside', 'jump')}</kbd> jump</span><span><kbd>${padKey('inside', 'crouch')}</kbd> crouch</span>`
          + `<span><kbd>${padKey('inside', 'sprint')}</kbd> run</span><span><kbd>${padKey('inside', 'exit')}</kbd> step outside</span>`
        : `<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span>`
          + `<span>mouse to look, <kbd>Esc</kbd> frees it, click takes it back</span>`
          + drinks
          + `<span><kbd>Shift</kbd> run</span><span class="lit"><kbd>E</kbd> sit down</span>`
          + `<span><kbd>Esc</kbd><kbd>Esc</kbd> step outside</span>`;
      return;
    }
    el('walk-keys').innerHTML = padConnected
      ? `<span class="pad-dot"><i></i>Controller</span><span>Left stick walk</span><span>Right stick look</span>`
        + `<span><kbd>${padKey('walk', 'interact')}</kbd> talk</span>`
        + `<span><kbd>${padKey('walk', 'secondary')}</kbd> send away</span>`
        + `<span class="lit"><kbd>${padKey('walk', 'primary')}</kbd> sow</span>`
        + `<span><kbd>${padKey('walk', 'prevTool')}</kbd><kbd>${padKey('walk', 'nextTool')}</kbd> seed</span>`
        + `<span><kbd>${padKey('walk', 'jump')}</kbd> jump</span><span><kbd>${padKey('walk', 'crouch')}</kbd> crouch, hold to lie down</span>`
        + `<span><kbd>${padKey('walk', 'sprint')}</kbd> run</span><span><kbd>${padKey('walk', 'bike')}</kbd> bike</span>`
        + `<span><kbd>${padKey('walk', 'exit')}</kbd> back to the sky</span>`
      : `<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span><span>mouse to look, <kbd>Esc</kbd> frees it, click takes it back</span>`
        // The left button is the left hand and the right the right, so each says what its
        // own hand does rather than one line explaining the rule.
        + mouseKey('LMB', lmbDoes) + mouseKey('RMB', rmbDoes)
        + `<span><kbd>Shift</kbd> run</span><span><kbd>F</kbd> bike</span><span><kbd>Space</kbd> jump</span><span><kbd>C</kbd> crouch, hold to lie down</span><span><kbd>E</kbd> talk</span><span class="lit"><kbd>T</kbd> say something</span>`
        + `<span class="lit"><kbd>P</kbd> sow</span><span><kbd>Q</kbd> next seed</span>`
        // Only while building by hand is switched on (Settings -> Debug): otherwise B says
        // it is off, and a key in the row that only answers with a toast is a key too many.
        + (buildOn ? '<span class="lit"><kbd>B</kbd> build</span>' : '')
        + `<span><kbd>I</kbd> inventory</span><span><kbd>M</kbd> map</span>`
        + `<span><kbd>X</kbd> send away</span><span><kbd>Esc</kbd><kbd>Esc</kbd> back to the sky</span>`;
  }
  function setWalking(on, hasPad) {
    if (hasPad != null) padConnected = hasPad;
    walking = !!on;
    if (!on) indoors = false;
    if (!on) { setConfirm(null); setPouch(null); }
    el('walk-hud').hidden = !on;
    // Nothing drives the label layer on foot - `updateLabels` is skipped in walk mode -
    // so whatever was on screen when you stepped down stayed there, hanging in the air at
    // eye level. It only became obvious with the hamlet captions, which are meant to be
    // read from high up and so are always on when you leave the sky.
    el('labels').hidden = !!on;
    el('walk-btn').classList.toggle('on', !!on);
    el('walk-btn').textContent = on ? 'Fly up' : 'Walk';
    if (on) { el('dossier').hidden = true; el('legend').hidden = true; el('settings').hidden = true; renderWalkKeys(); }
    syncSidebar();
  }
  // From above, with a hand on the hamlets (web/js/plan-mode.js). Like walking, the right
  // column empties and the labels go; unlike walking, the chips stay, because Done is one.
  function setPlanning(on) {
    planning = !!on;
    el('labels').hidden = planning || walking;
    el('hover-label').hidden = true;
    el('plan-btn').classList.toggle('on', planning);
    el('plan-btn').textContent = planning ? 'Done' : 'Plan';
    if (planning) { el('dossier').hidden = true; el('legend').hidden = true; el('settings').hidden = true; }
    syncSidebar();
  }

  // Both of these are called every frame while you walk, and both usually have nothing
  // new to say - a countdown changes once a minute, a purse only when you trade. So the
  // last thing written is kept and an unchanged line is not written again.
  function once(id, html) {
    const p = el(id);
    if (p.dataset.said === html) return;
    p.dataset.said = html;
    p.innerHTML = html;
  }

  // What a beer in your hand offers the settler in front of you (main.js giveTarget), or
  // nothing. Called every frame on foot, so it writes only on a change.
  function setGive(name) {
    const p = el('walk-give');
    if (!name) { p.hidden = true; return; }
    p.hidden = false;
    once('walk-give', `<b>G</b> give ${esc(name)} a beer 🍺`);
  }

  function setWalkPrompt(near) {
    const p = el('walk-prompt');
    if (!near) { p.hidden = true; return; }
    p.hidden = false;
    // Whatever is within reach answers to E, or to whatever the controller map calls
    // interact. A board you are already standing at is the exception: it names its own
    // key, because what it offers is the way back out.
    const key = near.key || (padConnected ? padKey(indoors ? 'inside' : 'walk', 'interact') : 'E');
    // Anything that carries its own wording says it itself. The rooms indoors do that: what
    // a bar stool offers depends on whether you are already sitting on it.
    once('walk-prompt', near.prompt ? `<b>${key}</b> ${esc(near.prompt)}`
      : near.kind === 'board' ? `<b>${key}</b> read the sprint board`
      : near.kind === 'issues' ? `<b>${key}</b> read the island board`
        : near.kind === 'market' ? `<b>${key}</b> the seed stall`
          : near.kind === 'bed' ? bedPrompt(near, key)
            : `<b>${key}</b> talk to ${esc(near.label)}`);
  }

  // A bed says what it is and how long it still needs, counted down here rather than
  // sent: the bed carries the hour it is due and the page can subtract.
  function bedPrompt(bed, key) {
    const c = CROPS[bed.crop];
    const plural = c ? c.plural : 'them';
    const left = bed.ripeAt - Date.now();
    return left > 0
      ? `<span class="muted">${esc(plural)} — another ${esc(ripeIn(left))}</span>`
      : `<b>${key}</b> pull the ${esc(plural)}`;
  }

  // What is in your hand while building, and why it will not go down if it will not.
  //
  // The same shape as setPouch below, and for the same reason: it is called every frame,
  // so it goes through once() and the DOM is only touched when the words change. The
  // refusal lives here rather than in a toast - a toast per mouse move is unreadable.
  const DOES = { rot: 'turn', scale: 'size', length: 'stretch' };
  function setBuildHud(info) {
    const p = el('build-hud');
    if (!info) { p.hidden = true; return; }
    p.hidden = false;
    if (info.taking) {
      once('build-hud', `<b>Taking away</b>`
        + (info.target ? '<span>click to take it</span>' : '<span class="muted">point at something built by hand</span>')
        + '<span class="muted"><kbd>Esc</kbd> stop</span>');
      return;
    }
    const w = info.wheels || {};
    const size = info.spec && w.shift === 'length' && info.spec.length
      ? ` <span class="muted">${Math.round(info.spec.length * 10) / 10} long</span>` : '';
    const keys = [
      w.wheel ? `<kbd>scroll</kbd> ${DOES[w.wheel]}` : '',
      w.ctrl ? `<kbd>ctrl</kbd> ${DOES[w.ctrl]}` : '',
      w.shift ? `<kbd>shift</kbd> ${DOES[w.shift]}` : '',
    ].filter(Boolean).join(' · ');
    once('build-hud', `<b>${esc(info.kind)}</b>${size} in hand`
      + (info.why ? `<span class="why">${esc(info.why)}</span>` : '<span>click to put it down</span>')
      + (keys ? `<span class="muted">${keys}</span>` : '')
      + '<span class="muted"><kbd>Esc</kbd> put back</span>');
  }

  // The purse, the seed in your hand and what is standing ready, while you walk. Only
  // the keeper of the island farms it, so a visitor is never shown this.
  function setPouch(garden) {
    const p = el('walk-pouch');
    if (!garden) { p.hidden = true; return; }
    p.hidden = false;
    const key = padConnected ? padKey('walk', 'primary') : 'P';
    const held = garden.held && garden.seeds[garden.held];
    once('walk-pouch', `<span class="coins">${garden.purse} coins</span>`
      + (held
        ? `<span class="held"><b>${esc(garden.heldName || garden.held)}</b> seed ×${held} — <kbd>${key}</kbd> to sow</span>`
        : '<span class="none">no seed in the pouch</span>')
      + (garden.ripe ? `<span class="ripe">${garden.ripe} bed${garden.ripe === 1 ? '' : 's'} ready</span>` : ''));
  }

  function boot(done, text) {
    if (text) el('boot-text').textContent = text;
    if (done) { el('boot').classList.add('gone'); setTimeout(() => { el('boot').hidden = true; }, 700); }
  }

  el('walk-btn').addEventListener('click', () => handlers.onToggleWalk());
  el('found-btn').addEventListener('click', () => handlers.onFoundSettler());
  el('avatar-btn').addEventListener('click', () => handlers.onCustomize());
  el('build-btn').addEventListener('click', () => handlers.onBuild());
  el('plan-btn').addEventListener('click', () => handlers.onTogglePlan && handlers.onTogglePlan());

  setupShell();

  return {
    state, setVillage, setLive, setClock, setBuilding, showDossier, buildLegend, labels, hamletLabels,
    setSigns, setKeeper, setStandalone, setSound, setUpdate, setGate, buildEnabled: () => buildOn,
    setHover, toast, setSkew, setChronicle, boot, setWalking, setPlanning, setWalkPrompt, setPouch, setBuildHud, setPad, setConfirm, setIndoors, setMouse, setGive,
    closeDossier: () => close('dossier'),
    // What B clears from up in the sky: none of these is modal, so nothing else changes.
    setSeas, setIslandSize,
    closeOverlays: () => { close('dossier'); close('legend'); close('settings'); },
  };
}

// --- fullscreen and installing ------------------------------------------
// Safari and the older Android browsers still only have the prefixed calls.
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function setupShell() {
  const btn = el('fullscreen-btn');
  const install = el('install-btn');
  if (!btn) return;

  const expand = btn.querySelector('[data-icon="expand"]');
  const collapse = btn.querySelector('[data-icon="collapse"]');
  const sync = () => {
    const on = !!fullscreenElement();
    expand.hidden = on;
    collapse.hidden = !on;
    btn.title = on ? 'Leave fullscreen' : 'Fullscreen';
    btn.setAttribute('aria-label', btn.title);
  };
  btn.addEventListener('click', () => {
    if (fullscreenElement()) {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
    } else {
      const root = document.documentElement;
      (root.requestFullscreen || root.webkitRequestFullscreen || (() => {})).call(root);
    }
  });
  // Follow the real state, not our own idea of it: Esc and the phone's back
  // gesture both leave fullscreen without ever touching the button.
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();

  // The browser decides whether the island can be installed, and only says so once.
  // Until it does there is nothing to offer, so the button stays out of the way.
  let prompt = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    if (install) install.hidden = false;
  });
  if (install) {
    install.addEventListener('click', async () => {
      if (!prompt) return;
      install.hidden = true;
      prompt.prompt();
      try { await prompt.userChoice; } catch { /* they can always ask again later */ }
      prompt = null;
    });
  }
  addEventListener('appinstalled', () => { if (install) install.hidden = true; });
}

function cssHex(hex) { return `#${hex.toString(16).padStart(6, '0')}`; }
