// Talking to the other people on the island: the ones with a keyboard, not the settlers.
//
// web/js/chat.js is the other conversation, and the two are easy to mix up. There the
// transcript of an agent's session *is* the conversation, and what you type carries that
// session on. Here nothing is carried on and nothing is written down: lib/players.mjs
// hands a line to whoever is connected and forgets it, so this shows what was said while
// you were standing here and nothing from before that.
//
// T opens it, Enter sends, Escape closes. T because walk.js has spoken for most of the
// alphabet, and that one just came free.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Lines kept in the page. Enough to read back over a conversation, few enough that a long
// visit does not grow without end.
const KEEP = 60;
// How long the log shows itself for a line that arrived while the box was shut. Long
// enough to notice and answer, short enough to be out of the way again.
const PEEK_MS = 9000;

function typingElsewhere() {
  const a = document.activeElement;
  if (!a || !a.tagName) return false;
  return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable;
}

export function createIslandChat(root, { say, blocked = () => false } = {}) {
  const el = document.createElement('div');
  el.className = 'islandchat';
  el.hidden = true;
  el.innerHTML = '<div class="islandchat-log"></div>'
    + '<input class="islandchat-input" type="text" maxlength="200" autocomplete="off" spellcheck="false"'
    + ' placeholder="Say something to the island" aria-label="Say something to everybody on the island">';
  root.appendChild(el);
  const log = el.querySelector('.islandchat-log');
  const input = el.querySelector('.islandchat-input');

  const lines = [];
  let open = false;
  let timer = null;

  function draw() {
    log.innerHTML = lines.map((l) => (l.note
      ? `<p class="islandchat-note">${esc(l.text)}</p>`
      : `<p${l.self ? ' class="mine"' : ''}><b>${esc(l.name)}</b>`
        + (l.keeper ? '<span class="islandchat-home" title="Lives on this island">lives here</span>' : '')
        + ` ${esc(l.text)}</p>`)).join('');
    log.scrollTop = log.scrollHeight;
  }

  function push(line) {
    lines.push(line);
    if (lines.length > KEEP) lines.splice(0, lines.length - KEEP);
    draw();
    if (!open) peek();
  }

  // The log without the box under it. Somebody talking should be readable without the
  // keyboard being taken away from whoever is in the middle of walking somewhere.
  function peek() {
    clearTimeout(timer);
    el.hidden = false;
    el.classList.add('peeking');
    timer = setTimeout(() => {
      if (open) return;
      el.hidden = true;
      el.classList.remove('peeking');
    }, PEEK_MS);
  }

  function openBox() {
    open = true;
    clearTimeout(timer);
    el.hidden = false;
    el.classList.remove('peeking');
    input.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    input.value = '';
    input.blur();
    // What was last said stays readable for a moment rather than going with the box.
    if (lines.length) peek();
    else el.hidden = true;
  }

  function submit() {
    const text = input.value.trim();
    input.value = '';
    if (!text) { close(); return; }
    // Our own line comes back down the socket with everybody else's, so it is not added
    // here: that would show it twice, and in the wrong order whenever the line is slow.
    if (!say(text)) push({ note: true, text: 'That did not go out - the line to the island is down.' });
  }

  // Everything typed into the box stays in the box. walk.js listens on the window and
  // would read a w as a step; it has a guard of its own for a focused field, and this is
  // the other half of the same bargain.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); return; }
    if (e.key === 'Escape') {
      // Stopped dead rather than merely kept from bubbling: walk.js listens on this very
      // window and reads Escape as "back to the sky", and stopPropagation cannot reach a
      // listener on the same element. The same note is in market.js, for the same reason.
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }
    e.stopPropagation();
  });

  // On the way back up, not on the way down. Taking focus while the key is still being
  // dispatched hands its letter to the field focus lands in - preventDefault on the old
  // target does not follow it there - and the box would open with a t already in it.
  // Waiting for the release costs nothing a person would notice, and by then the letter
  // has already gone nowhere.
  function onKey(e) {
    if (open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.toLowerCase() !== 't') return;
    if (typingElsewhere()) return;      // a field on a board is having its letters
    if (blocked()) return;              // a board or the stall has the screen
    openBox();
  }
  addEventListener('keyup', onKey);

  return {
    said: ({ name, text, keeper, self }) => push({ name, text, keeper, self }),
    // For anything the page itself wants to put in the log, in the log's own voice.
    note: (text) => push({ note: true, text }),
    toggle: () => (open ? close() : openBox()),
    isOpen: () => open,
    dispose() {
      removeEventListener('keyup', onKey);
      clearTimeout(timer);
      el.remove();
    },
  };
}
