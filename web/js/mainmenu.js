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
// half of that one answer rather than a fourth option.
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
  {
    key: 'join',
    name: 'Join a sea',
    blurb: 'Sail to somebody else’s water. Your island comes along and stays yours.',
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
  onDone = () => {},
} = {}) {
  const root = document.getElementById('mainmenu');
  if (!root) return { open: () => onDone(), close: () => {} };

  let opened = null;                 // the card that is unfolded, if any
  let list = null;                   // what /api/seas last said, or null while asking
  let busy = null;                   // the mode being set out for
  let onKey = null;

  // A page with nothing to start has one real choice, so it is not offered three.
  const modes = hasIslander ? MODES : MODES.filter((m) => m.key === 'join');

  function seaRow(o) {
    const here = list && list.mode === 'join' && o.url === list.current;
    const said = o.up
      ? `${o.islands ?? 0} island${o.islands === 1 ? '' : 's'}, ${o.players ?? 0} aboard`
      : esc(o.why || 'no answer');
    const from = o.from === 'network' ? 'on this network'
      : o.from === 'known' ? 'always on'
        : o.mine ? 'yours' : 'saved';
    return `<button class="menu-sea${here ? ' on' : ''}" data-url="${esc(o.url)}"${o.up ? '' : ' disabled'}>
      <span class="menu-sea-name">${esc(o.name || o.url)}</span>
      <span class="menu-sea-said">${from} · ${said}</span>
    </button>`;
  }

  function modeCard(m) {
    const here = list && m.key === list.mode;
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
    : (list.seas || []).length ? (list.seas || []).map(seaRow).join('')
      : '<p class="menu-note">Nothing out there yet. Type an address.</p>'}
          <div class="menu-add">
            <input id="menu-url" class="field" placeholder="http://address:4750/" autocomplete="off">
            <button class="chip" id="menu-add">Sail there</button>
          </div>
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
      if (list && list.mode === mode) { close(); return; }
      go(mode, null);
    }));
    root.querySelectorAll('[data-url]').forEach((b) => b.addEventListener('click', () => {
      if (list && list.mode === 'join' && b.dataset.url === list.current) { close(); return; }
      go('join', b.dataset.url);
    }));
    const add = root.querySelector('#menu-add');
    const field = root.querySelector('#menu-url');
    const typed = () => { if (field && field.value.trim()) go('join', field.value.trim()); };
    if (add) add.addEventListener('click', typed);
    if (field) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') typed(); });
  }

  async function refresh() {
    try { list = await seas(); } catch { list = { seas: [] }; }
    draw();
  }

  async function go(mode, url) {
    if (busy) return;
    busy = mode;
    draw();
    const r = await choose({ mode, url }).catch(() => ({ ok: false, error: 'the island did not answer' }));
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
