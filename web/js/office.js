// The village office: what git says about a district's repository.
//
// Reading only. Staging, rebasing and untangling a merge belong in a real client, and
// the office has a button that opens the ones you have installed.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createOffice(root, { onClose }) {
  let district = null;
  let data = null;
  let busy = false;
  let selected = null;   // { kind: 'file' | 'commit', id, staged }

  const el = document.createElement('div');
  el.className = 'office-panel card';
  el.hidden = true;
  el.innerHTML = `
    <header class="office-head">
      <div>
        <h2 id="office-name">Office</h2>
        <p class="muted" id="office-branch"></p>
      </div>
      <div class="office-actions">
        <span id="office-tools"></span>
        <button class="chip" id="office-fetch" title="Ask the remote what it has, without touching your work">Fetch</button>
        <button class="x" id="office-close" title="Close · Esc">✕</button>
      </div>
    </header>
    <div class="office-body">
      <div class="office-lists">
        <section>
          <h3 id="office-worktree-head">Working tree</h3>
          <ul class="office-list" id="office-files"></ul>
        </section>
        <section>
          <h3>History</h3>
          <ul class="office-list" id="office-log"></ul>
        </section>
      </div>
      <div class="office-detail" id="office-detail"><p class="muted">Pick a file or a commit.</p></div>
    </div>
    <p class="office-foot" id="office-foot"></p>`;
  root.appendChild(el);

  const $ = (id) => el.querySelector(`#${id}`);
  $('office-close').addEventListener('click', () => close());
  $('office-fetch').addEventListener('click', () => act('fetch'));

  function onKey(e) {
    if (el.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  addEventListener('keydown', onKey);

  // ---- loading -------------------------------------------------------------
  async function open(d) {
    district = d;
    el.hidden = false;
    $('office-name').textContent = d.name;
    $('office-branch').textContent = 'Reading the register…';
    $('office-files').innerHTML = '';
    $('office-log').innerHTML = '';
    $('office-detail').innerHTML = '<p class="muted">Pick a file or a commit.</p>';
    await load();
  }

  async function load() {
    try {
      const r = await fetch(`/api/git?district=${encodeURIComponent(district.id)}&op=overview`, { cache: 'no-store' });
      data = await r.json();
      if (!data.ok) { $('office-branch').textContent = data.reason || 'git had nothing to say'; return; }
      render();
    } catch (e) {
      $('office-branch').textContent = `Could not reach git: ${e.message}`;
    }
  }

  function render() {
    const bits = [`on <b>${esc(data.branch)}</b>`];
    if (data.upstream) {
      const gap = [];
      if (data.ahead) gap.push(`${data.ahead} ahead`);
      if (data.behind) gap.push(`${data.behind} behind`);
      bits.push(gap.length ? `${gap.join(', ')} of ${esc(data.upstream)}` : `level with ${esc(data.upstream)}`);
    }
    if (data.stashes) bits.push(`${data.stashes} stash${data.stashes > 1 ? 'es' : ''}`);
    $('office-branch').innerHTML = bits.join(' · ');

    // hand-off buttons for whatever is installed, plus the remote if it is browsable
    const tools = (data.tools || []).map((t) => `<button class="chip" data-tool="${esc(t.id)}">${esc(t.name)}</button>`).join('');
    const browse = data.browseUrl ? `<a class="chip" href="${esc(data.browseUrl)}" target="_blank" rel="noreferrer">Remote</a>` : '';
    $('office-tools').innerHTML = tools + browse;
    el.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => act('open', { tool: b.dataset.tool })));

    const files = data.files || [];
    $('office-worktree-head').textContent = files.length ? `Working tree · ${files.length}` : 'Working tree';
    $('office-files').innerHTML = files.length
      ? files.map((f) => `
        <li data-file="${esc(f.file)}" data-staged="${f.staged && !f.unstaged ? '1' : '0'}" class="${f.conflicted ? 'conflict' : ''}">
          <span class="code ${f.untracked ? 'new' : f.staged ? 'staged' : 'dirty'}">${esc(f.code.replace(/ /g, '·'))}</span>
          <span class="path">${esc(f.file)}</span>
          <small>${esc(f.label)}</small>
        </li>`).join('')
      : '<li class="empty">Nothing changed. The tree is clean.</li>';
    $('office-files').querySelectorAll('[data-file]').forEach((li) => li.addEventListener('click', () => showFile(li.dataset.file, li.dataset.staged === '1', li)));

    $('office-log').innerHTML = (data.commits || []).map((c) => `
      <li data-sha="${esc(c.sha)}">
        <span class="sha">${esc(c.short)}</span>
        <span class="path">${esc(c.subject)}</span>
        <small>${esc(c.author)} · ${when(c.date)}${c.merge ? ' · merge' : ''}</small>
        ${c.refs.length ? `<span class="refs">${c.refs.map((r) => `<i>${esc(r)}</i>`).join('')}</span>` : ''}
      </li>`).join('');
    $('office-log').querySelectorAll('[data-sha]').forEach((li) => li.addEventListener('click', () => showCommit(li.dataset.sha, li)));

    $('office-foot').innerHTML = `<span class="mono">${esc(data.dir)}</span>`;
  }

  function mark(li) {
    el.querySelectorAll('.office-list li').forEach((x) => x.classList.remove('on'));
    if (li) li.classList.add('on');
  }

  // ---- detail --------------------------------------------------------------
  async function showFile(file, staged, li) {
    mark(li);
    selected = { kind: 'file', id: file, staged };
    const d = $('office-detail');
    d.innerHTML = `<h4>${esc(file)}</h4><p class="muted">Reading the diff…</p>`;
    const r = await fetch(`/api/git?district=${encodeURIComponent(district.id)}&op=diff&file=${encodeURIComponent(file)}&staged=${staged ? 1 : 0}`, { cache: 'no-store' });
    const body = await r.json();
    if (selected.id !== file) return;                       // something else was clicked meanwhile
    d.innerHTML = `<h4>${esc(file)}</h4>${body.untracked ? '<p class="muted">New file, shown whole.</p>' : ''}${diffHtml(body.diff)}`;
  }

  async function showCommit(sha, li) {
    mark(li);
    selected = { kind: 'commit', id: sha };
    const d = $('office-detail');
    d.innerHTML = '<p class="muted">Reading the commit…</p>';
    const [detail, diff] = await Promise.all([
      fetch(`/api/git?district=${encodeURIComponent(district.id)}&op=commit&sha=${sha}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/git?district=${encodeURIComponent(district.id)}&op=commit-diff&sha=${sha}`, { cache: 'no-store' }).then((r) => r.json()),
    ]);
    if (selected.id !== sha) return;
    d.innerHTML = `
      <h4>${esc(detail.subject || '')}</h4>
      <p class="muted">${esc(detail.author || '')} · ${when(detail.date)} · <span class="mono">${esc((detail.sha || '').slice(0, 10))}</span></p>
      ${detail.message ? `<pre class="commit-message">${esc(detail.message)}</pre>` : ''}
      ${detail.stat ? `<pre class="commit-stat">${esc(detail.stat)}</pre>` : ''}
      ${diffHtml(diff.diff)}`;
  }

  // Colours a unified diff without pretending to be a diff viewer.
  function diffHtml(text) {
    if (!text || !text.trim()) return '<p class="muted">No changes to show.</p>';
    const lines = String(text).split('\n').slice(0, 1200);
    const rows = lines.map((l) => {
      const cls = l.startsWith('+++') || l.startsWith('---') ? 'meta'
        : l.startsWith('@@') ? 'hunk'
          : l.startsWith('+') ? 'add'
            : l.startsWith('-') ? 'del'
              : l.startsWith('diff ') || l.startsWith('index ') ? 'meta' : '';
      return `<span class="${cls}">${esc(l) || '&nbsp;'}</span>`;
    }).join('\n');
    return `<pre class="diff">${rows}</pre>`;
  }

  // ---- the two things the office may do ------------------------------------
  async function act(op, extra = {}) {
    if (busy) return;
    busy = true;
    const foot = $('office-foot');
    const was = foot.innerHTML;
    foot.textContent = op === 'fetch' ? 'Asking the remote…' : 'Opening…';
    try {
      const r = await fetch('/api/git-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ district: district.id, op, ...extra }),
      });
      const body = await r.json();
      if (!r.ok) foot.innerHTML = `<span class="bad">${esc(body.error || 'that did not work')}</span>`;
      else if (op === 'fetch') { await load(); foot.innerHTML = `<span class="good">${esc(body.message || 'fetched')}</span>`; }
      else foot.innerHTML = `<span class="good">${esc(body.tool)} is opening at this repository.</span>`;
      setTimeout(() => { if (foot.innerHTML !== was) foot.innerHTML = was; }, 6000);
    } catch (e) {
      foot.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    } finally {
      busy = false;
    }
  }

  function close() {
    el.hidden = true;
    district = null;
    onClose && onClose();
  }

  return { open, close, isOpen: () => !el.hidden, dispose: () => { removeEventListener('keydown', onKey); el.remove(); } };
}

function when(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
