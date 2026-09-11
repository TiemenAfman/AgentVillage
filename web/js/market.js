// The seed stall at the market: where the island sells you seed and buys back what you
// grew. It is the only place the purse changes hands.
//
// The stall's prices for seed are fixed and printed in shared/crops.mjs. What it pays
// for a vegetable is a day at a time and drifts a quarter either way, which is what
// makes carrying a full basket over to tomorrow a decision rather than a formality.
import { CROPS, CROP_KINDS, priceMood } from 'shared/crops.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// What the island said, or why it could not be read.
//
// The garden always answers JSON - except when the request never reaches it. An island
// serves its page off disk on every request but keeps its routes in memory from the
// moment it started, so a server that was already running when this page was written
// hands /api/garden to the static file handler instead, and that answers with the plain
// word "Not found". Asking JSON.parse about it produces "Unexpected token 'N'", which
// tells the reader nothing. So the body is read once as text and only then parsed, and a
// 404 says the one thing worth doing about it.
export async function answerOf(r) {
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON, which is itself the news */ }
  if (r.ok) return body || {};
  if (body && body.error) throw new Error(body.error);
  if (r.status === 404) throw new Error('this island has no seed stall yet: the page is newer than the server serving it. Restart the island.');
  throw new Error(`the island said ${r.status}`);
}

