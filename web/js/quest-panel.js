// The quest log (K): the panel beside the island that says what the pirate asked, which step
// you are on, what the map in your pocket points at, and what the finished quests gave. It is
// the fourth place a quest shows (Plans/schatkaarten.md, "Waar zie je je quests?"), next to the
// chart, the radar and the pirate's own exclamation mark.
//
// `renderLog` is a pure string builder over quest-log.js's `view()`, so it runs under Node;
// nothing here touches `document` until createQuestPanel is called. Everything that came from
// storage is escaped on the way out, because storage is a place anybody can edit.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Who is waiting, in the log's words: the view's `talk` is a giver's id ('pirate', a CREW id).
export const WAITS = {
  pirate: 'The pirate at his sea chest is waiting for you.',
  captain: 'Captain Spack Jarrow is waiting for you in the Salty Kraken.',
  navigator: 'Quill the navigator is waiting for you in the Salty Kraken.',
  bosun: 'Bosun Tarr is waiting for you in the Salty Kraken.',
  goldsmith: 'The goldsmith is waiting for you at his shop.',
};
const waitLine = (who) => WAITS[who] || 'Somebody is waiting for you.';

// The map in hand, in words: the chart's square, and whether the water it points at is still
// nobody's. An asleep map is grey on the chart and says why here.
export function renderCard(card) {
  if (!card) return '<p class="muted">No map in your pocket. The pirate hands one over, and the sea brings a bottle on a busy day.</p>';
  if (card.asleep) {
    return `<div class="ql-card asleep"><b>Square ${esc(card.grid)}</b>
      <p class="muted">The water there is somebody's now. The map sleeps until the islet is free again.</p></div>`;
  }
  return `<div class="ql-card"><b>Square ${esc(card.grid)}</b>
    <p class="muted">A red cross on the chart (M). Sail to the square, and on the islet the radar rings the spot.</p></div>`;
}

function questSection(a) {
  return `<section class="ql-quest">
      <h4>${esc(a.title)}${a.repeat ? ` <span class="ql-tag">${a.times ? `done ${esc(a.times)}×` : 'repeats'}</span>` : ''}</h4>
      <p class="ql-text">${esc(a.text)}</p>
      <ol class="ql-steps">${a.steps.map((s) => `<li class="${s.done ? 'done' : s.current ? 'now' : ''}">${esc(s.goal)}</li>`).join('')}</ol>
      ${a.talk ? `<p class="ql-note">${esc(waitLine(a.talk))}</p>` : ''}
      ${a.rewards.length ? `<p class="muted ql-reward">Reward: ${a.rewards.map(esc).join(', ')}</p>` : ''}
    </section>`;
}

export function renderLog(view) {
  if (!view) return '';
  const a = view.active;
  const parts = [];
  parts.push('<h3 class="ql-h">Now</h3>');
  if (a) parts.push(questSection(a));
  else parts.push('<p class="muted">Nothing left to ask. The pirate has told you all he had.</p>');
  // Every other line, told beside the story (the gold mine's, Plans/goudmijn-zoektocht.md).
  for (const l of view.lines || []) parts.push(questSection(l));
  // The repeatable quests counting alongside the story (shared/quests.mjs advance).
  if (view.repeating && view.repeating.length) {
    parts.push('<h3 class="ql-h">Also</h3>');
    parts.push(`<ul class="ql-done">${view.repeating.map((q) => `<li><b>${esc(q.title)}</b> <span class="muted">${q.times ? `done ${esc(q.times)}×` : esc(q.goal)}</span></li>`).join('')}</ul>`);
  }
  parts.push('<h3 class="ql-h">Treasure map</h3>', renderCard(view.card));
  if (view.done.length) {
    parts.push('<h3 class="ql-h">Done</h3>');
    parts.push(`<ul class="ql-done">${view.done.map((q) => `<li><b>${esc(q.title)}</b>${q.rewards.length ? ` <span class="muted">${q.rewards.map(esc).join(', ')}</span>` : ''}</li>`).join('')}</ul>`);
  }
  return parts.join('\n');
}

// Owns #quest-log and #quests-btn (web/index.html). `ui` is createUI()'s return, for the same
// openSide / closeSide the animals' panels use, so one side panel is open at a time and
// Escape, walking and planning close this one with the rest.
//   log      createQuestLog()'s return
//   onClose  () => after the panel closed, by whatever means
export function createQuestPanel({ ui, log, onClose = null }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('quest-log');
  const body = $('quest-log-body');
  const chip = $('quests-btn');

  function render() {
    if (body && panel && !panel.hidden) body.innerHTML = renderLog(log.view());
    if (chip) {
      chip.classList.toggle('on', !!(panel && !panel.hidden));
      // A dot on the chip while anybody the story waits on has something to say, the way the exclamation mark
      // over his head does: the one place a player looking at the sky sees it too.
      chip.classList.toggle('ping', !!log.businessWith() || !!(log.hasBusiness && log.hasBusiness('goldsmith')));
    }
  }

  // However it closes (its ✕, Escape, another panel, walking) it is `hidden` that changes.
  if (panel && typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => {
      render();
      if (panel.hidden && onClose) { try { onClose(); } catch { /* not ours */ } }
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  }
  function open() {
    if (!panel) return;
    ui.openSide('quest-log');
    render();
  }
  function close() { if (panel && !panel.hidden) ui.closeSide('quest-log'); }
  const isOpen = () => !!panel && !panel.hidden;
  if (chip) chip.addEventListener('click', () => (isOpen() ? close() : open()));
  render();
  return { open, close, isOpen, refresh: render };
}
