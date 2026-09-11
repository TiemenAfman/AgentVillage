// Talking to a settler. Their session transcript is the conversation, and what you type
// carries it on in that very session, so the house grows while you talk.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MODES = [
  ['full', 'Can do anything', 'Reads, writes and runs things, unattended'],
  ['edits', 'May edit files', 'Changes files, but shell work still needs a person'],
  ['read', 'Read only', 'Looks and plans, changes nothing'],
];
const MODE_KEY = 'promptholm.chat.mode';

// Minimal, safe formatting: fenced code, inline code, bold, and paragraphs.
function render(text) {
  const parts = String(text).split(/```/);
  return parts.map((chunk, i) => {
    if (i % 2 === 1) {
      const nl = chunk.indexOf('\n');
      const body = nl >= 0 ? chunk.slice(nl + 1) : chunk;
      return `<pre><code>${esc(body.replace(/\n$/, ''))}</code></pre>`;
    }
    return esc(chunk)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .split(/\n{2,}/).filter(Boolean).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  }).join('');
}

export function createChat(root, { onClose, onBusyChange, onSendAway }) {
  let settler = null;
  let busy = false;
  let controller = null;
  let mode = 'full';
  try { mode = localStorage.getItem(MODE_KEY) || 'full'; } catch { /* no storage */ }

  const el = document.createElement('div');
  el.className = 'chat-panel card';
  el.hidden = true;
  el.innerHTML = `
    <header class="chat-head">
      <div>
        <h2 id="chat-name">Settler</h2>
        <p class="muted" id="chat-sub"></p>
      </div>
      <div class="chat-head-right">
        <select id="chat-mode" title="What this settler may do while you talk">
          ${MODES.map(([v, l, d]) => `<option value="${v}" title="${esc(d)}">${esc(l)}</option>`).join('')}
        </select>
        <button class="btn danger tiny" id="chat-exile" title="Send this settler off the island">Send away</button>
        <button class="x" id="chat-close" title="Close · Esc">✕</button>
      </div>
    </header>
    <div class="chat-log" id="chat-log"></div>
    <form class="chat-compose" id="chat-form">
      <textarea id="chat-input" rows="1" placeholder="Say something…" spellcheck="false"></textarea>
      <button class="btn primary" id="chat-send" type="submit">Send</button>
      <button class="btn" id="chat-stop" type="button" hidden>Stop</button>
    </form>
    <p class="chat-foot" id="chat-foot"></p>`;
  root.appendChild(el);

  const logEl = el.querySelector('#chat-log');
  const input = el.querySelector('#chat-input');
  const form = el.querySelector('#chat-form');
  const sendBtn = el.querySelector('#chat-send');
  const stopBtn = el.querySelector('#chat-stop');
  const modeSel = el.querySelector('#chat-mode');
  modeSel.value = mode;
  modeSel.addEventListener('change', () => {
    mode = modeSel.value;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* fine */ }
    foot();
  });
  el.querySelector('#chat-close').addEventListener('click', () => close());
  stopBtn.addEventListener('click', () => { if (controller) controller.abort(); });

  // Saying goodbye is a two-step affair here too: the button asks before it acts.
  const exileBtn = el.querySelector('#chat-exile');
  let armed = null;
  exileBtn.addEventListener('click', () => {
    if (!settler) return;
    if (armed) {
      clearTimeout(armed);
      armed = null;
      const id = settler.id;
      close();
      onSendAway && onSendAway(id);
      return;
    }
    exileBtn.textContent = 'Really send them away?';
    exileBtn.classList.add('armed');
    armed = setTimeout(() => { armed = null; exileBtn.textContent = 'Send away'; exileBtn.classList.remove('armed'); }, 5000);
  });
  function disarmExile() {
    if (armed) clearTimeout(armed);
    armed = null;
    exileBtn.textContent = 'Send away';
    exileBtn.classList.remove('armed');
  }

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(150, input.scrollHeight)}px`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    e.stopPropagation();                    // walking must not steal the typing
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); say(input.value); });

  function onKey(e) {
    if (el.hidden) return;
    if (e.key === 'Escape' && document.activeElement !== input) {
      // Stopped dead, not just from bubbling on: walk.js listens on this same window,
      // and close() has just let its feet go - so it would read this very Escape as
      // "back to the sky". stopPropagation cannot help with a listener on the same
      // element; only stopImmediatePropagation can.
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  }
  addEventListener('keydown', onKey);

  // An apprentice reported back to its master and is gone; you can read what it did,
  // but there is no session left to carry on.
  function setReplyable(can) {
    form.hidden = !can;
    exileBtn.hidden = false;
    el.querySelector('#chat-foot').classList.toggle('read-only', !can);
    if (!can) el.querySelector('#chat-foot').innerHTML = 'An apprentice cannot be spoken to. This is the record of what it did.';
  }

  function foot() {
    const m = MODES.find(([v]) => v === mode);
    el.querySelector('#chat-foot').innerHTML = settler && settler.cwd
      ? `<span class="mono">${esc(settler.cwd)}</span> · ${esc(m ? m[2] : '')}`
      : esc(m ? m[2] : '');
  }

  function bubble(msg) {
    if (msg.role === 'note') return `<div class="chat-note">${esc(msg.text)}</div>`;
    const all = msg.tools || [];
    const shown = all.slice(-8);
    const hidden = all.length - shown.length;
    const tools = all.length
      ? `<div class="chat-tools">${hidden > 0 ? `<span class="tool more">${hidden} earlier tool call${hidden > 1 ? 's' : ''}</span>` : ''}${shown.map((t) => `<span class="tool"><b>${esc(t.name)}</b>${t.hint ? ` ${esc(t.hint)}` : ''}</span>`).join('')}</div>`
      : '';
    return `<article class="chat-msg ${msg.role}">
        <div class="who">${msg.role === 'user' ? 'You' : esc((settler && settler.name) || 'Settler')}</div>
        ${msg.text ? `<div class="body">${render(msg.text)}</div>` : ''}
        ${tools}
      </article>`;
  }

  function draw(messages, { note } = {}) {
    logEl.innerHTML = messages.map(bubble).join('') + (note ? `<div class="chat-note">${esc(note)}</div>` : '');
    logEl.scrollTop = logEl.scrollHeight;
  }

  let messages = [];

  async function open(s) {
    settler = s;
    el.hidden = false;
    disarmExile();
    el.querySelector('#chat-name').textContent = s.name;
    el.querySelector('#chat-sub').textContent = [s.title, s.districtName].filter(Boolean).join(' · ');
    foot();
    logEl.innerHTML = '<div class="chat-note">Reading their transcript…</div>';
    input.focus();
    try {
      const q = `session=${encodeURIComponent(s.sessionId)}&limit=120${s.agentId ? `&agent=${encodeURIComponent(s.agentId)}` : ''}`;
      const r = await fetch(`/api/transcript?${q}`, { cache: 'no-store' });
      const body = await r.json();
      messages = body.messages || [];
      if (!body.ok) draw([], { note: body.reason || 'Nothing to read yet. Say something and this becomes their first conversation.' });
      else if (!messages.length) draw([], { note: 'This settler has not said anything yet.' });
      else draw(messages, { note: body.truncated ? null : null });
      if (body.cwd && !settler.cwd) { settler.cwd = body.cwd; foot(); }
      setReplyable(body.canReply !== false && !s.agentId);
    } catch (e) {
      draw([], { note: `Could not read the transcript: ${e.message}` });
    }
  }

  async function say(text) {
    const t = String(text || '').trim();
    if (!t || busy || !settler) return;
    input.value = '';
    input.style.height = 'auto';
    messages.push({ role: 'user', text: t });
    const pendingMsg = { role: 'assistant', text: '', tools: [] };
    messages.push(pendingMsg);
    draw(messages, { note: 'Thinking…' });
    setBusy(true);

    controller = new AbortController();
    try {
      const res = await fetch('/api/say', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: settler.sessionId, cwd: settler.cwd, text: t, mode }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `the server said ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let carry = '';
      let sawAnything = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        carry += dec.decode(value, { stream: true });
        const lines = carry.split('\n');
        carry = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          sawAnything = handleEvent(ev, pendingMsg) || sawAnything;
          draw(messages, { note: busy ? 'Working…' : null });
        }
      }
      if (!sawAnything && !pendingMsg.text) pendingMsg.text = '(they said nothing)';
    } catch (e) {
      if (e.name === 'AbortError') pendingMsg.text += (pendingMsg.text ? '\n\n' : '') + '(you stopped them)';
      else messages.push({ role: 'note', text: `That did not work: ${e.message}` });
    } finally {
      setBusy(false);
      controller = null;
      draw(messages);
      input.focus();
    }
  }

  // One line of the stream. Returns true when it put something on screen.
  function handleEvent(ev, pending) {
    if (ev.type === 'assistant' && ev.message) {
      for (const b of ev.message.content || []) {
        if (b.type === 'text' && b.text) pending.text += (pending.text ? '\n' : '') + b.text;
        else if (b.type === 'tool_use') pending.tools.push({ name: b.name, hint: hintOf(b) });
      }
      return true;
    }
    if (ev.type === 'settlers_error') { messages.push({ role: 'note', text: ev.error }); return true; }
    if (ev.type === 'result' && ev.is_error) { messages.push({ role: 'note', text: ev.result || 'the session reported an error' }); return true; }
    return false;
  }

  function hintOf(b) {
    const i = b.input || {};
    return String(i.file_path || i.path || i.pattern || i.command || i.url || i.description || '').replace(/\s+/g, ' ').slice(0, 90);
  }

  function setBusy(v) {
    busy = v;
    sendBtn.hidden = v;
    stopBtn.hidden = !v;
    input.disabled = false;
    el.classList.toggle('busy', v);
    onBusyChange && onBusyChange(v);
  }

  function close() {
    if (controller) controller.abort();
    disarmExile();
    el.hidden = true;
    settler = null;
    onClose && onClose();
  }

  return { open, close, isOpen: () => !el.hidden, isBusy: () => busy, dispose: () => { removeEventListener('keydown', onKey); el.remove(); } };
}
