// The first thing anybody sees: which world this island lives in.
//
// It stands over the island rather than in front of a black screen. By the time this opens
// the world is already built and the camera is framed on it, so the choice is made looking
// at the place it is about - which is also why it is a card over the water and not a title
// screen: nothing here is loading, it is asking.
//
// Three choices, and three things to click. The first draft had the three plus a confirm
// button plus a "leave it as it is" link, which is five things to press to answer a
// question with three answers - and the two extras were not choices at all. Confirming is
// what clicking a card already means, and leaving it alone means clicking the world you are
// already in. So a card *is* the choice: the one this island is in says so and closes when
// pressed, and Join opens its list underneath itself, because "which sea" is the second
// half of that one answer rather than a fourth option. (Joining the online sea did become a
// card of its own later - see MODES - because it is the answer almost everybody gives, and
// "open the list, find it, click it" was three steps for it.)
//
// The three are the islander's `multiplayer.sea.mode`, because all three are things the
// *islander* does: single player and hosting both start a sea in its own process, and
// joining points it at somebody else's. A page with no islander of its own - a phone, a
// second screen - has nothing to start and is shown only the list. That is the
// `hasIslander` half of what used to be one `state.guest` boolean.
//
// Nothing here is a mock. The list comes from GET /api/seas, which asks each candidate's
// /health so a row can say whether anybody is home before you pick rather than after, and a
// choice is POST /api/sea, which writes config.json and then actually closes the sea it was
// in and joins the new one. The page does nothing about its own socket: net.js has been
// retrying since the old one dropped.
const MODES = [
  {
    key: 'single',
    name: 'On my own',
    blurb: 'Just this island. Nothing leaves this machine and nobody can sail in.',
    mark: '⛰',
  },
  {
    key: 'host',
    name: 'Host a sea',
    blurb: 'Open the water around this island, so others can sail in and moor alongside.',
    mark: '⚓',
  },
  // Joining used to be one card that unfolded a list with the open sea somewhere in it. The
  // open sea is the one almost everybody wants, so it is a card of its own and one click;
  // "a local sea" keeps the list, for a sea on this network or at an address you type.
  // Both are the islander's `join` mode - `online` is only which sea it means.
  {
    key: 'online',
    name: 'Join the online sea',
    blurb: 'Everybody’s water, always on. Your island comes along and stays yours.',
    mark: '🌐',
  },
  {
    key: 'join',
    name: 'Join a local sea',
    blurb: 'A sea on this network, or at an address you type.',
    mark: '⛵',
  },
];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createMainMenu({
  islandName = 'this island',
  hasIslander = true,
  seas = async () => null,
  choose = async () => ({ ok: false }),
  forget = async () => ({ ok: false }),
  onDone = () => {},
} = {}) {
  const root = document.getElementById('mainmenu');
  if (!root) return { open: () => onDone(), close: () => {} };

  let opened = null;                 // the card that is unfolded, if any
  let list = null;                   // what /api/seas last said, or null while asking
  let busy = null;                   // the mode being set out for
  let onKey = null;
  // What has been typed into the key field, kept across the redraws that opening a row or
  // failing a join cause. Held here and not read off the input at the last moment, because
  // the input is destroyed and rebuilt by every one of them.
  let typedKey = '';
  // And the same for the address. That field suffers worse than the key ever did:
  // refresh() is fired by open() itself, so the first address anybody types is being
  // typed while the probe is still out - and the list coming back is what empties the
  // box under them. Held here for the same reason: the input does not survive a draw().
  let typedUrl = '';

  // Whether to offer the field at all. Only when something out there says it wants one -
  // an empty box on every sea is a question most people cannot answer, and the one sea
  // that needs it is the one that would otherwise refuse you three times a second with a
  // word from the protocol.
  const wantsKey = () => !!(list && (list.seas || []).some((o) => o.keyed)) || !!typedKey;

  // A page with nothing to start has one real choice, so it is not offered three.
  const modes = hasIslander ? MODES : MODES.filter((m) => m.key === 'join' || m.key === 'online');

  // The open sea, as /api/seas lists it (`from: 'open'`, OPEN_SEA in lib/paths.mjs). Read off
  // the list rather than written down again here: the page may not import lib/, and the
  // islander is the one that knows which address the open sea is this week.
  const openSea = () => (list && (list.seas || []).find((o) => o.from === 'open')) || null;
  const inJoin = (url) => !!(list && list.mode === 'join' && url && url === list.current);
  // Which card "you are here" belongs to: the join mode is split by which sea it is in.
  const hereFor = (key) => {
    if (!list) return false;
    const open = openSea();
    if (key === 'online') return !!open && inJoin(open.url);
    if (key === 'join') return list.mode === 'join' && !(open && inJoin(open.url));
    return key === list.mode;
  };

  function seaRow(o) {
    const here = list && list.mode === 'join' && o.url === list.current;
    const said = o.up
      ? `${o.islands ?? 0} island${o.islands === 1 ? '' : 's'}, ${o.players ?? 0} aboard${o.keyed ? ', needs a key' : ''}`
      : esc(o.why || 'no answer');
    // 'open' is the one sea every island offers (OPEN_SEA in lib/paths.mjs). 'known' used
    // to be labelled "always on" because the always-on sea used to live in that list; it
    // is only what the keeper has saved now.
    const from = o.from === 'open' ? 'always on'
      : o.from === 'network' ? 'on this network'
        : o.mine ? 'yours' : 'saved';
    // Only the saved ones can be forgotten. One found on the network is not ours to
    // forget - it will be back the next time it is announced - and the sea we are in is
    // left by picking another world, which is what the three cards are for.
    // A leftover `url` from the last join ('chosen') is as saved as anything in `known`.
    const droppable = (o.from === 'known' || o.from === 'chosen') && !o.mine && !here;
    return `<div class="menu-sea-row">
      <button class="menu-sea${here ? ' on' : ''}" data-url="${esc(o.url)}"${o.up ? '' : ' disabled'}>
        <span class="menu-sea-name">${esc(o.name || o.url)}</span>
        <span class="menu-sea-said">${from} · ${said}</span>
      </button>
      ${droppable ? `<button class="menu-forget" data-forget="${esc(o.url)}"
        title="Forget ${esc(o.url)}" aria-label="Forget ${esc(o.url)}">\u00d7</button>` : ''}
    </div>`;
  }

  function modeCard(m) {
    const here = hereFor(m.key);
    const open = m.key === opened;
    const working = busy === m.key;
    return `<button class="menu-mode${open ? ' open' : ''}${here ? ' on' : ''}"
      data-mode="${m.key}"${busy ? ' disabled' : ''}>
      <span class="menu-mark">${m.mark}</span>
      <span class="menu-mode-name">${esc(m.name)}${here ? ' <em>you are here</em>' : ''}</span>
      <span class="menu-mode-blurb">${working ? 'Setting out…' : m.blurb}</span>
    </button>`;
  }

  function draw() {
    root.innerHTML = `
      <div class="menu-card card">
        <div class="menu-head">
          <div class="menu-kicker">The living island</div>
          <h1>${esc(islandName)}</h1>
          <p class="menu-sub">${hasIslander
    ? 'Your island is the same island whichever you pick — this only says who else is in the water around it.'
    : 'No island of your own on this screen — pick a water to look in on.'}</p>
        </div>
        <div class="menu-modes">${modes.map(modeCard).join('')}</div>
        ${opened === 'join' ? `<div class="menu-seas">
          ${list === null ? '<p class="menu-note">Listening for seas…</p>'
    : (list.seas || []).some((o) => o.from !== 'open')
      ? (list.seas || []).filter((o) => o.from !== 'open').map(seaRow).join('')
      : '<p class="menu-note">Nothing out there yet. Type an address.</p>'}
          <div class="menu-add">
            <input id="menu-url" class="field" placeholder="http://address:4750/" autocomplete="off"
              value="${esc(typedUrl)}">
            <button class="chip" id="menu-add">Sail there</button>
          </div>
          ${wantsKey() ? `<div class="menu-add">
            <input id="menu-key" class="field" type="password" placeholder="key" autocomplete="off"
              value="${esc(typedKey)}">
            <span class="menu-note">A sea out there wants one. It is a door key everybody in that
              world shares, not a password.</span>
          </div>` : ''}
        </div>` : ''}
        ${list && list.error ? `<p class="menu-note menu-bad">${esc(list.error)}</p>` : ''}
      </div>`;
    wire();
  }

  function wire() {
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      const mode = b.dataset.mode;
      // Joining has to know which sea, so it unfolds its list instead of setting out.
      // Everything else is the whole answer, and the world you are in is the way out.
      if (mode === 'join') {
        opened = opened === 'join' ? null : 'join';
        draw();
        // Asked only when it is asked about: probing half a dozen addresses is not
        // something to do to somebody who came here to pick "on my own".
        if (opened === 'join' && list === null) refresh();
        return;
      }
      if (mode === 'online') { joinOnline(); return; }
      if (hereFor(mode)) { close(); return; }
      go(mode, null);
    }));
    root.querySelectorAll('[data-url]').forEach((b) => b.addEventListener('click', () => {
      if (list && list.mode === 'join' && b.dataset.url === list.current) { close(); return; }
      go('join', b.dataset.url);
    }));
    root.querySelectorAll('[data-forget]').forEach((b) => b.addEventListener('click', async () => {
      if (busy) return;
      const url = b.dataset.forget;
      b.disabled = true;
      const r = await forget(url).catch(() => ({ ok: false, error: 'the island did not answer' }));
      if (r && r.ok) {
        // Struck from the list we already have rather than asked for again: re-probing half
        // a dozen addresses to learn that one of them is gone is a second of nothing
        // happening after a click that should feel instant.
        list = { ...list, seas: (list.seas || []).filter((o) => o.url !== url) };
      } else {
        list = { ...list, error: (r && r.error) || 'that address would not go' };
      }
      draw();
    }));

    const add = root.querySelector('#menu-add');
    const field = root.querySelector('#menu-url');
    const keyField = root.querySelector('#menu-key');
    if (keyField) keyField.addEventListener('input', () => { typedKey = keyField.value; });
    if (field) field.addEventListener('input', () => { typedUrl = field.value; });
    const typed = () => { if (typedUrl.trim()) go('join', typedUrl.trim()); };
    if (add) add.addEventListener('click', typed);
    if (field) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') typed(); });
    if (keyField) keyField.addEventListener('keydown', (e) => { if (e.key === 'Enter') typed(); });
  }

  // One click. The list may still be out when the card is pressed (open() asks for it), so
  // it is waited for rather than guessed at.
  async function joinOnline() {
    if (busy) return;
    if (list === null) await refresh();
    const open = openSea();
    if (!open) { list = { ...(list || { seas: [] }), error: 'this island does not know where the online sea is' }; draw(); return; }
    if (inJoin(open.url)) { close(); return; }
    go('join', open.url, 'online');
  }

  async function refresh() {
    try { list = await seas(); } catch { list = { seas: [] }; }
    draw();
  }

  async function go(mode, url, card = mode) {
    if (busy) return;
    busy = card;
    draw();
    // The key goes with every join, typed or picked from the list. Left out when it is
    // empty rather than sent as '': the islander keeps whatever key it already had unless
    // it is given a new one, and a blank one would wipe a working key off a saved sea.
    const r = await choose({ mode, url, key: typedKey.trim() || undefined })
      .catch(() => ({ ok: false, error: 'the island did not answer' }));
    busy = null;
    if (r && r.ok) { close(); return; }
    list = list || { seas: [] };
    list.error = (r && r.error) || 'that did not work';
    draw();
  }

  function close() {
    if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
    root.classList.add('gone');
    // Left in the tree for a moment so the fade runs, then out of the way of every click.
    setTimeout(() => { root.hidden = true; root.innerHTML = ''; }, 500);
    onDone();
  }

  function open() {
    root.hidden = false;
    root.classList.remove('gone');
    // Escape says the same as clicking the world you are already in: leave it alone.
    onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    draw();
    // Which world this island is in, so a card can say "you are here" and Join already
    // knows which sea it means.
    refresh();
  }

  return { open, close };
}
