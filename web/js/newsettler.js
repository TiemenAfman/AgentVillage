// Founding a settler from the island: pick a folder, pick a model, say the first word,
// and a new session starts. It gets a house and stays, unlike an agent sent out with a
// ticket. Afterwards you carry on with them in their conversation.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MODELS = [
  ['', 'Whatever Claude Code defaults to'],
  ['claude-fable-5-1', 'Fable 5.1'],
  ['claude-opus-5', 'Opus 5'],
  ['claude-sonnet-5', 'Sonnet 5'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
];
const LAST_FOLDER = 'promptholm.found.folder';

export function createNewSettler(root, { onFounded, onClose }) {
  let busy = false;

  const el = document.createElement('div');
  el.className = 'handover';
  el.hidden = true;
  root.appendChild(el);

  function onKey(e) {
    if (el.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  }
  el.addEventListener('keydown', (e) => e.stopPropagation());
  addEventListener('keydown', onKey);

  async function open() {
    el.hidden = false;
    el.innerHTML = `<div class="handover-panel"><p class="muted">Looking for project folders…</p></div>`;
    let folders = [];
    try { folders = (await (await fetch('/api/folders', { cache: 'no-store' })).json()).folders || []; } catch { /* type a path instead */ }
    let last = '';
    try { last = localStorage.getItem(LAST_FOLDER) || ''; } catch { /* no storage */ }

    el.innerHTML = `
      <div class="handover-panel">
        <button class="x" id="ns-close">✕</button>
        <h3>A new settler</h3>
        <p class="ho-sum">A fresh Claude session starts in the folder you pick. It builds a house here and
        stays, and you carry on with it in its own conversation.</p>

        <h4>Where should they live?</h4>
        <select id="ns-folder">
          ${folders.map((f) => `<option value="${esc(f.path)}"${f.path === last ? ' selected' : ''}>${esc(f.name)}${f.jira ? '  ✓ knows the Jira workflow' : ''}${f.worktree ? '  (worktree)' : ''} — ${esc(f.path)}</option>`).join('')}
          <option value="__other">Somewhere else, let me type it…</option>
        </select>
        <p id="ns-other" hidden><input id="ns-path" class="ho-input" placeholder="C:\\Development\\..." spellcheck="false"></p>

        <h4>With which model?</h4>
        <select id="ns-model">${MODELS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>

        <h4>What should they start on?</h4>
        <textarea id="ns-prompt" class="ho-input" rows="3" placeholder="Leave empty and they will simply introduce themselves and wait."></textarea>

        <div class="ho-buttons" style="margin-top:14px">
          <button class="btn primary" id="ns-go">Send for them</button>
          <button class="btn" id="ns-cancel">Never mind</button>
        </div>
        <p class="ho-out" id="ns-out"></p>
      </div>`;

    const folderSel = el.querySelector('#ns-folder');
    const other = el.querySelector('#ns-other');
    const pathInput = el.querySelector('#ns-path');
    const sync = () => { other.hidden = folderSel.value !== '__other'; };
    folderSel.addEventListener('change', sync);
    sync();

    el.querySelector('#ns-close').addEventListener('click', close);
    el.querySelector('#ns-cancel').addEventListener('click', close);
    el.querySelector('#ns-go').addEventListener('click', () => {
      const cwd = folderSel.value === '__other' ? pathInput.value.trim() : folderSel.value;
      send(cwd, el.querySelector('#ns-model').value, el.querySelector('#ns-prompt').value);
    });
    el.querySelector('#ns-prompt').focus();
  }

  async function send(cwd, model, prompt) {
    const out = el.querySelector('#ns-out');
    if (!cwd) { out.innerHTML = '<span class="bad">Pick a folder first.</span>'; return; }
    if (busy) return;
    busy = true;
    out.textContent = 'Sending for them…';
    try {
      const r = await fetch('/api/found', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, model: model || null, prompt }),
      });
      const body = await r.json();
      if (!r.ok) { out.innerHTML = `<span class="bad">${esc(body.error || 'that did not work')}</span>`; return; }
      try { localStorage.setItem(LAST_FOLDER, cwd); } catch { /* fine */ }
      out.innerHTML = `<span class="good">${esc(body.settlerName)} is on the way.</span>`;
      onFounded && onFounded(body);
      setTimeout(close, 1200);
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
