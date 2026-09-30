// The pirate at the tavern door: his words for wherever your quest stands, and the one button
// that moves it on (Accept, or Hand it over). A keeper's piece, like the mayor's register, but
// with a choice in it - ui.setSpeech has no buttons - so it is a small window of its own in the
// town hall's mould (web/js/townhall.js): a `.handover` scrim, `open` / `close` / `isOpen`, and
// the feet paused for as long as it is up (main.js openPirate).
//
// What he says is the quest data's (shared/quests.mjs), not written here: `pirateSpeech` picks
// the lines out of quest-log.js's `view()`, so a new quest needs no change in this file.
// Everything in it is escaped when drawn; nothing reaches the network.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Said when there is nothing to hand over yet and, at the hand-over, before the button is
// pressed - the data holds his reply to it (the step's own text), not the question.
const ASK = 'Well, matey?';
const NOTHING_LEFT = "Ye've heard every tale I have, matey. The sea keeps the rest.";

// `view` is quest-log.js's view(). `{ title, lines, hint, button }`: `button` is the label of
// the one action he offers (null when he has nothing for you right now), `hint` a quiet line
// under the words saying what he is waiting for.
export function pirateSpeech(view) {
  const a = view && view.active;
  if (!a) return { title: 'The pirate', lines: [NOTHING_LEFT], hint: null, button: null };
  if (a.talk) {
    return {
      title: a.title,
      // A quest opens with its pitch; a later word with him (handing it over) opens with a
      // question, and the reply comes with the button.
      lines: [a.index === 0 ? a.text : ASK],
      hint: a.index === 0 && a.rewards.length ? `He offers: ${a.rewards.join(', ')}` : a.goal,
      button: a.index === 0 ? 'Accept' : 'Hand it over',
    };
  }
  return { title: a.title, lines: [a.say], hint: a.goal, button: null };
}

// What he says after the button, from the step that was current when it was pressed and the
// lines the book gave back (the toast lines): his reply first, then what it earned.
export function pirateReply(before, result) {
  const lines = [];
  if (before && before.say) lines.push(before.say);
  return { title: (before && before.title) || 'The pirate', lines, earned: (result && result.lines) || [] };
}

// root  where to put the window (document.body)
// log   createQuestLog()'s return, for view()
// talk  () => the book's result for a `talked: pirate` event; main.js runs it through the
//       same path every other quest event takes (unlocks, the map, the chart)
// onClose  () => after it closed, by whatever means: hands the feet and the camera back
export function createPirate(root, { log, talk, onClose = null }) {
  const el = document.createElement('div');
  el.className = 'handover';
  el.hidden = true;
  root.appendChild(el);
  // Set after the button: his reply stays on screen until the window closes.
  let replied = null;

  function onKey(e) {
    if (el.hidden) return;
    if (e.key === 'Escape') {
      // Stopped dead for the reason the town hall's is: walk.js listens on this same window
      // and would read the Escape as "back to the sky" as soon as close() let the feet go.
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }
    e.stopPropagation();
  }
  el.addEventListener('keydown', (e) => e.stopPropagation());
  addEventListener('keydown', onKey);

  function render() {
    const s = pirateSpeech(log.view());
    // After the button: his reply and what it earned, then - as long as he has no further
    // business with you right now - what he says about the next step.
    const lines = replied ? replied.lines : s.lines;
    const next = replied && !s.button ? s.lines[0] : null;
    const hint = s.hint;
    el.innerHTML = `
      <div class="handover-panel pirate">
        <button class="x" id="pi-close" aria-label="Close">✕</button>
        <h3>The pirate</h3>
        <p class="ho-sum pi-quest">${esc(replied ? replied.title : s.title)}</p>
        ${lines.map((l) => `<p class="pi-say">“${esc(l)}”</p>`).join('')}
        ${replied && replied.earned.length ? `<ul class="pi-earned">${replied.earned.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        ${next ? `<p class="pi-say">“${esc(next)}”</p>` : ''}
        ${hint ? `<p class="muted pi-hint">${esc(hint)}</p>` : ''}
        <p class="pi-actions">
          ${!replied && s.button ? `<button class="btn primary" id="pi-go">${esc(s.button)}</button>` : ''}
          <button class="btn" id="pi-bye">${!replied && s.button ? 'Not now' : 'Aye'}</button>
        </p>
      </div>`;
    el.querySelector('#pi-close').addEventListener('click', close);
    el.querySelector('#pi-bye').addEventListener('click', close);
    const go = el.querySelector('#pi-go');
    if (go) go.addEventListener('click', () => {
      const before = log.view().active;
      let result = null;
      try { result = talk(); } catch { /* the book is not the window's to fix */ }
      replied = pirateReply(before, result);
      render();
    });
  }

  function open() {
    replied = null;
    el.hidden = false;
    render();
    const go = el.querySelector('#pi-go');
    if (go) go.focus({ preventScroll: true });
  }
  function close() {
    if (el.hidden) return;
    el.hidden = true;
    el.innerHTML = '';
    replied = null;
    onClose && onClose();
  }

  return { open, close, isOpen: () => !el.hidden, dispose: () => { removeEventListener('keydown', onKey); el.remove(); } };
}
