// The planner's furniture: the tool chips on the left, the draft ledger on the right, the
// strip along the bottom, and the rubber band. DOM only - nothing here knows what a
// super-cell is. The markup's places are in web/index.html (`#plan-tools`,
// `#plan-ledger`, `#plan-hud`, `#plan-band`), where their order in the stacking is
// written down beside everything else's; this fills them and wires the buttons.
//
// The ledger says what the draft does in the island's own words, and beside every step
// the server's verdict from the last dry run: a tick, or the sentence it refused with.
// Apply is only offered when the latest dry run is current and green, so the button never
// sends a plan the island has already said no to.
const el = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const TOOLS = [
  ['select', 'Select', '1', 'Click a house or its land to pick the whole hamlet. Drag on open ground for a box. Shift adds.'],
  ['move', 'Move', '2', 'Drag the selected hamlets. Snaps to the super-grid.'],
  ['zone', 'Zone', '3', 'Paint ground nothing may be built on. Right-drag releases it.'],
  ['polder', 'Polder', '4', 'Paint shallow water to take off the sea as land. Click a standing polder and press Delete to give it back.'],
  ['land', 'Land', '5', 'Give the selected hamlet more land, painted onto its edge. Right-drag takes land away.'],
];

export function createPlanPanel(handlers) {
  const tools = el('plan-tools'), ledger = el('plan-ledger'), hud = el('plan-hud'), band = el('plan-band');
  let armed = null;       // Restore previous is a two-press button, like sending a settler away

  tools.querySelector('.panel-body').innerHTML = TOOLS.map(([id, label, k, tip]) =>
    `<button class="chip tool" data-tool="${id}" title="${esc(tip)}"><kbd>${k}</kbd> ${label}</button>`).join('')
    + '<div class="plan-sel muted" id="plan-sel">Nothing selected</div>'
    + '<div class="plan-actions">'
    + '<button class="btn tiny" id="plan-overview" title="Frame the whole island">Overview</button>'
    + '<button class="btn tiny" id="plan-done" title="Back to the sky (Esc)">Done</button>'
    + '</div>';
  ledger.querySelector('.panel-body').innerHTML = '<ol class="plan-ops" id="plan-ops"></ol>'
    + '<div class="plan-verdict muted" id="plan-verdict"></div>'
    + '<div class="plan-actions">'
    + '<button class="btn tiny" id="plan-undo" title="Undo (Ctrl+Z)">Undo</button>'
    + '<button class="btn tiny" id="plan-redo" title="Redo (Ctrl+Y)">Redo</button>'
    + '<button class="btn tiny" id="plan-clear" title="Throw the draft away">Clear</button>'
    + '</div>'
    + '<div class="plan-actions">'
    + '<button class="btn primary" id="plan-apply" disabled>Apply</button>'
    + '<button class="btn danger tiny" id="plan-restore" title="Put the layout back as it was before the last plan">Restore previous</button>'
    + '</div>';

  tools.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => handlers.onTool(b.dataset.tool)));
  el('plan-overview').addEventListener('click', () => handlers.onOverview());
  el('plan-done').addEventListener('click', () => handlers.onDone());
  el('plan-undo').addEventListener('click', () => handlers.onUndo());
  el('plan-redo').addEventListener('click', () => handlers.onRedo());
  el('plan-clear').addEventListener('click', () => handlers.onClear());
  el('plan-apply').addEventListener('click', () => handlers.onApply());
  el('plan-restore').addEventListener('click', () => {
    const b = el('plan-restore');
    if (armed) { clearTimeout(armed); armed = null; b.textContent = 'Restore previous'; handlers.onRestore(); return; }
    b.textContent = 'Really restore?';
    armed = setTimeout(() => { armed = null; b.textContent = 'Restore previous'; }, 4000);
  });
  tools.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => handlers.onDone()));
  ledger.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => handlers.onDone()));

  function show() { tools.hidden = false; ledger.hidden = false; hud.hidden = false; }
  function hide() { tools.hidden = true; ledger.hidden = true; hud.hidden = true; band.hidden = true; }

  function setTool(tool) {
    tools.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  }

  function setSelection({ count = 0, names = [], polder = null } = {}) {
    el('plan-sel').textContent = count
      ? `${count} hamlet${count === 1 ? '' : 's'}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`
      : polder !== null ? `Polder ${polder + 1} picked — Delete gives it back to the sea`
        : 'Nothing selected';
  }

  // `ops` as sentences; `verdicts` aligned with them from the dry run, or null while one is
  // still on its way; `state` is 'idle' | 'checking' | 'ok' | 'refused' | 'unreachable'.
  function setLedger({ sentences = [], verdicts = null, state = 'idle', error = null, canUndo = false, canRedo = false, snapshots = 0 }) {
    const ol = el('plan-ops');
    ol.innerHTML = sentences.length
      ? sentences.map((s, i) => {
        const v = verdicts && verdicts[i];
        const mark = !v ? '<span class="muted">…</span>' : v.ok ? '<span class="ok">✓</span>' : `<span class="bad" title="${esc(v.reason)}">✗</span>`;
        const why = v && !v.ok ? `<div class="why">${esc(v.reason)}</div>` : '';
        const notes = v && v.ok && v.notes && v.notes.length ? `<div class="muted small">${v.notes.map(esc).join(' · ')}</div>` : '';
        return `<li>${mark} <span>${esc(s)}</span>${why}${notes}</li>`;
      }).join('')
      : '<li class="muted">Nothing planned yet. Pick a hamlet and drag it, or paint a zone.</li>';
    const v = el('plan-verdict');
    v.className = `plan-verdict ${state}`;
    v.textContent = state === 'checking' ? 'Asking the island…'
      : state === 'ok' ? 'The island agrees. Apply makes it so.'
        : state === 'refused' ? (error || 'The island refused a step.')
          : state === 'unreachable' ? 'The island did not answer.'
            : '';
    el('plan-apply').disabled = !(state === 'ok' && sentences.length);
    el('plan-undo').disabled = !canUndo;
    el('plan-redo').disabled = !canRedo;
    el('plan-clear').disabled = !sentences.length;
    el('plan-restore').disabled = !snapshots;
    el('plan-restore').title = snapshots ? `Put the layout back as it was before the last plan (${snapshots} kept)` : 'No earlier layout to go back to';
  }

  // Called every frame while planning, so it only touches the DOM when the words change.
  let said = null;
  function setHud(html) {
    if (html === said) return;
    said = html;
    hud.hidden = !html;
    hud.innerHTML = html || '';
  }

  // The rubber band, in screen pixels.
  function setBand(rect) {
    if (!rect) { band.hidden = true; return; }
    band.hidden = false;
    band.style.left = `${Math.min(rect.x0, rect.x1)}px`;
    band.style.top = `${Math.min(rect.y0, rect.y1)}px`;
    band.style.width = `${Math.abs(rect.x1 - rect.x0)}px`;
    band.style.height = `${Math.abs(rect.y1 - rect.y0)}px`;
  }

  return { show, hide, setTool, setSelection, setLedger, setHud, setBand };
}
