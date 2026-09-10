// A board seen close up: cards pinned to it, and the hand-over flow that turns one into
// a working agent. Works with the mouse, the keyboard, and a controller driving a cursor
// over the cards.
//
// Two boards stand on the town square and this draws both of them. The sprint board
// carries the Jira cards of whatever the village is working on; the island board carries
// the GitHub issues of the repository the island itself is built from. They differ in
// where the cards come from, how they are grouped and which workflow an agent is sent
// off with - not in anything you do with them, so it is one board with two sources.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TYPE_COLOUR = {
  Bug: '#d94f3d', Story: '#6fb84a', Epic: '#9a6fd9', Task: '#3d7ed9',
  'Service Request': '#d9a33d', Subtaak: '#8a8a8a',
  Enhancement: '#6fb84a', Documentation: '#3d7ed9', Question: '#9a6fd9', Issue: '#8a8a8a',
};
const PIN_COLOUR = ['#d94f3d', '#3d7ed9', '#d9a33d', '#6fb84a', '#9a6fd9'];
const WHO_KEY = 'promptholm.board.who';   // + the source, because the two boards filter differently

// Grouped to match a Jira workflow with Dutch status names as well as English ones.
// Work that can still be handed out comes first; what is waiting on others comes last.
const JIRA_GROUPS = [
  { id: 'todo', label: 'Up for grabs', match: (i) => !i.done && (i.statusCategory === 'new' || /ijskast|nog doen|to ?do|open|backlog|nieuw/i.test(i.status)) },
  { id: 'doing', label: 'Being worked on', match: (i) => !i.done && /actief|progress|bezig/i.test(i.status) },
  { id: 'check', label: 'Being checked or tested', match: (i) => !i.done && /controleren|testen|review|check|test/i.test(i.status) },
  { id: 'ready', label: 'Ready for deploy and FAT', match: (i) => !i.done && /ready|deploy|fat/i.test(i.status) },
  { id: 'done', label: 'Done', match: (i) => i.done },
  { id: 'rest', label: 'Elsewhere', match: () => true },
];

// GitHub has two states and no columns, so what tells you an issue is taken is the
// "in progress" label the workflow puts on, or somebody being assigned to it.
const GITHUB_GROUPS = [
  { id: 'todo', label: 'Up for grabs', match: (i) => !i.done && !i.working && !i.assignee },
  { id: 'doing', label: 'Being worked on', match: (i) => !i.done && (i.working || i.assignee) },
  { id: 'done', label: 'Done', match: (i) => i.done && i.completed },
  { id: 'shelved', label: 'Closed, not planned', match: (i) => i.done },
  { id: 'rest', label: 'Elsewhere', match: () => true },
];

const SOURCES = {
  jira: {
    id: 'jira',
    api: '/api/sprint',
    board: 'Sprint board',
    title: (d) => d.sprintName || 'Sprint board',
    where: 'Jira',
    // A sprint is divided up between people, so it opens on your own name.
    who: 'me',
    refresh: 'Fetch from Jira again',
    groups: JIRA_GROUPS,
    skill: 'jira-ticket-oppakken',
    knows: 'knows the Jira workflow',
    // What the settler is about to be told to do, shown before you confirm.
    workflow: (key) => `will take <b>${esc(key)}</b> and work it end to end, following the
      <code>jira-ticket-oppakken</code> workflow: branch from develop, fix behind a gate, push,
      write the test instruction into the ticket and move it to Ready for deploy and FAT.`,
    without: 'This folder has no <code>jira-ticket-oppakken</code> skill. The agent will have to '
      + 'improvise the workflow; a settler from the repository that carries it is the safer choice.',
  },
  github: {
    id: 'github',
    api: '/api/issues',
    board: 'Island board',
    title: (d) => d.repo || 'Island board',
    where: 'GitHub',
    // Nobody is assigned to most issues here - the account the board reads with cannot
    // even do the assigning - so opening on one person would show an empty cork.
    who: 'all',
    refresh: 'Ask GitHub again',
    groups: GITHUB_GROUPS,
    skill: 'issue-oppakken',
    knows: 'knows the issue workflow',
    workflow: (key) => `will take <b>${esc(key)}</b> and work it the way this repository does,
      following the <code>issue-oppakken</code> skill: a branch from <code>origin/main</code> named
      after the issue, the issue marked as picked up, and when it is done the branch pushed and the
      issue closed as completed.`,
    without: 'This folder has no <code>issue-oppakken</code> skill. The agent is told the route in '
      + 'full instead, but a folder that carries the skill is the safer choice.',
  },
};

