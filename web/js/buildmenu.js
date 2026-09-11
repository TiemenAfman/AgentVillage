// What you can put on the island, and the place you choose it from.
//
// The menu itself is small and dumb on purpose: it shows the catalogue, remembers what
// you picked last, and hands a kind to whoever asked. Everything that happens after -
// the ghost in your hand, the aiming, the wheel, putting it down - is web/js/ghost.js.
// This file never touches the scene and never talks to the server.
//
// It is the seed stall's twin in shape, deliberately: same `div.handover` scrim, same
// Escape handling, same close-calls-onClose contract, so it behaves like every other
// panel on the island rather than like a new kind of thing.
import { SHAPES, KINDS, wheelsFor } from 'shared/shapes.mjs';
import { FACE_NAMES, BILLBOARD, siteUrl } from './faces.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LAST = 'promptholm.build.last';

// What the wheel does, in words, for the tile. The same three words the HUD uses while
// the thing is in your hand, so the menu teaches the controls rather than hiding them.
const WORDS = { rot: 'turn', scale: 'size', length: 'stretch' };

function hints(kind) {
  const w = wheelsFor(kind);
  const out = [];
  if (w.wheel) out.push(`<kbd>scroll</kbd> ${WORDS[w.wheel]}`);
  if (w.ctrl) out.push(`<kbd>ctrl</kbd> ${WORDS[w.ctrl]}`);
  if (w.shift) out.push(`<kbd>shift</kbd> ${WORDS[w.shift]}`);
  return out.join(' · ');
}

function remember(kind) {
  try { localStorage.setItem(LAST, kind); } catch { /* private window; the menu still works */ }
}

function remembered() {
  try { return localStorage.getItem(LAST); } catch { return null; }
}

