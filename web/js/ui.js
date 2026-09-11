// Every pixel that is not the island: the title card, the dossier, the legend,
// the chronicle bar, the floating labels and the toasts.
import { PALETTE, TIER_LABEL } from './buildings.js';
import { CROPS, ripeIn } from 'shared/crops.mjs';

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
      handlers.onFilters(state.filters);
    });
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(b.dataset.close)));
  el('legend-btn').addEventListener('click', () => (el('legend').hidden ? openLegend() : close('legend')));
  el('reset-btn').addEventListener('click', () => handlers.onOverview());
  el('clock-chip').addEventListener('click', () => handlers.onToggleTime());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close('dossier'); close('legend'); }
    // Space belongs to the player on foot, where it jumps. Restarting the history from
    // under someone's feet is not what the key means down there.
    if (e.key === ' ' && e.target === document.body && !walking) { e.preventDefault(); el('play-btn').click(); }
  });

  function close(which) {
    el(which).hidden = true;
    if (which === 'dossier') { state.open = null; handlers.onSelect(null); }
    syncSidebar();
  }
  function openLegend() { el('dossier').hidden = true; el('legend').hidden = false; syncSidebar(); }
  // the right column holds one thing at a time, and on foot it holds nothing
  function syncSidebar() {
    const panelOpen = !el('dossier').hidden || !el('legend').hidden;
    el('building-now').hidden = walking || panelOpen || !hasBuilders;
    const w = el('waiting-now');
    if (w) w.hidden = walking || panelOpen || !w.querySelector('li');
    el('chronicle').hidden = walking;
    el('legend-btn').classList.toggle('on', !el('legend').hidden);
  }
  let hasBuilders = false;
  let walking = false;

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
    html += `<p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      ${b.kind === 'civic' || !b.sessionId ? '' : '<button class="btn primary" id="talk-btn">Talk to them</button>'}
      ${b.civicType === 'market' ? '<button class="btn primary" id="stall-btn">The seed stall</button>' : ''}
      <button class="btn" id="focus-btn">Focus camera</button>
      ${b.kind === 'civic' ? '' : '<button class="btn danger" id="exile-btn">Send off the island</button>'}
    </p>`;

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
      + '<li><b>Quay houses on stilts</b> <small>— Cowork tasks, they arrive by boat</small></li>'
      + '<li><b>A hedged green with a sign</b> <small>— one hamlet per git repository, from its third session</small></li>'
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
      d.className = `label${it.build ? ' build' : ''}`;
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
      d.textContent = it.text;
      d.style.opacity = String(it.opacity);
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

  // The two-step confirmation shown while walking, before anyone is sent away.
  function setConfirm(item) {
    const p = el('walk-confirm');
    if (!item) { p.hidden = true; return; }
    p.hidden = false;
    const key = padConnected ? 'X' : 'X';
    p.innerHTML = `Send <b>${esc(item.name)}</b> off the island? `
      + `<span class="muted">Press ${key} again to confirm${padConnected ? '' : ', Esc to leave them be'}</span>`;
  }

  // --- walking -------------------------------------------------------------
  let padConnected = false;
  // Indoors most of the keys mean nothing - there is nothing to sow in a tavern and nobody
  // to send off the island from a bar stool - so the row says what there is instead.
  let indoors = false;
  function setPad(on) { padConnected = on; renderWalkKeys(); }
  function setIndoors(on) { indoors = !!on; renderWalkKeys(); }
  function renderWalkKeys() {
    if (indoors) {
      el('walk-keys').innerHTML = padConnected
        ? `<span class="pad-dot"><i></i>Controller</span><span>Left stick walk</span><span>Right stick look</span>`
          + `<span class="lit"><kbd>A</kbd> sit down</span><span><kbd>B</kbd> step outside</span>`
        : `<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span>`
          + `<span>drag to look, double-click to hold the mouse</span>`
          + `<span><kbd>Shift</kbd> run</span><span class="lit"><kbd>E</kbd> sit down</span>`
          + `<span><kbd>Esc</kbd> step outside</span>`;
      return;
    }
    el('walk-keys').innerHTML = padConnected
      ? `<span class="pad-dot"><i></i>Controller</span><span>Left stick walk</span><span>Right stick look</span>`
        + `<span><kbd>A</kbd> talk</span><span><kbd>Y</kbd> think</span><span><kbd>X</kbd> send away</span>`
        + `<span class="lit"><kbd>D-pad ↑</kbd> sow</span><span><kbd>D-pad →</kbd> next seed</span>`
        + `<span><kbd>RB</kbd> run</span><span><kbd>B</kbd> back to the sky</span>`
      : `<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span><span>drag to look</span>`
        + `<span><kbd>Shift</kbd> run</span><span><kbd>Space</kbd> jump</span><span><kbd>Ctrl</kbd> crouch, hold to lie down</span><span><kbd>E</kbd> talk</span><span class="lit"><kbd>T</kbd> think</span>`
        + `<span class="lit"><kbd>P</kbd> sow</span><span><kbd>Q</kbd> next seed</span>`
        + `<span><kbd>X</kbd> send away</span><span><kbd>Esc</kbd> back to the sky</span>`;
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
    if (on) { el('dossier').hidden = true; el('legend').hidden = true; renderWalkKeys(); }
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

  function setWalkPrompt(near) {
    const p = el('walk-prompt');
    if (!near) { p.hidden = true; return; }
    p.hidden = false;
    // Whatever is within reach normally answers to E, or to A on a controller. A board
    // you are already standing at is the exception: it names its own key, because what it
    // offers is the way back out.
    const key = near.key || (padConnected ? 'A' : 'E');
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

  // The purse, the seed in your hand and what is standing ready, while you walk. Only
  // the keeper of the island farms it, so a visitor is never shown this.
  function setPouch(garden) {
    const p = el('walk-pouch');
    if (!garden) { p.hidden = true; return; }
    p.hidden = false;
    const key = padConnected ? 'D-pad ↑' : 'P';
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

  setupShell();

  return {
    state, setVillage, setLive, setClock, setBuilding, showDossier, buildLegend, labels, hamletLabels,
    setHover, toast, setChronicle, boot, setWalking, setWalkPrompt, setPouch, setPad, setConfirm, setIndoors,
    closeDossier: () => close('dossier'),
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