function grownIn(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function createMarket(root, { onChange, onClose }) {
  let garden = null;
  let busy = false;
  let said = '';

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
    said = '';
    el.innerHTML = '<div class="handover-panel wide"><p class="muted">Walking up to the stall…</p></div>';
    await load();
  }

  async function load() {
    try {
      garden = await answerOf(await fetch('/api/garden', { cache: 'no-store' }));
    } catch (e) {
      el.innerHTML = `<div class="handover-panel wide"><button class="x" id="mk-close">✕</button>
        <p class="ho-warn">The stall could not be reached: ${esc(e.message)}</p></div>`;
      el.querySelector('#mk-close').addEventListener('click', close);
      return;
    }
    render();
    onChange && onChange(garden);
  }

  // Every button on the stall goes through here, so "the purse will not run to that"
  // is said in one place and the whole panel is redrawn from what the island answered.
  async function act(body, done) {
    if (busy) return;
    busy = true;
    try {
      const answer = await answerOf(await fetch('/api/garden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      said = done ? done(answer) : '';
      garden = answer.garden;
      onChange && onChange(garden);
    } catch (e) {
      said = `<span class="bad">${esc(e.message)}</span>`;
    } finally {
      busy = false;
      render();
    }
  }

  function render() {
    if (!garden) return;
    const basket = Object.entries(garden.basket || {});
    const pouch = Object.entries(garden.seeds || {});
    el.innerHTML = `
      <div class="handover-panel wide market">
        <button class="x" id="mk-close">✕</button>
        <h3>The seed stall</h3>
        <p class="ho-sum">Seed here, vegetables back over the same counter. What the stall pays
        moves a little from one day to the next, and it is not paying for anything still in the ground.</p>

        <div class="mk-purse">
          <span class="mk-coins">${garden.purse}<i>coins</i></span>
          <span class="muted">${pouch.length ? `${pouch.reduce((n, [, v]) => n + v, 0)} seed in the pouch` : 'no seed in the pouch'}
          · ${garden.beds.length} bed${garden.beds.length === 1 ? '' : 's'} in the ground${garden.ripe ? `, ${garden.ripe} ready` : ''}</span>
        </div>

        <h4>What the stall sells</h4>
        <div class="mk-rows">${CROP_KINDS.map(seedRow).join('')}</div>

        ${basket.length ? `
          <h4>What you have brought in</h4>
          <div class="mk-rows">${basket.map(basketRow).join('')}</div>
          <div class="ho-buttons mk-sellall">
            <button class="btn primary" id="mk-sellall">Sell the lot for ${garden.worth} coins</button>
          </div>` : `
          <h4>What you have brought in</h4>
          <p class="muted mk-empty">The basket is empty. Sow a bed, wait, and pull it up with <kbd>E</kbd>.</p>`}

        <div class="ho-out" id="mk-out">${said}</div>
        <p class="mk-ledger muted">${garden.ledger.sown} bed${garden.ledger.sown === 1 ? '' : 's'} sown,
        ${garden.ledger.pulled} vegetable${garden.ledger.pulled === 1 ? '' : 's'} pulled,
        ${garden.ledger.earned} coins taken at this stall.</p>
      </div>`;

    el.querySelector('#mk-close').addEventListener('click', close);
    el.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const kind = b.dataset.buy, count = Number(b.dataset.count || 1);
      act({ op: 'buy', kind, count }, (a) => `<span class="good">${a.count} ${CROPS[kind].name.toLowerCase()} seed, ${a.paid} coins. It is in your hand.</span>`);
    }));
    el.querySelectorAll('[data-hold]').forEach((b) => b.addEventListener('click', () => {
      const kind = b.dataset.hold;
      act({ op: 'hold', kind }, () => `<span class="good">${CROPS[kind].name} seed in hand. <kbd>P</kbd> sows a bed where you stand.</span>`);
    }));
    el.querySelectorAll('[data-sell]').forEach((b) => b.addEventListener('click', () => {
      const kind = b.dataset.sell;
      act({ op: 'sell', kind }, (a) => `<span class="good">${a.count} ${CROPS[kind].plural} at ${a.price}: ${a.paid} coins.</span>`);
    }));
    const all = el.querySelector('#mk-sellall');
    if (all) all.addEventListener('click', () => act({ op: 'sellAll' }, (a) => `<span class="good">${a.count} vegetables over the counter for ${a.paid} coins.</span>`));
  }

  function seedRow(kind) {
    const c = CROPS[kind];
    const price = garden.prices[kind];
    const have = (garden.seeds || {})[kind] || 0;
    const held = garden.held === kind;
    const afford = garden.purse >= c.seed;
    return `
      <article class="mk-row${held ? ' held' : ''}">
        <span class="mk-swatch" style="background:${hex(c.flesh)};border-color:${hex(c.leaf)}"></span>
        <div class="mk-what">
          <b>${esc(c.name)}</b>
          ${have ? `<span class="tag">${have} seed${held ? ' · in hand' : ''}</span>` : ''}
          <p>${esc(c.what)}</p>
          <small>${c.seed} coins a seed · ripe in ${grownIn(c.grow)} · ${c.crop} ${esc(c.plural)} a bed
          · stall pays <b>${price}</b> today <i>(${priceMood(kind, price)})</i></small>
        </div>
        <div class="mk-buy">
          <button class="btn${afford ? '' : ' off'}" data-buy="${kind}" data-count="1"${afford ? '' : ' disabled'}>Buy 1</button>
          <button class="btn${garden.purse >= c.seed * 5 ? '' : ' off'}" data-buy="${kind}" data-count="5"${garden.purse >= c.seed * 5 ? '' : ' disabled'}>×5</button>
          ${have && !held ? `<button class="btn tiny" data-hold="${kind}">Take in hand</button>` : ''}
        </div>
      </article>`;
  }

  function basketRow([kind, n]) {
    const c = CROPS[kind];
    const price = garden.prices[kind];
    return `
      <article class="mk-row">
        <span class="mk-swatch" style="background:${hex(c.flesh)};border-color:${hex(c.leaf)}"></span>
        <div class="mk-what">
          <b>${n} ${esc(n === 1 ? c.name.toLowerCase() : c.plural)}</b>
          <small>${price} coins each today <i>(${priceMood(kind, price)})</i></small>
        </div>
        <div class="mk-buy">
          <button class="btn primary" data-sell="${kind}">Sell for ${price * n}</button>
        </div>
      </article>`;
  }

  function close() {
    el.hidden = true;
    el.innerHTML = '';
    onClose && onClose();
  }

  return {
    open, close, isOpen: () => !el.hidden,
    dispose: () => { removeEventListener('keydown', onKey); el.remove(); },
  };
}

function hex(n) { return `#${Number(n).toString(16).padStart(6, '0')}`; }
