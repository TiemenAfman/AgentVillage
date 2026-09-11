// The town hall: the register of every session this machine has recorded, and the way to
// offer one of them a place on the island. Sessions from before the island was founded
// live here until you invite them; the ones already living here can be released again.
//
// Inviting is not the same as sending someone away. A settler you release keeps their
// house records and can be invited back; the register is the list, not the village.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE_LABEL = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', unknown: 'Model unknown' };
const TIER_LABEL = { tent: 'Tent', hut: 'Hut', cottage: 'Cottage', house: 'House', manor: 'Manor', keep: 'Keep' };

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return `today, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function createTownHall(root, { onInvited, onFound, onClose }) {
  let sessions = [];
  let filter = 'available';
  let query = '';
  let busy = false;

  const el = document.createElement('div');
  el.className = 'handover';
  el.hidden = true;
  root.appendChild(el);

  function onKey(e) {
    if (el.hidden) return;
    if (e.key === 'Escape') {
      // Stopped dead, not just from bubbling on: walk.js listens on this same window,
      // and close() has just let its feet go - so it would read this very Escape as
      // "back to the sky". stopPropagation cannot help with a listener on the same
      // element; only stopImmediatePropagation can.
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }
    e.stopPropagation();
  }
  el.addEventListener('keydown', (e) => e.stopPropagation());
  addEventListener('keydown', onKey);

  async function open() {
    el.hidden = false;
    el.innerHTML = `<div class="handover-panel wide"><p class="muted">Opening the register…</p></div>`;
    await load();
  }

  async function load() {
    try {
      const r = await fetch('/api/sessions', { cache: 'no-store' });
      sessions = (await r.json()).sessions || [];
    } catch (e) {
      el.innerHTML = `<div class="handover-panel wide"><p class="ho-warn">The register could not be read: ${esc(e.message)}</p></div>`;
      return;
    }
    render();
  }

  function shown() {
    const q = query.trim().toLowerCase();
    let list = sessions;
    if (filter === 'available') list = list.filter((s) => !s.onIsland);
    else if (filter === 'island') list = list.filter((s) => s.onIsland);
    if (q) {
      list = list.filter((s) => [s.name, s.title, s.project, s.model]
        .some((v) => String(v || '').toLowerCase().includes(q)));
    }
    return list;
  }

  function render() {
    const list = shown();
    const onIsland = sessions.filter((s) => s.onIsland).length;
    el.innerHTML = `
      <div class="handover-panel wide">
        <button class="x" id="th-close">✕</button>
        <h3>The town hall</h3>
        <p class="ho-sum">Every session this machine remembers. Invite one and it takes a plot and
        builds according to what it did. ${onIsland} of ${sessions.length} live here already.</p>

        <div class="th-controls">
          <input id="th-search" class="ho-input" placeholder="Search a name, a session, a project…" value="${esc(query)}" spellcheck="false">
          <div class="chips">
            <button class="chip${filter === 'available' ? ' on' : ''}" data-f="available">Not here yet</button>
            <button class="chip${filter === 'island' ? ' on' : ''}" data-f="island">On the island</button>
            <button class="chip${filter === 'all' ? ' on' : ''}" data-f="all">Everyone</button>
          </div>
        </div>

        <div class="th-list" id="th-list">
          ${list.length ? list.map(row).join('') : '<p class="muted">Nothing matches that.</p>'}
        </div>

        <div class="th-foot">
          <button class="btn" id="th-new">Send for a newcomer instead</button>
          <span class="muted" id="th-out"></span>
        </div>
      </div>`;

    const search = el.querySelector('#th-search');
    search.addEventListener('input', () => {
      query = search.value;
      const pos = search.selectionStart;
      render();
      const s2 = el.querySelector('#th-search');
      s2.focus();
      s2.setSelectionRange(pos, pos);
    });
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
    el.querySelector('#th-close').addEventListener('click', close);
    el.querySelector('#th-new').addEventListener('click', () => { close(); onFound && onFound(); });
    el.querySelectorAll('[data-invite]').forEach((b) => b.addEventListener('click', () => invite(b.dataset.invite, false)));
    el.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', () => invite(b.dataset.release, true)));
  }

  function row(s) {
    return `
      <article class="th-row${s.onIsland ? ' here' : ''}">
        <div class="th-who">
          <b>${esc(s.name)}</b>
          <span class="tag style-${esc(s.style)}">${esc(STYLE_LABEL[s.style] || s.style)}</span>
          ${s.onIsland ? '<span class="tag ok">on the island</span>' : `<span class="tag">${esc(TIER_LABEL[s.tier] || s.tier)}</span>`}
        </div>
        <p class="th-title">${esc(s.title || 'Untitled session')}</p>
        <div class="th-meta">
          <span>${esc(s.project || 'somewhere')}</span>
          <span>${s.turns} turn${s.turns === 1 ? '' : 's'}</span>
          <span>${esc(when(s.lastAt || s.startedAt))}</span>
        </div>
        ${s.onIsland
    ? (s.founder ? `<button class="btn tiny" data-release="${esc(s.sessionId)}">Release</button>` : '<span class="muted tiny">arrived on its own</span>')
    : `<button class="btn primary tiny" data-invite="${esc(s.sessionId)}">Invite</button>`}
      </article>`;
  }

  async function invite(sessionId, remove) {
    if (busy) return;
    busy = true;
    const out = el.querySelector('#th-out');
    out.textContent = remove ? 'Releasing…' : 'Inviting…';
    try {
      const r = await fetch('/api/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, remove: !!remove }),
      });
      const body = await r.json();
      if (!r.ok) { out.innerHTML = `<span class="bad">${esc(body.error || 'that did not work')}</span>`; return; }
      const who = sessions.find((s) => s.sessionId === sessionId);
      out.innerHTML = `<span class="good">${esc(who ? who.name : 'They')} ${remove ? 'left the register' : 'is moving in'}.</span>`;
      onInvited && onInvited({ sessionId, name: who && who.name, adopted: !remove });
      await load();
    } catch (e) {
      out.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    } finally {
      busy = false;
    }
  }

  function close() {
    el.hidden = true;
    el.innerHTML = '';
    onClose && onClose();
  }

  return { open, close, isOpen: () => !el.hidden, dispose: () => { removeEventListener('keydown', onKey); el.remove(); } };
}