export function createBuildMenu(root, { onPick, onDemolish, onClose }) {
  const el = document.createElement('div');
  el.className = 'handover';
  el.hidden = true;
  root.appendChild(el);

  // Which kind has its face row open. Only a panel has faces, and only one at a time.
  let opened = null;
  // And whether that row has been replaced by the one question a billboard has to ask.
  let asking = false;

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
    // The number keys reach for the first nine tiles, which is what a menu you open
    // twenty times an hour wants.
    const n = Number(e.key);
    if (n >= 1 && n <= 9 && KINDS[n - 1]) { e.preventDefault(); pick(KINDS[n - 1]); }
    e.stopPropagation();
  }
  // The tiles promise what ctrl and shift do with the wheel, so this is the one place a
  // reader is most likely to try it - and with nothing in hand yet, ctrl+wheel is still
  // Chrome's zoom. Swallow it here; the shape itself takes over once the menu closes.
  function onWheel(e) {
    if (el.hidden) return;
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  }

  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const field = e.target.closest && e.target.closest('.bd-url');
    if (!field) return;
    if (e.key === 'Enter') { e.preventDefault(); takeSite(field); }
    // Escape hands the row of faces back rather than closing the whole menu: you asked
    // for a billboard, so the way out of the question is the list you asked it from.
    if (e.key === 'Escape') { e.preventDefault(); asking = false; render(); }
  });
  addEventListener('keydown', onKey);
  addEventListener('wheel', onWheel, { capture: true, passive: false });

  // The one question the menu asks. A billboard carries somebody else's site and which
  // one is the whole of what there is to decide about it, so it is decided here rather
  // than by putting a board with a default on it in your hand and making you take it
  // down again. The field starts on the address the face falls back to anyway, so
  // Enter straight away is not a mistake.
  function asker() {
    return `
      <div class="bd-url">
        <label>Which site goes on it
          <input class="bd-site" type="url" value="${esc(BILLBOARD)}" spellcheck="false" autocomplete="off">
        </label>
        <button class="btn tiny" data-site="1">Put it in my hand</button>
        <span class="bd-hint muted">https only. Plenty of sites refuse to be framed and
        leave the board blank, and there is no way to tell from here which ones.</span>
      </div>`;
  }

  function tile(kind, i) {
    const s = SHAPES[kind];
    const hint = hints(kind);
    const faces = opened === kind && kind === 'panel';
    return `
      <div class="bd-tile${faces ? ' open' : ''}" data-kind="${esc(kind)}">
        <b>${esc(kind)}${i < 9 ? `<i>${i + 1}</i>` : ''}</b>
        <p>${esc(s.what)}</p>
        ${hint ? `<span class="bd-hint">${hint}</span>` : '<span class="bd-hint muted">no wheel</span>'}
        ${faces ? (asking ? asker() : `<div class="bd-faces">${FACE_NAMES.map((f) => `<button class="btn tiny" data-face="${esc(f)}">${esc(f)}</button>`).join('')}</div>`) : ''}
      </div>`;
  }

  function render() {
    const last = remembered();
    const known = last && KINDS.includes(last) ? last : null;
    el.innerHTML = `
      <div class="handover-panel wide build">
        <button class="x" id="bd-close">✕</button>
        <h3>Build on the island</h3>
        <p class="ho-sum">Pick a shape and it goes in your hand: aim with the mouse, scroll to
        work it, click to put it down. It stays in your hand, so a row of trees is a row of
        clicks. <kbd>Esc</kbd> puts it back.</p>

        ${known ? `<h4>Last in hand</h4><div class="bd-grid one">${tile(known, KINDS.indexOf(known))}</div>` : ''}

        <h4>Everything the island can build</h4>
        <div class="bd-grid">${KINDS.map(tile).join('')}</div>

        <h4>Taking things away</h4>
        <div class="bd-grid one">
          <div class="bd-tile take" data-take="1">
            <b>DESTROY OBJECT</b>
            <p>Point at something that was built by hand and click. It stays on until
            <kbd>Esc</kbd>, so a run of fence is one click a post.</p>
          </div>
        </div>
      </div>`;
    el.querySelector('#bd-close').addEventListener('click', close);
  }

  // A panel is the one shape with more than a size to decide, so picking it opens a row
  // of faces instead of going straight into your hand. Everything else has nothing to ask.
  function pick(kind, face, note) {
    if (kind === 'panel' && !face) {
      opened = opened === 'panel' ? null : 'panel';
      asking = false;
      render();
      return;
    }
    // And a billboard is the one face with something to ask before it can be held.
    if (face === 'billboard' && !note) {
      opened = 'panel';
      asking = true;
      render();
      const input = el.querySelector('.bd-site');
      if (input) { input.focus(); input.select(); }
      return;
    }
    remember(kind);
    onPick({ kind, face: face || null, note: note || null });
    close();
  }

  // Whatever is in the field this button or this Enter belongs to. Found from the node
  // rather than from the menu, because the tile you last held is drawn twice - once at
  // the top and once in the grid - and the answer has to come from the one being used.
  function takeSite(node) {
    const field = node.closest('.bd-url');
    const input = field && field.querySelector('.bd-site');
    const url = siteUrl(input && input.value);
    if (!url) {
      if (input) { input.classList.add('bad'); input.focus(); input.select(); }
      return;
    }
    pick('panel', 'billboard', url.href);
  }

  el.addEventListener('click', (e) => {
    const take = e.target.closest('[data-take]');
    if (take) { onDemolish(); close(); return; }
    const go = e.target.closest('[data-site]');
    if (go) { takeSite(go); return; }
    // The field sits inside the panel tile, and a click into it must not read as picking
    // that tile again - which would fold the question away mid-sentence.
    if (e.target.closest('.bd-url')) return;
    const face = e.target.closest('[data-face]');
    if (face) { pick('panel', face.dataset.face); return; }
    const t = e.target.closest('[data-kind]');
    if (t) pick(t.dataset.kind);
  });

  function open() {
    opened = null;
    asking = false;
    el.hidden = false;
    render();
  }

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    el.innerHTML = '';
    if (onClose) onClose();
  }

  function dispose() {
    removeEventListener('keydown', onKey);
    removeEventListener('wheel', onWheel, { capture: true });
    el.remove();
  }

  return { open, close, isOpen: () => !el.hidden, dispose };
}
