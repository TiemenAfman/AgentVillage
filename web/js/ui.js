// Every pixel that is not the island: the title card, the dossier, the legend,
// the chronicle bar, the floating labels and the toasts.
import { PALETTE, TIER_LABEL } from './buildings.js';
import { CROPS, ripeIn } from 'shared/crops.mjs';
import { padKey, suspendPad } from './input.js';
import { ACTIONS, PAD_ONLY, STICK_LABEL, PAD_RESERVED, keysOf, padOf, keyLabel, bindKey, bindPad, resetKeys, resetPad } from './keybinds.js';
import { padName, padLabel } from './gamepad.js';
import { GRAPHICS_DEFAULTS, GRAPHICS_LIMITS, GRAPHICS_CHOICES, BLOOM_STRENGTH } from './graphics-settings.js';
import { createSysMenu } from './sysmenu.js';
import { cameraFixed, setCameraFixed } from './camera-prefs.js';
import { NOCLIP_KEY } from './noclip.js';

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
// The chips in the bar carry an icon and a word (index.html); writing textContent would take
// the icon with it. The word is the aria-label too, because it is shown only when Names on
// the buttons is on and the window is wide enough. `title` for a chip whose meaning turns
// with its word (Walk / Fly up): with icons only, the tooltip is the one place the name is.
const CLOCK_SUN = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>';
const CLOCK_MOON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
function setLabel(id, text, title) {
  const b = el(id);
  const lbl = b.querySelector('.lbl');
  if (lbl) lbl.textContent = text; else b.textContent = text;
  b.setAttribute('aria-label', text);
  if (title) b.title = title;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createUI(handlers) {
  const state = {
    filters: {
      code: true,
      cowork: true,
      apprentices: true
    },
    open: null,
    // The four graphics distances, as main.js holds them (remembered per browser in
    // graphics-settings.js). A copy for drawing the sliders, kept in step on every input so
    // the panel opens where it was left rather than back at the defaults.
    graphics: { ...GRAPHICS_DEFAULTS, ...(handlers.graphics ? handlers.graphics() : {}) },
  };
  // --- filters, legend, overview ------------------------------------------
  // Each toggle is there twice: in the menu (always) and in the Show row under the chips, which
  // only stands there while something is switched off - an island with its houses hidden has
  // to say so without anybody opening a menu (Plans/DONE/esc-menu-en-knoppenbalk.md).
  function syncFilters() {
    document.querySelectorAll('[data-filter]').forEach((b) => {
      const on = state.filters[b.dataset.filter];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    el('filter-row').hidden = Object.values(state.filters).every(Boolean);
  }
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.filter;
      state.filters[k] = !state.filters[k];
      syncFilters();
      handlers.onFilters(state.filters);
    });
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(b.dataset.close)));
  el('legend-btn').addEventListener('click', () => (el('legend').hidden ? openLegend() : close('legend')));
  // On the menu's This screen tab, not the keeper's Island tab: that one writes config.json
  // on the machine the island runs on (see setKeeper below), while how loud somebody's own
  // speakers are is theirs alone. What it remembers lives in that browser's localStorage next
  // to the avatar and the chat mode.
  el('sound-btn').addEventListener('click', () => handlers.onSound && handlers.onSound());
  el('reset-btn').addEventListener('click', () => handlers.onOverview());
  el('clock-chip').addEventListener('click', () => handlers.onToggleTime());
  // A keeper's words can be tapped away: on a phone there is no Esc to press.
  el('speech').addEventListener('click', () => handlers.onSpeechTap && handlers.onSpeechTap());

  // Tucks the chips away - New settler through Overview - leaving the clock and the menu
  // (☰) where they were. Remembered the same way the chat
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
    const fold = el('nav-collapse-btn');
    // The keys go on working while the buttons are folded away, and the tooltip says so.
    fold.title = navCollapsed ? 'Show the buttons' : 'Hide the buttons (their keys keep working)';
    fold.setAttribute('aria-label', navCollapsed ? 'Show the buttons' : 'Hide the buttons');
    fold.setAttribute('aria-expanded', String(!navCollapsed));
  }
  applyNavCollapsed();
  el('nav-collapse-btn').addEventListener('click', () => {
    navCollapsed = !navCollapsed;
    try { localStorage.setItem(NAV_KEY, navCollapsed ? '1' : '0'); } catch { /* fine, just not remembered */ }
    applyNavCollapsed();
  });
  // The bar is a toolbar (role in index.html): one Tab stop, the arrows move along it. A chip that
  // is hidden until something is true (Plan, Say, Animals) is skipped and joins when it shows.
  {
    const bar = el('nav-chips');
    const stops = () => [...bar.querySelectorAll('button.chip')].filter((b) => !b.hidden);
    let cur = null;
    const rove = () => {
      const all = stops();
      if (!all.includes(cur)) cur = all[0] || null;
      bar.querySelectorAll('button.chip').forEach((b) => { b.tabIndex = b === cur ? 0 : -1; });
    };
    bar.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('button.chip')) { cur = e.target; rove(); } });
    bar.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const all = stops();
      const at = all.indexOf(document.activeElement);
      if (at < 0) return;
      let to = null;
      if (e.key === 'ArrowRight') to = all[(at + 1) % all.length];
      else if (e.key === 'ArrowLeft') to = all[(at - 1 + all.length) % all.length];
      else if (e.key === 'Home') to = all[0];
      else if (e.key === 'End') to = all[all.length - 1];
      if (!to) return;
      e.preventDefault(); e.stopPropagation();
      to.focus();
    });
    if (typeof MutationObserver !== 'undefined') new MutationObserver(rove).observe(bar, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    rove();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') SIDE.forEach(close);
    // Space belongs to the player on foot, where it jumps. Restarting the history from
    // under someone's feet is not what the key means down there.
    if (e.key === ' ' && e.target === document.body && !walking && timelineShown()) { e.preventDefault(); el('play-btn').click(); }
  });

  document.addEventListener('input', e => {
    const input = e.target.closest('input[data-setting]');
    if (!input) return;

    const key = input.dataset.setting;
    const value = Number(input.value);
    if (!(key in state.graphics)) return;
    state.graphics[key] = value;

    if (handlers.onGraphicsSetting) {
      handlers.onGraphicsSetting(key, value);
    }

    const valueEl = document.getElementById(
      key.replace(/[A-Z]/g, match => '-' + match.toLowerCase()) + '-value'
    );

    if (valueEl) valueEl.textContent = `${value}m`;
  });
  // The side panels on the right, one open at a time. The two after the first three are the
  // animals' (web/js/animal-dossier.js fills them and opens them through openSide below), the last is the
  // quest log (web/js/quest-panel.js); everything that shut the first three - Escape, walking,
  // planning, another panel opening - shuts them.
  const SIDE = ['dossier', 'legend', 'phone', 'animal-dossier', 'animal-journal', 'quest-log'];
  // The menu behind Esc and the ☰, which is the settings too (sysmenu.js). Drawn afresh each
  // time it opens, and the keeper's islander asked who is out on the sea and how big the
  // island may grow - the Island tab's two lists - before it is.
  const menu = createSysMenu({
    closers: ['legend-btn', 'phone-btn'],
    onClose: () => { if (handlers.onMenuClose) handlers.onMenuClose(); },
    onOpen: () => {
      if (keeper && handlers.onSettingsOpen) handlers.onSettingsOpen();
      renderSettings();
      el('sysmenu-build').textContent = handlers.buildLabel ? handlers.buildLabel() : '';
    },
  });
  const hideSide = (except) => { for (const id of SIDE) if (id !== except && el(id)) el(id).hidden = true; };
  function close(which) {
    if (!el(which)) return;
    el(which).hidden = true;
    if (which === 'dossier') { state.open = null; handlers.onSelect(null); }
    syncSidebar();
  }
  // For a panel this file does not fill. The settler's dossier is closed properly first, so
  // whatever it had selected lets go, rather than only hidden the way the legend hides it.
  function openSide(which) {
    if (which !== 'dossier' && !el('dossier').hidden) close('dossier');
    hideSide(which);
    el(which).hidden = false;
    syncSidebar();
  }
  function openLegend() { hideSide('legend'); el('legend').hidden = false; syncSidebar(); }
  // the right column holds one thing at a time, and on foot it holds nothing
  function syncSidebar() {
    const panelOpen = SIDE.some((id) => el(id) && !el(id).hidden);
    el('building-now').hidden = walking || planning || panelOpen || !hasBuilders;
    const w = el('waiting-now');
    if (w) w.hidden = walking || planning || panelOpen || !w.querySelector('li');
    // The animals' "while you were away" card follows the same rule as the waiting list.
    const a = el('animal-summary');
    if (a) a.hidden = walking || planning || panelOpen || !a.querySelector('li');
    el('chronicle').hidden = walking || planning || !timelineShown();
    el('legend-btn').classList.toggle('on', !el('legend').hidden);
    el('phone-btn').classList.toggle('on', !el('phone').hidden);
  }
  let hasBuilders = false;
  let walking = false;
  let planning = false;

  // --- chronicle -----------------------------------------------------------
  // The timeline bar can be switched off under Settings → Timeline, per browser: the island
  // then stays live, and the bar only comes back for a replay somebody asked for (the
  // chronicle building), so its Live button is there to end it.
  const TIMELINE_KEY = 'promptholm.timeline';
  let timelineOn = true;
  try { timelineOn = localStorage.getItem(TIMELINE_KEY) !== '0'; } catch { /* private window: on */ }
  let replaying = false;
  const timelineShown = () => timelineOn || replaying;
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
    if (replaying !== !live) { replaying = !live; if (!timelineOn) syncSidebar(); }
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
    // The ladder counts the most there have ever been at once (lib/village.mjs `reachedOf`),
    // so once tents have packed up the count and the next milestone no longer add up without
    // saying so.
    const most = s.reached && s.reached.settlers > s.settlers ? s.reached.settlers : 0;
    let html = bits.map(([n, l], i) => (i === 0 && most
      ? `<span title="The most the village has had at once: ${fmtInt(most)}. Milestones count that, so the next one waits until the village is that big again."><b>${fmtInt(n)}</b> ${l}</span>`
      : `<span><b>${fmtInt(n)}</b> ${l}</span>`)).join('');
    if (s.nextMilestone) html += `<span title="Population milestone">${esc(s.nextMilestone.label)} in <b>${s.nextMilestone.remaining}</b></span>`;
    el('counts').innerHTML = html;
    for (const id of ['titlecard', 'topright']) el(id).hidden = false;
    el('chronicle').hidden = walking || !timelineShown();
  }

  function setLive(mode) {
    const dot = el('live-dot');
    dot.classList.toggle('off', mode === 'off');
    dot.classList.toggle('replay', mode === 'replay');
    el('live-text').textContent = mode === 'off' ? 'Offline' : mode === 'replay' ? 'Replay' : 'Live';
  }

  function setClock(hour, seasonName, lens = false) {
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    const chip = el('clock-chip');
    // Called every frame: once() keeps an unchanged chip from being rewritten (and its hover with it).
    const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${seasonName[0].toUpperCase()}${seasonName.slice(1)}${lens ? ' · preview' : ''}`;
    once('clock-chip', `${h >= 6 && h < 20 ? CLOCK_SUN : CLOCK_MOON}<span>${text}</span>`);
    chip.classList.toggle('lens', lens);
    chip.title = lens
      ? 'A preview of the hour on this screen only - the sea keeps its own clock. Click (or H) for the next hour, and back to live after 22:00.'
      : 'Time of day on the island. Click (or H) to preview 07:00, 12:00, 18:30 or 22:00 on this screen only.';
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
    hideSide('dossier');
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
      ${handlers.canWalkHere && handlers.canWalkHere() ? '<button class="btn" id="walkhere-btn">Walk here</button>' : ''}
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
    const walkHere = body.querySelector('#walkhere-btn');
    if (walkHere) walkHere.addEventListener('click', () => handlers.onWalkHere(b.id));
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

  // The noclip camera (web/js/noclip.js, Plans/noclip-camera.md): ` flies a free camera through
  // everything, and `window.__noclip` drives it from the console. Off unless switched on here or
  // the URL says `?noclip`; per browser like Build mode, for the same reason.
  let noclipOn = false;
  try { noclipOn = localStorage.getItem(NOCLIP_KEY) === '1'; } catch { /* private window: off */ }

  // The YOU arrow over the body left standing when you go up into the sky (you-marker.js).
  // On unless switched off, per browser like Build mode, and for the same reason: it changes
  // what this page draws, not the island. Only the arrow - the dots and the ring of a route
  // given from above stay, because without them you cannot see where you sent yourself.
  // Three choices: 'you' (the default, stored as nothing), 'arrow' and 'off' (stored as '0',
  // which is what the old on/off switch wrote for off).
  const YOU_KEY = 'promptholm.youarrow';
  const YOU_MODES = [
    ['you', 'You', 'You: when you go up into the sky, YOU hangs over where you left yourself standing, without the arrow.'],
    ['arrow', 'You + arrow', 'You + arrow: when you go up into the sky, YOU and an arrow hang over where you left yourself standing.'],
    ['off', 'Off', 'Off: you still stand where you left yourself, without YOU or the arrow. A route you give from above keeps its dots and ring.'],
  ];
  let youMode = 'you';
  try { const v = localStorage.getItem(YOU_KEY); youMode = v === '0' ? 'off' : v === 'arrow' ? 'arrow' : 'you'; } catch { /* private window: you */ }

  // The director (web/js/director.js, Plans/DONE/regisseur.md): the camera wandering off by itself
  // to watch something happen when nobody has touched the island for a while. On unless
  // switched off, per browser like the arrow.
  const DIRECTOR_KEY = 'promptholm.director';
  let directorOn = true;
  try { directorOn = localStorage.getItem(DIRECTOR_KEY) !== '0'; } catch { /* private window: on */ }

  // The quality governor (web/js/quality.js, Plans/DONE/sneller-tekenen.md): drawing less while
  // this machine cannot keep up. On unless switched off, per browser - it is about this
  // screen's graphics, not the island.
  const QUALITY_KEY = 'promptholm.quality.auto';
  let qualityAuto = true;
  try { qualityAuto = localStorage.getItem(QUALITY_KEY) !== '0'; } catch { /* private window: on */ }

  // The words on the chips at the top right: off unless switched on, per browser. The icons
  // carry the bar - every chip keeps its name and key in its tooltip and aria-label - and the
  // words took half the width of a laptop screen (Plans/DONE/esc-menu-en-knoppenbalk.md). A class
  // on body; harbour.css shows them only where the window is wide enough even when on.
  const NAMES_KEY = 'promptholm.chipnames';
  let namesOn = false;
  try { namesOn = localStorage.getItem(NAMES_KEY) === '1'; } catch { /* private window: off */ }
  const applyNames = () => document.body.classList.toggle('chip-names', namesOn);
  applyNames();

  // The planner moves hamlets on this machine's layout, and the menu's Island tab writes its
  // config.json (the signs, the size, the sea), so both are the keeper's. The rest of the
  // settings are this browser's and everybody's - they used to be behind the keeper's
  // Settings chip too, and a visitor could not so much as rebind a key.
  let keeper = false;
  function setKeeper(k) {
    keeper = !!k;
    el('plan-btn').hidden = !keeper;
    el('sysmenu-plan-key').hidden = !keeper;
    el('tab-island').hidden = !keeper;
    menu.refresh();
  }

  // The app on a phone: on foot for good, so the ways up to the sky and into the planner
  // go, and so does building. A class on body rather than `hidden`, because other setters
  // (setWalking among them) hand some of these chips their `hidden` back later.
  // The app on a phone. It also gets the two chips a phone needs and a keyboard does not:
  // Say, for the island chat that otherwise only T opens, and Controls (phoneprefs.js).
  let standalone = false;
  function setStandalone() {
    standalone = true;
    document.body.classList.add('standalone');
    el('say-btn').hidden = false;
    el('phone-btn').hidden = false;
    el('touch-controls').hidden = false;
    renderSettings();
  }
  el('say-btn').addEventListener('click', () => handlers.onSay && handlers.onSay());
  el('phone-btn').addEventListener('click', () => (el('phone').hidden ? openPhone() : close('phone')));

  // How the controls feel, for the phone's own player: drawn from the preferences each time
  // it opens, and each change handed straight back (handlers.onPhonePref) to be kept and
  // applied - everything on the next frame, except quality, which is the next start.
  function openPhone() {
    const p = handlers.phonePrefs ? handlers.phonePrefs() : {};
    el('phone-body').innerHTML = `
      <label class="phone-row">Look speed
        <input type="range" id="pp-look" min="0.5" max="2" step="0.1" value="${Number(p.look) || 1}">
        <output id="pp-look-out">${(Number(p.look) || 1).toFixed(1)}×</output></label>
      <label class="phone-row"><input type="checkbox" id="pp-invert"${p.invert ? ' checked' : ''}> Drag up to look down</label>
      <label class="phone-row"><input type="checkbox" id="pp-lefty"${p.lefty ? ' checked' : ''}> Left-handed: stick on the right</label>
      <div class="phone-row">Drawing
        <select id="pp-quality">
          <option value="light"${p.quality !== 'full' ? ' selected' : ''}>Light (smoother)</option>
          <option value="full"${p.quality === 'full' ? ' selected' : ''}>Full (sharper, warmer phone)</option>
        </select></div>
      <p class="muted">Drawing changes on the next start of the app.</p>
      <p class="muted">Pinch with two fingers to bring the camera closer or further. Tap somebody to hear who they are.</p>`;
    const set = (name, value) => handlers.onPhonePref && handlers.onPhonePref(name, value);
    el('pp-look').addEventListener('input', (e) => { el('pp-look-out').textContent = `${Number(e.target.value).toFixed(1)}×`; set('look', Number(e.target.value)); });
    el('pp-invert').addEventListener('change', (e) => set('invert', e.target.checked));
    el('pp-lefty').addEventListener('change', (e) => set('lefty', e.target.checked));
    el('pp-quality').addEventListener('change', (e) => set('quality', e.target.value));
    openSide('phone');
  }

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

  // How big the island may grow (Plans/DONE/eiland-laten-groeien.md): `maxGridSize`, asked of the
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

  // Where the island and its HD pack live (Plans/eiland-op-eigen-schijf.md): asked of the islander
  // when Settings opens. A move copies everything, checks the copy and starts the island again
  // there; the pack's folder is a setting of its own, read on the next load.
  let homeInfo = null;
  function setHome(data) { homeInfo = data; renderSettings(); }

  function homeSection() {
    if (!homeInfo) return '';
    const h = homeInfo, hd = h.hd || {};
    const move = h.movable
      ? `<div style="display:flex;gap:6px;margin-top:8px"><input id="home-to" class="field" placeholder="D:\\Promptholm" style="flex:1"><button class="chip" id="home-move">Move…</button></div>`
      : `<p class="muted" style="margin-top:6px">${esc(h.why || '')}</p>`;
    return '<h3 class="sec">Island folder</h3>'
      + '<p class="muted" style="margin:0 0 9px">Where this island keeps its town, its settings and everything you added. Move it to another drive here: it is copied, checked, and the island starts again there. The old folder is left as it was.</p>'
      + `<p class="muted" style="margin:0;font-size:12px;word-break:break-all">Now in <b>${esc(h.home)}</b></p>`
      + move
      + '<h3 class="sec">HD pack folder</h3>'
      + `<p class="muted" style="margin:0 0 9px">${hd.installed ? 'A pack is installed here.' : 'No pack here yet: the rooms draw their hand-made models.'} Empty is the island folder’s own <i>hd</i>. Read again on the next load.</p>`
      + `<p class="muted" style="margin:0;font-size:12px;word-break:break-all">Now <b>${esc(hd.dir || '')}</b></p>`
      + `<div style="display:flex;gap:6px;margin-top:8px"><input id="hd-dir" class="field" placeholder="${esc(hd.default || '')}" value="${hd.chosen ? esc(hd.dir) : ''}" style="flex:1"><button class="chip" id="hd-dir-save">Use</button></div>`;
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
        // Only a saved address can go, as in the main menu (mainmenu.js droppable): one found
        // on the network is back at its next announcement, and the sea we are in is left by
        // joining another.
        + ((o.from === 'known' || o.from === 'chosen') && !o.mine && !here
          ? `<button class="x" data-forgetsea="${esc(o.url)}" title="Forget ${esc(o.url)}" aria-label="Forget ${esc(o.url)}">✕</button>` : '')
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

  // Which cell is waiting for its new key or button, if any: { action, slot } with slot 0 (primary),
  // 1 (secondary) or 'pad'. And a line about what the last binding did to another one.
  let rebinding = null;
  let bindNote = '';
  let padWatch = 0;
  const connectedPad = () => {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    return pads.find((p) => p && p.connected) || null;
  };
  const says = (action) => {
    const key = ACTIONS.find(([a]) => a === action);
    if (key) return key[2];
    const only = PAD_ONLY.find(([a]) => a === action);
    return only ? only[1] : action;
  };
  function stopCapture() {
    rebinding = null;
    if (padWatch) cancelAnimationFrame(padWatch);
    padWatch = 0;
    suspendPad(false);
  }
  // The pad belongs to Settings for as long as it waits for a button (input.js suspendPad); the
  // first button that goes down and was not already down is the one. Back and Start are how you
  // leave and open the menu, so they are refused with a word rather than taken.
  function watchPad() {
    const held = new Set();
    const first = connectedPad();
    if (first) first.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) held.add(i); });
    suspendPad(true);
    const tick = () => {
      if (!rebinding || rebinding.slot !== 'pad') return;
      const p = connectedPad();
      if (!p) { stopCapture(); renderSettings(); return; }
      for (let i = 0; i < Math.min(16, p.buttons.length); i++) {
        const b = p.buttons[i];
        const down = b.pressed || b.value > 0.5;
        if (!down) { held.delete(i); continue; }
        if (held.has(i)) continue;
        held.add(i);
        if (PAD_RESERVED.has(i)) {
          bindNote = `${padLabel(i, p.id)} leaves walk mode and opens the menu, so it cannot be bound.`;
          renderSettings();
          continue;
        }
        const lost = bindPad(rebinding.action, i);
        bindNote = lost ? `${padLabel(i, p.id)} was ${says(lost)}'s; it has swapped.` : '';
        stopCapture();
        renderSettings();
        return;
      }
      padWatch = requestAnimationFrame(tick);
    };
    padWatch = requestAnimationFrame(tick);
  }

  function controlsSection() {
    const pad = connectedPad();
    const cell = (action, slot, label) => {
      const on = rebinding && rebinding.action === action && rebinding.slot === slot;
      const off = slot === 'pad' && !pad;
      return `<button class="bind${on ? ' on' : ''}${off ? ' off' : ''}" data-bind="${action}:${slot}"${off ? ' disabled title="No controller connected"' : ''}>`
        + `${on ? '\u2026' : esc(label)}</button>`;
    };
    const fixed = (label, off) => `<span class="bind fixed${off ? ' off' : ''}">${esc(label)}</span>`;
    const key = (a, slot) => cell(a, slot, keyLabel(keysOf(a)[slot]));
    const btn = (a) => {
      if (STICK_LABEL[a]) return fixed(STICK_LABEL[a], !pad);
      const b = padOf(a);
      return cell(a, 'pad', b == null ? '\u2014' : padLabel(b, pad && pad.id));
    };
    const rows = ACTIONS.map(([a, , label]) => `<div class="bindrow"><span class="act" title="${esc(label)}">${esc(label)}</span>${key(a, 0)}${key(a, 1)}${btn(a)}</div>`).join('')
      + PAD_ONLY.map(([a, label]) => `<div class="bindrow"><span class="act" title="${esc(label)}">${esc(label)}</span>${fixed('\u2014', true)}${fixed('\u2014', true)}${btn(a)}</div>`).join('');
    const head = `<div class="bindrow head"><span class="act">Action</span><span>Primary</span><span>Secondary</span>`
      + `<span class="${pad ? '' : 'off'}" title="${pad ? esc(pad.id) : 'No controller connected'}">${pad ? esc(padName(pad.id)) : 'Controller'}</span></div>`;
    return '<div><h3 class="sec">Controls</h3>'
      + `<p class="muted" style="margin:0 0 9px">On foot. Click a cell and press the key (or the controller button) you want; <kbd>Del</kbd> empties it, <kbd>Esc</kbd> cancels. Mouse to look, <kbd>Esc</kbd> frees it, <kbd>Esc</kbd><kbd>Esc</kbd> back to the sky; the left and right buttons are your left and right hand. In the water, look down and swim on to dive, look up to climb.</p>`
      + `<div class="bindtable">${head}${rows}</div>`
      + (bindNote ? `<p class="muted" style="margin:6px 0 0">${esc(bindNote)}</p>` : '')
      + (pad ? '' : `<p class="muted" style="margin:6px 0 0">No controller found. Plug one in and press a button on it; its column comes alive.</p>`)
      + `<div class="chips wrap" style="margin-top:6px"><button class="chip" data-rebind-reset="1">Default keys</button>`
      + `<button class="chip${pad ? '' : ' off'}" data-rebind-reset-pad="1"${pad ? '' : ' disabled'}>Default buttons</button></div></div>`;
  }

  // Each slider from GRAPHICS_LIMITS (graphics-settings.js), the same table main.js clamps
  // against, so the panel cannot offer a number the frame would refuse.
  const GRAPHICS_ROWS = [
    ['viewDistance', 'View distance'],
    ['npcDistance', 'NPC distance'],
    ['shadowDistance', 'Shadow distance'],
  ];
  // Bloom and anti-aliasing (post.js, Plans/bloom-en-aa.md): read from main.js each time the panel
  // is drawn, and applied at once. Bloom is only drawn in rooms for now.
  const POST_ROWS = [
    ['bloom', 'Bloom', [['off', 'Off'], ['rooms', 'In rooms']]],
    ['aa', 'Anti-aliasing', [['msaa', 'MSAA'], ['smaa', 'SMAA'], ['off', 'Off (after reload)']]],
  ];
  function postRows() {
    const p = handlers.post ? handlers.post() : null;
    if (!p) return '';
    const chips = ([key, label, opts]) => `<div class="setting-row"><label>${label}</label><div class="chips wrap">`
      + opts.map(([v, t]) => `<button class="chip${p[key] === v ? ' on' : ''}" data-post="${key}" data-post-value="${v}">${t}</button>`).join('')
      + '</div></div>';
    return POST_ROWS.map(chips).join('')
      + `<div class="setting-row"><label>Bloom strength <span class="muted" id="bloom-strength-value">${p.bloomStrength.toFixed(2)}</span></label>`
      + `<input type="range" min="${BLOOM_STRENGTH.min}" max="${BLOOM_STRENGTH.max}" step="${BLOOM_STRENGTH.step}" value="${p.bloomStrength}" data-post-range="bloomStrength"></div>`;
  }
  function graphicsSection() {
    const row = ([key, label]) => {
      const lim = GRAPHICS_LIMITS[key];
      const v = state.graphics[key];
      const id = key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()) + '-value';
      return `<div class="setting-row"><label>${label} <span class="muted" id="${id}">${v}m</span></label>`
        + `<input type="range" min="${lim.min}" max="${lim.max}" step="${lim.step}" value="${v}" data-setting="${key}"></div>`;
    };
    return '<div><h3 class="sec">Graphics</h3>'
      + `<p class="muted" style="margin:0 0 12px">Adjust how far different parts of the island are drawn.</p>`
      + GRAPHICS_ROWS.map(row).join('')
      + detailRow()
      + postRows()
      + `<div class="chips wrap" style="margin-top:6px"><button class="chip" data-graphics-reset="1">This machine's defaults</button></div>`
      + `</div>`;
  }
  // Forced SD - Auto - Forced HD (graphics-settings.js GRAPHICS_CHOICES, Plans/piratenkroeg.md, "The HD pack"), with
  // what the HD pack in HOME/hd holds. Not on the phone, which has neither rooms nor a pack.
  const DETAIL_LABELS = { sd: 'Forced SD', auto: 'Auto', hd: 'Forced HD' };
  function detailRow() {
    const pack = handlers.hdStatus ? handlers.hdStatus() : false;
    if (pack === false) return '';
    const has = pack ? `HD pack ${pack.pack || ''} installed: ${pack.pieces} model${pack.pieces === 1 ? '' : 's'}.` : 'No HD pack installed.';
    return `<div class="setting-row"><label>Model detail</label><div class="chips wrap">${GRAPHICS_CHOICES.detail
      .map((k) => `<button class="chip${state.graphics.detail === k ? ' on' : ''}" data-detail="${k}">${DETAIL_LABELS[k]}</button>`).join('')}</div>`
      + `<p class="muted" style="margin:4px 0 0">${has} Auto shows HD on a full-strength machine.</p></div>`;
  }
  function renderSettings() {
    const chosen = NAMEPLATES.find(([k]) => k === signMode);
    // One section per tab of the menu (sysmenu.js); the Island one only for the keeper, whose
    // config.json it writes, and the keys only where there is a keyboard. The Show toggles are
    // not drawn here: they stand in index.html's own section of This screen, and in the Show
    // row under the chips while one of them is off.
    const signs = '<h3 class="sec" style="margin-top:0">House signs</h3>'
      + `<p class="muted" style="margin:0 0 9px">The board in a settler's front yard carries the session's own title — which is the prompt it opened with.</p>`
      + `<div class="chips wrap">${NAMEPLATES
        .map(([k, label]) => `<button class="chip${k === signMode ? ' on' : ''}" data-signs="${k}">${label}</button>`).join('')}</div>`
      + `<p class="muted" style="margin-top:9px">${esc(chosen ? chosen[2] : 'Asking the island…')}</p>`;
    // The words on the chips at the top right (namesOn, above): its own heading, after the
    // timeline, because it is about the bar at the top rather than about the sky.
    const buttons = '<h3 class="sec">Buttons</h3>'
      + `<div class="chips wrap"><button class="chip${namesOn ? ' on' : ''}" data-chipnames="1" aria-pressed="${namesOn}">Names on the buttons</button></div>`
      + `<p class="muted" style="margin-top:9px">${namesOn
        ? 'On: the buttons at the top right carry their name beside the icon, wherever the window is wide enough for it.'
        : 'Off: icons only. Hover one for its name and its key.'}</p>`;
    const timeline = '<h3 class="sec">Timeline</h3>'
      + `<div class="chips wrap"><button class="chip${timelineOn ? ' on' : ''}" data-timeline="1" aria-pressed="${timelineOn}">Timeline</button></div>`
      + `<p class="muted" style="margin-top:9px">${timelineOn
        ? 'On: the bar with play, the slider and Live sits at the bottom of the screen.'
        : 'Off: the island always stays live. The chronicle building still replays its history, with the bar back until you press Live.'}</p>`;
    const sky = '<h3 class="sec">From the sky</h3>'
      + `<div class="chips wrap">${YOU_MODES
        .map(([k, label]) => `<button class="chip${k === youMode ? ' on' : ''}" data-youarrow="${k}" aria-pressed="${k === youMode}">${label}</button>`).join('')}</div>`
      + `<p class="muted" style="margin-top:9px">${esc(YOU_MODES.find(([k]) => k === youMode)[2])}</p>`
      + `<div class="chips wrap" style="margin-top:9px"><button class="chip${directorOn ? ' on' : ''}" data-director="1" aria-pressed="${directorOn}">Wander by itself</button></div>`
      + `<p class="muted" style="margin-top:9px">${directorOn
        ? 'On: leave the island alone for a while and the camera goes to watch whatever is happening - a newcomer, the gold, the timber wagon, somebody at work. Touch anything and it stops where it is.'
        : 'Off: the camera stays where you leave it.'}</p>`
      + '<h3 class="sec">Drawing</h3>'
      + `<div class="chips wrap"><button class="chip${qualityAuto ? ' on' : ''}" data-qualityauto="1" aria-pressed="${qualityAuto}">Lighter when slow</button></div>`
      + `<p class="muted" style="margin-top:9px">${qualityAuto
        ? 'On: when this screen drops below about 28 frames a second, the island is drawn a little softer - fewer pixels, shadows redrawn less often - and sharpens again once there is room.'
        : 'Off: the island is always drawn at the quality this screen started with, however slow it gets.'}</p>`;
    // The follow camera on foot (camera-prefs.js): kept at its distance, or pulled in by what is in
    // the way (walk.js placeCamera's boom).
    const fixedOn = cameraFixed();
    const onFoot = '<h3 class="sec">On foot</h3>'
      + `<div class="chips wrap"><button class="chip${fixedOn ? ' on' : ''}" data-camfixed="1" aria-pressed="${fixedOn}">Fixed camera distance</button></div>`
      + `<p class="muted" style="margin-top:9px">${fixedOn
        ? 'On: the camera always stays as far back as you scrolled it. A wall, a fountain or a board may hide you for a moment; the camera does not zoom in for it.'
        : 'Off: the camera comes in towards you when something stands between it and you, and goes back out once it is clear. Rails, posts and crates it still looks past.'}</p>`;
    const debug = '<h3 class="sec">Debug</h3>'
      + `<div class="chips wrap"><button class="chip${buildOn ? ' on' : ''}" data-buildmode="1" aria-pressed="${buildOn}">Build mode</button></div>`
      + `<p class="muted" style="margin-top:9px">${buildOn
        ? 'Building by hand is on: the Build chip and <kbd>B</kbd> put shapes in your hand.'
        : 'Off. The town is kept from the planner now (<b>Plan</b>); this brings back the old Build chip and <kbd>B</kbd>.'}</p>`
      + `<div class="chips wrap" style="margin-top:12px"><button class="chip${noclipOn ? ' on' : ''}" data-noclip="1" aria-pressed="${noclipOn}">Noclip camera</button></div>`
      + `<p class="muted" style="margin-top:9px">${noclipOn
        ? 'On: <kbd>`</kbd> flies a free camera through walls, ground and water (<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, <kbd>Space</kbd>/<kbd>E</kbd> up, <kbd>Shift</kbd>/<kbd>Q</kbd> down, the wheel for speed); <code>__noclip</code> in the console.'
        : 'Off. A free-flying camera for looking at the graphics, also on with <code>?noclip</code> in the address.'}</p>`;
    el('settings-body').innerHTML = `<section data-tab="screen">${sky}${onFoot}${graphicsSection()}${timeline}${buttons}</section>`
      + (standalone ? '' : `<section data-tab="controls">${controlsSection()}</section>`)
      + (keeper ? `<section data-tab="island">${signs}${sizeSection()}${homeSection()}${seaSection()}${debug}</section>` : '');
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
    el('settings-body').querySelectorAll('[data-noclip]').forEach((b) => b.addEventListener('click', () => {
      noclipOn = !noclipOn;
      try { if (noclipOn) localStorage.setItem(NOCLIP_KEY, '1'); else localStorage.removeItem(NOCLIP_KEY); } catch { /* kept for this page only */ }
      renderSettings();
      if (handlers.onNoclip) handlers.onNoclip(noclipOn);
    }));
    el('settings-body').querySelectorAll('[data-chipnames]').forEach((b) => b.addEventListener('click', () => {
      namesOn = !namesOn;
      try { if (namesOn) localStorage.setItem(NAMES_KEY, '1'); else localStorage.removeItem(NAMES_KEY); } catch { /* kept for this page only */ }
      applyNames();
      renderSettings();
    }));
    el('settings-body').querySelectorAll('[data-timeline]').forEach((b) => b.addEventListener('click', () => {
      timelineOn = !timelineOn;
      try { if (timelineOn) localStorage.removeItem(TIMELINE_KEY); else localStorage.setItem(TIMELINE_KEY, '0'); } catch { /* kept for this page only */ }
      if (!timelineOn && replaying) handlers.onLive();
      syncSidebar();
      renderSettings();
    }));
    el('settings-body').querySelectorAll('[data-youarrow]').forEach((b) => b.addEventListener('click', () => {
      youMode = b.dataset.youarrow;
      try {
        if (youMode === 'you') localStorage.removeItem(YOU_KEY);
        else localStorage.setItem(YOU_KEY, youMode === 'off' ? '0' : youMode);
      } catch { /* kept for this page only */ }
      renderSettings();
    }));
    // Every slider back to what this kind of machine starts at (graphics-settings.js), and the
    // panel drawn again from the numbers main.js now holds.
    // Model detail is a word, not a slider, and goes the same one way into main.js.
    el('settings-body').querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => {
      state.graphics.detail = b.dataset.detail;
      if (handlers.onGraphicsSetting) handlers.onGraphicsSetting('detail', b.dataset.detail);
      renderSettings();
    }));
    el('settings-body').querySelectorAll('[data-post]').forEach((b) => b.addEventListener('click', () => {
      if (handlers.onPostSetting) handlers.onPostSetting(b.dataset.post, b.dataset.postValue);
      renderSettings();
    }));
    el('settings-body').querySelectorAll('[data-post-range]').forEach((r) => r.addEventListener('input', () => {
      const v = Number(r.value);
      if (handlers.onPostSetting) handlers.onPostSetting(r.dataset.postRange, v);
      const out = document.getElementById('bloom-strength-value');
      if (out) out.textContent = v.toFixed(2);
    }));
    el('settings-body').querySelectorAll('[data-graphics-reset]').forEach((b) => b.addEventListener('click', () => {
      if (handlers.onGraphicsReset) handlers.onGraphicsReset();
      if (handlers.graphics) Object.assign(state.graphics, handlers.graphics());
      renderSettings();
    }));
    el('settings-body').querySelectorAll('[data-qualityauto]').forEach((b) => b.addEventListener('click', () => {
      qualityAuto = !qualityAuto;
      try { if (qualityAuto) localStorage.removeItem(QUALITY_KEY); else localStorage.setItem(QUALITY_KEY, '0'); } catch { /* kept for this page only */ }
      renderSettings();
      if (handlers.onQualityAuto) handlers.onQualityAuto(qualityAuto);
    }));
    el('settings-body').querySelectorAll('[data-camfixed]').forEach((b) => b.addEventListener('click', () => {
      setCameraFixed(!cameraFixed());
      renderSettings();
    }));
    el('settings-body').querySelectorAll('[data-director]').forEach((b) => b.addEventListener('click', () => {
      directorOn = !directorOn;
      try { if (directorOn) localStorage.removeItem(DIRECTOR_KEY); else localStorage.setItem(DIRECTOR_KEY, '0'); } catch { /* kept for this page only */ }
      renderSettings();
    }));
    el('settings-body').querySelectorAll('[data-bind]').forEach((b) => b.addEventListener('click', () => {
      const [action, slot] = b.dataset.bind.split(':');
      const want = { action, slot: slot === 'pad' ? 'pad' : Number(slot) };
      const same = rebinding && rebinding.action === want.action && rebinding.slot === want.slot;
      stopCapture();
      bindNote = '';
      if (!same) {
        rebinding = want;
        if (want.slot === 'pad') watchPad();
      }
      renderSettings();
    }));
    const reset = el('settings-body').querySelector('[data-rebind-reset]');
    if (reset) reset.addEventListener('click', () => { stopCapture(); bindNote = ''; resetKeys(); renderSettings(); });
    const resetP = el('settings-body').querySelector('[data-rebind-reset-pad]');
    if (resetP) resetP.addEventListener('click', () => { stopCapture(); bindNote = ''; resetPad(); renderSettings(); });
    const homeMove = el('settings-body').querySelector('#home-move');
    if (homeMove) homeMove.addEventListener('click', () => {
      const to = el('settings-body').querySelector('#home-to').value.trim();
      if (to && handlers.onHomeMove) handlers.onHomeMove(to);
    });
    const hdSave = el('settings-body').querySelector('#hd-dir-save');
    if (hdSave) hdSave.addEventListener('click', () => handlers.onHdDir && handlers.onHdDir(el('settings-body').querySelector('#hd-dir').value.trim()));
    el('settings-body').querySelectorAll('[data-islandsize]')
      .forEach((b) => b.addEventListener('click', () => handlers.onIslandSize && handlers.onIslandSize(Number(b.dataset.islandsize))));
    el('settings-body').querySelectorAll('[data-seamode]')
      .forEach((b) => b.addEventListener('click', () => handlers.onSeaMode(b.dataset.seamode)));
    el('settings-body').querySelectorAll('[data-sea]')
      .forEach((b) => b.addEventListener('click', () => handlers.onJoinSea(b.dataset.sea)));
    el('settings-body').querySelectorAll('[data-forgetsea]').forEach((b) => b.addEventListener('click', () => {
      b.disabled = true;
      if (handlers.onForgetSea) handlers.onForgetSea(b.dataset.forgetsea);
    }));
    const add = el('settings-body').querySelector('#sea-add');
    if (add) add.addEventListener('click', () => {
      const field = el('settings-body').querySelector('#sea-url');
      if (field && field.value.trim()) handlers.onJoinSea(field.value.trim());
    });
  }
  // Capture phase on window, so the key never reaches walk.js or the panel's own Escape.
  addEventListener('keydown', (e) => {
    if (!rebinding) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const k = e.key.toLowerCase();
    if (k === 'escape') { stopCapture(); bindNote = ''; renderSettings(); return; }
    const clear = k === 'delete' || k === 'backspace';
    if (rebinding.slot === 'pad') {
      // Waiting for a button; the keyboard can only empty the cell.
      if (!clear) return;
      bindPad(rebinding.action, null);
      bindNote = '';
    } else {
      const lost = bindKey(rebinding.action, rebinding.slot, clear ? null : k);
      bindNote = lost ? `${keyLabel(k)} was ${says(lost)}'s; it has swapped.` : '';
    }
    stopCapture();
    renderSettings();
  }, true);
  // A pad shows itself to the page only after a button press, and can be pulled out: the
  // controller column follows either way, and a capture waiting on a vanished pad ends.
  addEventListener('gamepadconnected', () => renderSettings());
  addEventListener('gamepaddisconnected', () => {
    if (rebinding && rebinding.slot === 'pad') stopCapture();
    renderSettings();
  });
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

  // Coming into an island's waters: its name on a ribbon across the top of the screen, the
  // way a ship is hailed through a spyglass, and who keeps it underneath. Only the latest
  // arrival shows - sailing on past two islands names the second.
  let arrivalTimer = 0;
  function arrival(name, keeper) {
    const d = el('arrival');
    d.querySelector('b').textContent = name;
    d.querySelector('small').textContent = keeper ? `Kept by ${keeper}` : '';
    d.hidden = false;
    d.classList.remove('fade');
    void d.offsetWidth;
    d.classList.add('show');
    clearTimeout(arrivalTimer);
    arrivalTimer = setTimeout(() => {
      d.classList.add('fade');
      arrivalTimer = setTimeout(() => { d.hidden = true; d.classList.remove('show', 'fade'); }, 700);
    }, 4200);
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
  // The sea not answering (web/js/seaquiet.js builds the words), which shares the box: both
  // stay up until what they name is fixed, and one box cannot sit on top of the other. On
  // its own it wears a toast's colours rather than the skew's (`.skew.quiet` in
  // harbour.css): it breaks nothing and ends by itself, it is only why nobody is walking.
  let seaQuiet = null;
  function renderSkew() {
    const box = el('skew');
    const lines = [];
    if (skewed.size) {
      const who = [...skewed.values()];
      lines.push(`<b>Out of step.</b> ${esc(who.join(', '))} ${who.length === 1 ? 'is' : 'are'} `
        + 'running a different version of the island, so their land is drawn from numbers this '
        + 'page disagrees with. Pull and restart on both sides.');
    }
    if (seaQuiet) lines.push(seaQuiet);
    box.hidden = !lines.length;
    box.classList.toggle('quiet', !skewed.size && !!seaQuiet);
    box.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  }
  function setSkew(id, name) {
    if (name) skewed.set(id, name); else skewed.delete(id);
    renderSkew();
  }
  function setSeaQuiet(html) {
    seaQuiet = html || null;
    renderSkew();
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
    // The download button never leaves the app: Rust fetches the APK and hands it to the
    // phone's installer (src-android/src/lib.rs, install_update), so a tap is a download and
    // an "install this app?" rather than a browser, a downloads folder and a notification.
    // Its href stays what it was, because that is still the way out when this fails.
    const button = el('update-gate-download');
    button.addEventListener('click', (e) => {
      e.preventDefault();
      if (button.dataset.busy) return;
      button.dataset.busy = '1';
      const said = button.textContent;
      button.textContent = 'Fetching the update…';
      ipc.invoke('install_update')
        .then(() => { button.textContent = 'Opening the installer…'; })
        .catch((err) => {
          button.textContent = said;
          toast(`Could not fetch the update (${esc(err)}). Trying the browser instead.`);
          ipc.invoke('plugin:opener|open_url', { url: button.href }).catch(() => {});
        })
        .finally(() => { delete button.dataset.busy; });
    });

    // Everything else that points out of the app - "What is new", the banner's link. The
    // page asks the opener plugin itself rather than leaving it to on_navigation in
    // src-android/src/lib.rs: this is the documented way and it does not depend on the
    // webview handing the click to Rust at all, which is what silently failed up to v0.5.0.
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
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
  // shield, 'drink' for a beer, 'relay' for a beer in each hand (Plans/DONE/bier-en-dronken.md).
  // main.js asks the walk every frame, so only a change - something else picked up in the
  // inventory, a room entered - redraws the row.
  let lmbDoes = 'attack', rmbDoes = 'attack';
  function setMouse(lmb, rmb) {
    if (lmb === lmbDoes && rmb === rmbDoes) return;
    lmbDoes = lmb; rmbDoes = rmb;
    renderWalkKeys();
  }
  const MOUSE_SAYS = { attack: 'attack', block: 'hold to block', drink: 'drink', relay: 'beer relay' };
  const mouseKey = (button, does) => `<span><kbd>${button}</kbd> ${MOUSE_SAYS[does] || MOUSE_SAYS.attack}</span>`;
  function setPad(on) { padConnected = on; renderWalkKeys(); }
  function setIndoors(on) { indoors = !!on; renderWalkKeys(); }
  // The row no longer fits beside everything else on foot: the keys are listed, and
  // rebound, under Settings -> Controls instead. Kept as a function so every caller that
  // redraws it on a change stays as it was; setting SHOW_KEY_ROW brings the row back.
  const SHOW_KEY_ROW = false;
  function renderWalkKeys() {
    el('walk-keys').hidden = !SHOW_KEY_ROW;
    if (!SHOW_KEY_ROW) return;
    // Indoors the room's row has no fight in it, but a pint at the bar is the point of the
    // place, so a button that drinks is still said.
    const sips = (does) => does === 'drink' || does === 'relay';
    const drinks = (sips(lmbDoes) ? mouseKey('LMB', lmbDoes) : '') + (sips(rmbDoes) ? mouseKey('RMB', rmbDoes) : '');
    if (indoors) {
      el('walk-keys').innerHTML = padConnected
        ? `<span class="pad-dot"><i></i>Controller</span><span>Left stick walk</span><span>Right stick look</span>`
          + `<span class="lit"><kbd>${padKey('inside', 'interact')}</kbd> sit down</span>`
          + `<span><kbd>${padKey('inside', 'jump')}</kbd> jump</span><span><kbd>${padKey('inside', 'crouch')}</kbd> crouch</span>`
          + `<span><kbd>${padKey('inside', 'dance')}</kbd> dance</span>`
          + `<span><kbd>${padKey('inside', 'sprint')}</kbd> run</span><span><kbd>${padKey('inside', 'exit')}</kbd> menu</span>`
          + `<span>out through the door</span>`
        : `<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span>`
          + `<span>mouse to look, <kbd>Esc</kbd> frees it, click takes it back</span>`
          + drinks
          + `<span><kbd>Shift</kbd> run</span><span class="lit"><kbd>E</kbd> sit down</span><span><kbd>R</kbd> dance</span>`
          + `<span><kbd>Esc</kbd><kbd>Esc</kbd> menu</span><span>out through the door</span>`;
      return;
    }
    el('walk-keys').innerHTML = padConnected
      ? `<span class="pad-dot"><i></i>Controller</span><span>Left stick walk</span><span>Right stick look</span>`
        + `<span><kbd>${padKey('walk', 'interact')}</kbd> talk</span>`
        + `<span><kbd>${padKey('walk', 'secondary')}</kbd> send away</span>`
        + `<span class="lit"><kbd>${padKey('walk', 'primary')}</kbd> sow</span>`
        + `<span><kbd>${padKey('walk', 'prevTool')}</kbd><kbd>${padKey('walk', 'nextTool')}</kbd> seed</span>`
        + `<span><kbd>${padKey('walk', 'jump')}</kbd> jump</span><span><kbd>${padKey('walk', 'crouch')}</kbd> crouch, hold to lie down</span>`
        + `<span><kbd>${padKey('walk', 'dance')}</kbd> dance</span>`
        + `<span><kbd>${padKey('walk', 'sprint')}</kbd> run</span><span><kbd>${padKey('walk', 'bike')}</kbd> bike</span>`
        + `<span><kbd>${padKey('walk', 'exit')}</kbd> back to the sky</span>`
      : `<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span><span>mouse to look, <kbd>Esc</kbd> frees it, click takes it back</span>`
        // The left button is the left hand and the right the right, so each says what its
        // own hand does rather than one line explaining the rule.
        + mouseKey('LMB', lmbDoes) + mouseKey('RMB', rmbDoes)
        + `<span><kbd>Shift</kbd> run</span><span><kbd>F</kbd> bike</span><span><kbd>V</kbd> first person</span><span><kbd>Space</kbd> jump</span><span><kbd>C</kbd> crouch, hold to lie down</span><span><kbd>R</kbd> dance</span><span><kbd>E</kbd> talk</span><span class="lit"><kbd>T</kbd> say something</span>`
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
    setLabel('walk-btn', on ? 'Fly up' : 'Walk', on ? 'Fly up into the sky (Esc, twice)' : 'Walk the island on foot (Enter)');
    // Enter is a key from the sky only, so the badge goes while you are down here.
    el('walk-btn').dataset.key = on ? '' : '↵';
    el('walk-btn').setAttribute('aria-keyshortcuts', on ? 'Escape' : 'Enter');
    if (on) { hideSide(); renderWalkKeys(); }
    syncSidebar();
  }
  // From above, with a hand on the hamlets (web/js/plan-mode.js). Like walking, the right
  // column empties and the labels go; unlike walking, the chips stay, because Done is one.
  function setPlanning(on) {
    planning = !!on;
    el('labels').hidden = planning || walking;
    el('hover-label').hidden = true;
    el('plan-btn').classList.toggle('on', planning);
    // P is a letter from the sky only (main.js ORBIT_KEYS), so Done names none.
    setLabel('plan-btn', planning ? 'Done' : 'Plan',
      planning ? 'Done: leave the planner' : 'The island from above: move hamlets, zone ground (P)');
    el('plan-btn').dataset.key = planning ? '' : 'P';
    if (planning) el('plan-btn').removeAttribute('aria-keyshortcuts'); else el('plan-btn').setAttribute('aria-keyshortcuts', 'P');
    if (planning) hideSide();
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
  // What a keeper says to your face (main.js speakToKeeper): who, the words, and the key
  // that walks on. It stays until main.js takes it down - the toast it used to be went by
  // itself after a few seconds, while the keeper was still standing there looking at you.
  function setSpeech(s) {
    const p = el('speech');
    if (!s) { p.hidden = true; p.innerHTML = ''; return; }
    p.hidden = false;
    p.innerHTML = `<b class="speech-who">${esc(s.who)}</b><span class="speech-line">${esc(s.line)}</span>`
      + `<span class="speech-key">${document.body.classList.contains('standalone') ? 'Tap or <kbd>X</kbd> to walk on'
        : padConnected ? '<kbd>X</kbd> walk on' : '<kbd>Esc</kbd> walk on'}</span>`;
  }

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
    // An offer that stands for as long as you do (the helm, while you steer) goes down in
    // the HUD's own column: over the middle it hid the very ship you were sailing.
    p.classList.toggle('low', near.kind === 'leavehelm');
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
  el('map-btn').addEventListener('click', () => handlers.onToggleMap && handlers.onToggleMap());
  el('found-btn').addEventListener('click', () => handlers.onFoundSettler());
  el('avatar-btn').addEventListener('click', () => handlers.onCustomize());
  el('build-btn').addEventListener('click', () => handlers.onBuild());
  el('plan-btn').addEventListener('click', () => handlers.onTogglePlan && handlers.onTogglePlan());

  setupShell();

  return {
    state, setVillage, setLive, setClock, setBuilding, showDossier, buildLegend, labels, hamletLabels,
    setSigns, setKeeper, setStandalone, setSound, setUpdate, setGate, buildEnabled: () => buildOn, noclipEnabled: () => noclipOn, youMarkerMode: () => youMode, directorEnabled: () => directorOn, qualityAutoEnabled: () => qualityAuto,
    setHover, toast, arrival, setSkew, setSeaQuiet, setChronicle, boot, setWalking, setPlanning, setWalkPrompt, setPouch, setBuildHud, setPad, setConfirm, setIndoors, setMouse, setGive, setSpeech,
    closeDossier: () => close('dossier'),
    // For web/js/animal-dossier.js: open one of the side panels (closing the others), close
    // one, and re-run the right column's one-thing-at-a-time rule after drawing its card.
    openSide, closeSide: close, syncPanels: syncSidebar,
    // What B clears from up in the sky: none of these is modal, so nothing else changes.
    setSeas, setIslandSize, setHome,
    closeOverlays: () => SIDE.forEach(close),
    sysmenu: menu,
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