const CLICKABLE = '.card-pin, .ho-list li, button, a, select';

export function createBoard(root, { onDispatch, onClose, getSettlers }) {
  let data = { issues: [], assignments: [] };
  let src = SOURCES.jira;   // which board you walked up to
  let filter = 'open';
  let who = src.who;        // 'me' | 'all' | 'none' | a display name
  let selected = null;      // the issue we are handing over
  let busy = false;

  function rememberWho() {
    try { localStorage.setItem(`${WHO_KEY}.${src.id}`, who); } catch { /* no storage */ }
  }
  function recallWho() {
    try { who = localStorage.getItem(`${WHO_KEY}.${src.id}`) || src.who; } catch { who = src.who; }
  }
  recallWho();

  const el = document.createElement('div');
  el.className = 'board-overlay';
  el.hidden = true;
  el.innerHTML = `
    <div class="board-frame">
      <header class="board-head">
        <div>
          <h2 id="board-title">Sprint board</h2>
          <p id="board-sub" class="muted"></p>
        </div>
        <div class="board-actions">
          <label class="who"><span>Assigned to</span><select id="board-who"></select></label>
          <div class="chips" id="board-filters"></div>
          <button class="chip" id="board-refresh" title="Read the board again">Refresh</button>
          <button class="chip" id="board-close">Close · Esc</button>
        </div>
      </header>
      <div class="cork" id="board-cork"></div>
      <div class="board-note" id="board-note" hidden></div>
      <div class="board-hint" id="board-hint"></div>
    </div>
    <div class="handover" id="handover" hidden></div>
    <div class="vcursor" id="vcursor" hidden></div>`;
  root.appendChild(el);

  const cork = el.querySelector('#board-cork');
  const handover = el.querySelector('#handover');
  const whoSelect = el.querySelector('#board-who');
  const cursor = el.querySelector('#vcursor');
  el.querySelector('#board-close').addEventListener('click', () => close());
  el.querySelector('#board-refresh').addEventListener('click', () => load(true));
  whoSelect.addEventListener('change', () => {
    who = whoSelect.value;
    rememberWho();
    render();
  });

  const filters = [['open', 'Open'], ['all', 'Everything'], ['mine', 'Handed out']];
  el.querySelector('#board-filters').innerHTML = filters
    .map(([id, label]) => `<button class="chip${id === filter ? ' on' : ''}" data-f="${id}">${label}</button>`).join('');
  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f;
    el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x.dataset.f === filter));
    render();
  }));

  // ---- keyboard: arrows walk the pinboard, Enter takes a card ---------------
  let kfocus = null;

  function focusables() {
    if (!handover.hidden) {
      return [...handover.querySelectorAll('.ho-list li, .ho-confirm button, #ho-close')];
    }
    return [...cork.querySelectorAll('.card-pin')];
  }

  function setFocus(node, scroll = true) {
    if (kfocus) kfocus.classList.remove('kfocus');
    kfocus = node || null;
    if (!kfocus) return;
    kfocus.classList.add('kfocus');
    if (scroll) kfocus.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Pick the nearest item in the direction pressed, judged from box centres, so a
  // wrapped grid of cards behaves the way it looks.
  function moveFocus(dx, dy) {
    const items = focusables();
    if (!items.length) return;
    if (!kfocus || !items.includes(kfocus)) { setFocus(items[0]); return; }
    const from = kfocus.getBoundingClientRect();
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    let best = null, bestScore = Infinity;
    for (const it of items) {
      if (it === kfocus) continue;
      const r = it.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ax = cx - fx, ay = cy - fy;
      const along = dx ? ax * dx : ay * dy;
      if (along <= 1) continue;                       // not in the direction we asked for
      const across = Math.abs(dx ? ay : ax);
      const score = along + across * 2.2;             // prefer straight ahead
      if (score < bestScore) { bestScore = score; best = it; }
    }
    if (best) setFocus(best);
  }

  function onKey(e) {
    if (el.hidden) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); back(); return; }
    if (e.target.tagName === 'SELECT') return;        // let the dropdown have its arrows
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[k]) {
      e.preventDefault();
      moveFocus(dirs[k][0], dirs[k][1]);
      return;
    }
    if (k === 'Tab') {
      e.preventDefault();
      const items = focusables();
      if (!items.length) return;
      const i = items.indexOf(kfocus);
      setFocus(items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]);
      return;
    }
    if (k === 'Enter' || k === ' ') {
      if (!kfocus) { e.preventDefault(); setFocus(focusables()[0]); return; }
      e.preventDefault();
      kfocus.click();
      return;
    }
    if (k === 'r' || k === 'R') { e.preventDefault(); load(true); }
    if (k === 'a' || k === 'A') { e.preventDefault(); cycleSelect(whoSelect); }
  }
  addEventListener('keydown', onKey);

  // ---- data ------------------------------------------------------------------
  async function load(force = false) {
    setNote('Reading the board…');
    try {
      const r = await fetch(`${src.api}${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
      data = await r.json();
      setNote(data.note || readOnlyNote());
      render();
    } catch (e) {
      setNote(`The board could not be read: ${e.message}`);
    }
  }

  function setNote(text) {
    const n = el.querySelector('#board-note');
    n.textContent = text || '';
    n.hidden = !text;
  }

  // An account that may only read the repository can comment on an issue but cannot put
  // a label on it, so "in progress" will never appear here and an agent working one of
  // these cards has only its comment to say it is busy. Better said than discovered.
  function readOnlyNote() {
    if (src !== SOURCES.github || data.canWrite !== false) return '';
    return `gh is logged in as ${data.me || 'someone'}, who may read this repository but not label `
      + 'or assign in it. Nothing here will be marked "in progress"; an agent says so in a comment instead.';
  }

  // Who the Jira token belongs to. No fallback name: if Jira has not told us yet,
  // the filter simply shows everyone.
  function meName() { return data.me || null; }
  function assignmentFor(key) {
    return (data.assignments || []).find((a) => a.issueKey === key && a.status !== 'failed');
  }

  function visible() {
    let issues = data.issues || [];
    if (filter === 'mine') issues = issues.filter((i) => assignmentFor(i.key));
    else if (filter === 'open') issues = issues.filter((i) => !i.done);
    if (who === 'me' && meName()) issues = issues.filter((i) => i.assignee === meName());
    else if (who === 'none') issues = issues.filter((i) => !i.assignee);
    else if (who !== 'all') issues = issues.filter((i) => i.assignee === who);
    return issues;
  }

  function renderWho() {
    const names = [...new Set((data.issues || []).map((i) => i.assignee).filter(Boolean))].sort();
    const me = meName();
    const opts = [
      ['me', me ? `${me} (me)` : 'Me'], ['all', 'Everyone'], ['none', 'Unassigned'],
      ...names.filter((n) => n !== me).map((n) => [n, n]),
    ];
    if (who !== 'me' && who !== 'all' && who !== 'none' && !names.includes(who)) who = src.who;
    whoSelect.innerHTML = opts.map(([v, label]) => `<option value="${esc(v)}"${v === who ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  // ---- the cork ------------------------------------------------------------
  function render() {
    renderWho();
    el.querySelector('#board-title').textContent = src.title(data);
    const open = (data.issues || []).filter((i) => !i.done).length;
    const handed = (data.assignments || []).filter((a) => a.status !== 'failed').length;
    const shown = visible();
    el.querySelector('#board-sub').textContent =
      `${shown.length} shown · ${open} open of ${(data.issues || []).length} · ${handed} handed out${data.fetchedAt ? ` · read ${timeAgo(data.fetchedAt)}` : ''}`;

    if (!shown.length) {
      cork.innerHTML = `<p class="board-empty">Nothing pinned here for ${who === 'me' ? 'you' : who === 'all' ? 'anyone' : who === 'none' ? 'nobody in particular' : esc(who)}. Try "Everyone".</p>`;
      return;
    }
    const groups = src.groups.map((g) => ({ ...g, items: [] }));
    for (const i of shown) (groups.find((g) => g.match(i)) || groups[groups.length - 1]).items.push(i);

    cork.innerHTML = groups.filter((g) => g.items.length).map((g) => `
      <section class="cork-group">
        <h3>${esc(g.label)} <span>${g.items.length}</span></h3>
        <div class="cards">${g.items.map(card).join('')}</div>
      </section>`).join('');

    cork.querySelectorAll('[data-key]').forEach((c) => {
      c.addEventListener('click', (ev) => {
        if (ev.target.closest('a')) return;
        openHandover(c.dataset.key);
      });
    });
    setFocus(cork.querySelector('.card-pin'), false);
    hint();
  }

  function hint() {
    const pad = cur.shown;
    el.querySelector('#board-hint').innerHTML = pad
      ? `<kbd>stick</kbd> move the pointer · <kbd>A</kbd> pick · <kbd>B</kbd> back · <kbd>Y</kbd> refresh · <kbd>right stick</kbd> scroll`
      : `<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> move · <kbd>Enter</kbd> pick · <kbd>Esc</kbd> back · <kbd>A</kbd> switch person · <kbd>R</kbd> refresh · or just use the mouse`;
  }

  function card(i) {
    const a = assignmentFor(i.key);
    const tilt = ((hash(i.key) % 11) - 5) * 0.22;
    const pin = PIN_COLOUR[hash(i.key) % PIN_COLOUR.length];
    const type = TYPE_COLOUR[i.type] || '#8a8a8a';
    return `
      <article class="card-pin${a ? ' taken' : ''}" data-key="${esc(i.key)}" style="--tilt:${tilt}deg">
        <span class="pin" style="background:${pin}"></span>
        <div class="card-top">
          <b>${esc(i.key)}</b>
          <span class="type" style="--t:${type}">${esc(i.type)}</span>
        </div>
        <p class="card-sum">${esc(i.summary)}</p>
        <div class="card-foot">
          <span class="status">${esc(i.status)}</span>
          ${i.assignee ? `<span class="who">${esc(i.assignee)}</span>` : ''}
        </div>
        ${a ? `<div class="ribbon">${a.status === 'running' ? 'working' : esc(a.status)} · ${esc(a.settlerName || '')}</div>` : ''}
      </article>`;
  }

  // ---- handing a card to a settler ---------------------------------------
  function openHandover(key) {
    const issue = (data.issues || []).find((i) => i.key === key);
    if (!issue) return;
    selected = issue;
    const existing = assignmentFor(key);
    // settlers whose folder carries this board's workflow skill are the natural choice
    const settlers = getSettlers().filter((s) => s.cwd).sort((a, b) => (knows(b) ? 1 : 0) - (knows(a) ? 1 : 0));
    handover.hidden = false;
    handover.innerHTML = `
      <div class="handover-panel">
        <button class="x" id="ho-close">✕</button>
        <h3>${esc(issue.key)}</h3>
        <p class="ho-sum">${esc(issue.summary)}</p>
        <p class="muted">${esc(issue.status)}${issue.assignee ? ` · assigned to ${esc(issue.assignee)}` : ' · unassigned'}${issue.url ? ` · <a href="${esc(issue.url)}" target="_blank" rel="noreferrer">Open on ${esc(src.where)}</a>` : ''}</p>
        ${existing ? `<p class="ho-warn">Already handed to ${esc(existing.settlerName || 'someone')} ${timeAgo(existing.at)}. Handing it over again starts a second agent.</p>` : ''}
        <h4>Hand it to</h4>
        <ul class="ho-list">
          <li data-id="new" class="newcomer">
            <b>A newcomer</b> <span class="tag">a fresh settler arrives for this</span>
            <small>Pick the project folder yourself</small>
          </li>
          ${settlers.map((s) => `
          <li data-id="${esc(s.id)}">
            <b>${esc(s.name)}</b>${knows(s) ? ` <span class="tag ok">${esc(src.knows)}</span>` : ''}
            <small>${esc(s.districtName || 'somewhere')} · ${esc(s.modelLabel || 'model unknown')}</small>
            <em>${esc(s.cwd)}</em>
          </li>`).join('')}
        </ul>
        <div id="ho-confirm"></div>
      </div>`;
    handover.querySelector('#ho-close').addEventListener('click', closeHandover);
    handover.querySelectorAll('.ho-list li').forEach((li) => li.addEventListener('click', () => {
      if (li.dataset.id === 'new') chooseFolder();
      else confirmWith(li.dataset.id);
    }));
    setFocus(handover.querySelector('.ho-list li'), false);
  }

  // Does this settler's folder carry the skill this board's workflow is written in?
  // Older village data only knows about the Jira one.
  function knows(s) {
    if (!s) return false;
    if (s.skills) return !!s.skills[src === SOURCES.github ? 'issue' : 'jira'];
    return src === SOURCES.jira && !!s.jira;
  }
  function folderKnows(f) {
    return src === SOURCES.github ? !!f.issue : !!f.jira;
  }

  // ---- sending a newcomer --------------------------------------------------
  const MODELS = [
    ['', 'Whatever Claude Code defaults to'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-opus-5', 'Opus 5'],
    ['claude-sonnet-5', 'Sonnet 5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
  ];

  async function chooseFolder() {
    handover.querySelectorAll('.ho-list li').forEach((li) => li.classList.toggle('picked', li.dataset.id === 'new'));
    const box = handover.querySelector('#ho-confirm');
    box.innerHTML = '<p class="muted">Looking for project folders…</p>';
    let folders = [];
    try {
      const r = await fetch('/api/folders', { cache: 'no-store' });
      folders = (await r.json()).folders || [];
      // The server lists the Jira repositories first; this board wants its own kind at
      // the top. The sort is stable, so everything else keeps the order it came in.
      folders.sort((a, b) => (folderKnows(b) ? 1 : 0) - (folderKnows(a) ? 1 : 0));
    } catch { /* fall back to typing a path */ }

    box.innerHTML = `
      <div class="ho-confirm">
        <h4 style="margin-top:0">Where should the newcomer work?</h4>
        <select id="nc-folder" size="1">
          ${folders.map((f) => `<option value="${esc(f.path)}">${esc(f.name)}${folderKnows(f) ? '  ✓ knows the workflow' : ''}${f.worktree ? '  (worktree)' : ''} — ${esc(f.path)}</option>`).join('')}
          <option value="__other">Somewhere else, let me type it…</option>
        </select>
        <p id="nc-other" hidden><input id="nc-path" class="ho-input" placeholder="C:\\Development\\..." spellcheck="false"></p>
        <h4>With which model?</h4>
        <select id="nc-model">${MODELS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
        <p id="nc-warn"></p>
        <div class="ho-buttons">
          <button class="btn primary" id="nc-go">Send the newcomer</button>
          <button class="btn" id="nc-dry">Only prepare the command</button>
        </div>
        <p class="ho-out" id="ho-out"></p>
      </div>`;

    const folderSel = box.querySelector('#nc-folder');
    const other = box.querySelector('#nc-other');
    const pathInput = box.querySelector('#nc-path');
    const warn = box.querySelector('#nc-warn');
    const chosen = () => (folderSel.value === '__other' ? pathInput.value.trim() : folderSel.value);
    const refreshWarn = () => {
      other.hidden = folderSel.value !== '__other';
      const f = folders.find((x) => x.path === folderSel.value);
      const lines = [];
      if (f && !folderKnows(f)) lines.push(`This folder has no <code>${esc(src.skill)}</code> skill. ${src.without}`);
      // Sending an agent into the checkout the island is being served from means it
      // switches branches under the page you are looking at.
      if (f && data.islandRoot && sameFolder(f.path, data.islandRoot)) {
        lines.push('This is the checkout this island is running from. An agent branching here '
          + 'changes the island under your feet; a worktree is the quieter choice.');
      }
      warn.innerHTML = lines.map((l) => `<span class="ho-warn">${l}</span>`).join('<br>');
    };
    folderSel.addEventListener('change', refreshWarn);
    refreshWarn();
    box.querySelector('#nc-go').addEventListener('click', () => sendNew(chosen(), box.querySelector('#nc-model').value, false));
    box.querySelector('#nc-dry').addEventListener('click', () => sendNew(chosen(), box.querySelector('#nc-model').value, true));
    setFocus(folderSel);
  }

  async function sendNew(cwd, model, dryRun) {
    if (!cwd) { handover.querySelector('#ho-out').innerHTML = '<span class="bad">Pick a folder first.</span>'; return; }
    await post({ issueKey: selected.key, cwd, model: model || null, dryRun });
  }

  function confirmWith(buildingId) {
    const s = getSettlers().find((x) => x.id === buildingId);
    if (!s || !selected) return;
    handover.querySelectorAll('.ho-list li').forEach((li) => li.classList.toggle('picked', li.dataset.id === buildingId));
    const box = handover.querySelector('#ho-confirm');
    box.innerHTML = `
      <div class="ho-confirm">
        <p>${esc(s.name)} ${src.workflow(selected.key)}</p>
        <dl>
          <dt>Folder</dt><dd>${esc(s.cwd)}</dd>
          <dt>Model</dt><dd>${esc(s.model || 'the default')}</dd>
          <dt>Permission</dt><dd>full, unattended</dd>
        </dl>
        ${knows(s) ? '' : `<p class="ho-warn">This folder has no <code>${esc(src.skill)}</code> skill. ${src.without}</p>`}
        ${data.islandRoot && sameFolder(s.cwd, data.islandRoot) ? '<p class="ho-warn">This is the checkout this island is running from. An agent branching here changes the island under your feet; a worktree is the quieter choice.</p>' : ''}
        <div class="ho-buttons">
          <button class="btn primary" id="ho-go">Hand it over</button>
          <button class="btn" id="ho-dry">Only prepare the command</button>
        </div>
        <p class="ho-out" id="ho-out"></p>
      </div>`;
    box.querySelector('#ho-go').addEventListener('click', () => send(buildingId, false));
    box.querySelector('#ho-dry').addEventListener('click', () => send(buildingId, true));
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setFocus(box.querySelector('#ho-go'));
  }

  function send(buildingId, dryRun) {
    return post({ issueKey: selected && selected.key, buildingId, dryRun });
  }

  async function post(payload) {
    if (busy || !selected) return;
    payload.source = src === SOURCES.github ? 'github' : 'jira';
    busy = true;
    const out = handover.querySelector('#ho-out');
    out.textContent = payload.dryRun ? 'Preparing…' : 'Waking the settler…';
    try {
      const r = await fetch('/api/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await r.json();
      if (!r.ok) { out.innerHTML = `<span class="bad">${esc(body.error || 'that did not work')}</span>`; return; }
      out.innerHTML = payload.dryRun
        ? `Ready to run:<br><code>${esc(body.command)}</code>`
        : `<span class="good">${esc(body.settlerName)}${body.newcomer ? ' stepped ashore and' : ''} took ${esc(body.issueKey)}.</span>`;
      onDispatch && onDispatch(body);
      await load(false);
    } catch (e) {
      out.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    } finally {
      busy = false;
    }
  }

  function closeHandover() {
    selected = null;
    handover.hidden = true;
    handover.innerHTML = '';
    setFocus(cork.querySelector('.card-pin'), false);
  }
  function back() { if (selected) closeHandover(); else close(); }

  // ---- controller: a cursor over the cards ---------------------------------
  const cur = { x: innerWidth / 2, y: innerHeight / 2, hover: null, shown: false };
  function showCursor() {
    if (cur.shown) return;
    cur.shown = true;
    cursor.hidden = false;
    cur.x = innerWidth / 2; cur.y = innerHeight * 0.45;
    setFocus(null);           // the pointer takes over from the keyboard ring
    placeCursor();
    hint();
  }
  function hideCursor() {
    cur.shown = false;
    cursor.hidden = true;
    if (cur.hover) { cur.hover.classList.remove('vhover'); cur.hover = null; }
  }
  function placeCursor() {
    cursor.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
    const under = document.elementFromPoint(cur.x, cur.y);
    const target = under ? under.closest(CLICKABLE) : null;
    if (target !== cur.hover) {
      if (cur.hover) cur.hover.classList.remove('vhover');
      cur.hover = target;
      if (target) target.classList.add('vhover');
    }
  }
  function pad(p, dt) {
    if (el.hidden) return;
    showCursor();
    const speed = 1100 * dt;
    let dx = p.move.x, dy = p.move.y;
    if (p.down(14)) dx -= 0.6; if (p.down(15)) dx += 0.6;   // d-pad nudges
    if (p.down(12)) dy -= 0.6; if (p.down(13)) dy += 0.6;
    if (dx || dy) {
      cur.x = Math.max(4, Math.min(innerWidth - 4, cur.x + dx * speed));
      cur.y = Math.max(4, Math.min(innerHeight - 4, cur.y + dy * speed));
    }
    // right stick scrolls whatever the cursor is over, or the cork
    if (Math.abs(p.look.y) > 0.01) {
      const under = document.elementFromPoint(cur.x, cur.y);
      const pane = (under && under.closest('.handover-panel, .cork')) || cork;
      pane.scrollTop += p.look.y * 900 * dt;
    }
    placeCursor();
    if (p.hit(0) && cur.hover) {                          // A: press what is under the cursor
      cursor.classList.add('press');
      setTimeout(() => cursor.classList.remove('press'), 140);
      if (cur.hover.tagName === 'SELECT') cycleSelect(cur.hover);
      else if (cur.hover.tagName === 'A') window.open(cur.hover.href, '_blank', 'noreferrer');
      else cur.hover.click();
    }
    if (p.hit(1)) back();                                  // B: one step back
    if (p.hit(3)) load(true);                              // Y: refresh
  }
  function cycleSelect(sel) {
    sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
    sel.dispatchEvent(new Event('change'));
  }

  // ---- open / close --------------------------------------------------------
  // Which board you walked up to decides where the cards come from. Switching source
  // throws the old ones away rather than showing Jira cards under a GitHub heading for
  // the moment it takes to fetch.
  function open(source = 'jira') {
    const next = SOURCES[source] || SOURCES.jira;
    if (next !== src) {
      src = next;
      data = { issues: [], assignments: [] };
      cork.innerHTML = '';
      recallWho();          // each board remembers who you last looked at it for
    }
    el.querySelector('#board-title').textContent = src.board;
    el.querySelector('#board-sub').textContent = '';
    el.querySelector('#board-refresh').title = src.refresh;
    el.hidden = false;
    closeHandover();
    load(false);
  }
  function close() {
    el.hidden = true;
    closeHandover();
    hideCursor();
    onClose && onClose();
  }

  return { open, close, back, load, pad, isOpen: () => !el.hidden, dispose: () => { removeEventListener('keydown', onKey); el.remove(); } };
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
// Windows paths, so case and the trailing slash mean nothing.
function sameFolder(a, b) {
  const norm = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  return !!a && !!b && norm(a) === norm(b);
}
function timeAgo(t) {
  const ms = Date.now() - (typeof t === 'number' ? t : Date.parse(t));
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
